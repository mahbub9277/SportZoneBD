import assert from 'node:assert/strict'
import { test } from 'node:test'
import { evaluateFixtureCreationWindow, getMatchDiscoveryDays, getMatchDiscoveryWindowMs } from './fixtureCreationWindow.js'

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS
const NOW = new Date('2026-10-04T12:00:00.000Z')
const MAX_LEAD = getMatchDiscoveryWindowMs({} as NodeJS.ProcessEnv)

function decide(leadHours: number, providerStatus: 'UPCOMING' | 'LIVE' | 'FINISHED' = 'UPCOMING') {
  return evaluateFixtureCreationWindow({
    kickoffAt: new Date(NOW.getTime() + leadHours * HOUR_MS),
    now: NOW,
    maxLeadMs: MAX_LEAD,
    providerStatus,
  })
}

test('refuses to create a match before the window opens', () => {
  assert.equal(decide(24 * 7), 'too-early')
  assert.equal(decide(24 * 4), 'too-early')
  assert.equal(decide(72), 'too-early')
  assert.equal(decide(49), 'too-early')
})

test('creates inside the configured lead time', () => {
  assert.equal(decide(48), 'create')
  assert.equal(decide(36), 'create')
  assert.equal(decide(24), 'create')
})

test('still creates inside 24 hours as the safety fallback', () => {
  assert.equal(decide(1), 'create')
})

test('never creates a future match from stale provider data for an already-started fixture', () => {
  assert.equal(decide(-1, 'UPCOMING'), 'stale-upcoming')
})

test('still ingests fixtures that have genuinely started', () => {
  assert.equal(decide(-1, 'LIVE'), 'create')
  assert.equal(decide(-30, 'FINISHED'), 'create')
})

test('configured lead time is used, invalid values fall back, and the cap is enforced', () => {
  assert.equal(getMatchDiscoveryDays({} as NodeJS.ProcessEnv), 2)
  assert.equal(getMatchDiscoveryDays({ MATCH_DISCOVERY_DAYS: '5' } as NodeJS.ProcessEnv), 5)
  assert.equal(getMatchDiscoveryDays({ MATCH_DISCOVERY_DAYS: '0' } as NodeJS.ProcessEnv), 2)
  assert.equal(getMatchDiscoveryDays({ MATCH_DISCOVERY_DAYS: 'not-a-number' } as NodeJS.ProcessEnv), 2)
  assert.equal(getMatchDiscoveryDays({ MATCH_DISCOVERY_DAYS: '999' } as NodeJS.ProcessEnv), 14)
  assert.equal(getMatchDiscoveryWindowMs({ MATCH_DISCOVERY_DAYS: '2' } as NodeJS.ProcessEnv), 2 * DAY_MS)
})
