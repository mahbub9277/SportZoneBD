import test from 'node:test'
import assert from 'node:assert/strict'
import {
  canonicalTeamKey,
  pickLegacyTeamLogo,
  pickReconciledTeam,
  stripClubAffixes,
  teamLookupKeys,
  type LegacyTeamSnapshot,
  type TeamRecord,
} from './teamReconciliation.js'

const team = (id: string, name: string, logoUrl: string | null = null): TeamRecord => ({
  id,
  name,
  normalizedName: name.trim().replace(/\s+/g, ' ').toLowerCase(),
  logoUrl,
})

const snapshot = (homeTeamName: string, homeTeamLogo: string | null, awayTeamName: string | null = null, awayTeamLogo: string | null = null): LegacyTeamSnapshot => ({
  homeTeamName,
  awayTeamName,
  homeTeamLogo,
  awayTeamLogo,
})

test('an exact name match reuses the stored team and its logo', () => {
  const records = [team('team-1', 'Real Madrid', 'sportzone/teams/real-madrid'), team('team-2', 'Barcelona')]
  assert.deepEqual(pickReconciledTeam(records, 'Real Madrid'), { id: 'team-1', name: 'Real Madrid', logo: 'sportzone/teams/real-madrid' })
  assert.deepEqual(pickReconciledTeam(records, 'real madrid'), { id: 'team-1', name: 'Real Madrid', logo: 'sportzone/teams/real-madrid' })
  assert.deepEqual(pickReconciledTeam(records, '  REAL   MADRID '), { id: 'team-1', name: 'Real Madrid', logo: 'sportzone/teams/real-madrid' })
})

test('a club affix difference still resolves uniquely', () => {
  const records = [team('team-1', 'FC Barcelona', 'sportzone/teams/fc-barcelona')]
  assert.deepEqual(pickReconciledTeam(records, 'Barcelona'), { id: 'team-1', name: 'FC Barcelona', logo: 'sportzone/teams/fc-barcelona' })

  const reversed = [team('team-2', 'Barcelona', 'sportzone/teams/barcelona')]
  assert.deepEqual(pickReconciledTeam(reversed, 'FC Barcelona'), { id: 'team-2', name: 'Barcelona', logo: 'sportzone/teams/barcelona' })
})

test('an ambiguous affix match never guesses a team', () => {
  const records = [team('team-1', 'FC Barcelona', 'sportzone/teams/fc-barcelona'), team('team-2', 'Barcelona SC', 'sportzone/teams/barcelona-sc')]
  assert.equal(pickReconciledTeam(records, 'Barcelona'), null)
})

test('different teams never reconcile', () => {
  const records = [team('team-1', 'Real Sociedad'), team('team-2', 'Barcelona')]
  assert.equal(pickReconciledTeam(records, 'Real Madrid'), null)
  assert.equal(pickReconciledTeam(records, 'Barc'), null)
  assert.equal(pickReconciledTeam(records, null), null)
  assert.equal(pickReconciledTeam(records, '   '), null)
})

test('canonically equivalent Bengali spellings resolve to the same team', () => {
  const composed = `\u09AE\u09DF\u09AE\u09A8` // ময়মন (precomposed য়)
  const decomposed = `\u09AE\u09AF\u09BC\u09AE\u09A8` // same word, nukta written separately
  const records = [team('team-1', composed, 'sportzone/teams/mymensingh')]
  assert.deepEqual(pickReconciledTeam(records, decomposed), { id: 'team-1', name: composed, logo: 'sportzone/teams/mymensingh' })
  assert.equal(canonicalTeamKey(composed), canonicalTeamKey(decomposed))
})

test('lookup keys cover the canonical name and its affix-free core', () => {
  assert.deepEqual(teamLookupKeys('FC Barcelona'), ['fc barcelona', 'barcelona'])
  assert.deepEqual(teamLookupKeys('Real Madrid'), ['real madrid'])
  assert.deepEqual(teamLookupKeys(''), [])
  assert.equal(stripClubAffixes('fc barcelona'), 'barcelona')
  assert.equal(stripClubAffixes('barcelona sc'), 'barcelona')
  assert.equal(stripClubAffixes('fc'), 'fc')
})

test('the legacy logo fallback only uses a snapshot with the same team name', () => {
  const snapshots = [
    snapshot('Real Madrid', 'sportzone/teams/real-madrid', 'Barcelona', 'sportzone/teams/barcelona'),
    snapshot('Other Team', 'sportzone/teams/other', null, null),
  ]

  assert.equal(pickLegacyTeamLogo(snapshots, 'Real Madrid'), 'sportzone/teams/real-madrid')
  assert.equal(pickLegacyTeamLogo(snapshots, 'barcelona'), 'sportzone/teams/barcelona')
  assert.equal(pickLegacyTeamLogo(snapshots, 'Unknown FC'), null)
  assert.equal(pickLegacyTeamLogo(snapshots, null), null)
})

test('a snapshot without a logo does not invent one', () => {
  const snapshots = [snapshot('Real Madrid', null, 'Barcelona', null)]
  assert.equal(pickLegacyTeamLogo(snapshots, 'Real Madrid'), null)
})
