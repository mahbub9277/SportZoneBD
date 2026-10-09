import cloudinary from '../lib/cloudinary.js'
import type { UploadApiResponse } from 'cloudinary'
import { AppError } from '../core/errors.js'
import logger from '../core/logger.js'
import { parseCloudinaryAssetReference } from './cloudinaryAsset.js'
import * as streamifier from 'streamifier'

/**
 * Uploads a file buffer to a specified folder in Cloudinary.
 * @param file - The file object from Multer (contains the buffer).
 * @param folder - The name of the folder in Cloudinary to upload the file to.
 * @returns A promise that resolves with the Cloudinary upload response.
 */
export const uploadFile = (file: Express.Multer.File, folder: string): Promise<UploadApiResponse> => {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder: folder,
        resource_type: 'auto',
      },
      (error, result) => {
        if (error) {
          logger.error({ error }, 'Cloudinary upload failed')
          return reject(new AppError(500, 'File upload to Cloudinary failed.'))
        }
        if (result) {
          resolve(result)
        } else {
          // This case should ideally not be hit if error is null, but as a safeguard:
          reject(new AppError(500, 'Cloudinary did not return a result.'))
        }
      },
    )

    // Use streamifier to pipe the buffer from multer to the upload stream
    streamifier.createReadStream(file.buffer).pipe(uploadStream)
  })
}

/**
 * Deletes a file from Cloudinary using its public URL.
 * @param fileUrl - The full public URL of the file to delete.
 */
export const deleteFile = async (fileUrl: string): Promise<void> => {
  try {
    const reference = parseCloudinaryAssetReference(fileUrl)
    if (!reference) return

    await cloudinary.uploader.destroy(reference.publicId, { resource_type: reference.resourceType })
  } catch (error) {
    logger.warn({ error }, 'Cloudinary file deletion failed - operation will continue')
    // We don't throw an error here to prevent a failed deletion from breaking the entire request.
    // It's better to have an orphaned file than to fail an update operation.
  }
}