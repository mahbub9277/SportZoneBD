import assert from 'node:assert/strict'
import { test } from 'node:test'

process.env.JWT_SECRET ??= 'automation-switch-test-secret'
process.env.JWT_REFRESH_SECRET ??= 'automation-switch-test-refresh-secret'
// The delivery-boundary window is a real time window; a millisecond-scale one is enough to exercise it.
process.env.AUTOMATION_SWITCH_TTL_MS = '200'

const {
  AUTOMATION_SWITCHES,
  confirmAutomationSwitch,
  getAppliedAutomationSwitch,
  getAutomationSwitchStatus,
  isAutomationSwitchEnabled,
  setAutomationSwitchReader,
} = await import('./automationSwitches.js')

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

interface ReaderCall {
  settingKey: string
}

/** A stand-in for the settings table: one value per key, an optional failure, and a call log. */
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
  setAutomationSwitchReader(null)
})

test('a missing row keeps the automation enabled, because that is how it has always run', async () => {
  const { reader } = fakeSettingRow({ value: null })
  setAutomationSwitchReader(reader)

  assert.equal(await confirmAutomationSwitch('pushNotifications'), true)
  assert.equal(await confirmAutomationSwitch('matchCreation'), true)
})

test('an explicit OFF is read from the row and applied to this process', async () => {
  const { reader } = fakeSettingRow({ value: 'false' })
  setAutomationSwitchReader(reader)

  assert.equal(await confirmAutomationSwitch('pushNotifications'), false)
  assert.equal(getAppliedAutomationSwitch('pushNotifications'), false)

  const status = getAutomationSwitchStatus('pushNotifications')
  assert.equal(status.desired, false)
  assert.equal(status.operational, false)
  assert.equal(status.degraded, false)
})

test('the two switches read their own setting key and never each other', async () => {
  const { reader, calls } = fakeSettingRow({ value: 'false' })
  setAutomationSwitchReader(reader)

  await confirmAutomationSwitch('pushNotifications')
  await confirmAutomationSwitch('matchCreation')

  assert.deepEqual(calls.map((call) => call.settingKey), [
    AUTOMATION_SWITCHES.pushNotifications.settingKey,
    AUTOMATION_SWITCHES.matchCreation.settingKey,
  ])
  assert.equal(AUTOMATION_SWITCHES.pushNotifications.settingKey, 'automation.pushNotifications.enabled')
  assert.equal(AUTOMATION_SWITCHES.matchCreation.settingKey, 'automation.matchCreation.enabled')
})

test('a failed read fails closed and is reported as degraded, without inventing a desired value', async () => {
  const { reader } = fakeSettingRow({ fail: true })
  setAutomationSwitchReader(reader)

  assert.equal(await confirmAutomationSwitch('matchCreation'), false)
  assert.equal(getAppliedAutomationSwitch('matchCreation'), false)

  const status = getAutomationSwitchStatus('matchCreation')
  assert.equal(status.desired, null, 'nothing was confirmed, so no value may be presented as the desired one')
  assert.equal(status.operational, false)
  assert.equal(status.degraded, true)
  assert.match(String(status.degradedReason), /automation\.matchCreation\.enabled/)
})

test('a read that starts failing keeps the last confirmed value but stops claiming to be operational', async () => {
  let fail = false
  setAutomationSwitchReader({
    read: async () => {
      if (fail) throw Object.assign(new Error('connection refused'), { code: 'P1001' })
      return 'true'
    },
  })

  assert.equal(await confirmAutomationSwitch('pushNotifications'), true)
  fail = true
  assert.equal(await confirmAutomationSwitch('pushNotifications'), false, 'a failed confirmation must fail closed')

  const status = getAutomationSwitchStatus('pushNotifications')
  assert.equal(status.desired, true, 'the last confirmed value is still reported as the desired one')
  assert.equal(status.operational, false)
  assert.equal(status.degraded, true)
})

test('an unrecognised stored value is refused instead of being treated as enabled', async () => {
  const { reader } = fakeSettingRow({ value: 'yes' })
  setAutomationSwitchReader(reader)

  assert.equal(await confirmAutomationSwitch('pushNotifications'), false)
  const status = getAutomationSwitchStatus('pushNotifications')
  assert.equal(status.desired, null)
  assert.equal(status.degraded, true)
  assert.match(String(status.degradedReason), /Unrecognised/)
})

test('the delivery boundary reads once per window instead of once per queued delivery', async () => {
  const { reader, calls } = fakeSettingRow({ value: 'true' })
  setAutomationSwitchReader(reader)

  for (let index = 0; index < 25; index += 1) {
    assert.equal(await isAutomationSwitchEnabled('pushNotifications'), true)
  }

  assert.equal(calls.length, 1, `25 queued deliveries must not cost 25 settings reads (got ${calls.length})`)
})

test('past that window a failing read stops delivery instead of trusting the stale value', async () => {
  let fail = false
  const calls: string[] = []
  setAutomationSwitchReader({
    read: async (settingKey: string) => {
      calls.push(settingKey)
      if (fail) throw Object.assign(new Error('connection refused'), { code: 'P1001' })
      return 'true'
    },
  })

  assert.equal(await isAutomationSwitchEnabled('pushNotifications'), true)
  fail = true
  await sleep(250)

  assert.equal(
    await isAutomationSwitchEnabled('pushNotifications'),
    false,
    'a confirmation older than the window must not keep push delivery enabled',
  )
  assert.equal(calls.length, 2, 'the failed read is throttled to one attempt per window')
})

test('the status exposed to the API distinguishes desired, applied and degraded', async () => {
  const { reader } = fakeSettingRow({ value: 'false' })
  setAutomationSwitchReader(reader)
  await confirmAutomationSwitch('pushNotifications')

  const status = getAutomationSwitchStatus('pushNotifications')
  assert.deepEqual(Object.keys(status).sort(), [
    'confirmedAt',
    'degraded',
    'degradedReason',
    'description',
    'desired',
    'instancesConfirmed',
    'key',
    'label',
    'operational',
    'settingKey',
  ])
  assert.equal(status.key, 'pushNotifications')
  assert.equal(status.label, 'Push Notifications Automation')
  assert.equal(status.instancesConfirmed, 'this-instance-only')
  assert.ok(status.confirmedAt)
})
