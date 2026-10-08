import { Prisma } from '@prisma/client'
import { prisma } from '../core/prisma.js'
import { cacheRedis } from '../core/redis.js'
import { invalidateTags } from '../core/cache.js'
import { emitAdminResourceDeleted } from '../core/socketManager.js'
import { cleanupAssetIfUnused } from './asset-cleanup.service.js'
import logger from '../core/logger.js'

export type MatchCleanupReason = 'ADMIN_DELETE' | 'FINISHED_RETENTION_EXPIRED'

interface MatchCleanupResult {
  deleted: boolean
  streamCount: number
  assetCount: number
}

const uniqueAssets = (assets: Array<string | null | undefined>) =>
  [...new Set(assets.filter((asset): asset is string => typeof asset === 'string' && asset.trim().length > 0).map((asset) => asset.trim()))]

export async function cleanupMatch(id: string, reason: MatchCleanupReason): Promise<MatchCleanupResult> {
  const startedAt = Date.now()
  logger.info({ matchId: id, reason }, 'Match cleanup started')

  const match = await prisma.match.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      homeTeamLogo: true,
      awayTeamLogo: true,
      streams: { select: { id: true, logo: true } },
    },
  })

  if (!match) {
    logger.info({ matchId: id, reason }, 'Match cleanup skipped because it was already deleted')
    return { deleted: false, streamCount: 0, assetCount: 0 }
  }

  // A rejection is a durable review decision, not a public record: purging the row would drop its
  // unique provider key and let automatic discovery publish the fixture again as a new pending match.
  if (match.status === 'REJECTED') {
    logger.warn({ matchId: id, reason }, 'Match cleanup skipped because an admin rejection must survive')
    return { deleted: false, streamCount: 0, assetCount: 0 }
  }

  const assets = uniqueAssets([
    match.homeTeamLogo,
    match.awayTeamLogo,
    ...match.streams.map((stream) => stream.logo),
  ])

  try {
    await prisma.$transaction(async (tx) => {
      await tx.match.delete({ where: { id: match.id } })
    })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
      logger.info({ matchId: id, reason }, 'Match cleanup lost a concurrent delete race')
      return { deleted: false, streamCount: 0, assetCount: assets.length }
    }
    logger.error({ error, matchId: id, reason }, 'Match database cleanup failed')
    throw error
  }

  await Promise.allSettled(assets.map(async (asset) => {
    try {
      await cleanupAssetIfUnused(asset)
    } catch (error) {
      logger.error({ error, matchId: id, asset, reason }, 'Match Cloudinary cleanup failed')
    }
  }))

  await invalidateTags(['matches', 'streams', 'FinishedMatch', 'AdminStats', 'events'])
  // The prewarmed match detail entry is written without tags, so it is removed explicitly.
  await cacheRedis.del(`/api/v1/matches/${id}`).catch(() => undefined)
  emitAdminResourceDeleted('Match', id)

  logger.info({
    matchId: id,
    reason,
    streamCount: match.streams.length,
    assetCount: assets.length,
    durationMs: Date.now() - startedAt,
  }, 'Match cleanup completed')

  return { deleted: true, streamCount: match.streams.length, assetCount: assets.length }
}
