import sharp from 'sharp'
import { ValidationError } from '../core/errors.js'

export const MAX_IMAGE_INPUT_PIXELS = 40_000_000
export const MAX_AVATAR_INPUT_BYTES = 5 * 1024 * 1024
export const MAX_AVATAR_DIMENSION = 512
export const MAX_AVATAR_BYTES = 512 * 1024

const avatarQualities = [82, 70, 58, 46] as const
const avatarFallbackDimensions = [448, 384, 320, 256, 192, 128] as const
const supportedFormatsByMimeType: Record<string, readonly string[]> = {
  'image/jpeg': ['jpeg'],
  'image/jpg': ['jpeg'],
  'image/png': ['png'],
  'image/webp': ['webp'],
}

const invalidImage = (message = 'Upload a valid JPEG, PNG, or WebP image.') =>
  new ValidationError(message, { file: 'Invalid image' })

export function isWithinImagePixelLimit(width: number | undefined, height: number | undefined): boolean {
  return Number.isSafeInteger(width)
    && Number.isSafeInteger(height)
    && Number(width) > 0
    && Number(height) > 0
    && Number(width) * Number(height) <= MAX_IMAGE_INPUT_PIXELS
}

export async function optimizeAvatarImage(buffer: Buffer, declaredMimeType: string): Promise<Buffer> {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw invalidImage()
  }
  if (buffer.length > MAX_AVATAR_INPUT_BYTES) {
    throw invalidImage('Avatar images must not exceed 5 MB.')
  }

  const normalizedMimeType = declaredMimeType.split(';', 1)[0]?.trim().toLowerCase() ?? ''
  const supportedFormats = supportedFormatsByMimeType[normalizedMimeType]
  if (!supportedFormats) {
    throw invalidImage()
  }

  const sharpOptions = { failOn: 'error' as const, limitInputPixels: MAX_IMAGE_INPUT_PIXELS }

  try {
    const metadata = await sharp(buffer, sharpOptions).metadata()
    if (!supportedFormats.includes(metadata.format ?? '')) {
      throw invalidImage()
    }
    if (!isWithinImagePixelLimit(metadata.width, metadata.height)) {
      throw invalidImage('Image dimensions exceed the supported pixel limit.')
    }

    const normalizedPng = await sharp(buffer, sharpOptions)
      .rotate()
      .resize({
        width: MAX_AVATAR_DIMENSION,
        height: MAX_AVATAR_DIMENSION,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .png()
      .toBuffer()

    for (const quality of avatarQualities) {
      const webp = await sharp(normalizedPng)
        .webp({ quality, effort: 4 })
        .toBuffer()
      if (webp.length <= MAX_AVATAR_BYTES) {
        return webp
      }
    }

    for (const dimension of avatarFallbackDimensions) {
      const smallerPng = await sharp(normalizedPng)
        .resize({ width: dimension, height: dimension, fit: 'inside', withoutEnlargement: true })
        .png()
        .toBuffer()
      const webp = await sharp(smallerPng)
        .webp({ quality: avatarQualities[avatarQualities.length - 1], effort: 4 })
        .toBuffer()
      if (webp.length <= MAX_AVATAR_BYTES) {
        return webp
      }
    }
  } catch (error) {
    if (error instanceof ValidationError) {
      throw error
    }
    throw invalidImage()
  }

  throw invalidImage('This avatar image cannot be compressed below 512 KB.')
}
