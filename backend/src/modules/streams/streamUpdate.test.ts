import assert from 'node:assert/strict'
import test from 'node:test'
import { buildStreamUpdateData } from './streamUpdate.js'

const channelStream = {
  sourceType: 'CHANNEL',
  channelId: 'channel-1',
  primaryUrl: 'https://cdn.example.com/channel.m3u8',
  backupUrl: 'https://cdn.example.com/backup.m3u8',
  activationMode: 'MANUAL',
}

test('a partial update never clears fields it does not name', () => {
  // The regression: `{ enabled: false }` used to also unlink the channel, drop the backup source and
  // switch the stream to DIRECT_URL with an automatic activation.
  const data = buildStreamUpdateData(channelStream, { enabled: false }, null)

  assert.deepEqual(data, { enabled: false })
  for (const preserved of ['sourceType', 'channelId', 'primaryUrl', 'backupUrl', 'activationMode']) {
    assert.equal(preserved in data, false, preserved)
  }
})

test('every supported partial edit leaves the untouched properties alone', () => {
  const edits = [
    { name: 'Renamed' },
    { logo: 'https://cdn.example.com/logo.png' },
    { quality: '720p' },
    { status: 'LIVE' as const },
    { activationOffsetMinutes: 30 },
    { matchId: 'match-2' },
  ]

  for (const payload of edits) {
    const data = buildStreamUpdateData(channelStream, payload, null)
    assert.equal('sourceType' in data, false, JSON.stringify(payload))
    assert.equal('channelId' in data, false, JSON.stringify(payload))
    assert.equal('backupUrl' in data, false, JSON.stringify(payload))
    assert.equal('activationMode' in data, false, JSON.stringify(payload))
    assert.equal('primaryUrl' in data, false, JSON.stringify(payload))
  }

  // A direct stream keeps its backup source too, and its primary URL is untouched unless it is replaced.
  const direct = { sourceType: 'DIRECT_URL', channelId: null, primaryUrl: 'https://cdn.example.com/a.m3u8', backupUrl: 'https://cdn.example.com/b.m3u8' }
  assert.deepEqual(buildStreamUpdateData(direct, { enabled: true }, null), { enabled: true })
  assert.deepEqual(buildStreamUpdateData(direct, { backupUrl: '' }, null), { backupUrl: null })
  assert.deepEqual(buildStreamUpdateData(direct, { backupUrl: '  https://cdn.example.com/new.m3u8  ' }, null), { backupUrl: 'https://cdn.example.com/new.m3u8' })
  assert.deepEqual(buildStreamUpdateData(direct, { primaryUrl: '  https://cdn.example.com/new.m3u8 ' }, null), { primaryUrl: 'https://cdn.example.com/new.m3u8' })
})

test('an explicit activation mode and an explicit channel link are applied', () => {
  assert.deepEqual(buildStreamUpdateData(channelStream, { activationMode: 'AUTOMATIC' }, null), { activationMode: 'AUTOMATIC' })
  assert.deepEqual(buildStreamUpdateData(channelStream, { activationMode: 'MANUAL' }, null), { activationMode: 'MANUAL' })

  const reLink = buildStreamUpdateData(channelStream, { sourceType: 'CHANNEL', channelId: 'channel-2' }, 'https://cdn.example.com/channel-2.m3u8')
  assert.deepEqual(reLink, { sourceType: 'CHANNEL', channelId: 'channel-2', primaryUrl: 'https://cdn.example.com/channel-2.m3u8' })

  // Clearing the link keeps the mode the caller asked for and stores no channel URL.
  assert.deepEqual(buildStreamUpdateData(channelStream, { channelId: null }, null), { channelId: null })

  // A channel link the caller could not resolve a URL for leaves the stored primary URL in place.
  assert.deepEqual(buildStreamUpdateData(directStream(), { sourceType: 'CHANNEL', channelId: 'channel-3' }, null), {
    sourceType: 'CHANNEL',
    channelId: 'channel-3',
  })
})

test('a channel mode without a named channel keeps the supplied URL', () => {
  // The admin form can submit channel mode with no channel selected; the URL the operator typed is what
  // that request asked to store, not a URL derived from a channel nobody named.
  assert.deepEqual(
    buildStreamUpdateData(channelStream, { sourceType: 'CHANNEL', primaryUrl: 'https://cdn.example.com/typed.m3u8' }, null),
    { sourceType: 'CHANNEL', primaryUrl: 'https://cdn.example.com/typed.m3u8' },
  )
})

test('switching to a direct source clears the channel link and accepts the supplied URL', () => {
  const data = buildStreamUpdateData(channelStream, { sourceType: 'DIRECT_URL', primaryUrl: 'https://cdn.example.com/direct.m3u8' }, null)

  assert.deepEqual(data, { sourceType: 'DIRECT_URL', channelId: null, primaryUrl: 'https://cdn.example.com/direct.m3u8' })
  // An existing direct stream that already has no link does not get a redundant `channelId: null` write.
  assert.deepEqual(buildStreamUpdateData(directStream(), { sourceType: 'DIRECT_URL' }, null), { sourceType: 'DIRECT_URL' })
})

const directStream = (): Record<string, unknown> => ({ sourceType: 'DIRECT_URL', channelId: null, primaryUrl: 'https://cdn.example.com/a.m3u8', backupUrl: null })
