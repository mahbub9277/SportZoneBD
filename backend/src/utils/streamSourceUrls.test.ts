import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveStreamSourceUrls } from './streamSourceUrls.js'

const URL_A = 'https://cdn.example.com/channel.m3u8'
const URL_B = 'https://cdn.example.com/backup.m3u8'

test('a direct stream serves its stored primary and backup URLs', () => {
  assert.deepEqual(
    resolveStreamSourceUrls({ sourceType: 'DIRECT_URL', primaryUrl: URL_A, backupUrl: URL_B }),
    { primaryUrl: URL_A, backupUrl: URL_B, trustedUrls: [URL_A, URL_B] },
  )
})

test('a channel-sourced stream serves its linked channel URL, not the stale copy', () => {
  // The regression: the stream kept playing `primaryUrl` after the channel's URL was corrected.
  const resolved = resolveStreamSourceUrls({
    sourceType: 'CHANNEL',
    primaryUrl: 'https://old.example.com/channel.m3u8',
    backupUrl: URL_B,
    channelUrl: URL_A,
  })

  assert.equal(resolved.primaryUrl, URL_A)
  assert.equal(resolved.backupUrl, URL_B)
  // Both the served URL and the stored copy stay trusted, so the stream's own old URL is still a valid target.
  assert.deepEqual(resolved.trustedUrls, [URL_A, 'https://old.example.com/channel.m3u8', URL_B])
})

test('a channel-sourced stream falls back to its stored copy when the channel has no URL', () => {
  for (const channelUrl of [null, undefined, '', '   ']) {
    const resolved = resolveStreamSourceUrls({ sourceType: 'CHANNEL', primaryUrl: URL_A, backupUrl: null, channelUrl })
    assert.equal(resolved.primaryUrl, URL_A, String(channelUrl))
    assert.equal(resolved.backupUrl, null)
    assert.deepEqual(resolved.trustedUrls, [URL_A])
  }
})

test('a direct stream never adopts a channel URL, and values are trimmed and de-duplicated', () => {
  assert.equal(resolveStreamSourceUrls({ sourceType: 'DIRECT_URL', primaryUrl: URL_A, channelUrl: URL_B }).primaryUrl, URL_A)

  const resolved = resolveStreamSourceUrls({ sourceType: 'DIRECT_URL', primaryUrl: `  ${URL_A}  `, backupUrl: URL_A })
  assert.equal(resolved.primaryUrl, URL_A)
  assert.equal(resolved.backupUrl, URL_A)
  assert.deepEqual(resolved.trustedUrls, [URL_A])

  assert.deepEqual(resolveStreamSourceUrls(null), { primaryUrl: '', backupUrl: null, trustedUrls: [] })
  assert.deepEqual(resolveStreamSourceUrls(undefined), { primaryUrl: '', backupUrl: null, trustedUrls: [] })
  assert.deepEqual(resolveStreamSourceUrls({}), { primaryUrl: '', backupUrl: null, trustedUrls: [] })
})
