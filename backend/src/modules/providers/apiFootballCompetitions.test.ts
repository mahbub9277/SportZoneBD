import assert from 'node:assert/strict'
import { test } from 'node:test'

import { FOOTBALL_DATA_COMPETITIONS } from '../matches/footballDataCompetitions.js'
import {
  DEFAULT_API_FOOTBALL_LEAGUES,
  FOOTBALL_DATA_COVERED_API_FOOTBALL_LEAGUES,
  getApiFootballLeagues,
  isApiFootballLeagueConfigDisabled,
  isFootballDataCoveredLeague,
  parseApiFootballLeagueConfig,
  resolveApiFootballSeason,
} from './apiFootballCompetitions.js'

const ENV = { API_FOOTBALL_KEY: 'test-key' } as NodeJS.ProcessEnv

test('parses a league list, including per-league season overrides', () => {
  assert.deepEqual(parseApiFootballLeagueConfig('15,5,253:2026,307'), [
    { id: 15 },
    { id: 5 },
    { id: 253, season: 2026 },
    { id: 307 },
  ])
  assert.deepEqual(parseApiFootballLeagueConfig(' 253 , 253 , 10 '), [{ id: 253 }, { id: 10 }])
  assert.deepEqual(parseApiFootballLeagueConfig(''), [])
  assert.deepEqual(parseApiFootballLeagueConfig(undefined), [])
})

test('ignores malformed entries instead of querying a nonsense league or season', () => {
  assert.deepEqual(parseApiFootballLeagueConfig('abc,0,-5,253:current,253:9999'), [{ id: 253 }])
})

test('defaults to the additional-coverage mapping, never to the football-data competitions', () => {
  const selection = getApiFootballLeagues(ENV)

  assert.equal(selection.source, 'default-mapping')
  assert.deepEqual(selection.leagues.map((league) => league.id), [15, 5, 253, 307, 10])
  assert.deepEqual(selection.ignoredCoveredLeagueIds, [])
  assert.ok(selection.leagues.every((league) => !isFootballDataCoveredLeague(league.id)))
})

test('filters out competitions football-data.org owns, even when explicitly configured', () => {
  const selection = getApiFootballLeagues({ ...ENV, API_FOOTBALL_LEAGUES: '39,140,253' })

  assert.equal(selection.source, 'configured')
  assert.deepEqual(selection.leagues.map((league) => league.id), [253])
  assert.deepEqual(selection.ignoredCoveredLeagueIds, [39, 140])
})

test('a Premier League-only default league is never used to drive discovery', () => {
  // API_FOOTBALL_DEFAULT_LEAGUE_ID is the legacy single-league default (39 = Premier League).
  // It must not restrict or seed discovery, which stays on the additional-coverage mapping.
  const selection = getApiFootballLeagues({ ...ENV, API_FOOTBALL_DEFAULT_LEAGUE_ID: '39' })

  assert.equal(selection.source, 'default-mapping')
  assert.deepEqual(selection.leagues.map((league) => league.id), DEFAULT_API_FOOTBALL_LEAGUES.map((league) => league.id))
  assert.ok(!selection.leagues.some((league) => league.id === 39))
})

test('a configuration that only names football-data competitions leaves nothing to poll', () => {
  const selection = getApiFootballLeagues({ ...ENV, API_FOOTBALL_LEAGUES: '39,140,2' })

  assert.deepEqual(selection.leagues, [])
  assert.deepEqual(selection.ignoredCoveredLeagueIds, [39, 140, 2])
})

test('an explicit disable value switches the provider off without touching provider code', () => {
  for (const raw of ['disabled', 'DISABLED', ' off ', 'none']) {
    const selection = getApiFootballLeagues({ ...ENV, API_FOOTBALL_LEAGUES: raw })

    assert.equal(selection.source, 'disabled')
    assert.deepEqual(selection.leagues, [])
    assert.deepEqual(selection.ignoredCoveredLeagueIds, [])
  }

  // An empty value keeps its meaning: the built-in additional-coverage mapping.
  assert.equal(isApiFootballLeagueConfigDisabled(undefined), false)
  assert.equal(isApiFootballLeagueConfigDisabled(''), false)
  assert.equal(isApiFootballLeagueConfigDisabled('15,5'), false)
  assert.equal(getApiFootballLeagues({ ...ENV, API_FOOTBALL_LEAGUES: '' }).source, 'default-mapping')
})

test('every football-data.org discovery competition is mapped so it can never be double-sourced', () => {
  const coveredCodes = new Set(Object.values(FOOTBALL_DATA_COVERED_API_FOOTBALL_LEAGUES))
  const missing = FOOTBALL_DATA_COMPETITIONS
    .filter(({ matchDiscoverySupported }) => matchDiscoverySupported)
    .map(({ code }) => code)
    .filter((code) => !coveredCodes.has(code))

  // Guards against the catalogue and the API-Football blocklist drifting apart.
  assert.deepEqual(missing, [])
  assert.ok(coveredCodes.has('PL'), 'Premier League must stay owned by football-data.org')
})

test('resolves the season from the run date using each league calendar style', () => {
  const european = { id: 5, name: 'UEFA Nations League', seasonStyle: 'EURO' } as const
  const calendar = { id: 253, name: 'Major League Soccer', seasonStyle: 'CALENDAR' } as const

  // October 2026 is inside the 2026-27 European season and the 2026 MLS season.
  assert.equal(resolveApiFootballSeason(european, new Date('2026-10-04T00:00:00.000Z'), {} as NodeJS.ProcessEnv), 2026)
  assert.equal(resolveApiFootballSeason(calendar, new Date('2026-10-04T00:00:00.000Z'), {} as NodeJS.ProcessEnv), 2026)

  // March 2027 is still the 2026 European season but a fresh 2027 MLS season.
  assert.equal(resolveApiFootballSeason(european, new Date('2027-03-01T00:00:00.000Z'), {} as NodeJS.ProcessEnv), 2026)
  assert.equal(resolveApiFootballSeason(calendar, new Date('2027-03-01T00:00:00.000Z'), {} as NodeJS.ProcessEnv), 2027)
})

test('the Club World Cup season is pinned because only 2025 exists', () => {
  const selection = getApiFootballLeagues(ENV)
  const clubWorldCup = selection.leagues.find((league) => league.id === 15)

  assert.ok(clubWorldCup)
  assert.equal(
    resolveApiFootballSeason(clubWorldCup, new Date('2026-10-04T00:00:00.000Z'), {} as NodeJS.ProcessEnv),
    2025,
  )
})

test('an explicit season wins over the shared default, which wins over derivation', () => {
  const league = { id: 15, name: 'FIFA Club World Cup', seasonStyle: 'EURO' } as const
  const at = new Date('2026-10-04T00:00:00.000Z')

  assert.equal(resolveApiFootballSeason({ ...league, season: 2025 }, at, { API_FOOTBALL_DEFAULT_SEASON: '2024' } as NodeJS.ProcessEnv), 2025)
  assert.equal(resolveApiFootballSeason(league, at, { API_FOOTBALL_DEFAULT_SEASON: '2024' } as NodeJS.ProcessEnv), 2024)
  assert.equal(resolveApiFootballSeason(league, at, { API_FOOTBALL_DEFAULT_SEASON: 'not-a-year' } as NodeJS.ProcessEnv), 2026)
})
