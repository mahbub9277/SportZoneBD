import prisma from '../core/prisma.js'
import { buildCloudinarySecureUrl, deleteFileFromCloudinary } from './upload.service.js'

const assetMatches = (value: string | null | undefined, asset: string): boolean => Boolean(value && value.trim() === asset.trim())

const getAssetVariants = (asset: string): string[] => {
  const value = asset.trim()
  const secureUrl = buildCloudinarySecureUrl(value)
  return [...new Set([value, secureUrl].filter((candidate): candidate is string => Boolean(candidate)))]
}

export const isAssetReferenced = async (asset: string): Promise<boolean> => {
  const value = asset.trim()
  if (!value) return false
  const variants = getAssetVariants(value)

  const [users, categories, channels, teams, matches, streams, events, popups, advertisements, highlights] = await Promise.all([
    prisma.user.count({ where: { deletedAt: null, avatar: { in: variants } } }),
    prisma.channelCategory.count({ where: { image: { in: variants } } }),
    prisma.channel.count({ where: { logo: { in: variants } } }),
    prisma.team.count({ where: { deletedAt: null, OR: [{ logoUrl: { in: variants } }, { logoPublicId: { in: variants } }] } }),
    prisma.match.count({ where: { deletedAt: null, OR: [{ homeTeamLogo: { in: variants } }, { awayTeamLogo: { in: variants } }] } }),
    prisma.stream.count({ where: { deletedAt: null, logo: { in: variants } } }),
    prisma.event.count({ where: { deletedAt: null, OR: [{ logo: { in: variants } }, { banner: { in: variants } }] } }),
    prisma.popup.count({ where: { deletedAt: null, imageUrl: { in: variants } } }),
    prisma.advertisement.count({ where: { deletedAt: null, imageUrl: { in: variants } } }),
    prisma.highlight.count({
      where: {
        deletedAt: null,
        OR: [
          { thumbnail: { in: variants } },
          { thumbnailUrl: { in: variants } },
          { videoId: { in: variants } },
          { url: { in: variants } },
        ],
      },
    }),
  ])

  return [users, categories, channels, teams, matches, streams, events, popups, advertisements, highlights].some((count) => count > 0)
}

export const cleanupAssetIfUnused = async (asset: string | null | undefined): Promise<void> => {
  if (!asset?.trim() || await isAssetReferenced(asset)) return

  await prisma.mediaAsset.updateMany({
    where: { deletedAt: null, OR: [{ url: { in: getAssetVariants(asset ?? '') } }, { publicId: { in: getAssetVariants(asset ?? '') } }] },
    data: { deletedAt: new Date() },
  })
  await deleteFileFromCloudinary(asset)
}

export const cleanupReplacedAsset = async (oldAsset: string | null | undefined, newAsset: string | null | undefined): Promise<void> => {
  if (!oldAsset || assetMatches(oldAsset, newAsset ?? '')) return
  await cleanupAssetIfUnused(oldAsset)
}
