/**
 * API-Football league mapping.
 *
 * football-data.org stays the PRIMARY football provider, so API-Football is only asked for
 * competitions football-data.org does not supply. Every entry below is fetched with its own
 * targeted `league` + `season` request, which keeps the daily quota predictable: an unconfigured
 * or out-of-window competition costs nothing.
 *
 * The football-data.org-owned competitions are listed in FOOTBALL_DATA_COVERED_API_FOOTBALL_LEAGUES
 * and are filtered out of the mapping (and out of any provider payload) even if an operator adds
 * one, so the Premier League can never be discovered twice or rewritten by a lower-priority source.
 */

import logger from '../../core/logger.js'

/** How a competition's season year maps onto a calendar date. */
export type ApiFootballSeasonStyle =
  /** Season spans two calendar years (Aug-May): the season year is the year it started. */
  | 'EURO'
  /** Season runs inside one calendar year. */
  | 'CALENDAR'

export interface ApiFootballLeagueDefinition {
  id: number
  name: string
  seasonStyle: ApiFootballSeasonStyle
  /** Explicit season override; when omitted the season is resolved from the run date. */
  season?: number
}

/**
 * Additional football coverage supplied by API-Football. These are deliberately competitions that
 * football-data.org's plan does not cover, so the two providers never compete for the same fixture.
 *
 * Ids and `league.name` values were verified against raw `/v3/leagues` response dumps; the API
 * exposes no separate id for the previous Club World Cup format.
 */
export const DEFAULT_API_FOOTBALL_LEAGUES: readonly ApiFootballLeagueDefinition[] = [
  // The Club World Cup is played periodically and its latest available season is 2025, so the
  // season is pinned rather than derived (a derived 2026 season does not exist and would return an
  // empty set while still spending quota). Update the pin, or override with
  // `API_FOOTBALL_LEAGUES=15:<season>,...`, when a new edition is published.
  { id: 15, name: 'FIFA Club World Cup', seasonStyle: 'EURO', season: 2025 },
  { id: 5, name: 'UEFA Nations League', seasonStyle: 'EURO' },
  { id: 253, name: 'Major League Soccer', seasonStyle: 'CALENDAR' },
  { id: 307, name: 'Saudi Pro League', seasonStyle: 'EURO' },
  // International (national team) friendlies. Club friendlies are a separate competition (667)
  // and are intentionally not polled.
  { id: 10, name: 'International Friendlies', seasonStyle: 'CALENDAR' },
]

/**
 * API-Football league ids already supplied by football-data.org, keyed to the football-data
 * competition code. Discovery never requests these, and any fixture that still arrives for one of
 * them is dropped at the adapter boundary.
 */
export const FOOTBALL_DATA_COVERED_API_FOOTBALL_LEAGUES: Readonly<Record<number, string>> = {
  39: 'PL',
  140: 'PD',
  2: 'CL',
  135: 'SA',
  78: 'BL1',
  88: 'DED',
  71: 'BSA',
  61: 'FL1',
  40: 'ELC',
  94: 'PPL',
}

export const FOOTBALL_DATA_COVERED_LEAGUE_IDS: ReadonlySet<number> = new Set(
  Object.keys(FOOTBALL_DATA_COVERED_API_FOOTBALL_LEAGUES).map(Number),
)

export function isFootballDataCoveredLeague(leagueId: number): boolean {
  return FOOTBALL_DATA_COVERED_LEAGUE_IDS.has(leagueId)
}

export interface ApiFootballLeagueSelection {
  leagues: ApiFootballLeagueDefinition[]
  /** Football-data.org-owned ids that were configured and therefore ignored. */
  ignoredCoveredLeagueIds: number[]
  /** Where the selection came from, useful for logs and diagnostics. */
  source: 'configured' | 'default-mapping'
}

const coveredLeagueWarning = { logged: false }

function parseLeagueEntry(entry: string): { id: number; season?: number } | null {
  const [rawId, rawSeason] = entry.split(':')
  const id = Number(rawId?.trim())
  if (!Number.isInteger(id) || id <= 0) return null

  if (rawSeason === undefined || rawSeason.trim() === '') return { id }

  // Only a plausible football season year is accepted, so "253:current" is rejected instead of
  // silently querying a nonsense season.
  const season = Number(rawSeason.trim())
  return Number.isInteger(season) && season >= 1900 && season <= 2200 ? { id, season } : { id }
}

/**
 * Parses `API_FOOTBALL_LEAGUES`, for example `15,5,253:2026,307`. An entry may pin its own season
 * with `<leagueId>:<season>`.
 */
export function parseApiFootballLeagueConfig(raw: string | undefined): Array<{ id: number; season?: number }> {
  if (!raw?.trim()) return []

  const parsed: Array<{ id: number; season?: number }> = []
  const seen = new Set<number>()

  for (const entry of raw.split(',')) {
    const league = parseLeagueEntry(entry)
    if (!league || seen.has(league.id)) continue
    seen.add(league.id)
    parsed.push(league)
  }

  return parsed
}

function toDefinition(
  league: { id: number; season?: number },
  known: readonly ApiFootballLeagueDefinition[] = DEFAULT_API_FOOTBALL_LEAGUES,
): ApiFootballLeagueDefinition {
  const match = known.find((entry) => entry.id === league.id)
  return {
    id: league.id,
    name: match?.name ?? `API-Football league ${league.id}`,
    seasonStyle: match?.seasonStyle ?? 'EURO',
    season: league.season,
  }
}

/**
 * Resolves the API-Football leagues to poll.
 *
 * `API_FOOTBALL_LEAGUES` wins when set; otherwise the built-in additional-coverage mapping is used.
 * `API_FOOTBALL_DEFAULT_LEAGUE_ID` is retained for compatibility but never drives discovery — it
 * points at football-data.org-owned competitions (Premier League) and would duplicate them.
 */
export function getApiFootballLeagues(
  env: NodeJS.ProcessEnv = process.env,
  known: readonly ApiFootballLeagueDefinition[] = DEFAULT_API_FOOTBALL_LEAGUES,
): ApiFootballLeagueSelection {
  const configured = parseApiFootballLeagueConfig(env.API_FOOTBALL_LEAGUES)
  const candidates = configured.length > 0
    ? configured.map((league) => toDefinition(league, known))
    : [...known]

  const leagues: ApiFootballLeagueDefinition[] = []
  const ignoredCoveredLeagueIds: number[] = []

  for (const league of candidates) {
    if (isFootballDataCoveredLeague(league.id)) {
      ignoredCoveredLeagueIds.push(league.id)
      continue
    }
    leagues.push(league)
  }

  const legacyDefaultLeagues = parseApiFootballLeagueConfig(env.API_FOOTBALL_DEFAULT_LEAGUE_ID)
  const legacyCovered = legacyDefaultLeagues.filter((league) => isFootballDataCoveredLeague(league.id))

  if (legacyCovered.length > 0 && !coveredLeagueWarning.logged) {
    coveredLeagueWarning.logged = true
    logger.warn(
      { leagueIds: legacyCovered.map((league) => league.id), ignoredForDiscovery: true },
      'API_FOOTBALL_DEFAULT_LEAGUE_ID points at football-data.org-owned competitions; it is kept for compatibility and is not used for fixture discovery',
    )
  }

  return {
    leagues,
    ignoredCoveredLeagueIds,
    source: configured.length > 0 ? 'configured' : 'default-mapping',
  }
}

/**
 * Resolves the season to request for a league. An explicit season in the mapping wins, then
 * `API_FOOTBALL_DEFAULT_SEASON`, otherwise the season is derived from the run date using the
 * league's calendar style.
 */
export function resolveApiFootballSeason(
  league: ApiFootballLeagueDefinition,
  at: Date,
  env: NodeJS.ProcessEnv = process.env,
): number {
  if (league.season && league.season >= 1900) return league.season

  const configured = Number((env.API_FOOTBALL_DEFAULT_SEASON ?? '').trim())
  if (Number.isInteger(configured) && configured >= 1900 && configured <= 2200) return configured

  const year = at.getUTCFullYear()
  return league.seasonStyle === 'CALENDAR' || at.getUTCMonth() >= 6 ? year : year - 1
}
