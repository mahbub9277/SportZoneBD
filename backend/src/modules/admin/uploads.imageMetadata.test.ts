import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isCloudinaryResourceMetadataValid, uploadPolicies } from './uploads.controller.js'

const CLOUD_NAME = 'sportzone-test'

const imageDimensionLimits: Record<string, [number, number]> = {
  'highlight-image': [1600, 1600],
  'banner-image': [1920, 1920],
  'banner-poster': [1920, 1920],
  'advertisement-image': [1920, 1920],
  'event-logo': [1024, 1024],
  'event-banner': [1920, 1920],
  'popup-image': [1920, 1920],
  'team-logo': [1024, 1024],
  'stream-logo': [1024, 1024],
  'channel-logo': [1024, 1024],
  'channel-category-logo': [1024, 1024],
}

function imageMetadata(purpose: keyof typeof uploadPolicies) {
  const policy = uploadPolicies[purpose]
  const publicId = `${policy.folder}/upload-test`
  const version = 123
  return {
    expected: { cloudName: CLOUD_NAME, mimeType: 'image/webp', policy, publicId, version },
    resource: {
      asset_folder: policy.folder,
      bytes: 120_000,
      format: 'webp',
      height: Number(policy.maxHeight),
      public_id: publicId,
      resource_type: 'image',
      secure_url: `https://res.cloudinary.com/${CLOUD_NAME}/image/upload/v${version}/${publicId}.webp`,
      version,
      width: Number(policy.maxWidth),
    },
  }
}

test('every admin image purpose requires WebP and its specific dimension limits', () => {
  const actualImagePurposes = Object.entries(uploadPolicies)
    .filter(([, policy]) => policy.resourceType === 'image')
    .map(([purpose]) => purpose)
    .sort()
  assert.deepEqual(actualImagePurposes, Object.keys(imageDimensionLimits).sort())

  for (const [purpose, [width, height]] of Object.entries(imageDimensionLimits)) {
    const policy = uploadPolicies[purpose as keyof typeof uploadPolicies]
    assert.deepEqual([policy.maxWidth, policy.maxHeight], [width, height], purpose)
    assert.deepEqual(policy.mimeTypes, ['image/webp'], purpose)
  }
})

test('Cloudinary metadata enforces each image purpose dimension limit', () => {
  for (const purpose of Object.keys(imageDimensionLimits) as (keyof typeof uploadPolicies)[]) {
    const { expected, resource } = imageMetadata(purpose)
    assert.equal(isCloudinaryResourceMetadataValid(resource, expected), true, purpose)
    assert.equal(isCloudinaryResourceMetadataValid({ ...resource, width: Number(resource.width) + 1 }, expected), false, purpose)
    assert.equal(isCloudinaryResourceMetadataValid({ ...resource, height: Number(resource.height) + 1 }, expected), false, purpose)
  }
})

test('Cloudinary image metadata must match the WebP format, folder, and secure URL', () => {
  const { expected, resource } = imageMetadata('team-logo')
  assert.equal(isCloudinaryResourceMetadataValid({ ...resource, format: 'png' }, expected), false)
  assert.equal(isCloudinaryResourceMetadataValid({ ...resource, asset_folder: 'sportzone/other' }, expected), false)
  assert.equal(isCloudinaryResourceMetadataValid({ ...resource, height: undefined }, expected), false)
  assert.equal(isCloudinaryResourceMetadataValid({ ...resource, secure_url: resource.secure_url.replace('.webp', '.png') }, expected), false)
})

test('video metadata keeps its existing format and dimension behavior', () => {
  const policy = uploadPolicies['highlight-video']
  const publicId = `${policy.folder}/clip`
  const version = 123
  const resource = {
    bytes: 2_000_000,
    format: 'mp4',
    public_id: publicId,
    resource_type: 'video',
    secure_url: `https://res.cloudinary.com/${CLOUD_NAME}/video/upload/v${version}/${publicId}.mp4`,
    version,
  }

  assert.equal(isCloudinaryResourceMetadataValid(resource, {
    cloudName: CLOUD_NAME,
    mimeType: 'video/mp4',
    policy,
    publicId,
    version,
  }), true)
  assert.equal(isCloudinaryResourceMetadataValid({ ...resource, asset_folder: 'sportzone/other' }, {
    cloudName: CLOUD_NAME,
    mimeType: 'video/mp4',
    policy,
    publicId,
    version,
  }), false)
})
