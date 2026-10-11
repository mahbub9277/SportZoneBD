import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { NextFunction, Router } from 'express'

process.env.JWT_SECRET ??= 'automation-route-test-secret'
process.env.JWT_REFRESH_SECRET ??= 'automation-route-test-refresh-secret'

const automationRouter = (await import('./automation.routes.js')).default
const { hasDedicatedSettingEndpoint } = await import('../admin/settings.controller.js')

/**
 * Who may read and change the two master switches, asserted against the router that serves them.
 *
 * The chain is walked exactly as express would run it for the request: the router-level role gate first,
 * then the permission gate the endpoint registered. A route that lost either gate fails here.
 */

interface StackLayer {
  name?: string
  handle?: (req: unknown, res: unknown, next: NextFunction) => unknown
  route?: {
    path: string
    methods: Record<string, boolean>
    stack: Array<{ handle: (req: unknown, res: unknown, next: NextFunction) => unknown }>
  }
}

const IDENTITY_MIDDLEWARE = new Set(['authenticate', 'optionalProtect'])

/**
 * The middleware express would run for that request, in order: the router-level gates first, then the
 * handlers the matched route registered.
 */
function middlewareChain(router: Router, method: string, path: string) {
  const layers = (router as unknown as { stack: StackLayer[] }).stack
  const routeIndex = layers.findIndex((candidate) => (
    candidate.route
    && candidate.route.path === path
    && candidate.route.methods[method] === true
  ))

  assert.ok(routeIndex >= 0, `no ${method.toUpperCase()} ${path} route is registered`)

  const routerLevel = layers
    .slice(0, routeIndex)
    .filter((layer) => !layer.route && typeof layer.handle === 'function')
    .map((layer) => layer.handle as (req: unknown, res: unknown, next: NextFunction) => unknown)

  const routeLevel = layers[routeIndex].route!.stack.map((entry) => entry.handle)
  // The controller is registered last on every route in this router, and it is not a gate: walking into it
  // would test the handler's own request validation instead of the authorization in front of it.
  const gates = routeLevel.slice(0, -1)

  return [...routerLevel, ...gates].filter((handle) => !IDENTITY_MIDDLEWARE.has(handle.name))
}

async function runGates(method: string, path: string, user: { roles: string[]; permissions: string[] }) {
  const req = { user: { id: 'actor-1', fullName: 'Actor', ...user }, query: {}, params: {}, body: {}, headers: {} }
  const res = {
    status: () => res,
    json: () => res,
    cookie: () => res,
    clearCookie: () => res,
    setHeader: () => res,
    getHeader: () => undefined,
  }

  // Only the gates are interesting: the walk stops at the first middleware that refuses, and it keeps
  // going through the ones that pass the request on (the router gate, then the endpoint's gate).
  for (const handle of middlewareChain(automationRouter as unknown as Router, method, path)) {
    let decided = false
    let refusal: unknown = null
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
        resolve()
      }
    })

    if (refusal) return refusal
    if (!decided) return null
  }

  return null
}

const SWITCH_ENDPOINTS: Array<{ method: 'get' | 'patch'; path: string }> = [
  { method: 'get', path: '/push-notifications' },
  { method: 'patch', path: '/push-notifications' },
  { method: 'get', path: '/match-creation' },
  { method: 'patch', path: '/match-creation' },
]

test('an administrator without the settings permission cannot read or change either switch', async () => {
  for (const endpoint of SWITCH_ENDPOINTS) {
    const refusal = await runGates(endpoint.method, endpoint.path, { roles: ['admin'], permissions: [] })

    assert.ok(refusal, `${endpoint.method.toUpperCase()} ${endpoint.path} accepted an administrator with no permissions`)
    assert.equal((refusal as { statusCode?: number }).statusCode, 403)
  }
})

test('an unrelated permission does not open a switch endpoint', async () => {
  for (const endpoint of SWITCH_ENDPOINTS) {
    const refusal = await runGates(endpoint.method, endpoint.path, {
      roles: ['admin'],
      permissions: ['admin.matches.manage', 'admin.push.send'],
    })

    assert.ok(refusal, `${endpoint.method.toUpperCase()} ${endpoint.path} accepted an unrelated permission`)
    assert.equal((refusal as { statusCode?: number }).statusCode, 403)
  }
})

test('the settings permission opens exactly the switch endpoints', async () => {
  for (const endpoint of SWITCH_ENDPOINTS) {
    const refusal = await runGates(endpoint.method, endpoint.path, {
      roles: ['admin'],
      permissions: ['admin.settings.manage'],
    })

    assert.equal(refusal, null, `${endpoint.method.toUpperCase()} ${endpoint.path} refused admin.settings.manage: ${String(refusal)}`)
  }
})

test('a moderator cannot reach them even holding the permission', async () => {
  for (const endpoint of SWITCH_ENDPOINTS) {
    const refusal = await runGates(endpoint.method, endpoint.path, {
      roles: ['moderator'],
      permissions: ['admin.settings.manage'],
    })

    assert.ok(refusal, `${endpoint.method.toUpperCase()} ${endpoint.path} admitted a moderator role`)
    assert.equal((refusal as { statusCode?: number }).statusCode, 403)
  }
})

test('the switch settings can only be written through their own endpoints', () => {
  for (const settingKey of ['automation.pushNotifications.enabled', 'automation.matchCreation.enabled']) {
    assert.equal(hasDedicatedSettingEndpoint(settingKey), true, `${settingKey} would be writable through the generic settings endpoint`)
  }
  assert.equal(hasDedicatedSettingEndpoint('api.base_url'), false)
})
