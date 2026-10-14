export type ImageUploadPurpose =
  | 'highlight-image'
  | 'banner-image'
  | 'banner-poster'
  | 'advertisement-image'
  | 'event-logo'
  | 'event-banner'
  | 'popup-image'
  | 'team-logo'
  | 'stream-logo'
  | 'channel-logo'
  | 'channel-category-logo'

export type VideoUploadPurpose =
  | 'highlight-video'
  | 'banner-video'
  | 'match-prestart-video'

export type UploadPurpose = ImageUploadPurpose | VideoUploadPurpose

export interface ImageUploadPolicy {
  maxWidth: number
  maxHeight: number
  maxInputBytes?: number
  quality: number
  cropAspectRatio?: number
}

const megabyte = 1024 * 1024
const imageUploadPolicies: Record<ImageUploadPurpose, ImageUploadPolicy> = {
  'highlight-image': { maxWidth: 1600, maxHeight: 1600, maxInputBytes: 5 * megabyte, quality: 0.82 },
  'banner-image': { maxWidth: 1920, maxHeight: 1920, maxInputBytes: 10 * megabyte, quality: 0.82 },
  'banner-poster': { maxWidth: 1920, maxHeight: 1920, maxInputBytes: 10 * megabyte, quality: 0.82 },
  'advertisement-image': { maxWidth: 1920, maxHeight: 1920, quality: 0.82, cropAspectRatio: 4 },
  'event-logo': { maxWidth: 1024, maxHeight: 1024, maxInputBytes: 5 * megabyte, quality: 0.88 },
  'event-banner': { maxWidth: 1920, maxHeight: 1920, maxInputBytes: 5 * megabyte, quality: 0.82 },
  'popup-image': { maxWidth: 1920, maxHeight: 1920, maxInputBytes: 5 * megabyte, quality: 0.82 },
  'team-logo': { maxWidth: 1024, maxHeight: 1024, maxInputBytes: 5 * megabyte, quality: 0.88 },
  'stream-logo': { maxWidth: 1024, maxHeight: 1024, maxInputBytes: 5 * megabyte, quality: 0.88 },
  'channel-logo': { maxWidth: 1024, maxHeight: 1024, maxInputBytes: 5 * megabyte, quality: 0.88 },
  'channel-category-logo': { maxWidth: 1024, maxHeight: 1024, maxInputBytes: 5 * megabyte, quality: 0.88 },
}

const acceptedImageMimeTypes = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp'])
const maxImagePixels = 40_000_000

export function isSupportedImageMimeType(mimeType: string): boolean {
  return acceptedImageMimeTypes.has(mimeType.trim().toLowerCase())
}

export function isImageUploadPurpose(purpose: UploadPurpose): purpose is ImageUploadPurpose {
  return Object.prototype.hasOwnProperty.call(imageUploadPolicies, purpose)
}

export function getImageUploadPolicy(purpose: ImageUploadPurpose): ImageUploadPolicy {
  return imageUploadPolicies[purpose]
}

export function validateImageUploadSource(file: Pick<File, 'size' | 'type'>, purpose: ImageUploadPurpose): ImageUploadPolicy {
  const policy = getImageUploadPolicy(purpose)
  if (!isSupportedImageMimeType(file.type)) {
    throw new Error('Choose a JPEG, PNG, or WebP image.')
  }
  if (!Number.isFinite(file.size) || file.size <= 0) {
    throw new Error('Choose a non-empty image file.')
  }
  if (policy.maxInputBytes !== undefined && file.size > policy.maxInputBytes) {
    throw new Error(`This image exceeds the ${policy.maxInputBytes / megabyte} MB upload limit.`)
  }
  return policy
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException('Cloudinary upload was cancelled.', 'AbortError')
  }
}

function getCropRectangle(width: number, height: number, aspectRatio?: number) {
  if (!aspectRatio) {
    return { x: 0, y: 0, width, height }
  }

  const sourceAspectRatio = width / height
  if (sourceAspectRatio > aspectRatio) {
    const cropWidth = height * aspectRatio
    return { x: (width - cropWidth) / 2, y: 0, width: cropWidth, height }
  }

  const cropHeight = width / aspectRatio
  return { x: 0, y: (height - cropHeight) / 2, width, height: cropHeight }
}

async function prepareImageUpload(file: File, purpose: ImageUploadPurpose, signal?: AbortSignal): Promise<File> {
  const policy = validateImageUploadSource(file, purpose)
  throwIfAborted(signal)

  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    throw new Error('The selected image could not be decoded. Choose a valid JPEG, PNG, or WebP image.')
  }

  const canvas = document.createElement('canvas')
  try {
    throwIfAborted(signal)
    if (!bitmap.width || !bitmap.height || bitmap.width * bitmap.height > maxImagePixels) {
      throw new Error('Image dimensions exceed the supported pixel limit.')
    }

    const crop = getCropRectangle(bitmap.width, bitmap.height, policy.cropAspectRatio)
    const scale = Math.min(1, policy.maxWidth / crop.width, policy.maxHeight / crop.height)
    const width = Math.max(1, Math.round(crop.width * scale))
    const height = Math.max(1, Math.round(crop.height * scale))
    canvas.width = width
    canvas.height = height

    const context = canvas.getContext('2d')
    if (!context) throw new Error('Your browser cannot prepare this image for upload.')
    context.imageSmoothingEnabled = true
    context.imageSmoothingQuality = 'high'
    context.drawImage(bitmap, crop.x, crop.y, crop.width, crop.height, 0, 0, width, height)
    throwIfAborted(signal)

    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((result) => {
        if (!result) {
          reject(new Error('The image could not be encoded for upload.'))
          return
        }
        resolve(result)
      }, 'image/webp', policy.quality)
    })
    throwIfAborted(signal)
    if (blob.type.toLowerCase() !== 'image/webp') {
      throw new Error('Your browser could not encode this image as WebP.')
    }

    const header = new Uint8Array(await blob.slice(0, 12).arrayBuffer())
    if (
      header.length < 12
      || header[0] !== 0x52
      || header[1] !== 0x49
      || header[2] !== 0x46
      || header[3] !== 0x46
      || String.fromCharCode(...header.slice(8, 12)) !== 'WEBP'
    ) {
      throw new Error('The prepared image is not a valid WebP file.')
    }

    const extensionIndex = file.name.lastIndexOf('.')
    const baseName = extensionIndex > 0 ? file.name.slice(0, extensionIndex) : file.name
    return new File([blob], `${baseName || 'image'}.webp`, {
      type: 'image/webp',
      lastModified: file.lastModified,
    })
  } finally {
    bitmap.close()
    canvas.width = 0
    canvas.height = 0
  }
}

export async function prepareUploadFile(file: File, purpose: UploadPurpose, signal?: AbortSignal): Promise<File> {
  if (!isImageUploadPurpose(purpose)) {
    return file
  }
  return prepareImageUpload(file, purpose, signal)
}
