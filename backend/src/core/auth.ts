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
