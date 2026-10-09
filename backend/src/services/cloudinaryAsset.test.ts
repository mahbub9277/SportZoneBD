import assert from 'node:assert/strict'
import test from 'node:test'
import { parseCloudinaryAssetReference } from './cloudinaryAsset.js'

test('a stored delivery URL reduces to its public id and resource type', () => {
  assert.deepEqual(
    parseCloudinaryAssetReference('https://res.cloudinary.com/drmqcl0ft/image/upload/v1712345678/sportzone/banners/hero.png'),
    { publicId: 'sportzone/banners/hero', resourceType: 'image' },
  )
})

test('a transformation without a version is not mistaken for part of the public id', () => {
  assert.deepEqual(
    parseCloudinaryAssetReference('https://res.cloudinary.com/drmqcl0ft/image/upload/q_auto,f_auto,w_640,c_fill/sportzone/banners/hero.png'),
    { publicId: 'sportzone/banners/hero', resourceType: 'image' },
  )

  assert.deepEqual(
    parseCloudinaryAssetReference('https://res.cloudinary.com/drmqcl0ft/image/upload/q_auto,f_auto,w_640/v1712345678/sportzone/banners/hero.webp'),
    { publicId: 'sportzone/banners/hero', resourceType: 'image' },
  )
})

test('a video keeps its resource type, so the delete reaches the asset that exists', () => {
  assert.deepEqual(
    parseCloudinaryAssetReference('https://res.cloudinary.com/drmqcl0ft/video/upload/v1/sportzone/highlights/gcwiz3pxh7ttx3opowqy'),
    { publicId: 'sportzone/highlights/gcwiz3pxh7ttx3opowqy', resourceType: 'video' },
  )

  assert.deepEqual(
    parseCloudinaryAssetReference('https://res.cloudinary.com/drmqcl0ft/raw/upload/v1/sportzone/manifests/master.m3u8'),
    { publicId: 'sportzone/manifests/master', resourceType: 'raw' },
  )
})

test('a query string never ends up inside the public id', () => {
  assert.deepEqual(
    parseCloudinaryAssetReference('https://res.cloudinary.com/drmqcl0ft/image/upload/v1/sportzone/highlights/f1wxliilqlrhpzbpdfki?_a=BAMCr6kS0'),
    { publicId: 'sportzone/highlights/f1wxliilqlrhpzbpdfki', resourceType: 'image' },
  )
})

test('a bare public id is accepted, with or without a file extension', () => {
  assert.deepEqual(parseCloudinaryAssetReference('sportzone/channels/qths63kefge2wo6mpgyy.png'), {
    publicId: 'sportzone/channels/qths63kefge2wo6mpgyy',
    resourceType: 'image',
  })

  assert.deepEqual(parseCloudinaryAssetReference('/sportzone/stream-logos/abc123'), {
    publicId: 'sportzone/stream-logos/abc123',
    resourceType: 'image',
  })

  assert.deepEqual(parseCloudinaryAssetReference('video/sportzone/events/promo.mp4'), {
    publicId: 'sportzone/events/promo',
    resourceType: 'video',
  })
})

test('a public id that merely looks like a transformation is preserved', () => {
  // The last path segment is never skipped, so a name such as `w_banner` cannot be trimmed away.
  assert.deepEqual(parseCloudinaryAssetReference('https://res.cloudinary.com/x/image/upload/w_banner'), {
    publicId: 'w_banner',
    resourceType: 'image',
  })

  assert.deepEqual(parseCloudinaryAssetReference('https://res.cloudinary.com/x/image/upload/v1/hero_banner'), {
    publicId: 'hero_banner',
    resourceType: 'image',
  })

  assert.deepEqual(parseCloudinaryAssetReference('sportzone/events/pre_start_video'), {
    publicId: 'sportzone/events/pre_start_video',
    resourceType: 'image',
  })
})

test('a reference that cannot be deleted is reported as null instead of a doomed request', () => {
  assert.equal(parseCloudinaryAssetReference(null), null)
  assert.equal(parseCloudinaryAssetReference(undefined), null)
  assert.equal(parseCloudinaryAssetReference(''), null)
  assert.equal(parseCloudinaryAssetReference('   '), null)
  assert.equal(parseCloudinaryAssetReference('undefined'), null)
  assert.equal(parseCloudinaryAssetReference('https://example.test/not-cloudinary.png'), null)
  assert.equal(parseCloudinaryAssetReference('https://res.cloudinary.com/x/image/fetch/https://example.test/a.png'), null)
})
