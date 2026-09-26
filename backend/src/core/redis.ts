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

  client.on('error', (err: Error) => {
    logger.error({ provider: 'primary', code: getRedisErrorCode(err) }, 'Redis connection error')
  })

  return client
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

export const cacheRedis = {
  get: (...args: any[]): Promise<string | null> => runCacheCommand<string | null>((client) => client.get(...args)),
  set: (...args: any[]): Promise<string | null> => runCacheCommand<string | null>((client) => client.set(...args)),
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
        return runCacheCommand((client) => {
          const activePipeline = client.pipeline()
          for (const [command, args] of commands) activePipeline[command](...args)
          return activePipeline.exec()
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
  await Promise.all(backupClients.map(async (client: any, index) => {
    if (!backupUrls[index]) return
    try {
      if (client.status === 'ready') await client.quit()
      else client.disconnect()
    } catch {
      client.disconnect()
    }
  }))
}