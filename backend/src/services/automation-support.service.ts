import cloudinary from '../lib/cloudinary.js'
import { prisma } from '../core/prisma.js'
import { redis } from '../core/redis.js'
import { successResponse } from '../core/api-response.js'
import { isAssetReferenced, cleanupAssetIfUnused } from './asset-cleanup.service.js'
import logger from '../core/logger.js'

const PREWARM_TTL_SECONDS = 120
const PREWARM_WINDOW_MINUTES = 15
const MANAGED_CLOUDINARY_PREFIXES = [
  'sportzone/banners',
  'sportzone/avatars',
  'sportzone/events',
  'sportzone/advertisements',
  'sportzone/popups',
  'sportzone/stream-logos',
  'sportzone/branding',
  'sportzone/favicon',
]

export async function prewarmUpcomingMatches(now = new Date()): Promise<void> {
  try {
    const matches = await prisma.match.findMany({
      where: {
        deletedAt: null,
        status: 'UPCOMING',
        kickoffAt: {
          gt: now,
          lte: new Date(now.getTime() + PREWARM_WINDOW_MINUTES * 60 * 1000),
        },
      },
      orderBy: { kickoffAt: 'asc' },
      take: 50,
      include: {
        streams: {
          where: { deletedAt: null, enabled: true, status: { notIn: ['OFFLINE', 'ERROR'] } },
          orderBy: { createdAt: 'asc' },
        },
      },
    })

    for (const match of matches) {
      const key = `/api/v1/matches/${match.id}`
      await redis.set(key, JSON.stringify(successResponse(match, 'Match retrieved successfully')), 'EX', PREWARM_TTL_SECONDS)
    }

    if (matches.length > 0) {
      logger.info({ matchIds: matches.map(({ id }) => id), count: matches.length }, 'Upcoming match cache pre-warm completed')
    }
  } catch (error) {
    logger.warn({ error }, 'Upcoming match cache pre-warm failed')
  }
}

async function listManagedResources(prefix: string, nextCursor?: string): Promise<{ resources: Array<{ public_id: string }>; next_cursor?: string }> {
  return cloudinary.api.resources({
    type: 'upload',
    prefix,
    max_results: 100,
    ...(nextCursor ? { next_cursor: nextCursor } : {}),
  }) as Promise<{ resources: Array<{ public_id: string }>; next_cursor?: string }>
}

export async function cleanupCloudinaryOrphans(): Promise<void> {
  let scanned = 0
  let deleted = 0
  let failed = 0
  logger.info('Cloudinary orphan cleanup started')

  for (const prefix of MANAGED_CLOUDINARY_PREFIXES) {
    let nextCursor: string | undefined
    do {
      try {
        const page = await listManagedResources(prefix, nextCursor)
        for (const resource of page.resources ?? []) {
          scanned += 1
          try {
            if (await isAssetReferenced(resource.public_id)) continue
            await cleanupAssetIfUnused(resource.public_id)
            deleted += 1
          } catch (error) {
            failed += 1
            logger.warn({ error, publicId: resource.public_id }, 'Cloudinary orphan deletion failed')
          }
        }
        nextCursor = page.next_cursor
      } catch (error) {
        failed += 1
        nextCursor = undefined
        logger.warn({ error, prefix }, 'Cloudinary resource scan failed')
      }
    } while (nextCursor)
  }

  logger.info({ scanned, deleted, failed }, 'Cloudinary orphan cleanup completed')
}