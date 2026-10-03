import assert from 'node:assert/strict'
import axios, { type AxiosRequestConfig, type AxiosResponse } from 'axios'
import { before, test } from 'node:test'

type MatchesService = typeof import('./footballDataMatches.service.js')

let getCompetitionFixtures: MatchesService['getCompetitionFixtures']
let getCompetitionCodesForCycle: MatchesService['getCompetitionCodesForCycle']
let getConfiguredCompetitionCodes: MatchesService['getConfiguredCompetitionCodes']
let getConfiguredCompetitionFixtures: MatchesService['getConfiguredCompetitionFixtures']
let defaultCompetitionCodes: MatchesService['DEFAULT_FOOTBALL_DISCOVERY_COMPETITIONS']
let acquireFootballDataRequestSlot: typeof import('./footballDataRequestLimiter.js')['acquireFootballDataRequestSlot']

before(async () => {
  process.env.REDIS_URL_PRIMARY = ''
  process.env.REDIS_URL = ''
  process.env.REDIS_URL_BACKUP_1 = ''
  process.env.REDIS_URL_BACKUP_2 = ''
  process.env.REDIS_URL_BACKUP_3 = ''

  const matchesModule = await import('./footballDataMatches.service.js')
  const limiterModule = await import('./footballDataRequestLimiter.js')
  getCompetitionFixtures = matchesModule.getCompetitionFixtures
  getCompetitionCodesForCycle = matchesModule.getCompetitionCodesForCycle
  getConfiguredCompetitionCodes = matchesModule.getConfiguredCompetitionCodes
  getConfiguredCompetitionFixtures = matchesModule.getConfiguredCompetitionFixtures
  defaultCompetitionCodes = matchesModule.DEFAULT_FOOTBALL_DISCOVERY_COMPETITIONS
  acquireFootballDataRequestSlot = limiterModule.acquireFootballDataRequestSlot
})

test('uses the verified 12-competition catalog while retaining environment overrides', () => {
  const previousList = process.env.FOOTBALL_DISCOVERY_COMPETITIONS
  const previousSingle = process.env.FOOTBALL_DISCOVERY_COMPETITION
  delete process.env.FOOTBALL_DISCOVERY_COMPETITIONS
  delete process.env.FOOTBALL_DISCOVERY_COMPETITION

  try {
    assert.equal(defaultCompetitionCodes.length, 12)
    assert.deepEqual(getConfiguredCompetitionCodes(), [...defaultCompetitionCodes])

    process.env.FOOTBALL_DISCOVERY_COMPETITIONS = 'pl,PD,pl,WC'
    assert.deepEqual(getConfiguredCompetitionCodes(), ['PL', 'PD', 'WC'])
  } finally {
    if (previousList === undefined) delete process.env.FOOTBALL_DISCOVERY_COMPETITIONS
    else process.env.FOOTBALL_DISCOVERY_COMPETITIONS = previousList
    if (previousSingle === undefined) delete process.env.FOOTBALL_DISCOVERY_COMPETITION
    else process.env.FOOTBALL_DISCOVERY_COMPETITION = previousSingle
  }
})

test('rotates fixture requests across all configured competitions with at most six per minute', () => {
  const firstCycle = getCompetitionCodesForCycle(defaultCompetitionCodes, 0)
  const secondCycle = getCompetitionCodesForCycle(defaultCompetitionCodes, 60_000)
  const nextWindowFirstCycle = getCompetitionCodesForCycle(defaultCompetitionCodes, 120_000)

  assert.equal(firstCycle.length, 6)
  assert.equal(secondCycle.length, 6)
  assert.deepEqual([...firstCycle, ...secondCycle], [...defaultCompetitionCodes])
  assert.deepEqual(nextWindowFirstCycle, firstCycle)
})

test('isolates one competition fixture failure from the other configured competitions', async () => {
  const previousList = process.env.FOOTBALL_DISCOVERY_COMPETITIONS
  process.env.FOOTBALL_DISCOVERY_COMPETITIONS = 'PL,PD,SA'
  const requested: string[] = []
  const fixture = (competitionCode: string) => ({
    id: competitionCode,
    kickoffAt: '2026-10-04T18:00:00Z',
    status: 'TIMED',
    competitionCode,
    competitionName: competitionCode,
    homeTeamName: 'Home Team',
    awayTeamName: 'Away Team',
  })

  try {
    const fixtures = await getConfiguredCompetitionFixtures('2026-10-03', '2026-10-05', async (code) => {
      requested.push(code)
      if (code === 'PD') throw new Error('competition unavailable')
      return [fixture(code)]
    }, 0)

    assert.deepEqual(requested, ['PL', 'PD', 'SA'])
    assert.deepEqual(fixtures.map(({ competitionCode }) => competitionCode), ['PL', 'SA'])
  } finally {
    if (previousList === undefined) delete process.env.FOOTBALL_DISCOVERY_COMPETITIONS
    else process.env.FOOTBALL_DISCOVERY_COMPETITIONS = previousList
  }
})

test('normalizes real provider match response fields and preserves the requested date window', async (context) => {
  const previousApiKey = process.env.FOOTBALL_API_KEY
  process.env.FOOTBALL_API_KEY = 'test-api-key'
  let requestUrl = ''
  let requestConfig: AxiosRequestConfig | undefined
  const providerResponse = {
    matches: [{
      id: 12345,
      utcDate: '2026-10-04T18:00:00Z',
      status: 'TIMED',
      competition: { name: 'Premier League' },
      homeTeam: { name: 'Home Team', crest: 'https://example.test/home.png' },
      awayTeam: { name: 'Away Team', crest: null },
    }],
  }

  context.mock.method(axios, 'get', (async (url: string, config?: AxiosRequestConfig) => {
    requestUrl = url
    requestConfig = config
    return { data: providerResponse } as AxiosResponse<unknown>
  }) as typeof axios.get)

  try {
    const fixtures = await getCompetitionFixtures('PL', '2026-10-03', '2026-10-05')
    assert.equal(requestUrl, 'https://api.football-data.org/v4/competitions/PL/matches')
    assert.deepEqual(requestConfig?.params, { dateFrom: '2026-10-03', dateTo: '2026-10-05' })
    assert.equal(fixtures[0].id, '12345')
    assert.equal(fixtures[0].status, 'TIMED')
    assert.equal(fixtures[0].competitionName, 'Premier League')
    assert.equal(fixtures[0].homeTeamCrest, 'https://example.test/home.png')
    assert.equal(fixtures[0].awayTeamCrest, null)
  } finally {
    if (previousApiKey === undefined) delete process.env.FOOTBALL_API_KEY
    else process.env.FOOTBALL_API_KEY = previousApiKey
  }
})

test('reserves no more than six fixture and nine total provider requests per minute', async () => {
  const windowStart = Math.ceil(Date.now() / 60_000) * 60_000

  for (let index = 0; index < 6; index += 1) {
    assert.equal(await acquireFootballDataRequestSlot('fixture', windowStart), true)
  }
  assert.equal(await acquireFootballDataRequestSlot('fixture', windowStart), false)

  for (let index = 0; index < 3; index += 1) {
    assert.equal(await acquireFootballDataRequestSlot('standings', windowStart), true)
  }
  assert.equal(await acquireFootballDataRequestSlot('standings', windowStart), false)
})