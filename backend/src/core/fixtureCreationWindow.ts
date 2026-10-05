/**
 * Automatic match creation window.
 *
 * A fixture may only become a SportZoneBD match once kickoff is close enough. The upper bound is
 * the important one: without it a provider that publishes a whole season would create matches
 * weeks early (RULE 1 / RULE 2). The band is the configured lead time before kickoff (seven days
 * by default), and a fixture that first appears inside 24 hours is still created as a safety fallback.
 *
 * The guard is evaluated per fixture (not per provider query) so scheduler jitter can never leak
 * an out-of-window match.
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
  /** Inside the window (or already started with a live/finished provider status): safe to create. */
  | 'create'
  /** Kickoff is further away than the configured maximum lead time. */
  | 'too-early'
  /** Kickoff already passed but the provider still reports it as upcoming: stale provider data. */
  | 'stale-upcoming'

export interface FixtureCreationWindowInput {
  kickoffAt: Date
  now: Date
  maxLeadMs: number
  /** Status already normalized to UPCOMING | LIVE | FINISHED. */
  providerStatus: 'UPCOMING' | 'LIVE' | 'FINISHED'
}

export function evaluateFixtureCreationWindow({
  kickoffAt,
  now,
  maxLeadMs,
  providerStatus,
}: FixtureCreationWindowInput): FixtureCreationDecision {
  const leadMs = kickoffAt.getTime() - now.getTime()

  if (leadMs > maxLeadMs) return 'too-early'
  // A fixture that already started is still real data (live/finished); only reject it when the
  // provider claims it is still upcoming, so we never fabricate a future fixture.
  if (leadMs < 0 && providerStatus === 'UPCOMING') return 'stale-upcoming'

  return 'create'
}
