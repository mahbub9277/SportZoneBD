import { buildCloudinaryUrl } from '../../utils/cloudinary.ts'

/**
 * The hero banner's artwork, resolved per device class.
 *
 * The banner stores one uploaded artwork, so each breakpoint asks Cloudinary for a rendition cropped to the
 * aspect ratio and width that breakpoint actually renders. That is what keeps a phone from downloading the
 * 1920px desktop crop (the image-delivery saving in the PageSpeed report) without a second upload, a second
 * database column or a second request: the browser picks one `<source>` and fetches exactly one URL.
 *
 * The three ratios mirror the hero's CSS (`BannerHero`), so the artwork the browser downloads and the box it
 * paints into agree — which is what keeps the layout from shifting.
 */
export const BANNER_MOBILE_MEDIA = '(max-width: 639px)'
export const BANNER_TABLET_MEDIA = '(max-width: 1023px)'

/** Mobile: compact horizontal, `aspect-5/2`. */
export const BANNER_MOBILE_ASPECT = '5:2'
/** Tablet: slightly shorter than the old 16:7, `aspect-12/5`. */
export const BANNER_TABLET_ASPECT = '12:5'
/** Desktop is unchanged: `aspect-16/5`. */
export const BANNER_DESKTOP_ASPECT = '16:5'

const MOBILE_WIDTHS = [480, 640, 828]
const TABLET_WIDTHS = [768, 1024, 1280]
/** Unchanged from the previous implementation, so the desktop artwork is byte-for-byte the same request. */
const DESKTOP_WIDTHS = [640, 960, 1280, 1600, 1920]

// Mirrors the homepage shell insets (px-3 / sm:px-4 / lg:px-6) and its 1920px max width.
export const BANNER_MOBILE_SIZES = 'calc(100vw - 24px)'
export const BANNER_TABLET_SIZES = 'calc(100vw - 32px)'
export const BANNER_DESKTOP_SIZES = '(min-width: 1920px) 1856px, (min-width: 1024px) calc(100vw - 48px), (min-width: 640px) calc(100vw - 32px), calc(100vw - 24px)'

export interface BannerRendition {
  /** The URL used when `srcSet` is not supported: the largest width for that device. */
  src: string
  srcSet?: string
  sizes: string
}

export interface BannerArtwork {
  mobile: BannerRendition
  tablet: BannerRendition
  desktop: BannerRendition
}

const isCloudinaryUrl = (url: string) => /cloudinary\.com/i.test(url)

/**
 * Builds a `srcSet` of width candidates, optionally cropped to an aspect ratio.
 *
 * Desktop deliberately passes no aspect: its rendition must stay the exact request the homepage already
 * made, so the established composition and the CDN cache entry are unchanged.
 */
const buildSrcSet = (url: string, widths: number[], aspectRatio?: string) =>
  widths
    .map((width) => `${buildCloudinaryUrl(url, { width, crop: 'fill', gravity: 'center', ...(aspectRatio ? { aspectRatio } : {}) })} ${width}w`)
    .join(', ')

/**
 * Resolves the three renditions for one banner image.
 *
 * A URL we cannot transform (a non-Cloudinary host, a `blob:` preview) is used as-is for every breakpoint:
 * the browser then downloads that one file, which is exactly what happened before this change.
 */
export function buildBannerArtwork(sourceUrl?: string | null): BannerArtwork | null {
  const url = typeof sourceUrl === 'string' ? sourceUrl.trim() : ''
  if (!url) return null

  const largest = (widths: number[]) => widths[widths.length - 1]

  if (!isCloudinaryUrl(url)) {
    const rendition: BannerRendition = { src: url, sizes: BANNER_DESKTOP_SIZES }
    return { mobile: { ...rendition, sizes: BANNER_MOBILE_SIZES }, tablet: { ...rendition, sizes: BANNER_TABLET_SIZES }, desktop: rendition }
  }

  return {
    mobile: {
      src: buildCloudinaryUrl(url, { width: largest(MOBILE_WIDTHS), aspectRatio: BANNER_MOBILE_ASPECT, crop: 'fill', gravity: 'center' }),
      srcSet: buildSrcSet(url, MOBILE_WIDTHS, BANNER_MOBILE_ASPECT),
      sizes: BANNER_MOBILE_SIZES,
    },
    tablet: {
      src: buildCloudinaryUrl(url, { width: largest(TABLET_WIDTHS), aspectRatio: BANNER_TABLET_ASPECT, crop: 'fill', gravity: 'center' }),
      srcSet: buildSrcSet(url, TABLET_WIDTHS, BANNER_TABLET_ASPECT),
      sizes: BANNER_TABLET_SIZES,
    },
    desktop: {
      src: buildCloudinaryUrl(url, { width: 1800, crop: 'fill', gravity: 'center' }),
      srcSet: buildSrcSet(url, DESKTOP_WIDTHS),
      sizes: BANNER_DESKTOP_SIZES,
    },
  }
}

/** The three artwork previews the admin page shows, one per device crop. */
export function buildBannerPreviewArtwork(sourceUrl?: string | null) {
  const artwork = buildBannerArtwork(sourceUrl)
  if (!artwork) return null
  return {
    mobile: artwork.mobile.src,
    tablet: artwork.tablet.src,
    desktop: artwork.desktop.src,
  }
}
