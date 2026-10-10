import logger from '../../core/logger.js'
import {
  getCompetitionCodesForCycle,
  getCompetitionFixtures,
  getConfiguredCompetitionCodes,
  getConfiguredCompetitionFixtures,
  type FootballDataFixture,
} from '../matches/footballDataMatches.service.js'
import type { CanonicalFixture } from './types.js'

/**
 * Adapter for the existing football-data.org integration. It wraps the current services without
 * changing their behaviour and normalizes their output into the canonical shape used by the sync
 * pipeline, so football-data.org remains the primary football source.
 */

const PROVIDER = 'FOOTBALL_DATA'

export type FootballFixtureLoader = (competitionCode: string, dateFrom: string, dateTo: string) => Promise<FootballDataFixture[]>

export interface FootballDataFetchResult {
  fixtures: CanonicalFixture[]
  /** Competition codes attempted this cycle, used for accurate automation status reporting. */
  attemptedSources: string[]
  failedSources: string[]
}

export function toCanonicalFootballFixtures(fixtures: FootballDataFixture[]): CanonicalFixture[] {
  return fixtures.map((fixture) => ({
    provider: PROVIDER,
    sport: 'FOOTBALL',
    providerMatchId: fixture.id?.trim() || null,
    status: fixture.status,
    kickoffAt: fixture.kickoffAt,
    competitionCode: fixture.competitionCode,
    competitionName: fixture.competitionName,
    season: fixture.season ?? null,
    round: fixture.round ?? null,
    homeTeamName: fixture.homeTeamName,
    awayTeamName: fixture.awayTeamName,
    homeTeamCrest: fixture.homeTeamCrest ?? null,
    awayTeamCrest: fixture.awayTeamCrest ?? null,
    // football-data.org does not expose team ids in its fixture payload.
    homeTeamProviderId: null,
    awayTeamProviderId: null,
  }))
}

export async function getFootballDataFixtures(
  dateFrom: string,
  dateTo: string,
  loadFixtures: FootballFixtureLoader = getCompetitionFixtures,
  now = Date.now(),
): Promise<FootballDataFetchResult> {
  const attemptedSources = getCompetitionCodesForCycle(getConfiguredCompetitionCodes(), now)
  const failedSources: string[] = []

  const fixtures = await getConfiguredCompetitionFixtures(
    dateFrom,
    dateTo,
    loadFixtures,
    now,
    (competitionCode, error) => {
      failedSources.push(competitionCode)
      logger.warn({ competitionCode, error }, 'Football fixture discovery failed for one competition')
    },
  )

  return { fixtures: toCanonicalFootballFixtures(fixtures), attemptedSources, failedSources }
}
