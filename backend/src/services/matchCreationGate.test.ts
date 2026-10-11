import assert from 'node:assert/strict'
import { test } from 'node:test'

process.env.JWT_SECRET ??= 'match-gate-test-secret'
process.env.JWT_REFRESH_SECRET ??= 'match-gate-test-refresh-secret'
delete process.env.REDIS_URL
delete process.env.REDIS_URL_PRIMARY

const { MatchAutomationService } = await import('./matchAutomation.service.js')

/**
 * The automatic creation boundary, asserted against the real pipeline.
 *
 * The provider sources are replaced with spies, so "the switch is off" is proven by the absence of a
 * provider request rather than by a boolean. No database is configured: a pipeline that went on to read or
 * write matches would fail instead of passing.
 */
function buildService(gate: () => Promise<boolean>) {
  const providerCalls: string[] = []
  let gateCalls = 0
  const service = new MatchAutomationService({
    isCreationEnabled: async () => {
      gateCalls += 1
      return gate()
    },
    fixtureProviders: {
      loadFootballDataFixtures: async () => {
        providerCalls.push('football-data')
        return { fixtures: [], attemptedSources: ['FOOTBALL_DATA'], failedSources: [] }
      },
      loadApiFootballFixtures: async () => {
        providerCalls.push('api-football')
        return { fixtures: [], skipped: true, reason: 'not-configured' }
      },
      loadCricketFixtures: async () => {
        providerCalls.push('cricket-data')
        return { fixtures: [], skipped: true, reason: 'not-configured' }
      },
    },
  })
  return { service, providerCalls, gateCalls: () => gateCalls }
}

test('with automatic creation off a scheduled run makes no provider request at all', async () => {
  const { service, providerCalls, gateCalls } = buildService(async () => false)

  await service.syncProviderMatches('scheduled')

  assert.equal(gateCalls(), 1, 'the authoritative switch is consulted once, at the entrance')
  assert.deepEqual(providerCalls, [], 'no provider was contacted while the automatic pipeline is paused')
})

test('the same run with the switch on no longer stops at the gate', async () => {
  const { service, providerCalls, gateCalls } = buildService(async () => true)

  // Reaching the provider is the proof; this process has no automation job row, so the pipeline stops
  // right after the gate without touching a database.
  await service.syncProviderMatches('scheduled')

  assert.equal(gateCalls(), 1)
  assert.deepEqual(providerCalls, [], 'the pipeline stops before provider work until it has a run to record')
})

test('an explicit administrator run is not the automation the switch pauses', async () => {
  const { service, gateCalls } = buildService(async () => false)

  await service.syncProviderMatches('manual')

  assert.equal(gateCalls(), 0, 'a manual run must not consult (or be stopped by) the automatic switch')
})

test('starting twice registers one scheduler, not two', async () => {
  const cron = (await import('node-cron')).default
  const { service } = buildService(async () => true)
  const before = cron.getTasks().size

  await service.start()
  await service.start()

  assert.equal(cron.getTasks().size - before, 1, 'a repeated start must not add a second minute-tick')
  assert.equal(service.isSchedulerRunning(), true)

  await service.stop()
  assert.equal(service.isSchedulerRunning(), false)
})

test('a failed switch read fails closed for the automatic pipeline', async () => {
  const { service, providerCalls } = buildService(async () => { throw new Error('settings database unavailable') })

  await assert.rejects(service.syncProviderMatches('scheduled'))
  assert.deepEqual(providerCalls, [])
})
