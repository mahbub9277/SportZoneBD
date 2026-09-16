import { type Request, type Response, type NextFunction } from 'express'
import { redis } from '../redis.js'
import logger from '../logger.js'
import { addTagsToCache } from '../cache.js'

/**
 * A middleware factory for caching GET request responses in Redis.
 *
 * @param ttlSeconds - The Time-To-Live for the cache entry in seconds.
 * @param tags - An array of tags to associate with the cache entry for invalidation.
 * @returns An Express middleware function.
 */
export const cacheMiddleware = (ttlSeconds: number, tags: string[] = []) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    // Only cache GET requests
    if (req.method !== 'GET') {
      return next()
    }

    const cacheKey = req.originalUrl // Use the full URL as the cache key

    try {
      const cachedData = await redis.get(cacheKey)

      if (cachedData) {
        try {
          logger.debug({ key: cacheKey }, 'Cache hit')
          return res.status(200).json(JSON.parse(cachedData))
        } catch (error) {
          logger.warn({ key: cacheKey, error }, 'Invalid cached JSON. Rebuilding response.')
          await redis.del(cacheKey)
        }
      }

      // Cache miss: proceed to the controller, but intercept the response
      logger.debug({ key: cacheKey }, 'Cache miss')
      const originalJson = res.json.bind(res)
      res.json = (body: any): Response => {
        addTagsToCache(cacheKey, JSON.stringify(body), ttlSeconds, tags)
        return originalJson(body)
      }
      return next()
    } catch (error) {
      logger.error(error, 'Redis cache middleware error')
      return next() // On Redis error, proceed without caching
    }
  }
}