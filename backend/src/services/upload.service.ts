import cloudinary, { type UploadApiOptions } from '../lib/cloudinary.js';
import { AppError } from '../core/errors.js';
import logger from '../core/logger.js';
import { Readable } from 'stream';

/**
 * Uploads a file buffer to Cloudinary using a stream.
 * @param {Buffer} buffer - The file buffer from multer.
 * @param {string} folder - The target folder in Cloudinary (e.g., 'sportzone/banners').
 * @param {(progress: number) => void} [onProgress] - Optional callback to report upload progress.
 * @param {UploadApiOptions} [transformations] - Optional Cloudinary transformation and upload options.
 * @returns {Promise<string>} The public ID of the uploaded file.
 */
export const buildCloudinarySecureUrl = (publicId: string | null | undefined, resourceType: 'image' | 'video' = 'image'): string | null => {
  if (!publicId) {
    return null
  }

  if (/^https?:\/\//i.test(publicId)) {
    return publicId
  }

  const normalizedPublicId = publicId.trim()
  if (!normalizedPublicId) {
    return null
  }

  return cloudinary.url(normalizedPublicId, { secure: true, sign_url: false, resource_type: resourceType })
}

export const buildCloudinaryRawUrl = (publicId: string | null | undefined): string | null => {
  if (!publicId) return null
  if (/^https?:\/\//i.test(publicId)) return publicId

  const normalizedPublicId = publicId.trim()
  return normalizedPublicId ? cloudinary.url(normalizedPublicId, { secure: true, resource_type: 'raw', sign_url: false }) : null
}

export const uploadStreamToCloudinary = (
  buffer: Buffer,
  folder: string,
  onProgress?: (progress: number) => void,
  transformations?: UploadApiOptions
): Promise<string> => {
  if (!cloudinary.config().cloud_name) {
    throw new AppError(500, 'Cloudinary is not initialized. Cannot upload file.');
  }

  return new Promise((resolve, reject) => {
    const uploadOptions: UploadApiOptions = {
      folder: folder,
      ...transformations,
    };
    const uploadStream = cloudinary.uploader.upload_stream(
      uploadOptions,
      (error, result) => {
        if (error) {
          return reject(new AppError(500, 'Error uploading file to Cloudinary.', error));
        }
        if (!result) {
          return reject(new AppError(500, 'Cloudinary upload result is undefined.'));
        }
        resolve(result.public_id);
      }
    );

    const readableStream = new Readable();
    readableStream._read = () => {};
    readableStream.push(buffer);
    readableStream.push(null);

    if (onProgress) {
      let totalBytes = buffer.length;
      let uploadedBytes = 0;
      readableStream.on('data', (chunk) => {
        uploadedBytes += chunk.length;
        const progress = Math.round((uploadedBytes / totalBytes) * 100);
        onProgress(progress);
      });
    }
    readableStream.pipe(uploadStream); // Pipe the stream to start the upload
  });
};

/**
 * Deletes a file from Cloudinary based on its public ID.
 * @param {string | null | undefined} publicId - The public ID of the file to delete.
 */
export const deleteFileFromCloudinary = async (publicId: string | null | undefined): Promise<void> => {
  if (!cloudinary.config().cloud_name) {
    logger.warn('Cloudinary is not initialized. Skipping file deletion.');
    return;
  }

  if (!publicId) {
    return; // No file to delete
  }

  try {
    let normalizedId = publicId.trim()
    let resourceType: 'image' | 'video' = 'image'

    if (/^https?:\/\//i.test(normalizedId)) {
      const uploadIndex = normalizedId.indexOf('/upload/')
      if (uploadIndex === -1) return
      const uploadPath = normalizedId.slice(uploadIndex + '/upload/'.length).split('?')[0]
      const pathParts = uploadPath.split('/').filter(Boolean)
      const versionIndex = pathParts.findIndex((part) => /^v\d+$/.test(part))
      normalizedId = (versionIndex >= 0 ? pathParts.slice(versionIndex + 1) : pathParts).join('/')
      resourceType = normalizedId.startsWith('video/') ? 'video' : 'image'
    } else {
      resourceType = normalizedId.startsWith('video/') ? 'video' : 'image'
    }

    normalizedId = normalizedId.replace(/\.[^/.]+$/, '')
    if (!normalizedId) return

    await cloudinary.uploader.destroy(normalizedId, { resource_type: resourceType });
  } catch (error: any) {
    // Log the error but don't re-throw it. Failing to delete an old file shouldn't block an update operation.
    logger.error({ error }, `Failed to delete file from Cloudinary`);
  }
};

/**
 * Deletes multiple files from Cloudinary based on their public URLs.
 * @param {(string | null | undefined)[]} publicIds - An array of public IDs of the files to delete.
 */
export const deleteMultipleFilesFromCloudinary = async (publicIds: (string | null | undefined)[]): Promise<void> => {
  if (!cloudinary.config().cloud_name) {
    logger.warn('Cloudinary is not initialized. Skipping file deletion.');
    return;
  }

  const validIds = publicIds.filter((id): id is string => !!id);
  if (validIds.length === 0) {
    return;
  }

  // Await the deletions so that failures can be caught by the calling transaction.
  // This prevents orphaned files if a database operation fails later.
  await Promise.all(validIds.map(id => deleteFileFromCloudinary(id)));
};