import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { NextFunction, Router } from 'express'

process.env.JWT_SECRET ??= 'automation-retention-route-test-secret'
process.env.JWT_REFRESH_SECRET ??= 'automation-retention-route-test-refresh-secret'

const automationRouter = (await import('./automation.routes.js')).default
const { isAutomationLogCleanupRunning } = await import('../../services/automationLogRetention.js')

/**
 * Authorization and routing for the destructive retention endpoint.
 *
 * Two questions are answered here, both against the router the application actually mounts:
 *  - who may call it (the router's admin/super-admin role gate *and* `admin.settings.manage`), and
 *  - how a request reaches it, because `DELETE /logs/retention` must never be handled by `DELETE /logs/:id`.
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
  // The controller is registered last and is not a gate: walking into it would exercise the handler instead
  // of the authorization in front of it.
  const gates = routeLevel.slice(0, -1)

  return [...routerLevel, ...gates].filter((handle) => !IDENTITY_MIDDLEWARE.has(handle.name))
}

async function runGates(user: { roles: string[]; permissions: string[] }) {
  const req = { user: { id: 'actor-1', fullName: 'Actor', ...user }, query: {}, params: {}, body: {}, headers: {} }
  const res = {
    status: () => res,
    json: () => res,
    cookie: () => res,
    clearCookie: () => res,
    setHeader: () => res,
    getHeader: () => undefined,
  }

  for (const handle of middlewareChain(automationRouter as unknown as Router, 'delete', '/logs/retention')) {
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

test('the retention endpoint requires the settings permission', async () => {
  const refusal = await runGates({ roles: ['admin'], permissions: [] })

  assert.ok(refusal, 'an administrator without admin.settings.manage must not be able to delete logs')
  assert.equal((refusal as { statusCode?: number }).statusCode, 403)
})

test('an unrelated permission does not open the retention endpoint', async () => {
  const refusal = await runGates({ roles: ['admin'], permissions: ['admin.matches.manage', 'admin.streams.manage'] })

  assert.ok(refusal)
  assert.equal((refusal as { statusCode?: number }).statusCode, 403)
})

test('an administrator holding the settings permission is admitted', async () => {
  for (const role of ['admin', 'super_admin']) {
    const refusal = await runGates({ roles: [role], permissions: ['admin.settings.manage'] })
    assert.equal(refusal, null, `${role} with admin.settings.manage was refused: ${String(refusal)}`)
  }
})

test('a moderator is refused even holding the settings permission', async () => {
  const refusal = await runGates({ roles: ['moderator'], permissions: ['admin.settings.manage'] })

  assert.ok(refusal, 'the router role gate must keep moderators out of destructive automation operations')
  assert.equal((refusal as { statusCode?: number }).statusCode, 403)
})

test('a user with no roles is refused', async () => {
  const refusal = await runGates({ roles: [], permissions: ['admin.settings.manage'] })

  assert.ok(refusal)
  assert.equal((refusal as { statusCode?: number }).statusCode, 403)
})

test('the retention route is registered before the per-log route', () => {
  const layers = (automationRouter as unknown as { stack: StackLayer[] }).stack
  const indexOf = (path: string) => layers.findIndex((layer) => layer.route?.path === path && layer.route.methods.delete === true)
  const retentionIndex = indexOf('/logs/retention')
  const perLogIndex = indexOf('/logs/:id')

  assert.ok(retentionIndex >= 0, 'DELETE /logs/retention must be registered')
  assert.ok(perLogIndex >= 0, 'DELETE /logs/:id must still be registered')
  assert.ok(retentionIndex < perLogIndex, '`/logs/:id` would otherwise capture the `retention` path segment')
})

/**
 * Drives a request through the real router, exactly as express would.
 *
 * The database is replaced with an in-memory stand-in for the two delegates the handler touches, so nothing
 * leaves this process. The answer is collected by polling, because the router's gates are async.
 */
async function dispatchDelete(url: string, user: { roles: string[]; permissions: string[] }) {
  const { prisma } = await import('../../core/prisma.js')
  const originalLog = prisma.automationLog
  const originalSystemLog = prisma.systemLog

  const calls: { findMany: number; deleteMany: number; delete: number; count: number; audits: Array<Record<string, unknown>> } = {
    findMany: 0, deleteMany: 0, delete: 0, count: 0, audits: [],
  }
  const old = [
    { id: '6a1f4e43-0e0f-4a5b-9c43-0f2f0f1d6c11', createdAt: new Date(Date.now() - 45 * 24 * 60 * 60 * 1000) },
  ]

  try {
    ;(prisma as { automationLog: unknown }).automationLog = {
      findMany: async (args: { take: number }) => {
        calls.findMany += 1
        return old.slice(0, args.take).map((row) => ({ id: row.id }))
      },
      deleteMany: async () => {
        calls.deleteMany += 1
        const count = old.length
        old.length = 0
        return { count }
      },
      delete: async ({ where }: { where: { id: string } }) => {
        calls.delete += 1
        return { id: where.id }
      },
      count: async () => {
        calls.count += 1
        return old.length
      },
    }
    ;(prisma as { systemLog: unknown }).systemLog = {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        calls.audits.push(data)
        return data
      },
    }

    const req = {
      method: 'DELETE',
      url,
      originalUrl: url,
      baseUrl: '',
      user: { id: 'actor-1', fullName: 'Actor', ...user },
      query: {},
      params: {},
      body: {},
      headers: {},
      cookies: {},
      get: () => undefined,
      ip: '127.0.0.1',
    }

    const captured: { status: number; body: unknown; ended: boolean; refusal: unknown } = {
      status: 200, body: null, ended: false, refusal: null,
    }
    const res = {
      statusCode: 200,
      status(code: number) {
        captured.status = code
        this.statusCode = code
        return res
      },
      json(payload: unknown) {
        captured.body = payload
        return res
      },
      send(payload?: unknown) {
        if (payload !== undefined) captured.body = payload
        captured.ended = true
        return res
      },
      end() {
        captured.ended = true
        return res
      },
      setHeader: () => res,
      getHeader: () => undefined,
      once: () => res,
      off: () => res,
      on: () => res,
      removeListener: () => res,
    }

    let settled = false
    const next: NextFunction = ((error?: unknown) => {
      settled = true
      if (error) captured.refusal = error
    }) as NextFunction

    ;(automationRouter as unknown as { handle: (req: unknown, res: unknown, next: NextFunction) => void })
      .handle(req, res, next)

    const deadline = Date.now() + 5000
    while (captured.body === null && !captured.ended && captured.refusal === null && !settled && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10))
    }

    return { captured, calls }
  } finally {
    ;(prisma as { automationLog: unknown }).automationLog = originalLog
    ;(prisma as { systemLog: unknown }).systemLog = originalSystemLog
  }
}

test('DELETE /logs/retention is handled by the retention operation, not by the per-log delete', async () => {
  const { captured, calls } = await dispatchDelete('/logs/retention', {
    roles: ['admin'],
    permissions: ['admin.settings.manage'],
  })

  assert.equal(captured.refusal, null, `the request was refused: ${String(captured.refusal)}`)
  assert.equal(captured.status, 200)
  assert.equal(calls.delete, 0, '`retention` must never be used as a log id')
  assert.ok(calls.deleteMany > 0, 'the retention operation must run')

  const body = captured.body as { success: boolean; data: Record<string, unknown>; message: string }
  assert.equal(body.success, true)
  assert.deepEqual(Object.keys(body.data).sort(), [
    'batchSize', 'batches', 'complete', 'cutoff', 'deletedCount', 'maxPerRequest', 'remainingCount', 'retentionDays',
  ])
  assert.equal(body.data.deletedCount, 1)
  assert.equal(body.data.remainingCount, 0)
  assert.equal(body.data.complete, true)
  assert.match(String(body.data.cutoff), /^\d{4}-\d{2}-\d{2}T/)
  assert.equal(isAutomationLogCleanupRunning(), false)

  assert.equal(calls.audits.length, 1, 'the administrator action must be recorded in the audit log')
  assert.match(String(calls.audits[0].message), /retention window deleted/i)
  const meta = calls.audits[0].meta as Record<string, unknown>
  assert.equal(meta.deletedCount, 1)
  assert.equal(meta.actorId, 'actor-1')
})

test('a per-log delete still reaches the per-log handler', async () => {
  const { captured, calls } = await dispatchDelete('/logs/6a1f4e43-0e0f-4a5b-9c43-0f2f0f1d6c11', {
    roles: ['admin'],
    permissions: [],
  })

  assert.equal(captured.refusal, null, `the request was refused: ${String(captured.refusal)}`)
  assert.equal(captured.ended, true)
  assert.equal(calls.delete, 1, 'the per-log route must still delete exactly one row')
  assert.equal(calls.deleteMany, 0, 'the retention operation must not run for a single id')
})

test('a refusal from the router reaches the error handler instead of running the cleanup', async () => {
  const { captured, calls } = await dispatchDelete('/logs/retention', { roles: ['admin'], permissions: [] })

  assert.ok(captured.refusal, 'a request without admin.settings.manage must be refused')
  assert.equal((captured.refusal as { statusCode?: number }).statusCode, 403)
  assert.equal(calls.deleteMany, 0, 'nothing may be deleted by a refused request')
})
