import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { NextFunction, Request, Response } from 'express'
import { verifyRequestOrigin } from './csrf.middleware.js'
import { ForbiddenError } from '../errors.js'

const TRUSTED_ORIGIN = 'https://sport-zone-bd.vercel.app'
const AUTH_COOKIE = 'accessToken=header.payload.signature'

interface Outcome {
  rejected: unknown
  passed: boolean
}

function run(method: string, headers: Record<string, string | undefined>): Outcome {
  const outcome: Outcome = { rejected: null, passed: false }
  const req = { method, headers } as unknown as Request
  const next: NextFunction = ((error?: unknown) => {
    if (error) outcome.rejected = error
    else outcome.passed = true
  }) as NextFunction

  verifyRequestOrigin(req, {} as Response, next)
  return outcome
}

function isForbidden(value: unknown): boolean {
  return value instanceof ForbiddenError && value.statusCode === 403
}

test('allows a state-changing request from a trusted origin', () => {
  assert.deepEqual(run('POST', { cookie: AUTH_COOKIE, origin: TRUSTED_ORIGIN }), { rejected: null, passed: true })
  assert.deepEqual(run('PATCH', { cookie: AUTH_COOKIE, origin: TRUSTED_ORIGIN }), { rejected: null, passed: true })
  assert.deepEqual(run('DELETE', { cookie: AUTH_COOKIE, origin: TRUSTED_ORIGIN }), { rejected: null, passed: true })
})

test('rejects a cookie-carrying state-changing request with no Origin or Referer', () => {
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    const outcome = run(method, { cookie: AUTH_COOKIE })
    assert.equal(outcome.passed, false, `${method} should be blocked`)
    assert.ok(isForbidden(outcome.rejected), `${method} should produce a 403`)
  }
})

test('rejects a state-changing request from an untrusted origin', () => {
  for (const origin of ['https://evil.example', 'https://sport-zone-bd.vercel.app.evil.example', 'null', 'http://localhost:9999']) {
    const outcome = run('POST', { cookie: AUTH_COOKIE, origin })
    assert.equal(outcome.passed, false, `${origin} should be blocked`)
    assert.ok(isForbidden(outcome.rejected), `${origin} should produce a 403`)
  }
})

test('does not let an allowed Referer override a mismatched Origin', () => {
  const outcome = run('POST', {
    cookie: AUTH_COOKIE,
    origin: 'https://evil.example',
    referer: `${TRUSTED_ORIGIN}/settings`,
  })

  assert.equal(outcome.passed, false)
  assert.ok(isForbidden(outcome.rejected))
})

test('falls back to Referer when Origin is absent', () => {
  const trusted = run('POST', { cookie: AUTH_COOKIE, referer: `${TRUSTED_ORIGIN}/admin/matches` })
  assert.deepEqual(trusted, { rejected: null, passed: true })

  const untrusted = run('POST', { cookie: AUTH_COOKIE, referer: 'https://evil.example/attack' })
  assert.equal(untrusted.passed, false)
  assert.ok(isForbidden(untrusted.rejected))
})

test('never blocks safe methods, even from an untrusted origin', () => {
  for (const method of ['GET', 'HEAD', 'OPTIONS']) {
    assert.deepEqual(
      run(method, { cookie: AUTH_COOKIE, origin: 'https://evil.example' }),
      { rejected: null, passed: true },
      `${method} must not be blocked`,
    )
  }
})

test('leaves unauthenticated and cookie-less callers untouched', () => {
  // No cookies: nothing ambient to forge, so the request proceeds and normal auth/RBAC decides.
  assert.deepEqual(run('POST', {}), { rejected: null, passed: true })
  assert.deepEqual(run('DELETE', { origin: 'https://evil.example' }), { rejected: null, passed: true })
  // Payment webhooks arrive server-to-server with no cookies and no Origin.
  assert.deepEqual(run('POST', { 'content-type': 'application/json', 'x-signature': 'abc' }), { rejected: null, passed: true })
})

test('keeps the refresh and logout cookie flows working from the real frontend', () => {
  const refreshTokenCookie = `refreshToken=refresh.jwt.value; accessToken=access.jwt.value`
  assert.deepEqual(run('POST', { cookie: refreshTokenCookie, origin: TRUSTED_ORIGIN }), { rejected: null, passed: true })
})

test('does not interfere with the OAuth redirect or its callback', () => {
  // Both are top-level navigations to GET routes and must remain untouched.
  assert.deepEqual(run('GET', { cookie: AUTH_COOKIE, origin: 'https://accounts.google.com' }), { rejected: null, passed: true })
})

test('blocks the attack pattern: cross-site form POST with ambient auth cookies', () => {
  const outcome = run('POST', {
    cookie: AUTH_COOKIE,
    origin: 'https://evil.example',
    referer: 'https://evil.example/attack.html',
    'content-type': 'application/x-www-form-urlencoded',
  })

  assert.equal(outcome.passed, false)
  assert.ok(isForbidden(outcome.rejected))
})

test('rejects with the project error shape and leaks no cookies or tokens', () => {
  const outcome = run('POST', { cookie: AUTH_COOKIE, origin: 'https://evil.example' })
  const error = outcome.rejected as ForbiddenError

  assert.equal(error.statusCode, 403)
  assert.equal(error.name, 'ForbiddenError')
  assert.equal(error.message, 'Cross-site request blocked')
  assert.ok(!error.message.includes(AUTH_COOKIE))
  assert.ok(!/token|secret|jwt/i.test(error.message))
})
