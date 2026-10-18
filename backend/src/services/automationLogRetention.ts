import type { Prisma } from '@prisma/client'
import { prisma } from '../core/prisma.js'
import logger from '../core/logger.js'

/**
 * The administrator-triggered "delete automation logs older than 30 days" operation.
 *
 * It is deliberately an explicit action with no scheduler: nothing runs unless an administrator presses the
 * button, and every request is bounded, so a large backlog can never become an unbounded delete.
 *
 * The rules this module owns:
 *  - one cutoff per request (`now - 30 days`), compared with a strict `<`, so a row exactly on the cutoff and
 *    every newer row is kept;
 *  - no status filter — an old SUCCESS, FAILED, PARTIAL or any other valid status follows the same policy;
 *  - bounded batches (5,000 ids) of the *oldest* eligible rows, each deleted only after re-checking the same
 *    predicate, and at most 50,000 rows per HTTP request;
 *  - `deletedCount` is what the database actually deleted, never an estimate, so a failed or partially
 *    completed run can never be reported as a full success.
 */
export const AUTOMATION_LOG_RETENTION_DAYS = 30
export const AUTOMATION_LOG_RETENTION_BATCH_SIZE = 5_000
export const AUTOMATION_LOG_RETENTION_MAX_PER_REQUEST = 50_000

const RETENTION_WINDOW_MS = AUTOMATION_LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000

/** The one cutoff a request uses: exactly `retentionDays` before `now`, as an absolute instant. */
export function resolveAutomationLogRetentionCutoff(now: Date = new Date()): Date {
  return new Date(now.getTime() - RETENTION_WINDOW_MS)
}

/** The three operations this module needs, so a test can supply a stand-in instead of a database. */
export interface AutomationLogRetentionStore {
  findMany(args: {
    where: Prisma.AutomationLogWhereInput
    orderBy: Prisma.AutomationLogOrderByWithRelationInput[]
    select: { id: true }
    take: number
  }): Promise<Array<{ id: string }>>
  deleteMany(args: { where: Prisma.AutomationLogWhereInput }): Promise<{ count: number }>
  count(args?: { where?: Prisma.AutomationLogWhereInput }): Promise<number>
}

export interface AutomationLogRetentionSummary {
  /** The instant the request treated as the retention boundary (ISO 8601, UTC). */
  cutoff: string
  /** Rows the database confirmed it deleted during this request. */
  deletedCount: number
  /** Rows still older than the cutoff when the request finished; null when that could not be read. */
  remainingCount: number | null
  /** True only when nothing older than the cutoff is left. */
  complete: boolean
  retentionDays: number
  batchSize: number
  maxPerRequest: number
  /** How many delete statements actually ran. */
  batches: number
}

export type AutomationLogRetentionOutcome =
  | ({ ok: true } & AutomationLogRetentionSummary)
  | ({ ok: false; reason: string; alreadyRunning: boolean } & AutomationLogRetentionSummary)

export interface AutomationLogRetentionOptions {
  /** Injectable for tests; defaults to the current time. */
  now?: Date
  batchSize?: number
  /** Can only lower the per-request ceiling, never raise it. */
  maxPerRequest?: number
  store?: AutomationLogRetentionStore
}

/**
 * Set for the duration of a run in this process, so a double-click or a second administrator cannot start a
 * competing cleanup. Deleting by id under the cutoff is idempotent, so a run on another instance is safe
 * too: both may select the same rows, but only the request whose `deleteMany` matched them counts them.
 */
let cleanupInProgress = false

export function isAutomationLogCleanupRunning(): boolean {
  return cleanupInProgress
}

function clampBatchSize(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return AUTOMATION_LOG_RETENTION_BATCH_SIZE
  return Math.min(Math.max(Math.trunc(value), 1), AUTOMATION_LOG_RETENTION_MAX_PER_REQUEST)
}

/**
 * Deletes at most `maxPerRequest` automation logs older than the retention cutoff, oldest first, and reports
 * exactly what the database did.
 *
 * Every intermediate failure returns `ok: false` with the rows that *were* deleted, the rows that are still
 * eligible, and `complete: false`; it never reports a partial run as finished.
 */
export async function pruneAutomationLogs(
  options: AutomationLogRetentionOptions = {},
): Promise<AutomationLogRetentionOutcome> {
  const store = options.store ?? prisma.automationLog
  const cutoffDate = resolveAutomationLogRetentionCutoff(options.now ?? new Date())
  const batchSize = clampBatchSize(options.batchSize)
  const maxPerRequest = typeof options.maxPerRequest === 'number' && Number.isFinite(options.maxPerRequest)
    ? Math.min(Math.max(Math.trunc(options.maxPerRequest), 1), AUTOMATION_LOG_RETENTION_MAX_PER_REQUEST)
    : AUTOMATION_LOG_RETENTION_MAX_PER_REQUEST
  const cutoff = cutoffDate.toISOString()
  const base = {
    cutoff,
    retentionDays: AUTOMATION_LOG_RETENTION_DAYS,
    batchSize,
    maxPerRequest,
  }

  // The check and the claim are synchronous, so two overlapping calls cannot both proceed past this point.
  if (cleanupInProgress) {
    return { ok: false, alreadyRunning: true, reason: 'A cleanup is already running.', deletedCount: 0, remainingCount: null, complete: false, batches: 0, ...base }
  }
  cleanupInProgress = true

  let deletedCount = 0
  let batches = 0
  const eligible = { createdAt: { lt: cutoffDate } } satisfies Prisma.AutomationLogWhereInput

  try {
    while (deletedCount < maxPerRequest) {
      const take = Math.min(batchSize, maxPerRequest - deletedCount)
      const candidates = await store.findMany({
        where: eligible,
        select: { id: true },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take,
      })
      if (candidates.length === 0) break

      // The predicate is repeated on the delete: a row that another request already removed, or whose
      // timestamp no longer qualifies, is never deleted by this batch — and its count is not claimed.
      const { count } = await store.deleteMany({
        where: { id: { in: candidates.map((row) => row.id) }, createdAt: { lt: cutoffDate } },
      })
      deletedCount += count
      batches += 1

      // Fewer rows than asked for means the eligible set is exhausted. Zero deleted means another run took
      // them, so continuing would only repeat the same query.
      if (candidates.length < take || count === 0) break
    }

    const remainingCount = await store.count({ where: eligible })
    return {
      ok: true,
      deletedCount,
      remainingCount,
      complete: remainingCount === 0,
      batches,
      ...base,
    }
  } catch (error) {
    let remainingCount: number | null = null
    try {
      remainingCount = await store.count({ where: eligible })
    } catch {
      // The database is the thing that just failed; the count stays unknown rather than being invented.
    }

    logger.error(
      { cutoff, deletedCount, remainingCount, batches, error },
      'Automation log retention cleanup failed',
    )

    return {
      ok: false,
      alreadyRunning: false,
      // Kept in the internal outcome (and the server log) only: the API never returns database details.
      reason: error instanceof Error ? error.message : String(error),
      deletedCount,
      remainingCount,
      complete: false,
      batches,
      ...base,
    }
  } finally {
    cleanupInProgress = false
  }
}
