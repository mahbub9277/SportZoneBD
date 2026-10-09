import IORedis from 'ioredis'
// Handle different module shapes (CommonJS vs ESM)
const Redis: any = (IORedis as any)?.default ?? IORedis
import logger from './logger.js'
import { getRedisErrorCode, RedisFailoverManager } from './redisFailover.js'

class NoopRedisPipeline {
  set(..._args: unknown[]): this { return this }
  sadd(): this { return this }
  srem(): this { return this }
  expire(): this { return this }
  del(): this { return this }
  async exec(): Promise<unknown[]> { return [] }
}

class NoopRedisClient {
  on(): this { return this }
  async get(..._args: unknown[]): Promise<null> { return null }
  async mget(...keys: unknown[]): Promise<(string | null)[]> { return keys.map(() => null) }
  async connect(): Promise<'OK'> { return 'OK' }
  async ping(): Promise<'PONG'> { return 'PONG' }
  async set(..._args: unknown[]): Promise<'OK'> { return 'OK' }
  async del(..._args: unknown[]): Promise<number> { return 0 }
  async eval(..._args: unknown[]): Promise<number> { return 0 }
  async incr(..._args: unknown[]): Promise<number> { return 0 }
  async decr(): Promise<number> { return 0 }
  async quit(): Promise<'OK'> { return 'OK' }
  pipeline(): NoopRedisPipeline { return new NoopRedisPipeline() }
  async sadd(..._args: unknown[]): Promise<number> { return 0 }
  async srem(..._args: unknown[]): Promise<number> { return 0 }
  async smembers(..._args: unknown[]): Promise<string[]> { return [] }
  async hgetall(..._args: unknown[]): Promise<Record<string, string>> { return {} }
  async hset(..._args: unknown[]): Promise<number> { return 0 }
  async hincrby(..._args: unknown[]): Promise<number> { return 0 }
  async sunion(): Promise<string[]> { return [] }
  async zremrangebyscore(..._args: unknown[]): Promise<number> { return 0 }
  async zcount(..._args: unknown[]): Promise<number> { return 0 }
  async zadd(..._args: unknown[]): Promise<number> { return 0 }
  async zrem(..._args: unknown[]): Promise<number> { return 0 }
  async zrange(..._args: unknown[]): Promise<string[]> { return [] }
  async zrevrange(..._args: unknown[]): Promise<string[]> { return [] }
  async zcard(..._args: unknown[]): Promise<number> { return 0 }
  async expire(..._args: unknown[]): Promise<number> { return 0 }
  duplicate(): this { return this }
}

export const primaryRedisUrl = process.env.REDIS_URL_PRIMARY?.trim() || process.env.REDIS_URL?.trim() || ''

const createRedisClient = () => {
  if (!primaryRedisUrl) {
    logger.warn('REDIS_URL_PRIMARY is not configured. Using a no-op Redis client for this session.')
    return new NoopRedisClient()
  }

  const client = new Redis(primaryRedisUrl, {
    keepAlive: 1000 * 60 * 5,
    autoResubscribe: true,
    maxRetriesPerRequest: null,
    enableOfflineQueue: false,
    retryStrategy: (attempt: number) => Math.min(250 * (2 ** Math.min(attempt - 1, 7)), 30_000),
  })

  client.on('connect', () => {
    logger.info({ provider: 'primary' }, 'Connected to Redis')
  })

  attachRedisClientLogging(client, 'primary')

  return client
}

/**
 * How often one client may repeat its connection-error line before the repeats are summarised.
 *
 * A flapping provider emits one connection error per reconnection attempt; without a bound the same
 * failure would dominate the log for as long as the outage lasts. The suppressed count keeps the
 * frequency visible in the next line, so throttling never hides that an outage is ongoing.
 */
const REDIS_ERROR_LOG_INTERVAL_MS = 30_000

/** The minimal logger surface these lifecycle helpers need; injectable so they stay testable. */
export interface RedisLifecycleLogger {
  info(fields: Record<string, unknown>, message: string): void
  warn(fields: Record<string, unknown>, message: string): void
  error(fields: Record<string, unknown>, message: string): void
}

/**
 * Attaches bounded, structured connection logging to any ioredis-like client.
 *
 * The Socket.IO adapter instantiates its own pub/sub clients, and one of them printing
 * "missing 'error' handler on this Redis client" to the console is the only sign the adapter is
 * unhealthy. This gives every client the same structured line, an error code, its connection status
 * and a recovery line, while keeping the log bounded during an outage.
 */
export function attachRedisClientLogging(client: any, label: string, log: RedisLifecycleLogger = logger): void {
  if (typeof client?.on !== 'function') return

  let lastLoggedAt = 0
  let suppressed = 0

  client.on('error', (error: unknown) => {
    const now = Date.now()
    if (now - lastLoggedAt < REDIS_ERROR_LOG_INTERVAL_MS) {
      suppressed += 1
      return
    }
    log.error({
      provider: label,
      code: getRedisErrorCode(error),
      status: typeof client.status === 'string' ? client.status : 'unknown',
      suppressedSinceLastLog: suppressed,
    }, 'Redis connection error')
    suppressed = 0
    lastLoggedAt = now
  })

  client.on('ready', () => {
    if (lastLoggedAt === 0 && suppressed === 0) return
    log.info({ provider: label, suppressedDuringOutage: suppressed }, 'Redis connection restored')
    suppressed = 0
    lastLoggedAt = 0
  })
}

/**
 * Closes a Redis client without assuming it can still write.
 *
 * `quit()` is only safe while the client is connected: ioredis rejects it with "Stream isn't
 * writeable and enableOfflineQueue options is false" as soon as the socket is gone, which is exactly
 * the failure a shutdown during a Redis outage hits. A client that cannot be quit gracefully is
 * disconnected instead, and a close failure is reported but never allowed to abort the shutdown
 * sequence or mask which step failed.
 */
export async function closeRedisClientSafely(client: any, label: string, log: RedisLifecycleLogger = logger): Promise<void> {
  if (!client) return

  try {
    if (typeof client.quit !== 'function') {
      client.disconnect?.()
      return
    }

    if (client.status === 'ready') {
      await client.quit()
      log.info({ provider: label }, 'Redis client disconnected')
      return
    }

    client.disconnect?.()
    log.info({ provider: label, status: typeof client.status === 'string' ? client.status : 'unknown' }, 'Redis client disconnected without a graceful quit')
  } catch (error) {
    try {
      client.disconnect?.()
    } catch {
      // The client is already gone; there is nothing left to release.
    }
    log.warn({ provider: label, code: getRedisErrorCode(error) }, 'Redis client could not be quit; disconnected instead')
  }
}

export const isRedisConfigured = Boolean(primaryRedisUrl)
export const redis = createRedisClient()

const backupUrls = [
  process.env.REDIS_URL_BACKUP_1?.trim(),
  process.env.REDIS_URL_BACKUP_2?.trim(),
  process.env.REDIS_URL_BACKUP_3?.trim(),
]

const backupClients = backupUrls.map((url, index) => {
  if (!url) return new NoopRedisClient()
  const client = new Redis(url, {
    lazyConnect: true,
    autoResubscribe: false,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    connectTimeout: 3_000,
    retryStrategy: (attempt: number) => attempt <= 2 ? attempt * 250 : null,
  })
  client.on('error', (error: Error) => {
    logger.warn({ provider: `backup-${index + 1}`, code: getRedisErrorCode(error) }, 'Redis backup connection error')
  })
  return client
})

const redisFailover = new RedisFailoverManager<any>({
  providers: [
    { name: 'primary', client: redis, configured: isRedisConfigured },
    ...backupClients.map((client, index) => ({
      name: `backup-${index + 1}`,
      client,
      configured: Boolean(backupUrls[index]),
    })),
  ],
  logger,
})

const runCacheCommand = <Result>(operation: (client: any) => Promise<Result>) => redisFailover.execute(operation)

/**
 * Bounded accounting of the value bytes the cache client moves.
 *
 * A command count alone cannot say whether Redis traffic came from a few large values or many small
 * ones, and Upstash does not break bandwidth down per command. These counters add up the value sizes
 * seen by the cache client and emit one summary every few hundred commands — no timer, no per-command
 * log line, no values, and only the key's path (never its query string, never user data). The largest
 * value seen is reported so an oversized payload can be named instead of guessed at.
 */
const REDIS_ACCOUNTING_INTERVAL_COMMANDS = 500
const REDIS_ACCOUNTING_MAX_KEY_LENGTH = 120
const redisAccounting = { commands: 0, readBytes: 0, writeBytes: 0, largestValueBytes: 0, largestValueKey: '' }

/** Characters are a good proxy for bytes here: the cached payloads are ASCII JSON. */
const approximateBytes = (value: unknown): number => (typeof value === 'string' ? value.length : 0)

function accountRedisCommand(key: unknown, bytes: number, direction: 'read' | 'write'): void {
  redisAccounting.commands += 1
  if (direction === 'read') redisAccounting.readBytes += bytes
  else redisAccounting.writeBytes += bytes

  if (bytes > redisAccounting.largestValueBytes) {
    redisAccounting.largestValueBytes = bytes
    const path = typeof key === 'string' ? key.split('?')[0] : ''
    redisAccounting.largestValueKey = path.length > REDIS_ACCOUNTING_MAX_KEY_LENGTH ? `${path.slice(0, REDIS_ACCOUNTING_MAX_KEY_LENGTH)}…` : path
  }

  if (redisAccounting.commands % REDIS_ACCOUNTING_INTERVAL_COMMANDS !== 0) return

  logger.info({ ...redisAccounting, windowCommands: REDIS_ACCOUNTING_INTERVAL_COMMANDS }, 'Redis cache byte accounting')
  redisAccounting.commands = 0
  redisAccounting.readBytes = 0
  redisAccounting.writeBytes = 0
  redisAccounting.largestValueBytes = 0
  redisAccounting.largestValueKey = ''
}

export const cacheRedis = {
  async get(...args: any[]): Promise<string | null> {
    const value = await runCacheCommand<string | null>((client) => client.get(...args))
    accountRedisCommand(args[0], approximateBytes(value), 'read')
    return value
  },
  async mget(...args: any[]): Promise<(string | null)[]> {
    const values = await runCacheCommand<(string | null)[]>((client) => client.mget(...args))
    accountRedisCommand(args[0], values.reduce((total, value) => total + approximateBytes(value), 0), 'read')
    return values
  },
  async set(...args: any[]): Promise<string | null> {
    const result = await runCacheCommand<string | null>((client) => client.set(...args))
    accountRedisCommand(args[0], approximateBytes(args[1]), 'write')
    return result
  },
  eval: (...args: unknown[]): Promise<number> => runCacheCommand<number>((client) => client.eval(...args)),
  del: (...args: any[]): Promise<number> => runCacheCommand<number>((client) => client.del(...args)),
  sunion: (...args: any[]): Promise<string[]> => runCacheCommand<string[]>((client) => client.sunion(...args)),
  pipeline: () => {
    const commands: Array<[string, unknown[]]> = []
    const pipeline = {
      set(...args: unknown[]) { commands.push(['set', args]); return pipeline },
      sadd(...args: unknown[]) { commands.push(['sadd', args]); return pipeline },
      expire(...args: unknown[]) { commands.push(['expire', args]); return pipeline },
      del(...args: unknown[]) { commands.push(['del', args]); return pipeline },
      exec() {
        // The cache writes large values through the pipeline, so its `set` commands are the write side
        // of the same accounting the single-command path reports.
        const writeBytes = commands.reduce((total, [command, args]) => (
          command === 'set' ? total + approximateBytes(args[1]) : total
        ), 0)
        const firstSetKey = commands.find(([command]) => command === 'set')?.[1][0]

        return runCacheCommand((client) => {
          const activePipeline = client.pipeline()
          for (const [command, args] of commands) activePipeline[command](...args)
          return activePipeline.exec()
        }).then((result) => {
          accountRedisCommand(firstSetKey, writeBytes, 'write')
          return result
        })
      },
    }
    return pipeline
  },
}

export function getPrimaryRedisStatus(): string {
  return typeof (redis as any).status === 'string' ? (redis as any).status : 'unavailable'
}

export async function closeRedisFailoverClients(): Promise<void> {
  redisFailover.stop()
  await Promise.all(backupClients.map((client: any, index) => {
    if (!backupUrls[index]) return Promise.resolve()
    return closeRedisClientSafely(client, `backup-${index + 1}`)
  }))
}