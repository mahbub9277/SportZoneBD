import { type Request, type Response } from 'express'
import crypto from 'node:crypto'
import { z } from 'zod'
import asyncHandler from '../../utils/asyncHandler.js'
import cloudinary from '../../lib/cloudinary.js'
import { cleanupAssetIfUnused, isAssetReferenced } from '../../services/asset-cleanup.service.js'
import { errorResponse, successResponse } from '../../core/api-response.js'
import { AppError } from '../../core/errors.js'
import { upsertMedia } from './media.service.js'

const uploadPurposeSchema = z.enum([
  'highlight-image',
  'highlight-video',
  'banner-image',
  'banner-video',
  'banner-poster',
  'advertisement-image',
  'event-logo',
  'event-banner',
  'popup-image',
  'team-logo',
  'stream-logo',
  'channel-logo',
  'channel-category-logo',
])

type UploadPurpose = z.infer<typeof uploadPurposeSchema>
type UploadPolicy = {
  folder: string
  resourceType: 'image' | 'video'
  maxBytes: number
  mimeTypes: readonly string[]
  mediaType?: 'LOGO' | 'BANNER'
}

const imageMimeTypes = ['image/jpeg', 'image/png', 'image/webp'] as const
const videoMimeTypes = ['video/mp4', 'video/webm', 'video/quicktime'] as const
const formatsByMimeType: Record<string, readonly string[]> = {
  'image/jpeg': ['jpg', 'jpeg'],
  'image/png': ['png'],
  'image/webp': ['webp'],
  'video/mp4': ['mp4'],
  'video/webm': ['webm'],
  'video/quicktime': ['mov'],
}
const imageMaxBytes = 10 * 1024 * 1024
const smallImageMaxBytes = 5 * 1024 * 1024
const uploadPolicies: Record<UploadPurpose, UploadPolicy> = {
  'highlight-image': { folder: 'sportzone/highlights', resourceType: 'image', maxBytes: smallImageMaxBytes, mimeTypes: imageMimeTypes },
  'highlight-video': { folder: 'sportzone/highlights', resourceType: 'video', maxBytes: 300 * 1024 * 1024, mimeTypes: videoMimeTypes },
  'banner-image': { folder: 'sportzone/banners', resourceType: 'image', maxBytes: imageMaxBytes, mimeTypes: imageMimeTypes },
  'banner-video': { folder: 'sportzone/banners', resourceType: 'video', maxBytes: 100 * 1024 * 1024, mimeTypes: videoMimeTypes },
  'banner-poster': { folder: 'sportzone/banners', resourceType: 'image', maxBytes: imageMaxBytes, mimeTypes: imageMimeTypes },
  'advertisement-image': { folder: 'sportzone/advertisements', resourceType: 'image', maxBytes: imageMaxBytes, mimeTypes: imageMimeTypes },
  'event-logo': { folder: 'sportzone/events', resourceType: 'image', maxBytes: smallImageMaxBytes, mimeTypes: imageMimeTypes, mediaType: 'LOGO' },
  'event-banner': { folder: 'sportzone/events', resourceType: 'image', maxBytes: smallImageMaxBytes, mimeTypes: imageMimeTypes, mediaType: 'BANNER' },
  'popup-image': { folder: 'sportzone/popups', resourceType: 'image', maxBytes: smallImageMaxBytes, mimeTypes: imageMimeTypes },
  'team-logo': { folder: 'sportzone/team-logos', resourceType: 'image', maxBytes: smallImageMaxBytes, mimeTypes: imageMimeTypes },
  'stream-logo': { folder: 'sportzone/stream-logos', resourceType: 'image', maxBytes: smallImageMaxBytes, mimeTypes: imageMimeTypes },
  'channel-logo': { folder: 'sportzone/channels', resourceType: 'image', maxBytes: smallImageMaxBytes, mimeTypes: imageMimeTypes, mediaType: 'LOGO' },
  'channel-category-logo': { folder: 'sportzone/channel-categories', resourceType: 'image', maxBytes: smallImageMaxBytes, mimeTypes: imageMimeTypes, mediaType: 'LOGO' },
}

const signUploadSchema = z.object({
  purpose: uploadPurposeSchema,
  fileName: z.string().trim().min(1).max(255),
  fileSize: z.number().int().positive(),
  mimeType: z.string().trim().toLowerCase().max(100),
})

const completeUploadSchema = z.object({
  purpose: uploadPurposeSchema,
  fileName: z.string().trim().min(1).max(255),
  mimeType: z.string().trim().toLowerCase().max(100),
  publicId: z.string().trim().min(1).max(255),
  version: z.number().int().positive(),
  signature: z.string().regex(/^[a-f\d]{40}$/i),
})

function getCloudinaryCredentials() {
  const config = cloudinary.config()
  if (!config.cloud_name || !config.api_key || !config.api_secret) {
    throw new AppError(503, 'Cloudinary uploads are not configured.')
  }
  return { cloudName: config.cloud_name, apiKey: config.api_key, apiSecret: config.api_secret }
}

function isMatchingSignature(received: string, expected: string): boolean {
  const receivedBuffer = Buffer.from(received, 'utf8')
  const expectedBuffer = Buffer.from(expected, 'utf8')
  return receivedBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(receivedBuffer, expectedBuffer)
}

export const createCloudinaryUploadSignature = asyncHandler(async (req: Request, res: Response) => {
  const input = signUploadSchema.safeParse(req.body)
  if (!input.success) return res.status(400).json(errorResponse('Invalid Cloudinary upload request.'))

  const { purpose, fileName, fileSize, mimeType } = input.data
  const policy = uploadPolicies[purpose]
  if (fileSize > policy.maxBytes || !policy.mimeTypes.includes(mimeType)) {
    return res.status(400).json(errorResponse('File type or size is not allowed for this upload purpose.'))
  }

  const { cloudName, apiKey, apiSecret } = getCloudinaryCredentials()
  const timestamp = Math.floor(Date.now() / 1000)
  const publicId = `${policy.folder}/${crypto.randomUUID()}`
  const signedParams = { asset_folder: policy.folder, public_id: publicId, timestamp }

  res.json(successResponse({
    ...signedParams,
    signature: cloudinary.utils.api_sign_request(signedParams, apiSecret),
    apiKey,
    cloudName,
    resourceType: policy.resourceType,
    maxBytes: policy.maxBytes,
  }))
})

export const completeCloudinaryUpload = asyncHandler(async (req: Request, res: Response) => {
  const input = completeUploadSchema.safeParse(req.body)
  if (!input.success) return res.status(400).json(errorResponse('Invalid Cloudinary upload result.'))

  const { purpose, fileName, mimeType, publicId, version, signature } = input.data
  const policy = uploadPolicies[purpose]
  if (!publicId.startsWith(`${policy.folder}/`) || !policy.mimeTypes.includes(mimeType)) {
    return res.status(403).json(errorResponse('Uploaded asset does not match the authorized purpose.'))
  }

  const { apiSecret, cloudName } = getCloudinaryCredentials()
  const expectedSignature = cloudinary.utils.api_sign_request({ public_id: publicId, version }, apiSecret)
  if (!isMatchingSignature(signature, expectedSignature)) {
    return res.status(403).json(errorResponse('Cloudinary upload signature is invalid.'))
  }

  const resource = await cloudinary.api.resource(publicId, { resource_type: policy.resourceType }) as {
    asset_folder?: string
    bytes?: number
    duration?: number
    format?: string
    height?: number
    public_id?: string
    resource_type?: string
    secure_url?: string
    version?: number
    width?: number
  }

  if (
    resource.public_id !== publicId
    || resource.resource_type !== policy.resourceType
    || resource.version !== version
    || (resource.asset_folder && resource.asset_folder !== policy.folder)
    || !Number.isInteger(resource.bytes)
    || Number(resource.bytes) <= 0
    || Number(resource.bytes) > policy.maxBytes
    || !resource.format
    || !formatsByMimeType[mimeType]?.includes(resource.format.toLowerCase())
    || !resource.secure_url
  ) {
    return res.status(403).json(errorResponse('Cloudinary asset metadata does not match the authorized upload.'))
  }

  const secureUrl = new URL(resource.secure_url)
  if (
    secureUrl.protocol !== 'https:'
    || secureUrl.hostname !== 'res.cloudinary.com'
    || secureUrl.pathname.split('/')[1] !== cloudName
  ) {
    return res.status(403).json(errorResponse('Cloudinary returned an unexpected delivery URL.'))
  }

  if (policy.mediaType) {
    await upsertMedia({
      type: policy.mediaType,
      url: resource.secure_url,
      publicId,
      fileName,
      mimeType,
      size: Number(resource.bytes),
      width: resource.width,
      height: resource.height,
    })
  }

  res.status(201).json(successResponse({
    fileName,
    url: resource.secure_url,
    publicId,
    mimeType,
    size: Number(resource.bytes),
    resourceType: policy.resourceType,
    format: resource.format,
    duration: resource.duration,
    width: resource.width,
    height: resource.height,
  }))
})

const deleteUploadedFile = asyncHandler(async (req: Request, res: Response) => {
  const publicId = typeof req.body?.publicId === 'string' ? req.body.publicId.trim() : ''
  if (!publicId || publicId.length > 255 || publicId.includes('..')) {
    throw new AppError(400, 'A valid Cloudinary public ID is required.')
  }

  if (await isAssetReferenced(publicId)) {
    throw new AppError(409, 'This asset is still referenced by an active resource.')
  }
  await cleanupAssetIfUnused(publicId)
  res.status(204).send()
})

export const uploadsController = { createCloudinaryUploadSignature, completeCloudinaryUpload, deleteUploadedFile }
