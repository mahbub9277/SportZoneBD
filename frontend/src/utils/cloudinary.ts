/**
 * @file Cloudinary URL construction utility.
 *
 * This file provides a centralized function to build Cloudinary image URLs
 * from a public_id, allowing for easy application of transformations.
 */

const CLOUD_NAME = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME;
const BASE_URL = `https://res.cloudinary.com/${CLOUD_NAME}/image/upload`;

if (!CLOUD_NAME) {
  console.error('VITE_CLOUDINARY_CLOUD_NAME is not set in the environment variables.');
}

/**
 * Defines the available Cloudinary transformations.
 * For a full list, see: https://cloudinary.com/documentation/image_transformation_reference
 */

export interface CloudinaryTransformations {
  resourceType?: 'image' | 'video';
  width?: number;
  height?: number;
  crop?: 'fill' | 'fit' | 'thumb' | 'scale' | 'limit' | 'pad' | 'lpad' | 'mpad' | 'crop';
  quality?: 'auto' | 'auto:good' | 'auto:eco' | 'auto:low' | number;
  format?: 'auto' | 'jpg' | 'png' | 'webp' | 'avif';
  aspectRatio?: string;
  gravity?: 'auto' | 'face' | 'center' | 'north' | 'south' | 'east' | 'west';
  zoom?: number;
  fetchFormat?: 'auto';
}

/**
 * Builds a Cloudinary URL from a public_id and transformation options.
 *
 * @param publicId - The public_id of the image stored in Cloudinary.
 * @param options - An object of Cloudinary transformation parameters.
 * @returns The full Cloudinary image URL, or a placeholder/empty string if publicId is missing.
 */
export const buildCloudinaryUrl = (publicId?: string | null, { resourceType = 'image', ...options }: CloudinaryTransformations = {}): string => {
  if (typeof publicId !== 'string') {
    return '/placeholder-image.svg'
  }

  const normalizedPublicId = publicId.trim();

  if (!normalizedPublicId || normalizedPublicId === 'undefined' || normalizedPublicId === 'null' || normalizedPublicId.includes('/uploads/undefined')) {
    return '/placeholder-image.svg';
  }

  const transformationOptions: CloudinaryTransformations = {
    quality: 'auto',
    format: 'auto',
    ...options,
  }

  const transformationString = Object.entries(transformationOptions)
    .map(([key, value]) => {
      const keyMap: { [key: string]: string } = { width: 'w', height: 'h', crop: 'c', quality: 'q', format: 'f', aspectRatio: 'ar', gravity: 'g', zoom: 'z', fetchFormat: 'f', resourceType: 'resource_type' };
      return `${keyMap[key] || key}_${value}`;
    })
    .join(',');

  if (/^https?:\/\//i.test(normalizedPublicId)) {
    const cloudinaryUrl = new URL(normalizedPublicId);

    if (cloudinaryUrl.hostname.includes('cloudinary.com')) {
      const path = cloudinaryUrl.pathname;
      const transformedPath = path.replace(
        /\/(?:image|video|raw|audio|auto)\/upload\//,
        `/${resourceType}/upload/${transformationString ? `${transformationString}/` : ''}`,
      );

      const newUrl = new URL(`https://res.cloudinary.com${transformedPath}`);
      newUrl.search = cloudinaryUrl.search;

      return newUrl.toString();
    }

    return normalizedPublicId;
  }

  if (!CLOUD_NAME) {
    console.error('VITE_CLOUDINARY_CLOUD_NAME is not set in the environment variables.');
    return normalizedPublicId;
  }

  return `${BASE_URL}/${transformationString ? transformationString + '/' : ''}${normalizedPublicId}`;
};