import assert from 'node:assert/strict'
import { test } from 'node:test'

process.env.JWT_SECRET ??= 'stream-relay-switch-test-secret'
process.env.JWT_REFRESH_SECRET ??= 'stream-relay-switch-test-refresh-secret'
// The propagation window is a real time window; a millisecond-scale one is enough to exercise it.
process.env.STREAM_RELAY_TTL_MS = '200'

const {
  STREAM_RELAY_DEFAULT_ENABLED,
  STREAM_RELAY_DESCRIPTION,
  STREAM_RELAY_SETTING_KEY,
  abortActiveRelays,
  activeRelayCount,
  confirmStreamRelaySwitch,
  getAppliedStreamRelaySwitch,
  getStreamRelaySwitchStatus,
  initializeStreamRelaySwitch,
  invalidateStreamRelaySwitchCache,
  isStreamRelaySwitchEnabled,
  registerRelayRequest,
  setStreamRelaySwitchReader,
} = await import('./streamRelaySwitch.js')

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

interface ReaderCall {
  settingKey: string
}

/** A stand-in for the settings table: one value, an optional failure, and a call log. */
function fakeSettingRow(options: { value?: string | null; fail?: boolean } = {}) {
  const calls: ReaderCall[] = []
  const reader = {
    read: async (settingKey: string) => {
      calls.push({ settingKey })
      if (options.fail) throw Object.assign(new Error('connection refused'), { code: 'P1001' })
      return options.value ?? null
    },
  }
  return { reader, calls }
}

test.afterEach(() => {
  setStreamRelaySwitchReader(null)
  invalidateStreamRelaySwitchCache()
  abortActiveRelays()
})

test('the relay starts off, including on a database that has never stored the setting', async () => {
  assert.equal(STREAM_RELAY_DEFAULT_ENABLED, false)
  // Nothing has been read yet in this process, and nothing is presented as a value before that read.
  const beforeAnyRead = getStreamRelaySwitchStatus()
  assert.equal(beforeAnyRead.desired, null)
  assert.equal(beforeAnyRead.operational, false)
  assert.equal(beforeAnyRead.confirmedAt, null)

  const { reader, calls } = fakeSettingRow({ value: null })
  setStreamRelaySwitchReader(reader)

  assert.equal(await confirmStreamRelaySwitch(), false)
  assert.equal(await isStreamRelaySwitchEnabled(), false)
  assert.deepEqual(calls.map((call) => call.settingKey), [STREAM_RELAY_SETTING_KEY, STREAM_RELAY_SETTING_KEY])
})

test('only an explicit stored true turns the relay on', async () => {
  for (const value of ['true', ' TRUE ', 'True']) {
    setStreamRelaySwitchReader(fakeSettingRow({ value }).reader)
    invalidateStreamRelaySwitchCache()

    assert.equal(await confirmStreamRelaySwitch(), true, `stored value "${value}" must enable the relay`)
    assert.equal(getAppliedStreamRelaySwitch(), true)
    const status = getStreamRelaySwitchStatus()
    assert.equal(status.desired, true)
    assert.equal(status.operational, true)
    assert.equal(status.degraded, false)
  }
})

test('a stored value that is not a boolean is refused instead of guessed, and the relay stays closed', async () => {
  setStreamRelaySwitchReader(fakeSettingRow({ value: 'false' }).reader)
  invalidateStreamRelaySwitchCache()
  assert.equal(await confirmStreamRelaySwitch(), false)
  assert.equal(getStreamRelaySwitchStatus().desired, false, 'an explicit false is a value that can be reported')

  for (const value of ['yes', '1', '']) {
    setStreamRelaySwitchReader(fakeSettingRow({ value }).reader)
    invalidateStreamRelaySwitchCache()

    assert.equal(await confirmStreamRelaySwitch(), false, `stored value "${value}" must not enable the relay`)
    const status = getStreamRelaySwitchStatus()
    // `desired` deliberately keeps reporting the last value an authoritative read understood — the same
    // contract the automation switches have. What matters is that nothing was enabled and the state is
    // reported as degraded rather than presented as a decision somebody made.
    assert.equal(status.operational, false)
    assert.equal(status.degraded, true)
    assert.match(String(status.degradedReason), /Unrecognised/)
  }
})

test('a read that fails fails closed and is reported as degraded', async () => {
  const { reader } = fakeSettingRow({ fail: true })
  setStreamRelaySwitchReader(reader)

  assert.equal(await confirmStreamRelaySwitch(), false)
  assert.equal(await isStreamRelaySwitchEnabled(), false)
  assert.equal(getAppliedStreamRelaySwitch(), false)

  const status = getStreamRelaySwitchStatus()
  assert.equal(status.operational, false)
  assert.equal(status.degraded, true)
  assert.match(String(status.degradedReason), /stream\.httpRelay\.enabled/)
})

test('a healthy relay that loses the database stops relaying but keeps reporting the stored value', async () => {
  let fail = false
  setStreamRelaySwitchReader({
    read: async () => {
      if (fail) throw Object.assign(new Error('connection refused'), { code: 'P1001' })
      return 'true'
    },
  })

  assert.equal(await confirmStreamRelaySwitch(), true)
  fail = true
  assert.equal(await confirmStreamRelaySwitch(), false, 'an unconfirmed read must not keep media flowing')

  const status = getStreamRelaySwitchStatus()
  assert.equal(status.desired, true, 'the last confirmed value is still what the database holds')
  assert.equal(status.operational, false)
  assert.equal(status.degraded, true)
})

test('the hot boundary reads once per window instead of once per segment', async () => {
  const { reader, calls } = fakeSettingRow({ value: 'true' })
  setStreamRelaySwitchReader(reader)

  for (let index = 0; index < 25; index += 1) {
    assert.equal(await isStreamRelaySwitchEnabled(), true)
  }

  assert.equal(calls.length, 1, `25 segment requests must not cost 25 settings reads (got ${calls.length})`)
})

test('past that window the relay is re-read, so another instance turning it off is noticed', async () => {
  let stored: string = 'true'
  const calls: string[] = []
  setStreamRelaySwitchReader({
    read: async (settingKey: string) => {
      calls.push(settingKey)
      return stored
    },
  })

  assert.equal(await isStreamRelaySwitchEnabled(), true)
  stored = 'false'
  await sleep(250)

  assert.equal(await isStreamRelaySwitchEnabled(), false, 'a value older than the window must not keep the relay on')
  assert.equal(calls.length, 2)
})

test('a confirmation always reads through, so a relay request never decides from the cache', async () => {
  let stored = 'true'
  const calls: string[] = []
  setStreamRelaySwitchReader({
    read: async (settingKey: string) => {
      calls.push(settingKey)
      return stored
    },
  })

  assert.equal(await confirmStreamRelaySwitch(), true)
  stored = 'false'
  assert.equal(await confirmStreamRelaySwitch(), false, 'the second request must see the change without waiting for the window')
  assert.equal(calls.length, 2)
})

test('observing OFF aborts the requests this instance is already streaming', async () => {
  let stored = 'true'
  setStreamRelaySwitchReader({ read: async () => stored })
  assert.equal(await confirmStreamRelaySwitch(), true)

  const first = new AbortController()
  const second = new AbortController()
  registerRelayRequest(first)
  registerRelayRequest(second)
  assert.equal(activeRelayCount(), 2)

  stored = 'false'
  assert.equal(await confirmStreamRelaySwitch(), false)

  assert.equal(first.signal.aborted, true)
  assert.equal(second.signal.aborted, true)
  assert.equal(activeRelayCount(), 0, 'a stopped request must not stay registered')
})

test('releasing a finished relay request is idempotent and never touches another request', () => {
  const finished = new AbortController()
  const active = new AbortController()
  const releaseFinished = registerRelayRequest(finished)
  registerRelayRequest(active)

  releaseFinished()
  releaseFinished()
  assert.equal(activeRelayCount(), 1, 'the surviving request must stay registered')

  assert.equal(abortActiveRelays(), 1)
  assert.equal(active.signal.aborted, true)
  assert.equal(finished.signal.aborted, false, 'an already released request must not be aborted')
  assert.equal(activeRelayCount(), 0)
})

test('the status exposed to the admin console distinguishes desired, applied and degraded', async () => {  const { reader } = fakeSettingRow({ value: 'false' })
  setStreamRelaySwitchReader(reader)
  await confirmStreamRelaySwitch()

  const status = getStreamRelaySwitchStatus()
  assert.deepEqual(Object.keys(status).sort(), [
    'activeRelayRequests',
    'confirmedAt',
    'degraded',
    'degradedReason',
    'description',
    'desired',
    'instancesConfirmed',
    'label',
    'operational',
    'settingKey',
  ])
  assert.equal(status.settingKey, STREAM_RELAY_SETTING_KEY)
  assert.equal(status.desired, false)
  assert.equal(status.operational, false)
  assert.equal(status.instancesConfirmed, 'this-instance-only')
  assert.ok(status.confirmedAt)
})

/** Replaces the settings table for the initialisation tests, which write the row themselves. */
async function withSettingTable(
  options: { existingRow?: { value: string } | null },
  assertion: (writes: Array<Record<string, unknown>>) => Promise<void>,
) {
  const { prisma } = await import('./prisma.js')
  const originalSetting = prisma.setting
  const writes: Array<Record<string, unknown>> = []

  try {
    ;(prisma as { setting: unknown }).setting = {
      findUnique: async () => options.existingRow ?? null,
      create: async (args: { data: Record<string, unknown> }) => {
        writes.push(args.data)
        return args.data
      },
    }
    await assertion(writes)
  } finally {
    ;(prisma as { setting: unknown }).setting = originalSetting
  }
}

test('initialisation creates the setting row as off and never overwrites a value that exists', async () => {
  setStreamRelaySwitchReader({ read: async () => 'false' })

  await withSettingTable({ existingRow: null }, async (writes) => {
    await initializeStreamRelaySwitch()

    assert.deepEqual(writes, [{
      key: STREAM_RELAY_SETTING_KEY,
      value: 'false',
      type: 'boolean',
      description: STREAM_RELAY_DESCRIPTION,
    }])
  })

  // A row that already exists is left exactly as it is: initialisation is not a reset.
  await withSettingTable({ existingRow: { value: 'true' } }, async (writes) => {
    await initializeStreamRelaySwitch()

    assert.deepEqual(writes, [], 'an existing value must not be rewritten')
  })
})
