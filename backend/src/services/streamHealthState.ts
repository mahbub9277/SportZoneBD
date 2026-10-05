/**
 * Pure decisions and the in-process failure mirror for the stream health cycle.
 *
 * The mirror exists only so a healthy stream does not cost a Redis DEL on every cycle. Redis keeps
 * the authoritative failure counter (including its 900 second TTL) and remains correct without the
 * mirror: whenever this process cannot prove a counter exists, the counter is either cleared first
 * or left to expire, never trusted blindly.
 */

/** The failure counter's TTL is product behaviour: a stream that stops being checked recovers within 15 minutes. */
export const STREAM_HEALTH_FAILURE_TTL_SECONDS = 15 * 60

/** The persisted stream status values this cycle can produce. */
export type StreamHealthStatus = 'READY' | 'LIVE' | 'OFFLINE' | 'ERROR'

export interface PersistedStreamState {
  status: StreamHealthStatus
  enabled: boolean
}

/**
 * Tracks the streams for which this process has recorded a failure counter in Redis, with the time
 * of the last increment, so entries age out exactly when the key itself expires.
 */
export class StreamHealthFailureMirror {
  private readonly recordedAt = new Map<string, number>()

  has(streamId: string): boolean {
    return this.recordedAt.has(streamId)
  }

  record(streamId: string, now: number): void {
    this.recordedAt.set(streamId, now)
  }

  /** Removes the stream and reports whether Redis still needs its counter cleared. */
  clear(streamId: string): boolean {
    return this.recordedAt.delete(streamId)
  }

  /** Drops entries whose Redis key has already expired on its own. */
  pruneExpired(now: number, ttlSeconds: number): number {
    let removed = 0
    for (const [streamId, recordedAt] of this.recordedAt) {
      if (now - recordedAt > ttlSeconds * 1000) {
        this.recordedAt.delete(streamId)
        removed += 1
      }
    }
    return removed
  }

  get size(): number {
    return this.recordedAt.size
  }

  reset(): void {
    this.recordedAt.clear()
  }
}

/**
 * A counter left behind by a previous process must not be trusted, because the mirror that tracked it
 * is gone. Clearing it first keeps a stale count from pushing a stream over the failure threshold.
 */
export function shouldResetFailureCounterBeforeIncrement(isHealthy: boolean, mirrorHasFailure: boolean): boolean {
  return !isHealthy && !mirrorHasFailure
}

/** Below the threshold a failure is transient; at or above it the stream is marked as broken. */
export function classifyStreamHealthFailure(failures: number, alreadyInErrorState: boolean, threshold: number): 'transient' | 'error' {
  if (alreadyInErrorState) return 'error'
  return failures >= threshold ? 'error' : 'transient'
}

/** Healthy streams only pay for clearing a counter that is known to exist. */
export function shouldClearFailureCounter(isHealthy: boolean, mirrorHadFailure: boolean): boolean {
  return isHealthy && mirrorHadFailure
}

/**
 * Returns the values to persist only when they differ from what is already stored, so a stream whose
 * state did not change costs no database write.
 */
export function resolveStreamHealthPersistPlan(input: {
  currentStatus: string
  currentEnabled: boolean
  nextStatus: StreamHealthStatus
  nextEnabled: boolean
}): PersistedStreamState | null {
  if (input.currentStatus === input.nextStatus && input.currentEnabled === input.nextEnabled) return null
  return { status: input.nextStatus, enabled: input.nextEnabled }
}

/** Groups pending changes so one updateMany can persist every stream that shares a target state. */export function groupStreamHealthChanges(
  changes: Array<PersistedStreamState & { streamId: string }>,
): Array<PersistedStreamState & { streamIds: string[] }> {
  const groups = new Map<string, PersistedStreamState & { streamIds: string[] }>()
  for (const change of changes) {
    const key = `${change.status}:${change.enabled}`
    const group = groups.get(key) ?? { status: change.status, enabled: change.enabled, streamIds: [] }
    group.streamIds.push(change.streamId)
    groups.set(key, group)
  }
  return [...groups.values()]
}
