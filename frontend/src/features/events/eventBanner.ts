import { buildCloudinaryUrl } from '../../utils/cloudinary.ts'

/**
 * The public event hero is a single 16:5 artwork (`1600 × 500` when uploaded), so its rendition only has to
 * change width per viewport — the composition stays the same at every breakpoint, which is why the crop is
 * pinned to the same 16:5 box the hero's CSS reserves.
 *
 * Before this, a phone downloaded the full 1600px banner. The `src` stays the exact request the page already
 * made, so the established image and its CDN cache entry are unchanged; `srcSet` only lets a browser that
 * supports it pick a smaller rendition.
 */
export const EVENT_BANNER_WIDTHS = [640, 960, 1280, 1600]

/** Mirrors the page shell insets (`px-4` / `md:px-5` / `lg:px-6`). */
export const EVENT_BANNER_SIZES = '(min-width: 1024px) calc(100vw - 48px), (min-width: 768px) calc(100vw - 40px), calc(100vw - 32px)'

const isCloudinaryUrl = (url: string) => /cloudinary\.com/i.test(url)

/** Width candidates for the event hero banner, or `undefined` when the URL cannot be transformed. */
export function buildEventBannerSrcSet(sourceUrl?: string | null): string | undefined {
  const url = typeof sourceUrl === 'string' ? sourceUrl.trim() : ''
  if (!url || !isCloudinaryUrl(url)) return undefined

  return EVENT_BANNER_WIDTHS
    .map((width) => {
      const height = Math.round((width * 5) / 16)
      return `${buildCloudinaryUrl(url, { width, height, crop: 'fill', gravity: 'center' })} ${width}w`
    })
    .join(', ')
}

/** The single URL the hero renders when `srcSet` is unsupported; unchanged from the previous implementation. */
export function buildEventBannerSrc(sourceUrl?: string | null): string {
  return buildCloudinaryUrl(sourceUrl, { width: 1600, height: 500, crop: 'fill', gravity: 'center' })
}
