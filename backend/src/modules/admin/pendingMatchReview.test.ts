import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  MAX_BULK_REVIEW_IDS,
  buildAcceptablePendingWhere,
  buildRejectablePendingWhere,
  classifyPendingReviewOutcome,
  summarizePendingReviewOutcomes,
} from './pendingMatchReview.js'

const NOW = new Date('2026-10-10T12:00:00.000Z')
const FUTURE = new Date('2026-10-11T12:00:00.000Z')
const PAST = new Date('2026-10-09T12:00:00.000Z')

const row = (overrides: Partial<{ status: string; deletedAt: Date | null; kickoffAt: Date }> = {}) => ({
  status: 'PENDING',
  deletedAt: null,
  kickoffAt: FUTURE,
  ...overrides,
})

test('an accept only touches a live, not-yet-started pending row', () => {
  assert.deepEqual(buildAcceptablePendingWhere('match-1', NOW), {
    id: 'match-1',
    status: 'PENDING',
    deletedAt: null,
    kickoffAt: { gt: NOW },
  })
})

test('a bulk accept uses the same condition for every requested id', () => {
  assert.deepEqual(buildAcceptablePendingWhere(['a', 'b'], NOW).id, { in: ['a', 'b'] })
  assert.deepEqual(buildAcceptablePendingWhere(['a', 'b'], NOW).kickoffAt, { gt: NOW })
})

test('a reject retires a pending row even after its kickoff, so the queue stays cleanable', () => {
  const where = buildRejectablePendingWhere('match-1')

  assert.equal(where.status, 'PENDING')
  assert.equal(where.deletedAt, null)
  assert.equal('kickoffAt' in where, false, 'expiry must not block a reject')
})

test('classifies an accepted fixture as accepted only when the row really moved', () => {
  assert.equal(classifyPendingReviewOutcome(row(), row({ status: 'UPCOMING' }), 'accept', NOW), 'accepted')
})

test('classifies a fixture whose kickoff has passed as ineligible, not accepted', () => {
  const expired = row({ kickoffAt: PAST })

  assert.equal(classifyPendingReviewOutcome(expired, expired, 'accept', NOW), 'ineligible')
  // Kickoff exactly at "now" has started, so it is ineligible too.
  assert.equal(classifyPendingReviewOutcome(row({ kickoffAt: NOW }), row({ kickoffAt: NOW }), 'accept', NOW), 'ineligible')
  // ... and a reject is still allowed for exactly that row.
  assert.equal(
    classifyPendingReviewOutcome(row({ kickoffAt: NOW }), row({ kickoffAt: NOW, status: 'REJECTED', deletedAt: NOW }), 'reject', NOW),
    'rejected',
  )
})

test('an already published or already rejected fixture is a repeat, not a new decision', () => {
  assert.equal(classifyPendingReviewOutcome(row({ status: 'UPCOMING' }), row({ status: 'UPCOMING' }), 'accept', NOW), 'already_processed')
  assert.equal(classifyPendingReviewOutcome(row({ status: 'REJECTED' }), row({ status: 'REJECTED' }), 'accept', NOW), 'already_processed')
  assert.equal(classifyPendingReviewOutcome(row({ status: 'LIVE' }), row({ status: 'LIVE' }), 'accept', NOW), 'already_processed')
  assert.equal(classifyPendingReviewOutcome(row({ deletedAt: NOW }), row({ deletedAt: NOW }), 'accept', NOW), 'already_processed')
})

test('a repeated reject is idempotent', () => {
  assert.equal(classifyPendingReviewOutcome(row(), row({ status: 'REJECTED', deletedAt: NOW }), 'reject', NOW), 'rejected')
  assert.equal(
    classifyPendingReviewOutcome(row({ status: 'REJECTED', deletedAt: NOW }), row({ status: 'REJECTED', deletedAt: NOW }), 'reject', NOW),
    'already_processed',
  )
})

test('separates an unknown id from a row the update could not change', () => {
  assert.equal(classifyPendingReviewOutcome(null, null, 'accept', NOW), 'missing')
  assert.equal(classifyPendingReviewOutcome(null, null, 'reject', NOW), 'missing')
  // A pending row that the conditional update skipped is a failure, not a success.
  assert.equal(classifyPendingReviewOutcome(row(), row(), 'accept', NOW), 'failed')
  assert.equal(classifyPendingReviewOutcome(row(), row(), 'reject', NOW), 'failed')
})

test('groups the per-item outcomes for the bulk response', () => {
  assert.deepEqual(summarizePendingReviewOutcomes([
    'accepted',
    'accepted',
    'rejected',
    'already_processed',
    'ineligible',
    'missing',
    'failed',
  ]), {
    requested: 7,
    accepted: 2,
    rejected: 1,
    alreadyProcessed: 1,
    ineligible: 1,
    missing: 1,
    failed: 1,
  })
})

test('an empty batch summarizes to zeros rather than undefined counts', () => {
  assert.deepEqual(summarizePendingReviewOutcomes([]), {
    requested: 0,
    accepted: 0,
    rejected: 0,
    alreadyProcessed: 0,
    ineligible: 0,
    missing: 0,
    failed: 0,
  })
})

test('the bulk cap stays bounded so one request cannot fan out unboundedly', () => {
  assert.equal(MAX_BULK_REVIEW_IDS, 200)
})
