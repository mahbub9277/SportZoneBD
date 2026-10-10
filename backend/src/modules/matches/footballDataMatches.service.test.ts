import assert from 'node:assert/strict'
import axios, { type AxiosRequestConfig, type AxiosResponse } from 'axios'
import { before, test } from 'node:test'

type MatchesService = typeof import('./footballDataMatches.service.js')

let getCompetitionFixtures: MatchesService['getCompetitionFixtures']
let getCompetitionCodesForCycle: MatchesService['getCompetitionCodesForCycle']
let getConfiguredCompetitionCodes: MatchesService['getConfiguredCompetitionCodes']
let getConfiguredCompetitionFixtures: MatchesService['getConfiguredCompetitionFixtures']
let defaultCompetitionCodes: MatchesService['DEFAULT_FOOTBALL_DISCOVERY_COMPETITIONS']
let formatProviderSeason: MatchesService['formatProviderSeason']
let readProviderRound: MatchesService['readProviderRound']
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
  formatProviderSeason = matchesModule.formatProviderSeason
  readProviderRound = matchesModule.readProviderRound
  acquireFootballDataRequestSlot = limiterModule.acquireFootballDataRequestSlot
})

test('polls only competitions with current-season data while retaining environment overrides', () => {
  const previousList = process.env.FOOTBALL_DISCOVERY_COMPETITIONS
  const previousSingle = process.env.FOOTBALL_DISCOVERY_COMPETITION
  delete process.env.FOOTBALL_DISCOVERY_COMPETITIONS
  delete process.env.FOOTBALL_DISCOVERY_COMPETITION

  try {
    assert.deepEqual([...defaultCompetitionCodes], ['PL', 'PD', 'CL', 'SA', 'BL1', 'DED', 'BSA', 'FL1', 'ELC', 'PPL'])
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
  assert.equal(secondCycle.length, 4)
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
    season: null,
    round: null,
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

test('reports each failed competition to the caller so a partial run is not logged as success', async () => {
  const previousList = process.env.FOOTBALL_DISCOVERY_COMPETITIONS
  process.env.FOOTBALL_DISCOVERY_COMPETITIONS = 'PL,PD,SA'

  try {
    const failures: Array<{ code: string; message: string }> = []
    await getConfiguredCompetitionFixtures('2026-10-03', '2026-10-05', async (code) => {
      if (code !== 'PL') throw new Error(`${code} unavailable`)
      return []
    }, 0, (code, error) => {
      failures.push({ code, message: error instanceof Error ? error.message : 'unknown' })
    })

    assert.deepEqual(failures, [
      { code: 'PD', message: 'PD unavailable' },
      { code: 'SA', message: 'SA unavailable' },
    ])
  } finally {
    if (previousList === undefined) delete process.env.FOOTBALL_DISCOVERY_COMPETITIONS
    else process.env.FOOTBALL_DISCOVERY_COMPETITIONS = previousList
  }
})

test('treats an empty provider fixture list as success rather than a failure', async () => {
  const previousList = process.env.FOOTBALL_DISCOVERY_COMPETITIONS
  process.env.FOOTBALL_DISCOVERY_COMPETITIONS = 'PL,DED'

  try {
    const failures: string[] = []
    const fixtures = await getConfiguredCompetitionFixtures(
      '2026-10-03',
      '2026-10-05',
      async () => [],
      0,
      (code) => failures.push(code),
    )

    assert.deepEqual(fixtures, [])
    assert.deepEqual(failures, [])
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

test('stores the canonical competition name instead of the provider name for a known code', async (context) => {
  const previousApiKey = process.env.FOOTBALL_API_KEY
  process.env.FOOTBALL_API_KEY = 'test-api-key'
  // football-data.org names PD "Primera Division"; the application's canonical name for the same
  // competition is La Liga, and a stored match must never carry the provider's label.
  const providerResponse = {
    matches: [{
      id: 999,
      utcDate: '2026-10-04T18:00:00Z',
      status: 'TIMED',
      competition: { name: 'Primera Division' },
      homeTeam: { name: 'Real Madrid', crest: null },
      awayTeam: { name: 'Barcelona', crest: null },
    }],
  }

  context.mock.method(axios, 'get', (async () => ({ data: providerResponse }) as AxiosResponse<unknown>) as typeof axios.get)

  try {
    const fixtures = await getCompetitionFixtures('PD', '2026-10-03', '2026-10-05')
    assert.equal(fixtures[0].competitionCode, 'PD')
    assert.equal(fixtures[0].competitionName, 'La Liga')
  } finally {
    if (previousApiKey === undefined) delete process.env.FOOTBALL_API_KEY
    else process.env.FOOTBALL_API_KEY = previousApiKey
  }
})

test('keeps the provider name for a competition the application does not define', async (context) => {
  const previousApiKey = process.env.FOOTBALL_API_KEY
  process.env.FOOTBALL_API_KEY = 'test-api-key'
  const providerResponse = {
    matches: [{
      id: 1000,
      utcDate: '2026-10-04T18:00:00Z',
      status: 'TIMED',
      competition: { name: 'Liga Profesional Argentina' },
      homeTeam: { name: 'Boca Juniors', crest: null },
      awayTeam: { name: 'River Plate', crest: null },
    }],
  }

  context.mock.method(axios, 'get', (async () => ({ data: providerResponse }) as AxiosResponse<unknown>) as typeof axios.get)

  try {
    const fixtures = await getCompetitionFixtures('ARG', '2026-10-03', '2026-10-05')
    // No canonical name exists for ARG, so the real provider name is kept rather than invented.
    assert.equal(fixtures[0].competitionName, 'Liga Profesional Argentina')
  } finally {
    if (previousApiKey === undefined) delete process.env.FOOTBALL_API_KEY
    else process.env.FOOTBALL_API_KEY = previousApiKey
  }
})

test('reads the real season label from the provider season object', async (context) => {
  const previousApiKey = process.env.FOOTBALL_API_KEY
  process.env.FOOTBALL_API_KEY = 'test-api-key'
  const providerResponse = {
    matches: [
      {
        id: 2001,
        utcDate: '2026-10-04T18:00:00Z',
        status: 'TIMED',
        matchday: 7,
        competition: { name: 'Premier League' },
        season: { id: 2026, startDate: '2026-08-14', endDate: '2027-05-23', currentMatchday: 7 },
        homeTeam: { name: 'Liverpool FC', crest: null },
        awayTeam: { name: 'Manchester City FC', crest: null },
      },
      {
        id: 2002,
        utcDate: '2026-10-05T18:00:00Z',
        status: 'TIMED',
        competition: { name: 'Premier League' },
        season: { id: 2026, startDate: '2026-03-01', endDate: '2026-11-30', currentMatchday: 3 },
        homeTeam: { name: 'Boca Juniors', crest: null },
        awayTeam: { name: 'River Plate', crest: null },
      },
      {
        id: 2003,
        utcDate: '2026-10-06T18:00:00Z',
        status: 'TIMED',
        competition: { name: 'Premier League' },
        homeTeam: { name: 'No Season FC', crest: null },
        awayTeam: { name: 'Absent United', crest: null },
      },
    ],
  }

  context.mock.method(axios, 'get', (async () => ({ data: providerResponse }) as AxiosResponse<unknown>) as typeof axios.get)

  try {
    const fixtures = await getCompetitionFixtures('PL', '2026-10-03', '2026-10-07')
    assert.equal(fixtures[0].season, '2026/2027')
    assert.equal(fixtures[1].season, '2026')
    assert.equal(fixtures[2].season, null)
    // The matchday the provider publishes is the round; a fixture that carries none stays null.
    assert.equal(fixtures[0].round, 7)
    assert.equal(fixtures[1].round, null)
    assert.equal(fixtures[2].round, null)
  } finally {
    if (previousApiKey === undefined) delete process.env.FOOTBALL_API_KEY
    else process.env.FOOTBALL_API_KEY = previousApiKey
  }
})

test('the provider matchday is read as a round and anything else stays unset', () => {
  assert.equal(readProviderRound(7), 7)
  assert.equal(readProviderRound('8'), 8)
  // Cup ties and unusual payloads must not become a round number.
  assert.equal(readProviderRound(null), null)
  assert.equal(readProviderRound(undefined), null)
  assert.equal(readProviderRound(0), null)
  assert.equal(readProviderRound(-3), null)
  assert.equal(readProviderRound(2.5), null)
  assert.equal(readProviderRound('Round of 16'), null)
  assert.equal(readProviderRound(999), null)
})

test('season formatting uses the provider span or its season id and never invents one', () => {
  assert.equal(formatProviderSeason({ startDate: '2026-08-14', endDate: '2027-05-23' }), '2026/2027')
  assert.equal(formatProviderSeason({ startDate: '2026-03-01', endDate: '2026-11-30' }), '2026')
  assert.equal(formatProviderSeason({ id: 2026 }), '2026')
  assert.equal(formatProviderSeason({ id: '2025' }), '2025')
  assert.equal(formatProviderSeason({ startDate: '2026-08-14' }), '2026')
  assert.equal(formatProviderSeason({}), null)
  assert.equal(formatProviderSeason(null), null)
  assert.equal(formatProviderSeason('2026'), null)
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