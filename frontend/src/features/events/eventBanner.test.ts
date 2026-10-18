import assert from 'node:assert/strict'
import test from 'node:test'
import {
  EVENT_BANNER_WIDTHS,
  buildEventBannerSrc,
  buildEventBannerSrcSet,
} from './eventBanner.ts'

const STORED_BANNER = 'https://res.cloudinary.com/demo/image/upload/v1723456/sportzone/events/banner.webp'

test('the hero src keeps the exact request the page already made', () => {
  const src = buildEventBannerSrc(STORED_BANNER)

  assert.match(src, /^https:\/\/res\.cloudinary\.com\/demo\/image\/upload\//)
  assert.match(src, /w_1600/)
  assert.match(src, /h_500/)
  assert.match(src, /c_fill/)
  assert.match(src, /g_center/)
  assert.ok(src.endsWith('/sportzone/events/banner.webp'))
})

test('the src set offers one 16:5 candidate per width', () => {
  const srcSet = buildEventBannerSrcSet(STORED_BANNER)

  assert.ok(srcSet)
  const candidates = srcSet.split(', ')
  assert.equal(candidates.length, EVENT_BANNER_WIDTHS.length)

  EVENT_BANNER_WIDTHS.forEach((width, index) => {
    const [url, descriptor] = candidates[index].split(' ')
    assert.equal(descriptor, `${width}w`)
    assert.match(url, new RegExp(`w_${width}`))
    assert.match(url, new RegExp(`h_${Math.round((width * 5) / 16)}`))
    assert.match(url, /c_fill/)
  })
})

test('a URL that cannot be transformed renders without a src set', () => {
  assert.equal(buildEventBannerSrcSet('https://cdn.example.com/banner.webp'), undefined)
  assert.equal(buildEventBannerSrcSet('blob:https://app.example/1234'), undefined)
  assert.equal(buildEventBannerSrcSet(''), undefined)
  assert.equal(buildEventBannerSrcSet(null), undefined)
})

test('a missing banner resolves to the local placeholder instead of a broken Cloudinary request', () => {
  assert.equal(buildEventBannerSrc(null), '/placeholder-image.svg')
})
