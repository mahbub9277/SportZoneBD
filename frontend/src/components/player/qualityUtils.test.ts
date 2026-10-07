import test from 'node:test'
import assert from 'node:assert/strict'
import { buildVodQualityLevels, isCloudinaryVideoUrl } from './qualityUtils.ts'

test('cloudinary video delivery urls are transformable', () => {
  assert.equal(
    isCloudinaryVideoUrl('https://res.cloudinary.com/demo/video/upload/v1788688724/sportzone/highlights/goal.mp4'),
    true,
  )
  assert.equal(isCloudinaryVideoUrl('https://res.cloudinary.com/demo/video/upload/h_720/highlights/goal.webm'), true)
})

test('non-cloudinary or non-video sources are never treated as transformable', () => {
  assert.equal(isCloudinaryVideoUrl('https://cdn.example.com/highlights/goal.mp4'), false)
  assert.equal(isCloudinaryVideoUrl('https://res.cloudinary.com/demo/image/upload/v1/sportzone/logo.png'), false)
  assert.equal(isCloudinaryVideoUrl('/api/v1/stream/proxy?streamId=abc&url=https%3A%2F%2Fcdn.example.com%2Fa.m3u8'), false)
  assert.equal(isCloudinaryVideoUrl('sportzone/highlights/goal'), false)
  assert.equal(isCloudinaryVideoUrl(''), false)
  assert.equal(isCloudinaryVideoUrl(null), false)
  assert.equal(isCloudinaryVideoUrl(undefined), false)
})

test('quality options never exceed the delivered source height', () => {
  assert.deepEqual(
    buildVodQualityLevels(1080).map((level) => level.height),
    [144, 240, 360, 480, 720, 1080],
  )
  assert.deepEqual(
    buildVodQualityLevels(720).map((level) => level.height),
    [144, 240, 360, 480, 720],
  )
  assert.deepEqual(
    buildVodQualityLevels(480).map((level) => level.height),
    [144, 240, 360, 480],
  )
  // A non-standard source height still offers only resolutions it can really deliver.
  assert.deepEqual(
    buildVodQualityLevels(540).map((level) => level.height),
    [144, 240, 360, 480],
  )
  assert.deepEqual(
    buildVodQualityLevels(240).map((level) => level.height),
    [144, 240],
  )
  assert.deepEqual(buildVodQualityLevels(144).map((level) => level.height), [144])
  assert.deepEqual(buildVodQualityLevels(120), [])
})

test('an unknown source height offers no quality options instead of guessed ones', () => {
  assert.deepEqual(buildVodQualityLevels(0), [])
  assert.deepEqual(buildVodQualityLevels(-1), [])
  assert.deepEqual(buildVodQualityLevels(Number.NaN), [])
  assert.deepEqual(buildVodQualityLevels(Number.POSITIVE_INFINITY), [])
})

test('quality levels are uniquely indexed for the settings menu', () => {
  const levels = buildVodQualityLevels(1080)

  assert.deepEqual(levels.map((level) => level.hlsIndex), [0, 1, 2, 3, 4, 5])
  assert.equal(new Set(levels.map((level) => level.height)).size, levels.length)
})
