import assert from 'node:assert/strict'
import axios, { type AxiosRequestConfig, type AxiosResponse } from 'axios'
import { randomUUID } from 'node:crypto'
import { before, test } from 'node:test'

type RedisCache = typeof import('../../core/redis.js').cacheRedis
type StandingsService = typeof import('./footballDataStandings.service.js')

let cacheRedis: RedisCache
let getStandings: StandingsService['getStandings']
let getStandingsCompetitions: StandingsService['getStandingsCompetitions']
let normalizeFootballDataStandings: StandingsService['normalizeFootballDataStandings']
let validateLeagueCode: StandingsService['validateLeagueCode']

const providerPayload = {
  competition: { code: 'PL', name: 'Premier League', emblem: null },
  season: { id: 2026, startDate: '2026-08-01', endDate: '2027-05-31', currentMatchday: 1 },
  standings: [{ type: 'TOTAL', table: [] }],
}

before(async () => {
  process.env.REDIS_URL_PRIMARY = ''
  process.env.REDIS_URL = ''
  process.env.REDIS_URL_BACKUP_1 = ''
  process.env.REDIS_URL_BACKUP_2 = ''
  process.env.REDIS_URL_BACKUP_3 = ''

  const redisModule = await import('../../core/redis.js')
  const standingsModule = await import('./footballDataStandings.service.js')
  cacheRedis = redisModule.cacheRedis
  getStandings = standingsModule.getStandings
  getStandingsCompetitions = standingsModule.getStandingsCompetitions
  normalizeFootballDataStandings = standingsModule.normalizeFootballDataStandings
  validateLeagueCode = standingsModule.validateLeagueCode
})

test('exposes all verified competitions and accepts only those with current standings', async () => {
  const competitions = getStandingsCompetitions()
  assert.equal(competitions.length, 12)
  assert.deepEqual(competitions.filter(({ standingsSupported }) => standingsSupported).map(({ code }) => code), [
    'PL', 'PD', 'CL', 'SA', 'BL1', 'DED', 'BSA', 'FL1', 'ELC', 'PPL',
  ])

  for (const code of ['PL', 'PD', 'CL', 'SA', 'BL1', 'DED', 'BSA', 'FL1', 'ELC', 'PPL']) {
    assert.equal(validateLeagueCode(code), code)
  }

  for (const code of ['WC', 'EC']) {
    await assert.rejects(
      getStandings(code),
      (error: unknown) => error instanceof Error && 'statusCode' in error && error.statusCode === 400,
    )
  }

  await assert.rejects(
    getStandings('https://api.football-data.org/v4/competitions/PL'),
    (error: unknown) => error instanceof Error && 'statusCode' in error && error.statusCode === 400,
  )
})

test('normalizes a valid empty provider table without inventing standings', () => {
  const normalized = normalizeFootballDataStandings(providerPayload, 'PL')
  assert.equal(normalized.competition.name, 'Premier League')
  assert.equal(normalized.season.currentMatchday, 1)
  assert.deepEqual(normalized.standings, [])
})

test('serves a Redis cache hit without an upstream request', async (context) => {
  process.env.FOOTBALL_API_KEY = ''
  const cachedPayload = normalizeFootballDataStandings(providerPayload, 'PL')
  const freshKey = 'sportzonebd:football:standings:PL'
  const getMock = context.mock.method(cacheRedis, 'get', async (key: string) => key === freshKey ? JSON.stringify(cachedPayload) : null)

  const result = await getStandings('PL')

  assert.equal(result.meta.source, 'cache')
  assert.equal(result.meta.cached, true)
  assert.equal(result.meta.stale, false)
  assert.equal(getMock.mock.callCount(), 1)
})

test('waits for the Redis lock owner to populate the fresh cache', async (context) => {
  const leagueCode = 'PD'
  const cachedPayload = normalizeFootballDataStandings({
    ...providerPayload,
    competition: { ...providerPayload.competition, code: leagueCode, name: 'La Liga' },
  }, leagueCode)
  const freshKey = `sportzonebd:football:standings:${leagueCode}`
  let freshReads = 0
  context.mock.method(cacheRedis, 'get', async (key: string) => {
    if (key !== freshKey) return null
    freshReads += 1
    return freshReads > 1 ? JSON.stringify(cachedPayload) : null
  })
  context.mock.method(cacheRedis, 'set', async (..._args: unknown[]) => null)

  const result = await getStandings(leagueCode)

  assert.equal(freshReads, 2)
  assert.equal(result.competition.code, leagueCode)
  assert.equal(result.meta.source, 'cache')
  assert.equal(result.meta.stale, false)
})

test('coalesces concurrent misses, fetches once, and caches the normalized response for 600 seconds', async (context) => {
  const apiKey = `test-${randomUUID()}`
  process.env.FOOTBALL_API_KEY = apiKey
  const writes: unknown[][] = []
  const getMock = context.mock.method(cacheRedis, 'get', async () => null)
  context.mock.method(cacheRedis, 'set', async (..._args: unknown[]) => 'OK')
  context.mock.method(cacheRedis, 'eval', async (..._args: unknown[]) => 1)

  const pipeline: ReturnType<typeof cacheRedis.pipeline> = {
    set(...args: unknown[]) { writes.push(args); return pipeline },
    sadd(..._args: unknown[]) { return pipeline },
    expire(..._args: unknown[]) { return pipeline },
    del(..._args: unknown[]) { return pipeline },
    async exec() { return [] },
  }
  context.mock.method(cacheRedis, 'pipeline', () => pipeline)

  let requestUrl = ''
  let sentToken = ''
  const fakeHttpGet = async (url: string, config?: AxiosRequestConfig) => {
    requestUrl = url
    const headers = config?.headers as unknown as Record<string, string>
    sentToken = headers['X-Auth-Token']
    return { data: providerPayload } as unknown as AxiosResponse<unknown>
  }
  const httpMock = context.mock.method(axios, 'get', fakeHttpGet as typeof axios.get)

  const results = await Promise.all(Array.from({ length: 100 }, () => getStandings('PL')))

  assert.equal(httpMock.mock.callCount(), 1)
  assert.equal(getMock.mock.callCount(), 2)
  assert.equal(requestUrl, 'https://api.football-data.org/v4/competitions/PL/standings')
  assert.equal(sentToken, apiKey)
  assert.equal(results.every((result) => result.meta.source === 'football-data.org' && !result.meta.cached), true)
  assert.deepEqual(writes.map((write) => [write[0], write[2], write[3]]), [
    ['sportzonebd:football:standings:PL', 'EX', 600],
    ['sportzonebd:football:standings:stale:PL', 'EX', 604800],
  ])
})

test('serves stale Redis data when football-data.org rate limits', async (context) => {
  process.env.FOOTBALL_API_KEY = `test-${randomUUID()}`
  const stalePayload = normalizeFootballDataStandings(providerPayload, 'PL')
  const staleKey = 'sportzonebd:football:standings:stale:PL'
  const getMock = context.mock.method(cacheRedis, 'get', async (key: string) => key === staleKey ? JSON.stringify(stalePayload) : null)
  context.mock.method(cacheRedis, 'set', async (..._args: unknown[]) => 'OK')
  context.mock.method(cacheRedis, 'eval', async (..._args: unknown[]) => 1)
  const rateLimitError = Object.assign(new Error('provider rate limited'), {
    isAxiosError: true,
    response: { status: 429 },
  })
  const httpMock = context.mock.method(axios, 'get', (async () => { throw rateLimitError }) as typeof axios.get)

  const result = await getStandings('PL')

  assert.equal(getMock.mock.callCount(), 2)
  assert.equal(httpMock.mock.callCount(), 1)
  assert.equal(result.meta.source, 'cache')
  assert.equal(result.meta.cached, true)
  assert.equal(result.meta.stale, true)
  assert.deepEqual(result.standings, [])
})
