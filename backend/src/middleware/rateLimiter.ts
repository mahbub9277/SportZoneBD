import rateLimit from 'express-rate-limit';
import type { Request, Response } from 'express'

const rateLimitResponse = {
  error: 'Too many requests. Please wait a moment and try again.',
}

export const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 250,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skipSuccessfulRequests: false,
  message: rateLimitResponse,
  handler: (_req: Request, res: Response) => {
    res.status(429).json({
      ...rateLimitResponse,
      retryAfter: res.getHeader('Retry-After'),
    })
  },
})

export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // Limit auth-related routes more strictly
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: rateLimitResponse,
  handler: (_req: Request, res: Response) => {
    res.status(429).json({ ...rateLimitResponse, retryAfter: res.getHeader('Retry-After') })
  },
})

export const publicApiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 80, // Balanced limit for read-heavy public endpoints with caching
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: rateLimitResponse,
  handler: (_req: Request, res: Response) => {
    res.status(429).json({ ...rateLimitResponse, retryAfter: res.getHeader('Retry-After') })
  },
})

export const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.UPLOAD_RATE_LIMIT ?? 30),
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: rateLimitResponse,
})

export const paymentLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.PAYMENT_RATE_LIMIT ?? 30),
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: rateLimitResponse,
})

/**
 * Rate control for bulk notification campaigns.
 *
 * A campaign fans out to every matching recipient, so the limit is per sending operator and per hour
 * rather than per minute: it exists to stop a repeated or accidental mass send, not to throttle a
 * legitimate campaign. The same limiter guards the email campaign route.
 */
export const campaignLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: Number(process.env.CAMPAIGN_RATE_LIMIT ?? 20),
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: rateLimitResponse,
  handler: (_req: Request, res: Response) => {
    res.status(429).json({
      ...rateLimitResponse,
      message: 'Too many campaigns started. Please wait before sending another one.',
      retryAfter: res.getHeader('Retry-After'),
    })
  },
})