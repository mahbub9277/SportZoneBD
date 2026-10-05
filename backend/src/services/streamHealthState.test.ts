import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  STREAM_HEALTH_FAILURE_TTL_SECONDS,
  StreamHealthFailureMirror,
  classifyStreamHealthFailure,
  groupStreamHealthChanges,
  resolveStreamHealthPersistPlan,
  shouldClearFailureCounter,
  shouldResetFailureCounterBeforeIncrement,
} from './streamHealthState.js'

const THRESHOLD = 3

test('the failure counter keeps its 900 second product TTL', () => {
  assert.equal(STREAM_HEALTH_FAILURE_TTL_SECONDS, 900)
})

test('a cold mirror clears a possibly stale failure counter before counting a new failure', () => {
  // First failing cycle in this process: Redis may hold a counter from a previous process.
  assert.equal(shouldResetFailureCounterBeforeIncrement(false, false), true)
  // Already counted in this process: incrementing continues the same streak.
  assert.equal(shouldResetFailureCounterBeforeIncrement(false, true), false)
  // Healthy streams never touch the counter.
  assert.equal(shouldResetFailureCounterBeforeIncrement(true, false), false)
})

test('failures stay transient below the threshold and become an error at it', () => {
  assert.equal(classifyStreamHealthFailure(1, false, THRESHOLD), 'transient')
  assert.equal(classifyStreamHealthFailure(2, false, THRESHOLD), 'transient')
  assert.equal(classifyStreamHealthFailure(3, false, THRESHOLD), 'error')
  assert.equal(classifyStreamHealthFailure(4, false, THRESHOLD), 'error')
})

test('a stream that is already in the error state stays broken', () => {
  assert.equal(classifyStreamHealthFailure(1, true, THRESHOLD), 'error')
})

test('healthy streams only clear a counter the mirror knows about', () => {
  assert.equal(shouldClearFailureCounter(true, true), true)
  assert.equal(shouldClearFailureCounter(true, false), false, 'no DEL for a stream with no recorded failure')
  assert.equal(shouldClearFailureCounter(false, true), false)
})

test('an unchanged stream costs no database write', () => {
  assert.equal(resolveStreamHealthPersistPlan({
    currentStatus: 'LIVE', currentEnabled: true, nextStatus: 'LIVE', nextEnabled: true,
  }), null)
  assert.equal(resolveStreamHealthPersistPlan({
    currentStatus: 'ERROR', currentEnabled: false, nextStatus: 'ERROR', nextEnabled: false,
  }), null)
})

test('only a real status or enabled change is persisted', () => {
  assert.deepEqual(resolveStreamHealthPersistPlan({
    currentStatus: 'READY', currentEnabled: true, nextStatus: 'LIVE', nextEnabled: true,
  }), { status: 'LIVE', enabled: true })

  assert.deepEqual(resolveStreamHealthPersistPlan({
    currentStatus: 'LIVE', currentEnabled: true, nextStatus: 'ERROR', nextEnabled: false,
  }), { status: 'ERROR', enabled: false })

  assert.deepEqual(resolveStreamHealthPersistPlan({
    currentStatus: 'READY', currentEnabled: false, nextStatus: 'READY', nextEnabled: true,
  }), { status: 'READY', enabled: true })
})

test('changes are grouped so one updateMany covers every stream with the same target state', () => {
  const groups = groupStreamHealthChanges([
    { streamId: 'a', status: 'LIVE', enabled: true },
    { streamId: 'b', status: 'LIVE', enabled: true },
    { streamId: 'c', status: 'ERROR', enabled: false },
  ])

  assert.equal(groups.length, 2)
  const live = groups.find((group) => group.status === 'LIVE')
  assert.deepEqual(live?.streamIds, ['a', 'b'])
  const failed = groups.find((group) => group.status === 'ERROR')
  assert.deepEqual(failed?.streamIds, ['c'])
  assert.equal(groupStreamHealthChanges([]).length, 0)
})

test('the mirror reports whether a counter exists and forgets it when it is cleared', () => {
  const mirror = new StreamHealthFailureMirror()
  const now = Date.now()

  assert.equal(mirror.has('stream-1'), false)
  assert.equal(mirror.clear('stream-1'), false, 'clearing an unknown stream needs no Redis DEL')

  mirror.record('stream-1', now)
  assert.equal(mirror.has('stream-1'), true)
  assert.equal(mirror.size, 1)
  assert.equal(mirror.clear('stream-1'), true, 'a known counter is deleted from Redis and forgotten')
  assert.equal(mirror.has('stream-1'), false)
})

test('mirror entries age out together with the counter TTL', () => {
  const mirror = new StreamHealthFailureMirror()
  const now = Date.now()
  mirror.record('fresh', now)
  mirror.record('stale', now - (STREAM_HEALTH_FAILURE_TTL_SECONDS * 1000 + 1))

  assert.equal(mirror.pruneExpired(now, STREAM_HEALTH_FAILURE_TTL_SECONDS), 1)
  assert.equal(mirror.has('fresh'), true)
  assert.equal(mirror.has('stale'), false, 'an expired key is not remembered, so no DEL is issued')
})

test('recording again refreshes the age of a mirrored failure', () => {
  const mirror = new StreamHealthFailureMirror()
  const now = Date.now()
  mirror.record('stream-1', now - 800_000)
  mirror.record('stream-1', now)

  assert.equal(mirror.pruneExpired(now, STREAM_HEALTH_FAILURE_TTL_SECONDS), 0)
  assert.equal(mirror.has('stream-1'), true)
})
