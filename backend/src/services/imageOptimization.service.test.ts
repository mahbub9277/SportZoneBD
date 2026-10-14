import assert from 'node:assert/strict'
import { test } from 'node:test'
import sharp from 'sharp'
import { ValidationError } from '../core/errors.js'
import {
  MAX_AVATAR_BYTES,
  MAX_AVATAR_DIMENSION,
  MAX_IMAGE_INPUT_PIXELS,
  isWithinImagePixelLimit,
  optimizeAvatarImage,
} from './imageOptimization.service.js'

const makeRgbImage = (width: number, height: number) => sharp({
  create: { width, height, channels: 3, background: { r: 40, g: 120, b: 210 } },
})

test('JPEG, PNG, and WebP inputs are stored as genuine WebP output', async () => {
  const jpeg = await makeRgbImage(80, 40).jpeg().toBuffer()
  const png = await makeRgbImage(80, 40).png().toBuffer()
  const webp = await makeRgbImage(80, 40).webp().toBuffer()

  for (const [source, mimeType] of [
    [jpeg, 'image/jpeg'],
    [png, 'image/png'],
    [webp, 'image/webp'],
  ] as const) {
    const output = await optimizeAvatarImage(source, mimeType)
    const metadata = await sharp(output).metadata()
    assert.equal(metadata.format, 'webp')
    assert.equal(output.toString('ascii', 0, 4), 'RIFF')
    assert.equal(output.toString('ascii', 8, 12), 'WEBP')
  }
})

test('avatars are resized proportionally and smaller images are not enlarged', async () => {
  const large = await makeRgbImage(4000, 2000).jpeg().toBuffer()
  const optimizedLarge = await optimizeAvatarImage(large, 'image/jpeg')
  const largeMetadata = await sharp(optimizedLarge).metadata()
  assert.deepEqual([largeMetadata.width, largeMetadata.height], [MAX_AVATAR_DIMENSION, MAX_AVATAR_DIMENSION / 2])

  const small = await makeRgbImage(80, 40).png().toBuffer()
  const optimizedSmall = await optimizeAvatarImage(small, 'image/png')
  const smallMetadata = await sharp(optimizedSmall).metadata()
  assert.deepEqual([smallMetadata.width, smallMetadata.height], [80, 40])
})

test('EXIF orientation is normalized and transparent PNG pixels remain transparent', async () => {
  const orientedJpeg = await makeRgbImage(40, 20).jpeg().withMetadata({ orientation: 6 }).toBuffer()
  const optimizedOriented = await optimizeAvatarImage(orientedJpeg, 'image/jpeg')
  const orientedMetadata = await sharp(optimizedOriented).metadata()
  assert.deepEqual([orientedMetadata.width, orientedMetadata.height], [20, 40])
  assert.equal(orientedMetadata.orientation, undefined)

  const transparentPng = await sharp({
    create: { width: 20, height: 10, channels: 4, background: { r: 10, g: 20, b: 30, alpha: 0 } },
  }).png().toBuffer()
  const optimizedTransparent = await optimizeAvatarImage(transparentPng, 'image/png')
  assert.equal((await sharp(optimizedTransparent).metadata()).hasAlpha, true)
})

test('high-entropy avatars remain below the 512 KiB stored-size ceiling', async () => {
  const width = 900
  const height = 900
  const raw = Buffer.alloc(width * height * 4)
  let seed = 1
  for (let index = 0; index < raw.length; index += 1) {
    seed = (seed * 1_664_525 + 1_013_904_223) >>> 0
    raw[index] = seed >>> 24
  }
  const noisyPng = await sharp(raw, { raw: { width, height, channels: 4 } })
    .png({ compressionLevel: 1 })
    .toBuffer()

  const output = await optimizeAvatarImage(noisyPng, 'image/png')
  assert.ok(output.length <= MAX_AVATAR_BYTES)
  const metadata = await sharp(output).metadata()
  assert.ok(Number(metadata.width) <= MAX_AVATAR_DIMENSION)
  assert.ok(Number(metadata.height) <= MAX_AVATAR_DIMENSION)
})

test('invalid, unsupported, spoofed, and excessive-pixel inputs are rejected', async () => {
  await assert.rejects(
    optimizeAvatarImage(Buffer.from('not an image'), 'image/jpeg'),
    (error: unknown) => error instanceof ValidationError && error.statusCode === 400,
  )

  const png = await makeRgbImage(12, 8).png().toBuffer()
  await assert.rejects(
    optimizeAvatarImage(png, 'image/jpeg'),
    (error: unknown) => error instanceof ValidationError && error.statusCode === 400,
  )
  await assert.rejects(
    optimizeAvatarImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'), 'image/svg+xml'),
    (error: unknown) => error instanceof ValidationError && error.statusCode === 400,
  )

  assert.equal(isWithinImagePixelLimit(8000, 5000), true)
  assert.equal(isWithinImagePixelLimit(8000, 5001), false)
  assert.equal(isWithinImagePixelLimit(undefined, 100), false)
  assert.ok(MAX_IMAGE_INPUT_PIXELS > 0)
})
