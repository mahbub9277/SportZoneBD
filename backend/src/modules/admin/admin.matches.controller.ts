import { type Request, type Response } from 'express'
import { prisma } from '../../core/prisma.js'
import { Prisma } from '@prisma/client'
import { successResponse, errorResponse } from '../../core/api-response.js'
import { getPaginatedData } from '../../services/pagination.service.js'
import asyncHandler from '../../utils/asyncHandler.js'
import { handleMatchFileUploads } from './match-file.service.js'
import { invalidateTags } from '../../core/cache.js'
import { emitAdminResourceCreated, emitAdminResourceUpdated, emitMatchStatusUpdated } from '../../core/socketManager.js'
import { notifyMatchStarted } from '../../services/notification.service.js'
import { cleanupMatch } from '../../services/match-cleanup.service.js'
import { writeAuditLog } from '../../core/audit.js'
import { AppError } from '../../core/errors.js'
import { resolveTeam } from '../teams/team.service.js'

export const getLiveMatches = asyncHandler(async (req: Request, res: Response) => {
  const paginatedQuery = {
    page: Number(req.query.page) || 1,
    limit: Number(req.query.limit) || 10,
    sortBy: (req.query.sortBy as string) || 'kickoffAt:desc',
    search: req.query.search as string,
  }

  const { items, meta } = await getPaginatedData({
    model: 'match',
    query: { ...paginatedQuery, where: { status: 'LIVE', deletedAt: null } },
    searchableFields: ['title'],
  });
  
  res.status(200).json(successResponse({ items, meta }, 'Live matches retrieved'))
})

const normalizeStreamPayload = async (stream: any, channelsMap?: Map<string, { url: string }>) => {
  const sourceType = stream.sourceType === 'CHANNEL' ? 'CHANNEL' : 'DIRECT_URL'
  const activationMode = stream.activationMode === 'MANUAL' ? 'MANUAL' : 'AUTOMATIC'
  const channelId = sourceType === 'CHANNEL' && typeof stream.channelId === 'string' && stream.channelId.trim() ? stream.channelId : null
  let primaryUrl = typeof stream.primaryUrl === 'string' ? stream.primaryUrl.trim() : ''

  // Use provided channels map for O(1) lookup instead of individual database queries
  if (sourceType === 'CHANNEL' && channelId && channelsMap) {
    const channel = channelsMap.get(channelId)
    if (channel?.url) primaryUrl = channel.url.trim()
  } else if (sourceType === 'CHANNEL' && channelId && !channelsMap) {
    // Fallback to individual query if no map provided (legacy compatibility)
    const channel = await prisma.channel.findUnique({
      where: { id: channelId },
      select: { url: true },
    })
    if (channel?.url) primaryUrl = channel.url.trim()
  }

  if (sourceType === 'CHANNEL' && (!channelId || !primaryUrl)) {
    throw new AppError(400, 'Every channel stream must reference an active channel with a playable URL.')
  }
  if (sourceType === 'DIRECT_URL' && !primaryUrl) {
    throw new AppError(400, 'Every direct stream must include a primary URL.')
  }

  return {
    ...stream,
    sourceType,
    channelId,
    activationMode,
    activationOffsetMinutes: Number(stream.activationOffsetMinutes ?? 0),
    primaryUrl: primaryUrl || stream.primaryUrl || '',
    backupUrl: stream.backupUrl ?? (Array.isArray(stream.backupUrls) ? stream.backupUrls.find((url: string) => !!url?.trim()) ?? null : null),
    backupUrls: undefined,
  }
}

export const createMatch = asyncHandler(async (req: Request, res: Response) => {
  try {
    const { streams: streamsJSON, homeTeamId, awayTeamId, ...matchData } = req.body as any
    if (matchData.expectedEndTime === '') matchData.expectedEndTime = null
    if (matchData.expectedEndTime && new Date(matchData.expectedEndTime) < new Date(matchData.kickoffAt)) {
      return res.status(400).json(errorResponse('Expected end time must be after the kickoff time.'))
    }
    const files = (req as any).files
    const uploadedTeamLogoUrls = await handleMatchFileUploads(files)
    const homeTeam = await resolveTeam({ id: homeTeamId || null, name: matchData.homeTeamName, logoUrl: uploadedTeamLogoUrls.homeTeamLogo ?? matchData.homeTeamLogo ?? null })
    const awayTeam = await resolveTeam({ id: awayTeamId || null, name: matchData.awayTeamName, logoUrl: uploadedTeamLogoUrls.awayTeamLogo ?? matchData.awayTeamLogo ?? null })
    
    let streamsToCreate: any[] = []
    let channelsMap = new Map<string, { url: string }>()

    if (streamsJSON) {
      try {
        const parsedStreams = JSON.parse(streamsJSON)
        if (!Array.isArray(parsedStreams)) {
          return res.status(400).json(errorResponse('Streams must be an array.'))
        }

        // Extract all channel IDs from streams for batch loading
        const channelIds = parsedStreams
          .filter((s: any) => s.sourceType === 'CHANNEL' && s.channelId)
          .map((s: any) => s.channelId)

        // Batch load all channels to avoid N+1 queries
        if (channelIds.length > 0) {
          const channels = await prisma.channel.findMany({
            where: { id: { in: [...new Set(channelIds)] }, status: 'ACTIVE' }, // Remove duplicates and reject unavailable channels
            select: { id: true, url: true },
          })
          // Build a map for O(1) lookups
          channelsMap = new Map(channels.map((ch) => [ch.id, { url: ch.url }]))
        }

        streamsToCreate = await Promise.all(
          parsedStreams.map((stream: any) => normalizeStreamPayload(stream, channelsMap))
        )
      } catch (e) {
        if (e instanceof SyntaxError) {
          return res.status(400).json(errorResponse('Invalid streams JSON format.'))
        }
        throw e
      }
    }

    const newMatch = await prisma.match.create({
      data: {
        ...matchData,
        ...uploadedTeamLogoUrls,
        homeTeamId: homeTeam?.id ?? null,
        awayTeamId: awayTeam?.id ?? null,
        ...(homeTeam?.logoUrl ? { homeTeamLogo: homeTeam.logoUrl } : {}),
        ...(awayTeam?.logoUrl ? { awayTeamLogo: awayTeam.logoUrl } : {}),
        streams: streamsToCreate.length > 0 ? { create: streamsToCreate } : undefined,
      },
      include: { streams: { where: { deletedAt: null } }, homeTeam: true, awayTeam: true }
    })

    await writeAuditLog('Match created', {
      matchId: newMatch.id,
      title: newMatch.title,
      status: newMatch.status,
      streamCount: newMatch.streams?.length ?? 0,
    })
    await invalidateTags(['matches', 'streams'])
    
    // Emit real-time event to admin clients
    emitAdminResourceCreated('Match', newMatch.id, {
      id: newMatch.id,
      title: newMatch.title,
      status: newMatch.status,
      kickoffAt: newMatch.kickoffAt,
      streamsCount: newMatch.streams?.length || 0
    })
    emitMatchStatusUpdated({ id: newMatch.id, status: newMatch.status })
    
    res.status(201).json(successResponse(newMatch, 'Match created successfully'))
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2025') {
        return res.status(400).json(errorResponse('One or more referenced resources not found.'))
      }
      if (error.code === 'P2002') {
        return res.status(409).json(errorResponse('A match with that title or similar identifier already exists.'))
      }
    }
    throw error
  }
})

export const updateMatch = asyncHandler(async (req: Request, res: Response) => {
  try {
    const { id } = req.params
    const { streams: streamsJSON, homeTeamId, awayTeamId, ...matchData } = req.body as any
    const existingMatch = await prisma.match.findUnique({
      where: { id },
      select: { status: true, title: true, kickoffAt: true, startTime: true },
    })

    if (!existingMatch) {
      return res.status(404).json(errorResponse('Match not found.'))
    }

    const uploadedTeamLogoUrls = await handleMatchFileUploads((req as any).files)
    const homeTeam = await resolveTeam({ id: homeTeamId || null, name: matchData.homeTeamName, logoUrl: uploadedTeamLogoUrls.homeTeamLogo ?? matchData.homeTeamLogo ?? null })
    const awayTeam = await resolveTeam({ id: awayTeamId || null, name: matchData.awayTeamName, logoUrl: uploadedTeamLogoUrls.awayTeamLogo ?? matchData.awayTeamLogo ?? null })
    if (matchData.expectedEndTime === '') {
      matchData.expectedEndTime = null
    } else if (matchData.expectedEndTime !== undefined && matchData.expectedEndTime !== null) {
      const expectedEndTime = new Date(matchData.expectedEndTime)
      const startReference = existingMatch.startTime ?? existingMatch.kickoffAt
      if (Number.isNaN(expectedEndTime.getTime()) || expectedEndTime < startReference) {
        return res.status(400).json(errorResponse('Expected end time must be after the match start time.'))
      }
      matchData.expectedEndTime = expectedEndTime
    }

    let streamsToUpdate: any[] = []
    let channelsMap = new Map<string, { url: string }>()

    if (streamsJSON) {
      try {
        const parsedStreams = JSON.parse(streamsJSON)
        if (!Array.isArray(parsedStreams)) {
          return res.status(400).json(errorResponse('Streams must be an array.'))
        }

        // Extract all channel IDs from streams for batch loading
        const channelIds = parsedStreams
          .filter((s: any) => s.sourceType === 'CHANNEL' && s.channelId)
          .map((s: any) => s.channelId)

        // Batch load all channels to avoid N+1 queries
        if (channelIds.length > 0) {
          const channels = await prisma.channel.findMany({
            where: { id: { in: [...new Set(channelIds)] } }, // Remove duplicates
            select: { id: true, url: true },
          })
          // Build a map for O(1) lookups
          channelsMap = new Map(channels.map((ch) => [ch.id, { url: ch.url }]))
        }

        streamsToUpdate = await Promise.all(
          parsedStreams.map((stream: any) => normalizeStreamPayload(stream, channelsMap))
        )
      } catch (e) {
        if (e instanceof SyntaxError) {
          return res.status(400).json(errorResponse('Invalid streams JSON format.'))
        }
        throw e
      }
    }

    const updatedMatch = await prisma.$transaction(async (tx) => {
      const updated = await tx.match.update({
        where: { id },
        data: {
          ...matchData,
          ...uploadedTeamLogoUrls,
          homeTeamId: homeTeam?.id ?? null,
          awayTeamId: awayTeam?.id ?? null,
          ...(homeTeam?.logoUrl ? { homeTeamLogo: homeTeam.logoUrl } : {}),
          ...(awayTeam?.logoUrl ? { awayTeamLogo: awayTeam.logoUrl } : {}),
        },
      })

      const retainedStreamIds = streamsToUpdate
        .map((stream) => stream.id)
        .filter((streamId): streamId is string => typeof streamId === 'string' && streamId.length > 0)

      await tx.stream.updateMany({
        where: {
          matchId: id,
          deletedAt: null,
          ...(retainedStreamIds.length > 0 ? { id: { notIn: retainedStreamIds } } : {}),
        },
        data: { enabled: false, status: 'OFFLINE', deletedAt: new Date() },
      })

      for (const stream of streamsToUpdate) {
        const { id: streamId, backupUrls: _backupUrls, ...streamData } = stream
        const normalizedStreamData = {
          ...streamData,
          matchId: id,
          backupUrl: streamData.backupUrl ?? null,
        }

        if (streamId) {
          await tx.stream.updateMany({
            where: { id: streamId, matchId: id, deletedAt: null },
            data: normalizedStreamData,
          })
        } else {
          await tx.stream.create({ data: normalizedStreamData })
        }
      }

      return tx.match.findUnique({
        where: { id: updated.id },
        include: { streams: { where: { deletedAt: null } }, homeTeam: true, awayTeam: true },
      })
    })
    
    if (!updatedMatch) {
      return res.status(404).json(errorResponse('Match not found after update.'))
    }

    await writeAuditLog('Match updated', {
      matchId: updatedMatch.id,
      title: updatedMatch.title,
      previousStatus: existingMatch.status,
      nextStatus: updatedMatch.status,
      streamCount: updatedMatch.streams?.length ?? 0,
    })

    if (existingMatch.status !== 'LIVE' && updatedMatch.status === 'LIVE') {
      try {
        await notifyMatchStarted({ id: updatedMatch.id, title: updatedMatch.title })
      } catch (error) {
        console.error('Failed to broadcast match-start notifications:', error)
      }
    }
    
    // Invalidate both match and stream caches
    await invalidateTags(['matches', 'streams'])
    
    // Emit real-time event to admin clients
    emitAdminResourceUpdated('Match', id, {
      id: updatedMatch.id,
      title: updatedMatch.title,
      status: updatedMatch.status,
      kickoffAt: updatedMatch.kickoffAt,
      streamsCount: updatedMatch.streams?.length || 0
    })
    emitMatchStatusUpdated({ id: updatedMatch.id, status: updatedMatch.status, finishedAt: updatedMatch.finishedAt })
    
    // Clean up old Cloudinary assets after successful update
    res.status(200).json(successResponse(updatedMatch, 'Match updated successfully'))
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2025') {
        return res.status(404).json(errorResponse('Match or related resource not found.'))
      }
      if (error.code === 'P2002') {
        return res.status(409).json(errorResponse('A match with that identifier already exists.'))
      }
    }
    throw error
  }
})

export const getUpcomingMatches = asyncHandler(async (req: Request, res: Response) => {
  const paginatedQuery = {
    page: Number(req.query.page) || 1,
    limit: Number(req.query.limit) || 10,
    sortBy: (req.query.sortBy as string) || 'kickoffAt:asc',
    search: req.query.search as string, // Pass search to paginatedQuery
  }

  const { items, meta } = await getPaginatedData({
    model: 'match',
    query: { ...paginatedQuery, where: { status: 'UPCOMING', deletedAt: null } },
    searchableFields: ['title'],
  });
  res.status(200).json(successResponse({ items, meta }, 'Upcoming matches retrieved'));
})

export const getFinishedMatches = asyncHandler(async (req: Request, res: Response) => {
  const paginatedQuery = {
    page: Number(req.query.page) || 1,
    limit: Number(req.query.limit) || 10,
    sortBy: (req.query.sortBy as string) || 'kickoffAt:desc',
    search: req.query.search as string,
  }

  const retentionCutoff = new Date(Date.now() - 15 * 60 * 1000)
  const { items, meta } = await getPaginatedData({
    model: 'match',
    query: { ...paginatedQuery, where: { status: 'FINISHED', deletedAt: null, finishedAt: { gt: retentionCutoff } } as any },
    searchableFields: ['title'],
  });
  res.status(200).json(successResponse({ items, meta }, 'Finished matches retrieved'));
})

export const updateMatchStatus = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params
  const { status } = req.body

  if (!status) {
    return res.status(400).json({ success: false, message: 'Status is required.' })
  }

  const allowedStatuses = ['UPCOMING', 'LIVE', 'FINISHED'] as const
  if (!allowedStatuses.includes(status)) {
    return res.status(400).json({ success: false, message: 'Invalid match status.' })
  }

  const existingMatch = await prisma.match.findUnique({
    where: { id },
    select: { status: true, title: true, deletedAt: true },
  })
  if (!existingMatch) {
    return res.status(404).json({ success: false, message: 'Match not found.' })
  }

  const updateData: {
    status: 'UPCOMING' | 'LIVE' | 'FINISHED'
    deletedAt?: Date | null
    finishedAt?: Date | null
  } = { status }
  if (status === 'FINISHED') {
    updateData.deletedAt = null
    if (existingMatch.status !== 'FINISHED') updateData.finishedAt = new Date()
  } else {
    updateData.deletedAt = null
    updateData.finishedAt = null
  }

  const updatedMatch = await prisma.$transaction(async (tx) => {
    if (status === 'FINISHED') {
      await tx.stream.updateMany({
        where: { matchId: id, deletedAt: null },
        data: { enabled: false, status: 'OFFLINE', deletedAt: new Date() },
      })
    }

    return tx.match.update({
      where: { id },
      data: updateData,
    })
  })
  if (existingMatch.status !== 'LIVE' && updatedMatch.status === 'LIVE') {
    try {
      await notifyMatchStarted({ id: updatedMatch.id, title: updatedMatch.title })
    } catch (error) {
      console.error('Failed to broadcast match-start notifications:', error)
    }
  }

  await writeAuditLog('Match status updated', {
    matchId: updatedMatch.id,
    previousStatus: existingMatch.status,
    nextStatus: updatedMatch.status,
  })
  await invalidateTags(['matches', 'streams'])

  res.status(200).json(successResponse(updatedMatch, 'Match status updated'))
})

export const deleteMatch = asyncHandler(async (req: Request, res: Response) => {
  try {
    const { id } = req.params
    const result = await cleanupMatch(id, 'ADMIN_DELETE')
    if (!result.deleted) return res.status(404).json(errorResponse('Match not found.'))

    await writeAuditLog('Match deleted', {
      matchId: id,
      streamCount: result.streamCount,
      assetCount: result.assetCount,
      reason: 'ADMIN_DELETE',
    })
    res.status(200).json(successResponse({ id }, 'Match and related records deleted successfully'))
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2025') {
        return res.status(404).json(errorResponse('Match not found.'))
      }
    }
    throw error
  }
})

export const extendMatch = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params
  const minutes = Number(req.body?.minutes)
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 720) {
    return res.status(400).json(errorResponse('Extension must be between 1 and 720 minutes.'))
  }

  const match = await prisma.match.findFirst({ where: { id, status: 'LIVE', deletedAt: null }, select: { expectedEndTime: true } })
  if (!match) return res.status(404).json(errorResponse('Live match not found.'))

  const currentExpectedEnd = match.expectedEndTime ?? new Date()
  const updatedMatch = await prisma.match.update({
    where: { id },
    data: { expectedEndTime: new Date(currentExpectedEnd.getTime() + minutes * 60 * 1000) },
  })
  await invalidateTags(['matches', 'AdminStats'])
  emitAdminResourceUpdated('Match', id, { status: updatedMatch.status, expectedEndTime: updatedMatch.expectedEndTime, extensionMinutes: minutes })
  return res.json(successResponse(updatedMatch, 'Match expected end extended'))
})