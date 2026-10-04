import type { NextFunction, Request, Response } from 'express'
import { isAllowedOrigin } from '../../config/cors.js'
import { ForbiddenError } from '../errors.js'

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

function firstHeaderValue(value: string | string[] | undefined): string | undefined {
  const header = Array.isArray(value) ? value[0] : value
  return typeof header === 'string' && header.trim() ? header.trim() : undefined
}

function originFromUrl(value: string | undefined): string | undefined {
  if (!value) return undefined
  try {
    return new URL(value).origin
  } catch {
    return undefined
  }
}

function carriesCookies(req: Request): boolean {
  return Boolean(firstHeaderValue(req.headers.cookie))
}

/**
 * Rejects cross-site state-changing requests.
 *
 * The API authenticates with HttpOnly cookies that must be `SameSite=None` in production
 * because the frontend (Vercel) and the API (Render) are different sites, so browsers attach
 * the auth cookies to cross-site requests and SameSite cannot serve as the CSRF defence.
 * This guard restores it by requiring a trusted `Origin` (or `Referer`) whenever a request
 * that changes state carries cookies.
 *
 * Requests without cookies (payment webhooks, public POSTs, health checks) and safe methods
 * (GET/HEAD/OPTIONS, which are also exempt from CSRF by definition) are unaffected.
 */
export function verifyRequestOrigin(req: Request, _res: Response, next: NextFunction): void {
  if (SAFE_METHODS.has(req.method.toUpperCase())) {
    next()
    return
  }

  if (!carriesCookies(req)) {
    next()
    return
  }

  const origin = firstHeaderValue(req.headers.origin)
  if (origin) {
    if (isAllowedOrigin(origin)) {
      next()
      return
    }

    next(new ForbiddenError('Cross-site request blocked'))
    return
  }

  // Fall back to Referer only when Origin is absent so a mismatched Origin is never overridden.
  const refererOrigin = originFromUrl(firstHeaderValue(req.headers.referer))
  if (refererOrigin && isAllowedOrigin(refererOrigin)) {
    next()
    return
  }

  next(new ForbiddenError('Cross-site request blocked'))
}
