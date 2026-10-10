import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { NextFunction, Router } from 'express'

// The routers pull in the auth module, which refuses to load without the JWT secrets. They are set before
// the routers are imported for the same reason the server sets them from its environment.
process.env.JWT_SECRET ??= 'route-gate-test-secret'
process.env.JWT_REFRESH_SECRET ??= 'route-gate-test-refresh-secret'

const { adminRouter } = await import('./admin.routes.js')
const { paymentRouter } = await import('../payments/payment.routes.js')
const { reportsRouter } = await import('../reports/report.routes.js')
const { notificationsRouter } = await import('../notifications/notification.routes.js')

/**
 * The gate on every moderator-facing endpoint, asserted against the routers themselves.
 *
 * These tests do not touch the database: they call the middleware the router actually registered for each
 * path and check what it does with a request whose resolved permissions are known. A route that lost its
 * permission gate — or that was left gated by a role name instead — fails here, which is what keeps
 * "the moderator can see the menu item" from quietly becoming "the moderator can call the endpoint".
 */

interface GateCase {
  what: string
  router: Router
  method: 'get' | 'post' | 'patch' | 'delete'
  path: string
  permission: string
}

const GATE_CASES: GateCase[] = [
  { what: 'payment records', router: paymentRouter, method: 'get', path: '/', permission: 'admin.payments.view' },
  { what: 'manual review queue', router: paymentRouter, method: 'get', path: '/manual-verification', permission: 'admin.payments.review' },
  { what: 'manual review decision', router: paymentRouter, method: 'patch', path: '/manual-verification/:id', permission: 'admin.payments.review' },
  { what: 'premium members', router: paymentRouter, method: 'get', path: '/premium-members', permission: 'admin.premium.view' },
  { what: 'report queue', router: reportsRouter, method: 'get', path: '/admin', permission: 'admin.reports.manage' },
  { what: 'report detail with history', router: reportsRouter, method: 'get', path: '/admin/:id', permission: 'admin.reports.manage' },
  { what: 'report action', router: reportsRouter, method: 'patch', path: '/:id/status', permission: 'admin.reports.manage' },
  { what: 'push campaign', router: notificationsRouter, method: 'post', path: '/broadcast', permission: 'admin.push.send' },
  { what: 'moderation summary', router: adminRouter, method: 'get', path: '/moderation/summary', permission: 'admin.activity.view' },
  { what: 'moderation activity', router: adminRouter, method: 'get', path: '/moderation/activity', permission: 'admin.activity.view' },
  { what: 'session activity', router: adminRouter, method: 'get', path: '/moderation/sessions', permission: 'admin.activity.view' },
  { what: 'audit filter vocabulary', router: adminRouter, method: 'get', path: '/moderation/audit-options', permission: 'admin.activity.view' },
  { what: 'push audience preview', router: adminRouter, method: 'get', path: '/moderation/push-audience', permission: 'admin.push.send' },
  { what: 'sendable email templates', router: adminRouter, method: 'get', path: '/email-templates/sendable', permission: 'admin.email.send' },
  { what: 'email campaign audiences', router: adminRouter, method: 'get', path: '/email-templates/campaign-audiences', permission: 'admin.email.send' },
  { what: 'email campaign send', router: adminRouter, method: 'post', path: '/email-templates/:id/send', permission: 'admin.email.send' },
  { what: 'dashboard statistics', router: adminRouter, method: 'get', path: '/dashboard/stats', permission: 'admin.dashboard.view' },
  { what: 'user administration', router: adminRouter, method: 'get', path: '/permissions', permission: 'admin.users.manage' },
  { what: 'platform settings', router: adminRouter, method: 'get', path: '/settings', permission: 'admin.settings.manage' },
]

/** Routes that are mounted rather than registered, so their gate lives on the mount. */
const MOUNT_GATE_CASES: Array<{ what: string; path: string; permission: string }> = [
  { what: 'email template administration', path: '/email-templates', permission: 'admin.content.manage' },
  { what: 'popup administration', path: '/popups', permission: 'admin.content.manage' },
  { what: 'advertisement administration', path: '/advertisements', permission: 'admin.content.manage' },
]

interface StackLayer {
  route?: {
    path: string
    methods: Record<string, boolean>
    stack: Array<{ handle: (req: unknown, res: unknown, next: NextFunction) => unknown }>
  }
}

/**
 * Middleware that only establishes identity, not authority.
 *
 * Authentication is applied once by the mount that owns the router, and a request that never
 * authenticated would be refused before any gate here. Skipping it means these tests answer the question
 * that matters: does the route itself require the permission, for a request whose identity is already
 * known?
 */
const IDENTITY_MIDDLEWARE = new Set(['authenticate', 'optionalProtect'])

/** The authorization middleware express would run for that method and path. */
function middlewareChain(router: Router, method: string, path: string) {
  const layers = (router as unknown as { stack: StackLayer[] }).stack
  const layer = layers.find((candidate) => (
    candidate.route
    && candidate.route.path === path
    && candidate.route.methods[method] === true
  ))

  assert.ok(layer?.route, `no ${method.toUpperCase()} ${path} route is registered`)
  return layer.route.stack
    .map((entry) => entry.handle)
    .filter((handle) => !IDENTITY_MIDDLEWARE.has(handle.name))
}

/**
 * Runs the chain until a middleware passes the request on.
 *
 * Reaching the controller is not necessary and not desirable here: the question is only whether the gates
 * before it accept or refuse, so the first clean `next()` ends the walk.
 */
async function runGates(router: Router, method: string, path: string, permissions: string[]) {
  const req = {
    user: { id: 'staff-1', fullName: 'Staff', roles: ['moderator'], permissions },
    query: {},
    params: {},
    body: {},
    headers: {},
  }
  const res = { status: () => res, json: () => res, cookie: () => res, clearCookie: () => res, setHeader: () => res, getHeader: () => undefined }
  let refusal: unknown = null

  for (const handle of middlewareChain(router, method, path)) {
    let decided = false
    await new Promise<void>((resolve) => {
      const next: NextFunction = ((error?: unknown) => {
        decided = true
        if (error) refusal = error
        resolve()
      }) as NextFunction
      const outcome = handle(req, res, next)
      if (outcome && typeof (outcome as Promise<unknown>).then === 'function') {
        void (outcome as Promise<unknown>).then(() => {
          if (!decided) resolve()
        })
      } else if (!decided) {
        // A handler that neither refuses nor continues is not a gate; stop at the first that continues.
        resolve()
      }
    })

    if (refusal) return refusal
    if (decided) return null
  }

  return null
}

test('every moderator-facing endpoint refuses a request that does not hold its permission', async () => {
  for (const gateCase of GATE_CASES) {
    // A moderator role on its own is not an authorization: the permission is what the route asks for.
    const refusal = await runGates(gateCase.router, gateCase.method, gateCase.path, [])

    assert.ok(refusal, `${gateCase.what} accepted a request with no permissions at all`)
    assert.equal(
      (refusal as { statusCode?: number }).statusCode,
      403,
      `${gateCase.what} must refuse with 403, got ${String(refusal)}`,
    )
  }
})

test('every moderator-facing endpoint admits a request that holds exactly its permission', async () => {
  for (const gateCase of GATE_CASES) {
    const refusal = await runGates(gateCase.router, gateCase.method, gateCase.path, [gateCase.permission])

    assert.equal(
      refusal,
      null,
      `${gateCase.what} refused a request holding ${gateCase.permission}: ${String(refusal)}`,
    )
  }
})

test('one permission does not open another endpoint', async () => {
  const crossed: Array<[GateCase, string]> = [
    [GATE_CASES.find((entry) => entry.what === 'report queue')!, 'admin.payments.review'],
    [GATE_CASES.find((entry) => entry.what === 'manual review decision')!, 'admin.payments.view'],
    [GATE_CASES.find((entry) => entry.what === 'premium members')!, 'admin.payments.view'],
    [GATE_CASES.find((entry) => entry.what === 'push campaign')!, 'admin.email.send'],
    [GATE_CASES.find((entry) => entry.what === 'moderation activity')!, 'admin.reports.manage'],
    [GATE_CASES.find((entry) => entry.what === 'email campaign send')!, 'admin.push.send'],
  ]

  for (const [gateCase, wrongPermission] of crossed) {
    const refusal = await runGates(gateCase.router, gateCase.method, gateCase.path, [wrongPermission])

    assert.ok(refusal, `${gateCase.what} accepted the unrelated permission ${wrongPermission}`)
    assert.equal(
      (refusal as { statusCode?: number }).statusCode,
      403,
      `${gateCase.what} must refuse the unrelated permission ${wrongPermission}`,
    )
  }
})

test('no moderator-facing endpoint is gated by a role name alone', async () => {
  for (const gateCase of GATE_CASES) {
    // Holding the moderator role with no permissions must never be enough for any of these paths.
    const refusal = await runGates(gateCase.router, gateCase.method, gateCase.path, [])

    assert.equal(
      (refusal as { statusCode?: number } | null)?.statusCode,
      403,
      `${gateCase.what} is reachable by role alone`,
    )
  }
})

/**
 * Sends a request through the router itself, which is the closest thing to a direct API call these tests
 * can make without a database: express runs the real mount gates and route gates in their real order.
 *
 * A request that is refused stops at the gate. A request that is *not* refused would continue into a
 * controller and fail on the missing database, which is exactly what the assertions look for.
 */
async function requestThroughRouter(method: string, url: string, permissions: string[]) {
  const req = {
    method,
    url,
    originalUrl: url,
    user: { id: 'staff-1', fullName: 'Staff', roles: ['moderator'], permissions },
    query: {},
    params: {},
    body: {},
    headers: {},
    cookies: {},
    get: () => undefined,
    ip: '127.0.0.1',
  }
  const res = {
    status: () => res,
    json: () => res,
    send: () => res,
    end: () => res,
    cookie: () => res,
    clearCookie: () => res,
    setHeader: () => res,
    getHeader: () => undefined,
  }

  return new Promise<unknown>((resolve) => {
    const timer = setTimeout(() => resolve(null), 3000)
    const next: NextFunction = ((error?: unknown) => {
      clearTimeout(timer)
      resolve(error ?? null)
    }) as NextFunction

    try {
      // `handle` is the router's request entry point; it is typed only through the internal definition.
      void (adminRouter as unknown as { handle: (req: unknown, res: unknown, next: NextFunction) => void })
        .handle(req, res, next)
    } catch (error) {
      clearTimeout(timer)
      resolve(error)
    }
  })
}

test('the content mounts keep content administration out of a moderator’s reach', async () => {
  for (const mount of MOUNT_GATE_CASES) {
    const refusal = await requestThroughRouter('GET', mount.path, [])

    assert.equal(
      (refusal as { statusCode?: number } | null)?.statusCode,
      403,
      `${mount.what} is reachable without ${mount.permission}`,
    )
  }
})

test('a request with the reported permissions reaches the controller the route belongs to', async () => {
  // With the permission held, the mount gate lets the request through: what answers afterwards is the
  // controller (and, in this environment, its database error), not a 403 from the gate.
  const outcome = await requestThroughRouter('GET', '/moderation/summary', ['admin.activity.view'])

  assert.notEqual(
    (outcome as { statusCode?: number } | null)?.statusCode,
    403,
    'holding the permission must not be refused by the gate',
  )
})
