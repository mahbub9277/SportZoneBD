import type { Request, Response, NextFunction } from 'express'
import { ZodError } from 'zod'
import { AppError, UnauthorizedError, ForbiddenError, PremiumRequiredError } from './errors.js'
import { verifyAccessToken } from './auth.js'
import { cache } from './cache.js'
import { prisma } from './prisma.js'
import logger from './logger.js'

interface UserPayload {
  id: string
  email: string | null
  fullName: string | null
  avatar: string | null
  roles: string[]
  permissions: string[]
}

export interface AuthenticatedRequest extends Request {
  user?: UserPayload
}

function getAccessToken(req: Request): string | undefined {
  const cookieToken = req.cookies?.accessToken
  return typeof cookieToken === 'string' && cookieToken.trim() ? cookieToken.trim() : undefined
}

export async function authenticate(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const token = getAccessToken(req)

  if (!token) {
    next(new UnauthorizedError('Authentication required'))
    return
  }

  try {
    const payload = verifyAccessToken(token)

    if (typeof payload.sub !== 'string' || typeof payload.jti !== 'string') {
      next(new UnauthorizedError('Invalid token payload'))
      return
    }

    const user = await cache(
      `user-auth:${payload.sub}`,
      () =>
        prisma.user.findUnique({
          where: { id: payload.sub, deletedAt: null },
          select: {
            id: true,
            isActive: true,
            isSuspended: true,
            isBanned: true,
            fullName: true,
            email: true,
            avatar: true,
            roles: {
              select: {
                role: { select: { name: true, permissions: { select: { key: true } } } },
              },
            },
          },
        }),
      10, // Keep authorization changes responsive while retaining short-lived stampede protection.
      [`user:${payload.sub}`],
    );

    const session = await prisma.session.findFirst({
      where: {
        userId: payload.sub,
        deletedAt: null,
        id: payload.jti,
      },
      select: { id: true }, // Only need to check for existence
    });

    if (!session || !user) {
      next(new UnauthorizedError('User account or session is unavailable'));
      return
    }

    if (user.isSuspended || user.isBanned || !user.isActive) {
      const reason = user.isBanned ? 'banned' : user.isSuspended ? 'suspended' : 'deactivated'
      next(new ForbiddenError(`Your account is ${reason}. Please contact an administrator.`))
      return
    }

    // Attach a comprehensive user object to the request
    req.user = {
      id: user.id,
      fullName: user.fullName,
      email: user.email,
      avatar: user.avatar,
      roles: user.roles.map((r) => r.role.name),
      permissions: [...new Set(user.roles.flatMap((r) => r.role.permissions.map((p) => p.key)))],
    }

    next()
  } catch (error) {
    const isTokenVerificationFailure = error instanceof Error && (
      error.name === 'JsonWebTokenError'
      || error.name === 'TokenExpiredError'
      || error.message === 'Access token expired'
      || error.message === 'Invalid access token'
    )

    if (isTokenVerificationFailure) {
      next(new UnauthorizedError('Invalid or expired token'))
      return
    }
    next(error)
  }
}

export async function getUserRoles(userId: string): Promise<string[]> {
  const cacheKey = `user-roles:${userId}`
  const ttlSeconds = 60 * 5 // Cache for 5 minutes

  return cache(
    cacheKey,
    async () => {
      const userRoles = await prisma.userRole.findMany({
        where: { userId: userId, deletedAt: null },
        include: { role: true },
      })
      return userRoles.map((userRole) => userRole.role.name)
    },
    ttlSeconds,
  )
}

export async function optionalProtect(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const token = getAccessToken(req)

  if (!token) {
    next()
    return
  }

  try {
    const payload = verifyAccessToken(token)

    if (typeof payload.sub !== 'string' || typeof payload.jti !== 'string') {
      next()
      return
    }

    const user = await cache(
      `user-auth:${payload.sub}`,
      () =>
        prisma.user.findUnique({
          where: { id: payload.sub, deletedAt: null },
          select: {
            id: true,
            isActive: true,
            isSuspended: true,
            isBanned: true,
            fullName: true,
            email: true,
            avatar: true,
            roles: {
              select: {
                role: { select: { name: true, permissions: { select: { key: true } } } },
              },
            },
          },
        }),
      10,
      [`user:${payload.sub}`],
    )

    if (user && user.isActive && !user.isSuspended && !user.isBanned) {
      req.user = {
        id: user.id,
        fullName: user.fullName,
        email: user.email,
        avatar: user.avatar,
        roles: user.roles.map((r) => r.role.name),
        permissions: [...new Set(user.roles.flatMap((r) => r.role.permissions.map((p) => p.key)))],
      }
    }
  } catch {
    // Ignore invalid token and continue as guest
  }

  next()
}

/**
 * Middleware factory to ensure the user has at least one of the required roles.
 * @param requiredRoles - A single role or an array of roles.
 */
export function requireRole(requiredRoles: string | string[]) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    const user = req.user as { id: string; roles: string[] } | undefined
    if (!user?.roles) {
      next(new UnauthorizedError('Authentication required, user roles not found.'))
      return
    }

    const rolesToCheck = Array.isArray(requiredRoles) ? requiredRoles : [requiredRoles]
    const hasRequiredRole = user.roles.some((role: string) => rolesToCheck.includes(role))

    if (!hasRequiredRole) {
      next(new ForbiddenError(`Requires one of the following roles: ${rolesToCheck.join(', ')}`))
      return
    }

    next()
  }
}

/**
 * Middleware factory to ensure the user has a specific permission.
 * @param requiredPermission - The permission key to check for.
 */
export function requirePermission(requiredPermission: string) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    const user = req.user as { id: string; permissions: string[] } | undefined
    const userPermissions = user?.permissions

    if (!userPermissions) {
      next(new UnauthorizedError('Authentication required, user permissions not found.'))
      return
    }
    if (!userPermissions.includes(requiredPermission)) {
      next(new ForbiddenError(`Forbidden: Missing required permission: ${requiredPermission}`))
      return
    }

    next()
  }
}

/**
 * Middleware factory to ensure the user has ALL of the required permissions.
 * @param requiredPermissions - An array of permission keys.
 */
export function authorize(requiredPermissions: string[]) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    const user = req.user as { id: string; permissions: string[] } | undefined
    if (!user?.permissions) {
      return next(new UnauthorizedError('Authentication required'))
    }

    const userPermissions = user.permissions

    const hasAllPermissions = requiredPermissions.every((p) => userPermissions.includes(p))

    if (!hasAllPermissions) {
      return next(new AppError(403, 'Forbidden: Missing required permissions'))
    }
    next()
  }
}

export function notFound(_req: Request, _res: Response, next: NextFunction): void {
  next(new AppError(404, 'Route not found'))
}

export function errorHandler(err: unknown, req: Request, res: Response, next: NextFunction): void {
  if (res.headersSent) {
    next(err)
    return
  }

  const isProduction = process.env.NODE_ENV === 'production'
  const requestId = (req as Request & { id?: string }).id ?? 'unknown'
  const userId = (req.user as { id?: string } | undefined)?.id ?? 'anonymous'
  const originalError = err instanceof Error ? err : new Error(String(err))
  const errorName = err instanceof Error ? err.name : 'UnknownError'
  const prismaError = err as { code?: string; meta?: unknown; status?: number; statusCode?: number }
  const isZodError = err instanceof ZodError
  const isBodyParserError = errorName === 'SyntaxError' && (err as { type?: string }).type === 'entity.parse.failed'
  const isPayloadTooLarge = (err as { type?: string }).type === 'entity.too.large'
  const isMulterError = errorName === 'MulterError'

  let statusCode = 500
  let message = 'Internal server error'
  let code = 'INTERNAL_SERVER_ERROR'
  let details: unknown

  if (err instanceof AppError) {
    statusCode = err.statusCode
    message = err.message
    code = err.name.replace(/Error$/, '').replace(/[A-Z]/g, (letter, index) => index === 0 ? letter : `_${letter}`).toUpperCase()
    details = err.details
  } else if (isZodError) {
    statusCode = 400
    message = 'Validation failed'
    code = 'VALIDATION_ERROR'
    details = err.flatten()
  } else if (isBodyParserError) {
    statusCode = 400
    message = 'Malformed JSON request body'
    code = 'INVALID_REQUEST_BODY'
  } else if (isPayloadTooLarge) {
    statusCode = 413
    message = 'Request payload is too large'
    code = 'PAYLOAD_TOO_LARGE'
  } else if (isMulterError) {
    statusCode = 400
    message = originalError.message || 'File upload failed'
    code = 'UPLOAD_ERROR'
  } else if (errorName === 'PrismaClientKnownRequestError') {
    if (prismaError.code === 'P2025') {
      statusCode = 404
      message = 'Requested record was not found'
    } else if (prismaError.code === 'P2024') {
      statusCode = 503
      message = 'Database service is temporarily unavailable'
    } else if (prismaError.code === 'P2002') {
      statusCode = 409
      message = 'A record with the same unique value already exists'
    } else {
      statusCode = 500
      message = 'Database operation failed'
    }
    code = prismaError.code ?? 'DATABASE_ERROR'
  }

  statusCode = Math.min(Math.max(statusCode, 400), 599)
  const logContext = {
    err: originalError,
    requestId,
    userId,
    method: req.method,
    url: req.originalUrl,
    ip: req.ip,
    userAgent: req.get('user-agent'),
    errorCode: code,
    statusCode,
    ...(prismaError.meta ? { databaseMeta: prismaError.meta } : {}),
  }

  if (statusCode >= 500) {
    logger.error(logContext, 'Request failed with an internal error')
  } else {
    logger.warn(logContext, 'Request rejected')
  }

  res.status(statusCode).json({
    success: false,
    message,
    code,
    requestId,
    ...(err instanceof PremiumRequiredError ? { isPremiumLocked: true } : {}),
    ...(isProduction ? {} : { error: details ?? { name: errorName, message: originalError.message, stack: originalError.stack } }),
  })
}
