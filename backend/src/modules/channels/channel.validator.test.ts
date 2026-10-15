import assert from 'node:assert/strict'
import test from 'node:test'
import { channelSchema, channelUpdateSchema } from './channel.validator.js'
import { parseBooleanFlag } from '../../core/validation.js'

const CATEGORY_ID = '3f2504e0-4f89-11d3-9a0c-0305e82c3301'

test('the payload the admin channel form sends is accepted, including its premium flag', () => {
  const created = channelSchema.parse({
    name: 'Bangla Vision',
    url: 'http://stream.mcquack.net/234/index.m3u8',
    viewers: 1280,
    categoryId: CATEGORY_ID,
    isPremium: true,
    status: 'active',
    logo: 'https://res.cloudinary.com/demo/image/upload/v1/logo.png',
  })

  assert.equal(created.url, 'http://stream.mcquack.net/234/index.m3u8')
  assert.equal(created.isPremium, true)
  assert.equal(created.viewers, 1280)
})

test('the premium flag is read from a JSON boolean and from a form-encoded string alike', () => {
  // Regression: the controller compared the body against the *string* `'true'`, so the boolean the admin
  // form sends saved every channel as non-premium and cleared the flag on every edit.
  for (const isPremium of [true, 'true', 'TRUE', ' true ']) {
    assert.equal(channelSchema.parse({ name: 'c', url: 'https://cdn.example.com/a.m3u8', categoryId: CATEGORY_ID, status: 'active', isPremium }).isPremium, true)
  }
  for (const isPremium of [false, 'false', 'FALSE', '0', '']) {
    assert.equal(channelSchema.parse({ name: 'c', url: 'https://cdn.example.com/a.m3u8', categoryId: CATEGORY_ID, status: 'active', isPremium }).isPremium, false)
  }

  assert.equal(parseBooleanFlag(true), true)
  assert.equal(parseBooleanFlag('true'), true)
  assert.equal(parseBooleanFlag('false'), false)
  assert.equal(parseBooleanFlag(undefined), false)
  assert.equal(parseBooleanFlag('1'), false)
})

test('a channel playback URL is validated without ever being rewritten', () => {
  for (const url of ['not a url', 'ftp://stream.example.com/234/index.m3u8', 'file:///etc/passwd', '//stream.example.com/a.m3u8']) {
    assert.equal(channelSchema.safeParse({ name: 'c', url, categoryId: CATEGORY_ID, status: 'active' }).success, false, url)
  }

  assert.equal(
    channelSchema.parse({ name: 'c', url: 'http://stream.mcquack.net/234/index.m3u8', categoryId: CATEGORY_ID, status: 'active' }).url,
    'http://stream.mcquack.net/234/index.m3u8',
  )
})

test('a channel update may change only the url, and viewers accepts an empty value', () => {
  // The stream form updates a linked channel's URL and nothing else.
  assert.deepEqual(channelUpdateSchema.parse({ url: 'https://cdn.example.com/channel.m3u8' }), { url: 'https://cdn.example.com/channel.m3u8' })
  assert.deepEqual(channelUpdateSchema.parse({ viewers: '' }), { viewers: null })
  assert.deepEqual(channelUpdateSchema.parse({ viewers: 25 }), { viewers: 25 })
  assert.equal(channelUpdateSchema.parse({}).constructor, Object)
  assert.deepEqual(channelUpdateSchema.parse({}), {})
  assert.equal(channelUpdateSchema.safeParse({ viewers: -5 }).success, false)
  assert.equal(channelUpdateSchema.safeParse({ url: '' }).success, false)
})
