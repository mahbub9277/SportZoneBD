import { v2 as cloudinary, type UploadApiOptions } from 'cloudinary';
import logger from '../core/logger.js';

try {
  if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
    throw new Error('Cloudinary environment variables are not set.');
  }

  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  });
  logger.info('Cloudinary SDK configured successfully.');
} catch (error: any) {
  logger.warn(`Cloudinary SDK configuration failed: ${error.message}. File uploads will be disabled.`);
}

export default cloudinary;

export type { UploadApiOptions };