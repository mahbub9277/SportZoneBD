import assert from 'node:assert/strict'
import { test } from 'node:test'
import { SESSION_IDLE_TIMEOUT_MS, computeSessionActivity, summarizeSessionActivity } from './sessionActivity.js'

const IDLE = 30 * 60 * 1000
const minutes = (count: number) => count * 60 * 1000

test('a session that was explicitly ended reports its exact duration', () => {
  const startedAt = new Date('2026-01-01T09:00:00.000Z')
  const endedAt = new Date('2026-01-01T12:30:00.000Z')

  const activity = computeSessionActivity({
    startedAt,
    lastSeenAt: new Date('2026-01-01T12:25:00.000Z'),
    endedAt,
    expiresAt: new Date('2026-01-31T09:00:00.000Z'),
    now: new Date('2026-01-01T13:00:00.000Z'),
  })

  assert.equal(activity.durationMs, minutes(210))
  assert.equal(activity.endSource, 'logout')
  assert.equal(activity.isEstimated, false)
  // The logout came well within the idle window of the last recorded activity, so the whole session
  // counts as active — the cap only removes idle time that is longer than the window.
  assert.equal(activity.activeMs, minutes(210), 'nothing is counted past the recorded end')
})

test('a session that reached its expiry stopped there, whatever the clock says now', () => {
  const startedAt = new Date('2026-01-01T09:00:00.000Z')
  const expiresAt = new Date('2026-01-01T10:00:00.000Z')

  const activity = computeSessionActivity({
    startedAt,
    lastSeenAt: new Date('2026-01-01T09:50:00.000Z'),
    endedAt: null,
    expiresAt,
    now: new Date('2026-02-01T00:00:00.000Z'),
  })

  assert.equal(activity.durationMs, minutes(60))
  assert.equal(activity.endSource, 'expiry')
  assert.equal(activity.isEstimated, false)
})

test('abandoned time after the idle window is never counted as work', () => {
  const startedAt = new Date('2026-01-01T09:00:00.000Z')
  const lastSeenAt = new Date('2026-01-01T09:20:00.000Z')

  const activity = computeSessionActivity({
    startedAt,
    lastSeenAt,
    endedAt: null,
    expiresAt: new Date('2026-01-31T09:00:00.000Z'),
    now: new Date('2026-01-02T09:00:00.000Z'),
    idleTimeoutMs: IDLE,
  })

  assert.equal(activity.endSource, 'idle')
  assert.equal(activity.isEstimated, true, 'an inferred end is reported as estimated')
  assert.equal(activity.durationMs, minutes(20) + IDLE, 'the session is closed one idle window after the last activity')
  assert.equal(activity.activeMs, minutes(20) + IDLE)
})

test('an open session counts up to now and is still flagged as estimated', () => {
  const startedAt = new Date('2026-01-01T09:00:00.000Z')

  const activity = computeSessionActivity({
    startedAt,
    lastSeenAt: new Date('2026-01-01T09:40:00.000Z'),
    endedAt: null,
    expiresAt: new Date('2026-01-31T09:00:00.000Z'),
    now: new Date('2026-01-01T09:45:00.000Z'),
    idleTimeoutMs: IDLE,
  })

  assert.equal(activity.endSource, 'active')
  assert.equal(activity.durationMs, minutes(45))
  assert.equal(activity.isEstimated, true)
})

test('a session whose last activity is missing falls back to its start instead of inventing time', () => {
  const startedAt = new Date('2026-01-01T09:00:00.000Z')

  const activity = computeSessionActivity({
    startedAt,
    // A row that was never touched after creation.
    lastSeenAt: startedAt,
    endedAt: null,
    expiresAt: new Date('2026-01-31T09:00:00.000Z'),
    now: new Date('2026-01-01T09:05:00.000Z'),
    idleTimeoutMs: IDLE,
  })

  assert.equal(activity.durationMs, minutes(5))
  assert.equal(activity.activeMs, minutes(5))
})

test('a logout after a long idle gap keeps the session length but not the idle time', () => {
  const startedAt = new Date('2026-01-01T09:00:00.000Z')
  const lastSeenAt = new Date('2026-01-01T09:10:00.000Z')
  const endedAt = new Date('2026-01-01T15:00:00.000Z')

  const activity = computeSessionActivity({
    startedAt,
    lastSeenAt,
    endedAt,
    expiresAt: new Date('2026-01-31T09:00:00.000Z'),
    now: new Date('2026-01-01T15:05:00.000Z'),
    idleTimeoutMs: IDLE,
  })

  assert.equal(activity.durationMs, minutes(360), 'the session really was open that long')
  assert.equal(activity.activeMs, minutes(10) + IDLE, 'only the last recorded activity and one idle window count')
})

test('a summary separates exact sessions from estimated ones and totals both', () => {
  const now = new Date('2026-01-01T12:00:00.000Z')
  const summary = summarizeSessionActivity(
    [
      {
        startedAt: new Date('2026-01-01T08:00:00.000Z'),
        lastSeenAt: new Date('2026-01-01T09:00:00.000Z'),
        endedAt: new Date('2026-01-01T09:00:00.000Z'),
        expiresAt: new Date('2026-01-31T08:00:00.000Z'),
      },
      {
        startedAt: new Date('2026-01-01T10:00:00.000Z'),
        lastSeenAt: new Date('2026-01-01T10:30:00.000Z'),
        endedAt: null,
        expiresAt: new Date('2026-01-31T10:00:00.000Z'),
      },
    ],
    { now, idleTimeoutMs: IDLE },
  )

  assert.equal(summary.sessionCount, 2)
  assert.equal(summary.exactSessionCount, 1)
  assert.equal(summary.estimatedSessionCount, 1)
  assert.equal(summary.totalDurationMs, minutes(60) + minutes(60))
  assert.equal(summary.totalActiveMs, minutes(60) + minutes(60))
  assert.equal(summary.lastSeenAt?.toISOString(), '2026-01-01T10:30:00.000Z')
})

test('an empty history summarises to zero rather than to a fabricated duration', () => {
  const summary = summarizeSessionActivity([], { now: new Date('2026-01-01T12:00:00.000Z') })

  assert.deepEqual(summary, {
    sessionCount: 0,
    exactSessionCount: 0,
    estimatedSessionCount: 0,
    totalDurationMs: 0,
    totalActiveMs: 0,
    lastSeenAt: null,
  })
  assert.equal(SESSION_IDLE_TIMEOUT_MS, IDLE)
})
