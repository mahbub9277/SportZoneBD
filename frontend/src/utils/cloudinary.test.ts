import test from 'node:test'
import assert from 'node:assert/strict'
import { CLOUDINARY_PLACEHOLDER_URL, buildCloudinaryUrlFor } from './cloudinary.ts'

const CLOUD = 'demo-cloud'
const BASE = `https://res.cloudinary.com/${CLOUD}/image/upload`

test('an unusable public id resolves to the local placeholder instead of a failing request', () => {
  assert.equal(buildCloudinaryUrlFor(CLOUD, undefined), CLOUDINARY_PLACEHOLDER_URL)
  assert.equal(buildCloudinaryUrlFor(CLOUD, null), CLOUDINARY_PLACEHOLDER_URL)
  assert.equal(buildCloudinaryUrlFor(CLOUD, ''), CLOUDINARY_PLACEHOLDER_URL)
  assert.equal(buildCloudinaryUrlFor(CLOUD, '   '), CLOUDINARY_PLACEHOLDER_URL)
  assert.equal(buildCloudinaryUrlFor(CLOUD, 'undefined'), CLOUDINARY_PLACEHOLDER_URL)
  assert.equal(buildCloudinaryUrlFor(CLOUD, 'null'), CLOUDINARY_PLACEHOLDER_URL)
  assert.equal(buildCloudinaryUrlFor(CLOUD, '/uploads/undefined/banner.png'), CLOUDINARY_PLACEHOLDER_URL)
})

test('a relative public id is delivered with automatic format and quality', () => {
  assert.equal(
    buildCloudinaryUrlFor(CLOUD, 'sportzone/banners/hero.png'),
    `${BASE}/q_auto,f_auto/sportzone/banners/hero.png`,
  )

  assert.equal(
    buildCloudinaryUrlFor(CLOUD, 'sportzone/banners/hero.png', { width: 640, crop: 'fill', gravity: 'center' }),
    `${BASE}/q_auto,f_auto,w_640,c_fill,g_center/sportzone/banners/hero.png`,
  )
})

test('a repeated parameter is written once, so the same input always yields the same URL', () => {
  const withBoth = buildCloudinaryUrlFor(CLOUD, 'a/b.png', { format: 'auto', fetchFormat: 'auto' })
  assert.equal(withBoth, `${BASE}/q_auto,f_auto/a/b.png`)

  const first = buildCloudinaryUrlFor(CLOUD, 'a/b.png', { width: 96, height: 96, crop: 'fit' })
  const second = buildCloudinaryUrlFor(CLOUD, 'a/b.png', { crop: 'fit', height: 96, width: 96 })
  assert.equal(first, second, 'the key order of the caller does not change the URL')
})

test('an unsaved file preview and an inline image are never rewritten', () => {
  const blob = 'blob:http://localhost:5174/9f1c'
  const data = 'data:image/png;base64,iVBORw0KGgo='
  assert.equal(buildCloudinaryUrlFor(CLOUD, blob), blob)
  assert.equal(buildCloudinaryUrlFor(CLOUD, data), data)
  assert.equal(buildCloudinaryUrlFor(CLOUD, blob, { width: 96 }), blob)
})

test('a URL we do not own is handed back untouched', () => {
  const crest = 'https://crests.football-data.org/583.png'
  assert.equal(buildCloudinaryUrlFor(CLOUD, crest), crest)
  assert.equal(buildCloudinaryUrlFor(CLOUD, `${crest}?x=1`, { width: 96 }), `${crest}?x=1`)
})

test('a Cloudinary URL keeps its version, its public id and its query', () => {
  const url = 'https://res.cloudinary.com/drmqcl0ft/image/upload/v1712345678/sportzone/banners/hero.png'
  assert.equal(
    buildCloudinaryUrlFor(CLOUD, url, { width: 960 }),
    'https://res.cloudinary.com/drmqcl0ft/image/upload/q_auto,f_auto,w_960/v1712345678/sportzone/banners/hero.png',
  )

  const withQuery = `${url}?_a=BAMAK+AA`
  const built = buildCloudinaryUrlFor(CLOUD, withQuery, { width: 960 })
  assert.ok(built.endsWith('/v1712345678/sportzone/banners/hero.png?_a=BAMAK+AA'), built)
})

test('re-running the builder on its own output does not stack two transformations', () => {
  const once = buildCloudinaryUrlFor(
    CLOUD,
    'https://res.cloudinary.com/drmqcl0ft/image/upload/v1712345678/sportzone/banners/hero.png',
    { width: 640, crop: 'fill' },
  )
  const twice = buildCloudinaryUrlFor(CLOUD, once, { width: 640, crop: 'fill' })
  assert.equal(twice, once)
  assert.equal(twice.split('q_auto').length - 1, 1, 'the delivery URL carries one transformation segment')
})

test('a Cloudinary video keeps its resource type, and a foreign transformation is preserved', () => {
  const video = 'https://res.cloudinary.com/drmqcl0ft/video/upload/v1712345678/sportzone/events/promo.mp4'
  assert.match(buildCloudinaryUrlFor(CLOUD, video, { resourceType: 'video', width: 1280 }), /\/video\/upload\/q_auto,f_auto,w_1280\//)

  const handWritten = 'https://res.cloudinary.com/drmqcl0ft/image/upload/e_blur:200/v1712345678/a/b.png'
  const built = buildCloudinaryUrlFor(CLOUD, handWritten, { width: 96 })
  assert.ok(built.includes('/e_blur:200/'), built)
  assert.ok(built.includes('/q_auto,f_auto,w_96/e_blur:200/v1712345678/a/b.png'), built)
})

test('an insecure Cloudinary URL is upgraded to https rather than fetched over http', () => {
  assert.equal(
    buildCloudinaryUrlFor(CLOUD, 'http://res.cloudinary.com/drmqcl0ft/image/upload/a/b.png'),
    'https://res.cloudinary.com/drmqcl0ft/image/upload/q_auto,f_auto/a/b.png',
  )
})

test('without a cloud name a relative id resolves to the placeholder, never to an undefined host', () => {
  assert.equal(buildCloudinaryUrlFor(undefined, 'sportzone/banners/hero.png'), CLOUDINARY_PLACEHOLDER_URL)
  assert.equal(buildCloudinaryUrlFor('', 'sportzone/banners/hero.png'), CLOUDINARY_PLACEHOLDER_URL)

  // A complete URL still works: it does not need the cloud name to be rewritten.
  assert.equal(
    buildCloudinaryUrlFor(undefined, 'https://res.cloudinary.com/drmqcl0ft/image/upload/v1/a.png', { width: 64 }),
    'https://res.cloudinary.com/drmqcl0ft/image/upload/q_auto,f_auto,w_64/v1/a.png',
  )
})
