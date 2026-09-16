import prisma from '../../core/prisma.js'
import { redis } from '../../core/redis.js'
import type { Channel, ChannelCategory } from '@prisma/client'

const LIVE_VIEWERS_WINDOW_MS = 30_000
const getLiveViewerKey = (channelId: string) => `channel:${channelId}:live-viewers`
const getSocketLiveViewerKey = (channelId: string) => `sportzone:live-viewers:channel:${channelId}`

export const normalizeChannelStatus = (value: unknown): 'ACTIVE' | 'INACTIVE' | 'MAINTENANCE' => {
  if (typeof value === 'string') {
    const normalized = value.trim().toUpperCase()
    if (normalized === 'ACTIVE' || normalized === 'INACTIVE' || normalized === 'MAINTENANCE') {
      return normalized as 'ACTIVE' | 'INACTIVE' | 'MAINTENANCE'
    }
  }

  return 'ACTIVE'
}

// Public Services
export const getPublicChannelsGroupedByCategory = () => {
  return prisma.channelCategory.findMany({
    where: {
      channels: {
        some: {
          status: 'ACTIVE',
        },
      },
    },
    include: {
      channels: {
        where: {
          status: 'ACTIVE',
        },
        orderBy: {
          name: 'asc',
        },
      },
    },
    orderBy: {
      name: 'asc',
    },
  })
}

export const getChannelById = (id: string, isAdmin = false) => {
  if (isAdmin) {
    // Admins can see all channels, regardless of status
    return prisma.channel.findUnique({
      where: { id },
      include: {
        category: true,
      },
    })
  }

  // Public users only see active channels
  return prisma.channel.findFirst({
    where: { id, status: 'ACTIVE' },
    include: {
      category: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  })
}

const cleanupLiveViewerKey = async (channelId: string) => {
  const key = getLiveViewerKey(channelId)
  const now = Date.now()
  const windowStart = now - LIVE_VIEWERS_WINDOW_MS
  await redis.zremrangebyscore(key, 0, windowStart)
  await redis.expire(key, Math.ceil((LIVE_VIEWERS_WINDOW_MS * 2) / 1000))
}

const getAndUpdateViewerCount = async (channelId: string): Promise<number> => {
  const key = getLiveViewerKey(channelId)
  const now = Date.now()
  const windowStart = now - LIVE_VIEWERS_WINDOW_MS
  try {
    await redis.zremrangebyscore(key, 0, windowStart)
    const count = await redis.zcount(key, windowStart, now)
    await redis.expire(key, Math.ceil((LIVE_VIEWERS_WINDOW_MS * 2) / 1000))
    return Number(count ?? 0)
  } catch {
    // In case of Redis error, return 0
    return 0
  }
}

export const getLiveViewerCount = async (channelId: string) => {
  return getAndUpdateViewerCount(channelId)
}

export const trackViewerEnter = async (channelId: string, viewerId: string) => {
  const key = getLiveViewerKey(channelId)
  const now = Date.now()
  try {
    await redis.zadd(key, now, viewerId)
  }
  finally {
    await cleanupLiveViewerKey(channelId)
  }
  return getAndUpdateViewerCount(channelId)
}

export const trackViewerLeave = async (channelId: string, viewerId: string) => {
  const key = getLiveViewerKey(channelId)
  try {
    await redis.zrem(key, viewerId)
  }
  finally {
    await cleanupLiveViewerKey(channelId)
  }
  return getAndUpdateViewerCount(channelId)
}

export const getWatchData = async (id: string) => {
  const channel = await getChannelById(id, false) // false for public user

  if (!channel) {
    return { channel: null, relatedChannels: [], liveViewers: 0 }
  }

  const relatedChannels = await getRelatedChannels(id, channel.categoryId)
  const liveViewers = await (async () => {
    try {
      const key = getSocketLiveViewerKey(id)
      const now = Date.now()
      await redis.zremrangebyscore(key, 0, now)
      const count = await redis.zcount(key, now, '+inf')
      return Number.isFinite(Number(count)) ? Math.max(0, Number(count)) : 0
    } catch {
      return 0
    }
  })()

  return {
    channel,
    relatedChannels,
    liveViewers,
  }
}

export const getChannelsByIds = (ids: string[]) => {
  return prisma.channel.findMany({
    where: {
      id: {
        in: ids,
      },
      status: 'ACTIVE', // Only return active channels for public access
    },
    orderBy: {
      name: 'asc',
    },
  })
}

export const getRelatedChannels = (channelId: string, categoryId: string) => {
  return prisma.channel.findMany({
    where: {
      categoryId,
      id: {
        not: channelId,
      },
      status: 'ACTIVE',
    },
    take: 6, // Limit to 6 related channels
    orderBy: {
      name: 'asc',
    },
  })
}

// Admin Category Services
export const getAllCategories = () => {
  return prisma.channelCategory.findMany({ orderBy: { name: 'asc' } })
}

export const getAdminChannels = async () => {
  const channels = await prisma.channel.findMany({ orderBy: { name: 'asc' } })
  const reactions = await prisma.channelReaction.groupBy({ by: ['channelId', 'type'], where: { channelId: { in: channels.map((channel) => channel.id) } }, _count: { _all: true } })
  return channels.map((channel) => ({
    ...channel,
    reactionCounts: {
      like: reactions.find((reaction) => reaction.channelId === channel.id && reaction.type === 'LIKE')?._count._all ?? 0,
      dislike: reactions.find((reaction) => reaction.channelId === channel.id && reaction.type === 'DISLIKE')?._count._all ?? 0,
    },
  }))
/*  return prisma.channel.findMany({
    orderBy: { name: 'asc' },
    include: { _count: { select: { reactions: true } } },
  }) */
}

export const createCategory = (data: Omit<ChannelCategory, 'id' | 'createdAt' | 'updatedAt'>) => {
  return prisma.channelCategory.create({ data })
}

export const updateCategory = (id: string, data: Partial<ChannelCategory>) => {
  return prisma.channelCategory.update({ where: { id }, data })
}

export const deleteCategory = (id: string) => {
  return prisma.channelCategory.delete({ where: { id } })
}

// Admin Channel Services
export const createChannel = (data: Omit<Channel, 'id' | 'createdAt' | 'updatedAt'>) => {
  return prisma.channel.create({ data })
}

export const updateChannel = (id: string, data: Partial<Channel>) => {
  return prisma.channel.update({ where: { id }, data })
}

export const deleteChannel = (id: string) => {
  return prisma.channel.delete({ where: { id } })
}

export async function getChannelReactionSummary(channelId: string, userId: string | null) {
  const [groups, userReaction] = await Promise.all([
    prisma.channelReaction.groupBy({ by: ['type'], where: { channelId }, _count: { _all: true } }),
    userId ? prisma.channelReaction.findUnique({ where: { userId_channelId: { userId, channelId } }, select: { type: true } }) : null,
  ])
  return {
    likeCount: groups.find((group) => group.type === 'LIKE')?._count._all ?? 0,
    dislikeCount: groups.find((group) => group.type === 'DISLIKE')?._count._all ?? 0,
    userReaction: userReaction?.type ?? null,
  }
}

export async function toggleChannelReaction(channelId: string, userId: string, type: 'LIKE' | 'DISLIKE') {
  const existing = await prisma.channelReaction.findUnique({ where: { userId_channelId: { userId, channelId } } })
  if (existing?.type === type) await prisma.channelReaction.delete({ where: { id: existing.id } })
  else if (existing) await prisma.channelReaction.update({ where: { id: existing.id }, data: { type } })
  else await prisma.channelReaction.create({ data: { userId, channelId, type } })
  return getChannelReactionSummary(channelId, userId)
}