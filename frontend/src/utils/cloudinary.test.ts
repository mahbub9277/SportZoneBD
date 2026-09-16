import test from 'node:test'
import assert from 'node:assert/strict'
import { buildCloudinaryUrl } from './cloudinary.ts'

test('buildCloudinaryUrl rewrites raw Cloudinary URLs to image URLs', () => {
  const url = buildCloudinaryUrl('https://res.cloudinary.com/demo/raw/upload/v12345/sportzone/channels/logo', { width: 64, height: 64, crop: 'fill' })
  assert.equal(url, 'https://res.cloudinary.com/demo/image/upload/q_auto,f_auto,w_64,h_64,c_fill/v12345/sportzone/channels/logo')
})

test('buildCloudinaryUrl returns a placeholder for empty values', () => {
  assert.equal(buildCloudinaryUrl(''), '/placeholder-image.svg')
})
