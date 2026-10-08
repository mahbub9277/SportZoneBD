import assert from 'node:assert/strict'
import test from 'node:test'
import type { ChannelCategory } from '../../shared/types'
import {
  isAutoTuneScanComplete,
  pickAutoTuneChannel,
  startAutoTuneScan,
  stepAutoTuneScan,
} from './autoTune.ts'
import { buildTVChannels, isChannelWatchable, playableChannels } from './tvChannels.ts'

const category = (
  id: string,
  name: string,
  channels: Array<{ id: string; name: string; url?: string | null; status?: string; isPremium?: boolean }>,
): ChannelCategory => ({
  id,
  name,
  channels: channels.map((channel) => ({
    id: channel.id,
    name: channel.name,
    logo: null,
    url: channel.url === undefined ? `https://example.test/${channel.id}.m3u8` : channel.url,
    status: channel.status ?? 'ACTIVE',
    isPremium: channel.isPremium ?? false,
  })),
})

const catalogue: ChannelCategory[] = [
  category('cat-bd', 'Bangladesh', [
    { id: 'a', name: 'ATN Bangla' },
    { id: 'b', name: 'ATN Music' },
  ]),
  category('cat-sports', 'Sports', [
    { id: 'c', name: 'Star Sports 1' },
    { id: 'd', name: 'Broken Feed', url: null },
    { id: 'e', name: 'Maintenance Feed', status: 'MAINTENANCE' },
    { id: 'f', name: 'Gold TV', isPremium: true },
  ]),
]

test('a channel is watchable when it is playable and the viewer is entitled to it', () => {
  const channels = buildTVChannels(catalogue)
  const byId = new Map(channels.map((channel) => [channel.id, channel]))

  assert.equal(isChannelWatchable(byId.get('a')!, false), true)
  assert.equal(isChannelWatchable(byId.get('d')!, false), false, 'no stream means no channel')
  assert.equal(isChannelWatchable(byId.get('e')!, false), false, 'a maintenance channel is not playable')
  assert.equal(isChannelWatchable(byId.get('f')!, false), false, 'a locked premium channel is not watchable')
  assert.equal(isChannelWatchable(byId.get('f')!, true), true, 'a subscriber may watch it')
  assert.deepEqual(playableChannels(channels).map((channel) => channel.id), ['a', 'b', 'c', 'f'])
})

test('the scan walks the whole catalogue once and keeps only watchable channels', () => {
  const channels = buildTVChannels(catalogue)
  let scan = startAutoTuneScan()
  assert.equal(isAutoTuneScanComplete(scan, channels), false)

  // Two entries per slice: the scan must never re-read one or skip one.
  while (!isAutoTuneScanComplete(scan, channels)) {
    scan = stepAutoTuneScan(scan, channels, false, 2)
  }

  assert.equal(scan.scanned, channels.length, 'every catalogue entry was visited exactly once')
  assert.deepEqual(scan.found.map((channel) => channel.id), ['a', 'b', 'c'])
  assert.equal(scan.currentChannel?.id, 'f', 'the last entry visited is the last one reported')
})

test('a subscriber scans the premium channels too, a guest never does', () => {
  const channels = buildTVChannels(catalogue)
  const run = (subscriber: boolean) => {
    let scan = startAutoTuneScan()
    while (!isAutoTuneScanComplete(scan, channels)) scan = stepAutoTuneScan(scan, channels, subscriber, 3)
    return scan.found.map((channel) => channel.id)
  }

  assert.deepEqual(run(false), ['a', 'b', 'c'], 'a locked channel is skipped, not unlocked')
  assert.deepEqual(run(true), ['a', 'b', 'c', 'f'])
})

test('an empty catalogue completes immediately with nothing found', () => {
  const scan = startAutoTuneScan()
  assert.equal(isAutoTuneScanComplete(scan, []), true)
  assert.deepEqual(scan.found, [])
  assert.equal(scan.currentChannel, null)
  assert.equal(stepAutoTuneScan(scan, [], false, 4), scan, 'stepping an empty catalogue changes nothing')
})

test('the scan result is a snapshot: stepping never mutates the previous state', () => {
  const channels = buildTVChannels(catalogue)
  const first = stepAutoTuneScan(startAutoTuneScan(), channels, false, 3)
  const second = stepAutoTuneScan(first, channels, false, 3)

  assert.equal(first.scanned, 3)
  assert.deepEqual(first.found.map((channel) => channel.id), ['a', 'b', 'c'])
  assert.equal(second.scanned, 6)
  assert.equal(first.found.length, 3, 'the earlier state keeps its own result')
})

test('accepting a scan keeps the channel that is playing when it survived', () => {
  const channels = buildTVChannels(catalogue)
  const found = channels.filter((channel) => isChannelWatchable(channel, true))

  assert.equal(pickAutoTuneChannel(found, 'c')?.id, 'c', 'the current channel wins when it still works')
  assert.equal(pickAutoTuneChannel(found, 'd')?.id, 'a', 'a channel that failed the scan falls back to the first found')
  assert.equal(pickAutoTuneChannel(found, null)?.id, 'a')
  assert.equal(pickAutoTuneChannel([], 'a'), null, 'nothing found means nothing to tune to')
})
