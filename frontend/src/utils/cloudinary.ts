/**
 * @file Cloudinary URL construction utility.
 *
 * One place builds every Cloudinary delivery URL, so a public id, an already-uploaded URL and a
 * locally previewed file all take the same path and produce the same result for the same input.
 *
 * The rules it enforces:
 * - A missing or placeholder public id resolves to the local placeholder rather than a request that
 *   can only fail.
 * - `blob:`/`data:` URLs (an unsaved file preview) are handed back untouched. Prefixing them with the
 *   Cloudinary host, as a naive builder does, is a guaranteed broken image.
 * - A non-Cloudinary https URL (a provider crest, for example) is also handed back untouched: we
 *   cannot transform a host we do not control.
 * - A Cloudinary URL keeps its own transformations; ours are added once, in a stable order, and a
 *   repeated key (for example `fetchFormat` next to `format`) is written once so the same input always
 *   yields the same URL and the browser cache keeps working.
 * - Without a configured cloud name every relative id resolves to the placeholder instead of
 *   `res.cloudinary.com/undefined/...`.
 */

const CLOUDINARY_HOST = 'res.cloudinary.com'
const PLACEHOLDER_URL = '/placeholder-image.svg'

/**
 * Read once at module load. Vite replaces this expression at build time; the `try` keeps the module
 * importable where `import.meta.env` does not exist (node test runs).
 */
const readConfiguredCloudName = (): string | undefined => {
  try {
    return import.meta.env.VITE_CLOUDINARY_CLOUD_NAME
  } catch {
    return undefined
  }
}

const CONFIGURED_CLOUD_NAME = readConfiguredCloudName()?.trim() || undefined

if (!CONFIGURED_CLOUD_NAME && typeof console !== 'undefined') {
  console.error('VITE_CLOUDINARY_CLOUD_NAME is not set in the environment variables.')
}

/**
 * Defines the available Cloudinary transformations.
 * For a full list, see: https://cloudinary.com/documentation/image_transformation_reference
 */
export interface CloudinaryTransformations {
  resourceType?: 'image' | 'video';
  width?: number;
  height?: number;
  crop?: 'fill' | 'fit' | 'thumb' | 'scale' | 'limit' | 'pad' | 'lpad' | 'mpad';
  quality?: 'auto' | 'auto:good' | 'auto:eco' | 'auto:low' | number;
  format?: 'auto' | 'jpg' | 'png' | 'webp' | 'avif';
  aspectRatio?: string;
  gravity?: 'auto' | 'face' | 'center' | 'north' | 'south' | 'east' | 'west';
  zoom?: number;
  fetchFormat?: 'auto';
}

/** Cloudinary's URL parameter for each option, in the order they are written. */
const TRANSFORMATION_PARAMETERS: Array<[keyof CloudinaryTransformations, string]> = [
  ['quality', 'q'],
  ['format', 'f'],
  ['fetchFormat', 'f'],
  ['width', 'w'],
  ['height', 'h'],
  ['crop', 'c'],
  ['aspectRatio', 'ar'],
  ['gravity', 'g'],
  ['zoom', 'z'],
]

/** A transformation segment this module itself produced, so re-running it cannot stack two of them. */
const OWN_TRANSFORMATION_SEGMENT = /^(?:q_auto|f_auto)(?:,[a-z]{1,5}_[^,/]+)+$/

const placeholder = (): string => PLACEHOLDER_URL

const isUsablePublicId = (value: string): boolean => {
  if (!value) return false
  if (value === 'undefined' || value === 'null') return false
  if (value.includes('/uploads/undefined')) return false
  return true
}

function toTransformationString(options: CloudinaryTransformations): string {
  const written: Array<[string, string]> = []
  const seen = new Set<string>()

  for (const [option, parameter] of TRANSFORMATION_PARAMETERS) {
    const value = options[option]
    if (value === undefined || value === null || value === '') continue
    if (seen.has(parameter)) continue
    seen.add(parameter)
    written.push([parameter, String(value)])
  }

  return written.map(([parameter, value]) => `${parameter}_${value}`).join(',')
}

/** Splits `/image/upload/<segments>/path`, keeping the delivery type and dropping a transformation we wrote. */
function rewriteCloudinaryPath(path: string, resourceType: string, transformation: string): string {
  const deliveryTypeMatch = path.match(/\/(image|video|raw|audio|auto)\/(upload|fetch|private|authenticated)\//)
  if (!deliveryTypeMatch) return path

  const [, detectedType, deliveryType] = deliveryTypeMatch
  const marker = deliveryTypeMatch[0]
  const markerIndex = path.indexOf(marker)
  const segments = path.slice(markerIndex + marker.length).split('/')

  // Our own transformation is replaced; anything else (a foreign or hand-written one) is preserved.
  const ownSegmentIndex = segments.findIndex((segment) => OWN_TRANSFORMATION_SEGMENT.test(segment))
  if (ownSegmentIndex !== -1) segments.splice(ownSegmentIndex, 1)

  const prefix = `${path.slice(0, markerIndex)}/${resourceType || detectedType}/${deliveryType}/`
  const body = segments.join('/')

  return transformation ? `${prefix}${transformation}/${body}` : `${prefix}${body}`
}

/**
 * The pure core: every rule above, with the cloud name passed in explicitly so URL construction can be
 * tested without a bundler-provided environment.
 */
export function buildCloudinaryUrlFor(
  cloudName: string | undefined,
  publicId?: string | null,
  options: CloudinaryTransformations = {},
): string {
  if (typeof publicId !== 'string') return placeholder()

  const value = publicId.trim()
  if (!isUsablePublicId(value)) return placeholder()

  const { resourceType = 'image', ...transformations } = options
  const transformation = toTransformationString({ quality: 'auto', format: 'auto', ...transformations })

  // An unsaved file preview and an inline image are already complete URLs.
  if (/^(?:blob|data|filesystem):/i.test(value)) return value

  if (/^(?:https?:)?\/\//i.test(value)) {
    let parsed: URL
    try {
      parsed = new URL(value.startsWith('//') ? `https:${value}` : value)
    } catch {
      return value
    }

    if (!parsed.hostname.endsWith(CLOUDINARY_HOST)) return parsed.toString()

    const rewritten = rewriteCloudinaryPath(parsed.pathname, resourceType, transformation)
    const url = new URL(`https://${CLOUDINARY_HOST}${rewritten}`)
    url.search = parsed.search
    return url.toString()
  }

  if (!cloudName) return placeholder()

  return `https://${CLOUDINARY_HOST}/${cloudName}/${resourceType}/upload/${transformation ? `${transformation}/` : ''}${value}`
}

/**
 * Builds a Cloudinary URL from a public_id and transformation options.
 *
 * @param publicId - The public_id of the image stored in Cloudinary, or an already-uploaded URL.
 * @param options - An object of Cloudinary transformation parameters.
 * @returns The full Cloudinary image URL, or the local placeholder when no usable public id exists.
 */
export const buildCloudinaryUrl = (
  publicId?: string | null,
  options: CloudinaryTransformations = {},
): string => buildCloudinaryUrlFor(CONFIGURED_CLOUD_NAME, publicId, options)

/** The placeholder every unusable public id resolves to; exported so components can test against it. */
export const CLOUDINARY_PLACEHOLDER_URL = PLACEHOLDER_URL
