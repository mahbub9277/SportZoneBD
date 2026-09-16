import type { Request, Response } from 'express'
import { z, ZodError } from 'zod'
import { Prisma } from '@prisma/client'
import asyncHandler from '../../utils/asyncHandler.js'
import { prisma } from '../../core/prisma.js'
import { successResponse, errorResponse } from '../../core/api-response.js'
import { invalidateTags } from '../../core/cache.js'
import { emitAdminResourceCreated, emitAdminResourceUpdated, emitAdminResourceDeleted } from '../../core/socketManager.js'
import { cleanupAssetIfUnused, cleanupReplacedAsset } from '../../services/asset-cleanup.service.js'

const optionalUrlSchema = z.preprocess((value) => {
  if (typeof value === 'string' && value.trim() === '') {
    return null
  }
  return value
}, z.string().url().nullable().optional())

const popupSchema = z.object({
  title: z.string().trim().min(3, 'Title must be at least 3 characters.'),
  message: z.string().trim().min(10, 'Message must be at least 10 characters.'),
  isActive: z.boolean().default(true),
  imageUrl: optionalUrlSchema,
  link: optionalUrlSchema,
})

const getPopups = asyncHandler(async (_req: Request, res: Response) => {
  const popups = await prisma.popup.findMany({
    where: { deletedAt: null },
    orderBy: { createdAt: 'desc' },
  })
  res.status(200).json(successResponse(popups))
})

const createPopup = asyncHandler(async (req: Request, res: Response) => {
  try {
    const validatedData = popupSchema.parse(req.body)
    const popup = await prisma.popup.create({
      data: validatedData,
      select: { id: true, title: true, message: true, isActive: true, imageUrl: true, link: true, createdAt: true }
    })
    await invalidateTags(['popups'])
    
    // Emit real-time event to admin clients
    emitAdminResourceCreated('Popup', popup.id, {
      id: popup.id,
      title: popup.title,
      isActive: popup.isActive
    })
    
    res.status(201).json(successResponse(popup, 'Popup created successfully.'))
  } catch (error) {
    if (error instanceof ZodError) {
      res.status(400).json(errorResponse(error.errors.map((e) => e.message).join(', ')))
      return
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002') {
        res.status(409).json(errorResponse('A popup with that title already exists.'))
        return
      }
    }
    throw error
  }
})

const updatePopup = asyncHandler(async (req: Request, res: Response) => {
  try {
    const { id } = req.params
    const validatedData = popupSchema.partial().parse(req.body)
    
    const existingPopup = await prisma.popup.findUnique({
      where: { id },
      select: { id: true, imageUrl: true }
    })
    
    if (!existingPopup) {
      return res.status(404).json(errorResponse('Popup not found.'))
    }
    
    const popup = await prisma.popup.update({
      where: { id },
      data: validatedData,
      select: { id: true, title: true, message: true, isActive: true, imageUrl: true, link: true, updatedAt: true }
    })
    await invalidateTags(['popups', `popup:${id}`])

    if (validatedData.imageUrl !== undefined && existingPopup.imageUrl) {
      await cleanupReplacedAsset(existingPopup.imageUrl, popup.imageUrl)
    }
    
    // Emit real-time event to admin clients
    emitAdminResourceUpdated('Popup', id, {
      id: popup.id,
      title: popup.title,
      isActive: popup.isActive
    })
    
    res.status(200).json(successResponse(popup, 'Popup updated successfully.'))
  } catch (error) {
    if (error instanceof ZodError) {
      res.status(400).json(errorResponse(error.errors.map((e) => e.message).join(', ')))
      return
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2025') {
        return res.status(404).json(errorResponse('Popup not found.'))
      }
      if (error.code === 'P2002') {
        return res.status(409).json(errorResponse('A popup with that title already exists.'))
      }
    }
    throw error
  }
})

const deletePopup = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params
  
  const popup = await prisma.popup.findUnique({ 
    where: { id, deletedAt: null }, 
    select: { imageUrl: true, id: true } 
  })
  
  if (!popup) {
    return res.status(404).json({ success: false, message: 'Popup not found.' })
  }

  // Soft delete in database
  const deleted = await prisma.popup.update({
    where: { id },
    data: { deletedAt: new Date() },
  })

  // Clean up Cloudinary asset after successful database update
  if (popup.imageUrl) {
    try {
      await cleanupAssetIfUnused(popup.imageUrl)
    } catch (error) {
      // Log but don't fail - popup is already marked as deleted
      console.error('Failed to delete Cloudinary asset for popup:', id, error)
    }
  }

  await invalidateTags(['popups'])
  
  // Emit real-time event to admin clients
  emitAdminResourceDeleted('Popup', id)
  
  res.status(200).json(successResponse(deleted, 'Popup deleted successfully.'))
})

/**
 * @desc    Get active popups for public view
 * @route   GET /api/v1/popups/active
 * @access  Public
 */
const getActivePopups = asyncHandler(async (_req: Request, res: Response) => {
  const popups = await prisma.popup.findMany({
    where: { isActive: true, deletedAt: null },
    orderBy: { createdAt: 'desc' },
  })
  res.status(200).json(successResponse(popups))
})

export const popupsController = {
  getPopups,
  createPopup,
  updatePopup,
  deletePopup,
  getActivePopups,
}