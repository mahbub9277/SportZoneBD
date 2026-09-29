import assert from 'node:assert/strict'
import test from 'node:test'
import { rewriteManifestBody } from './streamManifest.js'

test('resolves nested playlists, absolute segments, URI attributes, and query strings', () => {
  const manifest = [
    '#EXTM3U',
    '#EXT-X-KEY:METHOD=AES-128,URI="keys/key.bin?token=key-value"',
    '#EXT-X-MAP:URI="../init.mp4?token=map-value"',
    'nested/variant.m3u8?quality=720',
    'https://media.example.com/live/segment.ts?token=segment-value',
  ].join('\n')

  assert.equal(rewriteManifestBody(manifest, 'https://media.example.com/live/master.m3u8?session=1'), [
    '#EXTM3U',
    '#EXT-X-KEY:METHOD=AES-128,URI="https://media.example.com/live/keys/key.bin?token=key-value"',
    '#EXT-X-MAP:URI="https://media.example.com/init.mp4?token=map-value"',
    'https://media.example.com/live/nested/variant.m3u8?quality=720',
    'https://media.example.com/live/segment.ts?token=segment-value',
  ].join('\n'))
})