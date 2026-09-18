import { PaginatedResult } from "@/app/api/types";

/**
 * Represents a single log entry from an automation job.
 * This type should mirror the `AutomationLog` from the backend.
 */
export interface AutomationLog {
  id: string
  jobId: string
  action: string
  status: 'SUCCESS' | 'FAILED' | 'RUNNING' | 'PARTIAL'
  summary?: string | null
  errorMessage?: string | null
  details?: Record<string, unknown> | null
  createdAt: string
  updatedAt: string
}

/**
 * Represents the current status of an automation job, including recent logs.
 * This type should mirror the `AutomationStatus` from the backend.
 */
export interface AutomationStatus {
  id: string
  name: string
  status: 'IDLE' | 'RUNNING' | 'ERROR' | 'PAUSED'
  lastRunAt?: string | null
  nextRunAt?: string | null
  isEnabled: boolean
  cronExpression?: string | null
  createdAt: string
  updatedAt: string
  deletedAt?: string | null
  logs: AutomationLog[]
}

/**
 * Represents the aggregated metrics for automation jobs.
 * This type should mirror the `AutomationMetrics` from the backend.
 */
export type AutomationMetrics = Record<string, unknown> & {
  totalRuns: number
  successfulRuns: number
  failedRuns: number
  lastRunAt?: string | null
  matchesCreatedLast24h: number
  streamsValidatedLast24h: number
  jobStatus: string
  isEnabled: boolean
}

/**
 * Represents the paginated response for automation logs.
 */
export type AutomationLogsResponse = PaginatedResult<AutomationLog>