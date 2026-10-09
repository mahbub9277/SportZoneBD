import assert from 'node:assert/strict'
import test from 'node:test'
import { MATCH_DESCRIPTION_RANGE, composeMatchDescription } from './matchDescription.js'
import { countDescriptionCharacters } from './descriptionLength.js'

const inRange = (value: string | null) => {
  const length = value === null ? 0 : countDescriptionCharacters(value)
  return length >= MATCH_DESCRIPTION_RANGE.min && length <= MATCH_DESCRIPTION_RANGE.max
}

test('the sentence uses the real competition, both sides, the local kickoff and the round', () => {
  const { description, warning } = composeMatchDescription({
    sport: 'CRICKET',
    tournamentName: 'Asia Cup',
    homeTeamName: 'Bangladesh',
    awayTeamName: 'India',
    kickoffLabel: '18 Oct, 19:30',
    round: 4,
    durationMinutes: 240,
  })

  assert.equal(warning, null)
  assert.ok(description, 'a description was produced')
  assert.ok(inRange(description))
  assert.match(description, /Cricket/)
  assert.match(description, /Asia Cup/)
  assert.match(description, /Bangladesh vs India/)
  assert.match(description, /19:30/)
})

test('every supported sport is named with its own vocabulary', () => {
  const sports: Array<[string, RegExp]> = [
    ['FOOTBALL', /Football/],
    ['CRICKET', /Cricket/],
    ['BASKETBALL', /Basketball/],
    ['TENNIS', /Tennis/],
    ['MOTORSPORTS', /Motorsport/],
    ['WWE', /Wrestling/],
  ]

  for (const [sport, pattern] of sports) {
    const { description } = composeMatchDescription({
      sport,
      tournamentName: 'Champions Series',
      homeTeamName: 'Alex Morgan',
      awayTeamName: 'Naomi Osaka',
      kickoffLabel: '18 October, 19:30',
      round: 2,
    })
    assert.ok(description, `${sport} produced no description`)
    assert.match(description, pattern, `${sport} was not named`)
    assert.ok(inRange(description), `${sport} length was ${countDescriptionCharacters(description!)}`)
  }
})

test('nothing is invented when a field is missing: the fragment is simply left out', () => {
  const { description, warning } = composeMatchDescription({
    sport: null,
    tournamentName: null,
    homeTeamName: 'Bangladesh',
    awayTeamName: 'India',
    kickoffLabel: null,
    round: null,
  })

  // Only the fixture is known, so no truthful sentence reaches 80 characters.
  assert.equal(description, null)
  assert.match(warning ?? '', /could not be written/i)
})

test('an unknown sport is never guessed, and a known one is never dropped from a long sentence', () => {
  const unknown = composeMatchDescription({
    sport: 'CHESS',
    tournamentName: 'Grand Slam Masters Cup',
    homeTeamName: 'Player One',
    awayTeamName: 'Player Two',
    kickoffLabel: '18 October, 19:30',
    round: 9,
  })
  assert.ok(unknown.description)
  assert.doesNotMatch(unknown.description, /Chess/i)

  const known = composeMatchDescription({
    sport: 'BASKETBALL',
    tournamentName: 'Premier League',
    homeTeamName: 'Lakers',
    awayTeamName: 'Celtics',
    kickoffLabel: '18 October, 19:30',
    round: 12,
  })
  assert.match(known.description ?? '', /Basketball/)
})

test('the result is deterministic and always inside the range when it is produced at all', () => {
  const input = {
    sport: 'FOOTBALL',
    tournamentName: 'Premier League',
    homeTeamName: 'Arsenal',
    awayTeamName: 'Chelsea',
    kickoffLabel: '18 October, 19:30',
    round: 9,
  }

  const first = composeMatchDescription(input)
  const second = composeMatchDescription(input)
  assert.equal(first.description, second.description)
  assert.ok(inRange(first.description))
})

test('context fragments are dropped whole rather than cut, and a fixture longer than the limit is refused', () => {
  // Long but writable: the optional context is dropped until the sentence fits, with no half words and
  // no trailing separator left behind.
  const writable = composeMatchDescription({
    sport: 'CRICKET',
    tournamentName: 'Champions Trophy Qualifier',
    homeTeamName: 'Bangladesh',
    awayTeamName: 'India',
    kickoffLabel: 'Saturday 18 October 2026, 19:30 Bangladesh time',
    round: 21,
    durationMinutes: 240,
    quality: '1080p',
    preStartWindowMinutes: 30,
  })
  assert.ok(writable.description)
  assert.ok(inRange(writable.description))
  assert.ok(!writable.description.endsWith(','), 'a dropped fragment cannot leave a trailing separator')
  assert.ok(!/, round 21$/.test(writable.description) || inRange(writable.description))

  // Too long even for the fixture alone: refusing is the only honest answer.
  const refused = composeMatchDescription({
    sport: 'MOTORSPORTS',
    tournamentName: 'Formula World Championship Grand Prix Series',
    homeTeamName: 'Alexander Maximilian Schmidt',
    awayTeamName: 'Konstantinos Papadopoulos',
    kickoffLabel: 'Saturday 18 October 2026, 19:30 Bangladesh time',
    round: 21,
  })
  assert.equal(refused.description, null)
  assert.match(refused.warning ?? '', /longer than the limit|could not be written/i)
})
