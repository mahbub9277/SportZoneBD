import assert from 'node:assert/strict'
import { test } from 'node:test'
import { UPCOMING_VISIBILITY_HOURS, getUpcomingVisibilityBounds } from './upcomingWindow.js'

test('Upcoming visibility starts now and stops 24 hours after kickoff-relative window', () => {
  const now = new Date('2026-10-04T12:00:00.000Z')
  const bounds = getUpcomingVisibilityBounds(now)

  assert.equal(UPCOMING_VISIBILITY_HOURS, 24)
  assert.equal(bounds.gte.toISOString(), now.toISOString())
  assert.equal(bounds.lte.toISOString(), '2026-10-05T12:00:00.000Z')
})

test('a match 36 hours away stays outside the visible window', () => {
  const now = new Date('2026-10-04T12:00:00.000Z')
  const { lte } = getUpcomingVisibilityBounds(now)
  const kickoff = new Date(now.getTime() + 36 * 60 * 60 * 1000)

  assert.ok(kickoff.getTime() > lte.getTime())
})
