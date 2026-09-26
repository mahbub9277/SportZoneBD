import { type Request, type Response, type NextFunction } from 'express'
import { cacheRedis } from '../redis.js'
import logger from '../logger.js'
import { addTagsToCache } from '../cache.js'
import { getRedisErrorCode } from '../redisFailover.js'

const RESPONSE_MISS = Symbol('response-miss')
const inFlightResponses = new Map<string, Promise<unknown | typeof RESPONSE_MISS>>()

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
    const existingResponse = inFlightResponses.get(cacheKey)
    if (existingResponse) {
      const sharedBody = await existingResponse
      if (sharedBody === RESPONSE_MISS) return next()
      return res.status(200).json(sharedBody)
    }

    let resolveResponse!: (body: unknown | typeof RESPONSE_MISS) => void
    const pendingResponse = new Promise<unknown | typeof RESPONSE_MISS>((resolve) => {
      resolveResponse = resolve
    })
    inFlightResponses.set(cacheKey, pendingResponse)
    let responseSettled = false
    let shouldCacheResponse = false
    const releaseResponse = (body: unknown | typeof RESPONSE_MISS) => {
      if (responseSettled) return
      responseSettled = true
      resolveResponse(body)
    }
    const removeResponse = () => {
      releaseResponse(RESPONSE_MISS)
      if (inFlightResponses.get(cacheKey) === pendingResponse) inFlightResponses.delete(cacheKey)
    }
    res.once('close', removeResponse)
    res.once('finish', removeResponse)
    const originalJson = res.json.bind(res)
    res.json = (body: any): Response => {
      if (res.statusCode >= 400) releaseResponse(RESPONSE_MISS)
      else releaseResponse(body)
      if (shouldCacheResponse && res.statusCode < 400) addTagsToCache(cacheKey, JSON.stringify(body), ttlSeconds, tags)
      return originalJson(body)
    }

    try {
      const cachedData = await cacheRedis.get(cacheKey)

      if (cachedData) {
        try {
          logger.debug({ key: cacheKey }, 'Cache hit')
          return res.status(200).json(JSON.parse(cachedData))
        } catch (error) {
          logger.warn({ code: getRedisErrorCode(error) }, 'Invalid cached JSON. Rebuilding response.')
          await cacheRedis.del(cacheKey)
        }
      }

      // Cache miss: proceed to the controller, but intercept the response
      logger.debug({ key: cacheKey }, 'Cache miss')
      shouldCacheResponse = true
      return next()
    } catch (error) {
      logger.error({ code: getRedisErrorCode(error) }, 'Redis cache middleware error')
      shouldCacheResponse = true
      return next() // On Redis error, proceed without caching
    }
  }
}