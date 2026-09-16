import { z } from 'zod'
import type { Request, Response } from 'express'
import asyncHandler from '../../utils/asyncHandler.js'
import { successResponse } from '../../core/api-response.js'
import { invalidateTags } from '../../core/cache.js'
import * as repository from './banner.repository.js'

const bannerSchema = z.object({
  title: z.string().trim().min(1).max(160), subtitle: z.string().trim().max(500).nullable().optional(),
  type: z.enum(['IMAGE', 'VIDEO']), imageUrl: z.string().url().nullable().optional(), videoUrl: z.string().url().nullable().optional(), posterUrl: z.string().url().nullable().optional(),
  badge: z.string().trim().max(60).nullable().optional(), ctaText: z.string().trim().max(80).nullable().optional(), ctaUrl: z.string().trim().max(2048).nullable().optional(),
  isActive: z.boolean().default(true), displayOrder: z.number().int().min(0).max(10000).default(0),
})

const invalidate = () => invalidateTags(['banners'])
export const getActiveBanners = asyncHandler(async (_req: Request, res: Response) => res.json(successResponse(await repository.findActiveBanners())))
export const getAdminBanners = asyncHandler(async (_req: Request, res: Response) => res.json(successResponse(await repository.findAllBanners())))
export const createBanner = asyncHandler(async (req: Request, res: Response) => { const data = bannerSchema.parse(req.body); const banner = await repository.createBanner(data); await invalidate(); res.status(201).json(successResponse(banner)) })
export const updateBanner = asyncHandler(async (req: Request, res: Response) => { const data = bannerSchema.partial().parse(req.body); const banner = await repository.updateBanner(req.params.id, data); await invalidate(); res.json(successResponse(banner)) })
export const deleteBanner = asyncHandler(async (req: Request, res: Response) => { const banner = await repository.softDeleteBanner(req.params.id); await invalidate(); res.json(successResponse(banner)) })
export const reorderBanners = asyncHandler(async (req: Request, res: Response) => { const items = z.array(z.object({ id: z.string().uuid(), displayOrder: z.number().int().min(0) })).parse(req.body); const banners = await repository.reorderBanners(items); await invalidate(); res.json(successResponse(banners)) })