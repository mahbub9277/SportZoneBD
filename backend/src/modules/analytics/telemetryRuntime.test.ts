import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createTelemetryRuntime, type TelemetryRuntimeScheduler } from './telemetryRuntime.js'

const INTERVAL_MS = 60_000

interface FakeScheduler {
  scheduler: TelemetryRuntimeScheduler
  /** Runs every live interval handler once and lets the async tick settle. */
  tick: () => Promise<void>
  activeTimers: () => number
}

function createFakeScheduler(): FakeScheduler {
  const timers = new Map<number, () => void>()
  let nextId = 1
  return {
    scheduler: {
      setInterval: (handler) => {
        const id = nextId
        nextId += 1
        timers.set(id, handler)
        return id
      },
      clearInterval: (handle) => {
        timers.delete(handle as number)
      },
    },
    tick: async () => {
      for (const handler of [...timers.values()]) handler()
      await new Promise((resolve) => { setTimeout(resolve, 0) })
    },
    activeTimers: () => timers.size,
  }
}

interface RuntimeHarness {
  fake: FakeScheduler
  maintenanceRuns: () => number
  disabledNotifications: () => number
  runtime: ReturnType<typeof createTelemetryRuntime>
  setEnabled: (enabled: boolean) => void
}

function createHarness(initialEnabled = false): RuntimeHarness {
  const fake = createFakeScheduler()
  let enabled = initialEnabled
  let maintenanceRuns = 0
  let disabledNotifications = 0
  const runtime = createTelemetryRuntime({
    intervalMs: INTERVAL_MS,
    scheduler: fake.scheduler,
    isEnabled: async () => enabled,
    runMaintenance: () => { maintenanceRuns += 1 },
    onDisabled: () => { disabledNotifications += 1 },
  })
  return {
    fake,
    runtime,
    maintenanceRuns: () => maintenanceRuns,
    disabledNotifications: () => disabledNotifications,
    setEnabled: (next) => { enabled = next },
  }
}

test('telemetry off at startup starts no maintenance timer and runs no maintenance', async () => {
  const harness = createHarness(false)

  await harness.runtime.sync()

  assert.equal(harness.runtime.isTimerRunning(), false)
  assert.equal(harness.fake.activeTimers(), 0)
  assert.equal(harness.maintenanceRuns(), 0)
  await harness.fake.tick()
  assert.equal(harness.maintenanceRuns(), 0)
})

test('telemetry on starts exactly one timer that runs maintenance per tick', async () => {
  const harness = createHarness(true)

  await harness.runtime.sync()

  assert.equal(harness.runtime.isTimerRunning(), true)
  assert.equal(harness.fake.activeTimers(), 1)
  await harness.fake.tick()
  assert.equal(harness.maintenanceRuns(), 1)
  await harness.fake.tick()
  assert.equal(harness.maintenanceRuns(), 2)
})

test('switching telemetry off clears the timer and stops all maintenance work', async () => {
  const harness = createHarness(true)
  await harness.runtime.sync()
  await harness.fake.tick()
  assert.equal(harness.maintenanceRuns(), 1)

  harness.setEnabled(false)
  harness.runtime.apply(false)

  assert.equal(harness.runtime.isTimerRunning(), false)
  assert.equal(harness.fake.activeTimers(), 0)
  await harness.fake.tick()
  assert.equal(harness.maintenanceRuns(), 1)
  assert.equal(harness.disabledNotifications(), 1)
})

test('a tick that observes telemetry off stops the timer instead of running maintenance', async () => {
  const harness = createHarness(true)
  harness.runtime.apply(true)
  assert.equal(harness.runtime.isTimerRunning(), true)

  // The setting was switched off elsewhere: the next cycle must stop the runtime, not run work.
  harness.setEnabled(false)
  await harness.fake.tick()

  assert.equal(harness.maintenanceRuns(), 0)
  assert.equal(harness.runtime.isTimerRunning(), false)
  assert.equal(harness.fake.activeTimers(), 0)
})

test('switching telemetry back on starts exactly one timer again', async () => {
  const harness = createHarness(true)
  harness.runtime.apply(true)
  harness.runtime.apply(false)
  assert.equal(harness.fake.activeTimers(), 0)

  harness.setEnabled(true)
  await harness.runtime.sync()

  assert.equal(harness.fake.activeTimers(), 1)
  await harness.fake.tick()
  assert.equal(harness.maintenanceRuns(), 1)
})

test('repeated on/off transitions never create duplicate timers', async () => {
  const harness = createHarness(true)

  for (let cycle = 0; cycle < 5; cycle += 1) {
    harness.runtime.apply(true)
    harness.runtime.apply(true)
    assert.equal(harness.fake.activeTimers(), 1, `enabled cycle ${cycle} must keep a single timer`)

    harness.runtime.apply(false)
    harness.runtime.apply(false)
    assert.equal(harness.fake.activeTimers(), 0, `disabled cycle ${cycle} must clear the timer`)
  }

  harness.runtime.apply(true)
  assert.equal(harness.fake.activeTimers(), 1)
  await harness.fake.tick()
  assert.equal(harness.maintenanceRuns(), 1)
})

test('a slow maintenance cycle is never overlapped by the next tick', async () => {
  const fake = createFakeScheduler()
  let runs = 0
  const releases: Array<() => void> = []
  const runtime = createTelemetryRuntime({
    intervalMs: INTERVAL_MS,
    scheduler: fake.scheduler,
    isEnabled: async () => true,
    runMaintenance: () => new Promise<void>((resolve) => {
      runs += 1
      releases.push(resolve)
    }),
  })

  runtime.apply(true)
  // Fire the interval twice before the first cycle resolves: the second tick must be skipped.
  const firstTick = fake.tick()
  const secondTick = fake.tick()
  await new Promise((resolve) => { setTimeout(resolve, 0) })
  assert.equal(runs, 1)

  for (const release of releases) release()
  await Promise.all([firstTick, secondTick])
  assert.equal(runs, 1)
})

test('stopping the runtime clears the timer so no further maintenance runs', async () => {
  const harness = createHarness(true)
  harness.runtime.apply(true)

  harness.runtime.stop()

  assert.equal(harness.runtime.isTimerRunning(), false)
  assert.equal(harness.fake.activeTimers(), 0)
  await harness.fake.tick()
  assert.equal(harness.maintenanceRuns(), 0)
})

test('a maintenance failure is reported and does not kill the timer', async () => {
  const fake = createFakeScheduler()
  const errors: unknown[] = []
  let runs = 0
  const runtime = createTelemetryRuntime({
    intervalMs: INTERVAL_MS,
    scheduler: fake.scheduler,
    isEnabled: async () => true,
    runMaintenance: () => {
      runs += 1
      throw new Error('maintenance failed')
    },
    onError: (error) => { errors.push(error) },
  })

  runtime.apply(true)
  await fake.tick()
  await fake.tick()

  assert.equal(runs, 2)
  assert.equal(errors.length, 2)
  assert.equal(runtime.isTimerRunning(), true)
})
