import test from 'node:test'
import assert from 'node:assert/strict'
import { sortPinnedFirst } from './pinnedOrdering.ts'

const channels = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }]

test('pinned channels come first and keep the order the page already produced', () => {
  // 'c' is listed after 'a' in the fetched data, so the grouped order is preserved rather than the
  // order the channels were pinned in — the project has no explicit pinned-order system.
  assert.deepEqual(sortPinnedFirst(channels, ['c', 'a']).map((channel) => channel.id), ['a', 'c', 'b', 'd'])
  assert.deepEqual(sortPinnedFirst(channels, ['a', 'c']).map((channel) => channel.id), ['a', 'c', 'b', 'd'])
})

test('the remaining channels keep the order the page already produced', () => {
  assert.deepEqual(sortPinnedFirst(channels, ['d']).map((channel) => channel.id), ['d', 'a', 'b', 'c'])
})

test('an unpinned list is returned unchanged, with the same array reference', () => {
  const result = sortPinnedFirst(channels, [])
  assert.equal(result, channels)
  assert.equal(sortPinnedFirst(channels, ['not-in-this-list']), channels)
})

test('a pinned channel that is no longer available never appears', () => {
  const result = sortPinnedFirst(channels, ['gone', 'b'])
  assert.deepEqual(result.map((channel) => channel.id), ['b', 'a', 'c', 'd'])
})

test('no channel is duplicated or dropped', () => {
  const result = sortPinnedFirst(channels, ['b', 'a'])
  assert.equal(result.length, channels.length)
  assert.deepEqual([...result].map((channel) => channel.id).sort(), ['a', 'b', 'c', 'd'])
})

test('the input array is not mutated', () => {
  const input = [...channels]
  sortPinnedFirst(input, ['c'])
  assert.deepEqual(input.map((channel) => channel.id), ['a', 'b', 'c', 'd'])
})

test('repeated ids in the pinned list cannot duplicate a channel', () => {
  assert.deepEqual(sortPinnedFirst(channels, ['b', 'b']).map((channel) => channel.id), ['b', 'a', 'c', 'd'])
})
