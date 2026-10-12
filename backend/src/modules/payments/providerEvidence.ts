/**
 * The trusted provider evidence behind a hosted-invoice payment.
 *
 * Everything here comes from the server-to-server `POST /v1/payment/verify` answer — never from a browser, a
 * callback payload, a screenshot or a customer-supplied transaction id. The record is deliberately
 * **advisory**: it is written next to the payment and never decides anything. Status transitions and Premium
 * activation stay with the compare-and-set in `paymentWorkflow.ts`, so a stored record can neither grant nor
 * revoke access on its own.
 *
 * It is stored in the existing `Payment.providerVerification` JSON column, so no migration is required. Older
 * rows that hold the retired transaction-verification shape are read defensively: anything this module does
 * not recognise is treated as absent evidence rather than as fact.
 *
 * What is deliberately NOT stored: API keys, authorization headers, webhook secrets, raw provider payloads,
 * customer emails and full provider responses. The provider's invoice-verify response has no documented
 * currency field, so no currency is persisted; if one is ever documented and returned, it is added here
 * rather than guessed now.
 */
import { maskReference } from './referenceMask.js'
import type { ZiniPayInvoiceCheck } from './zinipay.checkout.client.js'

/** The verification step that produced a record. Only one producer exists today. */
export type ProviderEvidenceSource = 'invoice-verify'

/** The key the transaction-verification (TrxID) facts live under, beside the invoice facts. */
export const TRX_EVIDENCE_KEY = 'trxVerification'

export interface TrxVerificationEvidence {
  source: 'trx-verify'
  /** How many times this payment's transaction reference has been sent to the provider. */
  attempts: number
  /** The customer's reference, masked: enough to recognise, never enough to reuse. */
  referenceMasked: string | null
  /** The provider's numeric transaction id, which the confirm step needs. */
  providerTransactionId: number | null
  amount: number | null
  provider: string | null
  senderMasked: string | null
  verifyStatus: string | null
  verifiedAt: string | null
  /**
   * `CONFIRMED` only after the provider permanently consumed the transaction. `FAILED` and `AMBIGUOUS` both mean
   * premium was not activated, and `AMBIGUOUS` means the provider may or may not have consumed it.
   */
  confirmStatus: 'CONFIRMED' | 'FAILED' | 'AMBIGUOUS' | null
  confirmedAt: string | null
  checkedAt: string
  lastFailure: { kind: string; at: string; note: string | null } | null
}

export interface ProviderEvidence {
  /** Which server-side step produced this record. */
  source: ProviderEvidenceSource
  /** The provider invoice reference that was verified (the payment's `providerPaymentId`). */
  invoiceId: string | null
  /** Our merchant reference (`val_id`) as the provider echoed it back, when it echoed one. */
  merchantReference: string | null
  /** The provider-confirmed invoice status: `PENDING`, `COMPLETED` or `FAILED`. */
  providerStatus: string | null
  /** The provider-reported amount, when the response carried one. */
  amount: number | null
  /** The provider transaction reference, when the response carried one (reconciliation evidence). */
  transactionId: string | null
  /** The wallet the provider recorded, when the response carried one. */
  paymentMethod: string | null
  /** A masked sender, only if a response ever carries one. */
  senderMasked: string | null
  /** When a valid provider answer was last captured. */
  verifiedAt: string | null
  /** When the server last asked, including attempts that failed. */
  checkedAt: string
  /** How many times the server has asked about this invoice. */
  checkCount: number
  /** A safe summary of the last problem, or null after a clean answer. */
  lastFailure: { kind: string; at: string; note: string | null } | null
}

const MAX_NOTE_LENGTH = 200
const MAX_FACT_LENGTH = 120

/** Bounds a provider string, so an unexpected payload cannot bloat the row. */
const boundFact = (value: unknown): string | null => {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed.slice(0, MAX_FACT_LENGTH) : null
}

const boundAmount = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null

/**
 * Reads a stored record without trusting its shape.
 *
 * Field names from the retired transaction-verification record (`verificationId`, `confirmStatus`, …) simply
 * fail these checks and come back as null, so an old row can never be read as current evidence.
 */
export function readProviderEvidence(value: unknown): ProviderEvidence | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  if (record.source !== 'invoice-verify') return null

  const checkedAt = boundFact(record.checkedAt)
  if (!checkedAt) return null

  const failure = typeof record.lastFailure === 'object' && record.lastFailure !== null
    ? (record.lastFailure as Record<string, unknown>)
    : null

  return {
    source: 'invoice-verify',
    invoiceId: boundFact(record.invoiceId),
    merchantReference: boundFact(record.merchantReference),
    providerStatus: boundFact(record.providerStatus),
    amount: boundAmount(record.amount),
    transactionId: boundFact(record.transactionId),
    paymentMethod: boundFact(record.paymentMethod),
    senderMasked: boundFact(record.senderMasked),
    verifiedAt: boundFact(record.verifiedAt),
    checkedAt,
    checkCount: typeof record.checkCount === 'number' && Number.isFinite(record.checkCount) && record.checkCount >= 0
      ? Math.floor(record.checkCount)
      : 0,
    lastFailure: failure && typeof failure.kind === 'string'
      ? {
          kind: failure.kind.slice(0, MAX_FACT_LENGTH),
          at: boundFact(failure.at) ?? checkedAt,
          note: boundFact(failure.note),
        }
      : null,
  }
}

export interface ProviderEvidenceInput {
  /** The payment the evidence belongs to: its invoice reference and our own reference. */
  invoiceId: string | null
  expectedMerchantReference: string | null
  /** The provider's answer, when the server got one. */
  check?: ZiniPayInvoiceCheck
  /** A safe, value-free description of what went wrong, when the check failed or was refused. */
  failure?: { kind: string; note?: string | null } | null
}

/**
 * Builds the next record from the previous one and the newest provider answer.
 *
 * The merge is monotonic: a fact that was learned earlier is never erased by a later answer that simply did
 * not repeat it (a `PENDING` poll carries no transaction reference, and a timeout carries nothing at all), so
 * evidence from a completed payment survives later checks. Only a clean answer clears the failure summary.
 */
export function buildProviderEvidence(
  previous: ProviderEvidence | null,
  input: ProviderEvidenceInput,
  now: Date,
): ProviderEvidence {
  const at = now.toISOString()
  const check = input.check

  // A merchant reference that contradicts ours is not accepted as evidence of this payment: the mismatch is
  // recorded instead, and the payment's own reference is kept.
  const echoedReference = check?.merchantReference ?? null
  const referenceAgrees = echoedReference === null || echoedReference === input.expectedMerchantReference

  return {
    source: 'invoice-verify',
    invoiceId: input.invoiceId ?? previous?.invoiceId ?? null,
    merchantReference: previous?.merchantReference ?? (referenceAgrees ? echoedReference : null),
    providerStatus: check?.status ?? previous?.providerStatus ?? null,
    amount: check?.amount ?? previous?.amount ?? null,
    transactionId: check?.transactionId ?? previous?.transactionId ?? null,
    paymentMethod: check?.paymentMethod ?? previous?.paymentMethod ?? null,
    senderMasked: previous?.senderMasked ?? null,
    // Only a genuine provider answer counts as verification; a failure or a timeout is not.
    verifiedAt: check ? at : previous?.verifiedAt ?? null,
    checkedAt: at,
    checkCount: (previous?.checkCount ?? 0) + 1,
    lastFailure: input.failure
      ? { kind: input.failure.kind.slice(0, MAX_FACT_LENGTH), at, note: input.failure.note?.slice(0, MAX_NOTE_LENGTH) ?? null }
      : null,
  }
}

/**
 * The reference the admin sees in the UI and in an audit event.
 *
 * The stored record keeps the full provider reference because reconciliation needs it, but anything that
 * leaves the database (a response body or a log line) shows only the tail, so a payment reference is never
 * reproduced in full outside the application's own storage.
 */
export const maskProviderReference = (value: string | null | undefined): string | null =>
  value ? maskReference(value) : null

/** Reads the transaction-verification facts without trusting their shape. */
export function readTrxEvidence(value: unknown): TrxVerificationEvidence | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const container = value as Record<string, unknown>
  // Accept either the payment's whole evidence object or the record itself, so a caller cannot silently read
  // the wrong level and conclude that nothing was ever recorded.
  const nested = container.source === 'trx-verify' ? container : container[TRX_EVIDENCE_KEY]
  if (typeof nested !== 'object' || nested === null || Array.isArray(nested)) return null

  const record = nested as Record<string, unknown>
  if (record.source !== 'trx-verify') return null
  const checkedAt = boundFact(record.checkedAt)
  if (!checkedAt) return null

  const failure = typeof record.lastFailure === 'object' && record.lastFailure !== null
    ? (record.lastFailure as Record<string, unknown>)
    : null
  const confirm = boundFact(record.confirmStatus)

  return {
    source: 'trx-verify',
    attempts: typeof record.attempts === 'number' && Number.isFinite(record.attempts) && record.attempts >= 0
      ? Math.floor(record.attempts)
      : 0,
    referenceMasked: boundFact(record.referenceMasked),
    providerTransactionId: boundAmount(record.providerTransactionId) === null
      ? null
      : Math.trunc(boundAmount(record.providerTransactionId) as number),
    amount: boundAmount(record.amount),
    provider: boundFact(record.provider),
    senderMasked: boundFact(record.senderMasked),
    verifyStatus: boundFact(record.verifyStatus),
    verifiedAt: boundFact(record.verifiedAt),
    confirmStatus: confirm === 'CONFIRMED' || confirm === 'FAILED' || confirm === 'AMBIGUOUS' ? confirm : null,
    confirmedAt: boundFact(record.confirmedAt),
    checkedAt,
    lastFailure: failure && typeof failure.kind === 'string'
      ? {
          kind: failure.kind.slice(0, MAX_FACT_LENGTH),
          at: boundFact(failure.at) ?? checkedAt,
          note: boundFact(failure.note),
        }
      : null,
  }
}

export interface TrxEvidenceInput {
  referenceMasked: string | null
  previous: TrxVerificationEvidence | null
  /** The provider's answer, when the verify step returned one. */
  verify?: {
    providerTransactionId: number
    amount: number | null
    provider: string | null
    senderMasked: string | null
    status: string | null
  }
  confirmStatus?: TrxVerificationEvidence['confirmStatus']
  failure?: { kind: string; note?: string | null } | null
}

/**
 * Builds the next transaction-verification record.
 *
 * Like the invoice record it is monotonic — a later failure cannot erase the transaction the provider already
 * identified — and it counts attempts so a payment cannot be used to spend credits indefinitely.
 */
export function buildTrxEvidence(input: TrxEvidenceInput, now: Date): TrxVerificationEvidence {
  const at = now.toISOString()
  const previous = input.previous

  return {
    source: 'trx-verify',
    attempts: (previous?.attempts ?? 0) + 1,
    referenceMasked: input.referenceMasked ?? previous?.referenceMasked ?? null,
    providerTransactionId: input.verify?.providerTransactionId ?? previous?.providerTransactionId ?? null,
    amount: input.verify?.amount ?? previous?.amount ?? null,
    provider: input.verify?.provider ?? previous?.provider ?? null,
    senderMasked: input.verify?.senderMasked ?? previous?.senderMasked ?? null,
    verifyStatus: input.verify?.status ?? previous?.verifyStatus ?? null,
    verifiedAt: input.verify ? at : previous?.verifiedAt ?? null,
    confirmStatus: input.confirmStatus ?? previous?.confirmStatus ?? null,
    confirmedAt: input.confirmStatus === 'CONFIRMED' ? at : previous?.confirmedAt ?? null,
    checkedAt: at,
    lastFailure: input.failure
      ? { kind: input.failure.kind.slice(0, MAX_FACT_LENGTH), at, note: input.failure.note?.slice(0, MAX_NOTE_LENGTH) ?? null }
      : null,
  }
}

/**
 * Puts the transaction facts back beside the invoice facts.
 *
 * The two records describe the same payment and must be able to coexist: an invoice verification never erases
 * what a transaction verification established, and the other way round.
 */
export function withTrxEvidence(base: unknown, trx: TrxVerificationEvidence): Record<string, unknown> {
  const record = typeof base === 'object' && base !== null && !Array.isArray(base)
    ? { ...(base as Record<string, unknown>) }
    : {}
  record[TRX_EVIDENCE_KEY] = trx as unknown
  return record
}

/** Strips the fields an admin does not need, and masks every reference that leaves the database. */
export function toAdminEvidenceView(evidence: ProviderEvidence | null, trx: TrxVerificationEvidence | null = null) {
  const trxView = trx
    ? {
        source: trx.source,
        attempts: trx.attempts,
        reference: trx.referenceMasked,
        provider: trx.provider,
        amount: trx.amount,
        providerStatus: trx.verifyStatus,
        verifiedAt: trx.verifiedAt,
        confirmStatus: trx.confirmStatus,
        confirmedAt: trx.confirmedAt,
        checkedAt: trx.checkedAt,
        lastFailure: trx.lastFailure ? { kind: trx.lastFailure.kind, at: trx.lastFailure.at } : null,
      }
    : null

  if (!evidence) return trxView ? { invoice: null, transaction: trxView } : null
  return {
    source: evidence.source,
    providerStatus: evidence.providerStatus,
    // The invoice reference is masked here; the full value stays in the row for reconciliation tooling.
    invoiceReference: maskProviderReference(evidence.invoiceId),
    merchantReference: maskProviderReference(evidence.merchantReference),
    transactionReference: maskProviderReference(evidence.transactionId),
    paymentMethod: evidence.paymentMethod,
    amount: evidence.amount,
    verifiedAt: evidence.verifiedAt,
    checkedAt: evidence.checkedAt,
    checkCount: evidence.checkCount,
    lastFailure: evidence.lastFailure
      ? { kind: evidence.lastFailure.kind, at: evidence.lastFailure.at }
      : null,
    transaction: trxView,
  }
}
