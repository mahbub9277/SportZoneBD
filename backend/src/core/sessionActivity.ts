/**
 * Moderator session activity.
 *
 * Work duration is derived from the session rows the authentication system already writes — never from a
 * client timer and never from keystrokes. A session knows when it started (`createdAt`), when the
 * credential was last refreshed or the session last reported itself active (`updatedAt`), when it was
 * revoked (`deletedAt`, which is what logout and a password reset set) and when it expires (`expiresAt`).
 *
 * What that means in practice, honestly:
 * - A session that was revoked has an exact end, so its duration is exact.
 * - A session that reached its absolute expiry was open until that expiry, which is also exact.
 * - A session that is simply gone (closed tab, crashed browser) has no end at all. Counting to "now"
 *   would claim work that never happened, so the session is counted up to one bounded idle window after
 *   its last activity and the result is flagged as estimated.
 * - Time inside a session is only ever credited between the start and that same bounded window, so an
 *   abandoned tab left open overnight does not become twelve hours of moderation.
 */

/** How long a session may go without a single recorded activity before it stops counting as active. */
export const SESSION_IDLE_TIMEOUT_MS = 30 * 60 * 1000

/**
 * How often an open console reports that it is still there.
 *
 * Three minutes is inside the 2–5 minute window an activity heartbeat should use: it keeps the idle
 * estimate accurate to within one window while writing at most twenty rows per hour for an open console.
 */
export const SESSION_HEARTBEAT_INTERVAL_MS = 3 * 60 * 1000

export type SessionEndSource = 'logout' | 'expiry' | 'idle' | 'active'

export interface SessionActivityInput {
  startedAt: Date
  /** Last time the session was recorded as active: a credential refresh or an activity heartbeat. */
  lastSeenAt: Date
  /** Set when the session was revoked (logout, password reset). */
  endedAt?: Date | null
  expiresAt: Date
  now: Date
  idleTimeoutMs?: number
}

export interface SessionActivity {
  endedAt: Date
  endSource: SessionEndSource
  /** Whole session length, whether or not every minute of it was spent working. */
  durationMs: number
  /** Time credited as active: capped at one idle window past the last recorded activity. */
  activeMs: number
  /** True when no end was recorded and the end had to be inferred. */
  isEstimated: boolean
}

function msBetween(start: Date, end: Date): number {
  const value = end.getTime() - start.getTime()
  return Number.isFinite(value) && value > 0 ? value : 0
}

/**
 * The activity facts of one session.
 *
 * `now` is a parameter rather than the clock inside, so a caller can compute a whole page of sessions
 * against one instant and the rules stay testable.
 */
export function computeSessionActivity({
  startedAt,
  lastSeenAt,
  endedAt,
  expiresAt,
  now,
  idleTimeoutMs = SESSION_IDLE_TIMEOUT_MS,
}: SessionActivityInput): SessionActivity {
  const seen = lastSeenAt.getTime() >= startedAt.getTime() ? lastSeenAt : startedAt
  const idleDeadline = new Date(seen.getTime() + idleTimeoutMs)

  let end: Date
  let endSource: SessionEndSource
  let isEstimated: boolean

  if (endedAt) {
    // A revoked session ended exactly when it was revoked, even if that is after its expiry.
    end = endedAt
    endSource = 'logout'
    isEstimated = false
  } else if (expiresAt.getTime() <= now.getTime()) {
    end = expiresAt
    endSource = 'expiry'
    isEstimated = false
  } else if (idleDeadline.getTime() <= now.getTime()) {
    end = idleDeadline
    endSource = 'idle'
    isEstimated = true
  } else {
    end = now
    endSource = 'active'
    isEstimated = true
  }

  // Time after the recorded end is never counted, so a logout or an expiry closes the duration.
  const lastCountedMoment = new Date(Math.min(Math.max(end.getTime(), startedAt.getTime()), idleDeadline.getTime()))

  return {
    endedAt: end,
    endSource,
    durationMs: msBetween(startedAt, end),
    activeMs: msBetween(startedAt, lastCountedMoment),
    isEstimated,
  }
}

export interface SessionActivitySummary {
  sessionCount: number
  /** Sessions with a recorded end (logout or expiry). */
  exactSessionCount: number
  /** Sessions whose end had to be inferred, so their duration is a floor. */
  estimatedSessionCount: number
  totalDurationMs: number
  totalActiveMs: number
  lastSeenAt: Date | null
}

export function summarizeSessionActivity(
  sessions: readonly Omit<SessionActivityInput, 'now'>[],
  options: { now: Date; idleTimeoutMs?: number },
): SessionActivitySummary {
  let totalDurationMs = 0
  let totalActiveMs = 0
  let exactSessionCount = 0
  let estimatedSessionCount = 0
  let lastSeenAt: Date | null = null

  for (const session of sessions) {
    const activity = computeSessionActivity({ ...session, now: options.now, idleTimeoutMs: options.idleTimeoutMs })
    totalDurationMs += activity.durationMs
    totalActiveMs += activity.activeMs
    if (activity.isEstimated) estimatedSessionCount += 1
    else exactSessionCount += 1
    if (!lastSeenAt || session.lastSeenAt.getTime() > lastSeenAt.getTime()) {
      lastSeenAt = session.lastSeenAt
    }
  }

  return {
    sessionCount: sessions.length,
    exactSessionCount,
    estimatedSessionCount,
    totalDurationMs,
    totalActiveMs,
    lastSeenAt,
  }
}
