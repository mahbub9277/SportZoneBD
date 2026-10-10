import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  buildTelemetryReadBatch,
  buildTelemetryWriteBatch,
  parseTelemetryReadBatch,
  planResourceReads,
  planStateCountReads,
  type TelemetryWriteOp,
} from './telemetryBatch.js'

const ACTIVE_KEY = 'sportzone:telemetry:active'
const stateKey = (state: string) => `sportzone:telemetry:state:${state}`
const counterKey = (resource: string) => `sportzone:telemetry:counter:${resource}`
const resourceKey = (resource: string, state: string) => `sportzone:telemetry:live:${state}:${resource}`

const resource = (id: string) => `stream:${id}|channel:|match:`

// ------------------------------------------------------------------ read planning

test('the four platform counts are one batch in a fixed order', () => {
  const requests = planStateCountReads(ACTIVE_KEY, stateKey)

  assert.deepEqual(requests, [
    { key: ACTIVE_KEY, op: 'zcount' },
    { key: stateKey('HEALTHY'), op: 'zcount' },
    { key: stateKey('BUFFERING'), op: 'zcount' },
    { key: stateKey('ERROR'), op: 'zcount' },
  ])
})

test('one resource is described by its counter hash and its three state counts', () => {
  const requests = planResourceReads([resource('a')], counterKey, resourceKey)

  assert.deepEqual(requests, [
    { key: counterKey(resource('a')), op: 'hash' },
    { key: resourceKey(resource('a'), 'HEALTHY'), op: 'zcount' },
    { key: resourceKey(resource('a'), 'BUFFERING'), op: 'zcount' },
    { key: resourceKey(resource('a'), 'ERROR'), op: 'zcount' },
  ])
})

test('twenty-five resources stay one batch of reads', () => {
  const resources = Array.from({ length: 25 }, (_, index) => resource(String(index)))
  const requests = planResourceReads(resources, counterKey, resourceKey)

  // The property that matters: the whole cycle is a single script call, not one call per resource.
  assert.equal(requests.length, 100)
  assert.equal(buildTelemetryReadBatch(1, requests).keys.length, 100)
})

test('the read batch passes one clock to the script and a second argument only to the range read', () => {
  const requests = [
    { key: ACTIVE_KEY, op: 'zcount' as const },
    { key: 'sportzone:telemetry:resources', op: 'zrevrange' as const, stop: 24 },
    { key: counterKey(resource('a')), op: 'hash' as const },
  ]

  const { keys, args } = buildTelemetryReadBatch(1_700_000_000_000, requests)

  assert.deepEqual(keys, [ACTIVE_KEY, 'sportzone:telemetry:resources', counterKey(resource('a'))])
  assert.deepEqual(args, [1_700_000_000_000, 'zcount', 0, 'zrevrange', 24, 'hash', 0])
})

test('a missing range stop reads from index zero instead of failing', () => {
  const { args } = buildTelemetryReadBatch(5, [{ key: 'k', op: 'zrevrange' }])

  assert.deepEqual(args, [5, 'zrevrange', 0])
})

// ------------------------------------------------------------------ read parsing

test('a flat hash reply becomes an object and counts stay numbers', () => {
  const requests = [
    { key: counterKey(resource('a')), op: 'hash' as const },
    { key: ACTIVE_KEY, op: 'zcount' as const },
    { key: 'sportzone:telemetry:resources', op: 'zrevrange' as const, stop: 24 },
  ]
  const values = parseTelemetryReadBatch(
    [['player_end_events', '2', 'error_events', '1'], 7, [resource('a'), resource('b')]],
    requests,
  )

  assert.deepEqual(values, [
    { player_end_events: '2', error_events: '1' },
    7,
    [resource('a'), resource('b')],
  ])
})

test('a short or empty reply yields empty values in the requested order', () => {
  const requests = [
    { key: counterKey(resource('a')), op: 'hash' as const },
    { key: ACTIVE_KEY, op: 'zcount' as const },
    { key: 'sportzone:telemetry:resources', op: 'zrevrange' as const, stop: 24 },
  ]

  assert.deepEqual(parseTelemetryReadBatch(null, requests), [{}, 0, []])
  assert.deepEqual(parseTelemetryReadBatch([['f']], requests), [{}, 0, []])
  assert.deepEqual(parseTelemetryReadBatch([{ unexpected: true }, null, 'not-a-list'], requests), [{}, 0, []])
})

test('an odd hash reply drops its dangling element instead of inventing a field', () => {
  const requests = [{ key: counterKey(resource('a')), op: 'hash' as const }]

  assert.deepEqual(parseTelemetryReadBatch([['field', '1', 'orphan']], requests), [{ field: '1' }])
})

// ------------------------------------------------------------------ write planning

test('increments carry their field and amount in triples', () => {
  const operations: TelemetryWriteOp[] = [
    { kind: 'hincrby', key: 'bucket', field: 'activeViewers', amount: 3 },
    { kind: 'expire', key: 'bucket', seconds: 900 },
  ]

  const { keys, args } = buildTelemetryWriteBatch(operations)

  assert.deepEqual(keys, ['bucket', 'bucket'])
  assert.deepEqual(args, ['hincrby', 'activeViewers', 3, 'expire', 900, 0])
})

test('a trim passes its own bounds and a negative increment is preserved', () => {
  const operations: TelemetryWriteOp[] = [
    { kind: 'pruneExpired', key: ACTIVE_KEY, now: 1_700_000_000_000 },
    { kind: 'hincrby', key: 'counter', field: 'error_events', amount: -2 },
  ]

  const { keys, args } = buildTelemetryWriteBatch(operations)

  assert.deepEqual(keys, [ACTIVE_KEY, 'counter'])
  assert.deepEqual(args, ['pruneExpired', 0, 1_700_000_000_000, 'hincrby', 'error_events', -2])
})

test('a whole flush of buckets and counters stays one batch of writes', () => {
  const operations: TelemetryWriteOp[] = []
  for (let bucket = 0; bucket < 3; bucket += 1) {
    for (const field of ['activeViewers', 'healthyViewers', 'bufferingViewers', 'errorViewers']) {
      operations.push({ kind: 'hincrby', key: `sportzone:telemetry:bucket:${bucket}`, field, amount: 1 })
    }
    operations.push({ kind: 'expire', key: `sportzone:telemetry:bucket:${bucket}`, seconds: 172_800 })
  }
  for (let index = 0; index < 25; index += 1) {
    operations.push({ kind: 'hincrby', key: counterKey(resource(String(index))), field: 'player_end_events', amount: 1 })
    operations.push({ kind: 'expire', key: counterKey(resource(String(index))), seconds: 172_800 })
  }

  const { keys, args } = buildTelemetryWriteBatch(operations)

  assert.equal(keys.length, operations.length)
  assert.equal(args.length, operations.length * 3)
})

test('fractional increments are truncated to the integers Redis stores', () => {
  const { args } = buildTelemetryWriteBatch([{ kind: 'hincrby', key: 'counter', field: 'f', amount: 2.7 }])

  assert.deepEqual(args, ['hincrby', 'f', 2])
})
