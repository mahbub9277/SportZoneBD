import assert from 'node:assert/strict'
import test from 'node:test'
import {
  getImageUploadPolicy,
  prepareUploadFile,
  validateImageUploadSource,
  type ImageUploadPurpose,
} from './prepareUploadImage.ts'

const expectedPolicies: Record<ImageUploadPurpose, [number, number, number | null]> = {
  'highlight-image': [1600, 1600, 5],
  'banner-image': [1920, 1920, 10],
  'banner-poster': [1920, 1920, 10],
  'advertisement-image': [1920, 1920, null],
  'event-logo': [1024, 1024, 5],
  'event-banner': [1920, 1920, 5],
  'popup-image': [1920, 1920, 5],
  'team-logo': [1024, 1024, 5],
  'stream-logo': [1024, 1024, 5],
  'channel-logo': [1024, 1024, 5],
  'channel-category-logo': [1024, 1024, 5],
}

test('every admin image purpose has the requested dimensions and existing input-size limit', () => {
  for (const [purpose, [width, height, maxMegabytes]] of Object.entries(expectedPolicies) as [ImageUploadPurpose, [number, number, number | null]][]) {
    const policy = getImageUploadPolicy(purpose)
    assert.deepEqual([policy.maxWidth, policy.maxHeight], [width, height], purpose)
    assert.equal(policy.maxInputBytes ?? null, maxMegabytes === null ? null : maxMegabytes * 1024 * 1024, purpose)
  }
  assert.equal(getImageUploadPolicy('advertisement-image').cropAspectRatio, 4)
})

test('image source MIME and original size are validated before conversion', () => {
  const policy = getImageUploadPolicy('highlight-image')
  assert.equal(validateImageUploadSource({ type: 'image/jpeg', size: 1024 }, 'highlight-image'), policy)
  assert.equal(policy.maxInputBytes, 5 * 1024 * 1024)
  assert.throws(
    () => validateImageUploadSource({ type: 'image/gif', size: 1024 }, 'highlight-image'),
    /JPEG, PNG, or WebP/,
  )
  assert.throws(
    () => validateImageUploadSource({ type: 'image/png', size: 5 * 1024 * 1024 + 1 }, 'highlight-image'),
    /5 MB/,
  )
  assert.doesNotThrow(
    () => validateImageUploadSource({ type: 'image/jpeg', size: 25 * 1024 * 1024 }, 'advertisement-image'),
  )
})

test('video uploads bypass image decoding and preserve the original file', async () => {
  const video = new globalThis.File(['unchanged video bytes'], 'clip.mp4', { type: 'video/mp4' })
  assert.equal(await prepareUploadFile(video, 'highlight-video'), video)
})
