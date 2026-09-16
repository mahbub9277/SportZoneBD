import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { Prisma } from '@prisma/client';
import { prisma } from './prisma.js';
import { getUserProfile } from '../services/user.service.js';
import logger from './logger.js';
import { sendWelcomeEmail } from '../services/email.service.js';
import { uploadStreamToCloudinary } from '../services/upload.service.js'

const canonicalizeGoogleAvatarUrl = (value: string | null): string | null => {
  if (!value) return null
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || !url.hostname.endsWith('googleusercontent.com')) return null
    return `${url.origin}${url.pathname}`
  } catch {
    return null
  }
}

const hasGoogleCredentials = Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET)

if (!hasGoogleCredentials) {
  logger.warn('Google OAuth credentials are not configured. Skipping Google strategy initialization.')
} else {
  const backendOrigin = process.env.BACKEND_URL || process.env.API_BASE_URL?.replace(/\/api\/v1$/, '') || 'http://localhost:5000'
  const googleCallbackUrl = process.env.GOOGLE_CALLBACK_URL || `${backendOrigin}/api/v1/auth/google/callback`

  passport.use(
    new GoogleStrategy(
      {
        clientID: process.env.GOOGLE_CLIENT_ID!,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
        callbackURL: googleCallbackUrl,
        scope: ['profile', 'email'],
      },
      async (_accessToken, _refreshToken, profile, done) => {
        try {
          const email = profile.emails?.[0]?.value;
          if (!email) {
            return done(new Error('Google profile did not return an email.'), undefined);
          }

          const googleId = profile.id
          const fullName = profile.displayName?.trim() || email.split('@')[0]
          const googleAvatarUrl = profile.photos?.[0]?.value ?? null
          const canonicalGoogleAvatarUrl = canonicalizeGoogleAvatarUrl(googleAvatarUrl)
          const existingAvatarUser = await prisma.user.findFirst({
            where: { OR: [{ googleId }, { email }] },
            select: { avatar: true },
          })
          const existingAvatarIsGoogle = canonicalizeGoogleAvatarUrl(existingAvatarUser?.avatar ?? null) !== null
          const cloudinaryGoogleAvatar = !existingAvatarUser?.avatar || existingAvatarIsGoogle
            ? await cacheGoogleAvatar(googleAvatarUrl)
            : null
          const syncGoogleUser = () => prisma.$transaction(async (tx) => {
            const [googleUser, emailUser] = await Promise.all([
              tx.user.findUnique({ where: { googleId }, select: { id: true, email: true, fullName: true, avatar: true, emailVerifiedAt: true, isActive: true, guestMode: true } }),
              tx.user.findUnique({ where: { email }, select: { id: true, email: true, fullName: true, avatar: true, emailVerifiedAt: true, isActive: true, guestMode: true } }),
            ])
            if (googleUser && emailUser && googleUser.id !== emailUser.id) {
              throw new Error('Google account is already linked to another user.')
            }
            const existingUser = googleUser ?? emailUser
            const existingGoogleAvatar = canonicalizeGoogleAvatarUrl(existingUser?.avatar ?? null)
            const shouldUseGoogleAvatar = !existingUser?.avatar || Boolean(existingGoogleAvatar)
            const nextAvatar = shouldUseGoogleAvatar
              ? cloudinaryGoogleAvatar ?? (canonicalGoogleAvatarUrl
                ? (existingGoogleAvatar === canonicalGoogleAvatarUrl ? existingUser?.avatar ?? null : googleAvatarUrl)
                : existingUser?.avatar ?? null
              )
              : existingUser?.avatar ?? null

            const savedUser = existingUser
              ? await tx.user.update({
                  where: { id: existingUser.id },
                  data: {
                    ...(existingUser.email !== email ? { email } : {}),
                    ...(googleUser ? {} : { googleId }),
                    ...(existingUser.fullName ? {} : { fullName }),
                    ...(nextAvatar !== existingUser.avatar ? { avatar: nextAvatar } : {}),
                    ...(!existingUser.isActive ? { isActive: true } : {}),
                    ...(!existingUser.emailVerifiedAt ? { emailVerifiedAt: new Date() } : {}),
                    ...(existingUser.guestMode ? { guestMode: false } : {}),
                  },
                })
              : await tx.user.create({
                  data: {
                    email,
                    googleId,
                    fullName,
                    avatar: cloudinaryGoogleAvatar ?? googleAvatarUrl,
                    guestMode: false,
                    isActive: true,
                    emailVerifiedAt: new Date(),
                  },
                })

            const role = await tx.role.upsert({
              where: { name: 'user' },
              update: {},
              create: { name: 'user', description: 'Standard authenticated user', isSystem: true },
            })
            await tx.userRole.upsert({
              where: { userId_roleId: { userId: savedUser.id, roleId: role.id } },
              update: { deletedAt: null },
              create: { userId: savedUser.id, roleId: role.id },
            })

            return { user: savedUser, isNewUser: !existingUser }
          })
          let userResult: Awaited<ReturnType<typeof syncGoogleUser>> | undefined
          for (let attempt = 0; attempt < 2; attempt += 1) {
            try {
              userResult = await syncGoogleUser()
              break
            } catch (error) {
              const isUniqueRace = error instanceof Prisma.PrismaClientKnownRequestError && (error.code === 'P2002' || error.code === 'P2034')
              if (!isUniqueRace || attempt === 1) throw error
              logger.warn({ googleId, attempt: attempt + 1 }, 'Retrying concurrent Google account synchronization')
            }
          }
          if (!userResult) throw new Error('Could not synchronize Google account.')
          const { user, isNewUser } = userResult

          if (isNewUser) {
            try {
              await sendWelcomeEmail(user)
            } catch (error) {
              logger.warn({ error, userId: user.id }, 'Google welcome email failed; continuing login')
            }
          }

          const userProfile = await getUserProfile(user.id);
          if (!userProfile) {
            return done(new Error('Could not retrieve user profile after login.'), undefined);
          }

          return done(null, userProfile);
        } catch (error) {
          return done(error, undefined);
        }
      }
    )
  );
}

const cacheGoogleAvatar = async (value: string | null): Promise<string | null> => {
  const canonicalUrl = canonicalizeGoogleAvatarUrl(value)
  if (!canonicalUrl) return null

  try {
    const response = await fetch(canonicalUrl, {
      headers: { Accept: 'image/*' },
      signal: AbortSignal.timeout(5000),
    })
    if (!response.ok) return null

    const contentType = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() ?? ''
    const contentLength = Number(response.headers.get('content-length'))
    if (!contentType.startsWith('image/') || (Number.isFinite(contentLength) && contentLength > 2 * 1024 * 1024)) return null

    const buffer = Buffer.from(await response.arrayBuffer())
    if (buffer.length === 0 || buffer.length > 2 * 1024 * 1024) return null
    return await uploadStreamToCloudinary(buffer, 'sportzone/avatars')
  } catch (error) {
    logger.warn({ error: error instanceof Error ? error.message : 'Unknown avatar cache error' }, 'Google avatar caching failed; continuing OAuth login')
    return null
  }
}