import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { NextFunction, Router } from 'express'

process.env.JWT_SECRET ??= 'banner-routes-test-secret'
process.env.JWT_REFRESH_SECRET ??= 'banner-routes-test-refresh-secret'

const { adminBannersRouter, publicBannersRouter } = await import('./banner.routes.js')

/**
 * The banner authorization boundary, asserted against the routers that are actually mounted:
 * `publicBannersRouter` under `/api/v1/banners` and `adminBannersRouter` under `/api/v1/admin/banners`.
 *
 * The admin router carries the permission gate on the mount, so it applies to the router's own middleware
 * chain rather than to each route — a walk of that chain is what proves it.
 */

interface StackLayer {
  name?: string
  handle?: (req: unknown, res: unknown, next: NextFunction) => unknown
  route?: { path: string; methods: Record<string, boolean>; stack: Array<{ handle: (req: unknown, res: unknown, next: NextFunction) => unknown }> }
}

/** Middleware that only establishes identity; the permission gate is what these tests exercise. */
const IDENTITY_MIDDLEWARE = new Set(['authenticate', 'optionalProtect'])

async function runGate(handle: (req: unknown, res: unknown, next: NextFunction) => unknown, user?: { roles: string[]; permissions: string[] }) {
  const req = { user: user ? { id: 'actor-1', fullName: 'Actor', ...user } : undefined, query: {}, params: {}, body: {}, headers: {} }
  const res = { status: () => res, json: () => res, cookie: () => res, clearCookie: () => res, setHeader: () => res, getHeader: () => undefined }

  let refusal: unknown = null
  await new Promise<void>((resolve) => {
    const next: NextFunction = ((error?: unknown) => {
      if (error) refusal = error
      resolve()
    }) as NextFunction
    const outcome = handle(req, res, next)
    if (outcome && typeof (outcome as Promise<unknown>).then === 'function') {
      void (outcome as Promise<unknown>).then(() => resolve())
    }
  })
  return refusal
}

const fromRouterLevel = (router: Router) => ((router as unknown as { stack: StackLayer[] }).stack)
  .filter((layer) => !layer.route && typeof layer.handle === 'function')
  .map((layer) => layer.handle as (req: unknown, res: unknown, next: NextFunction) => unknown)
  .filter((handle) => !IDENTITY_MIDDLEWARE.has(handle.name))

test('the public feed exposes only the active-banner read', () => {
  const routes = ((publicBannersRouter as unknown as { stack: StackLayer[] }).stack)
    .filter((layer): layer is StackLayer & { route: NonNullable<StackLayer['route']> } => Boolean(layer.route))
    .map((layer) => `${Object.keys(layer.route.methods).join(',')} ${layer.route.path}`)

  assert.deepEqual(routes, ['get /active'], 'nothing may write through the public banner router')
})

test('every admin banner operation is gated by the banners permission', async () => {
  const gates = fromRouterLevel(adminBannersRouter as unknown as Router)
  assert.ok(gates.length > 0, 'the admin banner router must carry its authorization gate')

  for (const gate of gates) {
    const anonymous = await runGate(gate)
    assert.ok(anonymous, 'an unauthenticated request must be refused')
    assert.equal((anonymous as { statusCode?: number }).statusCode, 401)

    const withoutPermission = await runGate(gate, { roles: ['admin'], permissions: [] })
    assert.ok(withoutPermission, 'an administrator without admin.banners.manage must be refused')
    assert.equal((withoutPermission as { statusCode?: number }).statusCode, 403)

    const unrelated = await runGate(gate, { roles: ['admin'], permissions: ['admin.streams.manage'] })
    assert.ok(unrelated, 'an unrelated permission must not open banner management')

    const permitted = await runGate(gate, { roles: ['admin'], permissions: ['admin.banners.manage'] })
    assert.equal(permitted, null, 'an administrator holding admin.banners.manage must be admitted')

    const permittedSuperAdmin = await runGate(gate, { roles: ['super_admin'], permissions: ['admin.banners.manage'] })
    assert.equal(permittedSuperAdmin, null)
  }
})

test('the admin banner router keeps every management route, including reordering', () => {
  const routes = ((adminBannersRouter as unknown as { stack: StackLayer[] }).stack)
    .filter((layer): layer is StackLayer & { route: NonNullable<StackLayer['route']> } => Boolean(layer.route))
    .map((layer) => `${Object.keys(layer.route.methods).join(',')} ${layer.route.path}`)

  assert.deepEqual(routes.sort(), [
    'delete /:id',
    'get /',
    'patch /:id',
    'patch /reorder',
    'post /',
  ])
})
