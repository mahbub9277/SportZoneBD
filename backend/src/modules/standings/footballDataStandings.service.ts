import axios from 'axios'
import { randomUUID } from 'node:crypto'
import { BadRequestError, ServiceUnavailableError } from '../../core/errors.js'
import { cacheRedis } from '../../core/redis.js'
import logger from '../../core/logger.js'
import { getRedisErrorCode } from '../../core/redisFailover.js'
import { FOOTBALL_DATA_COMPETITIONS, type StandingsCompetitionCode } from '../matches/footballDataCompetitions.js'
import { acquireFootballDataRequestSlot } from '../matches/footballDataRequestLimiter.js'

export type LeagueCode = StandingsCompetitionCode

type StandingsPayload = Omit<LeagueStandingsResponse, 'meta'>

export interface LeagueStanding {
  position: number
  team: {
    id: number
    name: string
    shortName: string | null
    tla: string | null
    crest: string | null
  }
  playedGames: number
  won: number
  draw: number
  lost: number
  goalsFor: number
  goalsAgainst: number
  goalDifference: number
  points: number
  description: string | null
}

export interface LeagueStandingsResponse {
  competition: {
    code: LeagueCode
    name: string
    emblem: string | null
  }
  season: {
    id: number
    startDate: string | null
    endDate: string | null
    currentMatchday: number | null
  }
  standings: LeagueStanding[]
  meta: {
    source: 'football-data.org' | 'cache'
    cached: boolean
    stale: boolean
  }
}

const FOOTBALL_DATA_API_URL = 'https://api.football-data.org/v4/competitions'
const FRESH_CACHE_TTL_SECONDS = 600
const STALE_CACHE_TTL_SECONDS = 7 * 24 * 60 * 60
const REFRESH_LOCK_TTL_SECONDS = 15
const UPSTREAM_TIMEOUT_MS = 8_000
const CACHE_WAIT_DELAYS_MS = [100, 150, 250, 400, 650, 900, 1_200, 1_500, 1_500, 1_500]
const inFlightRefreshes = new Map<LeagueCode, Promise<LeagueStandingsResponse>>()
const RELEASE_LOCK_SCRIPT = "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end"

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requiredRecord(value: unknown, fieldName: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`Invalid football-data.org ${fieldName}.`)
  return value
}

function requiredString(value: unknown, fieldName: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Invalid football-data.org ${fieldName}.`)
  return value
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

function requiredInteger(value: unknown, fieldName: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) throw new Error(`Invalid football-data.org ${fieldName}.`)
  return value
}

function nullableInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) ? value : null
}

export function validateLeagueCode(value: unknown): LeagueCode {
  if (typeof value !== 'string') throw new BadRequestError('Unsupported competition code.')
  const code = value.trim().toUpperCase()
  const competition = FOOTBALL_DATA_COMPETITIONS.find((entry) => entry.code === code)
  if (!competition?.standingsSupported) throw new BadRequestError('Standings are not available for this competition.')
  return code as LeagueCode
}

export function getStandingsCompetitions() {
  return FOOTBALL_DATA_COMPETITIONS
}

export function normalizeFootballDataStandings(value: unknown, requestedCode: LeagueCode): StandingsPayload {
  const response = requiredRecord(value, 'response')
  const competition = requiredRecord(response.competition, 'competition')
  const season = requiredRecord(response.season, 'season')
  const providerCode = requiredString(competition.code, 'competition code').toUpperCase()

  if (providerCode !== requestedCode) throw new Error('Competition code did not match the request.')
  if (!Array.isArray(response.standings)) throw new Error('Invalid football-data.org standings.')

  const standingSection = response.standings.find((section) => isRecord(section) && section.type === 'TOTAL')
    ?? response.standings.find(isRecord)
  const table = standingSection ? standingSection.table : []
  if (!Array.isArray(table)) throw new Error('Invalid football-data.org standings table.')

  const standings = table.map((value): LeagueStanding => {
    const row = requiredRecord(value, 'standing row')
    const team = requiredRecord(row.team, 'team')
    return {
      position: requiredInteger(row.position, 'position'),
      team: {
        id: requiredInteger(team.id, 'team id'),
        name: requiredString(team.name, 'team name'),
        shortName: nullableString(team.shortName),
        tla: nullableString(team.tla),
        crest: nullableString(team.crest),
      },
      playedGames: requiredInteger(row.playedGames, 'played games'),
      won: requiredInteger(row.won, 'wins'),
      draw: requiredInteger(row.draw, 'draws'),
      lost: requiredInteger(row.lost, 'losses'),
      goalsFor: requiredInteger(row.goalsFor, 'goals for'),
      goalsAgainst: requiredInteger(row.goalsAgainst, 'goals against'),
      goalDifference: requiredInteger(row.goalDifference, 'goal difference'),
      points: requiredInteger(row.points, 'points'),
      description: nullableString(row.description),
    }
  })

  return {
    competition: {
      code: requestedCode,
      name: requiredString(competition.name, 'competition name'),
      emblem: nullableString(competition.emblem),
    },
    season: {
      id: requiredInteger(season.id, 'season id'),
      startDate: nullableString(season.startDate),
      endDate: nullableString(season.endDate),
      currentMatchday: nullableInteger(season.currentMatchday),
    },
    standings,
  }
}

export async function getStandings(value: unknown = 'PL'): Promise<LeagueStandingsResponse> {
  const leagueCode = validateLeagueCode(value)
  const pendingRefresh = inFlightRefreshes.get(leagueCode)
  if (pendingRefresh) return pendingRefresh

  const refresh = loadStandings(leagueCode)
  inFlightRefreshes.set(leagueCode, refresh)
  try {
    return await refresh
  } finally {
    if (inFlightRefreshes.get(leagueCode) === refresh) inFlightRefreshes.delete(leagueCode)
  }
}

async function loadStandings(leagueCode: LeagueCode): Promise<LeagueStandingsResponse> {
  const freshKey = getFreshCacheKey(leagueCode)
  const staleKey = getStaleCacheKey(leagueCode)
  const fresh = await readCachedPayload(freshKey)
  if (fresh) return withMeta(fresh, 'cache', true, false)

  const stale = await readCachedPayload(staleKey)
  const lockKey = `sportzonebd:football:standings:refresh-lock:${leagueCode}`
  const lockToken = randomUUID()
  let lockAcquired = false

  try {
    lockAcquired = (await cacheRedis.set(lockKey, lockToken, 'EX', REFRESH_LOCK_TTL_SECONDS, 'NX')) === 'OK'
  } catch (error) {
    logger.warn({ code: getRedisErrorCode(error), leagueCode }, 'Standings Redis lock is unavailable; refreshing with local coalescing only')
    return fetchAndCacheStandings(leagueCode, stale)
  }

  if (!lockAcquired) return waitForStandingsRefresh(leagueCode, stale)

  try {
    return await fetchAndCacheStandings(leagueCode, stale)
  } finally {
    try {
      await cacheRedis.eval(RELEASE_LOCK_SCRIPT, 1, lockKey, lockToken)
    } catch (error) {
      logger.warn({ code: getRedisErrorCode(error), leagueCode }, 'Standings Redis lock release failed')
    }
  }
}

async function fetchAndCacheStandings(
  leagueCode: LeagueCode,
  stale: StandingsPayload | null,
): Promise<LeagueStandingsResponse> {
  try {
    const apiKey = process.env.FOOTBALL_API_KEY
    if (!apiKey) throw new Error('provider-key-not-configured')
    if (!await acquireFootballDataRequestSlot('standings')) {
      throw new Error('football-data-request-limit-reached')
    }

    const response = await axios.get<unknown>(`${FOOTBALL_DATA_API_URL}/${leagueCode}/standings`, {
      headers: {
        'X-Auth-Token': apiKey,
        Accept: 'application/json',
      },
      timeout: UPSTREAM_TIMEOUT_MS,
    })
    const payload = normalizeFootballDataStandings(response.data, leagueCode)
    await writeCachedPayload(leagueCode, payload)
    return withMeta(payload, 'football-data.org', false, false)
  } catch (error) {
    logger.warn({ leagueCode, providerStatus: getProviderStatus(error) }, 'Football-data.org standings request failed')
    if (stale) return withMeta(stale, 'cache', true, true)
    throw new ServiceUnavailableError('Standings are temporarily unavailable.')
  }
}

async function waitForStandingsRefresh(
  leagueCode: LeagueCode,
  stale: StandingsPayload | null,
): Promise<LeagueStandingsResponse> {
  const freshKey = getFreshCacheKey(leagueCode)
  for (const delayMs of CACHE_WAIT_DELAYS_MS) {
    await new Promise((resolve) => setTimeout(resolve, delayMs))
    const refreshed = await readCachedPayload(freshKey)
    if (refreshed) return withMeta(refreshed, 'cache', true, false)
  }

  if (stale) return withMeta(stale, 'cache', true, true)
  throw new ServiceUnavailableError('Standings are temporarily unavailable.')
}

async function readCachedPayload(key: string): Promise<StandingsPayload | null> {
  try {
    const cachedValue = await cacheRedis.get(key)
    if (!cachedValue) return null
    const parsed: unknown = JSON.parse(cachedValue)
    if (isCachedPayload(parsed)) return parsed
    logger.warn({ key }, 'Ignoring invalid cached standings payload')
  } catch (error) {
    logger.warn({ code: getRedisErrorCode(error) }, 'Unable to read cached standings')
  }
  return null
}

async function writeCachedPayload(leagueCode: LeagueCode, payload: StandingsPayload): Promise<void> {
  try {
    const serialized = JSON.stringify(payload)
    await cacheRedis.pipeline()
      .set(getFreshCacheKey(leagueCode), serialized, 'EX', FRESH_CACHE_TTL_SECONDS)
      .set(getStaleCacheKey(leagueCode), serialized, 'EX', STALE_CACHE_TTL_SECONDS)
      .exec()
  } catch (error) {
    logger.warn({ code: getRedisErrorCode(error), leagueCode }, 'Unable to cache standings response')
  }
}

function isCachedPayload(value: unknown): value is StandingsPayload {
  return isRecord(value)
    && isRecord(value.competition)
    && isRecord(value.season)
    && Array.isArray(value.standings)
}

function withMeta(
  payload: StandingsPayload,
  source: LeagueStandingsResponse['meta']['source'],
  cached: boolean,
  stale: boolean,
): LeagueStandingsResponse {
  return { ...payload, meta: { source, cached, stale } }
}

function getFreshCacheKey(leagueCode: LeagueCode): string {
  return `sportzonebd:football:standings:${leagueCode}`
}

function getStaleCacheKey(leagueCode: LeagueCode): string {
  return `sportzonebd:football:standings:stale:${leagueCode}`
}

function getProviderStatus(error: unknown): number | string {
  if (!axios.isAxiosError(error)) return error instanceof Error ? error.name : 'unknown'
  return error.response?.status ?? error.code ?? 'network-error'
}
