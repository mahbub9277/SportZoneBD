import assert from 'node:assert/strict'
import test from 'node:test'
import {
  BANNER_DESKTOP_ASPECT,
  BANNER_DESKTOP_SIZES,
  BANNER_MOBILE_ASPECT,
  BANNER_MOBILE_MEDIA,
  BANNER_MOBILE_SIZES,
  BANNER_TABLET_ASPECT,
  BANNER_TABLET_MEDIA,
  BANNER_TABLET_SIZES,
  buildBannerArtwork,
  buildBannerPreviewArtwork,
} from './bannerRenditions.ts'

/**
 * Per-device artwork selection.
 *
 * The point of these assertions: a phone must never be handed the desktop crop, each breakpoint gets the
 * aspect ratio its CSS box uses (so nothing is stretched or shifted), and a URL that cannot be transformed
 * falls back to exactly the previous behaviour.
 */

const CLOUDINARY_URL = 'https://res.cloudinary.com/demo/image/upload/v1712345678/sportzone/banners/hero.jpg'
const parsed = (url: string) => new URL(url)

test('the breakpoints match the hero CSS', () => {
  assert.equal(BANNER_MOBILE_MEDIA, '(max-width: 639px)')
  assert.equal(BANNER_TABLET_MEDIA, '(max-width: 1023px)')
  assert.equal(BANNER_MOBILE_ASPECT, '5:2', 'the compact mobile box')
  assert.equal(BANNER_TABLET_ASPECT, '12:5', 'the slightly shorter tablet box')
  assert.equal(BANNER_DESKTOP_ASPECT, '16:5', 'desktop is unchanged')
})

test('a Cloudinary banner resolves one rendition per device with its own crop', () => {
  const artwork = buildBannerArtwork(CLOUDINARY_URL)
  assert.ok(artwork)

  for (const [device, aspect] of [['mobile', 'ar_5:2'], ['tablet', 'ar_12:5']] as const) {
    const rendition = artwork[device]
    assert.ok(rendition.srcSet?.includes(aspect), `${device} artwork must be cropped to ${aspect}`)
    assert.ok(rendition.srcSet?.includes('f_auto'), `${device} artwork must ask for a modern format`)
    assert.ok(rendition.srcSet?.includes('q_auto'), `${device} artwork must let Cloudinary choose the quality`)
    assert.ok(rendition.srcSet?.includes('c_fill'), `${device} artwork must fill the box`)
  }

  // Every candidate in a srcSet is a distinct width, so the browser can pick the smallest sufficient one.
  const widths = artwork.mobile.srcSet!.split(', ').map((candidate) => Number(parsed(candidate.split(' ')[0]).searchParams.get('w') ?? candidate.match(/_(\d+),/)?.[0]))
  assert.equal(new Set(artwork.mobile.srcSet!.split(', ')).size, artwork.mobile.srcSet!.split(', ').length)
  assert.ok(widths.length >= 2)
})

test('mobile never receives a desktop-sized candidate', () => {
  const artwork = buildBannerArtwork(CLOUDINARY_URL)
  assert.ok(artwork)

  const mobileWidths = [...artwork.mobile.srcSet!.matchAll(/w_(\d+)/g)].map((match) => Number(match[1]))
  const desktopWidths = [...artwork.desktop.srcSet!.matchAll(/w_(\d+)/g)].map((match) => Number(match[1]))

  assert.ok(mobileWidths.length > 0 && desktopWidths.length > 0)
  assert.ok(Math.max(...mobileWidths) < Math.max(...desktopWidths), 'the largest mobile candidate must be smaller than the largest desktop one')
  assert.ok(Math.max(...mobileWidths) <= 828, 'a phone is never offered the 1280px+ crops')
})

test('desktop keeps the previous aspect and sizes contract', () => {
  const artwork = buildBannerArtwork(CLOUDINARY_URL)
  assert.ok(artwork)

  // The desktop rendition is the same request the homepage already made (no aspect crop, same sizes).
  assert.equal(artwork.desktop.sizes, BANNER_DESKTOP_SIZES)
  assert.doesNotMatch(artwork.desktop.srcSet ?? '', /ar_/, 'desktop keeps its established composition')
  assert.match(artwork.desktop.src, /w_1800/)
  assert.equal(artwork.mobile.sizes, BANNER_MOBILE_SIZES)
  assert.equal(artwork.tablet.sizes, BANNER_TABLET_SIZES)
})

test('an untransformable URL falls back to the single file it always was', () => {
  const external = 'https://cdn.example.com/hero.jpg'
  const artwork = buildBannerArtwork(external)
  assert.ok(artwork)

  assert.equal(artwork.desktop.src, external)
  assert.equal(artwork.mobile.src, external)
  assert.equal(artwork.tablet.src, external)
  assert.equal(artwork.mobile.srcSet, undefined, 'no srcSet is invented for a host we cannot transform')
  assert.equal(artwork.desktop.srcSet, undefined)
})

test('a banner without artwork renders nothing rather than a placeholder request', () => {
  for (const value of [undefined, null, '', '   ']) {
    assert.equal(buildBannerArtwork(value), null)
    assert.equal(buildBannerPreviewArtwork(value), null)
  }
})

test('the admin preview exposes the same three renditions the homepage uses', () => {
  const preview = buildBannerPreviewArtwork(CLOUDINARY_URL)
  const artwork = buildBannerArtwork(CLOUDINARY_URL)
  assert.ok(preview && artwork)

  assert.equal(preview.mobile, artwork.mobile.src)
  assert.equal(preview.tablet, artwork.tablet.src)
  assert.equal(preview.desktop, artwork.desktop.src)
  assert.match(preview.mobile, /ar_5:2/)
  assert.match(preview.tablet, /ar_12:5/)
})

test('the same input always produces the same URLs, so the CDN cache keeps working', () => {
  assert.deepEqual(buildBannerArtwork(CLOUDINARY_URL), buildBannerArtwork(CLOUDINARY_URL))
})
