import type { Request, Response } from 'express'
import type { Prisma } from '@prisma/client'
import crypto from 'crypto'
import prisma from '../../core/prisma.js'
import { comparePassword, hashPassword, signAccessToken, signRefreshToken, verifyRefreshToken, hashRefreshToken, compareRefreshToken } from '../../core/auth.js';
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
import { adminLoginSchema, forgotPasswordSchema, loginSchema, registerSchema, resendOtpSchema, resetPasswordSchema, verifyEmailSchema } from './auth.routes.js';

const FRONTEND_URL = process.env.FRONTEND_URL ?? process.env.BASE_URL ?? 'http://localhost:5174'
const ACCESS_TOKEN_COOKIE = 'accessToken'
const REFRESH_TOKEN_COOKIE = 'refreshToken'
const REFRESH_TOKEN_PATH = '/api/v1/auth'
const isProduction = process.env.NODE_ENV === 'production'
const cookieSecure = process.env.COOKIE_SECURE === 'true' || isProduction
const cookieSameSite: 'none' | 'lax' = isProduction ? 'none' : 'lax'
const cookieDomain = process.env.COOKIE_DOMAIN?.trim() || undefined

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
    maxAge: 15 * 60 * 1000, // 15 minutes
  })

  res.cookie(REFRESH_TOKEN_COOKIE, refreshToken, {
    ...sharedCookieOptions,
    path: '/api/v1/auth', // Important: Path should be specific to refresh/logout routes
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  })
}

/**
 * Creates a new session, signs JWTs, and sets them as httpOnly cookies.
 * @param res The Express Response object.
 * @param userId The ID of the user for whom to create the session.
 */
export async function createSessionAndSetCookies(res: Response, userId: string) {
  // Use a transaction to ensure session creation and token hashing are atomic.
  const { accessToken, refreshToken } = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    // 1. Create a new session in the database
    const session = await tx.session.create({
      data: {
        userId,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
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
  return accessToken
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
          verificationOtp: otp,
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
        verificationOtp: otp,
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

  const userProfile = await getUserProfile(user.id)
  const accessToken = await createSessionAndSetCookies(res, user.id)

  return res.status(200).json(successResponse({ user: userProfile, accessToken }, 'Login successful'))
}

export async function loginAdmin(req: Request, res: Response) {
  const { email, password } = req.body as z.infer<typeof adminLoginSchema>

  const user = await prisma.user.findUnique({
    where: { email },
    include: { roles: { select: { role: { select: { name: true } } } } },
  })

  if (!user || !user.passwordHash || !(await comparePassword(password, user.passwordHash))) {
    return res.status(401).json(errorResponse('Invalid credentials'))
  }

  if (user.deletedAt || !user.isActive) {
    return res.status(401).json(errorResponse('Admin account is not active.'))
  }

  if (user.isSuspended || user.isBanned) {
    return res.status(403).json(errorResponse('Admin account access is restricted.'))
  }

  const userRoles = user.roles.map((userRole: { role: { name: string } }) => userRole.role.name)
  if (!userRoles.includes('admin') && !userRoles.includes('super_admin')) {
    return res.status(403).json(errorResponse('You do not have permission to access the admin panel.'))
  }

  const userProfile = await getUserProfile(user.id)
  const accessToken = await createSessionAndSetCookies(res, user.id)
  return res.status(200).json(successResponse({ user: userProfile, accessToken }, 'Admin login successful'))
}

export async function verifyEmail(req: Request, res: Response) {
  const { email, otp } = req.body as z.infer<typeof verifyEmailSchema>

  const user = await prisma.user.findFirst({
    where: { email, verificationOtp: otp, verificationOtpExpires: { gt: new Date() } },
  })

  if (!user) {
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
  const accessToken = await createSessionAndSetCookies(res, user.id)

  return res.status(200).json(successResponse({ user: userProfile, accessToken }, 'Email verified successfully.'))
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

  await prisma.user.update({
    where: { email },
    data: { verificationOtp: otp, verificationOtpExpires: otpExpires },
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
  const passwordResetToken = crypto.createHash('sha256').update(resetOtp).digest('hex')
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

  if (!user?.passwordResetToken || !user.passwordResetExpires || user.passwordResetExpires <= new Date()) {
    throw new BadRequestError('Invalid or expired password reset code.')
  }

  const submittedHash = crypto.createHash('sha256').update(otp).digest('hex')
  if (submittedHash.length !== user.passwordResetToken.length) {
    throw new BadRequestError('Invalid or expired password reset code.')
  }

  const isCodeValid = crypto.timingSafeEqual(
    Buffer.from(submittedHash),
    Buffer.from(user.passwordResetToken),
  )

  if (!isCodeValid) {
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
      where: { id: payload.jti, deletedAt: null },
    })

    if (!session || !session.refreshTokenHash) {
      throw new UnauthorizedError('Invalid session')
    }

    // 3. Compare the incoming token with the stored hash
    const isTokenValid = await compareRefreshToken(refreshToken, session.refreshTokenHash)

    // 4. **REUSE DETECTION**: If invalid, a stolen token was likely used. Invalidate all user sessions.
    if (!isTokenValid) {
      await prisma.session.updateMany({
        where: { userId: payload.sub },
        data: { deletedAt: new Date(), refreshTokenHash: null },
      })
      throw new UnauthorizedError('Refresh token reuse detected. All sessions have been logged out.')
    }

    // 5. **TOKEN ROTATION**: Issue new tokens and update the session atomically
    const newAccessToken = await prisma.$transaction(async (tx: any) => {
      const newAccessToken = signAccessToken({ sub: session.userId, jti: session.id })
      const newRefreshToken = signRefreshToken({ sub: session.userId, jti: session.id })
      const newRefreshTokenHash = await hashRefreshToken(newRefreshToken)
      await tx.session.update({
        where: { id: session.id },
        data: { refreshTokenHash: newRefreshTokenHash },
      })
      // 6. Set new cookies
      setAuthCookies(res, newAccessToken, newRefreshToken)
      return newAccessToken
    })

    return res.status(200).json(successResponse({ accessToken: newAccessToken }, 'Token refreshed successfully'))
  } catch (error) {
    // Only clear cookies for authorization errors. Let other errors (e.g., database)
    // be handled by the global error handler.
    if (error instanceof UnauthorizedError) {
      return res
        .status(401)
        .clearCookie(ACCESS_TOKEN_COOKIE, { ...sharedCookieOptions, path: '/' })
        .clearCookie(REFRESH_TOKEN_COOKIE, { ...sharedCookieOptions, path: REFRESH_TOKEN_PATH })
        .json(errorResponse(error.message))
    }
    // Clear cookies on any refresh error
    throw error
  }
}

export async function googleCallback(req: any, res: Response) {
  const { user } = req
  const accessToken = await createSessionAndSetCookies(res, user.id)
  res.redirect(`${FRONTEND_URL.replace(/\/$/, '')}/auth/google/callback#accessToken=${encodeURIComponent(accessToken)}`)
}
