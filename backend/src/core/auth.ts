import jwt from 'jsonwebtoken'
import bcrypt from 'bcryptjs'
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
  REFRESH: '7d',
  PASSWORD_RESET: '1h',
} as const)

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
 * Hashes a refresh token using bcrypt.
 * @param token - The plaintext refresh token.
 * @returns Promise resolving to the hashed token.
 */
export async function hashRefreshToken(token: string): Promise<string> {
  return bcrypt.hash(token, BCRYPT_SALT_ROUNDS)
}

/**
 * Compares a plaintext refresh token against a bcrypt hash.
 * @param token - The plaintext refresh token.
 * @param hash - The bcrypt hash to compare against.
 * @returns Promise resolving to true if match, false otherwise.
 */
export async function compareRefreshToken(token: string, hash: string): Promise<boolean> {
  if (!token || !hash) {
    return false
  }
  try {
    return await bcrypt.compare(token, hash)
  } catch (error) {
    logger.error({ error }, 'Refresh token comparison failed')
    return false
  }
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
 * @returns The signed JWT refresh token.
 * @throws Error if signing fails.
 */
export function signRefreshToken(payload: object): string {
  try {
    const enhancedPayload = {
      ...payload,
      jti: typeof (payload as { jti?: unknown }).jti === 'string' ? (payload as { jti: string }).jti : uuidv4(),
      iat: Math.floor(Date.now() / 1000),
    }
    return jwt.sign(enhancedPayload, REFRESH_TOKEN_SECRET, { algorithm: 'HS256', expiresIn: TOKEN_EXPIRY.REFRESH })
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
