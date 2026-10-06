import jwt from 'jsonwebtoken'
import bcrypt from 'bcryptjs'
import crypto from 'crypto'
import logger from './logger.js'
import { v4 as uuidv4 } from 'uuid'

const JWT_SECRET = process.env.JWT_SECRET
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET

if (!JWT_SECRET || !JWT_REFRESH_SECRET) {
  logger.error({ secrets: { JWT_SECRET: !!JWT_SECRET, JWT_REFRESH_SECRET: !!JWT_REFRESH_SECRET } }, 'JWT secrets not configured - server cannot start')
  process.exit(1)
}

const ACCESS_TOKEN_SECRET = JWT_SECRET
const REFRESH_TOKEN_SECRET = JWT_REFRESH_SECRET

// Token expiration constants
export const TOKEN_EXPIRY = Object.freeze({
  ACCESS: '15m',
  REFRESH: '30d',
  PASSWORD_RESET: '1h',
} as const)

/**
 * Lifetime of the access-token cookie. Kept in step with `TOKEN_EXPIRY.ACCESS` so the cookie never
 * outlives the token it carries.
 */
export const ACCESS_TOKEN_MAX_AGE_MS = 15 * 60 * 1000

/**
 * Absolute lifetime of a refresh session, and the lifetime of the refresh-token cookie.
 *
 * This is the security boundary that rotation can never extend: an active user is renewed silently
 * for this long and then has to sign in again. Kept in step with `TOKEN_EXPIRY.REFRESH`.
 */
export const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000

/**
 * How long the credential superseded by the last rotation is still accepted.
 *
 * A browser can present the previous refresh token when two tabs (or a reload racing an in-flight
 * refresh) bootstrap at the same moment. Without this window that benign race is indistinguishable
 * from a replayed stolen token, and reuse detection would invalidate every session of the user.
 * The window is long enough to absorb a slow round trip and far too short to keep a leaked token
 * useful.
 */
export const REFRESH_ROTATION_GRACE_MS = 60 * 1000

// Bcrypt cost factor (higher = more secure but slower)
const BCRYPT_SALT_ROUNDS = 12

/**
 * Hashes a password using bcrypt with a secure salt round.
 * @param password - The plaintext password to hash.
 * @returns Promise resolving to the hashed password.
 * @throws Error if hashing fails.
 */
export async function hashPassword(password: string): Promise<string> {
  if (!password || typeof password !== 'string' || password.length === 0) {
    throw new Error('Password must be a non-empty string')
  }
  return bcrypt.hash(password, BCRYPT_SALT_ROUNDS)
}

/**
 * Compares a plaintext password against a bcrypt hash.
 * @param password - The plaintext password to verify.
 * @param hash - The bcrypt hash to compare against.
 * @returns Promise resolving to true if match, false otherwise.
 * @throws Error if comparison fails.
 */
export async function comparePassword(password: string, hash: string): Promise<boolean> {
  if (!password || !hash) {
    return false
  }
  try {
    return await bcrypt.compare(password, hash)
  } catch (error) {
    logger.error({ error }, 'Password comparison failed')
    return false
  }
}

/**
 * Stores the digest of a session's refresh credentials.
 *
 * Refresh tokens are bcrypt-hashed today, which costs hundreds of milliseconds of blocking CPU on
 * every refresh (twice per rotation) and only ever covers the first 72 bytes of the token. A refresh
 * token is a high-entropy signed JWT, not a guessable password, so a single SHA-256 digest binds the
 * whole token, cannot be brute-forced from a leaked database row, and costs microseconds instead.
 *
 * Format (see `serializeSessionRefreshCredentials`):
 *   `sha256$<currentDigest>`
 *   `sha256$<currentDigest>$<previousDigest>$<rotatedAtMs>`
 * A legacy value (a bare bcrypt hash) is still recognised and verified with bcrypt so sessions
 * created before this change keep working until they expire or rotate.
 */
const REFRESH_DIGEST_ALGORITHM = 'sha256'
const REFRESH_DIGEST_PREFIX = `${REFRESH_DIGEST_ALGORITHM}$`
const REFRESH_DIGEST_SEPARATOR = '$'

const isBcryptHash = (value: string): boolean => value.startsWith('$2a$') || value.startsWith('$2b$') || value.startsWith('$2y$')

export interface SessionRefreshCredentials {
  /** Digest of the refresh token currently issued to the client. */
  current: string | null
  /** Digest of the token superseded by the last rotation; accepted only inside the grace window. */
  previous: string | null
  /** Epoch milliseconds of the last rotation. */
  rotatedAtMs: number | null
}

/**
 * Hashes a refresh token into the stored digest form. Deterministic by design: rotation compares the
 * digest of the presented token against the stored one, and a signed JWT already carries the entropy
 * a password hash would have to stretch.
 */
export function digestRefreshToken(token: string): string {
  return `${REFRESH_DIGEST_PREFIX}${crypto.createHash('sha256').update(token).digest('hex')}`
}

/**
 * Hashes a refresh token using SHA-256.
 *
 * Kept asynchronous so existing callers do not change shape. Bcrypt remains the password hash; a
 * refresh token is a high-entropy secret and does not need a slow, truncating key-derivation.
 * @param token - The plaintext refresh token.
 * @returns Promise resolving to the stored digest.
 */
export async function hashRefreshToken(token: string): Promise<string> {
  if (!token || typeof token !== 'string') {
    throw new Error('Refresh token must be a non-empty string')
  }
  return digestRefreshToken(token)
}

/** Compares two digests without leaking their contents through timing. */
function digestsMatch(a: string, b: string): boolean {
  const bufferA = Buffer.from(a, 'utf8')
  const bufferB = Buffer.from(b, 'utf8')
  if (bufferA.length !== bufferB.length) return false
  return crypto.timingSafeEqual(bufferA, bufferB)
}

/** Normalises a digest written with or without its algorithm prefix, rejecting anything malformed. */
function toPrefixedDigest(value: string | null | undefined): string | null {
  if (!value) return null
  const digest = value.startsWith(REFRESH_DIGEST_PREFIX) ? value.slice(REFRESH_DIGEST_PREFIX.length) : value
  return /^[0-9a-f]{64}$/i.test(digest) ? `${REFRESH_DIGEST_PREFIX}${digest.toLowerCase()}` : null
}

/**
 * Reads the stored credential state of a session.
 * @param stored - The raw value of the session's refresh credential column.
 */
export function parseSessionRefreshCredentials(stored: string | null | undefined): SessionRefreshCredentials {
  const empty: SessionRefreshCredentials = { current: null, previous: null, rotatedAtMs: null }
  if (typeof stored !== 'string') return empty

  const value = stored.trim()
  if (!value) return empty

  // Pre-change sessions hold a bcrypt hash; it stays opaque and is verified with bcrypt.
  if (isBcryptHash(value)) {
    return { ...empty, current: value }
  }

  const [prefix, current, previous, rotatedAt] = value.split(REFRESH_DIGEST_SEPARATOR)
  if (prefix !== REFRESH_DIGEST_ALGORITHM) return empty

  const currentDigest = toPrefixedDigest(current)
  if (!currentDigest) return empty

  const rotatedAtMs = Number(rotatedAt)

  return {
    current: currentDigest,
    previous: toPrefixedDigest(previous),
    rotatedAtMs: Number.isFinite(rotatedAtMs) ? rotatedAtMs : null,
  }
}

/**
 * Writes the stored credential state of a session. Digests may be given with or without their
 * algorithm prefix; a previous credential is only retained when it is a well-formed digest.
 * @param credentials - The digests and rotation instant to persist.
 */
export function serializeSessionRefreshCredentials(credentials: SessionRefreshCredentials): string {
  const { current, previous, rotatedAtMs } = credentials
  if (!current) return ''

  // Never rewrite a legacy value into the new format: bcrypt verification depends on the raw hash.
  if (isBcryptHash(current)) return current

  const currentDigest = toPrefixedDigest(current)
  if (!currentDigest) return ''

  const previousDigest = toPrefixedDigest(previous)
  if (!previousDigest || !Number.isFinite(rotatedAtMs)) {
    return currentDigest
  }

  return [REFRESH_DIGEST_ALGORITHM, currentDigest.slice(REFRESH_DIGEST_PREFIX.length), previousDigest.slice(REFRESH_DIGEST_PREFIX.length), String(rotatedAtMs)].join(REFRESH_DIGEST_SEPARATOR)
}

/**
 * Computes the credential state a rotation must persist.
 *
 * When the presented token was the current credential, the one it replaces stays acceptable for the
 * grace window, measured from this rotation. When the presented token was itself the superseded
 * credential (a racing tab or reload), the window keeps its original start so repeated races can
 * never hold it open, and the same superseded credential stays acceptable for the rest of it.
 *
 * @param stored - The session's stored credential value before this rotation.
 * @param presentedCredentialWasCurrent - Whether the presented token matched the current credential.
 * @param newDigest - Digest of the refresh token issued by this rotation.
 * @param now - Rotation instant, epoch milliseconds.
 */
export function nextSessionRefreshCredentials(
  stored: string | null | undefined,
  presentedCredentialWasCurrent: boolean,
  newDigest: string,
  now: number,
): SessionRefreshCredentials {
  const current = parseSessionRefreshCredentials(stored)

  return {
    current: newDigest,
    previous: presentedCredentialWasCurrent ? current.current : current.previous,
    rotatedAtMs: presentedCredentialWasCurrent ? now : current.rotatedAtMs,
  }
}

/**
 * Compares a plaintext refresh token against the stored credentials.
 * @param token - The plaintext refresh token.
 * @param stored - The raw value of the session's refresh credential column.
 * @returns Promise resolving to true only when the token is the session's current credential.
 */
export async function compareRefreshToken(token: string, stored: string | null | undefined): Promise<boolean> {
  if (!token || typeof token !== 'string') {
    return false
  }

  const { current } = parseSessionRefreshCredentials(stored)
  if (!current) return false

  // Legacy sessions: the column still holds a bcrypt hash.
  if (isBcryptHash(current)) {
    try {
      return await bcrypt.compare(token, current)
    } catch (error) {
      logger.error({ error }, 'Refresh token comparison failed')
      return false
    }
  }

  return digestsMatch(digestRefreshToken(token), current)
}

/**
 * Reports whether a presented token is the credential the last rotation superseded, and whether that
 * rotation is still inside the grace window.
 * @param token - The plaintext refresh token presented by the client.
 * @param stored - The raw value of the session's refresh credential column.
 * @param graceMs - How long a superseded credential stays acceptable.
 * @param now - Comparison instant, injectable for tests.
 */
export async function isSupersededRefreshToken(
  token: string,
  stored: string | null | undefined,
  graceMs: number = REFRESH_ROTATION_GRACE_MS,
  now: number = Date.now(),
): Promise<boolean> {
  if (!token || typeof token !== 'string' || graceMs <= 0) {
    return false
  }

  const { previous, rotatedAtMs } = parseSessionRefreshCredentials(stored)
  if (!previous || rotatedAtMs === null) return false
  if (now - rotatedAtMs > graceMs) return false

  return digestsMatch(digestRefreshToken(token), previous)
}


/**
 * Bcrypt digest of a fixed, non-secret placeholder. It is used when no usable stored hash exists, so
 * verifying a one-time code always costs the same whether or not a code was ever issued.
 */
const UNUSED_ONE_TIME_CODE_HASH = '$2b$12$70q97GMm0zdFomdaeZsP5uA/euoVfH6PiU/Eq2ekXbiod7WNMyb.i'

/**
 * Hashes a short numeric one-time code (email verification, password reset).
 *
 * Existing bcrypt is reused with the project's password cost factor because a 6-digit code has too
 * little entropy for a fast hash: anyone who obtains such a digest could brute-force the code itself.
 * Only the digest is persisted; the code is only ever sent to the account's email address.
 * @param code - The plaintext one-time code that was emailed to the user.
 * @returns Promise resolving to the bcrypt hash to store.
 */
export async function hashOneTimeCode(code: string): Promise<string> {
  if (!code || typeof code !== 'string') {
    throw new Error('One-time code must be a non-empty string')
  }
  return bcrypt.hash(code, BCRYPT_SALT_ROUNDS)
}

/**
 * Verifies a submitted one-time code against the stored hash.
 *
 * A missing or non-bcrypt stored value (a legacy sha256 digest, or a value written before hashing was
 * introduced) can never match, and the comparison is still performed against a fixed digest so the
 * response time does not reveal whether a code was issued for the account.
 * @param code - The code submitted by the user.
 * @param hash - The stored hash, if any.
 * @returns Promise resolving to true only when the code matches the stored hash.
 */
export async function verifyOneTimeCode(code: string, hash?: string | null): Promise<boolean> {
  if (!code || typeof code !== 'string') {
    return false
  }

  const storedHash = typeof hash === 'string' && hash.startsWith('$2') ? hash : UNUSED_ONE_TIME_CODE_HASH

  try {
    const matches = await bcrypt.compare(code, storedHash)
    return matches && storedHash !== UNUSED_ONE_TIME_CODE_HASH
  } catch (error) {
    logger.error({ error }, 'One-time code comparison failed')
    return false
  }
}

/**
 * Reports whether a stored one-time code expiry still allows the code to be used.
 * @param expiresAt - The stored expiry timestamp, if any.
 * @param now - Comparison instant, injectable for tests.
 */
export function isOneTimeCodeUsable(expiresAt: Date | null | undefined, now: Date = new Date()): boolean {
  return expiresAt instanceof Date && expiresAt.getTime() > now.getTime()
}

/**
 * Signs an access token with a unique JTI (JWT ID) for session tracking.
 * @param payload - The JWT payload (typically { sub: userId }).
 * @returns The signed JWT access token.
 * @throws Error if signing fails.
 */
export function signAccessToken(payload: object): string {
  try {
    const enhancedPayload = {
      ...payload,
      jti: typeof (payload as { jti?: unknown }).jti === 'string' ? (payload as { jti: string }).jti : uuidv4(),
      iat: Math.floor(Date.now() / 1000),
    }
    return jwt.sign(enhancedPayload, ACCESS_TOKEN_SECRET, { algorithm: 'HS256', expiresIn: TOKEN_EXPIRY.ACCESS })
  } catch (error) {
    logger.error({ error }, 'Failed to sign access token')
    throw new Error('Token generation failed')
  }
}

/**
 * Signs a refresh token with a unique JTI for invalidation tracking.
 * @param payload - The JWT payload (typically { sub: userId }).
 * @param expiresInSeconds - Optional shorter lifetime, used by rotation so a refreshed credential
 *   never outlives the absolute session it belongs to.
 * @returns The signed JWT refresh token.
 * @throws Error if signing fails.
 */
export function signRefreshToken(payload: object, expiresInSeconds?: number): string {
  try {
    const enhancedPayload = {
      ...payload,
      jti: typeof (payload as { jti?: unknown }).jti === 'string' ? (payload as { jti: string }).jti : uuidv4(),
      iat: Math.floor(Date.now() / 1000),
    }
    const expiresIn = expiresInSeconds && expiresInSeconds > 0 ? expiresInSeconds : TOKEN_EXPIRY.REFRESH
    return jwt.sign(enhancedPayload, REFRESH_TOKEN_SECRET, { algorithm: 'HS256', expiresIn })
  } catch (error) {
    logger.error({ error }, 'Failed to sign refresh token')
    throw new Error('Refresh token generation failed')
  }
}

export interface AccessTokenPayload extends jwt.JwtPayload {
  sub: string
  jti: string
  iat: number
}

/**
 * Verifies and decodes an access token.
 * @param token - The JWT access token to verify.
 * @returns The decoded token payload.
 * @throws Error if token is invalid, expired, or verification fails.
 */
export function verifyAccessToken(token: string): AccessTokenPayload {
  if (!token || typeof token !== 'string') {
    throw new Error('Access token must be a non-empty string')
  }

  try {
    return jwt.verify(token, ACCESS_TOKEN_SECRET, { algorithms: ['HS256'] }) as AccessTokenPayload
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      logger.warn({ expiredAt: error.expiredAt }, 'Access token expired')
      throw new Error('Access token expired')
    }
    if (error instanceof jwt.JsonWebTokenError) {
      logger.warn({ message: error.message }, 'Invalid access token')
      throw new Error('Invalid access token')
    }
    logger.error({ error }, 'Access token verification failed')
    throw error
  }
}

export interface RefreshTokenPayload extends jwt.JwtPayload {
  sub: string
  jti: string
  iat: number
}

/**
 * Verifies and decodes a refresh token.
 * @param token - The JWT refresh token to verify.
 * @returns The decoded token payload.
 * @throws Error if token is invalid, expired, or verification fails.
 */
export function verifyRefreshToken(token: string): RefreshTokenPayload {
  if (!token || typeof token !== 'string') {
    throw new Error('Refresh token must be a non-empty string')
  }

  try {
    return jwt.verify(token, REFRESH_TOKEN_SECRET, { algorithms: ['HS256'] }) as RefreshTokenPayload
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      logger.warn({ expiredAt: error.expiredAt }, 'Refresh token expired')
      throw new Error('Refresh token expired')
    }
    if (error instanceof jwt.JsonWebTokenError) {
      logger.warn({ message: error.message }, 'Invalid refresh token')
      throw new Error('Invalid refresh token')
    }
    logger.error({ error }, 'Refresh token verification failed')
    throw error
  }
}
