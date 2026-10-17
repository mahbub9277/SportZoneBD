import assert from 'node:assert/strict'
import test from 'node:test'
import { rewriteManifestBody } from './streamManifest.js'


test('a relay mapping replaces only the resources it claims, and only when asked', () => {
  const manifest = [
    '#EXTM3U',
    '#EXT-X-KEY:METHOD=AES-128,URI="keys/key.bin?token=k"',
    'nested/variant.m3u8?quality=720',
    'http://insecure.example.com/live/segment.ts?token=s',
    'https://secure.example.com/live/segment.ts',
  ].join('\n')

  const relayed = rewriteManifestBody(manifest, 'http://insecure.example.com/live/master.m3u8', {
    relayHref: (resourceUrl) => resourceUrl.startsWith('http://insecure.example.com/')
      ? `/api/v1/stream/relay?path=${encodeURIComponent(new URL(resourceUrl).pathname + new URL(resourceUrl).search)}`
      : null,
  })

  assert.deepEqual(relayed.split('\n'), [
    '#EXTM3U',
    '#EXT-X-KEY:METHOD=AES-128,URI="/api/v1/stream/relay?path=%2Flive%2Fkeys%2Fkey.bin%3Ftoken%3Dk"',
    '/api/v1/stream/relay?path=%2Flive%2Fnested%2Fvariant.m3u8%3Fquality%3D720',
    '/api/v1/stream/relay?path=%2Flive%2Fsegment.ts%3Ftoken%3Ds',
    // A resource the mapping does not claim keeps the provider's own absolute URL.
    'https://secure.example.com/live/segment.ts',
  ])
})

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