import { cache } from '../../core/cache.js'
import logger from '../../core/logger.js'
import { acquireProviderRequestSlot } from '../../core/providerRequestBudget.js'
import { cacheRedis, isRedisConfigured } from '../../core/redis.js'
import { getRedisErrorCode } from '../../core/redisFailover.js'
import {
  ApiFootballResponseError,
  fetchApiFootballFixtures,
  getApiFootballDailyRequestLimit,
  getApiFootballProviderStatus,
  isApiFootballConfigured,
  redactApiFootballSecrets,
  throwIfApiFootballErrors,
  type ApiFootballErrorKind,
} from './apiFootball.client.js'
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

/**
 * How long one competition stays out of rotation after the provider reported an error in its
 * response body. An entitlement refusal is a property of the account plan rather than of the
 * request, so re-asking every minute would only spend the 100-request daily quota on the same
 * refusal.
 */
const DEFAULT_ERROR_BACKOFF_SECONDS = 6 * 60 * 60
/**
 * Deliberately distinguishable from the fixture cache prefix: a provider error is never stored, and
 * never read, as a fixture list. `[]` stays reserved for competitions that legitimately have none.
 */
const ERROR_MARKER_KEY_PREFIX = 'sportzone:provider:api-football:errors'

export function getApiFootballErrorBackoffSeconds(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(env.API_FOOTBALL_ERROR_BACKOFF_SECONDS)
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_ERROR_BACKOFF_SECONDS
}

export function getApiFootballErrorMarkerKey(leagueId: number, season: number): string {
  return `${ERROR_MARKER_KEY_PREFIX}:${leagueId}:${season}`
}

export interface ApiFootballErrorMarker {
  kind: ApiFootballErrorKind
  message: string
  /** Epoch milliseconds after which the competition may be requested again. */
  until: number
}

/**
 * In-process mirror of the marker. It keeps the backoff effective when Redis is unavailable and
 * saves a Redis read on every cycle while it is held; Redis remains the cross-instance record.
 */
const localErrorMarkers = new Map<string, ApiFootballErrorMarker>()

function localErrorMarkerKey(leagueId: number, season: number): string {
  return `${leagueId}:${season}`
}

function readLocalErrorMarker(leagueId: number, season: number, now: number): ApiFootballErrorMarker | null {
  const key = localErrorMarkerKey(leagueId, season)
  const stored = localErrorMarkers.get(key)
  if (!stored) return null
  if (stored.until > now) return stored

  localErrorMarkers.delete(key)
  return null
}

/** Reads the active backoff marker, if the provider is known to be refusing this competition. */
export async function readApiFootballErrorMarker(
  leagueId: number,
  season: number,
  now = Date.now(),
): Promise<ApiFootballErrorMarker | null> {
  const local = readLocalErrorMarker(leagueId, season, now)
  if (local) return local

  if (!isRedisConfigured) return null

  try {
    const stored = await cacheRedis.get(getApiFootballErrorMarkerKey(leagueId, season))
    if (!stored) return null

    const parsed = JSON.parse(stored) as Partial<ApiFootballErrorMarker>
    if (typeof parsed.until !== 'number' || parsed.until <= now) return null

    const marker: ApiFootballErrorMarker = {
      kind: parsed.kind === 'plan' ? 'plan' : 'provider',
      message: typeof parsed.message === 'string' ? parsed.message : '',
      until: parsed.until,
    }
    localErrorMarkers.set(localErrorMarkerKey(leagueId, season), marker)
    return marker
  } catch (error) {
    // Failing open is intentional: the daily budget still bounds a provider that keeps refusing.
    logger.warn(
      { code: getRedisErrorCode(error), provider: PROVIDER, leagueId },
      'API-Football error backoff could not be read; the competition will be requested again',
    )
    return null
  }
}

/** Remembers a provider refusal so the following cycles skip this competition instead of re-asking. */
export async function recordApiFootballErrorMarker(
  leagueId: number,
  season: number,
  error: ApiFootballResponseError,
  now = Date.now(),
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const ttlSeconds = getApiFootballErrorBackoffSeconds(env)
  const marker: ApiFootballErrorMarker = {
    kind: error.kind,
    message: error.issues.join('; '),
    until: now + ttlSeconds * 1000,
  }

  for (const [key, stored] of localErrorMarkers) {
    if (stored.until <= now) localErrorMarkers.delete(key)
  }
  localErrorMarkers.set(localErrorMarkerKey(leagueId, season), marker)

  if (!isRedisConfigured) return

  try {
    await cacheRedis.set(getApiFootballErrorMarkerKey(leagueId, season), JSON.stringify(marker), 'EX', ttlSeconds)
  } catch (error) {
    logger.warn(
      { code: getRedisErrorCode(error), provider: PROVIDER, leagueId, season },
      'API-Football error backoff could not be written to Redis',
    )
  }
}

/** A successful response means the provider serves this competition again, so the backoff ends. */
export async function clearApiFootballErrorMarker(leagueId: number, season: number): Promise<void> {
  localErrorMarkers.delete(localErrorMarkerKey(leagueId, season))

  if (!isRedisConfigured) return

  try {
    await cacheRedis.del(getApiFootballErrorMarkerKey(leagueId, season))
  } catch (error) {
    logger.warn(
      { code: getRedisErrorCode(error), provider: PROVIDER, leagueId, season },
      'API-Football error backoff could not be cleared in Redis',
    )
  }
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
  // Checked before the shape, because a refusal carries the same empty `response` a healthy but
  // empty competition does and must not be normalized or cached as one.
  throwIfApiFootballErrors(value)

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
      // API-Football states the season as its year (for example 2026); nothing is derived from it.
      season: typeof league.season === 'number' && Number.isInteger(league.season) ? String(league.season) : null,
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
 * Per-league isolation: one failing league never loses the others. A league that is switched off by
 * configuration, over its daily budget, or inside a provider-error backoff is reported as skipped
 * rather than failed, and a provider refusal is reported as a failure instead of an empty result.
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
    // Nothing to poll: every configured competition is owned by football-data.org, or the provider
    // was switched off with API_FOOTBALL_LEAGUES=disabled.
    return {
      fixtures: [],
      skipped: true,
      reason: source === 'disabled' ? 'provider-disabled' : 'no-leagues-configured',
    }
  }

  const dailyLimit = getApiFootballDailyRequestLimit(env)
  const cacheTtlSeconds = getApiFootballFixtureCacheSeconds(env)
  const at = new Date(now)

  const fixtures: CanonicalFixture[] = []
  const attemptedSources: string[] = []
  const failedSources: string[] = []
  const backoffKinds = new Set<ApiFootballErrorKind>()
  let budgetBlocked = 0
  let backoffBlocked = 0

  for (const league of leagues) {
    const label = `${PROVIDER_LABEL[PROVIDER]}:${league.id}`
    const season = resolveApiFootballSeason(league, at, env)

    try {
      let backedOff = false
      const leagueFixtures = await cache<CanonicalFixture[] | null>(
        `sportzone:provider:api-football:fixtures:${league.id}:${season}:${dateFrom}:${dateTo}`,
        async () => {
          // Both gates live inside the loader so that a cache hit costs neither quota nor Redis
          // reads. A known refusal ends the cycle for this competition without a provider request.
          const marker = await readApiFootballErrorMarker(league.id, season, now)
          if (marker) {
            backedOff = true
            backoffKinds.add(marker.kind)
            return null
          }

          // The slot is reserved inside the loader so a cache hit consumes no quota, and a null
          // result is never cached, so the next cycle retries once budget is available again.
          if (!await acquireProviderRequestSlot(PROVIDER, dailyLimit, now)) return null

          const payload = await loadFixtures(league.id, season, dateFrom, dateTo)
          throwIfApiFootballErrors(payload)
          const normalized = normalizeApiFootballFixtures(payload)
          await clearApiFootballErrorMarker(league.id, season)
          return normalized
        },
        cacheTtlSeconds,
      )

      if (leagueFixtures === null) {
        if (backedOff) {
          backoffBlocked += 1
          continue
        }
        budgetBlocked += 1
        logger.warn({ provider: PROVIDER, leagueId: league.id, dailyLimit }, 'API-Football daily request budget exhausted for this league')
        continue
      }

      attemptedSources.push(label)
      fixtures.push(...dropFootballDataCoveredFixtures(leagueFixtures, label))
    } catch (error) {
      attemptedSources.push(label)
      failedSources.push(label)

      if (error instanceof ApiFootballResponseError) {
        // The provider answered, so the failure is reported once and the competition is then held
        // out of rotation until the backoff expires.
        await recordApiFootballErrorMarker(league.id, season, error, now, env)
        backoffKinds.add(error.kind)
        logger.warn(
          {
            provider: PROVIDER,
            competition: league.id,
            leagueId: league.id,
            season,
            reason: error.kind,
            action: 'backoff',
            backoffSeconds: getApiFootballErrorBackoffSeconds(env),
            message: redactApiFootballSecrets(error.issues.join('; '), env),
          },
          'API-Football provider error; backing off this competition',
        )
        continue
      }

      logger.warn(
        { provider: PROVIDER, leagueId: league.id, season, providerStatus: getApiFootballProviderStatus(error) },
        'API-Football league request failed',
      )
    }
  }

  if (backoffBlocked > 0) {
    logger.info(
      { provider: PROVIDER, backoffBlocked, competitionCount: leagues.length, reasons: [...backoffKinds] },
      'API-Football competitions in error backoff were not requested',
    )
  }

  if (budgetBlocked === leagues.length) {
    return { fixtures: [], skipped: true, reason: 'daily-budget-exhausted' }
  }

  if (backoffBlocked === leagues.length) {
    return { fixtures: [], skipped: true, reason: 'provider-error-backoff' }
  }

  if (budgetBlocked > 0 || backoffBlocked > 0 || ignoredCoveredLeagueIds.length > 0) {
    logger.info(
      { provider: PROVIDER, budgetBlocked, backoffBlocked, ignoredCoveredLeagueIds, source },
      'API-Football discovery partially skipped',
    )
  }

  return { fixtures, skipped: false, attemptedSources, failedSources }
}
