import prisma from '../../core/prisma.js'
import type { MediaType, Prisma } from '@prisma/client'

const syncLegacyEventMedia = async () => {
  const [events, categories, channels, streams] = await Promise.all([
    prisma.event.findMany({
      where: { deletedAt: null, OR: [{ banner: { not: null } }, { logo: { not: null } }] },
      select: { banner: true, logo: true },
    }),
    prisma.channelCategory.findMany({ where: { image: { not: null } }, select: { image: true } }),
    prisma.channel.findMany({ where: { logo: { not: null } }, select: { logo: true } }),
    prisma.stream.findMany({ where: { deletedAt: null, logo: { not: null } }, select: { logo: true } }),
  ])
  const assets = [
    ...events.flatMap((event) => [
      event.banner ? { type: 'BANNER' as const, url: event.banner } : null,
      event.logo ? { type: 'LOGO' as const, url: event.logo } : null,
    ]),
    ...categories.map((category) => category.image ? { type: 'LOGO' as const, url: category.image } : null),
    ...channels.map((channel) => channel.logo ? { type: 'LOGO' as const, url: channel.logo } : null),
    ...streams.map((stream) => stream.logo ? { type: 'LOGO' as const, url: stream.logo } : null),
  ].filter((asset): asset is { type: 'BANNER' | 'LOGO'; url: string } => asset !== null)
  await Promise.all(assets.map((asset) => upsertMedia({ type: asset.type, url: asset.url, publicId: asset.url })))
}

export const listMedia = async (type?: MediaType, search?: string) => {
  await syncLegacyEventMedia()
  const query = search?.trim()
  const where: Prisma.MediaAssetWhereInput = {
    deletedAt: null,
    ...(type ? { type } : {}),
    ...(query ? { OR: [{ fileName: { contains: query, mode: 'insensitive' } }, { publicId: { contains: query, mode: 'insensitive' } }] } : {}),
  }
  return prisma.mediaAsset.findMany({ where, orderBy: { createdAt: 'desc' } })
}

export const upsertMedia = (data: Prisma.MediaAssetCreateInput) => prisma.mediaAsset.upsert({
  where: { publicId: data.publicId },
  create: data,
  update: { url: data.url, fileName: data.fileName, mimeType: data.mimeType, size: data.size, width: data.width, height: data.height, deletedAt: null },
})

export const getMediaUsage = async (id: string) => {
  const media = await prisma.mediaAsset.findUnique({ where: { id } })
  if (!media) return null
  const events = await prisma.event.findMany({
    where: { deletedAt: null, OR: [{ banner: media.url }, { logo: media.url }] },
    select: { id: true, name: true, slug: true },
  })
  return { media, events }
}

export const softDeleteMedia = (id: string) => prisma.mediaAsset.update({ where: { id }, data: { deletedAt: new Date() } })
