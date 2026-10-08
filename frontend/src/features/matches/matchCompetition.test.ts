import test from 'node:test'
import assert from 'node:assert/strict'
import { getMatchCompetitionLabel } from './matchCompetition.ts'
import type { Match } from './matches.types'

const match = (overrides: Partial<Match>): Match => ({
  id: '00000000-0000-0000-0000-000000000000',
  title: 'Real Madrid vs Barcelona',
  kickoffAt: '2026-10-08T18:00:00.000Z',
  status: 'UPCOMING',
  premium: false,
  streams: [],
  highlights: [],
  ...overrides,
})

test('football shows sport and competition without inventing a season or round', () => {
  assert.equal(getMatchCompetitionLabel(match({ sport: 'FOOTBALL', tournamentName: 'Premier League' })), 'Football || Premier League')
})

test('football adds a real season and round when the stored text carries them', () => {
  assert.equal(
    getMatchCompetitionLabel(match({ sport: 'FOOTBALL', tournamentName: 'La Liga 2026/2027', title: 'Real Madrid vs Barcelona — La Liga · Round 8' })),
    'Football || La Liga 2026/2027 - Round 8',
  )
})

test('football uses a real round field and a real season field when the API provides one', () => {
  assert.equal(
    getMatchCompetitionLabel(match({ sport: 'FOOTBALL', tournamentName: 'Premier League', round: 7, season: '2026/2027' })),
    'Football || Premier League 2026/2027 - Round 7',
  )
})

test('a missing round is never defaulted to a number', () => {
  assert.equal(getMatchCompetitionLabel(match({ sport: 'FOOTBALL', tournamentName: 'Bundesliga' })), 'Football || Bundesliga')
  assert.equal(getMatchCompetitionLabel(match({ sport: 'FOOTBALL', tournamentName: 'Bundesliga', round: 0 })), 'Football || Bundesliga')
  assert.equal(getMatchCompetitionLabel(match({ sport: 'FOOTBALL', tournamentName: 'Bundesliga', round: 'none' })), 'Football || Bundesliga')
})

test('cricket uses its own format with the match year', () => {
  assert.equal(
    getMatchCompetitionLabel(match({ sport: 'CRICKET', tournamentName: 'Australia in South Africa', kickoffAt: '2026-09-12T09:00:00.000Z' })),
    'Cricket || Australia in South Africa, 2026',
  )
})

test('cricket does not repeat a year the series name already carries', () => {
  assert.equal(
    getMatchCompetitionLabel(match({ sport: 'CRICKET', tournamentName: 'Australia in South Africa, 2026', kickoffAt: '2026-09-12T09:00:00.000Z' })),
    'Cricket || Australia in South Africa, 2026',
  )
})

test('other sports keep a plain competition name', () => {
  assert.equal(getMatchCompetitionLabel(match({ sport: 'BASKETBALL', tournamentName: 'NBA' })), 'Basketball || NBA')
  assert.equal(getMatchCompetitionLabel(match({ sport: 'WWE', tournamentName: 'SmackDown' })), 'WWE || SmackDown')
})

test('unknown sport codes are still shown from their real value', () => {
  assert.equal(getMatchCompetitionLabel(match({ sport: 'HANDBALL', tournamentName: 'EHF Champions League' })), 'Handball || EHF Champions League')
})

test('a competition already containing the round is not given a second one', () => {
  assert.equal(getMatchCompetitionLabel(match({ sport: 'FOOTBALL', tournamentName: 'La Liga - Round 8' })), 'Football || La Liga - Round 8')
})

test('the legacy competition relation is used when tournamentName is absent', () => {
  assert.equal(
    getMatchCompetitionLabel(match({ sport: 'FOOTBALL', tournamentName: null, competition: { id: 'c1', name: 'Serie A' } })),
    'Football || Serie A',
  )
})

test('a match with no sport and no competition renders no context line', () => {
  assert.equal(getMatchCompetitionLabel(match({ sport: undefined, tournamentName: null, competition: null })), null)
  assert.equal(getMatchCompetitionLabel(match({ sport: '   ', tournamentName: '  ' })), null)
})

test('a sport without a competition still describes the match truthfully', () => {
  assert.equal(getMatchCompetitionLabel(match({ sport: 'FOOTBALL', tournamentName: null, competition: null })), 'Football')
})
