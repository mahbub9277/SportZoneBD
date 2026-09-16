import rateLimit from 'express-rate-limit';

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
  handler: (_req, res) => {
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
  handler: (_req, res) => {
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
  handler: (_req, res) => {
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