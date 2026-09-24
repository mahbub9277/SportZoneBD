import type { Request, Response, NextFunction } from 'express'
import { PremiumDeviceLimitError, PremiumRequiredError } from './errors.js'
import { authenticate } from './middleware.js'
import * as subscriptionService from '../modules/subscriptions/subscription.service.js'
import { redis } from './redis.js'
import { randomUUID } from 'node:crypto'

const PREMIUM_DEVICE_TTL_SECONDS = 5 * 60

async function reservePremiumDevice(req: Request, res: Response, userId: string, maxDevices: number): Promise<void> {
  const requestWithCookies = req as Request & { cookies?: Record<string, string> }
  const existingDeviceId = requestWithCookies.cookies?.sportzonePremiumDevice
  const deviceId = existingDeviceId || randomUUID()
  if (!existingDeviceId) {
    res.cookie('sportzonePremiumDevice', deviceId, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.COOKIE_SECURE === 'true',
      maxAge: PREMIUM_DEVICE_TTL_SECONDS * 1000,
    })
  }

  const key = `sportzone:premium-devices:${userId}`
  const now = Date.now()
  const expiresAt = now + PREMIUM_DEVICE_TTL_SECONDS * 1000
  const result = await redis.eval(
    "redis.call('zremrangebyscore', KEYS[1], '-inf', ARGV[1]); local existing = redis.call('zscore', KEYS[1], ARGV[2]); if existing then redis.call('zadd', KEYS[1], ARGV[3], ARGV[2]); redis.call('expire', KEYS[1], ARGV[4]); return 1; end; if redis.call('zcard', KEYS[1]) < tonumber(ARGV[5]) then redis.call('zadd', KEYS[1], ARGV[3], ARGV[2]); redis.call('expire', KEYS[1], ARGV[4]); return 1; end; return 0",
    1,
    key,
    now,
    deviceId,
    expiresAt,
    PREMIUM_DEVICE_TTL_SECONDS,
    maxDevices,
  )
  if (Number(result) !== 1) throw new PremiumDeviceLimitError(maxDevices)
}

async function verifyPremiumAccess(req: Request, res: Response): Promise<void> {
  if (!req.cookies?.accessToken) {
    throw new PremiumRequiredError()
  }

  await new Promise<void>((resolve, reject) => {
    authenticate(req, res, (authError?: unknown) => {
      if (authError) {
        reject(new PremiumRequiredError())
        return
      }
      resolve()
    })
  })

  const authenticatedRequest = req as Request & { user?: { id: string } }
  const userId = authenticatedRequest.user?.id
  if (!userId) {
    throw new PremiumRequiredError()
  }

  const subscription = await subscriptionService.getUserSubscription(userId)
  if (!subscription) {
    throw new PremiumRequiredError()
  }
  const subscriptionWithPlan = subscription as { plan?: { maxDevices?: number } }
  await reservePremiumDevice(req, res, userId, Number(subscriptionWithPlan.plan?.maxDevices ?? 1))
}

export async function hasPremiumAccess(req: Request, res: Response): Promise<boolean> {
  try {
    await verifyPremiumAccess(req, res)
    return true
  } catch (error) {
    if (error instanceof PremiumRequiredError) {
      return false
    }
    throw error
  }
}

export async function requirePremiumAccess(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await verifyPremiumAccess(req, res)
    next()
  } catch (error) {
    next(error)
  }
}

export { verifyPremiumAccess }
