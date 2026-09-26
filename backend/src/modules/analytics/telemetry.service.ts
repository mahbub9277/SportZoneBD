import { redis } from '../../core/redis.js'
import { getIoInstance } from '../../core/socketManager.js'
import logger from '../../core/logger.js'

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
const TELEMETRY_BROADCAST_INTERVAL_MS = 5_000

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

async function countKey(key: string): Promise<number> {
  const now = Date.now()
  await redis.zremrangebyscore(key, 0, now)
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
}): Promise<void> {
  try {
    const dedupeKey = `sportzone:telemetry:event:${event.eventId}`
    const accepted = await redis.set(dedupeKey, '1', 'EX', 3600, 'NX')
    if (!accepted) return

    const key = sessionKey(event.sessionId)
    const previous = await redis.hgetall(key)
    const resource = safeResource(event)
    const currentState = (previous.state as PlaybackState | undefined) ?? 'HEALTHY'
    const state = nextState(event.eventType, currentState)
    const expiresAt = Date.now() + SESSION_TTL * 1000

    if (previous.state && previous.resource) {
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
        redis.sadd(RESOURCE_SET, resource),
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
      await redis.hincrby(bucket, 'activeViewers', await countKey(ACTIVE_KEY))
      await redis.hincrby(bucket, 'healthyViewers', await countKey(stateKey('HEALTHY')))
      await redis.hincrby(bucket, 'bufferingViewers', await countKey(stateKey('BUFFERING')))
      await redis.hincrby(bucket, 'errorViewers', await countKey(stateKey('ERROR')))
      await redis.expire(bucket, 24 * 60 * 60)
      await broadcastTelemetrySummary()
    }
  } catch (error) {
    logger.warn({ error, eventType: event.eventType }, 'Player telemetry ingestion failed')
  }
}

export async function getTelemetrySummary() {
  const [total, healthy, buffering, errors] = await Promise.all([
    countKey(ACTIVE_KEY), countKey(stateKey('HEALTHY')), countKey(stateKey('BUFFERING')), countKey(stateKey('ERROR')),
  ])
  const resources = await redis.smembers(RESOURCE_SET)
  const topErroredStreams = []
  for (const resource of resources.slice(0, 50)) {
    const [counter, healthy, buffering, errors] = await Promise.all([
      redis.hgetall(counterKey(resource)),
      countKey(resourceKey(resource, 'HEALTHY')),
      countKey(resourceKey(resource, 'BUFFERING')),
      countKey(resourceKey(resource, 'ERROR')),
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
  const now = Date.now()
  const start = now - Math.min(Math.max(minutes, 15), 1440) * 60000
  const buckets = []
  for (let timestamp = Math.floor(start / 60000) * 60000; timestamp <= now; timestamp += 60000) {
    const values = await redis.hgetall(bucketKey(timestamp))
    buckets.push({ timestamp, ...Object.fromEntries(Object.entries(values).map(([key, value]) => [key, Number(value) || 0])) })
  }
  return buckets
}

export async function broadcastTelemetrySummary(): Promise<void> {
  if (Date.now() - lastBroadcastAt < TELEMETRY_BROADCAST_INTERVAL_MS) return
  lastBroadcastAt = Date.now()
  const io = getIoInstance()
  if (!io) return
  io.of('/admin').to('admin-room').emit('analytics:stream-health', await getTelemetrySummary())
}