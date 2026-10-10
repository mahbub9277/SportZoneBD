/**
 * Batched telemetry reads and writes.
 *
 * The telemetry runtime is the one place in the backend that reads many small keys on a schedule, and every
 * one of those reads used to be its own Redis command: reconciling 25 tracked resources cost 100 commands a
 * minute and building the clustered summary cost one command per resource, every twenty seconds. Both are
 * the same shape of work — read (or increment) a list of keys — so they are expressed here as a single
 * script call per cycle.
 *
 * Everything in this module is pure: the key list, the argument list and the reply parser can be asserted
 * without a Redis connection, which is what keeps "one command per cycle" a property of the code rather
 * than a claim about it.
 */

export type TelemetryReadOp = 'hash' | 'zcount' | 'zrevrange'

/**
 * The three live-viewer states that get counted. A caller may name states with a wider union — a function
 * accepting more states than this is still assignable here — so the planners never need the full union.
 */
export type TelemetryStateName = 'HEALTHY' | 'BUFFERING' | 'ERROR'

export interface TelemetryReadRequest {
  key: string
  op: TelemetryReadOp
  /** Only for `zrevrange`: the inclusive end index (0-based). */
  stop?: number
}

/**
 * Reads every requested key in one round trip.
 *
 * `ARGV[1]` is the clock the score bounds are compared against, so every `ZCOUNT` in a batch uses exactly
 * the same instant — the same guarantee the individual reads had, minus the drift between them. Each
 * request contributes two arguments (`op`, then `stop` or `0`), so request `i` reads `ARGV[i * 2]` and
 * `ARGV[i * 2 + 1]`.
 */
export const TELEMETRY_BATCH_READ_SCRIPT = `
local now = tonumber(ARGV[1])
local result = {}
for i = 1, #KEYS do
  local op = ARGV[i * 2]
  if op == 'hash' then
    result[i] = redis.call('HGETALL', KEYS[i])
  elseif op == 'zrevrange' then
    result[i] = redis.call('ZREVRANGE', KEYS[i], 0, tonumber(ARGV[i * 2 + 1]))
  else
    result[i] = redis.call('ZCOUNT', KEYS[i], now, '+inf')
  end
end
return result
`

export type TelemetryWriteOp =
  | { kind: 'hincrby'; key: string; field: string; amount: number }
  | { kind: 'expire'; key: string; seconds: number }
  | { kind: 'pruneExpired'; key: string; now: number }

/**
 * Applies every buffered increment, expiry and trim in one round trip.
 *
 * The increments are passed as amounts and applied with `HINCRBY`, so a batch of samples for the same
 * bucket still lands as one summed value exactly as the individual calls did.
 */
export const TELEMETRY_BATCH_WRITE_SCRIPT = `
local result = {}
for i = 1, #KEYS do
  local op = ARGV[i * 3 - 2]
  if op == 'hincrby' then
    result[i] = redis.call('HINCRBY', KEYS[i], ARGV[i * 3 - 1], tonumber(ARGV[i * 3]))
  elseif op == 'pruneExpired' then
    result[i] = redis.call('ZREMRANGEBYSCORE', KEYS[i], tonumber(ARGV[i * 3 - 1]), tonumber(ARGV[i * 3]))
  else
    result[i] = redis.call('EXPIRE', KEYS[i], tonumber(ARGV[i * 3 - 1]))
  end
end
return result
`

export interface TelemetryBatchCommand {
  /** Keys, in the order the script must visit them. */
  keys: string[]
  /** Arguments that follow the key list. */
  args: Array<string | number>
}

/** The exact `EVAL` arguments for a read batch. One script call covers the whole list. */
export function buildTelemetryReadBatch(now: number, requests: readonly TelemetryReadRequest[]): TelemetryBatchCommand {
  const keys = requests.map((request) => request.key)
  const args: Array<string | number> = [now]

  for (const request of requests) {
    args.push(request.op)
    // Only the range read consumes a second argument; the others leave the slot unused.
    args.push(request.op === 'zrevrange' ? Math.max(0, Math.floor(request.stop ?? 0)) : 0)
  }

  return { keys, args }
}

/** The exact `EVAL` arguments for a write batch. */
export function buildTelemetryWriteBatch(operations: readonly TelemetryWriteOp[]): TelemetryBatchCommand {
  const keys: string[] = []
  const args: Array<string | number> = []

  for (const operation of operations) {
    keys.push(operation.key)
    if (operation.kind === 'hincrby') {
      args.push('hincrby', operation.field, Math.trunc(operation.amount))
    } else if (operation.kind === 'pruneExpired') {
      args.push('pruneExpired', 0, Math.trunc(operation.now))
    } else {
      args.push('expire', Math.max(0, Math.trunc(operation.seconds)), 0)
    }
  }

  return { keys, args }
}

/** A flat Redis hash reply as an object, ignoring an odd trailing element. */
function hashFromFlatReply(reply: unknown): Record<string, string> {
  if (!Array.isArray(reply)) return {}
  const values: Record<string, string> = {}
  for (let index = 0; index + 1 < reply.length; index += 2) {
    const field = reply[index]
    const value = reply[index + 1]
    if (typeof field === 'string' && (typeof value === 'string' || typeof value === 'number')) {
      values[field] = String(value)
    }
  }
  return values
}

export type TelemetryReadValue = Record<string, string> | number | string[]

/**
 * Turns a batch reply into values in the order they were requested.
 *
 * A reply that is shorter than the request list (or missing entirely) yields the empty value for that
 * operation instead of shifting every later value, so one odd reply cannot corrupt the counts that follow.
 */
export function parseTelemetryReadBatch(
  reply: unknown,
  requests: readonly TelemetryReadRequest[],
): TelemetryReadValue[] {
  const rows = Array.isArray(reply) ? reply : []

  return requests.map((request, index) => {
    const value = rows[index]
    if (request.op === 'hash') return hashFromFlatReply(value)
    if (request.op === 'zrevrange') {
      return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []
    }
    const count = Number(value)
    return Number.isFinite(count) ? Math.max(0, count) : 0
  })
}

/**
 * The reads that describe one resource: its counter hash and its three live score bounds.
 *
 * The order is part of the contract — the caller reads the values back by position — so it is defined once
 * here, and both the reconcile cycle and the clustered summary use it. Either way the whole list is one
 * script call, so describing twenty-five resources costs one command instead of a hundred.
 */
export function planResourceReads(
  resources: readonly string[],
  counterKeyOf: (resource: string) => string,
  resourceKeyOf: (resource: string, state: TelemetryStateName) => string,
): TelemetryReadRequest[] {
  return resources.flatMap((resource) => [
    { key: counterKeyOf(resource), op: 'hash' as const },
    { key: resourceKeyOf(resource, 'HEALTHY'), op: 'zcount' as const },
    { key: resourceKeyOf(resource, 'BUFFERING'), op: 'zcount' as const },
    { key: resourceKeyOf(resource, 'ERROR'), op: 'zcount' as const },
  ])
}

/** The four live viewer counts of the whole platform, read in the same batch as everything else. */
export function planStateCountReads(
  activeKey: string,
  stateKeyOf: (state: TelemetryStateName) => string,
): TelemetryReadRequest[] {
  return [
    { key: activeKey, op: 'zcount' },
    { key: stateKeyOf('HEALTHY'), op: 'zcount' },
    { key: stateKeyOf('BUFFERING'), op: 'zcount' },
    { key: stateKeyOf('ERROR'), op: 'zcount' },
  ]
}
