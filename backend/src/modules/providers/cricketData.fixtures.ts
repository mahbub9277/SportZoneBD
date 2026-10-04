import { cache } from '../../core/cache.js'
import logger from '../../core/logger.js'
import { acquireProviderRequestSlot } from '../../core/providerRequestBudget.js'
import { fetchCricketMatches, getCricketDailyRequestLimit, getCricketEndpoint, getCricketProviderStatus, isCricketDataConfigured } from './cricketData.client.js'
import { isRecord, nullableHttpUrl, providerIdentifier, requiredString } from './normalize.js'
import type { CanonicalFixture, ProviderFetchResult } from './types.js'

/**
 * CricketData.org adapter. Normalizes cricket matches into the same canonical fixture shape as
 * football, using the existing `CRICKET` sport value on the Match model.
 */

const PROVIDER = 'CRICKET_DATA'
const FIXTURE_CACHE_TTL_SECONDS = Number(process.env.CRICKET_FIXTURE_CACHE_SECONDS ?? 2 * 60 * 60)
const SKIP_STATUS = /abandon|cancel|postpon|no result|not covered/i

/**
 * CricketData publishes `dateTimeGMT` without a timezone designator, so `new Date()` would treat it
 * as local time. It is documented as GMT, so a missing designator is pinned to UTC explicitly.
 */
export function parseCricketUtc(value: unknown, field: string): string {
  const raw = requiredString(value, field)
  const hasDesignator = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw)
  const parsed = new Date(hasDesignator ? raw : `${raw}Z`)
  if (Number.isNaN(parsed.getTime())) throw new Error(`Invalid provider ${field}.`)
  return parsed.toISOString()
}

export function normalizeCricketStatus(entry: Record<string, unknown>): 'UPCOMING' | 'LIVE' | 'FINISHED' | null {
  const statusText = typeof entry.status === 'string' ? entry.status : ''
  // Abandoned/cancelled/postponed matches have no SportZoneBD equivalent and are skipped rather
  // than invented, matching the existing provider behaviour.
  if (SKIP_STATUS.test(statusText)) return null

  if (entry.matchEnded === true) return 'FINISHED'
  if (entry.matchStarted === true) return 'LIVE'
  if (entry.matchStarted === false) return 'UPCOMING'

  return null
}

interface CricketTeam {
  name: string
  crest: string | null
  providerId: string | null
}

function readTeamInfo(entry: Record<string, unknown>): CricketTeam[] {
  if (!Array.isArray(entry.teamInfo)) return []
  return entry.teamInfo.filter(isRecord).map((team) => ({
    name: typeof team.name === 'string' ? team.name.trim() : '',
    crest: nullableHttpUrl(team.img),
    providerId: providerIdentifier(team.id),
  })).filter((team) => team.name.length > 0)
}

export function normalizeCricketMatch(entry: Record<string, unknown>): CanonicalFixture | null {
  const status = normalizeCricketStatus(entry)
  if (!status) return null

  const teamInfo = readTeamInfo(entry)
  const names = Array.isArray(entry.teams) ? entry.teams.filter((team): team is string => typeof team === 'string') : []
  const homeName = teamInfo[0]?.name ?? names[0]?.trim()
  const awayName = teamInfo[1]?.name ?? names[1]?.trim()
  if (!homeName || !awayName) return null

  const series = typeof entry.series === 'string' && entry.series.trim() ? entry.series.trim() : 'Cricket'

  return {
    provider: PROVIDER,
    sport: 'CRICKET',
    providerMatchId: providerIdentifier(entry.id),
    status,
    kickoffAt: parseCricketUtc(entry.dateTimeGMT ?? entry.date, 'kickoff time'),
    competitionCode: providerIdentifier(entry.series_id) ?? series,
    competitionName: series,
    homeTeamName: homeName,
    awayTeamName: awayName,
    homeTeamCrest: teamInfo[0]?.crest ?? null,
    awayTeamCrest: teamInfo[1]?.crest ?? null,
    homeTeamProviderId: teamInfo[0]?.providerId ?? null,
    awayTeamProviderId: teamInfo[1]?.providerId ?? null,
  }
}

export function normalizeCricketFixtures(value: unknown): CanonicalFixture[] {
  if (!isRecord(value)) throw new Error('Invalid provider response.')
  if (!Array.isArray(value.data)) throw new Error('Invalid provider match list.')

  const fixtures: CanonicalFixture[] = []
  const seen = new Set<string>()

  for (const entry of value.data) {
    if (!isRecord(entry)) continue
    const fixture = normalizeCricketMatch(entry)
    if (!fixture) continue
    const key = fixture.providerMatchId ?? `${fixture.homeTeamName}|${fixture.awayTeamName}|${fixture.kickoffAt}`
    if (seen.has(key)) continue
    seen.add(key)
    fixtures.push(fixture)
  }

  return fixtures
}

function withinWindow(fixtures: CanonicalFixture[], from: Date, to: Date): CanonicalFixture[] {
  return fixtures.filter((fixture) => {
    const kickoff = new Date(fixture.kickoffAt).getTime()
    return kickoff >= from.getTime() && kickoff <= to.getTime()
  })
}

/**
 * Reads cricket matches and keeps only those inside the requested window. The provider has no
 * date filter, so one cached call covers every sync cycle until the cache expires.
 */
export async function getCricketFixtures(
  dateFrom: string,
  dateTo: string,
  now = Date.now(),
  loadMatches: typeof fetchCricketMatches = fetchCricketMatches,
): Promise<ProviderFetchResult> {
  if (!isCricketDataConfigured()) {
    return { fixtures: [], skipped: true, reason: 'not-configured' }
  }

  if (!await acquireProviderRequestSlot(PROVIDER, getCricketDailyRequestLimit(), now)) {
    logger.warn({ provider: PROVIDER }, 'CricketData daily request budget exhausted; skipping this cycle')
    return { fixtures: [], skipped: true, reason: 'daily-budget-exhausted' }
  }

  const windowStart = new Date(`${dateFrom}T00:00:00.000Z`)
  const windowEnd = new Date(`${dateTo}T23:59:59.999Z`)

  try {
    const fixtures = await cache<CanonicalFixture[]>(
      `sportzone:provider:cricket-data:${getCricketEndpoint()}:${dateFrom}:${dateTo}`,
      async () => withinWindow(normalizeCricketFixtures(await loadMatches()), windowStart, windowEnd),
      FIXTURE_CACHE_TTL_SECONDS,
    )
    return { fixtures, skipped: false }
  } catch (error) {
    logger.warn({ provider: PROVIDER, providerStatus: getCricketProviderStatus(error) }, 'CricketData fixture request failed')
    throw error
  }
}
