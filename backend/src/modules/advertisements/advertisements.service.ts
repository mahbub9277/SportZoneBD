import { prisma } from '../../core/prisma.js'
import { createHash, randomBytes } from 'node:crypto'
import { decideSessionCompletion, isUnlockStillValid, normalizeUnlockHours, unlockExpiresAtMs } from './adSessionRules.js'

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
  return unlock && isUnlockStillValid(unlock.expiresAt, Date.now()) ? unlock : null
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
  if (!session) return null

  const nowMs = Date.now()
  const decision = decideSessionCompletion({
    sessionTokenHash: session.sessionTokenHash,
    canceledAt: session.canceledAt,
    completedAt: session.completedAt,
    unlockExpiresAt: session.unlockExpiresAt,
    startedAt: session.startedAt,
    durationSeconds: session.durationSeconds,
    userId: session.userId,
    advertisementUnavailable: !session.advertisement.isActive || Boolean(session.advertisement.deletedAt),
  }, { sessionTokenHash: hashSessionToken(sessionToken), nowMs, userId })

  if (decision.kind === 'invalid' || decision.kind === 'too-early') return null
  if (decision.kind === 'already-completed') return { completed: session, unlockExpiresAt: decision.unlockExpiresAt, alreadyCompleted: true }

  const unlockExpiresAt = new Date(unlockExpiresAtMs(nowMs, session.advertisement.unlockHours))
  const completionTime = new Date(nowMs)
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
  const safeHours = normalizeUnlockHours(unlockHours)
  const nowMs = Date.now()
  return prisma.adUnlock.upsert({
    where: { userId },
    create: { userId, expiresAt: new Date(unlockExpiresAtMs(nowMs, safeHours)) },
    update: { expiresAt: new Date(unlockExpiresAtMs(nowMs, safeHours)) },
  })
}

