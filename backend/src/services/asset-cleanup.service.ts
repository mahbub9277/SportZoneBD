import prisma from '../core/prisma.js'
import { Prisma } from '@prisma/client'
import { getAssetIdentity, referenceOr } from './assetReference.js'
import { deleteFileFromCloudinary } from './upload.service.js'

const assetMatches = (value: string | null | undefined, asset: string): boolean => Boolean(value && value.trim() === asset.trim())

export const isAssetReferenced = async (asset: string): Promise<boolean> => {
  const identity = getAssetIdentity(asset)
  if (!identity) return false

  const references = await Promise.all([
    prisma.user.count({ where: { deletedAt: null, OR: referenceOr<Prisma.UserWhereInput>(['avatar'], identity) } }),
    prisma.channelCategory.count({ where: { OR: referenceOr<Prisma.ChannelCategoryWhereInput>(['image'], identity) } }),
    prisma.channel.count({ where: { OR: referenceOr<Prisma.ChannelWhereInput>(['logo'], identity) } }),
    prisma.team.count({
      where: { deletedAt: null, OR: referenceOr<Prisma.TeamWhereInput>(['logoUrl', 'logoPublicId'], identity) },
    }),
    prisma.match.count({
      where: { deletedAt: null, OR: referenceOr<Prisma.MatchWhereInput>(['homeTeamLogo', 'awayTeamLogo'], identity) },
    }),
    prisma.stream.count({ where: { deletedAt: null, OR: referenceOr<Prisma.StreamWhereInput>(['logo'], identity) } }),
    prisma.event.count({
      where: { deletedAt: null, OR: referenceOr<Prisma.EventWhereInput>(['logo', 'banner'], identity) },
    }),
    prisma.popup.count({ where: { deletedAt: null, OR: referenceOr<Prisma.PopupWhereInput>(['imageUrl'], identity) } }),
    prisma.advertisement.count({
      where: { deletedAt: null, OR: referenceOr<Prisma.AdvertisementWhereInput>(['imageUrl'], identity) },
    }),
    prisma.highlight.count({
      where: {
        deletedAt: null,
        OR: referenceOr<Prisma.HighlightWhereInput>(['thumbnail', 'thumbnailUrl', 'videoId', 'url'], identity),
      },
    }),
    prisma.banner.count({
      where: { deletedAt: null, OR: referenceOr<Prisma.BannerWhereInput>(['imageUrl', 'videoUrl', 'posterUrl'], identity) },
    }),
  ])

  return references.some((count) => count > 0)
}

export const cleanupAssetIfUnused = async (asset: string | null | undefined): Promise<void> => {
  if (!asset?.trim() || await isAssetReferenced(asset)) return

  const identity = getAssetIdentity(asset)
  if (!identity) return

  await prisma.mediaAsset.updateMany({
    where: { deletedAt: null, OR: referenceOr<Prisma.MediaAssetWhereInput>(['url', 'publicId'], identity) },
    data: { deletedAt: new Date() },
  })
  await deleteFileFromCloudinary(asset)
}

export const cleanupReplacedAsset = async (oldAsset: string | null | undefined, newAsset: string | null | undefined): Promise<void> => {
  if (!oldAsset || assetMatches(oldAsset, newAsset ?? '')) return
  await cleanupAssetIfUnused(oldAsset)
}
