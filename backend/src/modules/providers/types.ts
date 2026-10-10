import type { SportType } from '@prisma/client'

/** Every external sports-data source SportZoneBD can sync from. */
export type ProviderId = 'FOOTBALL_DATA' | 'API_FOOTBALL' | 'CRICKET_DATA'

/**
 * Provider-specific key prefix. Existing database rows already use
 * `football-data-org:<id>`, so that value must never change.
 */
export const PROVIDER_KEY_PREFIX: Record<ProviderId, string> = {
  FOOTBALL_DATA: 'football-data-org',
  API_FOOTBALL: 'api-football',
  CRICKET_DATA: 'cricket-data',
}

/** Human-readable provider labels used in logs and automation summaries. */
export const PROVIDER_LABEL: Record<ProviderId, string> = {
  FOOTBALL_DATA: 'football-data.org',
  API_FOOTBALL: 'API-Football',
  CRICKET_DATA: 'CricketData',
}

/**
 * One fixture in SportZoneBD's internal shape. Provider payloads are normalized into this type
 * at the adapter boundary so provider-specific fields never leak into the sync pipeline. Field
 * names deliberately mirror the existing football-data fixture shape so the sync loop, identity
 * helpers, and duplicate detection are shared by every provider.
 */
export interface CanonicalFixture {
  provider: ProviderId
  sport: SportType
  /** The provider's own fixture id, kept for provider-specific identity. */
  providerMatchId: string | null
  /** Provider status, already normalized to UPCOMING | LIVE | FINISHED by the provider adapter. */
  status: string
  /** ISO-8601 UTC kickoff instant. */
  kickoffAt: string
  competitionCode: string
  competitionName: string
  /**
   * Season label exactly as the provider states it ("2026/2027" from football-data.org's season span,
   * API-Football's season year). Null when the provider does not publish one, so nothing is invented.
   */
  season: string | null
  /**
   * Round or matchday exactly as the provider states it (football-data.org's `matchday`). Null when the
   * provider publishes none, so a round is never inferred from a competition name or a stage label.
   */
  round: number | null
  homeTeamName: string
  awayTeamName: string
  homeTeamCrest: string | null
  awayTeamCrest: string | null
  homeTeamProviderId: string | null
  awayTeamProviderId: string | null
}

/**
 * Outcome of one provider read. `skipped` distinguishes "we deliberately did not call the
 * provider" (not configured, quota exhausted) from a genuine provider failure, which throws.
 *
 * A provider that reads several independent sources (football-data competitions, API-Football
 * leagues) may report per-source labels so a partial failure is reflected in the automation log
 * instead of being reported as a clean success.
 */
export interface ProviderFetchResult {
  fixtures: CanonicalFixture[]
  skipped: boolean
  reason?: string
  attemptedSources?: string[]
  failedSources?: string[]
}

export function providerFixtureKey(fixture: Pick<CanonicalFixture, 'provider' | 'providerMatchId'>): string | null {
  const id = fixture.providerMatchId?.trim()
  return id ? `${PROVIDER_KEY_PREFIX[fixture.provider]}:${id}` : null
}
