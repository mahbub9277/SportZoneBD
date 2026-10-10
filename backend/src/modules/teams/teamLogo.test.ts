import assert from 'node:assert/strict'
import test from 'node:test'
import { assignedTeamLogoFields, isProviderLogoCrest } from './teamLogo.js'

const FOOTBALL_DATA_CREST = 'https://crests.football-data.org/57.png'
const API_FOOTBALL_CREST = 'https://media.api-sports.io/football/teams/33.png'
const OWN_ASSET = 'https://res.cloudinary.com/drmqcl0ft/image/upload/v1712345678/sportzone/team-logos/arsenal.png'

test('a provider crest is recognised so it is never stored as an owned team asset', () => {
  assert.equal(isProviderLogoCrest(FOOTBALL_DATA_CREST), true)
  assert.equal(isProviderLogoCrest(API_FOOTBALL_CREST), true)
  assert.equal(isProviderLogoCrest('https://crests.football-data.org/57.png?v=2'), true)
})

test('an owned asset, a blank value and a lookalike host are not provider crests', () => {
  assert.equal(isProviderLogoCrest(OWN_ASSET), false)
  assert.equal(isProviderLogoCrest('sportzone/team-logos/arsenal.png'), false)
  assert.equal(isProviderLogoCrest('https://notfootball-data.org/57.png'), false)
  assert.equal(isProviderLogoCrest('https://crests.football-data.org.evil.example/57.png'), false)
  assert.equal(isProviderLogoCrest(null), false)
  assert.equal(isProviderLogoCrest(undefined), false)
  assert.equal(isProviderLogoCrest('   '), false)
})

test('an owned asset is stored in both logo columns, exactly as before', () => {
  assert.deepEqual(assignedTeamLogoFields(OWN_ASSET), { logoUrl: OWN_ASSET, logoPublicId: OWN_ASSET })

  const publicId = '  sportzone/team-logos/arsenal.png  '
  assert.deepEqual(assignedTeamLogoFields(publicId), {
    logoUrl: 'sportzone/team-logos/arsenal.png',
    logoPublicId: 'sportzone/team-logos/arsenal.png',
  })
})

test('a provider crest never overwrites what an administrator assigned', () => {
  // This is the exact input the match form sends when a fixture already carries a provider crest.
  assert.deepEqual(assignedTeamLogoFields(FOOTBALL_DATA_CREST), {})
  assert.deepEqual(assignedTeamLogoFields(API_FOOTBALL_CREST), {})
})

test('an empty input writes nothing, so a cleared form field cannot wipe a team logo', () => {
  for (const empty of [null, undefined, '', '   ']) {
    assert.deepEqual(assignedTeamLogoFields(empty), {})
  }
})
