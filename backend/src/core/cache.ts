import { redis } from './redis.js'
import logger from './logger.js'

// Using a prefix for tags helps organize keys in Redis.
const TAG_PREFIX = 'tag:'
const LOCK_PREFIX = 'lock:'
const LOCK_TTL_SECONDS = 10 // How long to hold a lock
const LOCK_RETRY_DELAY_MS = 50 // How long to wait before retrying to get a value
const LOCK_RETRY_ATTEMPTS = 10 // Max number of retries

/**
 * A generic function to get a value from cache or execute a function to get it and then cache it.
 * This implementation includes a locking mechanism to prevent cache stampedes (dog-piling).
 * When a cache miss occurs, the first request acquires a lock, computes the value, and caches it.
 * Subsequent concurrent requests for the same key will wait and retry fetching from the cache
 * instead of re-computing the value themselves.
 * @param key The cache key.
 * @param fn The function to execute to get the value if it's not in the cache.
 * @param ttlSeconds Time to live in seconds for the cache entry.
 * @param tags Optional array of tags to associate with the cache entry for invalidation.
 * @returns The value from the cache or from the function execution.
 */
export async function cache<T>(
  key: string,
  fn: () => Promise<T>,
  ttlSeconds: number,
  tags: string[] = [],
): Promise<T> {
  // 1. Try to get from cache
  const cachedValue = await tryGetFromCache<T>(key)
  if (cachedValue !== null) {
    return cachedValue
  }

  // 2. Cache miss, try to acquire a lock
  const lockKey = `${LOCK_PREFIX}${key}`
  let lockAcquired: string | null = null
  try {
    lockAcquired = await redis.set(lockKey, '1', 'EX', LOCK_TTL_SECONDS, 'NX')
  } catch (error) {
    logger.warn({ key, error }, 'Redis lock unavailable. Computing value without cache lock.')
    return fn()
  }

  if (lockAcquired) {
    logger.debug({ key }, 'Cache miss, lock acquired. Computing value.')
    try {
      // 3a. Lock acquired, compute the value
      const result = await fn()

      // 4. Cache the result
      if (result !== null && result !== undefined) {
        await setToCache(key, result, ttlSeconds, tags)
      }
      return result
    } finally {
      // 5. Release the lock
      try {
        await redis.del(lockKey)
      } catch (error) {
        logger.warn({ key, error }, 'Redis lock release failed')
      }
    }
  } else {
    // 3b. Lock not acquired, another process is computing. Wait and retry.
    logger.debug({ key }, 'Cache miss, lock held by another process. Retrying...')
    for (let i = 0; i < LOCK_RETRY_ATTEMPTS; i++) {
      await new Promise((resolve) => setTimeout(resolve, LOCK_RETRY_DELAY_MS))
      const retriedValue = await tryGetFromCache<T>(key)
      if (retriedValue !== null) {
        return retriedValue
      }
    }
    // If all retries fail, compute the value directly as a last resort.
    logger.warn({ key }, 'Cache retry attempts failed. Computing value directly.')
    return fn()
  }
}

async function tryGetFromCache<T>(key: string): Promise<T | null> {
  try {
    const cachedValue = await redis.get(key)
    if (cachedValue) {
      logger.debug({ key }, 'Cache hit')
      return JSON.parse(cachedValue) as T
    }
  } catch (error) {
    logger.error({ key, error }, 'Failed to get value from Redis cache.')
  }
  return null
}

async function setToCache<T>(key: string, result: T, ttlSeconds: number, tags: string[]): Promise<void> {
  try {
    const value = JSON.stringify(result)
    const pipeline = redis.pipeline().set(key, value, 'EX', ttlSeconds)
    tags.forEach((tag) => pipeline.sadd(`${TAG_PREFIX}${tag}`, key))
    tags.forEach((tag) => pipeline.expire(`${TAG_PREFIX}${tag}`, ttlSeconds))
    await pipeline.exec()
  } catch (error) {
    logger.error({ key, tags, error }, 'Failed to set value or tags in Redis cache.')
  }
}

/**
 * Adds tags to a cache entry in Redis.
 * This is used by the cacheMiddleware to tag responses.
 * @param key The cache key.
 * @param value The value to cache.
 * @param ttlSeconds Time to live in seconds.
 * @param tags The tags to associate with the cache entry.
 */
export function addTagsToCache(key: string, value: string, ttlSeconds: number, tags: string[] = []) {
  void (async () => {
    try {
      const pipeline = redis.pipeline()
      pipeline.set(key, value, 'EX', ttlSeconds)
      if (tags.length > 0) {
        logger.debug({ key, tags }, 'Adding tags to cache key')
        for (const tag of tags) {
          pipeline.sadd(`${TAG_PREFIX}${tag}`, key)
          pipeline.expire(`${TAG_PREFIX}${tag}`, ttlSeconds)
        }
      }
      await pipeline.exec()
    } catch (error) {
      logger.error({ key, tags, error }, 'Failed to set value or tags in Redis cache.')
    }
  })()
}
/**
 * Invalidates cache entries associated with the given tags.
 * @param tags An array of tags to invalidate.
 */
export async function invalidateTags(tags: string[]) {
  if (tags.length === 0) return
  logger.info({ tags }, 'Invalidating cache for tags')

  const tagKeys = tags.map(tag => `${TAG_PREFIX}${tag}`)

  try {
    // Use SUNION to find all unique cache keys associated with the given tags.
    const keysToInvalidate = await redis.sunion(...tagKeys)

    if (keysToInvalidate.length > 0) {
      logger.debug({ keys: keysToInvalidate }, 'Invalidating cache keys')
      // Use a pipeline to delete the cache entries and the tag sets atomically.
      const pipeline = redis.pipeline()
      pipeline.del(...keysToInvalidate) // Delete the actual data
      pipeline.del(...tagKeys) // Delete the tag sets
      await pipeline.exec()
    } else {
      logger.debug({ tags }, 'No cache keys found for the given tags to invalidate.')
    }
  } catch (error) {
    logger.error({ tags, error }, 'Failed to invalidate cache tags')
  }
}