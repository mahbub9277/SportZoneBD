import assert from 'node:assert/strict'
import { test } from 'node:test'
import { TelemetryHotState, shouldBroadcastTelemetrySummary, type HotTelemetrySession } from './telemetryHotState.js'

const RESOURCE = 'stream:abc|channel:|match:'
const OTHER_RESOURCE = 'stream:def|channel:|match:'

const healthySession = (resource = RESOURCE): HotTelemetrySession => ({
  hashState: 'HEALTHY',
  hashResource: resource,
  hashWrittenAt: Date.now(),
  memberState: 'HEALTHY',
  memberResource: resource,
})

test('a new healthy session counts once in the total and in its state', () => {
  const state = new TelemetryHotState()
  state.applyMembership(null, { state: 'HEALTHY', resource: RESOURCE })

  assert.deepEqual(state.countsSnapshot(), { total: 1, healthy: 1, buffering: 0, errors: 0 })
  assert.equal(state.resourceActiveViewers(RESOURCE), 1)
})

test('an unchanged membership does not change the counters', () => {
  const state = new TelemetryHotState()
  const membership = { state: 'HEALTHY' as const, resource: RESOURCE }
  state.applyMembership(null, membership)
  state.applyMembership(membership, membership)

  assert.deepEqual(state.countsSnapshot(), { total: 1, healthy: 1, buffering: 0, errors: 0 })
  assert.equal(state.resourceActiveViewers(RESOURCE), 1)
})

test('a state transition moves the session between the state counters', () => {
  const state = new TelemetryHotState()
  state.applyMembership(null, { state: 'HEALTHY', resource: RESOURCE })
  state.applyMembership({ state: 'HEALTHY', resource: RESOURCE }, { state: 'BUFFERING', resource: RESOURCE })

  assert.deepEqual(state.countsSnapshot(), { total: 1, healthy: 0, buffering: 1, errors: 0 })
  assert.equal(state.resourceActiveViewers(RESOURCE), 1)
})

test('switching resource keeps the same state for both resources', () => {
  const state = new TelemetryHotState()
  state.applyMembership(null, { state: 'HEALTHY', resource: RESOURCE })
  state.applyMembership({ state: 'HEALTHY', resource: RESOURCE }, { state: 'HEALTHY', resource: OTHER_RESOURCE })

  assert.deepEqual(state.countsSnapshot(), { total: 1, healthy: 1, buffering: 0, errors: 0 })
  assert.equal(state.resourceActiveViewers(RESOURCE), 0)
  assert.equal(state.resourceActiveViewers(OTHER_RESOURCE), 1)
})

test('ending a session removes it from the total, the state and the resource', () => {
  const state = new TelemetryHotState()
  state.applyMembership(null, { state: 'BUFFERING', resource: RESOURCE })
  state.applyMembership({ state: 'BUFFERING', resource: RESOURCE }, null)

  assert.deepEqual(state.countsSnapshot(), { total: 0, healthy: 0, buffering: 0, errors: 0 })
  assert.equal(state.resourceActiveViewers(RESOURCE), 0)
})

test('an ended session that starts again is counted once', () => {
  const state = new TelemetryHotState()
  state.applyMembership(null, { state: 'HEALTHY', resource: RESOURCE })
  state.applyMembership({ state: 'HEALTHY', resource: RESOURCE }, null)
  state.applyMembership(null, { state: 'HEALTHY', resource: RESOURCE })

  assert.deepEqual(state.countsSnapshot(), { total: 1, healthy: 1, buffering: 0, errors: 0 })
})

test('a reconcile replaces the counters with the authoritative values', () => {
  const state = new TelemetryHotState()
  state.applyMembership(null, { state: 'HEALTHY', resource: RESOURCE })
  state.reconcileCounts({ total: 7, healthy: 5, buffering: 1, errors: 1 })

  assert.deepEqual(state.countsSnapshot(), { total: 7, healthy: 5, buffering: 1, errors: 1 })
})

test('counters never go negative after a cold reconcile with live transitions', () => {
  const state = new TelemetryHotState()
  state.reconcileCounts({ total: 0, healthy: 0, buffering: 0, errors: 0 })
  state.applyMembership({ state: 'HEALTHY', resource: RESOURCE }, { state: 'ERROR', resource: RESOURCE })

  assert.deepEqual(state.countsSnapshot(), { total: 0, healthy: 0, buffering: 0, errors: 1 })
})

test('minute samples accumulate into one bucket and roll over with the minute', () => {
  const state = new TelemetryHotState()
  const snapshot = { total: 3, healthy: 2, buffering: 1, errors: 0 }
  const minute = Math.floor(Date.now() / 60_000) * 60_000

  state.addBucketSample(snapshot, minute + 1000)
  state.addBucketSample(snapshot, minute + 2000)
  assert.deepEqual(state.takeBuckets(false), [], 'the in-flight minute is not flushed on its own')

  state.addBucketSample(snapshot, minute + 61_000)
  const finished = state.takeBuckets(false)
  assert.equal(finished.length, 1)
  assert.equal(finished[0].minute, minute)
  assert.deepEqual(finished[0].deltas, {
    activeViewers: 6,
    healthyViewers: 4,
    bufferingViewers: 2,
    errorViewers: 0,
    samples: 2,
  })
})

test('flushing the current minute hands it over without losing later samples', () => {
  const state = new TelemetryHotState()
  const snapshot = { total: 1, healthy: 1, buffering: 0, errors: 0 }
  const minute = Math.floor(Date.now() / 60_000) * 60_000

  state.addBucketSample(snapshot, minute + 1000)
  const flushed = state.takeBuckets(true)
  assert.equal(flushed.length, 1)
  assert.deepEqual(state.takeBuckets(true), [], 'nothing is left to flush')

  // A later sample in the same minute starts a fresh delta, which sums into the same Redis key.
  state.addBucketSample(snapshot, minute + 2000)
  const next = state.takeBuckets(true)
  assert.equal(next.length, 1)
  assert.equal(next[0].deltas.activeViewers, 1)
})

test('a failed flush can put its buckets back', () => {
  const state = new TelemetryHotState()
  const snapshot = { total: 2, healthy: 2, buffering: 0, errors: 0 }
  const minute = Math.floor(Date.now() / 60_000) * 60_000
  state.addBucketSample(snapshot, minute)
  state.addBucketSample(snapshot, minute + 61_000)

  const buckets = state.takeBuckets(false)
  assert.equal(buckets.length, 1)
  state.restoreBuckets(buckets)
  assert.equal(state.takeBuckets(false)[0].deltas.activeViewers, 2)
})

test('error counters aggregate per resource and drain as batches', () => {
  const state = new TelemetryHotState()
  state.recordCounter(RESOURCE, 'stalled', 1)
  state.recordCounter(RESOURCE, 'stalled', 1)
  state.recordCounter(RESOURCE, 'network_error', 1)
  state.recordCounter(OTHER_RESOURCE, 'fatal_error', 1)

  const batches = state.takeCounterDeltas()
  assert.equal(batches.length, 2)
  const first = batches.find((batch) => batch.resource === RESOURCE)
  assert.deepEqual(Object.fromEntries(first?.fields ?? []), { stalled: 2, network_error: 1 })
  assert.deepEqual(state.takeCounterDeltas(), [], 'draining clears the pending increments')

  // The cumulative counters survive the drain, because the summary reads them. Only error-flavoured
  // fields form the error count, which is the rule the admin table already used.
  assert.deepEqual(state.errorCounterSnapshot(50).map((entry) => [entry.resource, entry.errorCount]), [
    [RESOURCE, 1],
    [OTHER_RESOURCE, 1],
  ])
})

test('counters put back after a failed flush are not lost', () => {
  const state = new TelemetryHotState()
  state.recordCounter(RESOURCE, 'stalled', 2)
  const batches = state.takeCounterDeltas()
  state.restoreCounterDeltas(batches)

  assert.deepEqual(Object.fromEntries(state.takeCounterDeltas()[0].fields), { stalled: 2 })
})

test('reconciling a resource keeps the increments that are still pending', () => {
  const state = new TelemetryHotState()
  state.recordCounter(RESOURCE, 'media_error', 2)
  state.reconcileResource(RESOURCE, { HEALTHY: 4, BUFFERING: 0, ERROR: 1 }, { media_error: 10, fatal_error: 1 })

  const entries = state.errorCounterSnapshot(50)
  assert.equal(entries[0].counter.media_error, 12, 'authoritative Redis value plus the unflushed increment')
  assert.equal(entries[0].errorCount, 13)
  assert.equal(state.resourceActiveViewers(RESOURCE), 5)
})

test('error snapshots are ordered deterministically so an unchanged summary compares equal', () => {
  const state = new TelemetryHotState()
  state.recordCounter(RESOURCE, 'stalled', 1)
  state.recordCounter(OTHER_RESOURCE, 'stalled', 1)

  const first = state.errorCounterSnapshot(50).map((entry) => entry.resource)
  const second = state.errorCounterSnapshot(50).map((entry) => entry.resource)
  assert.deepEqual(first, second)
  assert.deepEqual(first, [...first].sort((left, right) => left.localeCompare(right)))
})

test('resources are only refreshed after the refresh window, not on every event', () => {
  const state = new TelemetryHotState()
  const now = Date.now()

  assert.equal(state.touchResource(RESOURCE, now, 60_000), true, 'first sighting writes the registry score')
  assert.equal(state.touchResource(RESOURCE, now + 1_000, 60_000), false, 'a later event is free')
  assert.equal(state.touchResource(RESOURCE, now + 61_000, 60_000), true, 'the score is refreshed once per window')
  assert.equal(state.listTrackedResources(10)[0], RESOURCE)
})

test('sessions age out of the mirror once their Redis hash has expired', () => {
  const state = new TelemetryHotState()
  const now = Date.now()
  state.rememberSession('fresh', { ...healthySession(), hashWrittenAt: now })
  state.rememberSession('expired', { ...healthySession(), hashWrittenAt: now - 181_000 })

  assert.equal(state.pruneSessions(now, 180_000), 1)
  assert.ok(state.getSession('fresh'))
  assert.equal(state.getSession('expired'), undefined)
})

test('forgetting and re-remembering a session survives a cold start', () => {
  const state = new TelemetryHotState()
  state.rememberSession('session-1', healthySession())
  assert.equal(state.getSession('session-1')?.hashState, 'HEALTHY')

  // A restart empties the mirror; the next event reads Redis and repopulates it.
  state.forgetSession('session-1')
  assert.equal(state.getSession('session-1'), undefined)
  state.rememberSession('session-1', { ...healthySession(), memberState: null, memberResource: null })
  assert.equal(state.getSession('session-1')?.memberState, null)
})

test('a summary is only broadcast when its payload actually changed', () => {
  const summary = { totalActiveViewers: 4, healthyViewers: 4, bufferingViewers: 0, errorViewers: 0, healthPercentage: 100, bufferingPercentage: 0, topErroredStreams: [] }

  assert.equal(shouldBroadcastTelemetrySummary(null, summary), true, 'the first summary is always sent')
  const signature = JSON.stringify(summary)
  assert.equal(shouldBroadcastTelemetrySummary(signature, { ...summary }), false, 'an identical payload is not re-broadcast')
  assert.equal(shouldBroadcastTelemetrySummary(signature, { ...summary, bufferingViewers: 1 }), true)
  assert.equal(shouldBroadcastTelemetrySummary(signature, { ...summary, topErroredStreams: [{ resource: 'a', errorCount: 1, activeViewers: 1, counters: {} }] }), true)
})

test('a bucket is only queued for a flush once its minute has completed', () => {
  const state = new TelemetryHotState()
  const snapshot = { total: 1, healthy: 1, buffering: 0, errors: 0 }
  const minute = Math.floor(Date.now() / 60_000) * 60_000

  state.addBucketSample(snapshot, minute + 1000)
  assert.equal(state.pendingBucketCount, 0, 'inside a minute nothing needs writing')

  state.addBucketSample(snapshot, minute + 61_000)
  assert.equal(state.pendingBucketCount, 1, 'the completed minute is flushed on the next opportunity')
  state.takeBuckets(false)
  assert.equal(state.pendingBucketCount, 0)
})
