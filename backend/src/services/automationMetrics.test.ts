import assert from 'node:assert/strict'
import test from 'node:test'
import { AUTOMATION_METRICS_ACTIONS, summarizeAutomationMetrics } from './automationMetrics.js'

test('the automation metrics are the same numbers the per-status counts produced', () => {
  const metrics = summarizeAutomationMetrics({
    statusCounts: [
      { status: 'SUCCESS', count: 10 },
      { status: 'PARTIAL', count: 2 },
      { status: 'FAILED', count: 3 },
      { status: 'SKIPPED', count: 5 },
    ],
    recentActionCounts: [],
  })

  assert.equal(metrics.totalRuns, 20, 'every run counts towards the total')
  assert.equal(metrics.successfulRuns, 12, 'SUCCESS and PARTIAL are both successful runs')
  assert.equal(metrics.failedRuns, 3)
})

test('the 24 hour numbers are read from the action/status groups', () => {
  const metrics = summarizeAutomationMetrics({
    statusCounts: [],
    recentActionCounts: [
      { action: 'DISCOVER_MATCHES', status: 'SUCCESS', count: 4 },
      { action: 'DISCOVER_MATCHES', status: 'PARTIAL', count: 1 },
      { action: 'DISCOVER_MATCHES', status: 'FAILED', count: 2 },
      { action: 'VALIDATE_STREAMS', status: 'SUCCESS', count: 7 },
      { action: 'VALIDATE_STREAMS', status: 'FAILED', count: 1 },
      { action: 'CLEANUP', status: 'SUCCESS', count: 9 },
    ],
  })

  assert.equal(metrics.matchesCreatedLast24h, 5, 'a failed discovery did not create matches')
  assert.equal(metrics.streamsValidatedLast24h, 7, 'only a successful validation counts')
})

test('only the two reported actions are read, so the grouped query stays as narrow as the counts were', () => {
  assert.deepEqual([...AUTOMATION_METRICS_ACTIONS], ['DISCOVER_MATCHES', 'VALIDATE_STREAMS'])
})

test('an empty history reports zeros instead of failing', () => {
  assert.deepEqual(summarizeAutomationMetrics({ statusCounts: [], recentActionCounts: [] }), {
    totalRuns: 0,
    successfulRuns: 0,
    failedRuns: 0,
    matchesCreatedLast24h: 0,
    streamsValidatedLast24h: 0,
  })
})
