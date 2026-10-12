/**
 * Verifying a payment with the transaction reference the customer made the payment with.
 *
 * This is the second, documented way to prove a payment: the customer tells us their bKash transaction ID and
 * the provider's Advanced Transaction Verification API tells us whether that transaction exists, what it was for
 * and whether anybody has already consumed it. It exists beside the hosted-invoice flow, not instead of it:
 * the invoice check stays authoritative whenever an invoice can answer, and this path only ever looks at a
 * payment that is still open and belongs to the caller.
 *
 * Two invariants are worth stating plainly, because everything below is arranged around them:
 *
 * 1. Nothing the customer sends is treated as proof. The amount is the stored plan amount, the transaction must
 *    be `UNUSED` on the provider's side, its amount must equal ours, and the provider must then *permanently
 *    consume* it before Premium is activated. A Submit button can therefore never grant access by itself.
 * 2. Premium is still activated by the same compare-and-set as every other path
 *    (`applyApprovedPayment`), so a transaction verification racing a webhook or a customer return page still
 *    activates exactly once — and a lost race is reported as success, not as an error.
 */
import { prisma } from '../../core/prisma.js'
import type { Prisma } from '@prisma/client'
import { AppError } from '../../core/errors.js'
import logger from '../../core/logger.js'
import { invalidateTags } from '../../core/cache.js'
import { applyApprovedPayment, type ApprovalContext } from './paymentWorkflow.js'
import { maskReference } from './referenceMask.js'
import {
  buildTrxEvidence,
  readTrxEvidence,
  toAdminEvidenceView,
  withTrxEvidence,
  type TrxVerificationEvidence,
} from './providerEvidence.js'
import {
  ZiniPayTrxFailure,
  confirmZiniPayTransaction,
  isTrxVerificationConfigured,
  verifyZiniPayTransaction,
  type ZiniPayTrxDeps,
} from './zinipay.trx.client.js'

/** How many times one payment may be sent to the provider before a human has to look at it. */
const MAX_TRX_ATTEMPTS = 5

/** Transaction references are short alphanumeric strings; anything else is refused before a credit is spent. */
const MIN_REFERENCE_LENGTH = 6
const MAX_REFERENCE_LENGTH = 40

export interface TrxVerificationDeps extends ZiniPayTrxDeps {
  verifyTransaction?: typeof verifyZiniPayTransaction
  confirmTransaction?: typeof confirmZiniPayTransaction
}

export interface TrxVerificationResult {
  paymentId: string
  /** True only when the provider consumed the transaction and Premium was (or already had been) activated. */
  activated: boolean
  status: 'CONFIRMED' | 'PENDING'
  message: string
  /** Sanitized evidence, with every reference masked. */
  evidence: ReturnType<typeof toAdminEvidenceView>
}

interface PaymentRow {
  id: string
  userId: string
  provider: string
  status: string
  amount: string
  currency: string
  providerPaymentId: string | null
  transactionId: string
  providerVerification: unknown
  subscriptionPlanId: string | null
  subscriptionPlan: { name: string; durationDays: number } | null
}

/** Trims the customer's reference without changing any character that might be meaningful to the provider. */
export function normalizeTransactionReference(value: unknown): string {
  if (typeof value !== 'string') {
    throw new AppError(400, 'A transaction ID is required.')
  }
  const normalized = value.trim().replace(/\s+/g, '')
  if (normalized.length < MIN_REFERENCE_LENGTH || normalized.length > MAX_REFERENCE_LENGTH) {
    throw new AppError(400, 'That transaction ID does not look like a payment reference. Please check it and try again.')
  }
  if (!/^[A-Za-z0-9-]+$/.test(normalized)) {
    throw new AppError(400, 'A transaction ID may only contain letters, numbers and dashes.')
  }
  return normalized
}

function statusForFailure(failure: ZiniPayTrxFailure): number {
  switch (failure.kind) {
    case 'timeout':
      return 504
    case 'network':
    case 'provider-error':
    case 'malformed':
      return 502
    case 'amount-mismatch':
    case 'not-found':
    case 'invalid-request':
      return 422
    case 'already-used':
      return 409
    default:
      // not-enabled, not-configured, feature-disabled, no-credits, device-offline
      return 503
  }
}

async function loadPayment(paymentId: string): Promise<PaymentRow | null> {
  const payment = await prisma.payment.findFirst({
    where: { id: paymentId, deletedAt: null },
    select: {
      id: true,
      userId: true,
      provider: true,
      status: true,
      amount: true,
      currency: true,
      providerPaymentId: true,
      transactionId: true,
      providerVerification: true,
      subscriptionPlanId: true,
      subscriptionPlan: { select: { name: true, durationDays: true } },
    },
  })
  if (!payment) return null
  return { ...payment, amount: payment.amount.toString() }
}

/**
 * Writes the transaction-verification facts without touching anything that decides access.
 *
 * `providerVerification` is evidence: this never sets `status`, never activates Premium and never erases the
 * invoice facts recorded beside it.
 */
async function storeTrxEvidence(payment: PaymentRow, trx: TrxVerificationEvidence): Promise<void> {
  await prisma.payment.update({
    where: { id: payment.id },
    data: {
      providerVerification: withTrxEvidence(payment.providerVerification, trx) as unknown as Prisma.InputJsonValue,
    },
  })
}

/**
 * Verifies the customer's transaction reference for one of their open payments, and activates Premium only if
 * the provider confirms and consumes it.
 */
export async function verifyPaymentTransaction(
  args: { paymentId: string; userId: string; transactionId: unknown },
  deps: TrxVerificationDeps = {},
): Promise<TrxVerificationResult> {
  const env = deps.env ?? process.env
  const verifyTransaction = deps.verifyTransaction ?? verifyZiniPayTransaction
  const confirmTransaction = deps.confirmTransaction ?? confirmZiniPayTransaction

  const reference = normalizeTransactionReference(args.transactionId)

  const payment = await loadPayment(args.paymentId)
  if (!payment) throw new AppError(404, 'Payment not found.')
  // A payment that belongs to somebody else is reported as missing rather than as forbidden.
  if (payment.userId !== args.userId) throw new AppError(404, 'Payment not found.')

  if (payment.provider !== 'zinipay') {
    throw new AppError(400, 'This payment was not made through the online checkout, so there is nothing to verify here.')
  }
  if (payment.status === 'APPROVED' || payment.status === 'COMPLETED') {
    return {
      paymentId: payment.id,
      activated: true,
      status: 'CONFIRMED',
      message: 'This payment is already confirmed and your premium access is active.',
      evidence: toAdminEvidenceView(null, readTrxEvidence(payment.providerVerification)),
    }
  }
  if (payment.status !== 'PENDING') {
    throw new AppError(409, `This payment is ${payment.status.toLowerCase()} and can no longer be verified online. Please contact support.`)
  }
  if (!payment.providerPaymentId) {
    throw new AppError(400, 'This payment never reached the payment provider, so a transaction cannot be matched to it. Start the payment again.')
  }
  if (!isTrxVerificationConfigured(env)) {
    throw new AppError(503, 'Transaction ID verification is not switched on for this store yet.')
  }

  const previous = readTrxEvidence(payment.providerVerification)

  // A transaction we already consumed for this payment must not be verified again: the provider would refuse
  // it (it is spent) and a second attempt would only spend another credit. If activation failed after the
  // confirm — a database hiccup, not a payment problem — finishing it here is safe, because the transaction
  // was already consumed for this very payment.
  if (previous?.confirmStatus === 'CONFIRMED') {
    await activateIfStillPending(payment)
    return {
      paymentId: payment.id,
      activated: true,
      status: 'CONFIRMED',
      message: 'Payment verified and your subscription is now active.',
      evidence: toAdminEvidenceView(null, previous),
    }
  }

  if ((previous?.attempts ?? 0) >= MAX_TRX_ATTEMPTS) {
    throw new AppError(429, 'This payment has been checked several times already. Please contact support with your transaction ID so a human can review it.')
  }

  const maskedReference = maskReference(reference)
  const amount = Number(payment.amount)

  const failureRecord = async (failure: { kind: string; note?: string | null }, confirmStatus?: TrxVerificationEvidence['confirmStatus']) => {
    const trx = buildTrxEvidence(
      { referenceMasked: maskedReference, previous, confirmStatus, failure },
      new Date(),
    )
    await storeTrxEvidence(payment, trx)
    return trx
  }

  // Step one: does the provider know this transaction, and is it unused and for our amount?
  let verified
  try {
    verified = await verifyTransaction({ transactionId: reference, amount }, { env, http: deps.http, timeoutMs: deps.timeoutMs })
  } catch (error) {
    const failure = error instanceof ZiniPayTrxFailure ? error : null
    const kind = failure?.kind ?? 'provider-error'
    await failureRecord({ kind, note: failure?.message ?? 'unexpected error' })
    logger.warn({ paymentId: payment.id, kind, status: failure?.status ?? null }, 'ZiniPay transaction verification refused')
    throw new AppError(statusForFailure(failure ?? new ZiniPayTrxFailure('provider-error', null)), failure?.userMessage ?? 'The payment provider is temporarily unavailable. Nothing was activated.')
  }

  // The provider's own amount must equal the amount this payment is for; a mismatch is never confirmed.
  if (Math.round(verified.amount * 100) !== Math.round(amount * 100)) {
    await failureRecord({ kind: 'amount-mismatch', note: 'the verified transaction amount differs from the stored payment amount' })
    logger.error({ paymentId: payment.id, expected: amount }, 'ZiniPay transaction amount does not match the stored payment')
    throw new AppError(422, 'That transaction is for a different amount, so it does not match this purchase. Nothing was activated.')
  }

  const verifySnapshot = {
    providerTransactionId: verified.id,
    amount: verified.amount,
    provider: verified.provider,
    senderMasked: verified.senderMasked,
    status: verified.status,
  }

  // Step two: consume the transaction. Until this succeeds nothing may be activated, because an unconsumed
  // transaction could still be presented again.
  try {
    await confirmTransaction({ transactionId: verified.transactionId, amount: verified.amount, id: verified.id }, { env, http: deps.http, timeoutMs: deps.timeoutMs })
  } catch (error) {
    const failure = error instanceof ZiniPayTrxFailure ? error : null
    const ambiguous = failure?.isAmbiguous ?? true
    // One record, written once: the transaction the provider identified, plus how the confirm ended.
    const failedTrx = buildTrxEvidence(
      {
        referenceMasked: maskedReference,
        previous,
        verify: verifySnapshot,
        confirmStatus: ambiguous ? 'AMBIGUOUS' : 'FAILED',
        failure: {
          kind: failure?.kind ?? 'provider-error',
          note: ambiguous
            ? 'the provider may or may not have consumed this transaction'
            : (failure?.message ?? 'confirm failed'),
        },
      },
      new Date(),
    )
    await storeTrxEvidence(payment, failedTrx)
    logger.error(
      { paymentId: payment.id, kind: failure?.kind ?? 'provider-error', ambiguous },
      'ZiniPay transaction could not be confirmed, so premium was not activated',
    )
    throw new AppError(
      statusForFailure(failure ?? new ZiniPayTrxFailure('provider-error', null)),
      ambiguous
        ? 'We could not finish confirming that transaction, so nothing was activated. Please contact support with your transaction ID before paying again.'
        : (failure?.userMessage ?? 'That transaction could not be confirmed, so nothing was activated.'),
    )
  }

  // Confirmed and consumed by the provider: record that first, then activate through the shared compare-and-set.
  const confirmedTrx = buildTrxEvidence(
    { referenceMasked: maskedReference, previous, verify: verifySnapshot, confirmStatus: 'CONFIRMED' },
    new Date(),
  )
  await storeTrxEvidence(payment, confirmedTrx)

  await activateIfStillPending(payment)

  await invalidateTags([`user:${payment.userId}`, 'user-list'])

  logger.info(
    { paymentId: payment.id, provider: verified.provider ?? 'unknown' },
    'ZiniPay transaction verified, confirmed and premium activated',
  )

  return {
    paymentId: payment.id,
    activated: true,
    status: 'CONFIRMED',
    message: 'Payment verified and your subscription is now active.',
    evidence: toAdminEvidenceView(null, confirmedTrx),
  }
}

/**
 * Grants the subscription for a payment whose transaction the provider already consumed.
 *
 * Activation is the shared compare-and-set, so a webhook or the return page racing this still activates exactly
 * once and a lost race is reported as success rather than as a second activation.
 */
async function activateIfStillPending(payment: PaymentRow): Promise<void> {
  if (!payment.subscriptionPlan || !payment.subscriptionPlanId) {
    throw new AppError(500, 'The payment is not linked to a subscription plan.')
  }

  const context: ApprovalContext = {
    paymentId: payment.id,
    userId: payment.userId,
    status: 'PENDING',
    amount: payment.amount,
    currency: payment.currency,
    transactionId: payment.transactionId,
    subscriptionPlanId: payment.subscriptionPlanId,
    planName: payment.subscriptionPlan.name,
    planDurationDays: payment.subscriptionPlan.durationDays,
  }

  try {
    await prisma.$transaction(async (tx) => {
      await applyApprovedPayment(tx, context, {
        reviewedBy: null,
        verificationResult: 'zinipay-trx-confirmed',
        // This path only ever starts from an open hosted payment.
        claimableStatuses: ['PENDING'],
      })
    })
  } catch (error) {
    if (error instanceof AppError && error.statusCode === 409) return
    throw error
  }
}

/** Whether this deployment may attempt transaction verification at all. */
export function isTransactionVerificationAvailable(env: NodeJS.ProcessEnv = process.env): boolean {
  return isTrxVerificationConfigured(env)
}
