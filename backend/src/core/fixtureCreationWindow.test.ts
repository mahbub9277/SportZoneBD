import assert from 'node:assert/strict'
import { test } from 'node:test'
import { evaluateFixtureCreationWindow, getMatchDiscoveryDays, getMatchDiscoveryWindowMs } from './fixtureCreationWindow.js'

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS
const NOW = new Date('2026-10-04T12:00:00.000Z')
const MAX_LEAD = getMatchDiscoveryWindowMs({} as NodeJS.ProcessEnv)

function decide(leadHours: number) {
  return evaluateFixtureCreationWindow({
    kickoffAt: new Date(NOW.getTime() + leadHours * HOUR_MS),
    now: NOW,
    maxLeadMs: MAX_LEAD,
  })
}

test('refuses to create a match before the window opens', () => {
  assert.equal(decide(24 * 14), 'too-early')
  assert.equal(decide(24 * 8), 'too-early')
  assert.equal(decide(24 * 7 + 1), 'too-early')
})

test('creates inside the configured lead time', () => {
  assert.equal(decide(24 * 7), 'create')
  assert.equal(decide(24 * 4), 'create')
  assert.equal(decide(72), 'create')
  assert.equal(decide(49), 'create')
  assert.equal(decide(48), 'create')
  assert.equal(decide(36), 'create')
  assert.equal(decide(24), 'create')
})

test('still creates inside 24 hours as the safety fallback', () => {
  assert.equal(decide(1), 'create')
})

test('never creates a fixture whose kickoff has already passed, whatever the provider reports', () => {
  // A pending row is a review request for a match still to come. Re-inserting an expired fixture — the
  // provider returning a match that has just finished, or a sync running late — is what put old fixtures
  // back in front of an admin. Provider status no longer widens the window at all: the kickoff instant
  // decides, and the status the provider sends is normalized onto the match when it is written.
  assert.equal(decide(-1), 'expired')
  assert.equal(decide(-24 * 3), 'expired')
  // Kickoff exactly now has arrived, so it is not a future fixture either.
  assert.equal(decide(0), 'expired')
})

test('a kickoff near a timezone boundary is decided on the instant, not the date', () => {
  // 2026-10-05T04:00+06:00 is 2026-10-04T22:00Z: a future fixture, even though its local date differs.
  assert.equal(
    evaluateFixtureCreationWindow({
      kickoffAt: new Date('2026-10-05T04:00:00+06:00'),
      now: NOW,
      maxLeadMs: MAX_LEAD,
    }),
    'create',
  )
  // 2026-10-04T15:00+06:00 is 2026-10-04T09:00Z: already gone, even though its local date is today.
  assert.equal(
    evaluateFixtureCreationWindow({
      kickoffAt: new Date('2026-10-04T15:00:00+06:00'),
      now: NOW,
      maxLeadMs: MAX_LEAD,
    }),
    'expired',
  )
})

test('configured lead time is used, invalid values fall back, and the cap is enforced', () => {
  assert.equal(getMatchDiscoveryDays({} as NodeJS.ProcessEnv), 7)
  assert.equal(getMatchDiscoveryDays({ MATCH_DISCOVERY_DAYS: '5' } as NodeJS.ProcessEnv), 5)
  assert.equal(getMatchDiscoveryDays({ MATCH_DISCOVERY_DAYS: '0' } as NodeJS.ProcessEnv), 7)
  assert.equal(getMatchDiscoveryDays({ MATCH_DISCOVERY_DAYS: 'not-a-number' } as NodeJS.ProcessEnv), 7)
  assert.equal(getMatchDiscoveryDays({ MATCH_DISCOVERY_DAYS: '999' } as NodeJS.ProcessEnv), 14)
  assert.equal(getMatchDiscoveryWindowMs({ MATCH_DISCOVERY_DAYS: '2' } as NodeJS.ProcessEnv), 2 * DAY_MS)
})
