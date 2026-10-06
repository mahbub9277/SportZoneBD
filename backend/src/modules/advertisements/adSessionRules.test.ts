import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  decideSessionCompletion,
  hasViewingTimeElapsed,
  isUnlockStillValid,
  normalizeUnlockHours,
  unlockExpiresAtMs,
  viewingDurationMs,
  type AdSessionSnapshot,
} from './adSessionRules.js'

const STARTED_AT = new Date('2026-05-01T10:00:00.000Z')
const TOKEN_HASH = 'hash-of-session-token'

function buildSession(overrides: Partial<AdSessionSnapshot> = {}): AdSessionSnapshot {
  return {
    sessionTokenHash: TOKEN_HASH,
    canceledAt: null,
    completedAt: null,
    unlockExpiresAt: null,
    startedAt: STARTED_AT,
    durationSeconds: 15,
    userId: null,
    advertisementUnavailable: false,
    ...overrides,
  }
}

const context = { sessionTokenHash: TOKEN_HASH, nowMs: STARTED_AT.getTime() + 15_000 }

// ---------------------------------------------------------------------------------------------
// Durations are seconds, never milliseconds
// ---------------------------------------------------------------------------------------------

test('viewing duration is interpreted as whole seconds', () => {
  assert.equal(viewingDurationMs(15), 15_000)
  assert.equal(viewingDurationMs('15'), 15_000)
  assert.equal(viewingDurationMs(15.9), 15_000)
  assert.equal(viewingDurationMs(0), 0)
  assert.equal(viewingDurationMs(-5), 0)
  assert.equal(viewingDurationMs(Number.NaN), 0)
  assert.equal(viewingDurationMs(undefined), 0)
})

test('unlock hours only accept 12 or 24 and default to the longer window', () => {
  assert.equal(normalizeUnlockHours(12), 12)
  assert.equal(normalizeUnlockHours(24), 24)
  assert.equal(normalizeUnlockHours(1), 24)
  assert.equal(normalizeUnlockHours('12'), 12)
  assert.equal(normalizeUnlockHours(null), 24)
  assert.equal(unlockExpiresAtMs(0, 12), 12 * 60 * 60 * 1000)
  assert.equal(unlockExpiresAtMs(0, 24), 24 * 60 * 60 * 1000)
})

test('viewing time is only elapsed once the full duration has passed', () => {
  const startedAtMs = STARTED_AT.getTime()
  assert.equal(hasViewingTimeElapsed(startedAtMs, 15, startedAtMs), false)
  assert.equal(hasViewingTimeElapsed(startedAtMs, 15, startedAtMs + 14_999), false)
  assert.equal(hasViewingTimeElapsed(startedAtMs, 15, startedAtMs + 15_000), true)
  assert.equal(hasViewingTimeElapsed(startedAtMs, 15, startedAtMs + 60_000), true)
  assert.equal(hasViewingTimeElapsed(startedAtMs, 0, startedAtMs), true)
})

// ---------------------------------------------------------------------------------------------
// Completion decision
// ---------------------------------------------------------------------------------------------

test('a valid session becomes completable exactly at the configured duration', () => {
  assert.equal(decideSessionCompletion(buildSession(), context).kind, 'completable')
  assert.equal(decideSessionCompletion(buildSession(), { ...context, nowMs: STARTED_AT.getTime() + 14_999 }).kind, 'too-early')
})

test('identity, cancellation and advertisement state are validated', () => {
  assert.equal(decideSessionCompletion(buildSession(), { ...context, sessionTokenHash: 'other' }).kind, 'invalid')
  assert.equal(decideSessionCompletion(buildSession({ sessionTokenHash: '' }), context).kind, 'invalid')
  assert.equal(decideSessionCompletion(buildSession({ canceledAt: new Date() }), context).kind, 'invalid')
  assert.equal(decideSessionCompletion(buildSession({ advertisementUnavailable: true }), context).kind, 'invalid')
  assert.equal(decideSessionCompletion(buildSession({ userId: 'user-1' }), { ...context, userId: 'user-2' }).kind, 'invalid')
  assert.equal(decideSessionCompletion(buildSession({ userId: 'user-1' }), { ...context, userId: 'user-1' }).kind, 'completable')
  // A guest session stays completable for a signed-in account.
  assert.equal(decideSessionCompletion(buildSession(), { ...context, userId: 'user-1' }).kind, 'completable')
})

test('an already completed session is replayed idempotently instead of completing twice', () => {
  const unlockExpiresAt = new Date(STARTED_AT.getTime() + 12 * 60 * 60 * 1000)
  const decision = decideSessionCompletion(buildSession({ completedAt: new Date(), unlockExpiresAt }), context)
  assert.equal(decision.kind, 'already-completed')
  assert.equal(decision.kind === 'already-completed' ? decision.unlockExpiresAt : null, unlockExpiresAt)
  // Even long after the duration, a completed session never becomes completable again.
  assert.equal(decideSessionCompletion(buildSession({ completedAt: new Date(), unlockExpiresAt }), { ...context, nowMs: STARTED_AT.getTime() + 5 * 60 * 60 * 1000 }).kind, 'already-completed')
})

test('a session with a completion timestamp but no unlock is not treated as completed', () => {
  const decision = decideSessionCompletion(buildSession({ completedAt: new Date() }), context)
  assert.equal(decision.kind, 'completable')
})

test('unlock validity is time based', () => {
  const expiresAt = new Date(STARTED_AT.getTime() + 1_000)
  assert.equal(isUnlockStillValid(expiresAt, STARTED_AT.getTime()), true)
  assert.equal(isUnlockStillValid(expiresAt, expiresAt.getTime()), false)
  assert.equal(isUnlockStillValid(null, STARTED_AT.getTime()), false)
  assert.equal(isUnlockStillValid(undefined, STARTED_AT.getTime()), false)
})
