import assert from 'node:assert/strict'
import { before, test } from 'node:test'

type CricketModule = typeof import('./cricketData.fixtures.js')

let getCricketFixtures: CricketModule['getCricketFixtures']
let normalizeCricketFixtures: CricketModule['normalizeCricketFixtures']
let normalizeCricketStatus: CricketModule['normalizeCricketStatus']
let normalizeCricketMatch: CricketModule['normalizeCricketMatch']
let parseCricketUtc: CricketModule['parseCricketUtc']
let readCricketSeries: CricketModule['readCricketSeries']

before(async () => {
  process.env.REDIS_URL_PRIMARY = ''
  process.env.REDIS_URL = ''
  process.env.REDIS_URL_BACKUP_1 = ''
  process.env.REDIS_URL_BACKUP_2 = ''
  process.env.REDIS_URL_BACKUP_3 = ''

  const module = await import('./cricketData.fixtures.js')
  getCricketFixtures = module.getCricketFixtures
  normalizeCricketFixtures = module.normalizeCricketFixtures
  normalizeCricketStatus = module.normalizeCricketStatus
  normalizeCricketMatch = module.normalizeCricketMatch
  parseCricketUtc = module.parseCricketUtc
  readCricketSeries = module.readCricketSeries
})

function match(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cric-1',
    name: 'India vs Australia',
    matchType: 't20',
    status: 'Match not started',
    venue: 'Eden Gardens',
    date: '2026-10-06',
    dateTimeGMT: '2026-10-06T13:30:00',
    teams: ['India', 'Australia'],
    teamInfo: [
      { name: 'India', shortname: 'IND', img: 'https://media.example/india.png' },
      { name: 'Australia', shortname: 'AUS', img: null },
    ],
    series_id: 'series-99',
    series: 'Australia tour of India',
    matchStarted: false,
    matchEnded: false,
    ...overrides,
  }
}

test('pins designator-less provider timestamps to UTC instead of local time', () => {
  assert.equal(parseCricketUtc('2026-10-06T13:30:00', 'kickoff'), '2026-10-06T13:30:00.000Z')
  assert.equal(parseCricketUtc('2026-10-06T13:30:00Z', 'kickoff'), '2026-10-06T13:30:00.000Z')
  assert.equal(parseCricketUtc('2026-10-06T19:00:00+05:30', 'kickoff'), '2026-10-06T13:30:00.000Z')
  assert.throws(() => parseCricketUtc('not-a-date', 'kickoff'), /Invalid provider kickoff/)
})

test('derives status from the provider start/end flags and skips abandoned fixtures', () => {
  assert.equal(normalizeCricketStatus(match({ matchStarted: false, matchEnded: false })), 'UPCOMING')
  assert.equal(normalizeCricketStatus(match({ matchStarted: true, matchEnded: false })), 'LIVE')
  assert.equal(normalizeCricketStatus(match({ matchStarted: true, matchEnded: true })), 'FINISHED')
  assert.equal(normalizeCricketStatus(match({ status: 'Match abandoned' })), null)
  assert.equal(normalizeCricketStatus(match({ status: 'Match postponed' })), null)
  assert.equal(normalizeCricketStatus(match({ status: 'No result' })), null)
})

test('normalizes a cricket match into the canonical shape with the CRICKET sport', () => {
  const fixture = normalizeCricketMatch(match())

  assert.ok(fixture)
  assert.equal(fixture.provider, 'CRICKET_DATA')
  assert.equal(fixture.sport, 'CRICKET')
  assert.equal(fixture.providerMatchId, 'cric-1')
  assert.equal(fixture.status, 'UPCOMING')
  assert.equal(fixture.kickoffAt, '2026-10-06T13:30:00.000Z')
  assert.equal(fixture.competitionCode, 'series-99')
  assert.equal(fixture.competitionName, 'Australia tour of India')
  assert.equal(fixture.homeTeamName, 'India')
  assert.equal(fixture.awayTeamName, 'Australia')
  assert.equal(fixture.homeTeamCrest, null)
  assert.equal(fixture.awayTeamCrest, null)
})

/**
 * Regression guard: CricketData serves team images from its own CDN and does not license hotlinking, so a
 * provider image must never be copied into a match logo field. The logo comes from SportZoneBD's own
 * admin-managed assets, and a fixture without one keeps the initials fallback.
 */
test('never copies a provider-hosted team image into a match logo field', () => {
  const fixture = normalizeCricketMatch(match({
    teamInfo: [
      { id: 'ind-1', name: 'India', shortname: 'IND', img: 'https://g.cricapi.com/player/india.png' },
      { id: 'aus-1', name: 'Australia', shortname: 'AUS', img: 'https://g.cricapi.com/player/australia.png' },
    ],
  }))

  assert.ok(fixture)
  assert.equal(fixture.homeTeamCrest, null)
  assert.equal(fixture.awayTeamCrest, null)
  // The provider's identity for each team is still kept, so an admin-managed logo can be matched later.
  assert.equal(fixture.homeTeamProviderId, 'ind-1')
  assert.equal(fixture.awayTeamProviderId, 'aus-1')
})

test('falls back to the plain team list when the provider omits teamInfo', () => {
  const fixture = normalizeCricketMatch(match({ teamInfo: undefined }))

  assert.ok(fixture)
  assert.equal(fixture.homeTeamName, 'India')
  assert.equal(fixture.awayTeamName, 'Australia')
  assert.equal(fixture.homeTeamCrest, null)
})

test('never invents a fixture from incomplete provider data', () => {
  assert.equal(normalizeCricketMatch(match({ teams: [], teamInfo: [] })), null)
  assert.equal(normalizeCricketMatch(match({ status: 'Match abandoned' })), null)
  assert.equal(normalizeCricketMatch(match({ matchStarted: undefined, matchEnded: undefined })), null)
})

test('normalizes the payload and de-duplicates repeated provider ids', () => {
  const fixtures = normalizeCricketFixtures({ data: [match(), match(), match({ id: 'cric-2' })] })

  assert.deepEqual(fixtures.map((fixture) => fixture.providerMatchId), ['cric-1', 'cric-2'])
  assert.throws(() => normalizeCricketFixtures({}), /Invalid provider/)
})

/**
 * Regression guard for the coverage gap seen in production: `/currentMatches` publishes `series_id` but no
 * `series`, so the competition has to come from the fixture name the provider itself supplies.
 */
test('reads the competition from the provider name when the payload omits the series field', () => {
  assert.equal(readCricketSeries({ series: '  Australia tour of India  ' }), 'Australia tour of India')
  assert.equal(
    readCricketSeries({ name: 'Western Australia vs Queensland, 3rd Match, Sheffield Shield 2026-27' }),
    'Sheffield Shield 2026-27',
  )
  // Nothing to read: no series field, no name, or a name whose trailing segment is only a number.
  assert.equal(readCricketSeries({}), null)
  assert.equal(readCricketSeries({ name: 'India vs Australia' }), null)
  assert.equal(readCricketSeries({ name: 'India vs Australia, 3rd Match, 2026' }), null)
})

test('keeps the real competition and the provider series id for a currentMatches-shaped payload', () => {
  const fixture = normalizeCricketMatch(match({
    name: 'Western Australia vs Queensland, 3rd Match, Sheffield Shield 2026-27',
    series: undefined,
  }))

  assert.ok(fixture)
  assert.equal(fixture.competitionName, 'Sheffield Shield 2026-27')
  assert.equal(fixture.competitionCode, 'series-99')
  assert.equal(fixture.homeTeamName, 'India')
  assert.equal(fixture.awayTeamName, 'Australia')
})

/**
 * Regression guard: a marquee short-format fixture whose series had to be read from the name used to be
 * classified D and dropped from discovery, even though the provider's own name identified the tournament.
 */
test('keeps a marquee short-format fixture that carries no series field', () => {
  const fixtures = normalizeCricketFixtures({
    data: [match({
      id: 'hundred-1',
      matchType: 'hundred',
      series: undefined,
      name: 'Oval Invincibles vs London Spirit, 12th Match, The Hundred 2026',
    })],
  })

  assert.deepEqual(fixtures.map((fixture) => fixture.providerMatchId), ['hundred-1'])
  assert.equal(fixtures[0].competitionName, 'The Hundred 2026')
})

test('still refuses a non-marquee short format and an unclassified fixture', () => {
  const fixtures = normalizeCricketFixtures({
    data: [
      match({ id: 't10-1', matchType: 't10', series: undefined, name: 'Deccan Gladiators vs Bangla Tigers, 5th Match, Abu Dhabi T10 2026' }),
      match({ id: 'unknown-1', matchType: undefined, series: undefined, name: 'A vs B, 1st Match, Some League' }),
    ],
  })

  assert.deepEqual(fixtures, [])
})

/**
 * Regression guard for the missing international fixtures: Test, ODI and T20I fixtures are eligible on
 * their format alone, so they must survive normalization whether or not the payload carries a series.
 */
test('keeps international Test, ODI and T20I fixtures that arrive without a series field', () => {
  const fixtures = normalizeCricketFixtures({
    data: [
      match({ id: 'test-1', matchType: 'test', series: undefined, name: 'India vs Australia, 1st Test, Australia tour of India 2026' }),
      match({ id: 'odi-1', matchType: 'odi', series: undefined, name: 'India vs Australia, 2nd ODI, Australia tour of India 2026' }),
      match({ id: 't20i-1', matchType: 't20', series: undefined, name: 'India vs Australia, 3rd T20I, Australia tour of India 2026' }),
    ],
  })

  assert.deepEqual(fixtures.map((fixture) => fixture.providerMatchId), ['test-1', 'odi-1', 't20i-1'])
  assert.deepEqual(fixtures.map((fixture) => fixture.competitionName), [
    'Australia tour of India 2026',
    'Australia tour of India 2026',
    'Australia tour of India 2026',
  ])
})

test('an international fixture inside the window survives discovery and an expired one does not', async () => {
  const previousKey = process.env.CRICKET_API_KEY
  process.env.CRICKET_API_KEY = 'test-key'

  try {
    const result = await getCricketFixtures('2026-11-01', '2026-11-03', Date.now(), async () => ({
      data: [
        match({
          id: 't20i-future',
          matchType: 't20',
          series: undefined,
          name: 'India vs Australia, 3rd T20I, Australia tour of India 2026',
          dateTimeGMT: '2026-11-02T13:30:00',
        }),
        match({
          id: 't20i-expired',
          matchType: 't20',
          series: undefined,
          name: 'India vs Australia, 2nd T20I, Australia tour of India 2026',
          dateTimeGMT: '2026-10-30T13:30:00',
        }),
      ],
    }))

    assert.equal(result.skipped, false)
    assert.deepEqual(result.fixtures.map((fixture) => fixture.providerMatchId), ['t20i-future'])
  } finally {
    if (previousKey === undefined) delete process.env.CRICKET_API_KEY
    else process.env.CRICKET_API_KEY = previousKey
  }
})

test('keeps only fixtures inside the requested creation window', async () => {
  const previousKey = process.env.CRICKET_API_KEY
  process.env.CRICKET_API_KEY = 'test-key'

  try {
    const result = await getCricketFixtures('2026-10-05', '2026-10-07', Date.now(), async () => ({
      data: [
        match({ id: 'inside', dateTimeGMT: '2026-10-06T13:30:00' }),
        match({ id: 'too-early', dateTimeGMT: '2026-10-20T13:30:00' }),
        match({ id: 'too-late', dateTimeGMT: '2026-09-20T13:30:00' }),
      ],
    }))

    assert.equal(result.skipped, false)
    assert.deepEqual(result.fixtures.map((fixture) => fixture.providerMatchId), ['inside'])
  } finally {
    if (previousKey === undefined) delete process.env.CRICKET_API_KEY
    else process.env.CRICKET_API_KEY = previousKey
  }
})

test('is skipped, without calling the provider, when no API key is configured', async () => {
  const previousKey = process.env.CRICKET_API_KEY
  delete process.env.CRICKET_API_KEY

  try {
    let loaderCalls = 0
    const result = await getCricketFixtures('2026-10-05', '2026-10-07', Date.now(), async () => {
      loaderCalls += 1
      return { data: [] }
    })

    assert.deepEqual(result, { fixtures: [], skipped: true, reason: 'not-configured' })
    assert.equal(loaderCalls, 0)
  } finally {
    if (previousKey === undefined) delete process.env.CRICKET_API_KEY
    else process.env.CRICKET_API_KEY = previousKey
  }
})

test('propagates a genuine provider failure so the run is reported accurately', async () => {
  const previousKey = process.env.CRICKET_API_KEY
  process.env.CRICKET_API_KEY = 'test-key'

  try {
    await assert.rejects(
      getCricketFixtures('2026-10-08', '2026-10-10', Date.now(), async () => { throw new Error('upstream 503') }),
      /upstream 503/,
    )
  } finally {
    if (previousKey === undefined) delete process.env.CRICKET_API_KEY
    else process.env.CRICKET_API_KEY = previousKey
  }
})

/**
 * Regression guard for the provider budget/cache ordering: a budget slot must stand for a real
 * upstream request, so it is reserved per provider request and never when the cache serves the run.
 */
test('reserves one provider slot per real provider request and blocks the provider once the budget is spent', async () => {
  const previousKey = process.env.CRICKET_API_KEY
  const previousLimit = process.env.CRICKET_DAILY_REQUEST_LIMIT
  process.env.CRICKET_API_KEY = 'test-key'
  process.env.CRICKET_DAILY_REQUEST_LIMIT = '2'

  try {
    // A dedicated budget day keeps this test independent of the other tests' counter.
    const now = Date.UTC(2031, 0, 2, 12)
    let loaderCalls = 0
    const loader = async () => {
      loaderCalls += 1
      return { data: [match()] }
    }

    const first = await getCricketFixtures('2026-10-05', '2026-10-07', now, loader)
    const second = await getCricketFixtures('2026-10-05', '2026-10-07', now, loader)

    assert.equal(first.skipped, false)
    assert.equal(second.skipped, false)
    assert.equal(loaderCalls, 2, 'each real provider request reserves exactly one slot')

    const blocked = await getCricketFixtures('2026-10-05', '2026-10-07', now, loader)

    assert.deepEqual(blocked, { fixtures: [], skipped: true, reason: 'daily-budget-exhausted' })
    assert.equal(loaderCalls, 2, 'an exhausted budget must never reach the provider')

    // The rejected reservation is not stored, so the provider stays blocked instead of serving data.
    const stillBlocked = await getCricketFixtures('2026-10-05', '2026-10-07', now, loader)
    assert.deepEqual(stillBlocked, { fixtures: [], skipped: true, reason: 'daily-budget-exhausted' })
    assert.equal(loaderCalls, 2)
  } finally {
    if (previousKey === undefined) delete process.env.CRICKET_API_KEY
    else process.env.CRICKET_API_KEY = previousKey
    if (previousLimit === undefined) delete process.env.CRICKET_DAILY_REQUEST_LIMIT
    else process.env.CRICKET_DAILY_REQUEST_LIMIT = previousLimit
  }
})

test('serves a cached fixture payload without calling the provider or its budget', async () => {
  const previousKey = process.env.CRICKET_API_KEY
  const previousLimit = process.env.CRICKET_DAILY_REQUEST_LIMIT
  process.env.CRICKET_API_KEY = 'test-key'
  process.env.CRICKET_DAILY_REQUEST_LIMIT = '1'

  const cachedFixture = normalizeCricketMatch(match())
  assert.ok(cachedFixture, 'the cached payload must be a real normalized fixture')

  const redisModule = await import('../../core/redis.js')
  const cacheClient = redisModule.cacheRedis as { get: (key: string) => Promise<string | null> }
  const originalGet = cacheClient.get

  try {
    const now = Date.UTC(2031, 1, 2, 12)
    let loaderCalls = 0
    const loader = async () => {
      loaderCalls += 1
      return { data: [match()] }
    }

    // Spend the only slot so the budget is exhausted for the rest of this test.
    const spending = await getCricketFixtures('2026-10-05', '2026-10-07', now, loader)
    assert.equal(spending.skipped, false)
    assert.equal(loaderCalls, 1)

    cacheClient.get = async (key: string) => (
      key.includes('cricket-data') ? JSON.stringify([cachedFixture]) : originalGet(key)
    )

    const hit = await getCricketFixtures('2026-10-05', '2026-10-07', now, loader)

    assert.equal(hit.skipped, false)
    assert.deepEqual(hit.fixtures.map((fixture) => fixture.providerMatchId), ['cric-1'])
    assert.equal(loaderCalls, 1, 'a cache hit must not reach the provider')
  } finally {
    cacheClient.get = originalGet
    if (previousKey === undefined) delete process.env.CRICKET_API_KEY
    else process.env.CRICKET_API_KEY = previousKey
    if (previousLimit === undefined) delete process.env.CRICKET_DAILY_REQUEST_LIMIT
    else process.env.CRICKET_DAILY_REQUEST_LIMIT = previousLimit
  }
})
