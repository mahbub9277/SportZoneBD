/**
 * The numbers the automation dashboard shows, derived from the run history in one place.
 *
 * The tick used to ask for each of these with its own COUNT query — five round trips per run, every
 * minute, for numbers that all come from the same table. Two grouped reads answer the same questions
 * (one for the whole history, one for the last 24 hours), so this module keeps the arithmetic next to
 * the definitions where it can be checked without a database.
 */

/** A run counts as successful when it did its work; PARTIAL means it did part of it. */
const SUCCESSFUL_RUN_STATUSES = ['SUCCESS', 'PARTIAL'] as const

/** The actions the dashboard reports over a 24 hour window. */
export const AUTOMATION_METRICS_ACTIONS = ['DISCOVER_MATCHES', 'VALIDATE_STREAMS'] as const

export const AUTOMATION_METRICS_WINDOW_MS = 24 * 60 * 60 * 1000

export interface AutomationStatusCount {
  status: string
  count: number
}

export interface AutomationActionStatusCount {
  action: string
  status: string
  count: number
}

export interface AutomationMetricsSummary {
  totalRuns: number
  successfulRuns: number
  failedRuns: number
  matchesCreatedLast24h: number
  streamsValidatedLast24h: number
}

export function summarizeAutomationMetrics(input: {
  /** Every run of this job, grouped by status. */
  statusCounts: AutomationStatusCount[]
  /** Runs of the reported actions inside the window, grouped by action and status. */
  recentActionCounts: AutomationActionStatusCount[]
}): AutomationMetricsSummary {
  const countWhere = (predicate: (entry: AutomationStatusCount) => boolean) => (
    input.statusCounts.reduce((total, entry) => (predicate(entry) ? total + entry.count : total), 0)
  )

  const actionCountWhere = (
    action: (typeof AUTOMATION_METRICS_ACTIONS)[number],
    statuses: readonly string[],
  ) => input.recentActionCounts.reduce(
    (total, entry) => (entry.action === action && statuses.includes(entry.status) ? total + entry.count : total),
    0,
  )

  return {
    totalRuns: countWhere(() => true),
    successfulRuns: countWhere((entry) => SUCCESSFUL_RUN_STATUSES.includes(entry.status as typeof SUCCESSFUL_RUN_STATUSES[number])),
    failedRuns: countWhere((entry) => entry.status === 'FAILED'),
    matchesCreatedLast24h: actionCountWhere('DISCOVER_MATCHES', SUCCESSFUL_RUN_STATUSES),
    streamsValidatedLast24h: actionCountWhere('VALIDATE_STREAMS', ['SUCCESS']),
  }
}
