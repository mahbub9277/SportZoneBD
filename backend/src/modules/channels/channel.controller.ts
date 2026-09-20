import type { Request, Response } from 'express'
import * as service from './channel.service.js'
import asyncHandler from '../../utils/asyncHandler.js'
import type { AuthenticatedRequest } from '../../core/middleware/index.js'
import { NotFoundError, BadRequestError, UnauthorizedError } from '../../core/errors.js'
import { uploadFile } from '../../services/cloudinary.service.js'
import { normalizeChannelStatus } from './channel.service.js'
import { hasPremiumAccess } from '../../core/premiumGuard.js'
import { invalidateTags } from '../../core/cache.js'
import { emitAdminResourceCreated, emitAdminResourceUpdated, emitAdminResourceDeleted } from '../../core/socketManager.js'
import { cleanupReplacedAsset, cleanupAssetIfUnused } from '../../services/asset-cleanup.service.js'
import { upsertMedia } from '../admin/media.service.js'

// Public Controllers
import { successResponse } from '../../core/api-response.js'

export const getPublicChannels = asyncHandler(async (_req: Request, res: Response) => {
  const channels = await service.getPublicChannelsGroupedByCategory()
  res.json(successResponse(channels))
})

export const getPublicChannelCategories = asyncHandler(async (_req: Request, res: Response) => {
  const categories = await service.getAllCategories()
  res.json(successResponse(categories))
})

export const getChannelById = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  // The `authenticate` middleware provides roles directly on `req.user`.
  const isAdmin = req.user?.roles?.includes('admin') || req.user?.roles?.includes('super_admin')
  const channel = await service.getChannelById(req.params.id, isAdmin)
  if (!channel) {
    throw new NotFoundError('Channel not found or is not active')
  }
  res.json(successResponse(channel))
})

export const getWatchChannelData = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params
  const watchData = await service.getWatchData(id)
  if (!watchData.channel) {
    throw new NotFoundError('Channel not found or is not active')
  }

  const canAccessPremium = watchData.channel.isPremium ? await hasPremiumAccess(req, res) : true

  const safeChannel = canAccessPremium
    ? watchData.channel
    : {
        ...watchData.channel,
        url: null,
      }

  const safeRelatedChannels = watchData.relatedChannels.map((channel) =>
    channel.isPremium && !canAccessPremium ? { ...channel, url: null } : channel,
  )

  res.json(successResponse({
    channel: safeChannel,
    relatedChannels: safeRelatedChannels,
    liveViewers: watchData.liveViewers,
  }))
})

export const enterChannelViewer = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params
  const { viewerId } = req.body as { viewerId?: string }

  if (!viewerId || typeof viewerId !== 'string') {
    throw new BadRequestError('viewerId is required')
  }

  const liveViewers = await service.trackViewerEnter(id, viewerId)
  res.json(successResponse({ liveViewers }))
})

export const leaveChannelViewer = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params
  const { viewerId } = req.body as { viewerId?: string }

  if (!viewerId || typeof viewerId !== 'string') {
    throw new BadRequestError('viewerId is required')
  }

  const liveViewers = await service.trackViewerLeave(id, viewerId)
  res.json(successResponse({ liveViewers }))
})

export const getRelatedChannels = asyncHandler(async (req: Request, res: Response) => {
  const channel = await service.getChannelById(req.params.id)
  if (!channel) {
    throw new NotFoundError('Channel not found or is not active')
  }

  const excludeIds = typeof req.query.excludeIds === 'string'
    ? req.query.excludeIds.split(',').map((id) => id.trim()).filter(Boolean)
    : []
  const relatedChannels = await service.getRelatedChannels(req.params.id, channel.categoryId, excludeIds)

  res.json(successResponse(relatedChannels))
})

export const getChannelsByIds = asyncHandler(async (req: Request, res: Response) => {
  const { ids } = req.query
  if (!ids || typeof ids !== 'string') {
    throw new BadRequestError('Channel IDs are required as a comma-separated string.')
  }
  const channelIds = ids.split(',')
  const channels = await service.getChannelsByIds(channelIds)
  res.json(successResponse(channels))
})

// Admin Category Controllers
export const getAdminCategories = asyncHandler(async (_req: Request, res: Response) => {
  const categories = await service.getAllCategories()
  res.json(successResponse(categories))
})

export const createCategory = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { body, file } = req
  let imageUrl: string | undefined

  if (file) {
    const result = await uploadFile(file, 'sportzone/channel-categories')
    imageUrl = result.secure_url
  }

  const categoryData = {
    name: String(body.name ?? '').trim(),
    description: body.description ? String(body.description).trim() : null,
    image: imageUrl ?? (body.image ? String(body.image) : null),
  }

  const category = await service.createCategory(categoryData)
  res.status(201).json(successResponse(category))
})

export const updateCategory = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params
  const { body, file } = req
  const updateData: Record<string, unknown> = { ...body }
  const existingCategory = file
    ? await service.getAllCategories().then((categories) => categories.find((item) => item.id === id))
    : undefined

  if (file) {
    const result = await uploadFile(file, 'sportzone/channel-categories')
    updateData.image = result.secure_url
    await upsertMedia({ type: 'LOGO', url: result.secure_url, publicId: result.public_id, fileName: file.originalname, mimeType: file.mimetype, size: file.size })
  }

  if (body.description !== undefined) {
    updateData.description = body.description ? String(body.description).trim() : null
  }

  if (body.name !== undefined) {
    updateData.name = String(body.name).trim()
  }

  const category = await service.updateCategory(id, updateData)
  if (file && existingCategory?.image) {
    await cleanupReplacedAsset(existingCategory.image, category.image)
  }
  res.json(successResponse(category))
})

export const deleteCategory = asyncHandler(async (req: Request, res: Response) => {
  const category = await service.getAllCategories().then((categories) => categories.find((item) => item.id === req.params.id))
  await service.deleteCategory(req.params.id)
  if (category?.image) await cleanupAssetIfUnused(category.image)
  res.status(204).send()
})

// Admin Channel Controllers
export const getAdminChannels = asyncHandler(async (_req: Request, res: Response) => {
  const channels = await service.getAdminChannels()
  res.json(successResponse(channels))
})

export const createChannel = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { body, file } = req
  let logoUrl: string | undefined

  if (file) {
    const result = await uploadFile(file, 'sportzone/channels')
    logoUrl = result.secure_url
    await upsertMedia({ type: 'LOGO', url: result.secure_url, publicId: result.public_id, fileName: file.originalname, mimeType: file.mimetype, size: file.size })
  }

  const isPremium = body.isPremium === 'true'
  const status = normalizeChannelStatus(body.status)

  const viewers = Number(body.viewers ?? 1280)

  const channelData = {
    name: String(body.name ?? '').trim(),
    url: String(body.url ?? '').trim(),
    categoryId: String(body.categoryId ?? '').trim(),
    viewers: Number.isFinite(viewers) ? Math.max(0, viewers) : 1280,
    isPremium,
    status,
    logo: logoUrl ?? (body.logo ? String(body.logo).trim() : null),
  }

  const channel = await service.createChannel(channelData)
  await invalidateTags(['channels'])
  
  // Emit real-time event to admin clients
  emitAdminResourceCreated('Channel', channel.id, {
    id: channel.id,
    name: channel.name,
    status: channel.status
  })
  
  res.status(201).json(successResponse(channel, 'Channel created successfully'))
})

export const updateChannel = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params
  const { body, file } = req
  const updateData: Record<string, unknown> = {}
  const existingChannel = file ? await service.getChannelById(id, true) : undefined

  if (body.name !== undefined) updateData.name = String(body.name).trim()
  if (body.url !== undefined) updateData.url = String(body.url).trim()
  if (body.categoryId !== undefined) updateData.categoryId = String(body.categoryId).trim()

  if (body.isPremium !== undefined) {
    updateData.isPremium = body.isPremium === 'true'
  }

  if (body.status !== undefined) {
    updateData.status = normalizeChannelStatus(body.status)
  }

  if (body.viewers !== undefined) {
    const viewers = Number(body.viewers)
    updateData.viewers = Number.isFinite(viewers) ? Math.max(0, viewers) : 1280
  }

  if (file) {
    const result = await uploadFile(file, 'sportzone/channels')
    updateData.logo = result.secure_url
    await upsertMedia({ type: 'LOGO', url: result.secure_url, publicId: result.public_id, fileName: file.originalname, mimeType: file.mimetype, size: file.size })
  } else if (body.logo !== undefined) {
    updateData.logo = body.logo ? String(body.logo).trim() : null
  }

  const channel = await service.updateChannel(id, updateData)
  if (file && existingChannel?.logo) {
    await cleanupReplacedAsset(existingChannel.logo, channel.logo)
  }
  
  await invalidateTags(['channels'])
  
  // Emit real-time event to admin clients
  emitAdminResourceUpdated('Channel', id, {
    id: channel.id,
    name: channel.name,
    status: channel.status
  })
  
  res.json(successResponse(channel, 'Channel updated successfully'))
})

export const deleteChannel = asyncHandler(async (req: Request, res: Response) => {
  const channel = await service.getChannelById(req.params.id, true)
  await service.deleteChannel(req.params.id)
  if (channel?.logo) await cleanupAssetIfUnused(channel.logo)
  
  await invalidateTags(['channels'])
  
  // Emit real-time event to admin clients
  emitAdminResourceDeleted('Channel', req.params.id)
  
  res.status(200).json(successResponse({ id: req.params.id }, 'Channel deleted successfully'))
})

export const getChannelReactions = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const channel = await service.getChannelById(req.params.id)
  if (!channel) throw new NotFoundError('Channel not found or is not active')
  res.json(successResponse(await service.getChannelReactionSummary(channel.id, req.user?.id ?? null)))
})

export const toggleChannelReaction = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  if (!req.user?.id) throw new UnauthorizedError('Authentication is required to react to a channel.')
  const type = req.body?.type
  if (type !== 'LIKE' && type !== 'DISLIKE') throw new BadRequestError('Reaction type must be LIKE or DISLIKE.')
  const channel = await service.getChannelById(req.params.id)
  if (!channel) throw new NotFoundError('Channel not found or is not active')
  res.json(successResponse(await service.toggleChannelReaction(channel.id, req.user.id, type)))
})