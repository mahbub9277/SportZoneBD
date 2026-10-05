import assert from 'node:assert/strict'
import { before, test } from 'node:test'

import { ApiFootballResponseError, getApiFootballErrorMessages, hasApiFootballErrors } from './apiFootball.client.js'

type ApiFootballModule = typeof import('./apiFootball.fixtures.js')

let getApiFootballFixtures: ApiFootballModule['getApiFootballFixtures']
let normalizeApiFootballFixtures: ApiFootballModule['normalizeApiFootballFixtures']
let dropFootballDataCoveredFixtures: ApiFootballModule['dropFootballDataCoveredFixtures']
let getApiFootballErrorBackoffSeconds: ApiFootballModule['getApiFootballErrorBackoffSeconds']
let getApiFootballErrorMarkerKey: ApiFootballModule['getApiFootballErrorMarkerKey']
let readApiFootballErrorMarker: ApiFootballModule['readApiFootballErrorMarker']
let clearApiFootballErrorMarker: ApiFootballModule['clearApiFootballErrorMarker']

before(async () => {
  process.env.REDIS_URL_PRIMARY = ''
  process.env.REDIS_URL = ''
  process.env.REDIS_URL_BACKUP_1 = ''
  process.env.REDIS_URL_BACKUP_2 = ''
  process.env.REDIS_URL_BACKUP_3 = ''

  const module = await import('./apiFootball.fixtures.js')
  getApiFootballFixtures = module.getApiFootballFixtures
  normalizeApiFootballFixtures = module.normalizeApiFootballFixtures
  dropFootballDataCoveredFixtures = module.dropFootballDataCoveredFixtures
  getApiFootballErrorBackoffSeconds = module.getApiFootballErrorBackoffSeconds
  getApiFootballErrorMarkerKey = module.getApiFootballErrorMarkerKey
  readApiFootballErrorMarker = module.readApiFootballErrorMarker
  clearApiFootballErrorMarker = module.clearApiFootballErrorMarker
})

const ENV = { API_FOOTBALL_KEY: 'test-key' } as NodeJS.ProcessEnv
const WINDOW_FROM = '2026-10-04'
const WINDOW_TO = '2026-10-07'
const NOW = Date.parse('2026-10-04T00:00:00.000Z')
/** The exact production refusal: HTTP 200, an empty response, and the reason inside `errors`. */
const PLAN_ERROR_PAYLOAD = {
  response: [],
  errors: { plan: 'Free plans do not have access to this season, try from 2022 to 2024.' },
}
const PLAN_ERROR_MESSAGE = 'Free plans do not have access to this season, try from 2022 to 2024.'
/** The same refusal as the adapter records and logs it: field-qualified, so the cause stays readable. */
const PLAN_ERROR_ISSUE = `plan: ${PLAN_ERROR_MESSAGE}`
/** Default-mapping competitions with the season each resolves to at NOW. */
const DEFAULT_LEAGUE_SEASONS = [
  [15, 2025],
  [5, 2026],
  [253, 2026],
  [307, 2026],
  [10, 2026],
] as const

/**
 * The backoff marker is keyed by competition and season, so backoff tests must not inherit one from
 * an earlier test in the same process.
 */
async function resetApiFootballBackoff(): Promise<void> {
  for (const [leagueId, season] of DEFAULT_LEAGUE_SEASONS) {
    await clearApiFootballErrorMarker(leagueId, season)
  }
}

function entry(overrides: {
  id?: number
  date?: string
  short?: string
  leagueId?: number
  leagueName?: string
  home?: { id: number; name: string; logo?: string | null }
  away?: { id: number; name: string; logo?: string | null }
}) {
  return {
    fixture: {
      id: overrides.id ?? 1001,
      date: overrides.date ?? '2026-10-06T18:00:00+00:00',
      status: { long: 'Not Started', short: overrides.short ?? 'NS', elapsed: null },
    },
    league: {
      id: overrides.leagueId ?? 253,
      name: overrides.leagueName ?? 'Major League Soccer',
      country: 'USA',
      season: 2026,
    },
    teams: {
      home: { id: overrides.home?.id ?? 1607, name: overrides.home?.name ?? 'Inter Miami', logo: overrides.home?.logo ?? 'https://media.example/miami.png' },
      away: { id: overrides.away?.id ?? 1608, name: overrides.away?.name ?? 'New York City FC', logo: overrides.away?.logo ?? null },
    },
  }
}

test('normalizes API-Football fixtures into the canonical shape', () => {
  const fixtures = normalizeApiFootballFixtures({ response: [entry({})] })

  assert.equal(fixtures.length, 1)
  const [fixture] = fixtures
  assert.equal(fixture.provider, 'API_FOOTBALL')
  assert.equal(fixture.sport, 'FOOTBALL')
  assert.equal(fixture.providerMatchId, '1001')
  assert.equal(fixture.status, 'UPCOMING')
  assert.equal(fixture.kickoffAt, '2026-10-06T18:00:00.000Z')
  assert.equal(fixture.competitionCode, '253')
  assert.equal(fixture.competitionName, 'Major League Soccer')
  assert.equal(fixture.homeTeamName, 'Inter Miami')
  assert.equal(fixture.awayTeamName, 'New York City FC')
  assert.equal(fixture.homeTeamProviderId, '1607')
  assert.equal(fixture.awayTeamProviderId, '1608')
  assert.equal(fixture.homeTeamCrest, 'https://media.example/miami.png')
  assert.equal(fixture.awayTeamCrest, null)
})

test('maps live and finished status codes and skips statuses with no SportZoneBD equivalent', () => {
  const fixtures = normalizeApiFootballFixtures({
    response: [
      entry({ id: 1, short: 'NS' }),
      entry({ id: 2, short: '1H' }),
      entry({ id: 3, short: 'HT' }),
      entry({ id: 4, short: 'FT' }),
      entry({ id: 5, short: 'AET' }),
      entry({ id: 6, short: 'PST' }),
      entry({ id: 7, short: 'CANC' }),
      entry({ id: 8, short: 'ABD' }),
      entry({ id: 9, short: 'SUSP' }),
    ],
  })

  assert.deepEqual(fixtures.map((fixture) => [fixture.providerMatchId, fixture.status]), [
    ['1', 'UPCOMING'],
    ['2', 'LIVE'],
    ['3', 'LIVE'],
    ['4', 'FINISHED'],
    ['5', 'FINISHED'],
  ])
})

test('rejects a malformed provider payload instead of inventing fixtures', () => {
  assert.throws(() => normalizeApiFootballFixtures({}), /Invalid provider/)
  assert.throws(() => normalizeApiFootballFixtures({ response: [{ fixture: { id: 1 } }] }), /Invalid provider/)
  assert.throws(
    () => normalizeApiFootballFixtures({ response: [entry({ date: 'not-a-date' })] }),
    /Invalid provider/,
  )
})

test('requests each configured competition separately, with its own league and season', async () => {
  const calls: Array<[number, number, string, string]> = []

  const result = await getApiFootballFixtures(WINDOW_FROM, WINDOW_TO, NOW, async (leagueId, season, from, to) => {
    calls.push([leagueId, season, from, to])
    return { response: [entry({ leagueId })] }
  }, ENV)

  assert.deepEqual(calls, [
    [15, 2025, WINDOW_FROM, WINDOW_TO],
    [5, 2026, WINDOW_FROM, WINDOW_TO],
    [253, 2026, WINDOW_FROM, WINDOW_TO],
    [307, 2026, WINDOW_FROM, WINDOW_TO],
    [10, 2026, WINDOW_FROM, WINDOW_TO],
  ])
  assert.equal(result.skipped, false)
  assert.equal(result.fixtures.length, 5)
  assert.deepEqual(result.failedSources, [])
  assert.deepEqual(result.attemptedSources, ['API-Football:15', 'API-Football:5', 'API-Football:253', 'API-Football:307', 'API-Football:10'])
})

test('Test A: Premier League is never requested from API-Football', async () => {
  const requestedLeagues: number[] = []

  await getApiFootballFixtures(WINDOW_FROM, WINDOW_TO, NOW, async (leagueId) => {
    requestedLeagues.push(leagueId)
    return { response: [] }
  }, ENV)

  assert.ok(requestedLeagues.length > 0, 'the configured additional competitions must still be polled')
  assert.ok(!requestedLeagues.includes(39), 'Premier League must stay owned by football-data.org')
  assert.ok(!requestedLeagues.some((id) => [140, 2, 135, 78, 88, 71, 61, 40, 94].includes(id)))
})

test('an explicitly configured Premier League id is ignored rather than polled', async () => {
  const requestedLeagues: number[] = []

  const result = await getApiFootballFixtures('2026-10-11', '2026-10-14', NOW, async (leagueId) => {
    requestedLeagues.push(leagueId)
    return { response: [entry({ leagueId })] }
  }, { ...ENV, API_FOOTBALL_LEAGUES: '39,140,253' })

  assert.deepEqual(requestedLeagues, [253])
  assert.equal(result.fixtures.length, 1)
})

test('a configuration that only names football-data competitions polls nothing at all', async () => {
  let loaderCalls = 0

  const result = await getApiFootballFixtures(WINDOW_FROM, WINDOW_TO, NOW, async () => {
    loaderCalls += 1
    return { response: [] }
  }, { ...ENV, API_FOOTBALL_LEAGUES: '39,140' })

  assert.deepEqual(result, { fixtures: [], skipped: true, reason: 'no-leagues-configured' })
  assert.equal(loaderCalls, 0)
})

test('Test B: an additional API-Football-only competition is discovered and normalized', async () => {
  const result = await getApiFootballFixtures('2026-10-18', '2026-10-21', NOW, async (leagueId) => {
    if (leagueId !== 15) return { response: [] }
    return {
      response: [entry({
        id: 99001,
        leagueId: 15,
        leagueName: 'FIFA Club World Cup',
        date: '2026-10-19T19:00:00+00:00',
        home: { id: 50, name: 'Manchester City', logo: null },
        away: { id: 121, name: 'Palmeiras', logo: null },
      })],
    }
  }, ENV)

  const clubWorldCup = result.fixtures.filter((fixture) => fixture.competitionCode === '15')
  assert.equal(clubWorldCup.length, 1)
  assert.equal(clubWorldCup[0].provider, 'API_FOOTBALL')
  assert.equal(clubWorldCup[0].providerMatchId, '99001')
  assert.equal(clubWorldCup[0].competitionName, 'FIFA Club World Cup')
  assert.equal(clubWorldCup[0].homeTeamName, 'Manchester City')
  assert.equal(clubWorldCup[0].status, 'UPCOMING')
})

test('drops a fixture that arrives for a football-data.org-owned competition anyway', () => {
  const kept = dropFootballDataCoveredFixtures(normalizeApiFootballFixtures({
    response: [
      entry({ id: 1, leagueId: 39, leagueName: 'Premier League' }),
      entry({ id: 2, leagueId: 253, leagueName: 'Major League Soccer' }),
    ],
  }))

  assert.deepEqual(kept.map((fixture) => fixture.providerMatchId), ['2'])
})

test('is skipped, without calling the provider, when no API key is configured', async () => {
  let loaderCalls = 0
  const result = await getApiFootballFixtures(WINDOW_FROM, WINDOW_TO, NOW, async () => {
    loaderCalls += 1
    return { response: [] }
  }, {} as NodeJS.ProcessEnv)

  assert.deepEqual(result, { fixtures: [], skipped: true, reason: 'not-configured' })
  assert.equal(loaderCalls, 0)
})

test('isolates a failing competition so the other competitions still return fixtures', async () => {
  const result = await getApiFootballFixtures('2026-10-25', '2026-10-28', NOW, async (leagueId) => {
    if (leagueId === 15) throw new Error('upstream 500')
    if (leagueId === 253) return { response: [entry({ leagueId, date: '2026-10-26T18:00:00+00:00' })] }
    return { response: [] }
  }, ENV)

  assert.equal(result.skipped, false)
  assert.deepEqual(result.fixtures.map((fixture) => fixture.competitionCode), ['253'])
  assert.deepEqual(result.failedSources, ['API-Football:15'])
  assert.ok(result.attemptedSources?.includes('API-Football:15'))
})

test('stops polling a competition once the daily budget is spent, and reports it', async () => {
  const env = { ...ENV, API_FOOTBALL_DAILY_REQUEST_LIMIT: '1' } as NodeJS.ProcessEnv
  // A distinct budget day keeps this test independent of the shared in-process counter.
  const budgetNow = Date.parse('2026-11-20T00:00:00.000Z')
  let loaderCalls = 0
  const loader = async (leagueId: number) => {
    loaderCalls += 1
    return { response: [entry({ leagueId, date: '2026-11-21T18:00:00+00:00' })] }
  }

  const first = await getApiFootballFixtures('2026-11-20', '2026-11-23', budgetNow, loader, env)
  assert.equal(loaderCalls, 1, 'only the first competition may be requested inside the budget')
  assert.equal(first.skipped, false)
  assert.deepEqual(first.attemptedSources, ['API-Football:15'])
  assert.equal(first.fixtures.length, 1)

  // A different window means no cache hit, so every competition is now budget-blocked.
  const second = await getApiFootballFixtures('2026-11-20', '2026-11-22', budgetNow, loader, env)
  assert.deepEqual(second, { fixtures: [], skipped: true, reason: 'daily-budget-exhausted' })
  assert.equal(loaderCalls, 1, 'a budget-blocked competition must not reach the provider')
})

test('Test 1: a provider plan error is a failure, never an empty fixture list', async () => {
  await resetApiFootballBackoff()

  assert.throws(() => normalizeApiFootballFixtures(PLAN_ERROR_PAYLOAD), (error: unknown) => {
    assert.ok(error instanceof ApiFootballResponseError, 'the refusal must be thrown, not returned as []')
    assert.equal(error.kind, 'plan')
    assert.equal(error.message, `API-Football provider error: ${PLAN_ERROR_ISSUE}`)
    return true
  })

  let loaderCalls = 0
  const result = await getApiFootballFixtures('2026-12-01', '2026-12-04', NOW, async () => {
    loaderCalls += 1
    return PLAN_ERROR_PAYLOAD
  }, { ...ENV, API_FOOTBALL_LEAGUES: '253' })

  assert.equal(loaderCalls, 1)
  assert.equal(result.skipped, false)
  assert.deepEqual(result.fixtures, [])
  assert.deepEqual(result.attemptedSources, ['API-Football:253'])
  assert.deepEqual(result.failedSources, ['API-Football:253'])
})

test('Test 1b: every provider-reported error shape is detected, and an empty errors field is not', () => {
  assert.equal(hasApiFootballErrors({ response: [], errors: {} }), false)
  assert.equal(hasApiFootballErrors({ response: [], errors: [] }), false)
  assert.equal(hasApiFootballErrors({ response: [], errors: null }), false)
  assert.equal(hasApiFootballErrors({ response: [] }), false)
  assert.deepEqual(getApiFootballErrorMessages({ response: [], errors: { plan: PLAN_ERROR_MESSAGE } }), [
    PLAN_ERROR_ISSUE,
  ])
  assert.deepEqual(getApiFootballErrorMessages({ response: [], errors: { token: '  Invalid key  ' } }), [
    'token: Invalid key',
  ])
  assert.deepEqual(getApiFootballErrorMessages({ response: [], errors: ['Service unavailable'] }), ['Service unavailable'])
  assert.deepEqual(getApiFootballErrorMessages({ response: [], errors: { params: { season: 'required' } } }), [
    'params.season: required',
  ])

  // A non-entitlement provider error is still a failure, so it can never be mistaken for `[]`.
  assert.throws(() => normalizeApiFootballFixtures({ response: [], errors: { token: 'Invalid key' } }), (error: unknown) => {
    assert.ok(error instanceof ApiFootballResponseError)
    assert.equal(error.kind, 'provider')
    return true
  })
})

test('Test 2: a legitimately empty competition is a successful empty result, as before', async () => {
  assert.deepEqual(normalizeApiFootballFixtures({ response: [], errors: {} }), [])
  assert.deepEqual(normalizeApiFootballFixtures({ response: [], errors: [] }), [])
  assert.deepEqual(normalizeApiFootballFixtures({ response: [] }), [])

  let loaderCalls = 0
  const result = await getApiFootballFixtures('2026-12-05', '2026-12-08', NOW, async () => {
    loaderCalls += 1
    return { response: [], errors: {} }
  }, { ...ENV, API_FOOTBALL_LEAGUES: '999' })

  assert.equal(loaderCalls, 1)
  assert.equal(result.skipped, false)
  assert.deepEqual(result.fixtures, [])
  assert.deepEqual(result.failedSources, [])
  assert.deepEqual(result.attemptedSources, ['API-Football:999'])
  assert.equal(await readApiFootballErrorMarker(999, 2026, NOW), null, 'an empty competition must not be backed off')
})

test('Test 3: fixtures returned alongside an empty errors field still normalize', () => {
  const fixtures = normalizeApiFootballFixtures({ response: [entry({ id: 4241 })], errors: {} })

  assert.deepEqual(fixtures.map((fixture) => fixture.providerMatchId), ['4241'])
  assert.equal(hasApiFootballErrors({ response: [entry({})], errors: {} }), false)
})

test('Test 4: a plan error never lands in the fixture cache as an empty list', async () => {
  const league = 307
  const env = { ...ENV, API_FOOTBALL_LEAGUES: String(league) }
  const dateFrom = '2026-12-09'
  const dateTo = '2026-12-12'
  await resetApiFootballBackoff()

  let loaderCalls = 0
  const loader = async () => {
    loaderCalls += 1
    if (loaderCalls === 1) return PLAN_ERROR_PAYLOAD
    return { response: [entry({ id: 4242, leagueId: league, date: '2026-12-10T18:00:00+00:00' })], errors: {} }
  }

  const refused = await getApiFootballFixtures(dateFrom, dateTo, NOW, loader, env)
  assert.deepEqual(refused.failedSources, ['API-Football:307'])
  assert.deepEqual(refused.fixtures, [])
  assert.equal(loaderCalls, 1)

  // The refusal is not cached under the fixture key: the backoff ends, the same window is asked
  // again and the real fixtures arrive. A cached `[]` would have kept them away for its whole TTL.
  const recovered = await getApiFootballFixtures(dateFrom, dateTo, NOW + getApiFootballErrorBackoffSeconds(env) * 1000 + 1000, loader, env)
  assert.equal(loaderCalls, 2)
  assert.deepEqual(recovered.failedSources, [])
  assert.deepEqual(recovered.fixtures.map((fixture) => fixture.providerMatchId), ['4242'])
})

test('Test 5: a competition in backoff is not requested again during the backoff period', async () => {
  const league = 10
  const env = { ...ENV, API_FOOTBALL_LEAGUES: String(league) }
  const dateFrom = '2026-12-13'
  const dateTo = '2026-12-16'
  await resetApiFootballBackoff()

  let loaderCalls = 0
  const loader = async () => {
    loaderCalls += 1
    return PLAN_ERROR_PAYLOAD
  }

  const refused = await getApiFootballFixtures(dateFrom, dateTo, NOW, loader, env)
  assert.deepEqual(refused.failedSources, ['API-Football:10'])
  assert.equal(loaderCalls, 1)

  // The one-minute scheduler keeps running; the refusal must not keep spending quota.
  const suppressed = await getApiFootballFixtures(dateFrom, dateTo, NOW + 60_000, loader, env)
  assert.deepEqual(suppressed, { fixtures: [], skipped: true, reason: 'provider-error-backoff' })
  assert.equal(loaderCalls, 1, 'the backoff must stop the provider request, not just hide the fixtures')

  const marker = await readApiFootballErrorMarker(league, 2026, NOW + 60_000)
  assert.equal(marker?.kind, 'plan')
  assert.equal(marker?.message, PLAN_ERROR_ISSUE)
  // Its own namespace, never the fixture cache key, so a refusal can never be read as `[]`.
  assert.equal(getApiFootballErrorMarkerKey(league, 2026), 'sportzone:provider:api-football:errors:10:2026')
  assert.equal(getApiFootballErrorBackoffSeconds({ API_FOOTBALL_ERROR_BACKOFF_SECONDS: '60' } as NodeJS.ProcessEnv), 60)
  assert.equal(getApiFootballErrorBackoffSeconds({} as NodeJS.ProcessEnv), 21_600)
})

test('Test 6: the backoff expires, the provider is retried, and the marker is cleared', async () => {
  const league = 5
  const env = { ...ENV, API_FOOTBALL_LEAGUES: String(league) }
  const dateFrom = '2026-12-17'
  const dateTo = '2026-12-20'
  const retryAt = NOW + getApiFootballErrorBackoffSeconds(env) * 1000 + 1000
  await resetApiFootballBackoff()

  let loaderCalls = 0
  const loader = async () => {
    loaderCalls += 1
    if (loaderCalls === 1) return PLAN_ERROR_PAYLOAD
    return { response: [entry({ id: 4243, leagueId: league, date: '2026-12-18T18:00:00+00:00' })], errors: {} }
  }

  await getApiFootballFixtures(dateFrom, dateTo, NOW, loader, env)
  await getApiFootballFixtures(dateFrom, dateTo, NOW + 60_000, loader, env)
  assert.equal(loaderCalls, 1)

  const recovered = await getApiFootballFixtures(dateFrom, dateTo, retryAt, loader, env)
  assert.equal(loaderCalls, 2, 'an expired backoff must let the provider be asked again')
  assert.equal(recovered.skipped, false)
  assert.deepEqual(recovered.failedSources, [])
  assert.deepEqual(recovered.fixtures.map((fixture) => fixture.providerMatchId), ['4243'])
  assert.equal(await readApiFootballErrorMarker(league, 2026, retryAt), null, 'a successful response clears the backoff')
})

test('Test 7: a refused API-Football competition is isolated, and the adapter never throws', async () => {
  await resetApiFootballBackoff()

  const result = await getApiFootballFixtures('2026-12-21', '2026-12-24', NOW, async () => PLAN_ERROR_PAYLOAD, ENV)

  assert.equal(result.skipped, false)
  assert.deepEqual(result.fixtures, [])
  assert.deepEqual(result.failedSources, [
    'API-Football:15',
    'API-Football:5',
    'API-Football:253',
    'API-Football:307',
    'API-Football:10',
  ])

  await resetApiFootballBackoff()
})

test('API-Football is not polled, and not reported as attempted, when disabled by configuration', async () => {
  let loaderCalls = 0
  const result = await getApiFootballFixtures(WINDOW_FROM, WINDOW_TO, NOW, async () => {
    loaderCalls += 1
    return { response: [] }
  }, { ...ENV, API_FOOTBALL_LEAGUES: 'disabled' })

  assert.deepEqual(result, { fixtures: [], skipped: true, reason: 'provider-disabled' })
  assert.equal(loaderCalls, 0, 'a disabled provider must cost zero requests')
})
