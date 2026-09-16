import IORedis from 'ioredis'
// Handle different module shapes (CommonJS vs ESM)
const Redis: any = (IORedis as any)?.default ?? IORedis
import logger from './logger.js'

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

const createRedisClient = () => {
  if (!process.env.REDIS_URL) {
    logger.warn('REDIS_URL is not configured. Using a no-op Redis client for this session.')
    return new NoopRedisClient()
  }

  const client = new Redis(process.env.REDIS_URL, {
    keepAlive: 1000 * 60 * 5,
    autoResubscribe: true,
    maxRetriesPerRequest: null,
    enableOfflineQueue: false,
  })

  client.on('connect', () => {
    logger.info('Connected to Redis')
  })

  client.on('error', (err: Error) => {
    logger.error(err, 'Redis connection error')
  })

  return client
}

export const isRedisConfigured = Boolean(process.env.REDIS_URL)
export const redis = createRedisClient()