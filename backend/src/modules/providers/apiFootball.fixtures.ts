import { cache } from '../../core/cache.js'
import logger from '../../core/logger.js'
import { acquireProviderRequestSlot } from '../../core/providerRequestBudget.js'
import { fetchApiFootballFixtures, getApiFootballProviderStatus, isApiFootballConfigured, getApiFootballDailyRequestLimit } from './apiFootball.client.js'
import {
  FOOTBALL_DATA_COVERED_API_FOOTBALL_LEAGUES,
  getApiFootballLeagues,
  isFootballDataCoveredLeague,
  resolveApiFootballSeason,
} from './apiFootballCompetitions.js'
import { isRecord, nullableHttpUrl, providerIdentifier, requiredRecord, requiredString, requiredUtcIso } from './normalize.js'
import { PROVIDER_LABEL, type CanonicalFixture, type ProviderFetchResult } from './types.js'

/**
 * API-Football adapter. Secondary football source for competitions the existing football-data.org
 * integration does not cover. Provider payloads are normalized here and never escape this module.
 */

const PROVIDER = 'API_FOOTBALL'
/**
 * Fixture discovery is cached well beyond the football-data window (120s) because the Free plan
 * allows only 100 requests per day: one request per league per cache lifetime, and a cache hit
 * costs no quota at all.
 */
const DEFAULT_FIXTURE_CACHE_TTL_SECONDS = 3 * 60 * 60

export function getApiFootballFixtureCacheSeconds(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(env.API_FOOTBALL_FIXTURE_CACHE_SECONDS)
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_FIXTURE_CACHE_TTL_SECONDS
}

/** API-Football short status codes mapped onto the existing SportZoneBD match statuses. */
function normalizeStatus(short: string): 'UPCOMING' | 'LIVE' | 'FINISHED' | null {
  switch (short.toUpperCase()) {
    case 'TBD':
    case 'NS':
      return 'UPCOMING'
    case '1H':
    case 'HT':
    case '2H':
    case 'ET':
    case 'BT':
    case 'P':
    case 'INT':
    case 'LIVE':
      return 'LIVE'
    case 'FT':
    case 'AET':
    case 'PEN':
    case 'AWD':
    case 'WO':
      return 'FINISHED'
    // Postponed, cancelled, abandoned, and suspended have no SportZoneBD equivalent and are skipped
    // rather than invented, matching the existing football-data behaviour.
    default:
      return null
  }
}

/**
 * Parses one league's payload. The provider's own league/competition field is preserved as the
 * fixture's competition code so cross-provider matching keeps working.
 */
export function normalizeApiFootballFixtures(value: unknown): CanonicalFixture[] {
  const payload = requiredRecord(value, 'fixture response')
  if (!Array.isArray(payload.response)) throw new Error('Invalid provider fixture list.')

  const fixtures: CanonicalFixture[] = []

  for (const entry of payload.response) {
    if (!isRecord(entry)) continue

    const fixture = requiredRecord(entry.fixture, 'fixture')
    const league = requiredRecord(entry.league, 'competition')
    const teams = requiredRecord(entry.teams, 'teams')
    const home = requiredRecord(teams.home, 'home team')
    const away = requiredRecord(teams.away, 'away team')
    const fixtureStatus = requiredRecord(fixture.status, 'fixture status')

    const status = normalizeStatus(requiredString(fixtureStatus.short, 'fixture status code'))
    if (!status) continue

    fixtures.push({
      provider: PROVIDER,
      sport: 'FOOTBALL',
      providerMatchId: providerIdentifier(fixture.id),
      status,
      kickoffAt: requiredUtcIso(fixture.date, 'kickoff time'),
      competitionCode: providerIdentifier(league.id) ?? requiredString(league.name, 'competition name'),
      competitionName: requiredString(league.name, 'competition name'),
      homeTeamName: requiredString(home.name, 'home team name'),
      awayTeamName: requiredString(away.name, 'away team name'),
      homeTeamCrest: nullableHttpUrl(home.logo),
      awayTeamCrest: nullableHttpUrl(away.logo),
      homeTeamProviderId: providerIdentifier(home.id),
      awayTeamProviderId: providerIdentifier(away.id),
    })
  }

  return fixtures
}

/**
 * Safety net for the PRIMARY/SECONDARY split: a competition football-data.org already supplies must
 * never enter the pipeline from API-Football, even if an operator configures it by mistake. The
 * application-layer provider priority remains the final guard for anything that still overlaps.
 */
export function dropFootballDataCoveredFixtures(
  fixtures: CanonicalFixture[],
  sourceLabel: string = PROVIDER_LABEL[PROVIDER],
): CanonicalFixture[] {
  const kept: CanonicalFixture[] = []

  for (const fixture of fixtures) {
    const leagueId = Number(fixture.competitionCode)
    if (Number.isInteger(leagueId) && isFootballDataCoveredLeague(leagueId)) {
      logger.warn(
        { source: sourceLabel, leagueId, competitionCode: FOOTBALL_DATA_COVERED_API_FOOTBALL_LEAGUES[leagueId] },
        'Dropped API-Football fixture for a competition football-data.org owns',
      )
      continue
    }
    kept.push(fixture)
  }

  return kept
}

export type ApiFootballFixtureLoader = (
  leagueId: number,
  season: number,
  from: string,
  to: string,
) => Promise<unknown>

/**
 * Reads the configured additional competitions for a bounded window, one targeted
 * `league` + `season` request per competition.
 *
 * Per-league isolation: one failing league never loses the others, and a league that is over its
 * daily budget (or unconfigured) is reported as skipped rather than failed.
 */
export async function getApiFootballFixtures(
  dateFrom: string,
  dateTo: string,
  now = Date.now(),
  loadFixtures: ApiFootballFixtureLoader = fetchApiFootballFixtures,
  env: NodeJS.ProcessEnv = process.env,
): Promise<ProviderFetchResult> {
  if (!isApiFootballConfigured(env)) {
    return { fixtures: [], skipped: true, reason: 'not-configured' }
  }

  const { leagues, ignoredCoveredLeagueIds, source } = getApiFootballLeagues(env)
  if (leagues.length === 0) {
    // Everything configured is owned by football-data.org, so there is nothing to poll.
    return { fixtures: [], skipped: true, reason: 'no-leagues-configured' }
  }

  const dailyLimit = getApiFootballDailyRequestLimit(env)
  const cacheTtlSeconds = getApiFootballFixtureCacheSeconds(env)
  const at = new Date(now)

  const fixtures: CanonicalFixture[] = []
  const attemptedSources: string[] = []
  const failedSources: string[] = []
  let budgetBlocked = 0

  for (const league of leagues) {
    const label = `${PROVIDER_LABEL[PROVIDER]}:${league.id}`
    const season = resolveApiFootballSeason(league, at, env)

    try {
      const leagueFixtures = await cache<CanonicalFixture[] | null>(
        `sportzone:provider:api-football:fixtures:${league.id}:${season}:${dateFrom}:${dateTo}`,
        async () => {
          // The slot is reserved inside the loader so a cache hit consumes no quota, and a null
          // result is never cached, so the next cycle retries once budget is available again.
          if (!await acquireProviderRequestSlot(PROVIDER, dailyLimit, now)) return null
          return normalizeApiFootballFixtures(await loadFixtures(league.id, season, dateFrom, dateTo))
        },
        cacheTtlSeconds,
      )

      if (leagueFixtures === null) {
        budgetBlocked += 1
        logger.warn({ provider: PROVIDER, leagueId: league.id, dailyLimit }, 'API-Football daily request budget exhausted for this league')
        continue
      }

      attemptedSources.push(label)
      fixtures.push(...dropFootballDataCoveredFixtures(leagueFixtures, label))
    } catch (error) {
      attemptedSources.push(label)
      failedSources.push(label)
      logger.warn(
        { provider: PROVIDER, leagueId: league.id, season, providerStatus: getApiFootballProviderStatus(error) },
        'API-Football league request failed',
      )
    }
  }

  if (budgetBlocked === leagues.length) {
    return { fixtures: [], skipped: true, reason: 'daily-budget-exhausted' }
  }

  if (budgetBlocked > 0 || ignoredCoveredLeagueIds.length > 0) {
    logger.info({ provider: PROVIDER, budgetBlocked, ignoredCoveredLeagueIds, source }, 'API-Football discovery partially skipped')
  }

  return { fixtures, skipped: false, attemptedSources, failedSources }
}
