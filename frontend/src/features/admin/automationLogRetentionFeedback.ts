import type { AutomationLogRetentionResult } from './adminAutomation.types'

/**
 * Turns a cleanup response into the toast the administrator sees.
 *
 * It is a pure function so the four outcomes the dashboard has to distinguish — deleted everything, deleted
 * part of the backlog, nothing was old enough, and the request failed — can be tested without a browser.
 * The counts always come from the payload (what the database confirmed), never from the request.
 */
export type RetentionFeedbackTone = 'success' | 'info' | 'error'

export interface RetentionFeedback {
  tone: RetentionFeedbackTone
  title: string
  description?: string
}

const formatCount = (value: number) => value.toLocaleString('en-US')

export function describeRetentionOutcome(result: AutomationLogRetentionResult): RetentionFeedback {
  const days = result.retentionDays
  const deleted = result.deletedCount
  const remaining = result.remainingCount ?? 0

  if (deleted === 0 && remaining === 0) {
    return {
      tone: 'info',
      title: `No automation logs are older than ${days} days`,
      description: 'Nothing was deleted. Recent logs are untouched.',
    }
  }

  if (deleted === 0) {
    // Possible when a second administrator is cleaning the same backlog at the same time.
    return {
      tone: 'info',
      title: 'No logs were deleted this time',
      description: `${formatCount(remaining)} older record${remaining === 1 ? ' remains' : 's remain'}. Run the cleanup again to continue.`,
    }
  }

  if (result.complete) {
    return {
      tone: 'success',
      title: `Deleted ${formatCount(deleted)} automation log${deleted === 1 ? '' : 's'}`,
      description: `Every record older than ${days} days was removed. Recent logs are untouched.`,
    }
  }

  return {
    tone: 'info',
    title: `Deleted ${formatCount(deleted)} automation log${deleted === 1 ? '' : 's'}`,
    description: `${formatCount(remaining)} older record${remaining === 1 ? ' remains' : 's remain'}. Run the cleanup again to continue.`,
  }
}

interface RetentionErrorPayload {
  message?: unknown
  error?: { deletedCount?: unknown; remainingCount?: unknown; retentionDays?: unknown } | null
}

function readErrorPayload(error: unknown): RetentionErrorPayload | null {
  if (typeof error !== 'object' || error === null) return null
  const data = (error as { data?: unknown }).data
  if (typeof data !== 'object' || data === null) return null
  return data as RetentionErrorPayload
}

/**
 * The failure feedback for a cleanup request.
 *
 * A request that failed must never look like a success, so this always returns the `error` tone — even when
 * the backend reported how many rows it had already deleted before failing. Those counts are shown because
 * an administrator needs them, with wording that says the cleanup did not finish.
 */
export function describeRetentionFailure(error: unknown): RetentionFeedback {
  const payload = readErrorPayload(error)
  const message = typeof payload?.message === 'string' && payload.message.trim()
    ? payload.message.trim()
    : 'The cleanup could not be completed. Nothing was reported as deleted.'
  const deleted = typeof payload?.error?.deletedCount === 'number' ? payload.error.deletedCount : null
  const remaining = typeof payload?.error?.remainingCount === 'number' ? payload.error.remainingCount : null

  if (deleted === null) {
    return { tone: 'error', title: 'Cleanup failed', description: message }
  }

  const counts = [`${formatCount(deleted)} deleted`, remaining === null ? null : `${formatCount(remaining)} still eligible`]
    .filter((entry): entry is string => entry !== null)
    .join(' · ')

  return { tone: 'error', title: 'Cleanup did not finish', description: `${message} (${counts})` }
}
