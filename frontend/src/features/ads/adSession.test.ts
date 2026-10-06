import test from 'node:test'
import assert from 'node:assert/strict'
import {
  AD_COMPLETION_GRACE_MS,
  AD_DISMISSAL_COOLDOWN_MS,
  AD_RECORD_MAX_AGE_MS,
  computeElapsedRatio,
  computeRemainingSeconds,
  countdownEndsAtMs,
  getAdStorage,
  hasDurationElapsed,
  initialAdVisitState,
  isAdVisitRunning,
  isUnlockActive,
  normalizeAdDurationSeconds,
  readAdRecord,
  recordAdCompletion,
  recordAdDismissal,
  reduceAdVisit,
  removeAdRecord,
  shouldAutoOpenAd,
  startAdVisitClock,
  writeAdRecord,
  type AdVisitClockScheduler,
  type AdVisitState,
  type StorageLike,
} from './adSession.ts'

const START = 1_000_000
const activeVisit: AdVisitState = { status: 'active', dismissalReason: null, errorMessage: null, sessionId: 'session-1', startedAtMs: START, durationSeconds: 10 }

// ---------------------------------------------------------------------------------------------
// Duration handling (seconds only, invalid values safe)
// ---------------------------------------------------------------------------------------------

test('duration is normalised to whole seconds and never NaN/negative', () => {
  assert.equal(normalizeAdDurationSeconds(10), 10)
  assert.equal(normalizeAdDurationSeconds('12'), 12)
  assert.equal(normalizeAdDurationSeconds(9.7), 9)
  assert.equal(normalizeAdDurationSeconds(0), 0)
  assert.equal(normalizeAdDurationSeconds(-5), 0)
  assert.equal(normalizeAdDurationSeconds(Number.NaN), 0)
  assert.equal(normalizeAdDurationSeconds(Number.POSITIVE_INFINITY), 0)
  assert.equal(normalizeAdDurationSeconds(undefined), 0)
  assert.equal(normalizeAdDurationSeconds('not-a-number'), 0)
})

test('configured duration is interpreted as seconds, never milliseconds', () => {
  assert.equal(countdownEndsAtMs(START, 10), START + 10_000)
  assert.equal(computeRemainingSeconds(START, 10, START), 10)
  assert.equal(computeRemainingSeconds(START, 10, START + 9_999), 1)
})

// ---------------------------------------------------------------------------------------------
// Completion timing
// ---------------------------------------------------------------------------------------------

test('completion is impossible before the configured duration', () => {
  assert.equal(hasDurationElapsed(START, 10, START), false)
  assert.equal(hasDurationElapsed(START, 10, START + 9_999), false)
  assert.equal(computeRemainingSeconds(START, 10, START + 9_999), 1)
})

test('completion happens exactly at the configured duration', () => {
  assert.equal(hasDurationElapsed(START, 10, START + 10_000), true)
  assert.equal(computeRemainingSeconds(START, 10, START + 10_000), 0)
})

test('remaining time never goes negative', () => {
  assert.equal(computeRemainingSeconds(START, 10, START + 60_000), 0)
  assert.equal(computeRemainingSeconds(Number.NaN, 10, START), 0)
})

test('elapsed ratio reflects real time and clamps to 0..1', () => {
  assert.equal(computeElapsedRatio(START, 10, START), 0)
  assert.equal(computeElapsedRatio(START, 10, START + 5_000), 0.5)
  assert.equal(computeElapsedRatio(START, 10, START + 30_000), 1)
  assert.equal(computeElapsedRatio(START, 0, START + 1), 1)
})

test('a hidden tab that returns after the duration reports a finished countdown', () => {
  const hiddenAt = START + 1_000
  const returnedAt = START + 45_000
  assert.equal(computeRemainingSeconds(START, 10, hiddenAt), 9)
  assert.equal(computeRemainingSeconds(START, 10, returnedAt), 0)
  assert.equal(hasDurationElapsed(START, 10, returnedAt), true)
})

// ---------------------------------------------------------------------------------------------
// Visit state machine
// ---------------------------------------------------------------------------------------------

test('a visit starts as active with the server session', () => {
  const state = reduceAdVisit(initialAdVisitState, { type: 'start', sessionId: 'session-1', startedAtMs: START, durationSeconds: 10 })
  assert.equal(state.status, 'active')
  assert.equal(state.sessionId, 'session-1')
  assert.equal(state.startedAtMs, START)
  assert.equal(state.durationSeconds, 10)
  assert.equal(isAdVisitRunning(state), true)
})

test('a second start cannot replace a running visit (no duplicate sessions)', () => {
  const started = reduceAdVisit(initialAdVisitState, { type: 'start', sessionId: 'session-1', startedAtMs: START, durationSeconds: 10 })
  const duplicate = reduceAdVisit(started, { type: 'start', sessionId: 'session-2', startedAtMs: START + 500, durationSeconds: 10 })
  assert.equal(duplicate, started)
  const whileVerifying = reduceAdVisit(reduceAdVisit(started, { type: 'beginCompletion' }), { type: 'start', sessionId: 'session-3', startedAtMs: START + 900, durationSeconds: 10 })
  assert.equal(whileVerifying.sessionId, 'session-1')
  assert.equal(whileVerifying.status, 'verifying')
})

test('beginning completion is idempotent and only valid while running', () => {
  const verifying = reduceAdVisit(activeVisit, { type: 'beginCompletion' })
  assert.equal(verifying.status, 'verifying')
  assert.equal(reduceAdVisit(verifying, { type: 'beginCompletion' }), verifying)
  assert.equal(reduceAdVisit(initialAdVisitState, { type: 'beginCompletion' }).status, 'idle')
  const dismissed = reduceAdVisit(activeVisit, { type: 'dismiss', reason: 'closed' })
  assert.equal(reduceAdVisit(dismissed, { type: 'beginCompletion' }).status, 'dismissed')
})

test('completion succeeds exactly once and stays completed', () => {
  const verifying = reduceAdVisit(activeVisit, { type: 'beginCompletion' })
  const completed = reduceAdVisit(verifying, { type: 'completionSucceeded' })
  assert.equal(completed.status, 'completed')
  assert.equal(isAdVisitRunning(completed), false)
  assert.equal(reduceAdVisit(completed, { type: 'completionSucceeded' }), completed)
  // A repeated completion event never re-enters verification or resets the visit.
  assert.equal(reduceAdVisit(completed, { type: 'beginCompletion' }), completed)
})

test('completion can never be granted without a running visit', () => {
  assert.equal(reduceAdVisit(initialAdVisitState, { type: 'completionSucceeded' }).status, 'idle')
  const dismissed = reduceAdVisit(activeVisit, { type: 'dismiss', reason: 'closed' })
  assert.equal(reduceAdVisit(dismissed, { type: 'completionSucceeded' }).status, 'dismissed')
  const failed = reduceAdVisit(reduceAdVisit(activeVisit, { type: 'beginCompletion' }), { type: 'completionFailed', message: 'boom' })
  assert.equal(reduceAdVisit(failed, { type: 'completionSucceeded' }).status, 'failed')
})

test('a failed completion keeps the visit retryable', () => {
  const failed = reduceAdVisit(reduceAdVisit(activeVisit, { type: 'beginCompletion' }), { type: 'completionFailed', message: 'Could not verify.' })
  assert.equal(failed.status, 'failed')
  assert.equal(failed.errorMessage, 'Could not verify.')
  assert.equal(failed.sessionId, 'session-1')
  const retry = reduceAdVisit(failed, { type: 'start', sessionId: 'session-2', startedAtMs: START + 11_000, durationSeconds: 10 })
  assert.equal(retry.status, 'active')
  assert.equal(retry.sessionId, 'session-2')
  // An in-place retry of the same session is allowed and clears the previous error.
  const inPlaceRetry = reduceAdVisit(failed, { type: 'beginCompletion' })
  assert.equal(inPlaceRetry.status, 'verifying')
  assert.equal(inPlaceRetry.errorMessage, null)
})

test('manual dismissal is never recorded as a completion', () => {
  const closed = reduceAdVisit(activeVisit, { type: 'dismiss', reason: 'closed' })
  assert.equal(closed.status, 'dismissed')
  assert.equal(closed.dismissalReason, 'closed')
  assert.equal(isAdVisitRunning(closed), false)
  const interrupted = reduceAdVisit(activeVisit, { type: 'dismiss', reason: 'interrupted' })
  assert.equal(interrupted.dismissalReason, 'interrupted')
})

test('dismissal is idempotent and cannot downgrade a completed visit', () => {
  const dismissed = reduceAdVisit(activeVisit, { type: 'dismiss', reason: 'closed' })
  assert.equal(reduceAdVisit(dismissed, { type: 'dismiss', reason: 'interrupted' }), dismissed)
  const completed = reduceAdVisit(reduceAdVisit(activeVisit, { type: 'beginCompletion' }), { type: 'completionSucceeded' })
  assert.equal(reduceAdVisit(completed, { type: 'dismiss', reason: 'closed' }).status, 'completed')
})

// ---------------------------------------------------------------------------------------------
// Unlock state
// ---------------------------------------------------------------------------------------------

test('unlock activity is decided from expiry only', () => {
  assert.equal(isUnlockActive(null, START), false)
  assert.equal(isUnlockActive(undefined, START), false)
  assert.equal(isUnlockActive({ expiresAt: new Date(START - 1).toISOString() }, START), false)
  assert.equal(isUnlockActive({ expiresAt: new Date(START + 1).toISOString() }, START), true)
  assert.equal(isUnlockActive({ expiresAt: 'not-a-date' }, START), false)
  assert.equal(isUnlockActive({ expiresAt: new Date(START + 500) }, START), true)
})

// ---------------------------------------------------------------------------------------------
// Local records: dismissal vs completion vs entitlement
// ---------------------------------------------------------------------------------------------

function createMemoryStorage(): StorageLike & { dump: () => Record<string, string> } {
  const store = new Map<string, string>()
  return {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => { store.set(key, value) },
    removeItem: (key) => { store.delete(key) },
    dump: () => Object.fromEntries(store),
  }
}

test('missing storage is tolerated everywhere', () => {
  assert.equal(readAdRecord(null, 'ad-1', START), null)
  assert.doesNotThrow(() => writeAdRecord(undefined, 'ad-1', { state: 'dismissed', at: START }))
  assert.doesNotThrow(() => removeAdRecord(null, 'ad-1'))
  assert.equal(readAdRecord(createMemoryStorage(), '', START), null)
})

test('dismissal and completion are stored as distinct states', () => {
  const storage = createMemoryStorage()
  recordAdDismissal(storage, 'ad-1', START)
  assert.deepEqual(readAdRecord(storage, 'ad-1', START), { state: 'dismissed', at: START })
  recordAdCompletion(storage, 'ad-1', START + 5)
  assert.deepEqual(readAdRecord(storage, 'ad-1', START + 5), { state: 'completed', at: START + 5 })
  removeAdRecord(storage, 'ad-1')
  assert.equal(readAdRecord(storage, 'ad-1', START), null)
})

test('corrupt or wrongly shaped records are ignored safely', () => {
  const storage = createMemoryStorage()
  storage.setItem('sportzone-ad:ad-1', '{not json')
  assert.equal(readAdRecord(storage, 'ad-1', START), null)
  storage.setItem('sportzone-ad:ad-1', '"a string"')
  assert.equal(readAdRecord(storage, 'ad-1', START), null)
  storage.setItem('sportzone-ad:ad-1', JSON.stringify({ state: 'unknown', at: START }))
  assert.equal(readAdRecord(storage, 'ad-1', START), null)
  storage.setItem('sportzone-ad:ad-1', JSON.stringify({ state: 'dismissed', at: 'soon' }))
  assert.equal(readAdRecord(storage, 'ad-1', START), null)
})

test('unavailable storage never throws', () => {
  const throwingStorage: StorageLike = {
    getItem: () => { throw new Error('blocked') },
    setItem: () => { throw new Error('blocked') },
    removeItem: () => { throw new Error('blocked') },
  }
  assert.equal(readAdRecord(throwingStorage, 'ad-1', START), null)
  assert.doesNotThrow(() => recordAdDismissal(throwingStorage, 'ad-1', START))
  assert.doesNotThrow(() => recordAdCompletion(throwingStorage, 'ad-1', START))
})

test('stale records expire so an ad can never be blocked forever', () => {
  const storage = createMemoryStorage()
  recordAdCompletion(storage, 'ad-1', START)
  const later = START + AD_RECORD_MAX_AGE_MS + 1
  assert.equal(readAdRecord(storage, 'ad-1', later), null)
  assert.deepEqual(storage.dump(), {})
})

test('eligibility respects entitlement, completion and dismissal cooldown', () => {
  const nowMs = START
  const base = { nowMs, isPremium: false, hasActiveUnlock: false }
  assert.equal(AD_DISMISSAL_COOLDOWN_MS, 6 * 60 * 60 * 1000)
  assert.equal(AD_COMPLETION_GRACE_MS < AD_DISMISSAL_COOLDOWN_MS, true)
  assert.equal(shouldAutoOpenAd(null, base), true)
  assert.equal(shouldAutoOpenAd({ state: 'completed', at: nowMs }, base), false)
  assert.equal(shouldAutoOpenAd({ state: 'completed', at: nowMs - AD_COMPLETION_GRACE_MS - 1 }, base), true)
  assert.equal(shouldAutoOpenAd({ state: 'completed', at: nowMs }, { ...base, completionGraceMs: 0 }), true)
  assert.equal(shouldAutoOpenAd({ state: 'dismissed', at: nowMs }, base), false)
  assert.equal(shouldAutoOpenAd({ state: 'dismissed', at: nowMs - AD_DISMISSAL_COOLDOWN_MS - 1 }, base), true)
  assert.equal(shouldAutoOpenAd(null, { ...base, isPremium: true }), false)
  assert.equal(shouldAutoOpenAd(null, { ...base, hasActiveUnlock: true }), false)
  assert.equal(shouldAutoOpenAd({ state: 'dismissed', at: nowMs }, { ...base, dismissalCooldownMs: 0 }), true)
})

test('ad storage access degrades to null instead of throwing', () => {
  const originalWindow = (globalThis as { window?: unknown }).window
  try {
    delete (globalThis as { window?: unknown }).window
    assert.equal(getAdStorage(), null)
  } finally {
    if (originalWindow !== undefined) (globalThis as { window?: unknown }).window = originalWindow
  }
})

// ---------------------------------------------------------------------------------------------
// Countdown clock: single completion, teardown, throttling
// ---------------------------------------------------------------------------------------------

function createManualScheduler(startAtMs: number) {
  let nowMs = startAtMs
  let timeoutHandler: (() => void) | null = null
  let intervalHandler: (() => void) | null = null
  let clearedTimeouts = 0
  let clearedIntervals = 0
  const scheduler: AdVisitClockScheduler = {
    now: () => nowMs,
    setTimeout: (handler) => { timeoutHandler = handler; return 1 },
    clearTimeout: () => { if (timeoutHandler) { timeoutHandler = null; clearedTimeouts += 1 } },
    setInterval: (handler) => { intervalHandler = handler; return 2 },
    clearInterval: () => { if (intervalHandler) { intervalHandler = null; clearedIntervals += 1 } },
  }
  return {
    scheduler,
    setNow: (value: number) => { nowMs = value },
    hasTimeout: () => timeoutHandler !== null,
    hasInterval: () => intervalHandler !== null,
    runTimeout: () => timeoutHandler?.(),
    runIntervalTick: () => intervalHandler?.(),
    clearedTimeouts: () => clearedTimeouts,
    clearedIntervals: () => clearedIntervals,
  }
}

test('the clock never completes before the configured duration', () => {
  const manual = createManualScheduler(START)
  let elapsed = 0
  const ticks: number[] = []
  startAdVisitClock({ startedAtMs: START, durationSeconds: 10, scheduler: manual.scheduler, onTick: (value) => ticks.push(value), onElapsed: () => { elapsed += 1 } })

  assert.deepEqual(ticks, [10])
  manual.setNow(START + 9_000)
  manual.runIntervalTick()
  assert.equal(elapsed, 0)
  assert.equal(ticks[ticks.length - 1], 1)
  manual.setNow(START + 9_999)
  manual.runIntervalTick()
  assert.equal(elapsed, 0)
})

test('the clock completes exactly once at the configured duration and stops its timers', () => {
  const manual = createManualScheduler(START)
  let elapsed = 0
  startAdVisitClock({ startedAtMs: START, durationSeconds: 10, scheduler: manual.scheduler, onTick: () => {}, onElapsed: () => { elapsed += 1 } })

  manual.setNow(START + 10_000)
  manual.runIntervalTick()
  assert.equal(elapsed, 1)
  assert.equal(manual.hasTimeout(), false)
  assert.equal(manual.hasInterval(), false)
  // The deadline handler can still be queued by the browser; it must not complete a second time.
  manual.runTimeout()
  manual.runIntervalTick()
  assert.equal(elapsed, 1)
})

test('a throttled interval still completes through the deadline timeout', () => {
  const manual = createManualScheduler(START)
  let elapsed = 0
  startAdVisitClock({ startedAtMs: START, durationSeconds: 10, scheduler: manual.scheduler, onTick: () => {}, onElapsed: () => { elapsed += 1 } })
  manual.setNow(START + 30_000)
  manual.runTimeout()
  assert.equal(elapsed, 1)
  assert.equal(manual.clearedTimeouts() + manual.clearedIntervals(), 2)
})

test('unmounting the countdown clears its timers and cannot complete afterwards', () => {
  const manual = createManualScheduler(START)
  let elapsed = 0
  const stop = startAdVisitClock({ startedAtMs: START, durationSeconds: 10, scheduler: manual.scheduler, onTick: () => {}, onElapsed: () => { elapsed += 1 } })
  assert.equal(manual.hasTimeout(), true)
  assert.equal(manual.hasInterval(), true)

  stop()
  assert.equal(manual.hasTimeout(), false)
  assert.equal(manual.hasInterval(), false)
  assert.equal(manual.clearedTimeouts(), 1)
  assert.equal(manual.clearedIntervals(), 1)

  manual.setNow(START + 60_000)
  manual.runTimeout()
  manual.runIntervalTick()
  assert.equal(elapsed, 0)
  assert.doesNotThrow(() => stop())
})

test('a zero/invalid duration completes immediately without waiting', () => {
  for (const duration of [0, -3, Number.NaN, 'nope']) {
    const manual = createManualScheduler(START)
    let elapsed = 0
    const stop = startAdVisitClock({ startedAtMs: START, durationSeconds: duration, scheduler: manual.scheduler, onTick: () => {}, onElapsed: () => { elapsed += 1 } })
    assert.equal(elapsed, 1, `duration ${String(duration)}`)
    assert.equal(manual.hasTimeout(), false)
    assert.equal(manual.hasInterval(), false)
    stop()
  }
})
