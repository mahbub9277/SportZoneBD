import axios from 'axios'
import { ServiceUnavailableError } from '../../core/errors.js'
import logger from '../../core/logger.js'

export const DEFAULT_FOOTBALL_DISCOVERY_COMPETITION = 'PL'
export const DEFAULT_FOOTBALL_DISCOVERY_COMPETITIONS = ['PL', 'PD', 'CL', 'SA', 'BL1'] as const
export const FOOTBALL_DISCOVERY_COMPETITION = DEFAULT_FOOTBALL_DISCOVERY_COMPETITION

export interface FootballDataFixture {
  id?: string
  kickoffAt: string
  status: string
  competitionCode: string
  competitionName: string
  homeTeamName: string
  awayTeamName: string
  homeTeamCrest?: string | null
  awayTeamCrest?: string | null
}

const FOOTBALL_DATA_API_URL = 'https://api.football-data.org/v4/competitions'
const UPSTREAM_TIMEOUT_MS = 10_000

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requiredRecord(value: unknown, field: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`Invalid football-data.org ${field}.`)
  return value
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`Invalid football-data.org ${field}.`)
  return value.trim()
}

function nullableHttpUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null
  try {
    const url = new URL(value.trim())
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null
  } catch {
    return null
  }
}

function normalizeCompetitionCode(value: string | null | undefined): string {
  const code = value?.trim().toUpperCase()
  return code && code.length > 0 ? code : DEFAULT_FOOTBALL_DISCOVERY_COMPETITION
}

export function getConfiguredCompetitionCodes(): string[] {
  const configured = process.env.FOOTBALL_DISCOVERY_COMPETITIONS ?? process.env.FOOTBALL_DISCOVERY_COMPETITION
  if (!configured?.trim()) return [...DEFAULT_FOOTBALL_DISCOVERY_COMPETITIONS]

  return [...new Set(
    configured
      .split(',')
      .map((entry) => normalizeCompetitionCode(entry))
      .filter(Boolean),
  )]
}

export async function getCompetitionFixtures(
  competitionCode: string,
  dateFrom: string,
  dateTo: string,
): Promise<FootballDataFixture[]> {
  const normalizedCode = normalizeCompetitionCode(competitionCode)
  const apiKey = process.env.FOOTBALL_API_KEY?.trim()
  if (!apiKey) throw new ServiceUnavailableError('FOOTBALL_API_KEY is not configured.')

  try {
    const response = await axios.get<unknown>(`${FOOTBALL_DATA_API_URL}/${normalizedCode}/matches`, {
      params: { dateFrom, dateTo },
      headers: {
        'X-Auth-Token': apiKey,
        Accept: 'application/json',
      },
      timeout: UPSTREAM_TIMEOUT_MS,
    })

    return normalizeCompetitionFixtures(response.data, normalizedCode)
  } catch (error) {
    logger.warn({ competitionCode: normalizedCode, providerStatus: getProviderStatus(error) }, 'Football-data.org fixture request failed')
    throw new ServiceUnavailableError('Football fixture data is temporarily unavailable.')
  }
}

export async function getConfiguredCompetitionFixtures(
  dateFrom: string,
  dateTo: string,
): Promise<FootballDataFixture[]> {
  const competitions = getConfiguredCompetitionCodes()
  if (competitions.length === 0) return []

  const fixturesByCompetition = await Promise.all(competitions.map(async (competitionCode) => {
    try {
      return await getCompetitionFixtures(competitionCode, dateFrom, dateTo)
    } catch {
      return []
    }
  }))

  return fixturesByCompetition.flat()
}

function normalizeCompetitionFixtures(value: unknown, competitionCode: string): FootballDataFixture[] {
  const payload = requiredRecord(value, 'fixture response')
  if (!Array.isArray(payload.matches)) throw new Error('Invalid football-data.org fixture list.')

  return payload.matches.map((value): FootballDataFixture => {
    const match = requiredRecord(value, 'fixture')
    const competition = requiredRecord(match.competition, 'competition')
    const homeTeam = requiredRecord(match.homeTeam, 'home team')
    const awayTeam = requiredRecord(match.awayTeam, 'away team')
    const kickoffAt = requiredString(match.utcDate, 'kickoff time')

    if (!Number.isFinite(Date.parse(kickoffAt))) throw new Error('Invalid football-data.org kickoff time.')

    return {
      id: typeof match.id === 'number' ? String(match.id) : undefined,
      kickoffAt,
      status: requiredString(match.status, 'match status').toUpperCase(),
      competitionCode,
      competitionName: requiredString(competition.name, 'competition name'),
      homeTeamName: requiredString(homeTeam.name, 'home team name'),
      awayTeamName: requiredString(awayTeam.name, 'away team name'),
      homeTeamCrest: nullableHttpUrl(homeTeam.crest),
      awayTeamCrest: nullableHttpUrl(awayTeam.crest),
    }
  })
}

function getProviderStatus(error: unknown): number | string {
  if (!axios.isAxiosError(error)) return error instanceof Error ? error.name : 'unknown'
  return error.response?.status ?? error.code ?? 'network-error'
}
