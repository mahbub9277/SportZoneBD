/**
 * Turns a stored Cloudinary reference into the (public id, resource type) pair the admin API needs.
 *
 * Uploads are stored as delivery URLs, and a delivery URL may carry a transformation, a version, a
 * query string and a resource type. Deletion only accepts a bare public id, so the reference has to be
 * reduced exactly the way Cloudinary built it. It used to be reduced by looking for `/upload/` and then
 * for a `v123` segment: a URL whose transformation had no version after it kept the transformation as
 * part of the public id, and a video URL was always deleted as an image. Both fail silently, which is
 * how orphaned assets accumulate.
 */

export type CloudinaryResourceType = 'image' | 'video' | 'raw'

export interface CloudinaryAssetReference {
  publicId: string
  resourceType: CloudinaryResourceType
}

/**
 * The transformation parameter keys Cloudinary writes. A path segment is only treated as a
 * transformation when every comma-separated token begins with one of these keys, so a public id such as
 * `hero_banner` is never mistaken for one.
 */
const TRANSFORMATION_KEYS = new Set([
  'w', 'h', 'c', 'q', 'f', 'ar', 'g', 'x', 'y', 'z', 'r', 'e', 'b', 'co', 'o', 't', 'so', 'du', 'dn',
  'dl', 'u', 'l', 'bo', 'fn', 'ki', 'p', 'dpr', 'fl', 'ac', 'af', 'cs', 'df', 'eo', 'vc', 'vb', 'a',
])

const RESOURCE_TYPES: CloudinaryResourceType[] = ['image', 'video', 'raw']
const UPLOAD_MARKER = /(?:^|\/)(image|video|raw)\/upload\//i

function isTransformationSegment(segment: string): boolean {
  return segment.split(',').every((token) => {
    const separator = token.indexOf('_')
    if (separator <= 0) return false
    return TRANSFORMATION_KEYS.has(token.slice(0, separator).toLowerCase())
  })
}

const withoutExtension = (value: string): string => value.replace(/\.[^/.]+$/, '')

/**
 * Parses a stored URL or public id into a deletable reference.
 *
 * Returns null when there is nothing usable to delete, so callers can skip instead of sending a
 * request that can only fail.
 */
export function parseCloudinaryAssetReference(value: string | null | undefined): CloudinaryAssetReference | null {
  if (typeof value !== 'string') return null

  const trimmed = value.trim()
  if (!trimmed || trimmed === 'undefined' || trimmed === 'null') return null

  if (/^https?:\/\//i.test(trimmed)) {
    const marker = trimmed.match(UPLOAD_MARKER)
    if (!marker) return null

    const resourceType = marker[1].toLowerCase() as CloudinaryResourceType
    const afterMarker = trimmed.slice((marker.index ?? 0) + marker[0].length).split('?')[0]
    const segments = afterMarker.split('/').filter(Boolean)
    if (segments.length === 0) return null

    let index = 0
    // Leading transformations, then the version. The final segment is never skipped: a public id that
    // happens to look like a transformation must survive.
    while (index < segments.length - 1 && isTransformationSegment(segments[index])) index += 1
    if (index < segments.length - 1 && /^v\d+$/.test(segments[index])) index += 1

    const publicId = withoutExtension(segments.slice(index).join('/'))
    return publicId ? { publicId, resourceType } : null
  }

  const normalized = trimmed.replace(/^\/+/, '')
  const prefixed = RESOURCE_TYPES.find((type) => normalized.startsWith(`${type}/`))
  const publicId = withoutExtension(prefixed ? normalized.slice(prefixed.length + 1) : normalized)

  if (!publicId) return null
  return { publicId, resourceType: prefixed ?? 'image' }
}
