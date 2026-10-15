import assert from 'node:assert/strict'
import test from 'node:test'
import { nextPlaybackAttempt } from './playbackLadder.ts'

const attempt = (state: Partial<Parameters<typeof nextPlaybackAttempt>[0]> = {}) =>
  nextPlaybackAttempt({ streamId: 'stream-1', usedBackup: false, forceDirectUrl: false, hasUrl: true, ...state })

test('a failed primary moves to the stream backup, then to the same URL fetched directly', () => {
  assert.equal(attempt(), 'backup')
  assert.equal(attempt({ usedBackup: true }), 'direct')
  assert.equal(attempt({ usedBackup: true, forceDirectUrl: true }), null)
})

test('a source that is already the backup never selects that backup again', () => {
  // Selecting Backup in the UI starts on it, so the first - and only - transport left is the direct one.
  assert.equal(attempt({ usedBackup: true }), 'direct')
  assert.notEqual(attempt({ usedBackup: true }), 'backup')
})

test('the chain is bounded and never repeats an attempt that already failed', () => {
  const visited: string[] = []
  let state = { usedBackup: false, forceDirectUrl: false, hasUrl: true }

  for (let step = 0; step < 10; step += 1) {
    const next = nextPlaybackAttempt({ streamId: 'stream-1', ...state })
    if (!next) break
    visited.push(next)
    state = next === 'backup' ? { ...state, usedBackup: true } : { ...state, forceDirectUrl: true }
  }

  assert.deepEqual(visited, ['backup', 'direct'])
})

test('a channel - or any source without a stream record - has no other transport to switch to', () => {
  assert.equal(attempt({ streamId: null }), null)
  assert.equal(attempt({ streamId: undefined }), null)
  assert.equal(attempt({ streamId: '' }), null)
  // The proxy is the only transport that has a backup and a direct mode to trade between.
  assert.equal(attempt({ streamId: null, usedBackup: true }), null)
})

test('a direct retry is only offered when there is a URL to fetch', () => {
  assert.equal(attempt({ usedBackup: true, hasUrl: false }), null)
  // A backup is still reachable before any URL is loaded, because the proxy builds it from the record.
  assert.equal(attempt({ hasUrl: false }), 'backup')
})
