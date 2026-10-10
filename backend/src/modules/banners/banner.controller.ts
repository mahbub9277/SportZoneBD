import { z } from 'zod'
import type { Request, Response } from 'express'
import asyncHandler from '../../utils/asyncHandler.js'
import { successResponse } from '../../core/api-response.js'
import { invalidateTags } from '../../core/cache.js'
import { cleanupAssetIfUnused, cleanupReplacedAsset } from '../../services/asset-cleanup.service.js'
import * as repository from './banner.repository.js'

const bannerSchema = z.object({
  title: z.string().trim().max(160).nullable().optional(), subtitle: z.string().trim().max(500).nullable().optional(),
  type: z.enum(['IMAGE', 'VIDEO']), imageUrl: z.string().url().nullable().optional(), videoUrl: z.string().url().nullable().optional(), posterUrl: z.string().url().nullable().optional(),
  badge: z.string().trim().max(60).nullable().optional(), ctaText: z.string().trim().max(80).nullable().optional(), ctaUrl: z.string().trim().max(2048).nullable().optional(),
  isActive: z.boolean().default(true), displayOrder: z.number().int().min(0).max(10000).default(0),
})
const getBannerTitle = (title?: string | null) => title?.trim() ?? ''

/**
 * Titles invented by earlier versions ('Image banner' / 'Video banner') when an admin left the
 * optional title blank. They are presentation defaults, not content, so the public banner feed
 * reports them as "no title" and the homepage renders no label. New banners store no title at all.
 */
const LEGACY_PLACEHOLDER_TITLES = new Set(['Image banner', 'Video banner'])

const getPublicBannerTitle = (title?: string | null) => {
  const trimmed = title?.trim() ?? ''
  return LEGACY_PLACEHOLDER_TITLES.has(trimmed) ? '' : trimmed
}

const bannerWithMediaSchema = bannerSchema.superRefine((banner, context) => {
  const mediaUrl = banner.type === 'IMAGE' ? banner.imageUrl : banner.videoUrl
  if (!mediaUrl) {
    context.addIssue({ code: 'custom', path: [banner.type === 'IMAGE' ? 'imageUrl' : 'videoUrl'], message: `An uploaded ${banner.type === 'IMAGE' ? 'image' : 'video'} is required.` })
  }
})

const invalidate = () => invalidateTags(['banners'])
export const getActiveBanners = asyncHandler(async (_req: Request, res: Response) => {
  const banners = await repository.findActiveBanners()
  res.json(successResponse(banners.map((banner) => ({ ...banner, title: getPublicBannerTitle(banner.title) }))))
})
export const getAdminBanners = asyncHandler(async (_req: Request, res: Response) => res.json(successResponse(await repository.findAllBanners())))
export const createBanner = asyncHandler(async (req: Request, res: Response) => { const parsed = bannerWithMediaSchema.parse(req.body); const data = { ...parsed, title: getBannerTitle(parsed.title) }; const banner = await repository.createBanner(data); await invalidate(); res.status(201).json(successResponse(banner)) })
export const updateBanner = asyncHandler(async (req: Request, res: Response) => {
  const data = bannerSchema.partial().parse(req.body)
  const existing = await repository.findBanner(req.params.id)
  if (data.title !== undefined) data.title = getBannerTitle(data.title)
  if (existing) bannerWithMediaSchema.parse({ ...existing, ...data })
  const banner = await repository.updateBanner(req.params.id, data)
  await invalidate()
  if (existing) {
    // A replaced or cleared asset is released only when no other record — banner, event or match —
    // still references it, which is what `cleanupReplacedAsset` checks before deleting anything.
    await Promise.all([
      cleanupReplacedAsset(existing.imageUrl, banner.imageUrl),
      cleanupReplacedAsset(existing.videoUrl, banner.videoUrl),
      cleanupReplacedAsset(existing.posterUrl, banner.posterUrl),
    ])
  }
  res.json(successResponse(banner))
})
export const deleteBanner = asyncHandler(async (req: Request, res: Response) => {
  const banner = await repository.softDeleteBanner(req.params.id)
  await invalidate()
  // The soft-deleted banner is not a reference any more, so its media can be released when unused.
  await Promise.all([
    cleanupAssetIfUnused(banner.imageUrl),
    cleanupAssetIfUnused(banner.videoUrl),
    cleanupAssetIfUnused(banner.posterUrl),
  ])
  res.json(successResponse(banner))
})
export const reorderBanners = asyncHandler(async (req: Request, res: Response) => { const items = z.array(z.object({ id: z.string().uuid(), displayOrder: z.number().int().min(0) })).parse(req.body); const banners = await repository.reorderBanners(items); await invalidate(); res.json(successResponse(banners)) })