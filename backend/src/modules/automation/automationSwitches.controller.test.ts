import assert from 'node:assert/strict'
import { test } from 'node:test'

process.env.JWT_SECRET ??= 'automation-controller-test-secret'
process.env.JWT_REFRESH_SECRET ??= 'automation-controller-test-refresh-secret'
// The switch endpoints must never need Redis, and these tests must never reach a real queue.
delete process.env.REDIS_URL
delete process.env.REDIS_URL_PRIMARY
// An unreachable database is deliberate: the "cannot confirm" and "cannot persist" paths are the ones that
// must be reported honestly rather than assumed to have succeeded.
process.env.DATABASE_URL = 'postgresql://controller:none@127.0.0.1:1/none'

const { setAutomationSwitchReader, getAppliedAutomationSwitch } = await import('../../core/automationSwitches.js')
const {
  getMatchCreationStatus,
  getPushAutomationStatus,
  updatePushAutomationStatus,
} = await import('./automationSwitches.controller.js')

const ACTOR = { id: 'admin-1', fullName: 'Admin' }

interface CapturedResponse {
  statusCode: number
  body: { success?: boolean; message?: string; data?: Record<string, unknown> } | null
  refusal: unknown
}

function createResponder(): { req: unknown; res: unknown; captured: CapturedResponse } {
  const captured: CapturedResponse = { statusCode: 200, body: null, refusal: null }
  const res: Record<string, unknown> = {
    status(code: number) {
      captured.statusCode = code
      return res
    },
    json(payload: CapturedResponse['body']) {
      captured.body = payload
      return res
    },
  }
  const req = { user: ACTOR, body: { enabled: false }, headers: {}, query: {}, params: {} }
  return { req, res, captured }
}

/**
 * Runs one controller exactly as express would: `asyncHandler` forwards a rejection to `next`, which is
 * where the global error handler would turn it into a status code, so the refusal is captured here.
 */
async function runHandler(handler: unknown, body?: unknown) {
  const { req, res, captured } = createResponder()
  if (body !== undefined) (req as { body: unknown }).body = body

  const outcome = (handler as (req: unknown, res: unknown, next: unknown) => unknown)(
    req,
    res,
    (error?: unknown) => {
      if (error) captured.refusal = error
    },
  )

  if (outcome && typeof (outcome as Promise<unknown>).then === 'function') {
    await (outcome as Promise<unknown>).catch((error) => {
      captured.refusal = error
    })
  }

  // `asyncHandler` returns void and settles through next(), so the outcome is awaited by observation: the
  // controller is done once it either answered or forwarded a refusal.
  const deadline = Date.now() + 12_000
  while (!captured.body && !captured.refusal && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10))
  }

  return captured
}

test.afterEach(() => {
  setAutomationSwitchReader(null)
})

test('the status endpoint reports an unconfirmable value as unavailable, not as off or on', async () => {
  const captured = await runHandler(getPushAutomationStatus)

  assert.equal(captured.statusCode, 200)
  const data = captured.body?.data as Record<string, unknown>
  assert.equal(data.desired, null)
  assert.equal(data.operational, false)
  assert.equal(data.degraded, true)
  assert.equal(data.transition, 'unavailable')
  assert.match(String(data.degradedReason), /automation\.pushNotifications\.enabled/)
  assert.equal(data.instancesConfirmed, 'this-instance-only')
  assert.ok(Array.isArray(data.dependencies) && data.dependencies.length > 0, 'the operational dependencies are reported next to the value')
  assert.ok(Array.isArray(data.notes) && data.notes.length > 0)
})

test('a disabled switch is reported as applied, even when a dependency is missing', async () => {
  setAutomationSwitchReader({ read: async () => 'false' })
  const captured = await runHandler(getMatchCreationStatus)

  const data = captured.body?.data as Record<string, unknown>
  assert.equal(data.desired, false)
  assert.equal(data.operational, false)
  assert.equal(data.transition, 'applied', 'turning something off is always fully applied')
  assert.equal(data.previousValue, undefined, 'only an update reports the value it replaced')
  const dependencies = data.dependencies as Array<{ ok: boolean; name: string }>
  assert.ok(dependencies.some((dependency) => dependency.name === 'scheduler'))
})

test('an enabled switch with a missing dependency is reported as degraded, not as ready', async () => {
  setAutomationSwitchReader({ read: async () => 'true' })
  // No football-data key and no Redis in this process, so the automatic pipeline cannot do useful work.
  const captured = await runHandler(getMatchCreationStatus)

  const data = captured.body?.data as Record<string, unknown>
  assert.equal(data.desired, true)
  assert.equal(data.transition, 'degraded')
  const dependencies = data.dependencies as Array<{ ok: boolean; detail: string }>
  assert.ok(dependencies.some((dependency) => !dependency.ok && /FOOTBALL_API_KEY|Redis/.test(dependency.detail)))
})

test('a write that cannot be persisted reports 503 and applies nothing', async () => {
  const captured = await runHandler(updatePushAutomationStatus, { enabled: false })
  const refusal = captured.refusal as { statusCode?: number; message?: string } | null

  assert.ok(refusal, 'the endpoint must not report success when the value could not be stored')
  assert.equal(refusal.statusCode, 503)
  assert.match(String(refusal.message), /could not be persisted/)
  assert.equal(getAppliedAutomationSwitch('pushNotifications'), false, 'nothing is applied to the running process')
})

test('a malformed body is refused before anything is written', async () => {
  const captured = await runHandler(updatePushAutomationStatus, { enabled: 'yes' })

  assert.ok(captured.refusal, 'a non-boolean value must be refused')
  assert.equal((captured.refusal as { name?: string }).name, 'ZodError')
})
