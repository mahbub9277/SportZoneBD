import assert from 'node:assert/strict'
import { test } from 'node:test'

process.env.JWT_SECRET ??= 'stream-relay-controller-test-secret'
process.env.JWT_REFRESH_SECRET ??= 'stream-relay-controller-test-refresh-secret'
// The switch endpoints must never need Redis.
delete process.env.REDIS_URL
delete process.env.REDIS_URL_PRIMARY

const {
  STREAM_RELAY_SETTING_KEY,
  confirmStreamRelaySwitch,
  getAppliedStreamRelaySwitch,
  invalidateStreamRelaySwitchCache,
  setStreamRelaySwitchReader,
} = await import('../../core/streamRelaySwitch.js')
const { streamRelayController } = await import('./streamRelay.controller.js')
const { settingsController } = await import('./settings.controller.js')

const ACTOR = { id: 'admin-1', fullName: 'Admin' }

interface CapturedResponse {
  statusCode: number
  body: { success?: boolean; message?: string; data?: Record<string, unknown> } | null
  refusal: unknown
}

/**
 * Runs one controller exactly as express would: `asyncHandler` forwards a rejection to `next`, which is
 * where the global error handler would turn it into a status code, so the refusal is captured here.
 */
async function runHandler(handler: unknown, body?: unknown) {
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
  const req = { user: ACTOR, body, headers: {}, query: {}, params: {}, id: 'req-1' }

  try {
    const outcome = (handler as (req: unknown, res: unknown, next: unknown) => unknown)(req, res, (error?: unknown) => {
      if (error) captured.refusal = error
    })
    if (outcome && typeof (outcome as Promise<unknown>).then === 'function') {
      await (outcome as Promise<unknown>).catch((error) => {
        captured.refusal = error
      })
    }
    // `asyncHandler` settles through next(), so the run is awaited by observation.
    const deadline = Date.now() + 3000
    while (!captured.body && !captured.refusal && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
  } catch (error) {
    captured.refusal = error
  }

  return captured
}

/** Replaces the database the switch persists through, so the write path can be tested without one. */
async function withDatabase(
  database: {
    existing?: string | null
    failOnWrite?: boolean
  },
  assertion: (written: Array<Record<string, unknown>>) => Promise<void>,
) {
  const { prisma } = await import('../../core/prisma.js')
  const originalTransaction = prisma.$transaction
  const written: Array<Record<string, unknown>> = []

  const transactionClient = {
    setting: {
      findUnique: async () => (database.existing === undefined ? null : { value: database.existing, deletedAt: null }),
      upsert: async (args: { create: Record<string, unknown>; update: Record<string, unknown> }) => {
        if (database.failOnWrite) throw Object.assign(new Error('connection refused'), { code: 'P1001' })
        written.push({ op: 'upsert', ...args })
        return args.create
      },
    },
    systemLog: {
      create: async (args: { data: Record<string, unknown> }) => {
        written.push({ op: 'audit', ...args.data })
        return args.data
      },
    },
  }

  try {
    ;(prisma as { $transaction: unknown }).$transaction = async (operation: unknown) => {
      if (typeof operation === 'function') {
        return (operation as (tx: unknown) => Promise<unknown>)(transactionClient)
      }
      throw new Error('unsupported transaction form in this test')
    }
    await assertion(written)
  } finally {
    ;(prisma as { $transaction: unknown }).$transaction = originalTransaction
  }
}

test.afterEach(() => {
  setStreamRelaySwitchReader(null)
  invalidateStreamRelaySwitchCache()
})

test('the status endpoint reports what this instance enforces, with the fields the console reads', async () => {
  setStreamRelaySwitchReader({ read: async () => 'true' })
  // The console reads whatever this instance last confirmed; the confirmation itself happens at the
  // boundaries that use the relay.
  await confirmStreamRelaySwitch()

  const captured = await runHandler(streamRelayController.getStreamRelaySetting)
  const data = captured.body?.data as Record<string, unknown>

  assert.equal(captured.statusCode, 200)
  assert.equal(data.settingKey, STREAM_RELAY_SETTING_KEY)
  assert.equal(typeof data.label, 'string')
  assert.equal(typeof data.description, 'string')
  assert.equal(data.desired, true)
  assert.equal(data.operational, true)
  assert.equal(data.degraded, false)
  assert.equal(data.instancesConfirmed, 'this-instance-only')
  assert.equal(data.activeRelayRequests, 0)
})

test('a status that cannot be confirmed is reported as degraded instead of as a value', async () => {
  setStreamRelaySwitchReader({
    read: async () => {
      throw Object.assign(new Error('connection refused'), { code: 'P1001' })
    },
  })
  // A failed confirmation is what records the reason, and it fails closed: nothing is enabled by a read
  // that could not be completed.
  assert.equal(await confirmStreamRelaySwitch(), false)

  const captured = await runHandler(streamRelayController.getStreamRelaySetting)
  const data = captured.body?.data as Record<string, unknown>

  assert.equal(captured.statusCode, 200)
  // A value confirmed earlier in this process is still the one the database is believed to hold; what must
  // never happen is presenting it as the value being enforced.
  assert.equal(data.operational, false)
  assert.equal(data.degraded, true)
  assert.match(String(data.degradedReason), /stream\.httpRelay\.enabled/)
})

test('turning the relay on persists it, records the change and applies it immediately', async () => {
  await withDatabase({ existing: 'false' }, async (written) => {
    const captured = await runHandler(streamRelayController.updateStreamRelaySetting, { enabled: true })
    const data = captured.body?.data as Record<string, unknown>

    assert.equal(captured.refusal, null, String(captured.refusal))
    assert.equal(captured.statusCode, 200)
    assert.equal(data.enabled, true)
    assert.equal(data.previous, false)
    assert.equal(data.operational, true, 'the acting instance applies the change without waiting for a window')
    assert.equal(getAppliedStreamRelaySwitch(), true)

    const upsert = written.find((entry) => entry.op === 'upsert')
    assert.deepEqual(upsert?.create, {
      key: STREAM_RELAY_SETTING_KEY,
      value: 'true',
      type: 'boolean',
      description: (upsert?.create as Record<string, unknown>).description,
    })

    const audit = written.find((entry) => entry.op === 'audit')
    assert.equal(audit?.message, 'HTTP stream relay turned ON')
    assert.equal((audit?.meta as Record<string, unknown>)?.previousValue, false)
    assert.equal((audit?.meta as Record<string, unknown>)?.persisted, true)
    assert.equal((audit?.meta as Record<string, unknown>)?.actorId, 'admin-1')
    assert.equal((audit?.meta as Record<string, unknown>)?.requestId, 'req-1')
  })
})

test('turning the relay off is persisted and applied to this instance', async () => {
  setStreamRelaySwitchReader({ read: async () => 'true' })
  await confirmStreamRelaySwitch()

  await withDatabase({ existing: 'true' }, async (written) => {
    const captured = await runHandler(streamRelayController.updateStreamRelaySetting, { enabled: false })
    const data = captured.body?.data as Record<string, unknown>

    assert.equal(data.enabled, false)
    assert.equal(data.previous, true)
    assert.equal(getAppliedStreamRelaySwitch(), false)
    assert.equal(written.find((entry) => entry.op === 'audit')?.message, 'HTTP stream relay turned OFF')
  })
})

test('a change that cannot be persisted reports 503 and changes nothing', async () => {
  await withDatabase({ existing: 'false', failOnWrite: true }, async () => {
    const captured = await runHandler(streamRelayController.updateStreamRelaySetting, { enabled: true })
    const refusal = captured.refusal as { statusCode?: number; message?: string } | null

    assert.ok(refusal, 'the endpoint must not report success when the value could not be stored')
    assert.equal(refusal.statusCode, 503)
    assert.match(String(refusal.message), /could not be persisted/)
    assert.equal(getAppliedStreamRelaySwitch(), false, 'nothing is applied to the running process')
  })
})

test('a body that is not exactly { enabled: boolean } is refused before anything is written', async () => {
  for (const body of [{ enabled: 'yes' }, {}, { enabled: true, extra: 1 }]) {
    const captured = await runHandler(streamRelayController.updateStreamRelaySetting, body)

    assert.equal(captured.statusCode, 400, JSON.stringify(body))
    assert.equal(captured.body?.success, false)
    assert.equal(captured.refusal, null, 'the body is answered directly, not forwarded as a server error')
  }
})

/**
 * The regression: the generic settings endpoint writes any key it is handed, so it used to be a second
 * write path for this switch — one that skips the audit entry, the immediate application to the running
 * process and the abort of active relay work. The relay is confirmed ON first, so a write that reached
 * either the database or this process would be visible in the assertions below.
 */
test('the generic settings endpoint refuses to write the relay key, and neither persists nor applies it', async () => {
  setStreamRelaySwitchReader({ read: async () => 'true' })
  await confirmStreamRelaySwitch()
  assert.equal(getAppliedStreamRelaySwitch(), true)

  const { prisma } = await import('../../core/prisma.js')
  const originalSetting = prisma.setting
  const writes: unknown[] = []

  try {
    ;(prisma as { setting: unknown }).setting = {
      upsert: async (args: unknown) => {
        writes.push(args)
        return args
      },
    }

    const captured = await runHandler(settingsController.updateSettings, [
      { key: STREAM_RELAY_SETTING_KEY, value: 'false' },
    ])

    assert.equal(captured.statusCode, 403)
    assert.equal(captured.body?.success, false)
    assert.match(String(captured.body?.message), /dedicated endpoint/i)
    assert.equal(captured.refusal, null, 'the refusal is answered directly, not forwarded as a server error')
    assert.deepEqual(writes, [], 'the generic endpoint must not write the relay setting')
    assert.equal(getAppliedStreamRelaySwitch(), true, 'the running relay must be untouched')

    // And the dedicated endpoint still reports the unchanged value the database is believed to hold.
    const status = await runHandler(streamRelayController.getStreamRelaySetting)
    assert.equal((status.body?.data as Record<string, unknown>).operational, true)
  } finally {
    ;(prisma as { setting: unknown }).setting = originalSetting
  }
})
