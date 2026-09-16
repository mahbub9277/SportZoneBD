import type { Request, Response } from 'express'
import { z } from 'zod'
import asyncHandler from '../../utils/asyncHandler.js'
import { AppError } from '../../core/errors.js'
import { successResponse } from '../../core/api-response.js'
import { deleteFileFromCloudinary } from '../../services/upload.service.js'
import * as service from './media.service.js'

const mediaTypeSchema = z.enum(['BANNER', 'LOGO'])

const listMedia = asyncHandler(async (req: Request, res: Response) => {
  const type = typeof req.query.type === 'string' ? mediaTypeSchema.safeParse(req.query.type.toUpperCase()) : null
  if (type && !type.success) throw new AppError(400, 'Invalid media type.')
  const search = typeof req.query.search === 'string' ? req.query.search : undefined
  res.json(successResponse(await service.listMedia(type?.success ? type.data : undefined, search)))
})

const getMediaUsage = asyncHandler(async (req: Request, res: Response) => {
  const usage = await service.getMediaUsage(req.params.id)
  if (!usage) throw new AppError(404, 'Media asset not found.')
  res.json(successResponse({ count: usage.events.length, events: usage.events }))
})

const deleteMedia = asyncHandler(async (req: Request, res: Response) => {
  const usage = await service.getMediaUsage(req.params.id)
  if (!usage) throw new AppError(404, 'Media asset not found.')
  if (usage.events.length > 0) {
    throw new AppError(409, `Media is currently used by ${usage.events.length} event${usage.events.length === 1 ? '' : 's'}. Remove it from those events before deleting.`)
  }
  await service.softDeleteMedia(req.params.id)
  await deleteFileFromCloudinary(usage.media.publicId)
  res.status(204).send()
})

export const mediaController = { listMedia, getMediaUsage, deleteMedia }
