/**
 * Pure advertisement session rules.
 *
 * The database-backed service (`advertisements.service.ts`) owns the writes, but every timing,
 * idempotency and entitlement decision it makes is derived here so it can be tested directly and so
 * the client can never disagree with the server about when a view counts. Durations are always whole
 * seconds; nothing in this module accepts milliseconds.
 */

export const AD_UNLOCK_HOURS_OPTIONS = [12, 24] as const
export type AdUnlockHours = (typeof AD_UNLOCK_HOURS_OPTIONS)[number]

export const HOUR_MS = 60 * 60 * 1000

/** Only 12 and 24 hour unlocks exist; anything else falls back to the longer, safer value. */
export function normalizeUnlockHours(value: unknown): AdUnlockHours {
  return Number(value) === 12 ? 12 : 24
}

export function unlockExpiresAtMs(nowMs: number, unlockHours: unknown): number {
  return nowMs + normalizeUnlockHours(unlockHours) * HOUR_MS
}

/** Configured viewing duration in milliseconds. Invalid or missing values require no waiting. */
export function viewingDurationMs(durationSeconds: unknown): number {
  const numeric = Number(durationSeconds)
  if (!Number.isFinite(numeric) || numeric <= 0) return 0
  return Math.floor(numeric) * 1000
}

/** Completion before the configured duration has fully elapsed is never valid. */
export function hasViewingTimeElapsed(startedAtMs: number, durationSeconds: unknown, nowMs: number): boolean {
  if (!Number.isFinite(startedAtMs) || !Number.isFinite(nowMs)) return false
  return nowMs >= startedAtMs + viewingDurationMs(durationSeconds)
}

export interface AdSessionSnapshot {
  sessionTokenHash: string
  canceledAt: Date | null
  completedAt: Date | null
  unlockExpiresAt: Date | null
  startedAt: Date
  /** The duration captured when the session started — later admin edits do not retroactively apply. */
  durationSeconds: number
  userId: string | null
  /** True when the advertisement itself is no longer active (missing, inactive or deleted). */
  advertisementUnavailable: boolean
}

export interface AdSessionCompletionContext {
  sessionTokenHash: string
  nowMs: number
  userId?: string
}

export type AdSessionCompletionDecision =
  | { kind: 'invalid' }
  | { kind: 'too-early' }
  | { kind: 'already-completed'; unlockExpiresAt: Date }
  | { kind: 'completable' }

/**
 * The single decision point for completing a view session. Order matters: identity and cancellation
 * are checked first, then an existing completion (idempotent replay), then the timer.
 */
export function decideSessionCompletion(session: AdSessionSnapshot, context: AdSessionCompletionContext): AdSessionCompletionDecision {
  if (!session.sessionTokenHash || session.sessionTokenHash !== context.sessionTokenHash) return { kind: 'invalid' }
  if (session.canceledAt) return { kind: 'invalid' }
  if (session.advertisementUnavailable) return { kind: 'invalid' }
  if (context.userId && session.userId && session.userId !== context.userId) return { kind: 'invalid' }
  if (session.completedAt && session.unlockExpiresAt) {
    return { kind: 'already-completed', unlockExpiresAt: session.unlockExpiresAt }
  }
  if (!hasViewingTimeElapsed(session.startedAt.getTime(), session.durationSeconds, context.nowMs)) return { kind: 'too-early' }
  return { kind: 'completable' }
}

/** An unlock is only valid while it has not expired. */
export function isUnlockStillValid(expiresAt: Date | null | undefined, nowMs: number): boolean {
  return Boolean(expiresAt && expiresAt.getTime() > nowMs)
}
