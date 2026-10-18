/**
 * What the event form stores for its two images.
 *
 * An event image is not saved until Cloudinary has verified the upload and returned its durable URL, so the
 * payload has to be built from that URL — never from the local `blob:` preview the admin is looking at. The
 * previous implementation fell back to the previously stored URL when an upload failed and still reported
 * success, which is why a replaced image appeared in the form and then "reverted" after a reload: the new
 * file was never persisted, and the fallback was invisible to the caller.
 *
 * These helpers make that outcome explicit. A failure is returned as data instead of being swallowed, and the
 * payload keeps the previous (still valid) URL so a caller that ignores the failures can never write an empty
 * string or a `blob:` reference into the event record.
 */

export interface EventAssetUpload {
  uploads: Array<{ url: string }>
  failedUploads: string[]
}

export interface EventAssetSelection {
  /** The URL the form currently holds: what the event already stores, or an asset picked from the library. */
  current: string | null | undefined
  /** A file the admin picked that still has to be uploaded. */
  file: File | null
  /** The upload result for that file, when an upload was requested. */
  upload: EventAssetUpload | null
}

export interface EventAssetResolution {
  url: string
  /** Why the picked file could not be stored. `null` means the resolution is safe to save. */
  failure: string | null
}

export const EVENT_ASSET_UPLOAD_MISSING = 'the upload did not return a stored image'

/** Resolves one image field: the verified Cloudinary URL when an upload succeeded, the form value otherwise. */
export function resolveEventAsset({ current, file, upload }: EventAssetSelection): EventAssetResolution {
  const stored = typeof current === 'string' ? current : ''

  if (!file) return { url: stored, failure: null }

  const uploaded = upload?.uploads?.[0]?.url?.trim()
  if (uploaded) return { url: uploaded, failure: null }

  const reported = (upload?.failedUploads ?? []).map((entry) => entry.trim()).filter(Boolean)
  return { url: stored, failure: reported.length > 0 ? reported.join(' ') : EVENT_ASSET_UPLOAD_MISSING }
}

export interface EventAssetFormState {
  logo?: string | null
  banner?: string | null
}

export interface BuildEventAssetPayloadInput<T extends EventAssetFormState> {
  form: T
  logoFile: File | null
  bannerFile: File | null
  logoUpload: EventAssetUpload | null
  bannerUpload: EventAssetUpload | null
}

export interface EventAssetPayloadResult<T> {
  payload: T
  /** One human-readable entry per image that could not be stored. Empty means the payload is safe to save. */
  failures: string[]
}

/**
 * Builds the payload for a create/update request and reports every image that failed.
 *
 * The caller must not send the payload when `failures` is non-empty: the event would otherwise be saved with
 * the old artwork while the admin believes the replacement succeeded.
 */
export function buildEventAssetPayload<T extends EventAssetFormState>({
  form,
  logoFile,
  bannerFile,
  logoUpload,
  bannerUpload,
}: BuildEventAssetPayloadInput<T>): EventAssetPayloadResult<T> {
  const logo = resolveEventAsset({ current: form.logo, file: logoFile, upload: logoUpload })
  const banner = resolveEventAsset({ current: form.banner, file: bannerFile, upload: bannerUpload })

  const failures: string[] = []
  if (logo.failure) failures.push(`Logo: ${logo.failure}`)
  if (banner.failure) failures.push(`Banner: ${banner.failure}`)

  return { payload: { ...form, logo: logo.url, banner: banner.url }, failures }
}
