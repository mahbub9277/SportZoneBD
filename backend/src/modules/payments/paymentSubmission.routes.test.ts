import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { NextFunction, Router } from 'express'

process.env.JWT_SECRET ??= 'payment-route-test-secret'
process.env.JWT_REFRESH_SECRET ??= 'payment-route-test-refresh-secret'

const { paymentRouter } = await import('./payment.routes.js')

/**
 * Who may reach each payment route, asserted against the router.
 *
 * The checkout endpoints are customer endpoints: they must require an authenticated identity (the customer
 * who owns the payment) and must not require any administrator permission. A route that quietly gained a
 * permission gate would lock paying customers out; one that lost `authenticate` would let an anonymous
 * caller create payment sessions or verify somebody else's. The provider callback is the exception: it is
 * reached by ZiniPay's servers, so it must stay unauthenticated and must not be trusted as proof.
 */

interface StackLayer {
  handle?: { name: string }
  route?: {
    path: string
    methods: Record<string, boolean>
    stack: Array<{ handle: { name: string } }>
  }
}

function routeHandles(method: string, path: string) {
  const layers = (paymentRouter as unknown as { stack: StackLayer[] }).stack
  const layer = layers.find((candidate) => (
    candidate.route
    && candidate.route.path === path
    && candidate.route.methods[method] === true
  ))
  assert.ok(layer?.route, `no ${method.toUpperCase()} ${path} route is registered`)
  return layer.route.stack.map((entry) => entry.handle.name)
}

/**
 * Runs the route's gates the way express would, without reaching the controller.
 *
 * Returns the refusal (an error forwarded to `next`) or null when every gate passed.
 */
async function runGates(method: string, path: string, permissions: string[]) {
  const layers = (paymentRouter as unknown as { stack: StackLayer[] }).stack
  const layer = layers.find((candidate) => (
    candidate.route
    && candidate.route.path === path
    && candidate.route.methods[method] === true
  ))
  assert.ok(layer?.route, `no ${method.toUpperCase()} ${path} route is registered`)

  const req = {
    user: { id: 'staff-1', fullName: 'Staff', roles: ['moderator'], permissions },
    query: {},
    params: {},
    body: {},
    headers: {},
  }
  const res = {
    status: () => res,
    json: () => res,
    cookie: () => res,
    clearCookie: () => res,
    setHeader: () => res,
    getHeader: () => undefined,
  }

  for (const entry of layer.route.stack) {
    const name = entry.handle.name
    if (name === 'authenticate' || name === 'optionalProtect') continue

    let decided = false
    let refusal: unknown = null
    await new Promise<void>((resolve) => {
      const next: NextFunction = ((error?: unknown) => {
        decided = true
        if (error) refusal = error
        resolve()
      }) as NextFunction
      const outcome = (entry.handle as unknown as (req: unknown, res: unknown, next: NextFunction) => unknown)(req, res, next)
      if (outcome && typeof (outcome as Promise<unknown>).then === 'function') {
        void (outcome as Promise<unknown>).then(() => { if (!decided) resolve() })
      } else if (!decided) {
        resolve()
      }
    })

    if (refusal) return refusal
    if (!decided) return null
  }

  return null
}

test('submitting a payment requires authentication', () => {
  const handles = routeHandles('post', '/checkout')

  assert.ok(handles.includes('authenticate'), `the checkout route does not authenticate: ${handles.join(', ')}`)
})

test('submitting a payment requires no administrator permission', () => {
  for (const [method, path] of [['post', '/checkout'], ['post', '/checkout/:paymentId/verify']] as const) {
    const handles = routeHandles(method, path)

    assert.equal(
      handles.some((name) => name.includes('requirePermission') || name.includes('requireRole')),
      false,
      `a customer endpoint must not be gated by an admin gate: ${method} ${path} → ${handles.join(', ')}`,
    )
  }
})

test('verifying a payment requires authentication, so one customer cannot check another one', () => {
  const handles = routeHandles('post', '/checkout/:paymentId/verify')

  assert.ok(handles.includes('authenticate'), `the verification route does not authenticate: ${handles.join(', ')}`)
  assert.equal(handles.length, 2, 'the route is the authentication gate plus one handler')
})

test('the provider callback is reachable without a session but is not a decision maker', () => {
  const handles = routeHandles('post', '/webhook/:provider')

  assert.equal(handles.includes('authenticate'), false, `the provider callback cannot require a session: ${handles.join(', ')}`)
  assert.equal(handles.some((name) => name.includes('requirePermission')), false)
})

test('the manual payment routes are gone: the hosted checkout is the only customer payment flow', () => {
  const layers = (paymentRouter as unknown as { stack: StackLayer[] }).stack
  const paths = layers.flatMap((layer) => (layer.route ? [layer.route.path] : []))

  for (const removed of ['/verify', '/manual-config']) {
    assert.equal(paths.includes(removed), false, `${removed} is still registered`)
  }
})

test('the review queue and the decision stay behind their permission', async () => {
  for (const [method, path] of [['get', '/manual-verification'], ['patch', '/manual-verification/:id']] as const) {
    const refusal = await runGates(method, path, [])

    assert.ok(refusal, `${method.toUpperCase()} ${path} admitted a request with no permissions`)
    assert.equal((refusal as { statusCode?: number }).statusCode, 403)
  }
})
