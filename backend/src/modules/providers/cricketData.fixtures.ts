import { cache } from '../../core/cache.js'
import logger from '../../core/logger.js'
import { acquireProviderRequestSlot } from '../../core/providerRequestBudget.js'
import { classifyCricketFixture, isCricketCategoryEligible } from './cricketCategory.js'
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

/**
 * The competition a cricket fixture belongs to, taken only from what the provider states.
 *
 * `/currentMatches` publishes `series_id` but no `series` field, while the fixture `name` always carries
 * the competition as its trailing segment ("Western Australia vs Queensland, 3rd Match, Sheffield Shield
 * 2026-27"). Reading it from there is provider data, not an invention, and it is what keeps the real
 * competition (and the series-based eligibility rule) working for every fixture. When neither field
 * carries a competition the plain sport label is used, exactly as before.
 */
export function readCricketSeries(entry: Record<string, unknown>): string | null {
  const series = typeof entry.series === 'string' ? entry.series.trim() : ''
  if (series) return series

  const name = typeof entry.name === 'string' ? entry.name.trim() : ''
  if (!name) return null
  const segments = name.split(',').map((segment) => segment.trim()).filter(Boolean)
  if (segments.length < 2) return null

  const competition = segments[segments.length - 1]
  // A trailing segment only describes a competition when it carries something other than a number.
  return /[a-z]/i.test(competition) ? competition : null
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

  const series = readCricketSeries(entry) ?? 'Cricket'

  return {
    provider: PROVIDER,
    sport: 'CRICKET',
    providerMatchId: providerIdentifier(entry.id),
    status,
    kickoffAt: parseCricketUtc(entry.dateTimeGMT ?? entry.date, 'kickoff time'),
    competitionCode: providerIdentifier(entry.series_id) ?? series,
    competitionName: series,
    // CricketData publishes the series, not a season, so no season label is invented here. It publishes
    // no matchday either: the series has no league round.
    season: null,
    round: null,
    homeTeamName: homeName,
    awayTeamName: awayName,
    // CricketData's team images are served from its own CDN (`g.cricapi.com`) and are not licensed for
    // hotlinking, so they are deliberately not copied into a match's logo fields. A team's logo comes from
    // SportZoneBD's own approved assets (the admin-managed Team records in Cloudinary), and a fixture
    // whose teams have no asset keeps the initials fallback the admin list already renders.
    homeTeamCrest: null,
    awayTeamCrest: null,
    homeTeamProviderId: teamInfo[0]?.providerId ?? null,
    awayTeamProviderId: teamInfo[1]?.providerId ?? null,
  }
}

export function normalizeCricketFixtures(value: unknown): CanonicalFixture[] {
  if (!isRecord(value)) throw new Error('Invalid provider response.')
  if (!Array.isArray(value.data)) throw new Error('Invalid provider match list.')

  const fixtures: CanonicalFixture[] = []
  const seen = new Set<string>()
  let categorySkipped = 0

  for (const entry of value.data) {
    if (!isRecord(entry)) continue
    // The competition the fixture really belongs to: the provider's `series` when it has one, otherwise
    // the competition segment of the provider's own fixture name. Category C (the marquee short formats)
    // depends on it, so reading it here is what stops a real T10/Hundred fixture being dropped as unknown.
    const series = readCricketSeries(entry)
    // Business rule (Step 6): only A/B fixtures, plus marquee C fixtures, reach the pending review
    // queue. D fixtures (unknown or unsupported formats) are never imported automatically.
    if (!isCricketCategoryEligible(classifyCricketFixture({ matchType: entry.matchType, series }))) {
      categorySkipped += 1
      continue
    }
    const fixture = normalizeCricketMatch(entry)
    if (!fixture) continue
    const key = fixture.providerMatchId ?? `${fixture.homeTeamName}|${fixture.awayTeamName}|${fixture.kickoffAt}`
    if (seen.has(key)) continue
    seen.add(key)
    fixtures.push(fixture)
  }

  if (categorySkipped > 0) {
    logger.info(
      { provider: PROVIDER, categorySkipped, imported: fixtures.length, window: 'cricket' },
      'Cricket fixtures skipped by discovery category rules',
    )
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

  const windowStart = new Date(`${dateFrom}T00:00:00.000Z`)
  const windowEnd = new Date(`${dateTo}T23:59:59.999Z`)

  try {
    // The budget slot stands for a real upstream request, so it is reserved inside the cache loader:
    // a cache hit returns without consuming the provider budget.
    const fixtures = await cache<CanonicalFixture[] | null>(
      `sportzone:provider:cricket-data:${getCricketEndpoint()}:${dateFrom}:${dateTo}`,
      async () => {
        if (!await acquireProviderRequestSlot(PROVIDER, getCricketDailyRequestLimit(), now)) {
          logger.warn({ provider: PROVIDER }, 'CricketData daily request budget exhausted; skipping this cycle')
          return null
        }

        return withinWindow(normalizeCricketFixtures(await loadMatches()), windowStart, windowEnd)
      },
      FIXTURE_CACHE_TTL_SECONDS,
    )

    if (!fixtures) return { fixtures: [], skipped: true, reason: 'daily-budget-exhausted' }
    return { fixtures, skipped: false }
  } catch (error) {
    logger.warn({ provider: PROVIDER, providerStatus: getCricketProviderStatus(error) }, 'CricketData fixture request failed')
    throw error
  }
}
