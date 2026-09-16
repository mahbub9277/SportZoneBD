import { type Request, type Response } from 'express'
import asyncHandler from '../../utils/asyncHandler.js'
import { buildCloudinarySecureUrl, uploadStreamToCloudinary } from '../../services/upload.service.js'
import { cleanupAssetIfUnused, isAssetReferenced } from '../../services/asset-cleanup.service.js'
import { successResponse } from '../../core/api-response.js'
import { AppError } from '../../core/errors.js'
import { upsertMedia } from './media.service.js'

const uploadFiles = asyncHandler(async (req: Request, res: Response) => {
  const files = req.files as Express.Multer.File[] | undefined

  if (!files || files.length === 0) {
    throw new AppError(400, 'No files were uploaded.')
  }

  const requestedFolder = typeof req.body?.folder === 'string' ? req.body.folder.trim() : ''
  const requestedMediaType = typeof req.body?.mediaType === 'string' ? req.body.mediaType.trim().toUpperCase() : ''
  const mediaType = requestedMediaType === 'BANNER' || requestedMediaType === 'LOGO' || requestedMediaType === 'VIDEO' ? requestedMediaType : null
  const allowedFolders = new Set(['sportzone/file-uploads', 'sportzone/branding', 'sportzone/favicon', 'sportzone/popups', 'sportzone/avatars', 'sportzone/stream-logos', 'sportzone/events', 'sportzone/advertisements', 'sportzone/banners', 'sportzone/highlights'])
  const folder = allowedFolders.has(requestedFolder) ? requestedFolder : 'sportzone/file-uploads'

  const uploadResults = await Promise.allSettled(
    files.map(async (file) => {
      if (!file.buffer) {
        throw new AppError(400, `Unable to process file ${file.originalname}.`)
      }
      // Let Cloudinary generate a unique public_id for security.
      const uploadResult = await uploadStreamToCloudinary(file.buffer, folder, undefined, mediaType === 'VIDEO' ? { resource_type: 'video' } : undefined)
      const url = mediaType === 'VIDEO'
        ? buildCloudinarySecureUrl(uploadResult, 'video') ?? uploadResult
        : buildCloudinarySecureUrl(uploadResult) ?? uploadResult
      const upload = {
        fileName: file.originalname,
        url,
        publicId: uploadResult,
        mimeType: file.mimetype,
        size: file.size,
      }
      if (mediaType && folder === 'sportzone/events') {
        try {
          await upsertMedia({ ...upload, type: mediaType })
        } catch (error) {
          await cleanupAssetIfUnused(upload.url)
          throw error
        }
      }
      return upload
    }),
  )

  const successfulUploads = uploadResults
    .filter((result): result is PromiseFulfilledResult<any> => result.status === 'fulfilled')
    .map((result) => result.value)

  const failedUploads = uploadResults
    .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
    .map((result) => result.reason?.message || 'An unknown upload error occurred.')

  if (failedUploads.length > 0 && successfulUploads.length === 0) {
    throw new AppError(400, `All file uploads failed. First error: ${failedUploads[0]}`)
  }

  // If only one file was uploaded, return it directly for simpler client-side handling.
  res.status(200).json(successResponse({ uploads: successfulUploads, failedUploads }))
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

export const uploadsController = { uploadFiles, deleteUploadedFile }
