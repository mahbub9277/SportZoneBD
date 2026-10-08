import assert from 'node:assert/strict'
import test from 'node:test'
import type { ChannelCategory } from '../../shared/types'
import {
  buildTVCategories,
  buildTVChannels,
  filterTVChannels,
  findChannelByNumber,
  formatChannelNumber,
  nextPlayableChannelId,
  pickInitialChannelId,
  stepChannelId,
  TV_ALL_CATEGORY_ID,
} from './tvChannels.ts'

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
  ]),
]

test('channels are numbered by their real catalogue position', () => {
  const channels = buildTVChannels(catalogue)
  assert.deepEqual(channels.map((channel) => channel.number), [1, 2, 3, 4, 5])
  assert.deepEqual(channels.map((channel) => channel.id), ['a', 'b', 'c', 'd', 'e'])
  assert.equal(formatChannelNumber(1), '#01')
  assert.equal(formatChannelNumber(12), '#12')
})

test('channel numbers stay stable when a category is selected', () => {
  const channels = buildTVChannels(catalogue)
  const sports = filterTVChannels(channels, { categoryId: 'cat-sports' })
  assert.deepEqual(sports.map((channel) => channel.number), [3, 4, 5])
})

test('a channel listed in two categories is kept once', () => {
  const duplicated: ChannelCategory[] = [
    category('one', 'One', [{ id: 'x', name: 'Shared' }]),
    category('two', 'Two', [{ id: 'x', name: 'Shared' }]),
  ]
  const channels = buildTVChannels(duplicated)
  assert.equal(channels.length, 1)
  assert.equal(channels[0].categoryId, 'one')
})

test('live state comes from the backend status and a real stream url', () => {
  const channels = buildTVChannels(catalogue)
  const byId = new Map(channels.map((channel) => [channel.id, channel]))
  assert.equal(byId.get('a')?.isLive, true)
  assert.equal(byId.get('d')?.isLive, false, 'a channel without a stream is not live')
  assert.equal(byId.get('e')?.isLive, false, 'a maintenance channel is not live')
})

test('categories list only real categories that hold channels, after All', () => {
  const channels = buildTVChannels(catalogue)
  const categories = buildTVCategories([...catalogue, category('empty', 'Empty', [])], channels)
  assert.equal(categories[0].id, TV_ALL_CATEGORY_ID)
  assert.equal(categories[0].count, 5)
  assert.deepEqual(categories.map((entry) => entry.id), [TV_ALL_CATEGORY_ID, 'cat-bd', 'cat-sports'])
  assert.deepEqual(categories.map((entry) => entry.count), [5, 2, 3])
})

test('search matches channel name, category name and channel number', () => {
  const channels = buildTVChannels(catalogue)
  assert.deepEqual(filterTVChannels(channels, { query: 'atn' }).map((channel) => channel.id), ['a', 'b'])
  assert.deepEqual(filterTVChannels(channels, { query: 'sports' }).map((channel) => channel.id), ['c', 'd', 'e'])
  assert.deepEqual(filterTVChannels(channels, { query: '#03' }).map((channel) => channel.id), ['c'])
  assert.deepEqual(filterTVChannels(channels, { query: '5' }).map((channel) => channel.id), ['e'])
  assert.deepEqual(filterTVChannels(channels, { query: 'nothing-here' }), [])
  assert.equal(filterTVChannels(channels, { query: '   ' }).length, 5, 'a blank query does not filter')
})

test('category and search filters combine', () => {
  const channels = buildTVChannels(catalogue)
  assert.deepEqual(
    filterTVChannels(channels, { categoryId: 'cat-sports', query: 'star' }).map((channel) => channel.id),
    ['c'],
  )
})

test('the initial channel prefers the remembered one when it is still playable', () => {
  const channels = buildTVChannels(catalogue)
  assert.equal(pickInitialChannelId(channels, 'c'), 'c')
  assert.equal(pickInitialChannelId(channels, 'd'), 'a', 'a dead channel falls back to the first playable one')
  assert.equal(pickInitialChannelId(channels, null), 'a')
  assert.equal(pickInitialChannelId([], 'a'), null)
})

test('channel up and down walk the playable channels and wrap', () => {
  const channels = buildTVChannels(catalogue)
  // Only 'a', 'b' and 'c' can play; 'd' and 'e' must be skipped while zapping.
  assert.equal(stepChannelId(channels, 'a', 1), 'b')
  assert.equal(stepChannelId(channels, 'c', 1), 'a', 'wraps forwards')
  assert.equal(stepChannelId(channels, 'a', -1), 'c', 'wraps backwards')
  assert.equal(stepChannelId(channels, null, 1), 'a')
  assert.equal(stepChannelId([], 'a', 1), null)
})

test('a single playable channel keeps returning itself', () => {
  const channels = buildTVChannels([category('only', 'Only', [{ id: 'solo', name: 'Solo' }])])
  assert.equal(stepChannelId(channels, 'solo', 1), 'solo')
  assert.equal(stepChannelId(channels, 'solo', -1), 'solo')
})

test('premium channels are flagged but never invented', () => {
  const channels = buildTVChannels([category('prem', 'Premium', [{ id: 'p', name: 'Gold TV', isPremium: true }])])
  assert.equal(channels[0].isPremium, true)
  assert.equal(channels[0].isLive, true)
})

test('a typed channel number resolves through the catalogue numbering, never an index or id', () => {
  const channels = buildTVChannels(catalogue)
  assert.equal(findChannelByNumber(channels, '3')?.id, 'c')
  assert.equal(findChannelByNumber(channels, '03')?.id, 'c', 'leading zeros are not significant')
  assert.equal(findChannelByNumber(channels, ' 5 ')?.id, 'e', 'the typed value is trimmed')
  assert.equal(findChannelByNumber(channels, '2')?.id, 'b')
  assert.equal(findChannelByNumber(channels, '99'), null, 'a number no channel holds resolves to nothing')
  assert.equal(findChannelByNumber(channels, '0'), null)
  assert.equal(findChannelByNumber(channels, ''), null)
  assert.equal(findChannelByNumber(channels, 'abc'), null)
  assert.equal(findChannelByNumber([], '1'), null)
})

test('the recovery channel wraps past the failed one and skips ineligible channels', () => {
  const channels = buildTVChannels(catalogue)
  // Playable order is a → b → c; 'd' and 'e' have no working stream.
  assert.equal(nextPlayableChannelId(channels, 'a'), 'b')
  assert.equal(nextPlayableChannelId(channels, 'c'), 'a', 'wraps at the end of the catalogue')
  assert.equal(nextPlayableChannelId(channels, null), 'a')
  assert.equal(
    nextPlayableChannelId(channels, 'a', (channel) => channel.id !== 'b'),
    'c',
    'a channel the viewer may not watch is skipped',
  )
  assert.equal(nextPlayableChannelId(channels, 'a', (channel) => channel.id === 'a'), null, 'never re-tunes the failure')
  assert.equal(nextPlayableChannelId(channels, 'a', () => false), null, 'no eligible channel means no switch')
  assert.equal(nextPlayableChannelId([], 'a'), null)
})

test('an empty or missing catalogue produces no channels and no categories', () => {
  assert.deepEqual(buildTVChannels(undefined), [])
  assert.deepEqual(buildTVChannels([]), [])
  assert.deepEqual(buildTVCategories(undefined, []), [])
})
