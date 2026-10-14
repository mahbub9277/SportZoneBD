/**
 * Retention rules for automatically finished matches.
 *
 * A finished match stays available for a short grace period (30 minutes), then the match automation
 * cycle makes it eligible for deletion. `Match.finishedAt` is the authoritative finish moment (it is
 * persisted by every status writer), with `Match.updatedAt` used only as a fallback for rows finished
 * through a generic update that did not record a finish moment.
 */

/** Product rule: a finished match is never deleted before this grace period has elapsed. */
export const FINISHED_MATCH_MIN_RETENTION_MINUTES = 30

/**
 * Keeps a previously finished fixture's persisted finish moment. Legacy rows without one fall back to
 * their existing updatedAt (the cleanup policy's established fallback) rather than being made "new"
 * when a provider sync first sees them after a restart.
 */
export function resolveFinishedMatchTimestamp(
  nextStatus: string,
  previousStatus: string,
  previousFinishedAt: Date | null,
  previousUpdatedAt: Date,
  transitionedAt: Date,
): Date | null {
  if (nextStatus !== 'FINISHED') return null

  if (previousFinishedAt && Number.isFinite(previousFinishedAt.getTime())) {
    return previousFinishedAt
  }
  if (previousStatus === 'FINISHED') {
    return Number.isFinite(previousUpdatedAt.getTime()) ? previousUpdatedAt : null
  }
  return transitionedAt
}

/**
 * Resolves the retention window. FINISHED_MATCH_RETENTION_MINUTES can extend the grace period for
 * staging or longer archiving, but it can never shorten it below the 30 minute product rule.
 */
export function resolveFinishedMatchRetentionMinutes(envValue?: string | number | null): number {
  const parsed = Number(envValue)
  if (!Number.isFinite(parsed) || parsed <= 0) return FINISHED_MATCH_MIN_RETENTION_MINUTES
  return Math.max(FINISHED_MATCH_MIN_RETENTION_MINUTES, Math.floor(parsed))
}

/** Matches finished at or before this instant are eligible for cleanup. */
export function resolveFinishedMatchCleanupCutoff(now: Date, retentionMinutes: number): Date {
  return new Date(now.getTime() - retentionMinutes * 60 * 1000)
}

export interface FinishedMatchCleanupCandidate {
  status: string
  deletedAt: Date | null
  finishedAt: Date | null
  updatedAt: Date
}

/**
 * Final guard applied to rows selected by the cleanup query. Only genuinely finished matches are
 * eligible, so a live or upcoming match can never be removed by the retention cleanup.
 */
export function isFinishedMatchExpired(match: FinishedMatchCleanupCandidate, cutoff: Date): boolean {
  if (match.status !== 'FINISHED' || match.deletedAt !== null) return false
  const finishedMoment = match.finishedAt ?? match.updatedAt
  return finishedMoment.getTime() <= cutoff.getTime()
}
