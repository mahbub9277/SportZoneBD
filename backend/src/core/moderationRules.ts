/**
 * The moderation business rules, as pure functions.
 *
 * Report transitions and the "you may not decide your own submission" rule are policy, not database
 * work, so they live here: the controller reads them, and the rules can be asserted without a database
 * connection. Nothing in this file invents a status or an action the data model does not already have.
 */

export const REPORT_CATEGORIES = ['Bug', 'Playback', 'Payment', 'Account', 'Content'] as const
export const REPORT_STATUSES = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'] as const

export type ReportCategory = (typeof REPORT_CATEGORIES)[number]
export type ReportStatus = (typeof REPORT_STATUSES)[number]

export const PAYMENT_REVIEW_ACTIONS = ['approve', 'reject'] as const
export type PaymentReviewAction = (typeof PAYMENT_REVIEW_ACTIONS)[number]

/**
 * The statuses a report may move to from each status.
 *
 * The rule keeps the four existing statuses meaningful: work starts, work finishes, and a closed report
 * is only reopened deliberately. A report may not move to the status it already has — that is what makes
 * a second, conflicting resolution of the same report impossible rather than merely unlikely — and a
 * closed report is the only state that requires a reason, because reopening one is the decision a
 * reviewer has to justify later.
 */
export const REPORT_STATUS_TRANSITIONS: Record<ReportStatus, readonly ReportStatus[]> = {
  OPEN: ['IN_PROGRESS', 'RESOLVED', 'CLOSED'],
  IN_PROGRESS: ['OPEN', 'RESOLVED', 'CLOSED'],
  RESOLVED: ['IN_PROGRESS', 'CLOSED'],
  CLOSED: ['OPEN'],
}

/** Statuses that require the reviewer to record why. */
export const REPORT_STATUSES_REQUIRING_REASON: readonly ReportStatus[] = ['CLOSED']

export function isReportCategory(value: unknown): value is ReportCategory {
  return typeof value === 'string' && (REPORT_CATEGORIES as readonly string[]).includes(value)
}

export function isReportStatus(value: unknown): value is ReportStatus {
  return typeof value === 'string' && (REPORT_STATUSES as readonly string[]).includes(value)
}

/** Whether a report may move from `from` to `to`. Unknown values and no-op moves are refused. */
export function canTransitionReportStatus(from: unknown, to: unknown): boolean {
  if (!isReportStatus(from) || !isReportStatus(to)) return false
  if (from === to) return false
  return REPORT_STATUS_TRANSITIONS[from].includes(to)
}

export function requiresReportReason(status: ReportStatus): boolean {
  return (REPORT_STATUSES_REQUIRING_REASON as readonly string[]).includes(status)
}

/** The statuses a reviewer may choose next, so the client offers only moves the backend accepts. */
export function allowedReportTransitions(from: unknown): ReportStatus[] {
  if (!isReportStatus(from)) return []
  return [...REPORT_STATUS_TRANSITIONS[from]]
}

export function isPaymentReviewAction(value: unknown): value is PaymentReviewAction {
  return typeof value === 'string' && (PAYMENT_REVIEW_ACTIONS as readonly string[]).includes(value)
}

/**
 * Whether an actor may decide a submission they are not the owner of.
 *
 * A moderator reviews other people's payments; a submission that belongs to the reviewer is refused, so
 * nobody can approve their own payment. The rule is applied inside the same transaction that changes the
 * payment, which is what makes it hold under concurrency instead of only in the common case.
 */
export function canReviewSubmission(actorId: string | null | undefined, submittedById: string | null | undefined): boolean {
  if (!actorId || !submittedById) return false
  return actorId !== submittedById
}
