import test from 'node:test'
import assert from 'node:assert/strict'
import { CLOUDINARY_PLACEHOLDER_URL } from './cloudinary.ts'
import {
  classifyTeamLogoReference,
  isHotlinkableTeamLogo,
  resolveTeamLogoUrl,
  selectTeamLogo,
  teamInitials,
} from './teamLogo.ts'

const CLOUDINARY_DELIVERY = 'https://res.cloudinary.com/drmqcl0ft/image/upload/v1712345678/sportzone/team-logos/india.png'
const FOOTBALL_DATA_CREST = 'https://crests.football-data.org/57.png'
const API_FOOTBALL_CREST = 'https://media.api-sports.io/football/teams/33.png'

test('a missing logo reference renders the fallback instead of a request that can only fail', () => {
  for (const reference of [undefined, null, '', '   ']) {
    assert.equal(resolveTeamLogoUrl(reference), null, `expected ${String(reference)} to resolve to no image`)
  }
})

test('a CricketData-hosted image is never hotlinked', () => {
  for (const reference of [
    'https://g.cricapi.com/player/india.png',
    'http://cricapi.com/team/australia.png',
    'https://img.cricapi.com/x/y.png',
  ]) {
    assert.equal(isHotlinkableTeamLogo(reference), false, `expected ${reference} to be blocked`)
    assert.equal(resolveTeamLogoUrl(reference, { width: 48 }), null)
  }
})

test('a lookalike host is not mistaken for the blocked provider', () => {
  for (const reference of ['https://notcricapi.com/logo.png', 'https://cricapi.com.evil.example/logo.png']) {
    assert.equal(isHotlinkableTeamLogo(reference), true, `expected ${reference} to stay usable`)
    assert.equal(resolveTeamLogoUrl(reference), reference)
  }
})

test('a permitted provider crest and a local preview are still rendered untouched', () => {
  const crest = 'https://media.api-sports.io/football/teams/42.png'
  assert.equal(resolveTeamLogoUrl(crest, { width: 96 }), crest)
  assert.equal(resolveTeamLogoUrl('blob:http://localhost:5174/9f1c'), 'blob:http://localhost:5174/9f1c')
  assert.equal(resolveTeamLogoUrl('data:image/png;base64,iVBORw0KGgo='), 'data:image/png;base64,iVBORw0KGgo=')
})

test('an admin-managed Cloudinary asset keeps its public id and gains our transformations once', () => {
  const built = resolveTeamLogoUrl(CLOUDINARY_DELIVERY, { width: 48, height: 48, crop: 'fit' })
  assert.ok(built)
  assert.equal(
    built,
    'https://res.cloudinary.com/drmqcl0ft/image/upload/q_auto,f_auto,w_48,h_48,c_fit/v1712345678/sportzone/team-logos/india.png',
  )
  assert.equal(resolveTeamLogoUrl(CLOUDINARY_DELIVERY, { width: 48, height: 48, crop: 'fit' }), built)
})

test('a relative public id still goes through the Cloudinary builder', () => {
  // The cloud name is provided by the bundler at build time, so a bare id resolves to the local
  // placeholder in a node test run — the same contract `buildCloudinaryUrl` has.
  assert.equal(resolveTeamLogoUrl('sportzone/team-logos/india.png'), CLOUDINARY_PLACEHOLDER_URL)
})

test('every stored reference is classified by what it really is', () => {
  assert.equal(classifyTeamLogoReference(CLOUDINARY_DELIVERY), 'assigned')
  assert.equal(classifyTeamLogoReference('sportzone/team-logos/india.png'), 'assigned')
  assert.equal(classifyTeamLogoReference('blob:http://localhost:5174/9f1c'), 'assigned')
  assert.equal(classifyTeamLogoReference(FOOTBALL_DATA_CREST), 'provider')
  assert.equal(classifyTeamLogoReference(API_FOOTBALL_CREST), 'provider')
  assert.equal(classifyTeamLogoReference('https://g.cricapi.com/player/india.png'), 'blocked')
  for (const empty of [undefined, null, '', '   ']) assert.equal(classifyTeamLogoReference(empty), 'none')
})

test('an assigned logo wins over a provider crest whatever order the candidates arrive in', () => {
  // The component may hold the provider crest first (it is what the fixture carried) and the team record
  // second; the administrator's logo must still be the one rendered.
  const assignedFirst = selectTeamLogo([CLOUDINARY_DELIVERY, FOOTBALL_DATA_CREST])
  assert.equal(assignedFirst.source, 'assigned')
  assert.ok(assignedFirst.url?.startsWith('https://res.cloudinary.com/'))

  const providerFirst = selectTeamLogo([FOOTBALL_DATA_CREST, CLOUDINARY_DELIVERY])
  assert.equal(providerFirst.source, 'assigned')
  assert.equal(providerFirst.url, assignedFirst.url)
})

test('a provider crest is used only when nothing was assigned to the team', () => {
  const selected = selectTeamLogo([null, undefined, FOOTBALL_DATA_CREST])

  assert.equal(selected.source, 'provider')
  assert.equal(selected.url, FOOTBALL_DATA_CREST)
})

test('a blocked provider image and an empty record leave nothing to render', () => {
  // A cricket fixture whose older record still stores the provider CDN image must fall back, not request it.
  assert.deepEqual(selectTeamLogo(['https://g.cricapi.com/player/india.png']), { url: null, source: null })
  assert.deepEqual(selectTeamLogo([]), { url: null, source: null })
  assert.deepEqual(selectTeamLogo([null, '  ']), { url: null, source: null })
  // A blocked reference must not beat a usable provider crest either.
  assert.equal(selectTeamLogo(['https://g.cricapi.com/x.png', FOOTBALL_DATA_CREST]).source, 'provider')
})

test('the initials fallback prefers the provider code, then the short name, then the team name', () => {
  assert.equal(teamInitials('Arsenal FC', { tla: 'ARS' }), 'ARS')
  assert.equal(teamInitials('Arsenal FC', { shortName: 'Arsenal' }), 'ARS')
  assert.equal(teamInitials('Arsenal FC', { length: 3 }), 'ARS')
  assert.equal(teamInitials('Arsenal FC'), 'AR')
  assert.equal(teamInitials('  Manchester   City  '), 'MA')
})

test('an unnamed side keeps the label the admin list already shows', () => {
  assert.equal(teamInitials(undefined, { fallback: 'T1' }), 'T1')
  assert.equal(teamInitials('', { fallback: 'T2' }), 'T2')
  assert.equal(teamInitials(null, { fallback: 'T1' }), 'T1')
  // A blank provider code must not win over a real name.
  assert.equal(teamInitials('India', { tla: '   ', shortName: '' }), 'IN')
})
