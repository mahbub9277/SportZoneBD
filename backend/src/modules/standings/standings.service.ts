import axios from 'axios'
import { cache } from '../../core/cache.js'
import logger from '../../core/logger.js'

const API_FOOTBALL_KEY = process.env.API_FOOTBALL_KEY
const API_FOOTBALL_BASE_URL = process.env.API_FOOTBALL_BASE_URL ?? 'https://v3.football.api-sports.io'
const API_FOOTBALL_HOST = process.env.API_FOOTBALL_HOST ?? 'v3.football.api-sports.io'
const DEFAULT_LEAGUE_ID = process.env.API_FOOTBALL_DEFAULT_LEAGUE_ID ?? '39'

export function parseSeasonValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Number.isInteger(value) ? value : null
  }

  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  if (!trimmed) {
    return null
  }

  const match = trimmed.match(/(\d{4})(?:[-/](\d{4}))?/)
  if (!match) {
    return null
  }

  const [, firstYear] = match
  const first = Number(firstYear)

  if (!Number.isInteger(first)) {
    return null
  }

  return first
}

function getMaxSupportedSeason(): number {
  const configuredSeason = parseSeasonValue(process.env.API_FOOTBALL_DEFAULT_SEASON)
  if (configuredSeason !== null && configuredSeason >= 2000) {
    return configuredSeason
  }

  const currentYear = new Date().getFullYear()
  // API-Football labels the season by its starting year; the European
  // football season starts around August, so September 2026 is season 2026.
  return new Date().getMonth() >= 7 ? currentYear : currentYear - 1
}

const MAX_SUPPORTED_SEASON = getMaxSupportedSeason()

export interface StandingTeam {
  rank: number
  team: { id: number | string; name: string; logo?: string | null }
  points: number
  played: number
  win: number
  draw: number
  loss: number
  goalsFor: number
  goalsAgainst: number
  goalDifference: number
  form?: string | null
  status?: string | null
  group?: string | null
}

export interface StandingsTable {
  league: {
    id: number | string
    name: string
    country: string
    logo?: string | null
    season: number
  }
  table: StandingTeam[]
}

export function selectSupportedSeason(seasons: Array<{ year?: unknown; current?: boolean; coverage?: { standings?: boolean } }> | undefined, fallbackSeason = getMaxSupportedSeason()): number {
  const normalizedSeasons = (Array.isArray(seasons) ? seasons : [])
    .map((season) => {
      const year = parseSeasonValue(season?.year)
      return {
        year,
        current: season.current === true,
        hasStandings: season.coverage?.standings !== false,
      }
    })
    .filter((season) => Number.isInteger(season.year) && season.year !== null)
    .map((season) => ({
      year: season.year as number,
      current: season.current,
      hasStandings: season.hasStandings,
    }))

  const maxAllowedSeason = getMaxSupportedSeason()
  const supportedSeasons = normalizedSeasons
    .filter((season) => season.year <= maxAllowedSeason && season.hasStandings)
    .sort((left, right) => right.year - left.year)

  const currentSeason = supportedSeasons.find((season) => season.current)
  if (currentSeason) return currentSeason.year

  return supportedSeasons[0]?.year ?? fallbackSeason
}



async function resolveCurrentSeasonForLeague(leagueId: string): Promise<number> {
  const cacheKey = `standings:currentSeason:${leagueId}`

  return cache(
    cacheKey,
    async () => {
      try {
        const url = `${API_FOOTBALL_BASE_URL}/leagues`
        const response = await axios.get(url, {
          params: { id: leagueId },
          headers: {
            'x-apisports-key': API_FOOTBALL_KEY!,
            'x-apisports-host': API_FOOTBALL_HOST,
            Accept: 'application/json',
          },
          timeout: 10000,
        })

        const apiData = response.data
        if (!apiData || !Array.isArray(apiData.response) || apiData.response.length === 0) {
          throw new Error(`Unable to resolve current season for league ${leagueId}.`)
        }

        const [payload] = apiData.response
        const seasons = Array.isArray(payload.seasons) ? payload.seasons : []
        const resolvedSeason = selectSupportedSeason(seasons)

        if (!Number.isInteger(resolvedSeason)) {
          throw new Error(`Unable to resolve current season for league ${leagueId} from provider metadata.`)
        }

        logger.info({ leagueId, resolvedSeason, cacheKey, timestamp: new Date().toISOString() }, 'Resolved current season from provider metadata')
        return resolvedSeason
      } catch (error) {
        logger.warn({ error, leagueId, fallbackSeason: getMaxSupportedSeason() }, 'Using fallback season for standings')
        return getMaxSupportedSeason()
      }
    },
    60 * 60,
    ['standings', `standings:currentSeason:${leagueId}`],
  )
}

export const getStandings = async (leagueId?: string, season?: number): Promise<StandingsTable> => {
  const resolvedLeagueId = leagueId?.trim() || DEFAULT_LEAGUE_ID
  const resolvedSeason = await resolveCurrentSeasonForLeague(resolvedLeagueId)

  if (season !== undefined && Number.isInteger(season) && season !== resolvedSeason) {
    logger.warn({ leagueId: resolvedLeagueId, requestedSeason: season, resolvedSeason }, 'Ignoring unsupported requested season for standings')
  }

  const cacheKey = `standings:${resolvedLeagueId}:${resolvedSeason}`
  logger.info({ leagueId: resolvedLeagueId, requestedSeason: season, resolvedSeason, cacheKey }, 'Fetching standings for resolved current season')

  return await cache(
    cacheKey,
    async () => fetchStandingsFromApi(resolvedLeagueId, resolvedSeason),
    300,
    ['standings', `standings:${resolvedLeagueId}:${resolvedSeason}`],
  )
}

async function fetchStandingsFromApi(leagueId: string, season: number): Promise<StandingsTable> {
  if (!API_FOOTBALL_KEY) {
    throw new Error('API_FOOTBALL_KEY is not configured. Please set it in your backend environment.')
  }

  const url = `${API_FOOTBALL_BASE_URL}/standings`

  try {
    const response = await axios.get(url, {
      params: { league: leagueId, season },
      headers: {
        'x-apisports-key': API_FOOTBALL_KEY!,
        'x-apisports-host': API_FOOTBALL_HOST,
        Accept: 'application/json',
      },
      timeout: 10000,
    })

    const apiData = response.data

    if (!apiData) {
      throw new Error('Unexpected standings response from API Football.')
    }

    if (apiData.errors && Object.keys(apiData.errors).length > 0) {
      const apiMessage = typeof apiData.errors === 'string' ? apiData.errors : JSON.stringify(apiData.errors)
      throw new Error(`API Football error: ${apiMessage}`)
    }

    if (!Array.isArray(apiData.response) || apiData.response.length === 0) {
      throw new Error('API Football returned no standings data for this season.')
    }

    const [payload] = apiData.response
    const league = payload.league ?? payload ?? {}
    const providerSeason = parseSeasonValue(league.season ?? payload.season ?? season)

    if (providerSeason === null || !Number.isInteger(providerSeason)) {
      throw new Error('API Football returned an invalid season for standings response.')
    }

    if (providerSeason !== season) {
      throw new Error(`API Football returned season ${providerSeason} but the current season is ${season}.`)
    }

    const standingsData = Array.isArray(payload.league?.standings)
      ? payload.league.standings
      : Array.isArray(payload.standings)
      ? payload.standings
      : []
    const standingsRows = Array.isArray(standingsData[0]) ? standingsData[0] : standingsData

    return {
      league: {
        id: league.id ?? Number(leagueId),
        name: league.name ?? 'Unknown League',
        country: league.country ?? 'Unknown Country',
        logo: league.logo ?? null,
        season: providerSeason,
      },
      table: standingsRows.map((row: any) => ({
        rank: row.rank,
        team: {
          id: row.team?.id ?? row.team?.name ?? '',
          name: row.team?.name ?? 'Unknown Team',
          logo: row.team?.logo ?? null,
        },
        points: row.points ?? 0,
        played: row.all?.played ?? 0,
        win: row.all?.win ?? 0,
        draw: row.all?.draw ?? 0,
        loss: row.all?.lose ?? 0,
        goalsFor: row.all?.goals?.for ?? 0,
        goalsAgainst: row.all?.goals?.against ?? 0,
        goalDifference: row.goalsDiff ?? 0,
        form: row.form ?? null,
        status: row.status ?? null,
        group: row.group ?? null,
      })),
    }
  } catch (error: unknown) {
    logger.error({ error, leagueId, season }, 'Failed to fetch standings from API Football')

    if (axios.isAxiosError(error) && error.response) {
      const apiMessage = error.response.data?.message ?? error.response.statusText
      throw new Error(`API Football request failed: ${apiMessage}`)
    }

    throw error instanceof Error ? error : new Error('Unable to retrieve standings.')
  }
}
