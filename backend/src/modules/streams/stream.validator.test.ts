import assert from 'node:assert/strict'
import test from 'node:test'
import { streamSchema, streamUpdateSchema } from './stream.validator.js'

const MATCH_ID = '3f2504e0-4f89-11d3-9a0c-0305e82c3301'
const CHANNEL_ID = '5cb5bb79-a18d-447d-ad2c-81c92be81312'

test('the payload the admin stream form sends is accepted', () => {
  const created = streamSchema.parse({
    matchId: MATCH_ID,
    name: 'Main stream',
    primaryUrl: 'https://cdn.example.com/live/index.m3u8',
    backupUrl: 'http://backup.example.com/live/index.m3u8',
    matchId2: undefined,
    enabled: true,
    quality: '1080p',
    status: 'READY',
    sourceType: 'DIRECT_URL',
    channelId: '',
    activationMode: 'AUTOMATIC',
    activationOffsetMinutes: 0,
  } as never)

  assert.equal(created.primaryUrl, 'https://cdn.example.com/live/index.m3u8')
  assert.equal(created.backupUrl, 'http://backup.example.com/live/index.m3u8')
  assert.equal(created.channelId, null)
  assert.equal(created.enabled, true)
})

test('a channel-sourced stream may leave its primary empty and must link a real channel', () => {
  const created = streamSchema.parse({
    matchId: MATCH_ID,
    name: 'Channel stream',
    sourceType: 'CHANNEL',
    channelId: CHANNEL_ID,
    primaryUrl: '',
  })

  assert.equal(created.primaryUrl, '')
  assert.equal(created.channelId, CHANNEL_ID)
  assert.equal(streamSchema.safeParse({ matchId: MATCH_ID, name: 'Live', channelId: 'not-a-uuid' }).success, false)
})

test('malformed or unsupported playback URLs never enter the pipeline', () => {
  const rejected = [
    'not a url',
    'ftp://cdn.example.com/live.m3u8',
    'file:///etc/passwd',
    'javascript:alert(1)',
    '//cdn.example.com/live.m3u8',
    `https://cdn.example.com/${'a'.repeat(2100)}`,
  ]

  for (const primaryUrl of rejected) {
    assert.equal(streamSchema.safeParse({ matchId: MATCH_ID, name: 'Live', primaryUrl }).success, false, primaryUrl.slice(0, 30))
    assert.equal(streamSchema.safeParse({ matchId: MATCH_ID, name: 'Live', primaryUrl: 'https://ok.example.com/a.m3u8', backupUrl: primaryUrl }).success, false, primaryUrl.slice(0, 30))
  }

  // Both provider-supported schemes stay accepted, and an empty backup means "no backup".
  assert.equal(streamSchema.parse({ matchId: MATCH_ID, name: 'Live', primaryUrl: 'http://stream.example.com/234/index.m3u8' }).primaryUrl, 'http://stream.example.com/234/index.m3u8')
  assert.equal(streamSchema.parse({ matchId: MATCH_ID, name: 'Live', primaryUrl: 'https://ok.example.com/a.m3u8', backupUrl: '' }).backupUrl, null)
})

test('a partial update keeps exactly the fields the caller named', () => {
  // The schema must not re-introduce defaults for omitted fields: the service preserves stored values only
  // when the property is absent from the parsed body, not when it is present with a default.
  assert.deepEqual(streamUpdateSchema.parse({ enabled: false }), { enabled: false })
  assert.deepEqual(streamUpdateSchema.parse({ backupUrl: 'https://cdn.example.com/b.m3u8' }), { backupUrl: 'https://cdn.example.com/b.m3u8' })
  assert.deepEqual(streamUpdateSchema.parse({ backupUrl: '' }), { backupUrl: null })
  assert.deepEqual(streamUpdateSchema.parse({ sourceType: 'DIRECT_URL' }), { sourceType: 'DIRECT_URL' })
  assert.deepEqual(streamUpdateSchema.parse({ activationMode: 'MANUAL' }), { activationMode: 'MANUAL' })

  // Form-encoded booleans are still understood, and an unknown field cannot reach Prisma.
  assert.deepEqual(streamUpdateSchema.parse({ enabled: 'false' }), { enabled: false })
  assert.deepEqual(streamUpdateSchema.parse({ enabled: true, injected: 'x' }), { enabled: true })

  for (const field of ['sourceType', 'channelId', 'backupUrl', 'activationMode', 'primaryUrl'] as const) {
    assert.equal(field in streamUpdateSchema.parse({ quality: '720p' }), false, field)
  }
})
