import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { before, test } from 'node:test'
import type { CookieOptions, NextFunction, Request, Response } from 'express'

type OAuthStateModule = typeof import('./oauthState.js')

let OAUTH_STATE_COOKIE: OAuthStateModule['OAUTH_STATE_COOKIE']
let OAUTH_STATE_TTL_MS: OAuthStateModule['OAUTH_STATE_TTL_MS']
let OAUTH_STATE_CLAIM_TTL_SECONDS: OAuthStateModule['OAUTH_STATE_CLAIM_TTL_SECONDS']
let OAUTH_STATE_PATH: OAuthStateModule['OAUTH_STATE_PATH']
let createOAuthState: OAuthStateModule['createOAuthState']
let verifyOAuthState: OAuthStateModule['verifyOAuthState']
let googleOAuthStateCookieOptions: OAuthStateModule['googleOAuthStateCookieOptions']
let claimOAuthStateNonce: OAuthStateModule['claimOAuthStateNonce']
let beginGoogleOAuthState: OAuthStateModule['beginGoogleOAuthState']
let getPendingOAuthState: OAuthStateModule['getPendingOAuthState']
let requireGoogleOAuthState: OAuthStateModule['requireGoogleOAuthState']

const SECRET = 'test-oauth-state-secret'
const FAILURE_REDIRECT = 'https://sport-zone-bd.vercel.app/login?error=google-auth-failed'

before(async () => {
  process.env.REDIS_URL_PRIMARY = ''
  process.env.REDIS_URL = ''
  process.env.REDIS_URL_BACKUP_1 = ''
  process.env.REDIS_URL_BACKUP_2 = ''
  process.env.REDIS_URL_BACKUP_3 = ''
  process.env.JWT_SECRET = SECRET

  const module = await import('./oauthState.js')
  OAUTH_STATE_COOKIE = module.OAUTH_STATE_COOKIE
  OAUTH_STATE_TTL_MS = module.OAUTH_STATE_TTL_MS
  OAUTH_STATE_CLAIM_TTL_SECONDS = module.OAUTH_STATE_CLAIM_TTL_SECONDS
  OAUTH_STATE_PATH = module.OAUTH_STATE_PATH
  createOAuthState = module.createOAuthState
  verifyOAuthState = module.verifyOAuthState
  googleOAuthStateCookieOptions = module.googleOAuthStateCookieOptions
  claimOAuthStateNonce = module.claimOAuthStateNonce
  beginGoogleOAuthState = module.beginGoogleOAuthState
  getPendingOAuthState = module.getPendingOAuthState
  requireGoogleOAuthState = module.requireGoogleOAuthState
})

interface CookieCall { name: string; value: string; options?: CookieOptions }

function createRes() {
  const set: CookieCall[] = []
  const cleared: CookieCall[] = []
  const redirects: string[] = []
  const res = {
    locals: {} as Record<string, unknown>,
    set,
    cleared,
    redirects,
    cookie(name: string, value: string, options?: CookieOptions) { set.push({ name, value, options }); return res },
    clearCookie(name: string, options?: CookieOptions) { cleared.push({ name, value: '', options }); return res },
    redirect(url: string) { redirects.push(url); return res },
  }
  return res
}

function createReq(options: { query?: Record<string, unknown>; cookies?: Record<string, string>; body?: unknown } = {}) {
  return {
    query: options.query ?? {},
    cookies: options.cookies ?? {},
    body: options.body ?? {},
  } as unknown as Request
}

/** Runs a middleware and waits for any async claim to settle. */
async function run(middleware: (req: Request, res: Response, next: NextFunction) => void, req: Request, res: ReturnType<typeof createRes>) {
  const outcome = { calledNext: false, error: null as unknown }
  middleware(req, res as unknown as Response, ((error?: unknown) => {
    if (error) outcome.error = error
    else outcome.calledNext = true
  }) as NextFunction)
  await new Promise((resolve) => setTimeout(resolve, 5))
  return outcome
}

test('starting the flow issues a signed state bound to a short-lived HttpOnly cookie', async () => {
  const res = createRes()
  const outcome = await run(beginGoogleOAuthState, createReq(), res)

  assert.equal(outcome.calledNext, true)
  assert.equal(res.set.length, 1)

  const [cookie] = res.set
  assert.equal(cookie.name, OAUTH_STATE_COOKIE)
  assert.equal(cookie.options?.httpOnly, true)
  assert.equal(cookie.options?.sameSite, 'lax')
  assert.equal(cookie.options?.path, OAUTH_STATE_PATH)
  assert.equal(cookie.options?.maxAge, OAUTH_STATE_TTL_MS)

  // The cookie carries the nonce the signed state also commits to.
  const state = getPendingOAuthState(res as unknown as Response)
  assert.ok(state)
  assert.equal(state!.split('.')[0], cookie.value)
  // Starting the flow creates no session or token cookie.
  assert.deepEqual(res.set.map((entry) => entry.name), [OAUTH_STATE_COOKIE])
})

test('state is unpredictable, unique per flow, and free of sensitive data', () => {
  const states = new Set<string>()
  for (let index = 0; index < 200; index += 1) states.add(createOAuthState().state)
  assert.equal(states.size, 200)

  const { state, nonce } = createOAuthState()
  assert.equal(nonce.length, 43)
  assert.match(nonce, /^[A-Za-z0-9_-]{43}$/)
  assert.equal(state.split('.').length, 3)
  assert.ok(!state.includes(SECRET))
  for (const part of state.split('.')) assert.ok(!part.includes('@'))

  // Two flows in the same millisecond still differ, so the timestamp is not the entropy source.
  const sameMoment = Date.now()
  assert.notEqual(createOAuthState(sameMoment).state, createOAuthState(sameMoment).state)
})

test('a callback with a valid, browser-bound state proceeds', async () => {
  const { state, nonce } = createOAuthState()
  const res = createRes()
  const outcome = await run(
    requireGoogleOAuthState(FAILURE_REDIRECT),
    createReq({ query: { state }, cookies: { [OAUTH_STATE_COOKIE]: nonce } }),
    res,
  )

  assert.equal(outcome.calledNext, true)
  assert.equal(outcome.error, null)
  assert.deepEqual(res.redirects, [])
  // The binding cookie is consumed so the state cannot be replayed.
  assert.deepEqual(res.cleared.map((entry) => entry.name), [OAUTH_STATE_COOKIE])
  assert.equal(res.cleared[0].options?.path, OAUTH_STATE_PATH)
})

test('accepts the state from the request body when it is not in the query', async () => {
  const { state, nonce } = createOAuthState()
  const res = createRes()
  const outcome = await run(
    requireGoogleOAuthState(FAILURE_REDIRECT),
    createReq({ body: { state }, cookies: { [OAUTH_STATE_COOKIE]: nonce } }),
    res,
  )

  assert.equal(outcome.calledNext, true)
})

test('a missing state is rejected', async () => {
  for (const query of [{}, { state: '' }]) {
    const res = createRes()
    const outcome = await run(
      requireGoogleOAuthState(FAILURE_REDIRECT),
      createReq({ query, cookies: { [OAUTH_STATE_COOKIE]: createOAuthState().nonce } }),
      res,
    )

    assert.equal(outcome.calledNext, false)
    assert.deepEqual(res.redirects, [FAILURE_REDIRECT])
    assert.deepEqual(res.set, [])
  }
})

test('a missing binding cookie is rejected even with a correctly signed state', async () => {
  const { state } = createOAuthState()
  const res = createRes()
  const outcome = await run(requireGoogleOAuthState(FAILURE_REDIRECT), createReq({ query: { state } }), res)

  assert.equal(outcome.calledNext, false)
  assert.deepEqual(res.redirects, [FAILURE_REDIRECT])
})

test('a tampered, malformed, or forged state is rejected', async () => {
  const { state, nonce } = createOAuthState()
  const [originalNonce, issuedAt, signature] = state.split('.')

  const candidates = [
    `${originalNonce}.${issuedAt}.${signature.slice(0, -1)}A`,
    `${originalNonce}.${Number(issuedAt) + 1}.${signature}`,
    `${createOAuthState().nonce}.${issuedAt}.${signature}`,
    `${originalNonce}.${issuedAt}`,
    `${originalNonce}.${issuedAt}.${signature}.extra`,
    'not-a-state',
  ]

  for (const candidate of candidates) {
    const res = createRes()
    const outcome = await run(
      requireGoogleOAuthState(FAILURE_REDIRECT),
      createReq({ query: { state: candidate }, cookies: { [OAUTH_STATE_COOKIE]: nonce } }),
      res,
    )
    assert.equal(outcome.calledNext, false, `expected ${candidate} to be rejected`)
    assert.deepEqual(res.redirects, [FAILURE_REDIRECT])
  }
})

test('an expired state is rejected once the short window passes', async () => {
  const issuedAt = Date.now() - OAUTH_STATE_TTL_MS - 1
  const { state, nonce } = createOAuthState(issuedAt)

  const res = createRes()
  const outcome = await run(
    requireGoogleOAuthState(FAILURE_REDIRECT),
    createReq({ query: { state }, cookies: { [OAUTH_STATE_COOKIE]: nonce } }),
    res,
  )

  assert.equal(outcome.calledNext, false)
  assert.deepEqual(res.redirects, [FAILURE_REDIRECT])
  assert.equal(verifyOAuthState(state, nonce, Date.now()), 'expired')
  // Still valid right up to the boundary.
  assert.equal(verifyOAuthState(state, nonce, issuedAt + OAUTH_STATE_TTL_MS), null)
})

test('a state issued in the future beyond the clock-skew allowance is rejected', () => {
  const { state, nonce } = createOAuthState(Date.now() + 10 * 60 * 1000)
  assert.equal(verifyOAuthState(state, nonce, Date.now()), 'expired')
})

test('a state from another browser or context is rejected', async () => {
  const attackerFlow = createOAuthState()
  const victimFlow = createOAuthState()

  const res = createRes()
  const outcome = await run(
    requireGoogleOAuthState(FAILURE_REDIRECT),
    createReq({ query: { state: attackerFlow.state }, cookies: { [OAUTH_STATE_COOKIE]: victimFlow.nonce } }),
    res,
  )

  assert.equal(outcome.calledNext, false)
  assert.deepEqual(res.redirects, [FAILURE_REDIRECT])
  assert.equal(verifyOAuthState(attackerFlow.state, victimFlow.nonce), 'mismatch')
})

test('a reused state is rejected on the second callback', async () => {
  let claimed = false
  const guard = requireGoogleOAuthState(FAILURE_REDIRECT, {
    claim: async () => {
      if (claimed) return false
      claimed = true
      return true
    },
  })
  const { state, nonce } = createOAuthState()

  const first = await run(guard, createReq({ query: { state }, cookies: { [OAUTH_STATE_COOKIE]: nonce } }), createRes())
  const secondRes = createRes()
  const second = await run(guard, createReq({ query: { state }, cookies: { [OAUTH_STATE_COOKIE]: nonce } }), secondRes)

  assert.equal(first.calledNext, true)
  assert.equal(second.calledNext, false)
  assert.deepEqual(secondRes.redirects, [FAILURE_REDIRECT])
})

test('after the cookie is consumed a replayed callback fails', async () => {
  const guard = requireGoogleOAuthState(FAILURE_REDIRECT)
  const { state, nonce } = createOAuthState()

  const first = await run(guard, createReq({ query: { state }, cookies: { [OAUTH_STATE_COOKIE]: nonce } }), createRes())
  // The browser no longer holds the binding cookie.
  const secondRes = createRes()
  const second = await run(guard, createReq({ query: { state }, cookies: {} }), secondRes)

  assert.equal(first.calledNext, true)
  assert.equal(second.calledNext, false)
  assert.deepEqual(secondRes.redirects, [FAILURE_REDIRECT])
})

test('rejected states never create a session, cookie, or token', async () => {
  const { state } = createOAuthState()
  const res = createRes()
  const outcome = await run(
    requireGoogleOAuthState(FAILURE_REDIRECT),
    createReq({ query: { state }, cookies: { [OAUTH_STATE_COOKIE]: 'a-different-browser-nonce' } }),
    res,
  )

  assert.equal(outcome.calledNext, false)
  assert.equal(outcome.error, null)
  // Nothing is ever written; only the binding cookie is cleared.
  assert.deepEqual(res.set, [])
  assert.deepEqual(res.cleared.map((entry) => entry.name), [OAUTH_STATE_COOKIE])
})

test('the successful path touches only the OAuth state cookie', async () => {
  const res = createRes()
  await run(beginGoogleOAuthState, createReq(), res)
  const nonce = res.set[0].value
  const state = getPendingOAuthState(res as unknown as Response)

  const callbackRes = createRes()
  const outcome = await run(
    requireGoogleOAuthState(FAILURE_REDIRECT),
    createReq({ query: { state }, cookies: { [OAUTH_STATE_COOKIE]: nonce } }),
    callbackRes,
  )

  assert.equal(outcome.calledNext, true)
  // Session/JWT cookie issuance stays exactly where it was: createSessionAndSetCookies.
  assert.deepEqual(res.set.map((entry) => entry.name), [OAUTH_STATE_COOKIE])
  assert.deepEqual(callbackRes.set, [])
})

test('the state cookie is HttpOnly, Lax, and Secure in production, scoped to the auth routes', () => {
  const previousNodeEnv = process.env.NODE_ENV
  const previousCookieSecure = process.env.COOKIE_SECURE

  try {
    process.env.NODE_ENV = 'production'
    delete process.env.COOKIE_SECURE
    const production = googleOAuthStateCookieOptions()
    assert.equal(production.httpOnly, true)
    assert.equal(production.sameSite, 'lax')
    assert.equal(production.secure, true)
    assert.equal(production.path, OAUTH_STATE_PATH)

    process.env.NODE_ENV = 'development'
    assert.equal(googleOAuthStateCookieOptions().secure, false)
  } finally {
    process.env.NODE_ENV = previousNodeEnv
    if (previousCookieSecure === undefined) delete process.env.COOKIE_SECURE
    else process.env.COOKIE_SECURE = previousCookieSecure
  }
})

test('the single-use claim uses a hashed key and a short TTL', async () => {
  assert.equal(OAUTH_STATE_CLAIM_TTL_SECONDS, 300)
  assert.equal(OAUTH_STATE_TTL_MS, 5 * 60 * 1000)

  const calls: unknown[][] = []
  const fakeClient = { set: async (...args: unknown[]) => { calls.push(args); return 'OK' } }
  const nonce = createOAuthState().nonce

  assert.equal(await claimOAuthStateNonce(nonce, { client: fakeClient, configured: true }), true)

  const expectedKey = `sportzone:oauth:state:${crypto.createHash('sha256').update(nonce).digest('base64url')}`
  assert.deepEqual(calls[0], [expectedKey, '1', 'EX', 300, 'NX'])
  // The raw nonce never appears in the Redis key.
  assert.ok(!String(calls[0][0]).includes(nonce))
})

test('a nonce already claimed in Redis is treated as a replay', async () => {
  const fakeClient = { set: async () => null }
  assert.equal(await claimOAuthStateNonce('nonce', { client: fakeClient, configured: true }), false)
})

test('a Redis outage does not block login: cookie binding still applies', async () => {
  const failingClient = { set: async () => { throw new Error('redis unavailable') } }
  assert.equal(await claimOAuthStateNonce('nonce', { client: failingClient, configured: true }), true)
  assert.equal(await claimOAuthStateNonce('nonce', { configured: false }), true)
})
