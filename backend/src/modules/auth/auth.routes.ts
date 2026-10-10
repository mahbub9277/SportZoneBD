import { Router, type Router as ExpressRouter } from 'express'
import passport from 'passport'
import { z } from 'zod'
import { authenticate } from '../../core/middleware/index.js'
import { validateBody } from '../../core/validation.js'
import asyncHandler from '../../utils/asyncHandler.js'
import { upload } from '../../middleware/upload.js'
import { beginGoogleOAuthState, getPendingOAuthState, requireGoogleOAuthState } from '../../core/oauthState.js'
import {
  registerUser,
  loginUser,
  loginAdmin,
  loginModerator,
  loginStaff,
  verifyEmail,
  resendOtp,
  forgotPassword,
  resetPassword,
  getMe,
  updateProfile,
  logoutUser,
  refreshAccessToken,
  googleCallback,
} from './auth.controller.js'

export const authRouter: ExpressRouter = Router()
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5174'

export const registerSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(8),
  fullName: z.string().trim().min(2),
})

export const loginSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1), // Allow any password length for login attempt
})

export const adminLoginSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1),
});

/**
 * Shared body shape for the console sign-in endpoints (moderator and staff). The admin endpoint keeps
 * its own exported schema so existing callers and tests are unaffected.
 */
export const consoleLoginSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1),
});

export const forgotPasswordSchema = z.object({
  email: z.string().trim().email(),
});

export const resetPasswordSchema = z.object({
  email: z.string().trim().email(),
  otp: z.string().regex(/^\d{6}$/, 'Reset code must be exactly 6 digits.'),
  password: z.string().min(8, 'Password must be at least 8 characters.'),
});

export const verifyEmailSchema = z.object({
  email: z.string().trim().email(),
  otp: z.string().length(6),
});

export const resendOtpSchema = z.object({
  email: z.string().trim().email(),
});

export const updateProfileSchema = z.object({
  fullName: z.string().trim().min(2, 'Full name must be at least 2 characters.').optional(),
  removeAvatar: z.preprocess((value) => value === 'true' || value === true, z.boolean()).optional(),
});

authRouter.post('/register', validateBody(registerSchema), asyncHandler(registerUser))

authRouter.post('/login', validateBody(loginSchema), asyncHandler(loginUser))

authRouter.post('/admin/login', validateBody(adminLoginSchema), asyncHandler(loginAdmin));

authRouter.post('/moderator/login', validateBody(consoleLoginSchema), asyncHandler(loginModerator));

authRouter.post('/staff/login', validateBody(consoleLoginSchema), asyncHandler(loginStaff));

authRouter.post('/verify-email', validateBody(verifyEmailSchema), asyncHandler(verifyEmail))

authRouter.post('/resend-otp', validateBody(resendOtpSchema), asyncHandler(resendOtp));

authRouter.post('/forgot-password', validateBody(forgotPasswordSchema), asyncHandler(forgotPassword));
authRouter.post('/reset-password', validateBody(resetPasswordSchema), asyncHandler(resetPassword));

authRouter.get('/me', authenticate, asyncHandler(getMe))

authRouter.patch('/profile', authenticate, upload.single('avatar'), validateBody(updateProfileSchema), asyncHandler(updateProfile));

authRouter.post('/logout', asyncHandler(logoutUser))

authRouter.post('/refresh', asyncHandler(refreshAccessToken))

// Google OAuth Routes
authRouter.get(
  '/google',
  beginGoogleOAuthState,
  (req, res, next) => passport.authenticate('google', {
    scope: ['profile', 'email'],
    prompt: 'select_account',
    session: false,
    // Signed, browser-bound state; Google echoes it back on the callback.
    state: getPendingOAuthState(res),
  })(req, res, next),
)

authRouter.get(
  '/google/callback',
  // Rejects a missing, forged, expired, replayed, or foreign-browser state before passport
  // exchanges the authorization code, so no user or session can be created by a bad state.
  requireGoogleOAuthState(`${FRONTEND_URL}/login?error=google-auth-failed`),
  passport.authenticate('google', {
    failureRedirect: `${FRONTEND_URL}/login?error=google-auth-failed`,
    session: false,
  }),
  googleCallback,
)
