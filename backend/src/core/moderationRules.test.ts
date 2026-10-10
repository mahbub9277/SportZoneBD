import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  REPORT_CATEGORIES,
  REPORT_STATUSES,
  allowedReportTransitions,
  canReviewSubmission,
  canTransitionReportStatus,
  isPaymentReviewAction,
  isReportCategory,
  isReportStatus,
  requiresReportReason,
} from './moderationRules.js'

test('the report vocabulary is exactly the one the data model already has', () => {
  assert.deepEqual([...REPORT_CATEGORIES], ['Bug', 'Playback', 'Payment', 'Account', 'Content'])
  assert.deepEqual([...REPORT_STATUSES], ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'])
  assert.equal(isReportCategory('Bug'), true)
  assert.equal(isReportCategory('Something else'), false)
  assert.equal(isReportStatus('RESOLVED'), true)
  assert.equal(isReportStatus('resolved'), false)
})

test('a report only moves along the transitions the policy allows', () => {
  assert.equal(canTransitionReportStatus('OPEN', 'IN_PROGRESS'), true)
  assert.equal(canTransitionReportStatus('OPEN', 'RESOLVED'), true)
  assert.equal(canTransitionReportStatus('IN_PROGRESS', 'RESOLVED'), true)
  assert.equal(canTransitionReportStatus('RESOLVED', 'CLOSED'), true)
  assert.equal(canTransitionReportStatus('CLOSED', 'OPEN'), true)

  assert.equal(canTransitionReportStatus('RESOLVED', 'OPEN'), false, 'a resolved report is not reopened as untouched')
  assert.equal(canTransitionReportStatus('CLOSED', 'RESOLVED'), false, 'a closed report is reopened before it is reworked')
  assert.equal(canTransitionReportStatus('NONSENSE', 'OPEN'), false)
})

test('resolving or closing a report twice is refused rather than silently repeated', () => {
  for (const status of REPORT_STATUSES) {
    assert.equal(canTransitionReportStatus(status, status), false, `${status} must not move to itself`)
  }
})

test('the client can be told which moves are allowed and which need a reason', () => {
  assert.deepEqual(allowedReportTransitions('OPEN').sort(), ['CLOSED', 'IN_PROGRESS', 'RESOLVED'])
  assert.deepEqual(allowedReportTransitions('CLOSED'), ['OPEN'])
  assert.deepEqual(allowedReportTransitions('unknown'), [])

  assert.equal(requiresReportReason('CLOSED'), true)
  assert.equal(requiresReportReason('RESOLVED'), false)
  assert.equal(requiresReportReason('IN_PROGRESS'), false)
})

test('a payment reviewer cannot decide a submission that is their own', () => {
  assert.equal(canReviewSubmission('staff-1', 'customer-9'), true)
  assert.equal(canReviewSubmission('staff-1', 'staff-1'), false, 'self-review is refused')
  assert.equal(canReviewSubmission(undefined, 'customer-9'), false)
  assert.equal(canReviewSubmission('staff-1', null), false)
})

test('only the two supported review actions are accepted', () => {
  assert.equal(isPaymentReviewAction('approve'), true)
  assert.equal(isPaymentReviewAction('reject'), true)
  assert.equal(isPaymentReviewAction('refund'), false)
  assert.equal(isPaymentReviewAction(undefined), false)
})
