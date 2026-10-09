import { redis } from '../../core/redis.js'
import { emitApplicationSettingChanged, emitStreamHealthSummary, getIoInstance, isSocketClusterActive } from '../../core/socketManager.js'
import logger from '../../core/logger.js'
import { getRedisErrorCode } from '../../core/redisFailover.js'
import { prisma } from '../../core/prisma.js'
import {
  TelemetryHotState,
  shouldBroadcastTelemetrySummary,
  type PendingCounterBatch,
  type TelemetryBucket,
  type TelemetryMembership,
  type TelemetryPlaybackState,
  type TelemetryResourceStates,
  type TelemetryStateCounts,
} from './telemetryHotState.js'
import { createTelemetryRuntime } from './telemetryRuntime.js'

export const TELEMETRY_SETTING_KEY = 'telemetry.enabled'

export const TELEMETRY_EVENT_TYPES = [
  'load_start', 'manifest_ready', 'media_ready', 'first_play', 'playing', 'buffering_start', 'buffering_end', 'stalled',
  'fatal_error', 'network_error', 'media_error', 'bitrate_switch', 'heartbeat',
  'ended', 'player_destroyed',
  'playback_timeout', 'playback_invalid_stream', 'playback_retry', 'playback_fallback', 'playback_exhausted',
] as const

export type TelemetryEventType = typeof TELEMETRY_EVENT_TYPES[number]

const SESSION_TTL = 180
const COUNTER_TTL_SECONDS = 24 * 60 * 60
const DEDUPE_TTL_SECONDS = 3600
const ACTIVE_KEY = 'sportzone:telemetry:active'
const LEGACY_RESOURCE_SET = 'sportzone:telemetry:resources'
// Score-indexed replacement for the legacy set: the score is the resource's last activity, so stale
// entries can be reclaimed and the newest resources can be read in one bounded range request.
const RESOURCE_SET_V2 = 'sportzone:telemetry:resources:v2'
const RESOURCE_SET_REFRESH_MS = 60_000
const RESOURCE_SET_STALE_MS = 24 * 60 * 60 * 1000
const RESOURCE_WINDOW = 50
/**
 * The session hash is what a cold process reads to learn a session's previous state, so it is
 * refreshed well inside its TTL while the session is active; unchanged events leave it alone.
 */
const HASH_REFRESH_INTERVAL_MS = 120_000
const TELEMETRY_BROADCAST_INTERVAL_MS = 15_000
const SUMMARY_CACHE_TTL_MS = 20_000
const TELEMETRY_PRUNE_INTERVAL_MS = 300_000
const TELEMETRY_RECONCILE_INTERVAL_MS = 60_000
const TELEMETRY_SETTING_CACHE_MS = 45_000
const MAX_PER_RESOURCE_RECONCILE = 25
/** Safety valve: flush counter increments early rather than let the pending map grow without bound. */
const MAX_PENDING_COUNTER_RESOURCES = 200

const stateKey = (state: TelemetryPlaybackState) => `sportzone:telemetry:state:${state}`
const resourceKey = (resource: string, state: TelemetryPlaybackState) => `sportzone:telemetry:resource:${resource}:${state}`
const sessionKey = (id: string) => `sportzone:telemetry:session:${id}`
const bucketKey = (minute: number) => `sportzone:telemetry:bucket:${minute}`
const counterKey = (resource: string) => `sportzone:telemetry:counter:${resource}`

const COUNTER_FIELDS = new Set([
  'buffering_events', 'stalled', 'network_error', 'media_error', 'fatal_error', 'bitrate_switch',
  // Playback-lifecycle failures: counted so a dashboard can see how often a source had to be abandoned.
  'playback_timeout', 'playback_invalid_stream', 'playback_retry', 'playback_fallback', 'playback_exhausted',
])

/**
 * Refreshes the three membership scores a live session needs in one round trip. The scores are what
 * keep an unchanged session counted without rewriting the values it already has.
 */
const REFRESH_MEMBERSHIPS_SCRIPT = `
redis.call('zadd', KEYS[1], ARGV[1], ARGV[2])
redis.call('zadd', KEYS[2], ARGV[1], ARGV[2])
redis.call('zadd', KEYS[3], ARGV[1], ARGV[2])
return 1
`

const hotState = new TelemetryHotState()

/**
 * Last known value of the telemetry setting for this process, readable synchronously so the kill switch
 * can be enforced before any telemetry work starts and without touching Redis or the database.
 * It starts `false`: nothing telemetry-related runs until the setting has actually been read.
 */
let telemetryEnabledState = false

/** True while this process believes telemetry is enabled. Never performs I/O. */
export function isTelemetryEnabled(): boolean {
  return telemetryEnabledState
}

let lastBroadcastAt = 0
let lastBroadcastSignature: string | null = null
let summaryCache: { value: TelemetrySummary; expiresAt: number } | null = null
let summaryInFlight: Promise<TelemetrySummary> | null = null
let settingCache: { value: boolean; expiresAt: number } | null = null
let lastReconcileAt = 0
let lastPruneAt = 0
let reconcileInFlight: Promise<void> | null = null
let legacyResourceMigrationDone = false

/**
 * Drops every buffered telemetry increment and cached derived value.
 *
 * Called when telemetry is switched off: pending buckets and counters must never be flushed afterwards
 * (flushing them would be a telemetry write while telemetry is off), and the next enable has to start
 * from a clean slate instead of reconciling against stale mirrors.
 */
function discardPendingTelemetryWork(): void {
  hotState.reset()
  lastBroadcastAt = 0
  lastBroadcastSignature = null
  summaryCache = null
  lastReconcileAt = 0
  lastPruneAt = 0
}

export interface TelemetrySummary {
  totalActiveViewers: number
  healthyViewers: number
  bufferingViewers: number
  errorViewers: number
  healthPercentage: number | null
  bufferingPercentage: number | null
  topErroredStreams: Array<{ resource: string; errorCount: number; activeViewers: number; counters: Record<string, string | number> }>
}

// ---------------------------------------------------------------- settings

/**
 * Cached so an ingest burst costs one database read per window instead of one per request. The admin
 * toggle invalidates it immediately; the cache window bounds staleness across instances.
 */
export async function getTelemetryEnabled(): Promise<boolean> {
  const now = Date.now()
  if (settingCache && settingCache.expiresAt > now) {
    // Even a cache hit keeps the runtime in sync: an instance that went dormant must start its
    // maintenance timer as soon as the setting is known to be on again, and stop it when it is off.
    applyTelemetryEnabled(settingCache.value)
    return settingCache.value
  }

  try {
    const setting = await prisma.setting.findUnique({ where: { key: TELEMETRY_SETTING_KEY } })
    const value = !setting || setting.deletedAt !== null || setting.value !== 'false'
    settingCache = { value, expiresAt: now + TELEMETRY_SETTING_CACHE_MS }
    applyTelemetryEnabled(value)
    return value
  } catch (error) {
    logger.warn({ error }, 'Unable to read the telemetry setting')
    return settingCache?.value ?? true
  }
}

export async function setTelemetryEnabled(enabled: boolean): Promise<void> {
  const value = String(enabled)
  await prisma.setting.upsert({
    where: { key: TELEMETRY_SETTING_KEY },
    update: { value, type: 'boolean', description: 'Enable or disable player telemetry collection.', deletedAt: null },
    create: { key: TELEMETRY_SETTING_KEY, value, type: 'boolean', description: 'Enable or disable player telemetry collection.' },
  })
  settingCache = { value: enabled, expiresAt: Date.now() + TELEMETRY_SETTING_CACHE_MS }
  // Applies immediately on this instance: off clears the maintenance timer and all buffered work, on
  // starts the maintenance timer exactly once.
  applyTelemetryEnabled(enabled)
  emitApplicationSettingChanged(TELEMETRY_SETTING_KEY, value)
}

// ---------------------------------------------------------------- ingest

function safeResource(event: { streamId?: string; channelId?: string; matchId?: string }): string {
  return `stream:${event.streamId || 'unknown'}|channel:${event.channelId || ''}|match:${event.matchId || ''}`
}

function nextState(type: TelemetryEventType, current: TelemetryPlaybackState): TelemetryPlaybackState {
  if (type === 'fatal_error' || type === 'network_error' || type === 'media_error') return 'ERROR'
  // A source that timed out, was rejected or ran out of candidates is an errored playback, not a stall.
  if (type === 'playback_timeout' || type === 'playback_invalid_stream' || type === 'playback_exhausted') return 'ERROR'
  // Automatic recovery is still a viewer waiting for playback, so it stays in the buffering bucket.
  if (type === 'playback_retry' || type === 'playback_fallback') return 'BUFFERING'
  if (type === 'buffering_start' || type === 'stalled') return 'BUFFERING'
  if (type === 'playing' || type === 'first_play' || type === 'media_ready' || type === 'buffering_end' || type === 'heartbeat') return 'HEALTHY'
  if (type === 'ended' || type === 'player_destroyed') return 'STALE'
  return current
}

export async function ingestTelemetry(event: {
  eventId: string
  sessionId: string
  eventType: TelemetryEventType
  timestamp: number
  streamId?: string
  channelId?: string
  matchId?: string
  metadata?: Record<string, string | number | boolean | null>
}, enabled: boolean): Promise<void> {
  try {
    if (!enabled) return
    const dedupeKey = `sportzone:telemetry:event:${event.eventId}`
    const accepted = await redis.set(dedupeKey, '1', 'EX', DEDUPE_TTL_SECONDS, 'NX')
    if (!accepted) return

    const now = Date.now()
    await ensureReconciled(now)
    const clusterActive = await isSocketClusterActive()
    const resource = safeResource(event)
    const key = sessionKey(event.sessionId)

    // The hot mirror answers "what is this session's previous state" without a Redis read while the
    // process is warm; a cold or clustered process reads the authoritative hash instead.
    const mirror = clusterActive ? undefined : hotState.getSession(event.sessionId)
    let hashState: TelemetryPlaybackState | null = null
    let hashResource: string | null = null
    let membership: TelemetryMembership | null = null

    if (mirror) {
      hashState = mirror.hashState
      hashResource = mirror.hashResource
      membership = mirror.memberState && mirror.memberResource
        ? { state: mirror.memberState, resource: mirror.memberResource }
        : null
    } else {
      const raw = await redis.hgetall(key)
      const storedState = raw.state as TelemetryPlaybackState | undefined
      const storedResource = typeof raw.resource === 'string' && raw.resource ? raw.resource : null
      if (storedState && storedResource) {
        hashState = storedState
        hashResource = storedResource
        // Without a mirror the memberships we assume are exactly the hash values, which is the
        // behaviour this endpoint had before the hot state existed.
        membership = storedState === 'STALE' ? null : { state: storedState, resource: storedResource }
      }
    }

    const state = nextState(event.eventType, hashState ?? 'HEALTHY')
    const expiresAt = now + SESSION_TTL * 1000
    const targetMembership: TelemetryMembership | null = state === 'STALE' ? null : { state, resource }

    if (state === 'STALE') {
      // Ending a session only releases its memberships; the hash is left for its TTL to reclaim,
      // exactly as before, so a later event still sees the last known state.
      if (membership) await releaseMembership(event.sessionId, membership)
    } else if (membership && membership.state === state && membership.resource === resource) {
      // Unchanged event: refresh the membership scores in one round trip and write nothing else.
      await refreshMemberships(event.sessionId, expiresAt, state, resource)
    } else {
      if (membership && membership.state !== state) await redis.zrem(stateKey(membership.state), event.sessionId)
      if (membership && (membership.resource !== resource || membership.state !== state)) {
        await redis.zrem(resourceKey(membership.resource, membership.state), event.sessionId)
      }
      await redis.zadd(ACTIVE_KEY, expiresAt, event.sessionId)
      await redis.zadd(stateKey(state), expiresAt, event.sessionId)
      await redis.zadd(resourceKey(resource, state), expiresAt, event.sessionId)
    }

    const hashNeedsWrite = state !== 'STALE' && (mirror === undefined
      ? true
      : !hashState || !hashResource || hashState !== state || hashResource !== resource || now - mirror.hashWrittenAt >= HASH_REFRESH_INTERVAL_MS)
    if (hashNeedsWrite) {
      await redis.hset(key, 'state', state, 'resource', resource, 'expiresAt', String(expiresAt))
      await redis.expire(key, SESSION_TTL)
    }

    if (state === 'STALE' && !hashState && !hashResource) {
      // A session that ends before it was ever written leaves nothing to remember.
      hotState.forgetSession(event.sessionId)
    } else {
      hotState.rememberSession(event.sessionId, {
        hashState: state === 'STALE' ? (hashState ?? state) : state,
        hashResource: state === 'STALE' ? (hashResource ?? resource) : resource,
        hashWrittenAt: hashNeedsWrite ? now : mirror?.hashWrittenAt ?? now,
        memberState: targetMembership?.state ?? null,
        memberResource: targetMembership?.resource ?? null,
      })
    }
    hotState.applyMembership(membership, targetMembership)
    if (hotState.touchResource(resource, now, RESOURCE_SET_REFRESH_MS)) {
      await redis.zadd(RESOURCE_SET_V2, now, resource)
    }

    if (event.eventType !== 'heartbeat') {
      const field = event.eventType.replace(/_start$|_end$/g, '_events')
      if (COUNTER_FIELDS.has(field)) hotState.recordCounter(resource, field, 1)

      const snapshot = clusterActive ? await readStateCounts(false) : hotState.countsSnapshot()
      hotState.addBucketSample(snapshot, event.timestamp)
      // Increments are written when a minute completes (or when a backlog builds up), so a burst of
      // events inside one minute still costs a single flush; the periodic tick is the trailing edge.
      if (hotState.pendingBucketCount > 0 || hotState.pendingCounterResourceCount > MAX_PENDING_COUNTER_RESOURCES) {
        await flushTelemetryAggregations(false)
      }
    }

    await broadcastTelemetrySummary(enabled)
  } catch (error) {
    logger.warn({ code: getRedisErrorCode(error), eventType: event.eventType }, 'Player telemetry ingestion failed')
  }
}

/** One round trip that keeps an unchanged session counted without rewriting its state. */
async function refreshMemberships(sessionId: string, expiresAt: number, state: TelemetryPlaybackState, resource: string): Promise<void> {
  await redis.eval(REFRESH_MEMBERSHIPS_SCRIPT, 3, ACTIVE_KEY, stateKey(state), resourceKey(resource, state), expiresAt, sessionId)
}

async function releaseMembership(sessionId: string, membership: TelemetryMembership): Promise<void> {
  await Promise.all([
    redis.zrem(stateKey(membership.state), sessionId),
    redis.zrem(resourceKey(membership.resource, membership.state), sessionId),
    redis.zrem(ACTIVE_KEY, sessionId),
  ])
}

// ---------------------------------------------------------------- aggregation flush

/**
 * Writes the buffered minute bucket and error counter increments. The bucket keeps the exact meaning
 * it had when every event incremented it directly (the sum of the snapshots taken inside that
 * minute); it is now accumulated in memory and written once per minute, which is why a later sample
 * for the same minute simply adds to the same key.
 */
export async function flushTelemetryAggregations(includeCurrentBucket: boolean): Promise<void> {
  if (!isTelemetryEnabled()) {
    // Kill switch: with telemetry off nothing buffered may be written. The increments are dropped
    // rather than flushed, so no Redis command is issued from here while telemetry is off.
    discardPendingTelemetryWork()
    return
  }

  const buckets = hotState.takeBuckets(includeCurrentBucket)
  const counters = hotState.takeCounterDeltas()
  if (buckets.length === 0 && counters.length === 0) return

  try {
    const writes: Array<Promise<unknown>> = []
    for (const bucket of buckets) {
      const key = bucketKey(bucket.minute)
      writes.push(redis.hincrby(key, 'activeViewers', bucket.deltas.activeViewers))
      writes.push(redis.hincrby(key, 'healthyViewers', bucket.deltas.healthyViewers))
      writes.push(redis.hincrby(key, 'bufferingViewers', bucket.deltas.bufferingViewers))
      writes.push(redis.hincrby(key, 'errorViewers', bucket.deltas.errorViewers))
      writes.push(redis.expire(key, COUNTER_TTL_SECONDS))
    }
    for (const batch of counters) {
      const key = counterKey(batch.resource)
      for (const [field, amount] of batch.fields) writes.push(redis.hincrby(key, field, amount))
      writes.push(redis.expire(key, COUNTER_TTL_SECONDS))
    }
    await Promise.all(writes)
  } catch (error) {
    // Redis is temporarily unavailable: keep the increments so recovery does not silently lose them.
    hotState.restoreBuckets(buckets as TelemetryBucket[])
    hotState.restoreCounterDeltas(counters as PendingCounterBatch[])
    logger.warn({ code: getRedisErrorCode(error), buckets: buckets.length, resources: counters.length }, 'Telemetry aggregation flush failed')
  }
}

// ---------------------------------------------------------------- maintenance

/** The first event after a restart warms the in-memory counters from Redis. */
async function ensureReconciled(now: number): Promise<void> {
  if (lastReconcileAt !== 0) return
  await runMaintenance(now)
}

/**
 * Periodic housekeeping: flush buffered increments, re-align the in-memory counters with Redis and
 * (much less often) prune expired sorted-set members. Pruning never changes a reported count,
 * because every read is score bounded.
 */
async function runMaintenance(now = Date.now()): Promise<void> {
  if (!isTelemetryEnabled()) {
    // Kill switch, checked before any telemetry work: the flush would write Redis, the legacy
    // migration would scan and rewrite the resource registry, and the reconcile/prune below would read
    // and trim Redis sorted sets. None of that may happen while telemetry is off.
    return
  }

  await flushTelemetryAggregations(false)
  // Re-checked before the first unconditional Redis access of the cycle: telemetry may have been
  // switched off while the flush above was in flight.
  if (!isTelemetryEnabled()) return
  void migrateLegacyResourceSet()

  if (reconcileInFlight) return reconcileInFlight
  const shouldReconcile = now - lastReconcileAt >= TELEMETRY_RECONCILE_INTERVAL_MS
  const shouldPrune = now - lastPruneAt >= TELEMETRY_PRUNE_INTERVAL_MS
  if (!shouldReconcile && !shouldPrune) return

  const request = (async () => {
    // Mark the attempt first: a failing reconcile must not be retried on every ingest event.
    lastReconcileAt = Date.now()
    try {
      // Telemetry may have been switched off since this cycle started.
      if (!isTelemetryEnabled()) return
      const counts = await readStateCounts(shouldPrune)
      if (shouldPrune) {
        lastPruneAt = Date.now()
        await redis.zremrangebyscore(RESOURCE_SET_V2, 0, Date.now() - RESOURCE_SET_STALE_MS)
      }
      hotState.reconcileCounts(counts)
      await reconcileTrackedResources()
      const droppedSessions = hotState.pruneSessions(Date.now(), SESSION_TTL * 1000)
      if (droppedSessions > 0) logger.debug({ droppedSessions }, 'Telemetry session mirror pruned')
      if (hotState.droppedBucketCount > 0) {
        logger.warn({ droppedBuckets: hotState.droppedBucketCount }, 'Telemetry buckets were dropped during a Redis outage')
      }
    } catch (error) {
      logger.warn({ code: getRedisErrorCode(error) }, 'Telemetry reconciliation failed')
    }
  })()

  reconcileInFlight = request
  try {
    await request
  } finally {
    if (reconcileInFlight === request) reconcileInFlight = null
  }
}

/** Re-reads the authoritative per-resource values for the resources this process is tracking. */
async function reconcileTrackedResources(): Promise<void> {
  const tracked = new Set<string>(hotState.listTrackedResources(MAX_PER_RESOURCE_RECONCILE))
  for (const { resource } of hotState.errorCounterSnapshot(MAX_PER_RESOURCE_RECONCILE)) tracked.add(resource)

  for (const resource of tracked) {
    // Stop mid-way if telemetry was switched off: no further reconciliation reads or writes.
    if (!isTelemetryEnabled()) return
    try {
      const now = Date.now()
      const [counter, healthy, buffering, errors] = await Promise.all([
        redis.hgetall(counterKey(resource)),
        redis.zcount(resourceKey(resource, 'HEALTHY'), now, '+inf'),
        redis.zcount(resourceKey(resource, 'BUFFERING'), now, '+inf'),
        redis.zcount(resourceKey(resource, 'ERROR'), now, '+inf'),
      ])
      const states: TelemetryResourceStates = {
        HEALTHY: Math.max(0, Number(healthy) || 0),
        BUFFERING: Math.max(0, Number(buffering) || 0),
        ERROR: Math.max(0, Number(errors) || 0),
      }
      const counterValues: Record<string, number> = {}
      for (const [field, value] of Object.entries(counter)) counterValues[field] = Number(value) || 0
      hotState.reconcileResource(resource, states, counterValues)
    } catch (error) {
      logger.warn({ code: getRedisErrorCode(error), resource }, 'Telemetry resource reconciliation failed')
    }
  }
}

/** One-time move of the legacy unbounded resource set into the score-indexed key. */
async function migrateLegacyResourceSet(): Promise<void> {
  if (legacyResourceMigrationDone) return
  legacyResourceMigrationDone = true
  try {
    const members = await redis.smembers(LEGACY_RESOURCE_SET) as string[]
    if (members.length === 0) return
    const now = Date.now()
    const scoreMembers: Array<string | number> = []
    for (const member of members) scoreMembers.push(now, member)
    await redis.zadd(RESOURCE_SET_V2, ...scoreMembers)
    await redis.del(LEGACY_RESOURCE_SET)
    logger.info({ migratedResources: members.length }, 'Telemetry resource registry migrated to the score-indexed key')
  } catch (error) {
    legacyResourceMigrationDone = false
    logger.warn({ code: getRedisErrorCode(error) }, 'Telemetry resource registry migration failed')
  }
}

function countKey(key: string, pruneExpired: boolean): Promise<number> {
  const now = Date.now()
  return (pruneExpired ? redis.zremrangebyscore(key, 0, now) : Promise.resolve(0))
    .then(() => redis.zcount(key, now, '+inf'))
    .then((total: unknown) => Math.max(0, Number(total) || 0))
}

/** Reads the live per-state viewer counts. The score based ZCOUNT is authoritative, pruning is housekeeping. */
function readStateCounts(pruneExpired: boolean): Promise<TelemetryStateCounts> {
  return Promise.all([
    countKey(ACTIVE_KEY, pruneExpired),
    countKey(stateKey('HEALTHY'), pruneExpired),
    countKey(stateKey('BUFFERING'), pruneExpired),
    countKey(stateKey('ERROR'), pruneExpired),
  ]).then(([total, healthy, buffering, errors]) => ({ total, healthy, buffering, errors }))
}

// ---------------------------------------------------------------- summary

const emptyTelemetrySummary = (): TelemetrySummary => ({
  totalActiveViewers: 0,
  healthyViewers: 0,
  bufferingViewers: 0,
  errorViewers: 0,
  healthPercentage: null,
  bufferingPercentage: null,
  topErroredStreams: [],
})

export async function getTelemetrySummary(): Promise<TelemetrySummary> {
  if (!await getTelemetryEnabled()) return emptyTelemetrySummary()

  const now = Date.now()
  if (summaryCache && summaryCache.expiresAt > now) return summaryCache.value
  if (summaryInFlight) return summaryInFlight

  const request = buildTelemetrySummary()
  summaryInFlight = request
  try {
    const value = await request
    summaryCache = { value, expiresAt: Date.now() + SUMMARY_CACHE_TTL_MS }
    return value
  } finally {
    if (summaryInFlight === request) summaryInFlight = null
  }
}

function buildTelemetrySummary(): Promise<TelemetrySummary> {
  return isSocketClusterActive().then((clusterActive) => clusterActive ? buildSummaryFromRedis() : buildSummaryFromHotState())
}

function toSummary(counts: TelemetryStateCounts, topErroredStreams: TelemetrySummary['topErroredStreams']): TelemetrySummary {
  return {
    totalActiveViewers: counts.total,
    healthyViewers: counts.healthy,
    bufferingViewers: counts.buffering,
    errorViewers: counts.errors,
    healthPercentage: counts.total > 0 ? Math.round((counts.healthy / counts.total) * 100) : null,
    bufferingPercentage: counts.total > 0 ? Math.round((counts.buffering / counts.total) * 100) : null,
    topErroredStreams,
  }
}

/** Single instance: every value comes from the hot state, so a summary costs no Redis commands. */
function buildSummaryFromHotState(): TelemetrySummary {
  const counts = hotState.countsSnapshot()
  const topErroredStreams = hotState.errorCounterSnapshot(RESOURCE_WINDOW)
    .slice(0, 10)
    .map(({ resource, errorCount, counter }) => ({
      resource,
      errorCount,
      activeViewers: hotState.resourceActiveViewers(resource),
      counters: counter,
    }))
  return toSummary(counts, topErroredStreams)
}

/** Multiple instances: aggregation must come from Redis, because the hot state is per process. */
async function buildSummaryFromRedis(): Promise<TelemetrySummary> {
  void migrateLegacyResourceSet()
  const counts = await readStateCounts(false)

  const resources = await redis.zrevrange(RESOURCE_SET_V2, 0, RESOURCE_WINDOW - 1) as string[]
  const inspectableResources = resources.slice(0, RESOURCE_WINDOW)
  const counters = await Promise.all(inspectableResources.map((resource: string) => redis.hgetall(counterKey(resource))))
  const errorStreams = inspectableResources
    .map((resource: string, index: number) => {
      const counter = (counters[index] ?? {}) as Record<string, string>
      const errorCount = Object.entries(counter)
        .filter(([field]) => field.includes('error'))
        .reduce((sum, [, value]) => sum + (Number(value) || 0), 0)
      return { resource, counter, errorCount }
    })
    .filter((entry: { errorCount: number }) => entry.errorCount > 0)

  const errorStreamStates = await Promise.all(errorStreams.map(({ resource }: { resource: string }) => Promise.all([
    countKey(resourceKey(resource, 'HEALTHY'), false),
    countKey(resourceKey(resource, 'BUFFERING'), false),
    countKey(resourceKey(resource, 'ERROR'), false),
  ])))

  const topErroredStreams = errorStreams.map(({ resource, counter, errorCount }: { resource: string; counter: Record<string, unknown>; errorCount: number }, index: number) => {
    const [healthy, buffering, errors] = errorStreamStates[index] as number[]
    return { resource, errorCount, activeViewers: healthy + buffering + errors, counters: counter as Record<string, string | number> }
  })
  topErroredStreams.sort((left: { errorCount: number; resource: string }, right: { errorCount: number; resource: string }) => right.errorCount - left.errorCount || left.resource.localeCompare(right.resource))

  return toSummary(counts, topErroredStreams.slice(0, 10))
}

export async function getTelemetryHistory(minutes: number) {
  if (!await getTelemetryEnabled()) return []
  const now = Date.now()
  const start = now - Math.min(Math.max(minutes, 15), 1440) * 60000
  const timestamps = []
  for (let timestamp = Math.floor(start / 60000) * 60000; timestamp <= now; timestamp += 60000) {
    timestamps.push(timestamp)
  }
  const pipeline = redis.pipeline()
  timestamps.forEach((timestamp) => pipeline.hgetall(bucketKey(timestamp)))
  const results = await pipeline.exec()
  return timestamps.map((timestamp, index) => {
    const [error, rawValues] = results?.[index] ?? [new Error('Telemetry history read failed'), {}]
    if (error) throw error
    const values = rawValues as Record<string, string>
    return { timestamp, ...Object.fromEntries(Object.entries(values).map(([key, value]) => [key, Number(value) || 0])) }
  })
}

// ---------------------------------------------------------------- broadcast

/**
 * Broadcasts only when the payload actually changed: a room emit travels through the Redis adapter,
 * so an unchanged summary must not be published again.
 */
async function broadcastTelemetrySummary(enabled: boolean): Promise<void> {
  if (!enabled || !isTelemetryEnabled()) return
  if (Date.now() - lastBroadcastAt < TELEMETRY_BROADCAST_INTERVAL_MS) return
  lastBroadcastAt = Date.now()
  if (!getIoInstance()) return

  const summary = await getTelemetrySummary()
  const signature = JSON.stringify(summary)
  if (!shouldBroadcastTelemetrySummary(lastBroadcastSignature, summary)) return
  lastBroadcastSignature = signature
  emitStreamHealthSummary({ ...summary })
}

// ---------------------------------------------------------------- runtime lifecycle

/**
 * The maintenance runtime exists only while telemetry is enabled. With telemetry off no interval is
 * registered at all, so no flush, migration, reconciliation, pruning or broadcast can run and no
 * telemetry-specific Redis or database access happens.
 */
const telemetryRuntime = createTelemetryRuntime({
  intervalMs: TELEMETRY_RECONCILE_INTERVAL_MS,
  // Cached settings read: at most one database read per cache window, and none while dormant.
  isEnabled: () => getTelemetryEnabled(),
  runMaintenance: () => runMaintenance(),
  onDisabled: discardPendingTelemetryWork,
  onError: (error) => logger.warn({ error }, 'Telemetry maintenance cycle failed'),
})

/** Applies a known setting value once per change, keeping the timer and the cached state in step. */
function applyTelemetryEnabled(enabled: boolean): void {
  if (telemetryEnabledState === enabled) return
  telemetryEnabledState = enabled
  telemetryRuntime.apply(enabled)
}

/**
 * Startup hook. Reads the telemetry setting once and starts the maintenance runtime only when it is
 * enabled, so an installation that boots with telemetry off never starts telemetry work.
 */
export async function initializeTelemetryRuntime(): Promise<void> {
  applyTelemetryEnabled(await getTelemetryEnabled())
}

/** Shutdown hook: clears the maintenance timer before the process closes. */
export function stopTelemetryRuntime(): void {
  telemetryRuntime.stop()
}
