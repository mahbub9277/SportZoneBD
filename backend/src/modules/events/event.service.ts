import prisma from '../../core/prisma.js'
import type { Prisma } from '@prisma/client'

const publicChannelSelect = {
  id: true,
  name: true,
  logo: true,
  url: true,
  viewers: true,
  isPremium: true,
  status: true,
  categoryId: true,
  category: { select: { id: true, name: true, image: true } },
} satisfies Prisma.ChannelSelect

export const getSidebarEvents = () => prisma.event.findMany({
  where: { status: 'ACTIVE', showInSidebar: true, deletedAt: null },
  orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
  select: { id: true, name: true, slug: true, logo: true, isPremium: true },
})

export const getPublicEventBySlug = (slug: string) => prisma.event.findFirst({
  where: { slug, status: 'ACTIVE', deletedAt: null },
  include: {
    eventChannels: {
      where: { channel: { status: 'ACTIVE' } },
      orderBy: { channel: { name: 'asc' } },
      select: { channel: { select: publicChannelSelect } },
    },
    eventMatches: {
      where: { match: { deletedAt: null } },
      orderBy: { match: { kickoffAt: 'asc' } },
      select: { match: { include: { streams: true } } },
    },
  },
})

export const getAdminEvents = () => prisma.event.findMany({
  where: { deletedAt: null },
  orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
  include: {
    eventChannels: { select: { channelId: true } },
    eventMatches: { select: { matchId: true } },
    _count: { select: { eventChannels: true } },
  },
})

export const getAdminEvent = (id: string) => prisma.event.findFirst({
  where: { id, deletedAt: null },
  include: { eventChannels: { select: { channelId: true } }, eventMatches: { select: { matchId: true } } },
})

export const createEvent = (data: Prisma.EventCreateInput, channelIds: string[], matchIds: string[]) => prisma.$transaction(async (tx) => {
  const event = await tx.event.create({ data })
  if (channelIds.length > 0) {
    await tx.eventChannel.createMany({ data: channelIds.map((channelId) => ({ eventId: event.id, channelId })) })
  }
  if (matchIds.length > 0) {
    await tx.eventMatch.createMany({ data: matchIds.map((matchId) => ({ eventId: event.id, matchId })) })
  }
  return tx.event.findUniqueOrThrow({ where: { id: event.id }, include: { eventChannels: { select: { channelId: true } }, eventMatches: { select: { matchId: true } } } })
})

export const updateEvent = (id: string, data: Prisma.EventUpdateInput, channelIds?: string[], matchIds?: string[]) => prisma.$transaction(async (tx) => {
  const event = await tx.event.update({ where: { id }, data })
  if (channelIds) {
    await tx.eventChannel.deleteMany({ where: { eventId: id } })
    if (channelIds.length > 0) {
      await tx.eventChannel.createMany({ data: channelIds.map((channelId) => ({ eventId: id, channelId })) })
    }
  }
  if (matchIds) {
    await tx.eventMatch.deleteMany({ where: { eventId: id } })
    if (matchIds.length > 0) await tx.eventMatch.createMany({ data: matchIds.map((matchId) => ({ eventId: id, matchId })) })
  }
  return tx.event.findUniqueOrThrow({ where: { id: event.id }, include: { eventChannels: { select: { channelId: true } }, eventMatches: { select: { matchId: true } } } })
})

export const reorderEvents = (items: Array<{ id: string; sortOrder: number }>) => prisma.$transaction(
  items.map((item) => prisma.event.update({ where: { id: item.id }, data: { sortOrder: item.sortOrder } })),
)

export const softDeleteEvent = (id: string) => prisma.event.update({ where: { id }, data: { deletedAt: new Date(), showInSidebar: false, status: 'INACTIVE' } })
