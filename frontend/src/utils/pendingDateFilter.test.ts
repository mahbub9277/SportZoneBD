import assert from 'node:assert/strict'
import test from 'node:test'
import { describePendingDateFilter, resolvePendingDateFilter } from './pendingDateFilter.ts'

const NOW = new Date('2026-10-10T06:00:00.000Z') // 12:00 in Bangladesh

test('the quick filters resolve to the Bangladesh day they name', () => {
  const today = resolvePendingDateFilter({ quick: 'today' }, NOW)
  assert.deepEqual(today, {
    ok: true,
    kickoffFrom: '2026-10-09T18:00:00.000Z',
    kickoffTo: '2026-10-10T17:59:59.999Z',
  })

  const tomorrow = resolvePendingDateFilter({ quick: 'tomorrow' }, NOW)
  assert.deepEqual(tomorrow, {
    ok: true,
    kickoffFrom: '2026-10-10T18:00:00.000Z',
    kickoffTo: '2026-10-11T17:59:59.999Z',
  })
})

test('the day boundary is decided by the clock, not by the date the admin happens to be in', () => {
  // 2026-10-10T19:00Z is already 2026-10-11 in Bangladesh, so "today" is the 11th.
  const justPastMidnight = resolvePendingDateFilter({ quick: 'today' }, new Date('2026-10-10T19:00:00.000Z'))
  assert.deepEqual(justPastMidnight, {
    ok: true,
    kickoffFrom: '2026-10-10T18:00:00.000Z',
    kickoffTo: '2026-10-11T17:59:59.999Z',
  })
})

test('all upcoming sends no range at all, so the server keeps its own floor', () => {
  assert.deepEqual(resolvePendingDateFilter({ quick: 'all' }), { ok: true, kickoffFrom: null, kickoffTo: null })
})

test('custom dates are expanded to whole local days, inclusive of the end date', () => {
  assert.deepEqual(resolvePendingDateFilter({ quick: 'all', from: '2026-10-10', to: '2026-10-12' }), {
    ok: true,
    kickoffFrom: '2026-10-09T18:00:00.000Z',
    kickoffTo: '2026-10-12T17:59:59.999Z',
  })
})

test('a single boundary is allowed: from only, or to only', () => {
  assert.deepEqual(resolvePendingDateFilter({ quick: 'all', from: '2026-10-10' }), {
    ok: true,
    kickoffFrom: '2026-10-09T18:00:00.000Z',
    kickoffTo: null,
  })
  assert.deepEqual(resolvePendingDateFilter({ quick: 'all', to: '2026-10-10' }), {
    ok: true,
    kickoffFrom: null,
    kickoffTo: '2026-10-10T17:59:59.999Z',
  })
})

test('an impossible or inverted range is reported instead of being sent', () => {
  assert.equal(resolvePendingDateFilter({ quick: 'all', from: 'not-a-date' }).ok, false)
  assert.equal(resolvePendingDateFilter({ quick: 'all', to: '2026-02-31' }).ok, false)
  const inverted = resolvePendingDateFilter({ quick: 'all', from: '2026-10-12', to: '2026-10-10' })
  assert.equal(inverted.ok, false)
  if (!inverted.ok) assert.match(inverted.message, /end date/i)
})

test('the same range on one day is allowed', () => {
  const sameDay = resolvePendingDateFilter({ quick: 'all', from: '2026-10-10', to: '2026-10-10' })
  assert.equal(sameDay.ok, true)
})

test('the active filter reads back the way the controls are labelled', () => {
  assert.equal(describePendingDateFilter({ quick: 'today' }), 'today')
  assert.equal(describePendingDateFilter({ quick: 'tomorrow' }), 'tomorrow')
  assert.equal(describePendingDateFilter({ quick: 'all' }), 'all upcoming')
  assert.equal(describePendingDateFilter({ quick: 'all', from: '2026-10-10' }), 'from 2026-10-10')
  assert.equal(describePendingDateFilter({ quick: 'all', to: '2026-10-10' }), 'until 2026-10-10')
  assert.equal(describePendingDateFilter({ quick: 'all', from: '2026-10-10', to: '2026-10-12' }), '2026-10-10 to 2026-10-12')
})
