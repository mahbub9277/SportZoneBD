import type { Banner } from './banners.api'

/**
 * The banner management page's pure logic: filtering, ordering, validation and the payload.
 *
 * It lives outside the component so the rules can be tested without a DOM — the page itself only wires
 * state and rendering. Every rule here mirrors a server constraint (see `banner.controller.ts`), so an
 * admin sees the same limits inline instead of a 400 after submitting.
 */

export interface BannerFormState {
  title: string
  subtitle: string
  type: Banner['type']
  imageUrl: string
  videoUrl: string
  posterUrl: string
  badge: string
  ctaText: string
  ctaUrl: string
  displayOrder: number
  isActive: boolean
}

export const emptyBannerForm: BannerFormState = {
  title: '',
  subtitle: '',
  type: 'IMAGE',
  imageUrl: '',
  videoUrl: '',
  posterUrl: '',
  badge: '',
  ctaText: '',
  ctaUrl: '',
  displayOrder: 0,
  isActive: true,
}

/** The server's column limits, so the form can refuse what the API would refuse. */
export const BANNER_FIELD_LIMITS = { title: 160, subtitle: 500, badge: 60, ctaText: 80, ctaUrl: 2048 } as const

export type BannerStatusFilter = 'ALL' | 'ACTIVE' | 'INACTIVE'

export const bannerFormFromRecord = (banner: Banner): BannerFormState => ({
  title: banner.title ?? '',
  subtitle: banner.subtitle ?? '',
  type: banner.type,
  imageUrl: banner.imageUrl ?? '',
  videoUrl: banner.videoUrl ?? '',
  posterUrl: banner.posterUrl ?? '',
  badge: banner.badge ?? '',
  ctaText: banner.ctaText ?? '',
  ctaUrl: banner.ctaUrl ?? '',
  displayOrder: banner.displayOrder,
  isActive: banner.isActive,
})

/** The name shown for a banner that has no title of its own (matching the public feed's behaviour). */
export const bannerDisplayName = (banner: Pick<Banner, 'title' | 'type'>) =>
  banner.title?.trim() || (banner.type === 'VIDEO' ? 'Untitled video banner' : 'Untitled image banner')

export const bannerStatusLabel = (banner: Pick<Banner, 'isActive'>) => (banner.isActive ? 'Active' : 'Inactive')

/** Search by title/badge/CTA text and filter by state — the two things this data actually supports. */
export function filterBanners(
  banners: readonly Banner[],
  options: { query?: string; status?: BannerStatusFilter } = {},
): Banner[] {
  const query = options.query?.trim().toLowerCase() ?? ''
  const status = options.status ?? 'ALL'

  return banners.filter((banner) => {
    if (status === 'ACTIVE' && !banner.isActive) return false
    if (status === 'INACTIVE' && banner.isActive) return false
    if (!query) return true

    return [banner.title, banner.badge, banner.ctaText, banner.subtitle]
      .some((field) => typeof field === 'string' && field.toLowerCase().includes(query))
  })
}

/** The position a new banner takes: after the current last one. */
export const nextDisplayOrder = (banners: readonly Pick<Banner, 'displayOrder'>[]) =>
  banners.reduce((highest, banner) => Math.max(highest, banner.displayOrder), -1) + 1

/**
 * Moves one banner up or down and renumbers the list, which is what the keyboard buttons send.
 * Returns the same array instance when the move is not possible, so a caller can skip the request.
 */
export function moveBannerBy(banners: readonly Banner[], bannerId: string, direction: -1 | 1): Banner[] | null {
  const ordered = [...banners].sort((first, second) => first.displayOrder - second.displayOrder)
  const index = ordered.findIndex((banner) => banner.id === bannerId)
  const target = index + direction
  if (index < 0 || target < 0 || target >= ordered.length) return null

  const [moved] = ordered.splice(index, 1)
  ordered.splice(target, 0, moved)
  return ordered.map((banner, position) => ({ ...banner, displayOrder: position }))
}

export type BannerFormErrors = Partial<Record<'title' | 'subtitle' | 'badge' | 'ctaText' | 'media' | 'ctaUrl', string>>

/**
 * Inline validation of the create/edit form.
 *
 * A banner link may be an absolute `https://` URL or an in-app path (`/watch/...`): both are legitimate
 * destinations for `window.location.assign`, and the previous `type="url"` input silently refused the path.
 */
export function validateBannerForm(form: BannerFormState): BannerFormErrors {
  const errors: BannerFormErrors = {}

  if (form.title.trim().length > BANNER_FIELD_LIMITS.title) errors.title = `Title must be ${BANNER_FIELD_LIMITS.title} characters or fewer.`
  if (form.subtitle.trim().length > BANNER_FIELD_LIMITS.subtitle) errors.subtitle = `Subtitle must be ${BANNER_FIELD_LIMITS.subtitle} characters or fewer.`
  if (form.badge.trim().length > BANNER_FIELD_LIMITS.badge) errors.badge = `Badge must be ${BANNER_FIELD_LIMITS.badge} characters or fewer.`
  if (form.ctaText.trim().length > BANNER_FIELD_LIMITS.ctaText) errors.ctaText = `Button label must be ${BANNER_FIELD_LIMITS.ctaText} characters or fewer.`

  if (form.type === 'IMAGE' && !form.imageUrl.trim()) errors.media = 'Upload a banner image before saving.'
  if (form.type === 'VIDEO' && !form.videoUrl.trim()) errors.media = 'Upload a banner video before saving.'

  const ctaUrl = form.ctaUrl.trim()
  if (ctaUrl) {
    const isAbsolute = /^https?:\/\/[^\s]+$/i.test(ctaUrl) && (() => {
      try {
        new URL(ctaUrl)
        return true
      } catch {
        return false
      }
    })()
    const isInternalPath = ctaUrl.startsWith('/') && !ctaUrl.startsWith('//')
    if (!isAbsolute && !isInternalPath) {
      errors.ctaUrl = 'Use a full https:// link or a path that starts with /.'
    } else if (ctaUrl.length > BANNER_FIELD_LIMITS.ctaUrl) {
      errors.ctaUrl = `Link must be ${BANNER_FIELD_LIMITS.ctaUrl} characters or fewer.`
    }
  }

  return errors
}

export const hasBannerFormErrors = (errors: BannerFormErrors) => Object.keys(errors).length > 0

const nullableText = (value: string) => {
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

/**
 * What the API receives.
 *
 * Only the fields the form owns are sent, empty text becomes `null` (so clearing a field really clears it),
 * and `displayOrder` is the banner's existing position while editing — an edit never silently reorders the
 * hero — or the next free position while creating.
 */
export function buildBannerPayload(
  form: BannerFormState,
  options: { isEditing: boolean; displayOrder: number },
): Partial<Banner> {
  return {
    title: form.title.trim(),
    subtitle: nullableText(form.subtitle),
    type: form.type,
    imageUrl: nullableText(form.imageUrl),
    videoUrl: nullableText(form.videoUrl),
    posterUrl: nullableText(form.posterUrl),
    badge: nullableText(form.badge),
    ctaText: nullableText(form.ctaText),
    ctaUrl: nullableText(form.ctaUrl),
    isActive: form.isActive,
    displayOrder: options.isEditing ? form.displayOrder : options.displayOrder,
  }
}
