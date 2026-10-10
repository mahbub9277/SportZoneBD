/**
 * Automatic match creation window.
 *
 * A fixture may only become a SportZoneBD match once kickoff is close enough. The upper bound is
 * the important one: without it a provider that publishes a whole season would create matches
 * weeks early (RULE 1 / RULE 2). The band is the configured lead time before kickoff (seven days
 * by default), and a fixture that first appears inside 24 hours is still created as a safety fallback.
 *
 * The guard is evaluated per fixture (not per provider query) so scheduler jitter can never leak
 * an out-of-window match, and it is re-evaluated at the moment of the insert, so a sync that runs late
 * (a retry, a queue backlog, a restart) cannot insert a fixture whose kickoff has already gone by.
 *
 * Since automatic discovery now creates PENDING matches, this horizon is also the review window an
 * admin sees in Admin -> Match Management -> Pending. It stays intentionally bounded (max 14 days)
 * so a provider that returns a whole season cannot flood the review queue.
 */

export const DEFAULT_MATCH_DISCOVERY_DAYS = 7
const MAX_MATCH_DISCOVERY_DAYS = 14

/** Max lead time before kickoff at which an automatic match may be created. */
export function getMatchDiscoveryDays(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(env.MATCH_DISCOVERY_DAYS)
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_MATCH_DISCOVERY_DAYS
  return Math.min(Math.floor(raw), MAX_MATCH_DISCOVERY_DAYS)
}

export function getMatchDiscoveryWindowMs(env: NodeJS.ProcessEnv = process.env): number {
  return getMatchDiscoveryDays(env) * 24 * 60 * 60 * 1000
}

export type FixtureCreationDecision =
  /** Inside the window: safe to create. */
  | 'create'
  /** Kickoff is further away than the configured maximum lead time. */
  | 'too-early'
  /**
   * Kickoff has already passed. An expired fixture is never inserted as a new pending match, whatever
   * status the provider reports: a pending row is a review request for a match that is still to come, and
   * re-inserting a finished fixture (or one that started while the sync was down) only ever returns old
   * fixtures to the review queue. Matches that already exist are still updated from provider data — this
   * only gates the creation of new rows.
   */
  | 'expired'

export interface FixtureCreationWindowInput {
  kickoffAt: Date
  now: Date
  maxLeadMs: number
}

export function evaluateFixtureCreationWindow({
  kickoffAt,
  now,
  maxLeadMs,
}: FixtureCreationWindowInput): FixtureCreationDecision {
  const leadMs = kickoffAt.getTime() - now.getTime()

  if (leadMs > maxLeadMs) return 'too-early'
  // The comparison is on the kickoff instant itself, so a provider timezone offset is already resolved by
  // the time this runs: `kickoffAt` is a Date and `now` is the instant the cycle started. Provider status
  // never widens the window: a fixture that has started is not a review candidate, and the status the
  // provider reports is normalized onto the match when it is written.
  if (leadMs <= 0) return 'expired'

  return 'create'
}
