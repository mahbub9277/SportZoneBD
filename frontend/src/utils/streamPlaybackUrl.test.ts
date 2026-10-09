import test from 'node:test'
import assert from 'node:assert/strict'
import { buildHlsPlaybackUrl } from './streamPlaybackUrl.ts'

const CHANNEL_URL = 'https://cdn.example.com/banglavision/index.m3u8'

test('a source without a stream id is played directly', () => {
  // Channel playback (normal channel page and TV Mode) has no stream record, so no proxy is built.
  assert.equal(buildHlsPlaybackUrl({ url: CHANNEL_URL, usedBackup: false, forceDirectUrl: false }), CHANNEL_URL)
  assert.equal(buildHlsPlaybackUrl({ url: CHANNEL_URL, streamId: null, usedBackup: false, forceDirectUrl: false }), CHANNEL_URL)
})

test('a stream record is proxied with its stream id and primary/backup type', () => {
  const primary = buildHlsPlaybackUrl({ url: CHANNEL_URL, streamId: 'stream-1', usedBackup: false, forceDirectUrl: false })
  assert.equal(primary, `/api/v1/stream/proxy?streamId=stream-1&type=primary&url=${encodeURIComponent(CHANNEL_URL)}`)

  const backup = buildHlsPlaybackUrl({ url: CHANNEL_URL, streamId: 'stream-1', usedBackup: true, forceDirectUrl: false })
  assert.equal(backup, `/api/v1/stream/proxy?streamId=stream-1&type=backup&url=${encodeURIComponent(CHANNEL_URL)}`)
})

test('the direct-url fallback drops the proxy even for a stream record', () => {
  assert.equal(
    buildHlsPlaybackUrl({ url: CHANNEL_URL, streamId: 'stream-1', usedBackup: true, forceDirectUrl: true }),
    CHANNEL_URL,
  )
})

test('no url means no playback url at all', () => {
  assert.equal(buildHlsPlaybackUrl({ url: null, streamId: 'stream-1', usedBackup: false, forceDirectUrl: false }), null)
  assert.equal(buildHlsPlaybackUrl({ url: undefined, usedBackup: false, forceDirectUrl: false }), null)
})

test('the proxy url never carries a parameter other than streamId, type and url', () => {
  const proxied = buildHlsPlaybackUrl({ url: CHANNEL_URL, streamId: 'stream-1', usedBackup: false, forceDirectUrl: false })
  const params = new URLSearchParams(proxied!.split('?')[1])
  assert.deepEqual([...params.keys()].sort(), ['streamId', 'type', 'url'])
})

test('a request whose url is a channel manifest still carries only the stream id', () => {
  // Regression guard for the TV Mode bug: a channel UUID sent as `streamId` produced a 404 for every
  // channel tune (primary and backup), so the identity has to be a stream record — never a channel id.
  const proxied = buildHlsPlaybackUrl({
    url: 'https://cdn.example.com/banglavision/index.m3u8',
    streamId: '11111111-2222-4333-8444-555555555555',
    usedBackup: false,
    forceDirectUrl: false,
  })
  assert.ok(proxied?.startsWith('/api/v1/stream/proxy?'))
  assert.equal(new URLSearchParams(proxied!.split('?')[1]).get('streamId'), '11111111-2222-4333-8444-555555555555')
  assert.equal(new URLSearchParams(proxied!.split('?')[1]).get('channelId'), null)
})
