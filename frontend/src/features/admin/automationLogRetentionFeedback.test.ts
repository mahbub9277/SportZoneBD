import assert from 'node:assert/strict'
import test from 'node:test'
import { describeRetentionFailure, describeRetentionOutcome } from './automationLogRetentionFeedback.ts'

/** The four outcomes the dashboard must tell apart, plus the failure case that must never look like one. */

const base = {
  cutoff: '2026-09-18T12:00:00.000Z',
  retentionDays: 30,
  batchSize: 5000,
  maxPerRequest: 50000,
  batches: 1,
}

test('a completed cleanup reports success with the confirmed count', () => {
  const feedback = describeRetentionOutcome({ ...base, deletedCount: 25661, remainingCount: 0, complete: true })

  assert.equal(feedback.tone, 'success')
  assert.match(feedback.title, /25,661/)
  assert.match(String(feedback.description), /older than 30 days/)
  assert.match(String(feedback.description), /Recent logs are untouched/)
})

test('a cleanup that stops at the per-request ceiling reports the rows that remain', () => {
  const feedback = describeRetentionOutcome({ ...base, deletedCount: 50000, remainingCount: 12000, complete: false })

  assert.equal(feedback.tone, 'info', 'an incomplete run is progress, not an unqualified success')
  assert.match(feedback.title, /50,000/)
  assert.match(String(feedback.description), /12,000/)
  assert.match(String(feedback.description), /Run the cleanup again/)
})

test('a cleanup with nothing to delete says so and does not claim a deletion', () => {
  const feedback = describeRetentionOutcome({ ...base, deletedCount: 0, remainingCount: 0, complete: true, batches: 0 })

  assert.equal(feedback.tone, 'info')
  assert.match(feedback.title, /No automation logs are older than 30 days/)
  assert.match(String(feedback.description), /Nothing was deleted/)
})

test('a run that deleted nothing while records remain does not claim completion', () => {
  const feedback = describeRetentionOutcome({ ...base, deletedCount: 0, remainingCount: 7, complete: false })

  assert.equal(feedback.tone, 'info')
  assert.match(feedback.title, /No logs were deleted/)
  assert.match(String(feedback.description), /7 older records/)
})

test('the count is pluralised correctly', () => {
  assert.match(describeRetentionOutcome({ ...base, deletedCount: 1, remainingCount: 0, complete: true }).title, /1 automation log$/)
  assert.match(describeRetentionOutcome({ ...base, deletedCount: 2, remainingCount: 0, complete: true }).title, /2 automation logs$/)
  assert.match(
    String(describeRetentionOutcome({ ...base, deletedCount: 1, remainingCount: 1, complete: false }).description),
    /1 older record remains/,
  )
  assert.match(
    String(describeRetentionOutcome({ ...base, deletedCount: 1, remainingCount: 4, complete: false }).description),
    /4 older records remain/,
  )
})

test('a request that failed is never presented as a success', () => {
  const feedback = describeRetentionFailure({
    status: 500,
    data: {
      success: false,
      message: 'The cleanup could not be completed. The counts below are what the database currently holds.',
      error: { cutoff: base.cutoff, deletedCount: 5000, remainingCount: 20000, complete: false, retentionDays: 30 },
    },
  })

  assert.equal(feedback.tone, 'error')
  assert.match(feedback.title, /did not finish/)
  // The counts the database confirmed before the failure are shown, next to the failure wording.
  assert.match(String(feedback.description), /5,000 deleted/)
  assert.match(String(feedback.description), /20,000 still eligible/)
  assert.match(String(feedback.description), /could not be completed/)
})

test('a failure with no structured payload still reports an error', () => {
  for (const error of [
    { status: 'FETCH_ERROR', error: 'TypeError: Failed to fetch' },
    new Error('network down'),
    undefined,
    null,
  ]) {
    const feedback = describeRetentionFailure(error)
    assert.equal(feedback.tone, 'error', `expected the error tone for ${String(error)}`)
    assert.doesNotMatch(feedback.title, /deleted/i, 'a failure must not be titled like a completed deletion')
  }
})

test('an unknown remaining count is not shown as zero on failure', () => {
  const feedback = describeRetentionFailure({
    status: 500,
    data: {
      success: false,
      message: 'The cleanup could not be completed.',
      error: { cutoff: base.cutoff, deletedCount: 12, remainingCount: null, complete: false, retentionDays: 30 },
    },
  })

  assert.equal(feedback.tone, 'error')
  assert.match(String(feedback.description), /12 deleted/)
  assert.doesNotMatch(String(feedback.description), /still eligible/, 'null means unknown, so no count is invented')
})
