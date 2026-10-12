import assert from 'node:assert/strict'
import { test } from 'node:test'
import { describeTrxVerification, MIN_REFERENCE_LENGTH } from './trxVerificationState.ts'

/**
 * The transaction-reference form is a customer-facing claim about money, so it is only shown when the backend
 * offers it, and it never reports a success the backend did not confirm.
 */

const base = {
  enabled: true,
  paymentStatus: 'PENDING',
  isVerifying: false,
  reference: 'TXN123456789',
  attempt: null,
  error: null,
} as Parameters<typeof describeTrxVerification>[0]

test('the form is only offered when the backend says the capability is on', () => {
  assert.equal(describeTrxVerification(base).visible, true)
  assert.equal(describeTrxVerification({ ...base, enabled: false }).visible, false)
  assert.equal(describeTrxVerification({ ...base, enabled: undefined }).visible, false, 'an older backend must not imply the capability')
})

test('the form is only offered for a payment that is still open', () => {
  assert.equal(describeTrxVerification({ ...base, paymentStatus: 'UNKNOWN' }).visible, true)

  // A decided payment is either already active or closed, and the backend refuses both.
  assert.equal(describeTrxVerification({ ...base, paymentStatus: 'COMPLETED' }).visible, false)
  assert.equal(describeTrxVerification({ ...base, paymentStatus: 'APPROVED' }).visible, false)
  assert.equal(describeTrxVerification({ ...base, paymentStatus: 'FAILED' }).visible, false)
  assert.equal(describeTrxVerification({ ...base, paymentStatus: 'CANCELLED' }).visible, false)
})

test('a reference that is too short cannot be submitted', () => {
  const short = 'x'.repeat(MIN_REFERENCE_LENGTH - 1)
  assert.equal(describeTrxVerification({ ...base, reference: short }).canSubmit, false)
  assert.equal(describeTrxVerification({ ...base, reference: `  ${short}  ` }).canSubmit, false)
  assert.equal(describeTrxVerification({ ...base, reference: 'x'.repeat(MIN_REFERENCE_LENGTH) }).canSubmit, true)
})

test('the button is disabled while a verification is running', () => {
  assert.equal(describeTrxVerification({ ...base, isVerifying: true }).canSubmit, false)
})

test('the outcome repeats the backend sentence and never invents a success', () => {
  const pending = describeTrxVerification({ ...base, attempt: { activated: false, message: 'We could not find that transaction yet.' } })
  assert.deepEqual(pending.outcome, { tone: 'pending', message: 'We could not find that transaction yet.' })

  const activated = describeTrxVerification({ ...base, attempt: { activated: true, message: 'Payment verified and your subscription is now active.' } })
  assert.deepEqual(activated.outcome, { tone: 'success', message: 'Payment verified and your subscription is now active.' })
})

test('a failure is shown as an error, and takes precedence over an earlier answer', () => {
  const view = describeTrxVerification({
    ...base,
    attempt: { activated: false, message: 'older pending answer' },
    error: 'That transaction is for a different amount, so it does not match this purchase.',
  })

  assert.deepEqual(view.outcome, { tone: 'error', message: 'That transaction is for a different amount, so it does not match this purchase.' })
})

test('nothing is shown before an attempt is made', () => {
  assert.equal(describeTrxVerification(base).outcome, null)
})
