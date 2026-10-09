import test from 'node:test'
import assert from 'node:assert/strict'
import { LIVE_BADGE_CLASS, LIVE_DOT_CLASS, LIVE_TEXT_CLASS, formatViewerCount } from './liveStatus.ts'

test('viewer counts below a thousand stay exact', () => {
  assert.equal(formatViewerCount(0), '0')
  assert.equal(formatViewerCount(7), '7')
  assert.equal(formatViewerCount(999), '999')
})

test('thousands and millions are abbreviated the way the live line shows them', () => {
  assert.equal(formatViewerCount(1_000), '1.0K')
  assert.equal(formatViewerCount(1_250), '1.3K')
  assert.equal(formatViewerCount(999_999), '1000.0K')
  assert.equal(formatViewerCount(1_000_000), '1.0M')
  assert.equal(formatViewerCount(2_450_000), '2.5M')
})

test('the live treatment states its light and dark colour so it can never render unreadable', () => {
  for (const className of [LIVE_BADGE_CLASS, LIVE_TEXT_CLASS]) {
    assert.match(className, /text-emerald-\d+/)
    assert.match(className, /dark:text-emerald-\d+/)
  }
  assert.match(LIVE_DOT_CLASS, /bg-emerald-\d+/)
  assert.match(LIVE_DOT_CLASS, /dark:bg-emerald-\d+/)
})
