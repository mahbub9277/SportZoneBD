import assert from 'node:assert/strict'
import { test } from 'node:test'

process.env.JWT_SECRET ??= 'automation-retention-test-secret'
process.env.JWT_REFRESH_SECRET ??= 'automation-retention-test-refresh-secret'

const {
  AUTOMATION_LOG_RETENTION_BATCH_SIZE,
  AUTOMATION_LOG_RETENTION_DAYS,
  AUTOMATION_LOG_RETENTION_MAX_PER_REQUEST,
  isAutomationLogCleanupRunning,
  pruneAutomationLogs,
  resolveAutomationLogRetentionCutoff,
} = await import('./automationLogRetention.js')

type AutomationLogRetentionStore = import('./automationLogRetention.js').AutomationLogRetentionStore

const DAY_MS = 24 * 60 * 60 * 1000
const NOW = new Date('2026-10-18T12:00:00.000Z')

interface FakeRow {
  id: string
  createdAt: Date
  status?: 'SUCCESS' | 'FAILED' | 'PARTIAL' | 'RUNNING'
}

interface FakeCalls {
  findMany: Array<Record<string, unknown>>
  deleteMany: Array<Record<string, unknown>>
  count: Array<Record<string, unknown>>
}

/**
 * An in-memory stand-in for the `automationLog` delegate that follows the same rules as Postgres/Prisma: a
 * strict `createdAt < cutoff` filter, oldest-first ordering, `take`, and a delete that only removes the ids
 * that still match the predicate.
 */
function createStore(rows: FakeRow[], options: { failOnDeleteBatch?: number } = {}) {
  const state = rows.map((row) => ({ ...row }))
  const calls: FakeCalls = { findMany: [], deleteMany: [], count: [] }

  const matches = (row: FakeRow, where: Record<string, unknown>) => {
    if ('status' in where) throw new Error('the retention query must never filter by status')
    const cutoff = (where.createdAt as { lt?: Date } | undefined)?.lt
    if (cutoff && !(row.createdAt.getTime() < cutoff.getTime())) return false
    const ids = (where.id as { in?: string[] } | undefined)?.in
    if (ids && !ids.includes(row.id)) return false
    return true
  }

  const store: AutomationLogRetentionStore = {
    async findMany(args) {
      calls.findMany.push(args as unknown as Record<string, unknown>)
      const where = args.where as Record<string, unknown>
      return state
        .filter((row) => matches(row, where))
        .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime() || left.id.localeCompare(right.id))
        .slice(0, args.take)
        .map((row) => ({ id: row.id }))
    },
    async deleteMany(args) {
      calls.deleteMany.push(args as unknown as Record<string, unknown>)
      if (options.failOnDeleteBatch !== undefined && calls.deleteMany.length === options.failOnDeleteBatch) {
        throw new Error('connection terminated unexpectedly')
      }
      const where = args.where as Record<string, unknown>
      const doomed = state.filter((row) => matches(row, where))
      for (const row of doomed) state.splice(state.indexOf(row), 1)
      return { count: doomed.length }
    },
    async count(args) {
      calls.count.push((args ?? {}) as Record<string, unknown>)
      const where = ((args ?? {}).where ?? {}) as Record<string, unknown>
      return state.filter((row) => matches(row, where)).length
    },
  }

  return { store, calls, rows: state }
}

const daysAgo = (days: number) => new Date(NOW.getTime() - days * DAY_MS)

test('the cutoff is exactly 30 days before the request time', () => {
  assert.equal(AUTOMATION_LOG_RETENTION_DAYS, 30)
  assert.equal(resolveAutomationLogRetentionCutoff(NOW).toISOString(), '2026-09-18T12:00:00.000Z')
  // A fixed input always produces the same boundary: one cutoff per request, never a moving one.
  assert.equal(resolveAutomationLogRetentionCutoff(NOW).getTime(), resolveAutomationLogRetentionCutoff(NOW).getTime())
})

test('a log exactly on the cutoff is kept, and only strictly older rows are deleted', async () => {
  const { store, calls } = createStore([
    { id: 'exactly-on-cutoff', createdAt: resolveAutomationLogRetentionCutoff(NOW) },
    { id: 'one-ms-older', createdAt: new Date(resolveAutomationLogRetentionCutoff(NOW).getTime() - 1) },
    { id: 'brand-new', createdAt: NOW },
  ])

  const outcome = await pruneAutomationLogs({ now: NOW, store })

  assert.equal(outcome.ok, true)
  assert.equal(outcome.deletedCount, 1)
  assert.equal(outcome.complete, true)
  assert.equal(outcome.cutoff, '2026-09-18T12:00:00.000Z')

  const predicate = calls.findMany[0].where as { createdAt: { lt?: Date; lte?: Date } }
  assert.ok(predicate.createdAt.lt instanceof Date, 'the comparison must be `< cutoff`')
  assert.equal(predicate.createdAt.lte, undefined, 'an inclusive comparison would delete the boundary row')

  const deletePredicate = calls.deleteMany[0].where as { createdAt: { lt?: Date; lte?: Date } }
  assert.ok(deletePredicate.createdAt.lt instanceof Date, 'the delete repeats the same strict predicate')
  assert.equal(deletePredicate.createdAt.lte, undefined)
})

test('recent logs are never deleted, whatever their status', async () => {
  const { store, rows } = createStore([
    { id: 'recent-success', createdAt: daysAgo(1), status: 'SUCCESS' },
    { id: 'recent-failed', createdAt: daysAgo(29), status: 'FAILED' },
    { id: 'recent-partial', createdAt: daysAgo(2), status: 'PARTIAL' },
    { id: 'recent-running', createdAt: NOW, status: 'RUNNING' },
  ])

  const outcome = await pruneAutomationLogs({ now: NOW, store })

  assert.equal(outcome.deletedCount, 0)
  assert.equal(outcome.remainingCount, 0)
  assert.equal(outcome.complete, true)
  assert.deepEqual(rows.map((row) => row.id).sort(), ['recent-failed', 'recent-partial', 'recent-running', 'recent-success'])
})

test('every status older than the window follows the same policy', async () => {
  const { store, rows } = createStore([
    { id: 'old-success', createdAt: daysAgo(31), status: 'SUCCESS' },
    { id: 'old-failed', createdAt: daysAgo(45), status: 'FAILED' },
    { id: 'old-partial', createdAt: daysAgo(60), status: 'PARTIAL' },
    { id: 'old-running', createdAt: daysAgo(90), status: 'RUNNING' },
    { id: 'recent-failed', createdAt: daysAgo(3), status: 'FAILED' },
  ])

  const outcome = await pruneAutomationLogs({ now: NOW, store })

  assert.equal(outcome.deletedCount, 4, 'FAILED and PARTIAL logs are not exempt from retention')
  assert.deepEqual(rows.map((row) => row.id), ['recent-failed'])
})

test('a backlog larger than one batch is drained in bounded batches, oldest first', async () => {
  const rows = Array.from({ length: 12 }, (_, index) => ({
    id: `old-${String(index).padStart(2, '0')}`,
    createdAt: daysAgo(31 + index),
  }))
  const { store, calls } = createStore(rows)

  const outcome = await pruneAutomationLogs({ now: NOW, store, batchSize: 5 })

  assert.equal(outcome.batchSize, 5)
  assert.equal(outcome.deletedCount, 12)
  assert.equal(outcome.batches, 3, 'no delete statement carried more than one batch')
  assert.equal(outcome.remainingCount, 0)
  assert.equal(outcome.complete, true)
  assert.deepEqual(calls.deleteMany.map((call) => (call.where as { id: { in: string[] } }).id.in.length), [5, 5, 2])

  const selected = (calls.deleteMany[0].where as { id: { in: string[] } }).id.in
  assert.deepEqual(selected, ['old-11', 'old-10', 'old-09', 'old-08', 'old-07'], 'the oldest rows go first')
})

test('the per-request ceiling bounds the total work and is never exceeded', async () => {
  const rows = Array.from({ length: 40 }, (_, index) => ({ id: `old-${index}`, createdAt: daysAgo(31 + index) }))
  const { store, calls } = createStore(rows)

  const outcome = await pruneAutomationLogs({ now: NOW, store, batchSize: 5, maxPerRequest: 12 })

  assert.ok(outcome.deletedCount <= 12, `a request must not delete more than its ceiling (got ${outcome.deletedCount})`)
  assert.equal(outcome.deletedCount, 12)
  assert.equal(outcome.maxPerRequest, 12)
  assert.equal(outcome.batches, 3)
  assert.equal(outcome.remainingCount, 28)
  assert.equal(outcome.complete, false)
  assert.equal(calls.deleteMany.length, 3)
})

test('the ceiling cannot be raised above the built-in maximum', async () => {
  const { store } = createStore([{ id: 'old', createdAt: daysAgo(31) }])

  const outcome = await pruneAutomationLogs({ now: NOW, store, maxPerRequest: 10_000_000 })

  assert.equal(outcome.maxPerRequest, AUTOMATION_LOG_RETENTION_MAX_PER_REQUEST)
})

test('the defaults are the documented 5,000-row batch and 50,000-row ceiling', () => {
  assert.equal(AUTOMATION_LOG_RETENTION_BATCH_SIZE, 5_000)
  assert.equal(AUTOMATION_LOG_RETENTION_MAX_PER_REQUEST, 50_000)
})

test('a second run after a completed cleanup deletes nothing and still succeeds', async () => {
  const { store } = createStore([
    { id: 'old', createdAt: daysAgo(40) },
    { id: 'recent', createdAt: daysAgo(2) },
  ])

  const first = await pruneAutomationLogs({ now: NOW, store })
  assert.equal(first.ok, true)
  assert.equal(first.deletedCount, 1)
  assert.equal(first.complete, true)

  // The same click, again: zero eligible records is a normal outcome, not an error.
  const second = await pruneAutomationLogs({ now: NOW, store })
  assert.equal(second.ok, true)
  assert.equal(second.deletedCount, 0)
  assert.equal(second.remainingCount, 0)
  assert.equal(second.complete, true)
})

test('a failure part-way through reports what was deleted and never claims completion', async () => {
  const rows = Array.from({ length: 30 }, (_, index) => ({ id: `old-${index}`, createdAt: daysAgo(31 + index) }))
  // The second delete statement fails: the first batch is already committed.
  const { store } = createStore(rows, { failOnDeleteBatch: 2 })

  const outcome = await pruneAutomationLogs({ now: NOW, store, batchSize: 5 })

  assert.equal(outcome.ok, false)
  assert.equal(outcome.alreadyRunning, false)
  assert.equal(outcome.deletedCount, 5, 'only the batch that actually committed is counted')
  assert.equal(outcome.complete, false)
  assert.equal(outcome.remainingCount, 25)
  assert.match(outcome.reason, /connection terminated/)
})

test('a failure while counting also reports failure rather than a false success', async () => {
  const store: AutomationLogRetentionStore = {
    findMany: async () => {
      throw new Error('could not connect to the database')
    },
    deleteMany: async () => ({ count: 0 }),
    count: async () => {
      throw new Error('could not connect to the database')
    },
  }

  const outcome = await pruneAutomationLogs({ now: NOW, store })

  assert.equal(outcome.ok, false)
  assert.equal(outcome.deletedCount, 0)
  assert.equal(outcome.remainingCount, null, 'an unreadable count is reported as unknown, not as zero')
  assert.equal(outcome.complete, false)
})

test('two overlapping cleanups cannot run at the same time in one process', async () => {
  // Assigned synchronously by the executor below, so the no-op default is never the one that runs.
  let release: () => void = () => {}
  const gate = new Promise<void>((resolve) => { release = resolve })
  let gated = false

  const store: AutomationLogRetentionStore = {
    async findMany() {
      if (!gated) {
        gated = true
        await gate
      }
      return []
    },
    async deleteMany() { return { count: 0 } },
    async count() { return 0 },
  }

  const running = pruneAutomationLogs({ now: NOW, store })
  assert.equal(isAutomationLogCleanupRunning(), true)

  const overlapping = await pruneAutomationLogs({ now: NOW, store })
  assert.equal(overlapping.ok, false)
  assert.equal(overlapping.alreadyRunning, true)
  assert.equal(overlapping.deletedCount, 0)
  assert.equal(overlapping.complete, false)

  release()
  const finished = await running
  assert.equal(finished.ok, true)
  assert.equal(isAutomationLogCleanupRunning(), false, 'the flag must be released when the run ends')
})

test('a run that deletes nothing still releases the in-process guard', async () => {
  const { store } = createStore([])

  const outcome = await pruneAutomationLogs({ now: NOW, store })

  assert.equal(outcome.ok, true)
  assert.equal(isAutomationLogCleanupRunning(), false)
})

test('every delete stays scoped to the selected ids and the strict cutoff', async () => {
  const rows = Array.from({ length: 8 }, (_, index) => ({ id: `old-${index}`, createdAt: daysAgo(31 + index) }))
  const { store, calls } = createStore(rows)

  await pruneAutomationLogs({ now: NOW, store, batchSize: 3 })

  assert.ok(calls.deleteMany.length > 0)
  for (const call of calls.deleteMany) {
    const where = call.where as { id?: { in?: unknown[] }; createdAt?: { lt?: Date } }
    assert.ok(Array.isArray(where.id?.in) && where.id.in.length <= 3, 'each delete names at most one batch of ids')
    assert.ok(where.createdAt?.lt instanceof Date, 'each delete repeats the cutoff predicate')
    assert.equal(Object.keys(where).sort().join(','), 'createdAt,id', 'nothing but the id and the cutoff scopes a delete')
  }
})
