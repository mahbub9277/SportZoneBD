/**
 * The review decisions a pending match can receive, shared by the single-row and bulk admin endpoints.
 *
 * The rules live here, in one place, so a bulk request can never diverge from the single accept/reject a
 * reviewer clicks: the same conditional update decides the outcome, and the same classifier explains what
 * happened to each requested id.
 */

/** The largest number of fixtures one bulk review request may carry. */
export const MAX_BULK_REVIEW_IDS = 200

export type PendingReviewDecision = 'accept' | 'reject'

/**
 * Why a requested fixture ended up in a given state. `already_processed` covers the idempotent repeat
 * (someone else decided it first, or the same request was sent twice); `ineligible` is a fixture whose
 * kickoff has passed, which the review queue never lists and which must not be published as upcoming.
 */
export type PendingReviewOutcome = 'accepted' | 'rejected' | 'already_processed' | 'ineligible' | 'missing' | 'failed'

export interface PendingReviewRow {
  status: string
  deletedAt: Date | null
  kickoffAt: Date
}

/** The rows an accept may publish: still pending, not deleted, and not already started. */
export function buildAcceptablePendingWhere(idOrIds: string | string[], now: Date) {
  return {
    id: Array.isArray(idOrIds) ? { in: idOrIds } : idOrIds,
    status: 'PENDING' as const,
    deletedAt: null,
    kickoffAt: { gt: now },
  }
}

/**
 * The rows a reject may retire. Expiry deliberately does not gate this: an expired row that is still
 * pending has to stay rejectable, that is how the queue is cleaned up.
 */
export function buildRejectablePendingWhere(idOrIds: string | string[]) {
  return {
    id: Array.isArray(idOrIds) ? { in: idOrIds } : idOrIds,
    status: 'PENDING' as const,
    deletedAt: null,
  }
}

/**
 * What a bulk request should report for one id, from the row's state before and after the update.
 *
 * Both states are needed: a row that was already `UPCOMING` before the request is a repeat, not something
 * this request accepted, and a row that is still `PENDING` afterwards means the update skipped it —
 * which for accept only happens when the kickoff has passed.
 */
export function classifyPendingReviewOutcome(
  before: PendingReviewRow | null,
  after: PendingReviewRow | null,
  decision: PendingReviewDecision,
  now: Date,
): PendingReviewOutcome {
  if (!before) return 'missing'

  if (decision === 'accept') {
    if (before.status !== 'PENDING' || before.deletedAt !== null) return 'already_processed'
    if (before.kickoffAt.getTime() <= now.getTime()) return 'ineligible'
    return after?.status === 'UPCOMING' ? 'accepted' : 'failed'
  }

  if (before.status === 'REJECTED') return 'already_processed'
  if (before.status !== 'PENDING' || before.deletedAt !== null) return 'already_processed'
  return after?.status === 'REJECTED' ? 'rejected' : 'failed'
}

/** Groups the per-item outcomes for the response body and the audit entry. */
export function summarizePendingReviewOutcomes(outcomes: PendingReviewOutcome[]) {
  const count = (target: PendingReviewOutcome) => outcomes.filter((outcome) => outcome === target).length
  return {
    requested: outcomes.length,
    accepted: count('accepted'),
    rejected: count('rejected'),
    alreadyProcessed: count('already_processed'),
    ineligible: count('ineligible'),
    missing: count('missing'),
    failed: count('failed'),
  }
}
