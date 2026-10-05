/**
 * In-process hot state for player telemetry.
 *
 * Redis stays authoritative: it holds the dedupe keys, the live session/state sets that
 * multi-instance aggregation and restart recovery read, the minute buckets that are the history
 * store and the TTLs that clean everything up. This module only keeps the values the ingest path
 * previously re-read or re-wrote on every event — the current state of each session, the aggregate
 * counters, the cumulative error counters and the per-minute aggregation that used to cost five
 * Redis commands per event.
 *
 * Everything here is plain arithmetic over maps, so the hot path stays cheap and the behaviour is
 * unit testable without a Redis server.
 */

export type TelemetryPlaybackState = 'HEALTHY' | 'BUFFERING' | 'ERROR' | 'STALE'

export type TelemetryBucketField = 'activeViewers' | 'healthyViewers' | 'bufferingViewers' | 'errorViewers'

export interface TelemetryStateCounts {
  total: number
  healthy: number
  buffering: number
  errors: number
}

export interface TelemetryResourceStates {
  HEALTHY: number
  BUFFERING: number
  ERROR: number
}

export interface TelemetryMembership {
  state: TelemetryPlaybackState
  resource: string
}

export interface TelemetryBucketDeltas extends Record<TelemetryBucketField, number> {
  /** Number of snapshots accumulated into this bucket; 0 means nothing was sampled. */
  samples: number
}

export interface TelemetryBucket {
  minute: number
  deltas: TelemetryBucketDeltas
}

export interface PendingCounterBatch {
  resource: string
  fields: Array<[string, number]>
}

/**
 * What this process believes the Redis session hash and the state-set memberships contain, so a
 * repeated event can be served without reading Redis and without rewriting identical values.
 */
export interface HotTelemetrySession {
  hashState: TelemetryPlaybackState
  hashResource: string
  hashWrittenAt: number
  /** Memberships written to Redis; null means the session is in none of the state sets. */
  memberState: TelemetryPlaybackState | null
  memberResource: string | null
}

const STATE_COUNT_FIELDS: Record<'HEALTHY' | 'BUFFERING' | 'ERROR', keyof TelemetryStateCounts> = {
  HEALTHY: 'healthy',
  BUFFERING: 'buffering',
  ERROR: 'errors',
}

const RESOURCE_STATE_KEYS: Record<'HEALTHY' | 'BUFFERING' | 'ERROR', keyof TelemetryResourceStates> = {
  HEALTHY: 'HEALTHY',
  BUFFERING: 'BUFFERING',
  ERROR: 'ERROR',
}

/** Finished buckets are flushed on the next tick, so the queue is tiny; the cap only guards an outage. */
const MAX_PENDING_BUCKETS = 120
/** Error counters are flushed every minute; the cap only guards an extended Redis outage. */
const MAX_PENDING_COUNTER_RESOURCES = 500

const emptyBucketDeltas = (): TelemetryBucketDeltas => ({
  activeViewers: 0,
  healthyViewers: 0,
  bufferingViewers: 0,
  errorViewers: 0,
  samples: 0,
})

const emptyResourceStates = (): TelemetryResourceStates => ({ HEALTHY: 0, BUFFERING: 0, ERROR: 0 })

/**
 * True when the payload differs from the last broadcast, so an unchanged telemetry summary never
 * travels through the Redis adapter again.
 */
export function shouldBroadcastTelemetrySummary(previousSignature: string | null, summary: unknown): boolean {
  return JSON.stringify(summary) !== previousSignature
}

export class TelemetryHotState {
  private readonly sessions = new Map<string, HotTelemetrySession>()
  private readonly counts: TelemetryStateCounts = { total: 0, healthy: 0, buffering: 0, errors: 0 }
  private readonly resourceStates = new Map<string, TelemetryResourceStates>()
  private readonly resourceCounters = new Map<string, Map<string, number>>()
  private readonly resources = new Map<string, number>()
  private readonly finishedBuckets: TelemetryBucket[] = []
  private readonly pendingCounters = new Map<string, Map<string, number>>()
  private currentBucket: TelemetryBucket | null = null
  private droppedBuckets = 0

  // ---------------------------------------------------------------- session mirror

  getSession(sessionId: string): HotTelemetrySession | undefined {
    return this.sessions.get(sessionId)
  }

  rememberSession(sessionId: string, session: HotTelemetrySession): void {
    this.sessions.set(sessionId, session)
  }

  forgetSession(sessionId: string): void {
    this.sessions.delete(sessionId)
  }

  /**
   * Drops sessions whose Redis hash has already expired, so a long-lived process cannot grow the
   * mirror forever. Forgetting a session is always safe: the next event reads Redis again.
   */
  pruneSessions(now: number, sessionTtlMs: number): number {
    let removed = 0
    for (const [sessionId, session] of this.sessions) {
      if (now - session.hashWrittenAt > sessionTtlMs) {
        this.sessions.delete(sessionId)
        removed += 1
      }
    }
    return removed
  }

  // ---------------------------------------------------------------- aggregate counters

  /**
   * Applies a membership change to the aggregate counters. `previous`/`next` are the memberships
   * written to Redis, where null means "not in any state set" (which is also how STALE sessions end up).
   */
  applyMembership(previous: TelemetryMembership | null, next: TelemetryMembership | null): void {
    if (previous && next && previous.state === next.state && previous.resource === next.resource) return

    const previousField = previous && previous.state !== 'STALE' ? STATE_COUNT_FIELDS[previous.state as 'HEALTHY' | 'BUFFERING' | 'ERROR'] : null
    const nextField = next && next.state !== 'STALE' ? STATE_COUNT_FIELDS[next.state as 'HEALTHY' | 'BUFFERING' | 'ERROR'] : null

    if (previousField !== nextField) {
      if (previousField) this.counts[previousField] = Math.max(0, this.counts[previousField] - 1)
      if (nextField) this.counts[nextField] += 1
    }
    if (!previousField && nextField) this.counts.total += 1
    if (previousField && !nextField) this.counts.total = Math.max(0, this.counts.total - 1)

    if (previous) this.removeResourceMembership(previous)
    if (next) this.addResourceMembership(next)
  }

  countsSnapshot(): TelemetryStateCounts {
    return { ...this.counts }
  }

  /** Replaces the aggregate counters with an authoritative Redis read. */
  reconcileCounts(counts: TelemetryStateCounts): void {
    this.counts.total = Math.max(0, counts.total)
    this.counts.healthy = Math.max(0, counts.healthy)
    this.counts.buffering = Math.max(0, counts.buffering)
    this.counts.errors = Math.max(0, counts.errors)
  }

  resourceActiveViewers(resource: string): number {
    const states = this.resourceStates.get(resource)
    if (!states) return 0
    return states.HEALTHY + states.BUFFERING + states.ERROR
  }

  /**
   * Replaces one resource's state counts and cumulative counters with Redis values, keeping any
   * increments that have not been flushed yet so a reconcile can never lose an error count.
   */
  reconcileResource(resource: string, states: TelemetryResourceStates | null, counter: Record<string, number> | null): void {
    if (states) {
      if (states.HEALTHY + states.BUFFERING + states.ERROR > 0) this.resourceStates.set(resource, { ...states })
      else this.resourceStates.delete(resource)
    } else {
      this.resourceStates.delete(resource)
    }

    if (counter) {
      const merged = new Map<string, number>(Object.entries(counter))
      const pending = this.pendingCounters.get(resource)
      if (pending) {
        for (const [field, amount] of pending) merged.set(field, (merged.get(field) ?? 0) + amount)
      }
      if (merged.size > 0) this.resourceCounters.set(resource, merged)
      else this.resourceCounters.delete(resource)
    }
  }

  // ---------------------------------------------------------------- resource registry

  /**
   * Records that a resource is active and reports whether the shared score-indexed registry should
   * be refreshed, which keeps one ZADD per resource per refresh window instead of one per event.
   */
  touchResource(resource: string, now: number, refreshMs: number): boolean {
    const lastSeen = this.resources.get(resource)
    this.resources.set(resource, now)
    return lastSeen === undefined || now - lastSeen >= refreshMs
  }

  /** Locally known active resources, most recently seen first. */
  listTrackedResources(limit: number): string[] {
    return [...this.resources.entries()]
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .slice(0, limit)
      .map(([resource]) => resource)
  }

  // ---------------------------------------------------------------- minute buckets

  /**
   * Adds one snapshot to the current minute bucket, mirroring what `HINCRBY` used to do per event:
   * the stored value stays the sum of the snapshots taken inside that minute. A completed minute is
   * queued for the next flush; nothing is written or dropped here.
   */
  addBucketSample(snapshot: TelemetryStateCounts, at: number): void {
    const minute = Math.floor(at / 60_000) * 60_000
    if (!this.currentBucket) this.currentBucket = { minute, deltas: emptyBucketDeltas() }
    else if (this.currentBucket.minute !== minute) {
      this.finishedBuckets.push(this.currentBucket)
      this.currentBucket = { minute, deltas: emptyBucketDeltas() }
      if (this.finishedBuckets.length > MAX_PENDING_BUCKETS) {
        const dropped = this.finishedBuckets.splice(0, this.finishedBuckets.length - MAX_PENDING_BUCKETS)
        this.droppedBuckets += dropped.length
      }
    }

    const deltas = this.currentBucket.deltas
    deltas.activeViewers += snapshot.total
    deltas.healthyViewers += snapshot.healthy
    deltas.bufferingViewers += snapshot.buffering
    deltas.errorViewers += snapshot.errors
    deltas.samples += 1
  }

  private drainFinishedBuckets(): TelemetryBucket[] {
    return this.finishedBuckets.splice(0, this.finishedBuckets.length)
  }

  /**
   * Buckets to write. `includeCurrent` also takes the in-flight minute, which is safe because the
   * flusher increments the same Redis keys: a later sample for that minute simply adds to them.
   */
  takeBuckets(includeCurrent: boolean): TelemetryBucket[] {
    const buckets = this.drainFinishedBuckets()
    if (includeCurrent && this.currentBucket && this.currentBucket.deltas.samples > 0) {
      buckets.push(this.currentBucket)
      this.currentBucket = null
    }
    return buckets
  }

  /** Puts buckets back after a failed flush so a transient Redis outage does not drop them. */
  restoreBuckets(buckets: TelemetryBucket[]): void {
    if (buckets.length === 0) return
    this.finishedBuckets.unshift(...buckets)
    if (this.finishedBuckets.length > MAX_PENDING_BUCKETS) {
      const dropped = this.finishedBuckets.splice(MAX_PENDING_BUCKETS)
      this.droppedBuckets += dropped.length
    }
  }

  get droppedBucketCount(): number {
    return this.droppedBuckets
  }

  // ---------------------------------------------------------------- error counters

  recordCounter(resource: string, field: string, amount = 1): void {
    const counters = this.resourceCounters.get(resource) ?? new Map<string, number>()
    counters.set(field, (counters.get(field) ?? 0) + amount)
    this.resourceCounters.set(resource, counters)

    const pending = this.pendingCounters.get(resource) ?? new Map<string, number>()
    pending.set(field, (pending.get(field) ?? 0) + amount)
    this.pendingCounters.set(resource, pending)
  }

  /** Removes and returns the unflushed counter increments, grouped per resource. */
  takeCounterDeltas(): PendingCounterBatch[] {
    const batches: PendingCounterBatch[] = []
    for (const [resource, fields] of this.pendingCounters) {
      if (fields.size > 0) batches.push({ resource, fields: [...fields.entries()] })
    }
    this.pendingCounters.clear()
    return batches
  }

  /** Puts counter increments back after a failed flush so a transient outage does not lose them. */
  restoreCounterDeltas(batches: PendingCounterBatch[]): void {
    let restored = 0
    for (const batch of batches) {
      if (restored >= MAX_PENDING_COUNTER_RESOURCES) break
      const pending = this.pendingCounters.get(batch.resource) ?? new Map<string, number>()
      for (const [field, amount] of batch.fields) pending.set(field, (pending.get(field) ?? 0) + amount)
      this.pendingCounters.set(batch.resource, pending)
      restored += 1
    }
  }

  get pendingCounterResourceCount(): number {
    return this.pendingCounters.size
  }

  /** Buckets waiting to be written; only the completed minutes count, so this is 0 inside a minute. */
  get pendingBucketCount(): number {
    return this.finishedBuckets.length
  }

  /**
   * Resources with error-flavoured counters, ordered deterministically so an unchanged summary
   * compares equal and is not broadcast again.
   */
  errorCounterSnapshot(limit: number): Array<{ resource: string; errorCount: number; counter: Record<string, number> }> {
    const entries: Array<{ resource: string; errorCount: number; counter: Record<string, number> }> = []
    for (const [resource, counters] of this.resourceCounters) {
      const counter = Object.fromEntries(counters)
      const errorCount = Object.entries(counter)
        .filter(([field]) => field.includes('error'))
        .reduce((sum, [, value]) => sum + (Number(value) || 0), 0)
      if (errorCount > 0) entries.push({ resource, errorCount, counter })
    }
    entries.sort((left, right) => right.errorCount - left.errorCount || left.resource.localeCompare(right.resource))
    return entries.slice(0, limit)
  }

  /** Test helper: forgets a resource entirely. */
  dropResource(resource: string): void {
    this.resourceStates.delete(resource)
    this.resourceCounters.delete(resource)
    this.resources.delete(resource)
    this.pendingCounters.delete(resource)
  }

  // ---------------------------------------------------------------- internals

  private addResourceMembership(membership: TelemetryMembership): void {
    if (membership.state === 'STALE') return
    const states = this.resourceStates.get(membership.resource) ?? emptyResourceStates()
    states[RESOURCE_STATE_KEYS[membership.state as 'HEALTHY' | 'BUFFERING' | 'ERROR']] += 1
    this.resourceStates.set(membership.resource, states)
  }

  private removeResourceMembership(membership: TelemetryMembership): void {
    if (membership.state === 'STALE') return
    const states = this.resourceStates.get(membership.resource)
    if (!states) return
    const key = RESOURCE_STATE_KEYS[membership.state as 'HEALTHY' | 'BUFFERING' | 'ERROR']
    states[key] = Math.max(0, states[key] - 1)
    if (states.HEALTHY + states.BUFFERING + states.ERROR === 0) this.resourceStates.delete(membership.resource)
  }
}
