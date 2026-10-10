import assert from 'node:assert/strict'
import test from 'node:test'
import { bangladeshDateKey, bangladeshDayRange, bangladeshToday, shiftBangladeshDateKey } from './bangladeshDateRange.ts'

test('a Bangladesh day starts six hours before the UTC date starts', () => {
  const range = bangladeshDayRange('2026-10-10')

  assert.ok(range)
  assert.equal(range.from, '2026-10-09T18:00:00.000Z')
  assert.equal(range.to, '2026-10-10T17:59:59.999Z')
})

test('a kickoff just after midnight in Bangladesh belongs to that local day', () => {
  // 2026-10-10T01:00+06:00 is 2026-10-09T19:00Z: the previous UTC date, the same Bangladesh day.
  assert.equal(bangladeshDateKey('2026-10-09T19:00:00.000Z'), '2026-10-10')

  const range = bangladeshDayRange('2026-10-10')
  assert.ok(range)
  const kickoff = new Date('2026-10-09T19:00:00.000Z').getTime()
  assert.ok(kickoff >= new Date(range.from).getTime() && kickoff <= new Date(range.to).getTime())
})

test('the two halves of one Bangladesh day never overlap across the boundary', () => {
  const today = bangladeshDayRange('2026-10-10')
  const tomorrow = bangladeshDayRange('2026-10-11')

  assert.ok(today && tomorrow)
  assert.equal(new Date(today.to).getTime() + 1, new Date(tomorrow.from).getTime())
  // 2026-10-10T23:59:59.999+06:00 is the last instant of the day, 2026-10-11T00:00+06:00 the first of the next.
  assert.equal(bangladeshDateKey(today.to), '2026-10-10')
  assert.equal(bangladeshDateKey(tomorrow.from), '2026-10-11')
})

test('the day key is taken from the local calendar, not from the UTC date', () => {
  assert.equal(bangladeshDateKey('2026-10-10T17:59:59.999Z'), '2026-10-10')
  assert.equal(bangladeshDateKey('2026-10-10T18:00:00.000Z'), '2026-10-11')
})

test('today and tomorrow come from the same clock', () => {
  const now = new Date('2026-10-10T19:30:00.000Z') // 2026-10-11T01:30 in Bangladesh

  assert.equal(bangladeshToday(now), '2026-10-11')
  assert.equal(shiftBangladeshDateKey(bangladeshToday(now), 1), '2026-10-12')
  assert.equal(shiftBangladeshDateKey(bangladeshToday(now), -1), '2026-10-10')
})

test('month and year rollovers are handled', () => {
  assert.equal(shiftBangladeshDateKey('2026-12-31', 1), '2027-01-01')
  assert.equal(shiftBangladeshDateKey('2027-01-01', -1), '2026-12-31')
  assert.equal(shiftBangladeshDateKey('2026-02-28', 1), '2026-03-01')
})

test('a date that does not exist is refused instead of rolled over', () => {
  assert.equal(bangladeshDayRange('2026-02-31'), null)
  assert.equal(bangladeshDayRange('2026-13-01'), null)
  assert.equal(bangladeshDayRange('not-a-date'), null)
  assert.equal(bangladeshDayRange(''), null)
  assert.equal(shiftBangladeshDateKey('2026-02-31', 1), null)
  assert.equal(bangladeshDateKey('not-an-instant'), null)
})
