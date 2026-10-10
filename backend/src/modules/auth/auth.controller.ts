import type { Request, Response } from 'express'
import type { Prisma } from '@prisma/client'
import crypto from 'crypto'
import prisma from '../../core/prisma.js'
import { comparePassword, hashPassword, hashOneTimeCode, verifyOneTimeCode, isOneTimeCodeUsable, signAccessToken, signRefreshToken, verifyRefreshToken, hashRefreshToken, compareRefreshToken, isSupersededRefreshToken, nextSessionRefreshCredentials, serializeSessionRefreshCredentials, ACCESS_TOKEN_MAX_AGE_MS, SESSION_MAX_AGE_MS } from '../../core/auth.js';
import { successResponse, errorResponse } from '../../core/api-response.js'
import { publicUserSelect } from '../users/user.utils.js';
import { getUserProfile } from '../users/user.service.js';
import { getPasswordResetTemplate, getRegistrationOtpTemplate } from '../../services/email.templates.js'
import { sendEmail, sendPasswordResetOTPEmail, sendVerificationOTPEmail } from '../../services/email.service.js'
import logger from '../../core/logger.js'
import { AppError, BadRequestError, UnauthorizedError } from '../../core/errors.js'
import { uploadStreamToCloudinary } from '../../services/upload.service.js'
import { cleanupReplacedAsset } from '../../services/asset-cleanup.service.js'
import { z } from 'zod';
import { adminLoginSchema, consoleLoginSchema, forgotPasswordSchema, loginSchema, registerSchema, resendOtpSchema, resetPasswordSchema, verifyEmailSchema } from './auth.routes.js';
import { STAFF_ROLE_NAMES as STAFF_CONSOLE_ROLES } from '../../core/access.js';

const FRONTEND_URL = process.env.FRONTEND_URL ?? process.env.BASE_URL ?? 'http://localhost:5174'
const ACCESS_TOKEN_COOKIE = 'accessToken'
const REFRESH_TOKEN_COOKIE = 'refreshToken'
const REFRESH_TOKEN_PATH = '/api/v1/auth'
const isProduction = process.env.NODE_ENV === 'production'
const cookieSecure = process.env.COOKIE_SECURE === 'true' || isProduction
const cookieSameSite: 'none' | 'lax' = isProduction ? 'none' : 'lax'
const configuredCookieDomain = process.env.COOKIE_DOMAIN?.trim()
const cookieDomain = configuredCookieDomain && !configuredCookieDomain.includes('://') && !configuredCookieDomain.includes('/')
  ? configuredCookieDomain
  : undefined

if (configuredCookieDomain && !cookieDomain) {
  logger.warn('Ignoring invalid COOKIE_DOMAIN. Use a hostname only or leave it unset for a host-only cookie.')
}

const sharedCookieOptions = {
  httpOnly: true,
  secure: cookieSecure,
  sameSite: cookieSameSite,
  ...(cookieDomain ? { domain: cookieDomain } : {}),
}

const setAuthCookies = (res: Response, accessToken: string, refreshToken: string) => {
  res.cookie(ACCESS_TOKEN_COOKIE, accessToken, {
    ...sharedCookieOptions,
    path: '/',
    maxAge: ACCESS_TOKEN_MAX_AGE_MS,
  })

  res.cookie(REFRESH_TOKEN_COOKIE, refreshToken, {
    ...sharedCookieOptions,
    path: REFRESH_TOKEN_PATH, // Only the refresh/logout endpoints can receive it
    maxAge: SESSION_MAX_AGE_MS,
  })
}

/**
 * Creates a new session, signs JWTs, and sets them as httpOnly cookies.
 *
 * The session carries an absolute lifetime (`SESSION_MAX_AGE_MS`) that rotation never extends, so a
 * silently renewed session still has a hard security boundary.
 * @param res The Express Response object.
 * @param userId The ID of the user for whom to create the session.
 */
export async function createSessionAndSetCookies(res: Response, userId: string): Promise<void> {
  // Use a transaction to ensure session creation and token hashing are atomic.
  const { accessToken, refreshToken } = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    // 1. Create a new session in the database
    const session = await tx.session.create({
      data: {
        userId,
        expiresAt: new Date(Date.now() + SESSION_MAX_AGE_MS),
      },
    })
    // 2. Create Access and Refresh tokens
    const accessToken = signAccessToken({ sub: userId, jti: session.id })
    const newRefreshToken = signRefreshToken({ sub: userId, jti: session.id })
    const refreshTokenHash = await hashRefreshToken(newRefreshToken)
    await tx.session.update({ where: { id: session.id }, data: { refreshTokenHash } })
    return { accessToken, refreshToken: newRefreshToken }
  });
  setAuthCookies(res, accessToken, refreshToken)
}

export async function registerUser(req: Request, res: Response) {
  const { email, password, fullName } = req.body as z.infer<typeof registerSchema>
  const otp = crypto.randomInt(100000, 999999).toString()
  const otpExpires = new Date(Date.now() + 10 * 60 * 1000) // 10 minutes

  const existingUser = await prisma.user.findUnique({
    where: { email },
    select: { id: true, isActive: true },
  })

  if (existingUser?.isActive) {
    return res.status(409).json(errorResponse('Email is already registered and verified. Please log in.'))
  }

  const passwordHash = await hashPassword(password)

  if (existingUser && !existingUser.isActive) {
    try {
      await prisma.user.update({
        where: { email },
        data: {
          fullName,
          passwordHash,
          // Only the hash is stored: a leaked row must not reveal the emailed code.
          verificationOtp: await hashOneTimeCode(otp),
          verificationOtpExpires: otpExpires,
        },
      })

      await sendVerificationOTPEmail(email, otp)
      return res.status(200).json(successResponse({ email }, 'Verification OTP resent to your email. Please verify your account.'))
    } catch (error) {
      logger.error({ error: error instanceof Error ? error.message : error, email }, 'Failed to resend verification OTP')
      return res.status(500).json(errorResponse('Unable to resend verification OTP. Please try again later.'))
    }
  }

  let userId: string | null = null

  try {
    const user = await prisma.user.create({
      data: {
        email,
        fullName,
        passwordHash,
        guestMode: false,
        isActive: false, // User is not active until verified
        verificationOtp: await hashOneTimeCode(otp),
        verificationOtpExpires: otpExpires,
      },
      select: { id: true, email: true },
    })

    userId = user.id
    await sendVerificationOTPEmail(email, otp)

    return res.status(201).json(successResponse({ email: user.email }, 'Registration pending verification. Please check your email for an OTP.'))
  } catch (error) {
    if (userId) {
      await prisma.user.delete({ where: { id: userId } }).catch((deleteError) => {
        logger.error({ deleteError }, 'Failed to delete user after failed email delivery')
      })
    }

    logger.error({ error: error instanceof Error ? error.message : error, email }, 'Failed to create user and send verification OTP')
    return res.status(500).json(errorResponse('Unable to complete sign up. Please try again later.'))
  }
}

export async function loginUser(req: Request, res: Response) {
  const { email, password } = req.body as z.infer<typeof loginSchema>
  const user = await prisma.user.findUnique({
    where: { email },
    select: {
      passwordHash: true,
      ...publicUserSelect,
      deletedAt: true,
    },
  })

  if (!user || !user.passwordHash || !(await comparePassword(password, user.passwordHash))) {
    return res.status(401).json(errorResponse('Invalid credentials'))
  }

  if (!user.isActive || user.deletedAt) {
    return res.status(401).json(errorResponse('Account not verified. Please check your email for a verification code.'))
  }

  if (user.isSuspended || user.isBanned) {
    return res.status(403).json(errorResponse('This account is suspended or banned.'))
  }

  const userProfile = await getUserProfile(user.id)
  await createSessionAndSetCookies(res, user.id)

  return res.status(200).json(successResponse({ user: userProfile }, 'Login successful'))
}

export async function loginAdmin(req: Request, res: Response) {
  const { email, password } = req.body as z.infer<typeof adminLoginSchema>

  const account = await verifyConsoleCredentials(res, email, password, 'Admin')
  if (!account) return

  if (!account.roles.includes('admin') && !account.roles.includes('super_admin')) {
    return res.status(403).json(errorResponse('You do not have permission to access the admin panel.'))
  }

  const userProfile = await getUserProfile(account.id)
  await createSessionAndSetCookies(res, account.id)
  return res.status(200).json(successResponse({ user: userProfile }, 'Admin login successful'))
}

/**
 * Verifies credentials for a console (non-public) sign-in and refuses accounts that must not sign in.
 *
 * On failure the error response has already been sent and `null` is returned, so callers only have to
 * decide whether the verified account is allowed into *their* console.
 */
async function verifyConsoleCredentials(
  res: Response,
  email: string,
  password: string,
  accountLabel: string,
): Promise<{ id: string; roles: string[] } | null> {
  const user = await prisma.user.findUnique({
    where: { email },
    include: {
      roles: {
        where: { deletedAt: null, role: { is: { deletedAt: null } } },
        select: { role: { select: { name: true } } },
      },
    },
  })

  if (!user || !user.passwordHash || !(await comparePassword(password, user.passwordHash))) {
    res.status(401).json(errorResponse('Invalid credentials'))
    return null
  }

  if (user.deletedAt || !user.isActive) {
    res.status(401).json(errorResponse(`${accountLabel} account is not active.`))
    return null
  }

  if (user.isSuspended || user.isBanned) {
    res.status(403).json(errorResponse(`${accountLabel} account access is restricted.`))
    return null
  }

  return { id: user.id, roles: user.roles.map((userRole: { role: { name: string } }) => userRole.role.name) }
}

export async function loginModerator(req: Request, res: Response) {
  const { email, password } = req.body as z.infer<typeof consoleLoginSchema>

  const account = await verifyConsoleCredentials(res, email, password, 'Moderator')
  if (!account) return

  if (!account.roles.includes('moderator')) {
    return res.status(403).json(errorResponse('You do not have permission to access the moderator console.'))
  }

  const userProfile = await getUserProfile(account.id)
  await createSessionAndSetCookies(res, account.id)
  return res.status(200).json(successResponse({ user: userProfile }, 'Moderator login successful'))
}

export async function loginStaff(req: Request, res: Response) {
  const { email, password } = req.body as z.infer<typeof consoleLoginSchema>

  const account = await verifyConsoleCredentials(res, email, password, 'Staff')
  if (!account) return

  // The shared staff console is for administrator-made roles only. Seeded system roles either belong
  // to a dedicated console (admin, moderator) or to the public application (user, premium_user), so
  // they are refused here and the client sends them to the entry point that matches.
  if (account.roles.some((role) => (STAFF_CONSOLE_ROLES as readonly string[]).includes(role))) {
    return res.status(403).json(errorResponse('Please sign in through your administrator or moderator console.'))
  }

  if (account.roles.length === 0) {
    return res.status(403).json(errorResponse('You do not have access to the staff console.'))
  }

  const systemRoles = await prisma.role.findMany({
    where: { name: { in: account.roles }, isSystem: true },
    select: { name: true },
  })
  const customRoles = account.roles.filter((role) => !systemRoles.some((systemRole) => systemRole.name === role))
  if (customRoles.length === 0) {
    return res.status(403).json(errorResponse('You do not have access to the staff console.'))
  }

  const userProfile = await getUserProfile(account.id)
  await createSessionAndSetCookies(res, account.id)
  return res.status(200).json(successResponse({ user: userProfile }, 'Staff login successful'))
}

export async function verifyEmail(req: Request, res: Response) {
  const { email, otp } = req.body as z.infer<typeof verifyEmailSchema>

  const user = await prisma.user.findUnique({ where: { email } })

  // The comparison always runs (against a fixed digest when there is no stored hash) so the response
  // time does not disclose whether a verification code was issued for this address.
  const codeMatches = await verifyOneTimeCode(otp, user?.verificationOtp)

  if (!user || !codeMatches || !isOneTimeCodeUsable(user.verificationOtpExpires)) {
    return res.status(400).json(errorResponse('Invalid or expired OTP.'))
  }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      isActive: true,
      emailVerifiedAt: new Date(),
      verificationOtp: null,
      verificationOtpExpires: null,
    },
  })

  const userProfile = await getUserProfile(user.id)
  await createSessionAndSetCookies(res, user.id)

  return res.status(200).json(successResponse({ user: userProfile }, 'Email verified successfully.'))
}

export async function resendOtp(req: Request, res: Response) {
  const { email } = req.body as z.infer<typeof resendOtpSchema>
  const user = await prisma.user.findUnique({ where: { email } })

  if (!user) {
    return res.status(200).json(successResponse(null, 'If an account with that email exists, a new OTP has been sent.'))
  }

  if (user.isActive) {
    return res.status(400).json(errorResponse('This account is already verified.'))
  }

  const otp = crypto.randomInt(100000, 999999).toString()
  const otpExpires = new Date(Date.now() + 10 * 60 * 1000) // 10 minutes

  // A new code replaces the previous one, so the old code stops working immediately.
  await prisma.user.update({
    where: { email },
    data: { verificationOtp: await hashOneTimeCode(otp), verificationOtpExpires: otpExpires },
  })

  try {
    await sendEmail({
      to: email,
      subject: 'Your New SportZoneBD Verification Code',
      text: `Your new verification code is: ${otp}`,
      html: getRegistrationOtpTemplate(otp),
    });
  } catch (error) {
    logger.error({ error: error instanceof Error ? error.message : error }, 'Resend OTP failed');
    return res.status(500).json(errorResponse('Unable to resend OTP. Please check SMTP configuration and try again.'));
  }

  return res.status(200).json(successResponse({ email: user.email }, 'A new OTP has been sent to your email.'))
}

export async function forgotPassword(req: Request, res: Response) {
  const { email } = req.body as z.infer<typeof forgotPasswordSchema>
  const user = await prisma.user.findUnique({ where: { email } })

  if (!user) {
    return res.status(200).json(successResponse(null, 'If a user with that email exists, a password reset code has been sent.'))
  }

  const resetOtp = crypto.randomInt(100000, 1000000).toString()
  // Bcrypt, not a fast digest: a 6-digit code has too little entropy for sha256 to hide it from
  // anyone who reads the stored value.
  const passwordResetToken = await hashOneTimeCode(resetOtp)
  const passwordResetExpires = new Date(Date.now() + 10 * 60 * 1000)

  await prisma.user.update({
    where: { email },
    data: { passwordResetToken, passwordResetExpires },
  })

  try {
    await sendPasswordResetOTPEmail(email, resetOtp)
    return res.status(200).json(successResponse(null, 'If a user with that email exists, a password reset code has been sent.'))
  } catch (error) {
    throw new BadRequestError('There was an error sending the email. Please try again later.')
  }
}

export async function resetPassword(req: Request, res: Response) {
  const { email, otp, password } = req.body as z.infer<typeof resetPasswordSchema>
  const user = await prisma.user.findUnique({ where: { email } })

  // Same reasoning as email verification: always compare, so a timing difference cannot reveal
  // whether this address has a reset code pending.
  const codeMatches = await verifyOneTimeCode(otp, user?.passwordResetToken)

  if (!user || !codeMatches || !isOneTimeCodeUsable(user.passwordResetExpires)) {
    throw new BadRequestError('Invalid or expired password reset code.')
  }

  const passwordHash = await hashPassword(password)
  await prisma.$transaction([
    prisma.user.update({
      where: { id: user.id },
      data: { passwordHash, passwordResetToken: null, passwordResetExpires: null },
    }),
    prisma.session.updateMany({
      where: { userId: user.id, deletedAt: null },
      data: { deletedAt: new Date(), refreshTokenHash: null },
    }),
  ])

  try {
    await sendEmail({
      to: email,
      subject: 'Your SportZoneBD Password Was Reset',
      text: 'Your SportZoneBD password was changed successfully. If you did not make this change, contact support immediately.',
      html: getPasswordResetTemplate(),
    })
  } catch (error) {
    logger.error({ error: error instanceof Error ? error.message : error, userId: user.id }, 'Password reset confirmation email failed')
  }

  return res.status(200).json(successResponse(null, 'Password reset successful. Please sign in with your new password.'))
}

export async function getMe(req: Request, res: Response) {
  const userId = (req as Request & { user?: { id?: string } }).user?.id
  if (!userId) {
    return res.status(401).json(errorResponse('Authentication required'))
  }

  const user = await getUserProfile(userId)
  if (!user) {
    return res.status(404).json(errorResponse('User not found'))
  }
  return res.status(200).json(successResponse(user))
}

export async function updateProfile(req: Request, res: Response) {
  const userId = (req as Request & { user?: { id?: string } }).user?.id
  if (!userId) {
    return res.status(401).json(errorResponse('Authentication required'))
  }

  const { fullName, removeAvatar } = req.body as { fullName?: string; removeAvatar?: boolean }
  const file = (req as any).file as Express.Multer.File | undefined;
  const dataToUpdate: { fullName?: string; avatar?: string | null } = {}

  if (fullName) {
    dataToUpdate.fullName = fullName
  }

  if (removeAvatar && !file) {
    dataToUpdate.avatar = null
  }

  try {
    const existingUser = file || removeAvatar
      ? await prisma.user.findUnique({ where: { id: userId }, select: { avatar: true } })
      : null

    if (file) {
      dataToUpdate.avatar = await uploadStreamToCloudinary(
        file.buffer,
        'sportzone/avatars',
        undefined,
        { width: 256, height: 256, crop: 'fill', gravity: 'face', quality: 'auto:good' },
      )
    }

    const updatedUser = await prisma.user.update({ where: { id: userId }, data: dataToUpdate })

    if ((file || removeAvatar) && existingUser?.avatar) {
      await cleanupReplacedAsset(existingUser.avatar, updatedUser.avatar)
    }

    const userProfile = await getUserProfile(updatedUser.id);
    return res.status(200).json(successResponse({ user: userProfile }, 'Profile updated successfully'));
  } catch (error) {
    logger.error({ error }, 'Failed to update profile');
    throw new AppError(500, 'Failed to update profile.');
  }
}

export async function logoutUser(req: Request, res: Response) {
  const { [REFRESH_TOKEN_COOKIE]: refreshToken } = req.cookies

  if (refreshToken) {
    try {
      const payload = verifyRefreshToken(refreshToken)
      if (typeof payload !== 'string' && payload.jti) {
        // Find the session and invalidate it
        const session = await prisma.session.findUnique({ where: { id: payload.jti } })
        if (session) {
          await prisma.session.update({
            where: { id: session.id },
            data: { deletedAt: new Date(), refreshTokenHash: null },
          })
        }
      }
    } catch (error) {
      // Ignore errors on logout, just clear the cookie
    }
  }

  res.clearCookie(ACCESS_TOKEN_COOKIE, { ...sharedCookieOptions, path: '/' })
  res.clearCookie(REFRESH_TOKEN_COOKIE, { ...sharedCookieOptions, path: REFRESH_TOKEN_PATH })
  return res.status(200).json(successResponse(null, 'Logout successful'))
}

export async function refreshAccessToken(req: Request, res: Response) {
  const { [REFRESH_TOKEN_COOKIE]: refreshToken } = req.cookies
  // Only the startup/bootstrap call asks for the profile, so the silent 401-driven refreshes stay
  // as small as possible.
  const includeUser = (req.body as { includeUser?: unknown } | undefined)?.includeUser === true

  try {
    if (!refreshToken) {
      throw new UnauthorizedError('Refresh token not found')
    }

    // 1. Verify the refresh token
    const payload = verifyRefreshToken(refreshToken)
    if (typeof payload === 'string' || !payload.sub || !payload.jti) {
      throw new UnauthorizedError('Invalid refresh token payload')
    }

    // 2. Find the session in the database
    const session = await prisma.session.findFirst({
      where: {
        id: payload.jti,
        deletedAt: null,
        expiresAt: { gt: new Date() },
      },
    })

    if (!session || !session.refreshTokenHash) {
      throw new UnauthorizedError('Invalid or expired session')
    }

    // 3. Compare the incoming token with the stored credentials. The credential superseded by the
    //    last rotation is accepted inside a short grace window: two tabs, or a reload racing an
    //    in-flight refresh, can legitimately present it and must not be mistaken for a replay.
    const isCurrentCredential = await compareRefreshToken(refreshToken, session.refreshTokenHash)
    const isSupersededCredential = !isCurrentCredential
      && await isSupersededRefreshToken(refreshToken, session.refreshTokenHash)

    // 4. **REUSE DETECTION**: If no stored credential matches, a stolen token was likely used.
    if (!isCurrentCredential && !isSupersededCredential) {
      await prisma.session.updateMany({
        where: { userId: payload.sub },
        data: { deletedAt: new Date(), refreshTokenHash: null },
      })
      throw new UnauthorizedError('Refresh token reuse detected. All sessions have been logged out.')
    }

    const rotatedAtMs = Date.now()
    // A rotated credential never outlives its session, so the sliding window stays bounded by the
    // absolute session lifetime instead of being extended on every refresh.
    const remainingSessionSeconds = Math.max(60, Math.floor((session.expiresAt.getTime() - rotatedAtMs) / 1000))

    // 5. **TOKEN ROTATION**: Issue new tokens and update the session atomically
    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const newAccessToken = signAccessToken({ sub: session.userId, jti: session.id })
      const newRefreshToken = signRefreshToken({ sub: session.userId, jti: session.id }, remainingSessionSeconds)
      const newRefreshTokenHash = serializeSessionRefreshCredentials(
        nextSessionRefreshCredentials(
          session.refreshTokenHash,
          isCurrentCredential,
          await hashRefreshToken(newRefreshToken),
          rotatedAtMs,
        ),
      )
      await tx.session.update({
        where: { id: session.id },
        data: { refreshTokenHash: newRefreshTokenHash },
      })
      // 6. Set new cookies
      setAuthCookies(res, newAccessToken, newRefreshToken)
    })

    // 7. Optionally hand the restored profile back so the client does not need a second round trip.
    //    The account checks mirror the ones the authenticate middleware applies to /auth/me, so a
    //    session that is no longer allowed to act never looks restored: the client is left without a
    //    profile and still goes through /auth/me, which produces the existing 401/403 handling.
    let user = null
    if (includeUser) {
      try {
        const account = await prisma.user.findUnique({
          where: { id: session.userId, deletedAt: null },
          select: { isActive: true, isSuspended: true, isBanned: true },
        })

        if (account && account.isActive && !account.isSuspended && !account.isBanned) {
          user = await getUserProfile(session.userId)
        }
      } catch (error) {
        logger.warn({ error, sessionId: session.id }, 'Could not include the user profile in the refresh response')
      }
    }

    return res.status(200).json(successResponse({ ...(user ? { user } : {}) }, 'Token refreshed successfully'))
  } catch (error) {
    // Only clear cookies for authorization errors. Let other errors (e.g., database)
    // be handled by the global error handler.
    const isRefreshTokenVerificationFailure = error instanceof Error && (
      error.message === 'Refresh token must be a non-empty string'
      || error.message === 'Refresh token expired'
      || error.message === 'Invalid refresh token'
    )

    if (error instanceof UnauthorizedError || isRefreshTokenVerificationFailure) {
      const message = error instanceof UnauthorizedError ? error.message : 'Invalid or expired refresh token'
      return res
        .status(401)
        .clearCookie(ACCESS_TOKEN_COOKIE, { ...sharedCookieOptions, path: '/' })
        .clearCookie(REFRESH_TOKEN_COOKIE, { ...sharedCookieOptions, path: REFRESH_TOKEN_PATH })
        .json(errorResponse(message))
    }
    // Clear cookies on any refresh error
    throw error
  }
}

export async function googleCallback(req: any, res: Response) {
  const { user } = req
  await createSessionAndSetCookies(res, user.id)
  res.redirect(`${FRONTEND_URL.replace(/\/$/, '')}/auth/google/callback`)
}
