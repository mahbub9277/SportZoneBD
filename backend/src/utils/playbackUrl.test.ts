import assert from 'node:assert/strict'
import test from 'node:test'
import { optionalPlaybackUrlSchema, playbackUrlOrEmptySchema, playbackUrlSchema } from './playbackUrl.js'

test('both provider-supported protocols are accepted without being rewritten', () => {
  const https = 'https://cdn.example.com/live/index.m3u8'
  const http = 'http://stream.example.com:8080/234/index.m3u8?token=abc'

  assert.equal(playbackUrlSchema.parse(https), https)
  assert.equal(playbackUrlSchema.parse(http), http)
  // Trimmed, never upgraded: converting the scheme would hide the mixed-content failure instead of fixing it.
  assert.equal(playbackUrlSchema.parse(`  ${http}  `), http)
})

test('malformed or unsupported playback URLs are rejected', () => {
  const rejected = [
    '', '   ', 'not a url', 'cdn.example.com/live.m3u8', '//cdn.example.com/live.m3u8',
    'ftp://cdn.example.com/live.m3u8', 'file:///etc/passwd', 'data:application/vnd.apple.mpegurl;base64,AA',
    'javascript:alert(1)', 'blob:https://sport-zone-bd.vercel.app/x', `https://cdn.example.com/${'a'.repeat(2100)}`,
  ]

  for (const value of rejected) {
    assert.equal(playbackUrlSchema.safeParse(value).success, false, `expected rejection of ${value.slice(0, 40)}`)
  }

  for (const value of [null, undefined, 42, {}]) {
    assert.equal(playbackUrlSchema.safeParse(value).success, false, `expected rejection of ${String(value)}`)
  }
})

test('an optional playback URL treats an empty value as absent, not as a URL', () => {
  for (const value of ['', null, undefined]) {
    const result = optionalPlaybackUrlSchema.parse(value)
    assert.equal(result ?? null, null, `expected ${String(value)} to be no value`)
  }

  assert.equal(optionalPlaybackUrlSchema.parse('https://cdn.example.com/a.m3u8'), 'https://cdn.example.com/a.m3u8')
  assert.equal(optionalPlaybackUrlSchema.safeParse('ftp://cdn.example.com/a.m3u8').success, false)
})

test('an empty primary is still allowed for a channel-sourced stream', () => {
  assert.equal(playbackUrlOrEmptySchema.parse(''), '')
  assert.equal(playbackUrlOrEmptySchema.parse(undefined), undefined)
  assert.equal(playbackUrlOrEmptySchema.parse('http://stream.example.com/234/index.m3u8'), 'http://stream.example.com/234/index.m3u8')
  assert.equal(playbackUrlOrEmptySchema.safeParse('not a url').success, false)
})
