import type { Request, Response } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import asyncHandler from '../../utils/asyncHandler.js';
import { prisma } from '../../core/prisma.js';
import { successResponse, errorResponse } from '../../core/api-response.js';
import { invalidateTags } from '../../core/cache.js';
import { emitAdminResourceCreated, emitAdminResourceUpdated, emitAdminResourceDeleted } from '../../core/socketManager.js';
import { cleanupAssetIfUnused, cleanupReplacedAsset } from '../../services/asset-cleanup.service.js';
import { getInterstitialAdvertisement, getValidUnlock, grantUnlock } from '../advertisements/advertisements.service.js'

const optionalHttpsUrl = (label: string) => z.preprocess(
  (value) => value === '' ? null : value,
  z.string().trim().url().max(2048).refine((value) => /^https:\/\//i.test(value), `${label} must use HTTPS.`).nullable().optional(),
)

const adSchema = z.object({
  title: z.string().trim().min(3).max(120),
  description: z.string().trim().max(5000).optional().nullable(),
  link: z.string().trim().url().max(2048).refine((value) => /^https:\/\//i.test(value), 'Target URL must use HTTPS.'),
  imageUrl: optionalHttpsUrl('Image URL'),
  facebookUrl: optionalHttpsUrl('Facebook URL'),
  youtubeUrl: optionalHttpsUrl('YouTube URL'),
  telegramUrl: optionalHttpsUrl('Telegram URL'),
  instagramUrl: optionalHttpsUrl('Instagram URL'),
  websiteUrl: optionalHttpsUrl('Website URL'),
  isActive: z.boolean().default(true),
  placement: z.enum(['MATCH', 'CHANNEL', 'BOTH', 'FULL_PAGE']).default('BOTH'),
  interstitialEnabled: z.boolean().default(true),
  durationSeconds: z.number().int().min(3).max(120).default(10),
  unlockHours: z.union([z.literal(12), z.literal(24)]).default(24),
  priority: z.number().int().min(0).max(1000).default(0),
});

const getAdvertisements = asyncHandler(async (_req: Request, res: Response) => {
  const ads = await prisma.advertisement.findMany({
    where: { deletedAt: null },
    orderBy: { createdAt: 'desc' },
  });
  res.status(200).json(successResponse(ads));
});

const createAdvertisement = asyncHandler(async (req: Request, res: Response) => {
  try {
    const validatedData = adSchema.parse(req.body);
    const ad = await prisma.advertisement.create({ 
      data: validatedData as Prisma.AdvertisementCreateInput,
      select: { id: true, title: true, description: true, link: true, imageUrl: true, facebookUrl: true, youtubeUrl: true, telegramUrl: true, instagramUrl: true, websiteUrl: true, isActive: true, createdAt: true }
    });
    await invalidateTags(['advertisements']);
    
    // Emit real-time event to admin clients
    emitAdminResourceCreated('Advertisement', ad.id, {
      id: ad.id,
      title: ad.title,
      isActive: ad.isActive
    });
    
    res.status(201).json(successResponse(ad, 'Advertisement created successfully.'));
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002') {
        res.status(409).json(errorResponse('An advertisement with that title already exists.'));
        return;
      }
    }
    throw error;
  }
});

const updateAdvertisement = asyncHandler(async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const validatedData = adSchema.partial().parse(req.body);
    
    const existingAd = await prisma.advertisement.findFirst({ 
      where: { id, deletedAt: null },
      select: { id: true, imageUrl: true }
    });
    
    if (!existingAd) {
      return res.status(404).json(errorResponse('Advertisement not found.'));
    }
    
    const ad = await prisma.advertisement.update({ 
      where: { id: existingAd.id }, 
      data: validatedData as Prisma.AdvertisementUpdateInput,
      select: { id: true, title: true, description: true, link: true, imageUrl: true, facebookUrl: true, youtubeUrl: true, telegramUrl: true, instagramUrl: true, websiteUrl: true, isActive: true, updatedAt: true }
    });
    
    await invalidateTags(['advertisements', `advertisement:${id}`]);

    if (validatedData.imageUrl !== undefined && existingAd.imageUrl) {
      await cleanupReplacedAsset(existingAd.imageUrl, ad.imageUrl)
    }
    
    // Emit real-time event to admin clients
    emitAdminResourceUpdated('Advertisement', id, {
      id: ad.id,
      title: ad.title,
      isActive: ad.isActive
    });
    
    res.status(200).json(successResponse(ad, 'Advertisement updated successfully.'));
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2025') {
        return res.status(404).json(errorResponse('Advertisement not found.'));
      }
      if (error.code === 'P2002') {
        return res.status(409).json(errorResponse('An advertisement with that title already exists.'));
      }
    }
    throw error;
  }
});

const deleteAdvertisement = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  
  const advertisement = await prisma.advertisement.findFirst({ 
    where: { id, deletedAt: null }, 
    select: { imageUrl: true, id: true } 
  });
  
  if (!advertisement) {
    return res.status(404).json({ success: false, message: 'Advertisement not found.' });
  }

  // Soft delete in database
  const deleted = await prisma.advertisement.update({
    where: { id },
    data: { deletedAt: new Date() },
  });

  // Clean up Cloudinary asset after successful database update
  if (advertisement.imageUrl) {
    try {
      await cleanupAssetIfUnused(advertisement.imageUrl);
    } catch (error) {
      // Log but don't fail - ad is already marked as deleted
      console.error('Failed to delete Cloudinary asset for advertisement:', id, error);
    }
  }

  await invalidateTags(['advertisements']);
  
  // Emit real-time event to admin clients
  emitAdminResourceDeleted('Advertisement', id);
  
  res.status(200).json(successResponse(deleted, 'Advertisement deleted.'));
});

const getActiveAdvertisements = asyncHandler(async (_req: Request, res: Response) => {
  const ads = await prisma.advertisement.findMany({
    where: { isActive: true, deletedAt: null },
    orderBy: { createdAt: 'desc' },
  });
  res.status(200).json(successResponse(ads));
});

export const advertisementsController = {
  getAdvertisements,
  createAdvertisement,
  updateAdvertisement,
  deleteAdvertisement,
  getActiveAdvertisements,
};