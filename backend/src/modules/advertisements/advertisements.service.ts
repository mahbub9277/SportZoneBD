import { prisma } from '../../core/prisma.js'
import { createHash, randomBytes } from 'node:crypto'

export type AdvertisementPlacement = 'MATCH' | 'CHANNEL' | 'BOTH' | 'FULL_PAGE'
export const AD_SESSION_COOKIE = 'sportzone_ad_session'

const hashSessionToken = (token: string) => createHash('sha256').update(token).digest('hex')

export const getInterstitialAdvertisement = async (placement: 'MATCH' | 'CHANNEL' | 'FULL_PAGE') => {
  return prisma.advertisement.findFirst({
    where: {
      isActive: true,
      deletedAt: null,
      interstitialEnabled: true,
      OR: [{ placement }, { placement: 'BOTH' }],
    },
    orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
  })
}

export const getAdvertisementForUnlock = (id: string) => prisma.advertisement.findFirst({
  where: { id, isActive: true, deletedAt: null, interstitialEnabled: true },
})

export const getValidUnlock = async (userId: string) => {
  const unlock = await prisma.adUnlock.findUnique({ where: { userId } })
  return unlock && unlock.expiresAt > new Date() ? unlock : null
}

export const getValidAccess = async (userId?: string, sessionToken?: string) => {
  if (userId) {
    const unlock = await getValidUnlock(userId)
    if (unlock) return unlock
  }
  if (!sessionToken) return null
  const session = await prisma.adViewSession.findFirst({
    where: { sessionTokenHash: hashSessionToken(sessionToken), completedAt: { not: null }, canceledAt: null, unlockExpiresAt: { gt: new Date() } },
    select: { unlockExpiresAt: true },
  })
  return session?.unlockExpiresAt ? { expiresAt: session.unlockExpiresAt } : null
}

export const startViewSession = async (advertisementId: string, userId?: string) => {
  const advertisement = await prisma.advertisement.findFirst({ where: { id: advertisementId, isActive: true, deletedAt: null, interstitialEnabled: true } })
  if (!advertisement) return null
  const token = randomBytes(32).toString('hex')
  const session = await prisma.adViewSession.create({ data: { advertisementId, userId, sessionTokenHash: hashSessionToken(token), durationSeconds: advertisement.durationSeconds } })
  return { session, token, advertisement }
}

export const completeViewSession = async (sessionId: string, sessionToken: string, userId?: string) => {
  const session = await prisma.adViewSession.findUnique({ where: { id: sessionId }, include: { advertisement: true } })
  if (!session || session.sessionTokenHash !== hashSessionToken(sessionToken) || session.canceledAt || !session.advertisement.isActive || session.advertisement.deletedAt) return null
  if (userId && session.userId && session.userId !== userId) return null
  if (session.completedAt && session.unlockExpiresAt) return { completed: session, unlockExpiresAt: session.unlockExpiresAt, alreadyCompleted: true }
  if (Date.now() < session.startedAt.getTime() + session.durationSeconds * 1000) return null
  const unlockExpiresAt = new Date(Date.now() + (session.advertisement.unlockHours === 12 ? 12 : 24) * 60 * 60 * 1000)
  const completionTime = new Date()
  const result = await prisma.adViewSession.updateMany({ where: { id: session.id, sessionTokenHash: hashSessionToken(sessionToken), completedAt: null, canceledAt: null }, data: { completedAt: completionTime, unlockExpiresAt } })
  if (result.count === 0) {
    const completed = await prisma.adViewSession.findUnique({ where: { id: session.id } })
    if (!completed?.completedAt || !completed.unlockExpiresAt) return null
    return { completed, unlockExpiresAt: completed.unlockExpiresAt, alreadyCompleted: true }
  }
  const completed = await prisma.adViewSession.findUniqueOrThrow({ where: { id: session.id } })
  if (userId) {
    await grantUnlock(userId, session.advertisement.unlockHours)
  }
  return { completed, unlockExpiresAt, alreadyCompleted: false }
}

export const cancelViewSession = (sessionId: string, sessionToken: string) => prisma.adViewSession.updateMany({ where: { id: sessionId, sessionTokenHash: hashSessionToken(sessionToken), completedAt: null, canceledAt: null }, data: { canceledAt: new Date() } })

export const grantUnlock = async (userId: string, unlockHours: number) => {
  const existing = await getValidUnlock(userId)
  if (existing) return existing
  const safeHours = unlockHours === 12 ? 12 : 24
  return prisma.adUnlock.upsert({
    where: { userId },
    create: { userId, expiresAt: new Date(Date.now() + safeHours * 60 * 60 * 1000) },
    update: { expiresAt: new Date(Date.now() + safeHours * 60 * 60 * 1000) },
  })
}

