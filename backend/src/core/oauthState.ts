import crypto from 'node:crypto'
import type { CookieOptions, NextFunction, Request, Response } from 'express'
import logger from './logger.js'
import { cacheRedis, isRedisConfigured } from './redis.js'
import { getRedisErrorCode } from './redisFailover.js'

/**
 * OAuth "state" protection for Google sign-in without express-session.
 *
 * The state is a self-contained, HMAC-signed token built from a 256-bit CSPRNG nonce.
 * The same nonce is also written to a short-lived HttpOnly cookie, which is what binds the
 * callback to the browser that started the flow: an attacker cannot read or set that cookie
 * for this domain, so a state (and authorization code) minted in the attacker's browser is
 * rejected in the victim's browser. No server-side session is involved.
 */

export const OAUTH_STATE_COOKIE = 'oauthState'
/** Long enough to finish Google consent, short enough that a captured state is useless later. */
export const OAUTH_STATE_TTL_MS = 5 * 60 * 1000
/** TTL applied to the single-use marker in Redis. */
export const OAUTH_STATE_CLAIM_TTL_SECONDS = Math.ceil(OAUTH_STATE_TTL_MS / 1000)
/** Scoped to the auth routes only, so it is never sent with normal API traffic. */
export const OAUTH_STATE_PATH = '/api/v1/auth'

const STATE_SEPARATOR = '.'
const STATE_KEY_SALT = 'sportzonebd-google-oauth-state'
const STATE_KEY_CONTEXT = 'sportzonebd:google-oauth-state:v1'
const STATE_KEY_BYTES = 32
const NONCE_BYTES = 32
const CLOCK_SKEW_TOLERANCE_MS = 60 * 1000
const CLAIM_KEY_PREFIX = 'sportzone:oauth:state:'
const PENDING_STATE_LOCALS_KEY = 'pendingOAuthState'

export type OAuthStateRejection = 'missing' | 'malformed' | 'forged' | 'expired' | 'mismatch' | 'replayed'

export interface GeneratedOAuthState {
  /** Sent to Google as the `state` parameter. */
  state: string
  /** Random value stored in the browser-bound cookie. */
  nonce: string
}

type RequestWithCookies = Request & { cookies?: Record<string, string> }

let cachedStateKey: Buffer | null = null

/** Domain-separated key derived from the existing JWT secret; no new secret to configure. */
function getStateKey(): Buffer {
  if (cachedStateKey) return cachedStateKey

  const secret = process.env.JWT_SECRET
  if (!secret) throw new Error('JWT_SECRET is not configured')

  cachedStateKey = Buffer.from(crypto.hkdfSync('sha256', secret, STATE_KEY_SALT, STATE_KEY_CONTEXT, STATE_KEY_BYTES))
  return cachedStateKey
}

function sign(payload: string): string {
  return crypto.createHmac('sha256', getStateKey()).update(payload).digest('base64url')
}

function equalInConstantTime(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left)
  const rightBuffer = Buffer.from(right)
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer)
}

export function createOAuthState(now = Date.now()): GeneratedOAuthState {
  const nonce = crypto.randomBytes(NONCE_BYTES).toString('base64url')
  const payload = `${nonce}${STATE_SEPARATOR}${now}`
  return { state: `${payload}${STATE_SEPARATOR}${sign(payload)}`, nonce }
}

/**
 * Returns null when the state is authentic, unexpired and bound to this browser,
 * otherwise the reason it must be rejected.
 */
export function verifyOAuthState(
  providedState: unknown,
  cookieNonce: unknown,
  now = Date.now(),
): OAuthStateRejection | null {
  if (typeof cookieNonce !== 'string' || cookieNonce === '') return 'missing'
  if (typeof providedState !== 'string' || providedState === '') return 'missing'

  const parts = providedState.split(STATE_SEPARATOR)
  if (parts.length !== 3) return 'malformed'

  const [nonce, issuedAtRaw, signature] = parts
  if (!nonce || !issuedAtRaw || !signature) return 'malformed'

  // Signature first: nothing else about the value is trustworthy until it is proven authentic.
  if (!equalInConstantTime(signature, sign(`${nonce}${STATE_SEPARATOR}${issuedAtRaw}`))) return 'forged'

  const issuedAt = Number(issuedAtRaw)
  if (!Number.isInteger(issuedAt)) return 'malformed'
  if (now - issuedAt > OAUTH_STATE_TTL_MS || issuedAt > now + CLOCK_SKEW_TOLERANCE_MS) return 'expired'

  if (!equalInConstantTime(nonce, cookieNonce)) return 'mismatch'

  return null
}

export function googleOAuthStateCookieOptions(maxAgeMs: number = OAUTH_STATE_TTL_MS): CookieOptions {
  return {
    httpOnly: true,
    // Every leg of the OAuth round trip is a top-level navigation back to this API,
    // so Lax is sufficient here and stricter than the None required by the cross-site auth cookies.
    sameSite: 'lax',
    secure: process.env.COOKIE_SECURE === 'true' || process.env.NODE_ENV === 'production',
    path: OAUTH_STATE_PATH,
    maxAge: maxAgeMs,
  }
}

export interface OAuthStateClaimDeps {
  client?: { set: (...args: unknown[]) => Promise<unknown> }
  configured?: boolean
}

/**
 * Atomically marks the nonce as used so the same state cannot be accepted twice,
 * even by two concurrent callbacks. Falls back to cookie-only binding when Redis is unavailable.
 */
export async function claimOAuthStateNonce(nonce: string, deps: OAuthStateClaimDeps = {}): Promise<boolean> {
  const client = deps.client ?? cacheRedis
  const configured = deps.configured ?? isRedisConfigured
  if (!configured) return true

  try {
    // Hashed so the raw nonce never appears in a Redis key.
    const claimKey = `${CLAIM_KEY_PREFIX}${crypto.createHash('sha256').update(nonce).digest('base64url')}`
    const claimed = await client.set(claimKey, '1', 'EX', OAUTH_STATE_CLAIM_TTL_SECONDS, 'NX')
    return claimed === 'OK'
  } catch (error) {
    // Login must not depend on Redis: the cookie binding still prevents cross-browser forgery.
    logger.warn({ code: getRedisErrorCode(error) }, 'OAuth state single-use claim unavailable; relying on cookie binding')
    return true
  }
}

/**
 * Starts the Google flow: writes the browser-binding cookie and hands the signed state to the
 * following passport middleware so Google echoes it back on the callback.
 */
export function beginGoogleOAuthState(_req: Request, res: Response, next: NextFunction): void {
  const { state, nonce } = createOAuthState()
  res.cookie(OAUTH_STATE_COOKIE, nonce, googleOAuthStateCookieOptions())
  res.locals[PENDING_STATE_LOCALS_KEY] = state
  next()
}

export function getPendingOAuthState(res: Response): string | undefined {
  const state = res.locals?.[PENDING_STATE_LOCALS_KEY]
  return typeof state === 'string' ? state : undefined
}

export interface OAuthStateGuardDeps {
  claim?: (nonce: string) => Promise<boolean>
}

/**
 * Verifies the state Google returned and binds it to the cookie written when the flow started.
 * Runs before passport touches the authorization code, so a rejected callback never exchanges a
 * code, never creates a user, and never issues a session, cookie, or token.
 */
export function requireGoogleOAuthState(failureRedirect: string, deps: OAuthStateGuardDeps = {}) {
  const claim = deps.claim ?? claimOAuthStateNonce

  return function googleOAuthStateGuard(req: Request, res: Response, next: NextFunction): void {
    const body = req.body as { state?: unknown } | undefined
    const providedState = typeof req.query?.state === 'string'
      ? req.query.state
      : typeof body?.state === 'string'
        ? body.state
        : undefined
    const cookieNonce = (req as RequestWithCookies).cookies?.[OAUTH_STATE_COOKIE]

    const rejection = verifyOAuthState(providedState, cookieNonce)

    // Consume the binding cookie on every callback attempt so the state cannot be replayed.
    res.clearCookie(OAUTH_STATE_COOKIE, googleOAuthStateCookieOptions())

    if (rejection) {
      // Log the reason only; the state value itself must never be logged.
      logger.warn({ reason: rejection }, 'Google OAuth state verification failed')
      res.redirect(failureRedirect)
      return
    }

    const nonce = (providedState as string).split(STATE_SEPARATOR)[0]
    claim(nonce)
      .then((claimed) => {
        if (!claimed) {
          logger.warn({ reason: 'replayed' }, 'Google OAuth state verification failed')
          res.redirect(failureRedirect)
          return
        }
        next()
      })
      .catch(next)
  }
}
