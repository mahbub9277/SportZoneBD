import assert from 'node:assert/strict'
import test from 'node:test'
import {
  prunePendingSelection,
  setVisibleSelection,
  summarizePendingSelection,
  togglePendingSelection,
} from './pendingSelection.ts'

const VISIBLE = ['a', 'b', 'c']

test('a row is ticked and unticked explicitly', () => {
  const ticked = togglePendingSelection(new Set(), 'a', true)
  assert.deepEqual([...ticked], ['a'])
  assert.deepEqual([...togglePendingSelection(ticked, 'a', false)], [])
  // Re-ticking the same row is a no-op, so a double click cannot duplicate an id.
  assert.equal(togglePendingSelection(ticked, 'a', true).size, 1)
})

test('select all covers exactly the visible rows', () => {
  const selection = setVisibleSelection(new Set(['off-page']), VISIBLE, true)
  assert.deepEqual([...selection].sort(), ['a', 'b', 'c', 'off-page'])

  const cleared = setVisibleSelection(selection, VISIBLE, false)
  assert.deepEqual([...cleared], ['off-page'])
})

test('ids that leave the screen are dropped, so a bulk action cannot cover rows the admin cannot see', () => {
  const selection = new Set(['a', 'stale-row'])
  assert.deepEqual([...prunePendingSelection(selection, VISIBLE)], ['a'])
  // A refresh that returns nothing clears the selection entirely.
  assert.equal(prunePendingSelection(selection, []).size, 0)
})

test('the header checkbox state describes the visible rows', () => {
  assert.deepEqual(summarizePendingSelection(new Set(), VISIBLE), { count: 0, allVisibleSelected: false, someVisibleSelected: false })
  assert.deepEqual(summarizePendingSelection(new Set(['a']), VISIBLE), { count: 1, allVisibleSelected: false, someVisibleSelected: true })
  assert.deepEqual(summarizePendingSelection(new Set(VISIBLE), VISIBLE), { count: 3, allVisibleSelected: true, someVisibleSelected: false })
  // A selection from another page does not make the header look partially selected on an empty page.
  assert.deepEqual(summarizePendingSelection(new Set(['off-page']), []), { count: 1, allVisibleSelected: false, someVisibleSelected: false })
})
