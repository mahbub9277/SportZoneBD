import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildRejectedFixtureLookup,
  getTeamsIdentity,
  isFixtureRejected,
  isRejectedRow,
  normalizeFixtureName,
  resolveExistingFixture,
} from './fixtureIdentity.js'

const HOUR = 60 * 60 * 1000
const fixture = (home: string, away: string, kickoffAt: string) => ({
  homeTeamName: home,
  awayTeamName: away,
  kickoffAt,
})

const row = (overrides: Record<string, unknown>) => ({
  id: 'row-1',
  providerFixtureKey: 'football-data-org:555' as string | null,
  homeTeamName: 'Liverpool FC',
  awayTeamName: 'Manchester City FC',
  kickoffAt: new Date('2026-10-11T15:30:00.000Z'),
  status: 'UPCOMING',
  deletedAt: null as Date | null,
  ...overrides,
})

test('team identity ignores provider naming noise so a rename is still the same fixture', () => {
  assert.equal(getTeamsIdentity('Liverpool FC', 'Manchester City FC'), getTeamsIdentity('Liverpool', 'Manchester City'))
  assert.equal(normalizeFixtureName('  Bayer  04 Leverkusen '), 'bayer 04 leverkusen')
  assert.notEqual(getTeamsIdentity('Liverpool', 'Everton'), getTeamsIdentity('Liverpool', 'Arsenal'))
})

test('a rescheduled fixture resolves to the stored row instead of being created again', () => {
  const stored = [row({ kickoffAt: new Date('2026-10-11T15:30:00.000Z') })]

  // Same provider id, kickoff moved nine hours: the key tier still finds the stored row.
  assert.equal(
    resolveExistingFixture(fixture('Liverpool', 'Manchester City', '2026-10-12T00:30:00.000Z'), 'football-data-org:555', stored, { identityWindowMs: 48 * HOUR })?.id,
    'row-1',
  )

  // Re-issued provider id and a moved kickoff: the team identity tier finds it.
  assert.equal(
    resolveExistingFixture(fixture('Liverpool', 'Manchester City', '2026-10-12T00:30:00.000Z'), 'api-football:999999', stored, { identityWindowMs: 48 * HOUR })?.id,
    'row-1',
  )
})

test('a different fixture between the same teams beyond the identity window is not merged', () => {
  const stored = [row({ kickoffAt: new Date('2026-10-11T15:30:00.000Z') })]

  assert.equal(
    resolveExistingFixture(fixture('Liverpool', 'Manchester City', '2026-10-25T15:30:00.000Z'), 'football-data-org:777', stored, { identityWindowMs: 48 * HOUR }),
    null,
  )
})

test('another pair of teams is never matched to an existing row', () => {
  const stored = [row({ kickoffAt: new Date('2026-10-11T15:30:00.000Z') })]

  assert.equal(
    resolveExistingFixture(fixture('Liverpool', 'Arsenal', '2026-10-11T15:30:00.000Z'), 'football-data-org:888', stored, { identityWindowMs: 48 * HOUR }),
    null,
  )
})

test('the canonical owner wins when two providers describe one fixture', () => {
  const stored = [
    row({ id: 'api-football-row', providerFixtureKey: 'api-football:42' }),
    row({ id: 'football-data-row', providerFixtureKey: 'football-data-org:555' }),
    row({ id: 'admin-row', providerFixtureKey: null }),
  ]
  const rank = (candidate: { providerFixtureKey: string | null }) =>
    candidate.providerFixtureKey?.startsWith('football-data-org') ? 0 : candidate.providerFixtureKey ? 1 : Number.MAX_SAFE_INTEGER

  assert.equal(
    resolveExistingFixture(fixture('Liverpool', 'Manchester City', '2026-10-11T15:30:00.000Z'), 'cricket-data:1', stored, { identityWindowMs: 48 * HOUR, rankOwner: rank })?.id,
    'football-data-row',
  )
})

test('both rejection shapes count: the explicit REJECTED state and the older soft-deleted PENDING row', () => {
  assert.equal(isRejectedRow({ status: 'REJECTED', deletedAt: null }), true)
  assert.equal(isRejectedRow({ status: 'REJECTED', deletedAt: new Date() }), true)
  assert.equal(isRejectedRow({ status: 'PENDING', deletedAt: new Date() }), true)
  assert.equal(isRejectedRow({ status: 'PENDING', deletedAt: null }), false)
  // An admin removing a published match is an ordinary removal, not a rejection.
  assert.equal(isRejectedRow({ status: 'UPCOMING', deletedAt: new Date() }), false)
  assert.equal(isRejectedRow({ status: 'FINISHED', deletedAt: new Date() }), false)
})

test('a rejected fixture stays rejected after the provider moves its kickoff', () => {
  const rejected = buildRejectedFixtureLookup([
    row({ providerFixtureKey: 'football-data-org:pl|liverpool|manchester city|2026-10-11T15:30:00.000Z', status: 'PENDING', deletedAt: new Date('2026-10-08T09:00:00.000Z') }),
  ])

  // The provider now reports a new kickoff, so the old key no longer matches…
  const movedKey = 'football-data-org:pl|liverpool|manchester city|2026-10-12T00:30:00.000Z'
  assert.equal(movedKey.includes('2026-10-11'), false)
  // …and the team identity is what keeps the rejection durable.
  assert.equal(isFixtureRejected(rejected, movedKey, getTeamsIdentity('Liverpool', 'Manchester City')), true)
  // A different fixture is still allowed through.
  assert.equal(isFixtureRejected(rejected, 'football-data-org:999', getTeamsIdentity('Liverpool', 'Arsenal')), false)
})

test('the explicit REJECTED state is honoured by both its key and its teams', () => {
  const rejected = buildRejectedFixtureLookup([row({ status: 'REJECTED', providerFixtureKey: 'football-data-org:555' })])

  assert.equal(isFixtureRejected(rejected, 'football-data-org:555', getTeamsIdentity('Nobody', 'Nobody')), true)
  assert.equal(isFixtureRejected(rejected, 'football-data-org:556', getTeamsIdentity('Liverpool', 'Manchester City')), true)
})

test('a soft-deleted published match is not treated as a rejection', () => {
  const rejected = buildRejectedFixtureLookup([row({ status: 'UPCOMING', deletedAt: new Date() })])

  assert.equal(isFixtureRejected(rejected, 'football-data-org:555', getTeamsIdentity('Liverpool', 'Manchester City')), false)
})

test('rows without teams never create a phantom team identity', () => {
  const rejected = buildRejectedFixtureLookup([
    { providerFixtureKey: null, homeTeamName: null, awayTeamName: null, status: 'REJECTED', deletedAt: null },
  ])

  assert.equal(rejected.teams.size, 0)
  assert.equal(isFixtureRejected(rejected, 'football-data-org:1', getTeamsIdentity('Liverpool', 'Manchester City')), false)
})
