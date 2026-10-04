import axios from 'axios'

/**
 * API-Football / API-Sports HTTP client.
 *
 * The key travels in the `x-apisports-key` header (the documented scheme for the direct
 * api-sports.io endpoint) and never in the query string, so URLs are safe to log.
 *
 * Requests are always scoped to one league and season plus a bounded date window: the unscoped
 * `/fixtures?from&to` sweep returned every competition in the world, which duplicated
 * football-data.org coverage and burned the daily quota.
 */

const DEFAULT_BASE_URL = 'https://v3.football.api-sports.io'
const UPSTREAM_TIMEOUT_MS = 10_000
/** API-Football's Free plan allows 100 requests per day. */
const DEFAULT_DAILY_REQUEST_LIMIT = 100

export function getApiFootballKey(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return env.API_FOOTBALL_KEY?.trim() || undefined
}

export function isApiFootballConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(getApiFootballKey(env))
}

export function getApiFootballBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  return (env.API_FOOTBALL_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, '')
}

export function getApiFootballDailyRequestLimit(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(env.API_FOOTBALL_DAILY_REQUEST_LIMIT)
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_DAILY_REQUEST_LIMIT
}

/** Fetches one league's fixtures for a bounded date window; returns the raw payload for normalization. */
export async function fetchApiFootballFixtures(
  leagueId: number,
  season: number,
  from: string,
  to: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<unknown> {
  const apiKey = getApiFootballKey(env)
  if (!apiKey) throw new Error('API_FOOTBALL_KEY is not configured')

  const response = await axios.get<unknown>(`${getApiFootballBaseUrl(env)}/fixtures`, {
    params: { league: leagueId, season, from, to },
    headers: {
      'x-apisports-key': apiKey,
      Accept: 'application/json',
    },
    timeout: UPSTREAM_TIMEOUT_MS,
  })

  return response.data
}

export function getApiFootballProviderStatus(error: unknown): number | string {
  if (!axios.isAxiosError(error)) return error instanceof Error ? error.name : 'unknown'
  return error.response?.status ?? error.code ?? 'network-error'
}
