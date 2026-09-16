import { type Request, type Response } from 'express'
import { prisma } from '../../core/prisma.js'
import { successResponse } from '../../core/api-response.js'
import { getPaginatedData } from '../../services/pagination.service.js'
import { NotFoundError } from '../../core/errors.js'
import asyncHandler from '../../utils/asyncHandler.js'
import { notifyHighlightAdded } from '../../services/notification.service.js'
import { cleanupAssetIfUnused, cleanupReplacedAsset } from '../../services/asset-cleanup.service.js'

type HighlightPayload = {
  thumbnail?: string | null
  thumbnailUrl?: string | null
  [key: string]: unknown
}

const normalizeHighlightPayload = <T extends HighlightPayload>(payload: T): T => {
  const normalized = { ...payload } as HighlightPayload
  const candidateUrl =
    typeof normalized.thumbnail === 'string' && normalized.thumbnail
      ? normalized.thumbnail
      : typeof normalized.thumbnailUrl === 'string' && normalized.thumbnailUrl
        ? normalized.thumbnailUrl
        : null

  if (candidateUrl) {
    normalized.thumbnail = candidateUrl
    normalized.thumbnailUrl = candidateUrl
  } else {
    normalized.thumbnail = normalized.thumbnail ?? null
    normalized.thumbnailUrl = normalized.thumbnailUrl ?? null
  }

  return normalized as T
}

export const getHighlights = asyncHandler(async (req: Request, res: Response) => {
  const paginatedQuery = {
    page: Number(req.query.page) || 1,
    limit: Number(req.query.limit) || 10,
    sortBy: (req.query.sortBy as string) || 'createdAt:desc',
    search: req.query.search as string,
    where: { deletedAt: null },
  }

  const { items, meta } = await getPaginatedData({
    model: 'highlight',
    query: paginatedQuery,
    searchableFields: ['title'],
  })
  res.status(200).json(successResponse({ items, meta }, 'Highlights retrieved'))
})

export const createHighlight = asyncHandler(async (req: Request, res: Response) => {
  const payload = normalizeHighlightPayload({
    ...req.body,
    matchId: req.body?.matchId || null,
  })
  const newHighlight = await prisma.highlight.create({
    // Data is already validated by middleware
    data: payload,
  })
  const match = newHighlight.matchId
    ? await prisma.match.findUnique({
        where: { id: newHighlight.matchId },
        select: { title: true },
      })
    : null
  try {
    const createdCount = await notifyHighlightAdded({
      id: newHighlight.id,
      title: newHighlight.title,
      matchTitle: match?.title,
    })
    req.log?.info?.({ highlightId: newHighlight.id, createdCount }, 'Highlight notifications broadcast')
  } catch (error) {
    req.log?.error?.({ error, highlightId: newHighlight.id }, 'Highlight notification broadcast failed')
  }
  res.status(201).json(successResponse(newHighlight, 'Highlight created'))
})

export const updateHighlight = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params
  // Data is already validated by middleware
  const existingHighlight = await prisma.highlight.findFirst({ where: { id, deletedAt: null } })
  if (!existingHighlight) throw new NotFoundError('Highlight not found')
  const payload = normalizeHighlightPayload({
    ...req.body,
    matchId: req.body?.matchId ?? existingHighlight.matchId,
  })

  await cleanupReplacedAsset(existingHighlight.thumbnail ?? existingHighlight.thumbnailUrl, payload.thumbnail ?? payload.thumbnailUrl)

  const updatedHighlight = await prisma.highlight.update({
    where: { id: existingHighlight.id },
    data: payload,
  })
  res.status(200).json(successResponse(updatedHighlight, 'Highlight updated'))
})

export const deleteHighlight = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params
  const existingHighlight = await prisma.highlight.findFirst({ where: { id, deletedAt: null } })
  if (!existingHighlight) throw new NotFoundError('Highlight not found')
  const deletedHighlight = await prisma.highlight.update({
    where: { id: existingHighlight.id },
    data: { deletedAt: new Date() },
  })

  await Promise.all([
    cleanupAssetIfUnused(existingHighlight.thumbnail ?? existingHighlight.thumbnailUrl),
    cleanupAssetIfUnused(existingHighlight.url),
  ])

  res.status(200).json(successResponse({ id: deletedHighlight.id }, 'Highlight deleted'))
})