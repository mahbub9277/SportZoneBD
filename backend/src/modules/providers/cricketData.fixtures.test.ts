import assert from 'node:assert/strict'
import { before, test } from 'node:test'

type CricketModule = typeof import('./cricketData.fixtures.js')

let getCricketFixtures: CricketModule['getCricketFixtures']
let normalizeCricketFixtures: CricketModule['normalizeCricketFixtures']
let normalizeCricketStatus: CricketModule['normalizeCricketStatus']
let normalizeCricketMatch: CricketModule['normalizeCricketMatch']
let parseCricketUtc: CricketModule['parseCricketUtc']

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
  assert.equal(fixture.homeTeamCrest, 'https://media.example/india.png')
  assert.equal(fixture.awayTeamCrest, null)
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
