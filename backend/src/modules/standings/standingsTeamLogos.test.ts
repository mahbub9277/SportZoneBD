import assert from 'node:assert/strict'
import test from 'node:test'
import { applyAssignedTeamLogos } from './standingsTeamLogos.js'
import type { LeagueStanding } from './footballDataStandings.service.js'

const standing = (name: string, overrides: Partial<LeagueStanding['team']> = {}): LeagueStanding => ({
  position: 1,
  team: {
    id: 57,
    name,
    shortName: null,
    tla: null,
    crest: `https://crests.football-data.org/${name.length}.png`,
    ...overrides,
  },
  playedGames: 10,
  won: 6,
  draw: 2,
  lost: 2,
  goalsFor: 18,
  goalsAgainst: 9,
  goalDifference: 9,
  points: 20,
  description: null,
})

const ARSENAL_LOGO = 'https://res.cloudinary.com/drmqcl0ft/image/upload/v1/sportzone/team-logos/arsenal.png'
const CHELSEA_LOGO = 'sportzone/team-logos/chelsea'

test('an assigned logo is attached to the team it belongs to, and only to that team', () => {
  const [arsenal, chelsea] = applyAssignedTeamLogos(
    [standing('Arsenal FC'), standing('Chelsea FC')],
    [{ normalizedName: 'arsenal fc', logoUrl: ARSENAL_LOGO }],
  )

  assert.equal(arsenal.team.assignedLogo, ARSENAL_LOGO)
  assert.equal(chelsea.team.assignedLogo, null)
  // The provider crest is untouched, so a team without an override renders exactly as it does today.
  assert.equal(arsenal.team.crest, standing('Arsenal FC').team.crest)
})

test('matching is an exact normalized name, never a substring', () => {
  const logos = [{ normalizedName: 'manchester united', logoUrl: ARSENAL_LOGO }]

  const [united, city] = applyAssignedTeamLogos([standing('Manchester United'), standing('Manchester City')], logos)
  assert.equal(united.team.assignedLogo, ARSENAL_LOGO)
  assert.equal(city.team.assignedLogo, null, 'a different club must never inherit a logo')

  // Case and spacing differences are the same team; a different name is not.
  const [spaced] = applyAssignedTeamLogos([standing('  manchester   UNITED  ')], logos)
  assert.equal(spaced.team.assignedLogo, ARSENAL_LOGO)
})

test('a blank or missing record contributes nothing rather than an empty image', () => {
  const [team] = applyAssignedTeamLogos(
    [standing('Arsenal FC')],
    [{ normalizedName: 'arsenal fc', logoUrl: null }, { normalizedName: 'arsenal fc', logoUrl: '   ' }],
  )

  assert.equal(team.team.assignedLogo, null)
})

test('the first real logo wins when two records normalize to the same name', () => {
  const [team] = applyAssignedTeamLogos(
    [standing('Arsenal FC')],
    [{ normalizedName: 'arsenal fc', logoUrl: ARSENAL_LOGO }, { normalizedName: 'arsenal fc', logoUrl: CHELSEA_LOGO }],
  )

  assert.equal(team.team.assignedLogo, ARSENAL_LOGO)
})

test('a table with no matching records still returns every standing', () => {
  const rows = applyAssignedTeamLogos([standing('Arsenal FC'), standing('Chelsea FC')], [])

  assert.equal(rows.length, 2)
  assert.deepEqual(rows.map((row) => row.team.assignedLogo), [null, null])
  // Everything the page already consumed keeps its value.
  assert.equal(rows[0].position, 1)
  assert.equal(rows[0].points, 20)
  assert.equal(rows[0].team.tla, null)
})
