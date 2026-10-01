import { redis } from '../../core/redis.js'
import { getIoInstance } from '../../core/socketManager.js'
import logger from '../../core/logger.js'
import { getRedisErrorCode } from '../../core/redisFailover.js'
import { prisma } from '../../core/prisma.js'

export const TELEMETRY_SETTING_KEY = 'telemetry.enabled'

export async function getTelemetryEnabled(): Promise<boolean> {
  const setting = await prisma.setting.findUnique({ where: { key: TELEMETRY_SETTING_KEY } })
  return !setting || setting.deletedAt !== null || setting.value !== 'false'
}

export async function setTelemetryEnabled(enabled: boolean): Promise<void> {
  const value = String(enabled)
  await prisma.setting.upsert({
    where: { key: TELEMETRY_SETTING_KEY },
    update: { value, type: 'boolean', description: 'Enable or disable player telemetry collection.', deletedAt: null },
    create: { key: TELEMETRY_SETTING_KEY, value, type: 'boolean', description: 'Enable or disable player telemetry collection.' },
  })
  getIoInstance()?.emit('applicationSettingChanged', { key: TELEMETRY_SETTING_KEY, value })
}

export const TELEMETRY_EVENT_TYPES = [
  'load_start', 'playing', 'buffering_start', 'buffering_end', 'stalled',
  'fatal_error', 'network_error', 'media_error', 'bitrate_switch', 'heartbeat',
  'ended', 'player_destroyed',
] as const

export type TelemetryEventType = typeof TELEMETRY_EVENT_TYPES[number]
type PlaybackState = 'HEALTHY' | 'BUFFERING' | 'ERROR' | 'STALE'

const SESSION_TTL = 180
const ACTIVE_KEY = 'sportzone:telemetry:active'
const RESOURCE_SET = 'sportzone:telemetry:resources'
const stateKey = (state: PlaybackState) => `sportzone:telemetry:state:${state}`
const resourceKey = (resource: string, state: PlaybackState) => `sportzone:telemetry:resource:${resource}:${state}`
const sessionKey = (id: string) => `sportzone:telemetry:session:${id}`
const bucketKey = (timestamp: number) => `sportzone:telemetry:bucket:${Math.floor(timestamp / 60000) * 60000}`
const counterKey = (resource: string) => `sportzone:telemetry:counter:${resource}`

let lastBroadcastAt = 0
let telemetrySummaryInFlight: Promise<Awaited<ReturnType<typeof buildTelemetrySummary>>> | null = null
let lastGlobalPruneAt = 0
let lastResourcePruneAt = 0
let lastPrunedResource: string | null = null
const TELEMETRY_BROADCAST_INTERVAL_MS = 15_000
const TELEMETRY_PRUNE_INTERVAL_MS = 60_000
const TELEMETRY_RESOURCE_PRUNE_BATCH_SIZE = 50

function safeNumber(value: unknown): number | undefined {
  const number = Number(value)
  return Number.isFinite(number) ? number : undefined
}

function safeResource(event: { streamId?: string; channelId?: string; matchId?: string }): string {
  return `stream:${event.streamId || 'unknown'}|channel:${event.channelId || ''}|match:${event.matchId || ''}`
}

function nextState(type: TelemetryEventType, current: PlaybackState): PlaybackState {
  if (type === 'fatal_error' || type === 'network_error' || type === 'media_error') return 'ERROR'
  if (type === 'buffering_start' || type === 'stalled') return 'BUFFERING'
  if (type === 'playing' || type === 'buffering_end' || type === 'heartbeat') return 'HEALTHY'
  if (type === 'ended' || type === 'player_destroyed') return 'STALE'
  return current
}

function beginPruneWindow(lastPrunedAt: number): boolean {
  const now = Date.now()
  if (now - lastPrunedAt < TELEMETRY_PRUNE_INTERVAL_MS) return false
  return true
}

async function countKey(key: string, pruneExpired: boolean): Promise<number> {
  const now = Date.now()
  if (pruneExpired) await redis.zremrangebyscore(key, 0, now)
  return Math.max(0, Number(await redis.zcount(key, now, '+inf')) || 0)
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
    const accepted = await redis.set(dedupeKey, '1', 'EX', 3600, 'NX')
    if (!accepted) return

    const key = sessionKey(event.sessionId)
    const previous = await redis.hgetall(key)
    const resource = safeResource(event)
    const currentState = (previous.state as PlaybackState | undefined) ?? 'HEALTHY'
    const state = nextState(event.eventType, currentState)
    const sameResource = previous.resource === resource
    const sameMembership = previous.state === state && sameResource
    const expiresAt = Date.now() + SESSION_TTL * 1000

    if (previous.state && previous.resource && !sameMembership) {
      await Promise.all([
        redis.zrem(stateKey(previous.state as PlaybackState), event.sessionId),
        redis.zrem(resourceKey(previous.resource, previous.state as PlaybackState), event.sessionId),
      ])
    }

    if (state === 'STALE') {
      await redis.zrem(ACTIVE_KEY, event.sessionId)
    } else {
      await Promise.all([
        redis.zadd(ACTIVE_KEY, expiresAt, event.sessionId),
        redis.zadd(stateKey(state), expiresAt, event.sessionId),
        redis.zadd(resourceKey(resource, state), expiresAt, event.sessionId),
        ...(sameResource ? [] : [redis.sadd(RESOURCE_SET, resource)]),
        redis.hset(key, 'state', state, 'resource', resource, 'expiresAt', String(expiresAt)),
        redis.expire(key, SESSION_TTL),
      ])
    }

    if (event.eventType !== 'heartbeat') {
      const counter = counterKey(resource)
      const field = event.eventType.replace(/_start$|_end$/g, '_events')
      if (['buffering_events', 'stalled', 'network_error', 'media_error', 'fatal_error', 'bitrate_switch'].includes(field)) {
        await redis.hincrby(counter, field, 1)
        await redis.expire(counter, 24 * 60 * 60)
      }

      const bucket = bucketKey(event.timestamp)
      const pruneGlobalKeys = beginPruneWindow(lastGlobalPruneAt)
      if (pruneGlobalKeys) lastGlobalPruneAt = Date.now()
      await redis.hincrby(bucket, 'activeViewers', await countKey(ACTIVE_KEY, pruneGlobalKeys))
      await redis.hincrby(bucket, 'healthyViewers', await countKey(stateKey('HEALTHY'), pruneGlobalKeys))
      await redis.hincrby(bucket, 'bufferingViewers', await countKey(stateKey('BUFFERING'), pruneGlobalKeys))
      await redis.hincrby(bucket, 'errorViewers', await countKey(stateKey('ERROR'), pruneGlobalKeys))
      await redis.expire(bucket, 24 * 60 * 60)
      await broadcastTelemetrySummary(enabled)
    }
  } catch (error) {
    logger.warn({ code: getRedisErrorCode(error), eventType: event.eventType }, 'Player telemetry ingestion failed')
  }
}

export async function getTelemetrySummary() {
  if (!await getTelemetryEnabled()) return emptyTelemetrySummary()
  if (telemetrySummaryInFlight) return telemetrySummaryInFlight
  const request = buildTelemetrySummary()
  telemetrySummaryInFlight = request
  try {
    return await request
  } finally {
    if (telemetrySummaryInFlight === request) telemetrySummaryInFlight = null
  }
}

const emptyTelemetrySummary = () => ({
  totalActiveViewers: 0,
  healthyViewers: 0,
  bufferingViewers: 0,
  errorViewers: 0,
  healthPercentage: null,
  bufferingPercentage: null,
  topErroredStreams: [],
})

async function buildTelemetrySummary() {
  const pruneGlobalKeys = beginPruneWindow(lastGlobalPruneAt)
  if (pruneGlobalKeys) lastGlobalPruneAt = Date.now()
  const [total, healthy, buffering, errors] = await Promise.all([
    countKey(ACTIVE_KEY, pruneGlobalKeys),
    countKey(stateKey('HEALTHY'), pruneGlobalKeys),
    countKey(stateKey('BUFFERING'), pruneGlobalKeys),
    countKey(stateKey('ERROR'), pruneGlobalKeys),
  ])
  const resources = await redis.smembers(RESOURCE_SET)
  let resourcesToPrune: string[] = []
  if (resources.length > 0 && beginPruneWindow(lastResourcePruneAt)) {
    lastResourcePruneAt = Date.now()
    const orderedResources = [...resources].sort()
    const nextIndex = lastPrunedResource === null
      ? 0
      : orderedResources.findIndex((resource) => resource > lastPrunedResource!)
    const start = nextIndex < 0 ? 0 : nextIndex
    const cleanupCount = Math.min(resources.length, TELEMETRY_RESOURCE_PRUNE_BATCH_SIZE)
    resourcesToPrune = Array.from({ length: cleanupCount }, (_value, index) => orderedResources[(start + index) % orderedResources.length])
    try {
      await Promise.all(resourcesToPrune.flatMap((resource) => ['HEALTHY', 'BUFFERING', 'ERROR']
        .map((state) => redis.zremrangebyscore(resourceKey(resource, state as PlaybackState), 0, Date.now()))))
      lastPrunedResource = resourcesToPrune[resourcesToPrune.length - 1] ?? lastPrunedResource
    } catch (error) {
      logger.warn({ code: getRedisErrorCode(error) }, 'Telemetry resource pruning failed')
    }
  }
  const topErroredStreams = []
  for (const resource of resources.slice(0, 50)) {
    const [counter, healthy, buffering, errors] = await Promise.all([
      redis.hgetall(counterKey(resource)),
      countKey(resourceKey(resource, 'HEALTHY'), false),
      countKey(resourceKey(resource, 'BUFFERING'), false),
      countKey(resourceKey(resource, 'ERROR'), false),
    ])
    const active = healthy + buffering + errors
    const errorCount = Object.entries(counter).filter(([key]) => key.includes('error')).reduce((sum, [, value]) => sum + (Number(value) || 0), 0)
    if (errorCount > 0) topErroredStreams.push({ resource, errorCount, activeViewers: active, counters: counter })
  }
  topErroredStreams.sort((a, b) => b.errorCount - a.errorCount)
  return {
    totalActiveViewers: total,
    healthyViewers: healthy,
    bufferingViewers: buffering,
    errorViewers: errors,
    healthPercentage: total > 0 ? Math.round((healthy / total) * 100) : null,
    bufferingPercentage: total > 0 ? Math.round((buffering / total) * 100) : null,
    topErroredStreams: topErroredStreams.slice(0, 10),
  }
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

async function broadcastTelemetrySummary(enabled: boolean): Promise<void> {
  if (!enabled) return
  if (Date.now() - lastBroadcastAt < TELEMETRY_BROADCAST_INTERVAL_MS) return
  lastBroadcastAt = Date.now()
  const io = getIoInstance()
  if (!io) return
  io.of('/admin').to('admin-room').emit('analytics:stream-health', await getTelemetrySummary())
}