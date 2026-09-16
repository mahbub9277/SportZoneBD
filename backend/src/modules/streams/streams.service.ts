import type { StreamStatus } from '@prisma/client'
import { prisma } from '../../core/prisma.js'
import { getPaginatedData, type PaginatedQuery, type PaginatedResult } from '../../services/pagination.service.js'
import { invalidateTags } from '../../core/cache.js'
import { writeAuditLog } from '../../core/audit.js'

export const listStreams = async (query: PaginatedQuery) => {
  const { items, meta } = await getPaginatedData({
    model: 'stream',
    query: { ...query, where: { ...(query.where as object ?? {}), deletedAt: null } },
    searchableFields: ['primaryUrl', 'quality'],
    include: { match: { select: { id: true, title: true } } },
  })
  return { items, meta }
}

export const getStream = async (id: string) => {
  return prisma.stream.findFirst({ where: { id, deletedAt: null } })
}

export const createStream = async (payload: {
  matchId: string
  name?: string
  logo?: string | null
  primaryUrl?: string | null
  backupUrl?: string | null
  enabled?: boolean
  status?: StreamStatus
  quality?: string
  sourceType?: 'DIRECT_URL' | 'CHANNEL'
  channelId?: string | null
  activationMode?: 'AUTOMATIC' | 'MANUAL'
  activationOffsetMinutes?: number
}) => {
  const match = await prisma.match.findFirst({ where: { id: payload.matchId, deletedAt: null }, select: { id: true } })
  if (!match) throw new Error('Match not found')

  const normalizedSourceType = payload.sourceType === 'CHANNEL' ? 'CHANNEL' : 'DIRECT_URL'
  const channelId = normalizedSourceType === 'CHANNEL' && payload.channelId ? payload.channelId : null

  let primaryUrl = typeof payload.primaryUrl === 'string' ? payload.primaryUrl.trim() : ''
  if (normalizedSourceType === 'CHANNEL' && channelId) {
    const channel = await prisma.channel.findUnique({ where: { id: channelId }, select: { url: true } })
    if (channel?.url) {
      primaryUrl = channel.url.trim()
    }
  }

  const normalizedPayload = {
    ...payload,
    name: payload.name?.trim() || 'Main stream',
    sourceType: normalizedSourceType as 'DIRECT_URL' | 'CHANNEL',
    channelId,
    primaryUrl: primaryUrl || payload.primaryUrl || '',
    backupUrl: payload.backupUrl?.trim() || null,
    enabled: payload.enabled ?? true,
    status: (payload.status ?? 'READY') as StreamStatus,
    quality: payload.quality?.trim() || 'auto',
    activationMode: (payload.activationMode === 'MANUAL' ? 'MANUAL' : 'AUTOMATIC') as 'AUTOMATIC' | 'MANUAL',
    activationOffsetMinutes: Number(payload.activationOffsetMinutes ?? 0),
  }

  const stream = await prisma.stream.create({ data: normalizedPayload })
  await writeAuditLog('Stream created', { streamId: stream.id, matchId: stream.matchId, name: stream.name })
  await invalidateTags(['matches', 'streams'])
  return stream
}

export const updateStream = async (
  id: string,
  payload: Partial<{
    matchId: string
    name: string
    logo?: string | null
    primaryUrl: string
    backupUrl?: string | null
    enabled?: boolean
    status?: StreamStatus
    quality?: string
    sourceType?: 'DIRECT_URL' | 'CHANNEL'
    channelId?: string | null
    activationMode?: 'AUTOMATIC' | 'MANUAL'
    activationOffsetMinutes?: number
  }>,
) => {
  if (payload.matchId) {
    const match = await prisma.match.findFirst({ where: { id: payload.matchId, deletedAt: null }, select: { id: true } })
    if (!match) throw new Error('Match not found')
  }

  const normalizedSourceType = payload.sourceType === 'CHANNEL' ? 'CHANNEL' : 'DIRECT_URL'
  const channelId = normalizedSourceType === 'CHANNEL' && payload.channelId ? payload.channelId : null

  let primaryUrl = typeof payload.primaryUrl === 'string' ? payload.primaryUrl.trim() : undefined
  if (normalizedSourceType === 'CHANNEL' && channelId) {
    const channel = await prisma.channel.findUnique({ where: { id: channelId }, select: { url: true } })
    if (channel?.url) {
      primaryUrl = channel.url.trim()
    }
  }

  const existingStream = await prisma.stream.findFirst({ where: { id, deletedAt: null }, select: { id: true } })
  if (!existingStream) return null

  const stream = await prisma.stream.update({
    where: { id: existingStream.id },
    data: {
      ...payload,
      sourceType: normalizedSourceType as 'DIRECT_URL' | 'CHANNEL',
      channelId,
      primaryUrl: primaryUrl ?? payload.primaryUrl ?? undefined,
      backupUrl: payload.backupUrl?.trim() || null,
      activationMode: (payload.activationMode === 'MANUAL' ? 'MANUAL' : 'AUTOMATIC') as 'AUTOMATIC' | 'MANUAL',
      activationOffsetMinutes: payload.activationOffsetMinutes ?? undefined,
      status: payload.status ?? undefined,
    },
  })
  await writeAuditLog('Stream updated', { streamId: stream.id, matchId: stream.matchId, name: stream.name })
  await invalidateTags(['matches', 'streams'])
  return stream
}

export const removeStream = async (id: string) => {
  const existingStream = await prisma.stream.findFirst({ where: { id, deletedAt: null }, select: { id: true, matchId: true, name: true } })
  if (!existingStream) return null
  const stream = await prisma.stream.update({ where: { id: existingStream.id }, data: { deletedAt: new Date() } })
  await writeAuditLog('Stream deleted', { streamId: stream.id, matchId: existingStream.matchId, name: existingStream.name })
  await invalidateTags(['matches', 'streams'])
  return stream
}
