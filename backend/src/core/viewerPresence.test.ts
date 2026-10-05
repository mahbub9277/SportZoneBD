import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  clearUnavailableViewerCount,
  forgetViewerCount,
  isValidViewerResourceId,
  markViewerCountUnavailable,
  normalizeViewerResource,
  parseViewerRoom,
  resetViewerCountEmitState,
  shouldEmitViewerCount,
  viewerRoom,
} from './viewerPresence.js'

const CHANNEL_ID = '2f1c9b1e-6a4d-4f2b-8f8a-1c2d3e4f5a6b'
const MATCH_ID = '9c7d5e3a-1b2c-4d5e-8f90-abcdef123456'

test('only uuid resource ids are accepted, so internal rooms cannot be joined', () => {
  assert.equal(isValidViewerResourceId(CHANNEL_ID), true)
  assert.equal(isValidViewerResourceId(`  ${CHANNEL_ID}  `), true)
  assert.equal(isValidViewerResourceId('admin-room'), false)
  assert.equal(isValidViewerResourceId(`user:${CHANNEL_ID}`), false)
  assert.equal(isValidViewerResourceId('channel-room'), false)
  assert.equal(isValidViewerResourceId('not-a-uuid'), false)
  assert.equal(isValidViewerResourceId(''), false)
  assert.equal(isValidViewerResourceId('x'.repeat(300)), false)
  assert.equal(isValidViewerResourceId(undefined), false)
  assert.equal(isValidViewerResourceId(42), false)
})

test('presence normalizes the kind and trims the id', () => {
  assert.deepEqual(normalizeViewerResource(CHANNEL_ID, 'channel'), { kind: 'channel', resourceId: CHANNEL_ID })
  assert.deepEqual(normalizeViewerResource(MATCH_ID, 'match'), { kind: 'match', resourceId: MATCH_ID })
  assert.deepEqual(normalizeViewerResource(` ${MATCH_ID} `, 'stream'), { kind: 'stream', resourceId: MATCH_ID })
  // An unknown or missing kind falls back to a stream instead of being rejected.
  assert.deepEqual(normalizeViewerResource(MATCH_ID, undefined), { kind: 'stream', resourceId: MATCH_ID })
  assert.deepEqual(normalizeViewerResource(MATCH_ID, 'admin'), { kind: 'stream', resourceId: MATCH_ID })
  assert.equal(normalizeViewerResource('admin-room', 'channel'), null)
  assert.equal(normalizeViewerResource('user:someone', 'match'), null)
})

test('rooms are named per resource kind and unrelated rooms are ignored', () => {
  assert.equal(viewerRoom({ kind: 'channel', resourceId: CHANNEL_ID }), `channel:${CHANNEL_ID}`)
  assert.equal(viewerRoom({ kind: 'match', resourceId: MATCH_ID }), `match:${MATCH_ID}`)
  assert.deepEqual(parseViewerRoom(`match:${MATCH_ID}`), { kind: 'match', resourceId: MATCH_ID })
  // Bare channel rooms, user rooms and admin rooms must never be treated as viewer rooms.
  assert.equal(parseViewerRoom(CHANNEL_ID), null)
  assert.equal(parseViewerRoom(`user:${CHANNEL_ID}`), null)
  assert.equal(parseViewerRoom('admin-room'), null)
  assert.equal(parseViewerRoom('channel:not-a-uuid'), null)
})

test('matches and channels are counted separately', () => {
  const matchRoom = viewerRoom({ kind: 'match', resourceId: MATCH_ID })
  const otherMatchRoom = viewerRoom({ kind: 'match', resourceId: CHANNEL_ID })
  const channelRoom = viewerRoom({ kind: 'channel', resourceId: MATCH_ID })

  assert.notEqual(matchRoom, otherMatchRoom)
  assert.notEqual(matchRoom, channelRoom)
})

test('a repeated value is only suppressed for passive re-asserts', () => {
  resetViewerCountEmitState()
  assert.equal(shouldEmitViewerCount('channel:a', 12, 'force'), true)
  assert.equal(shouldEmitViewerCount('channel:a', 12, 'onChange'), false)
  assert.equal(shouldEmitViewerCount('channel:a', 13, 'onChange'), true)
  assert.equal(shouldEmitViewerCount('channel:a', 12, 'onChange'), true)
  // A join or leave always notifies the room so a client that just subscribed learns the value.
  assert.equal(shouldEmitViewerCount('channel:a', 12, 'force'), true)
})

test('scopes are tracked independently', () => {
  resetViewerCountEmitState()
  assert.equal(shouldEmitViewerCount('match:one', 1, 'onChange'), true)
  assert.equal(shouldEmitViewerCount('match:two', 1, 'onChange'), true)
  forgetViewerCount('match:one')
  assert.equal(shouldEmitViewerCount('match:one', 1, 'onChange'), true)
})

test('an unavailable scope is announced once and recovers', () => {
  resetViewerCountEmitState()
  assert.equal(markViewerCountUnavailable('channel:a'), true)
  assert.equal(markViewerCountUnavailable('channel:a'), false)
  clearUnavailableViewerCount('channel:a')
  assert.equal(markViewerCountUnavailable('channel:a'), true)
})

test('repeated joins resolve to the same room, so membership stays idempotent', () => {
  const first = normalizeViewerResource(CHANNEL_ID, 'channel')
  const second = normalizeViewerResource(` ${CHANNEL_ID} `, 'channel')
  assert.ok(first && second)
  assert.equal(viewerRoom(first), viewerRoom(second))
  assert.deepEqual(parseViewerRoom(viewerRoom(first)), first)

  // Switching resource inside the same session targets a different room, so the previous one is
  // released by the caller and the new one is counted separately.
  const other = normalizeViewerResource(MATCH_ID, 'match')
  assert.ok(other)
  assert.notEqual(viewerRoom(first), viewerRoom(other))
})
