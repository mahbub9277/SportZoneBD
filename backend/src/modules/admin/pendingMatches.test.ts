import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildPendingMatchFilter, parsePendingMatchFilters } from './pendingMatches.js'

const NOW = new Date('2026-10-10T12:00:00.000Z')

/** Prisma's `{ gt, lte }` on a DateTime, applied in memory so the rules can be checked without a database. */
const matchesFilter = (row: { status: string; deletedAt: Date | null; kickoffAt: Date }, filter = buildPendingMatchFilter(NOW)) =>
  row.status === filter.status
  && row.deletedAt === filter.deletedAt
  && row.kickoffAt.getTime() > filter.kickoffAt.gt.getTime()
  && (filter.kickoffAt.lte ? row.kickoffAt.getTime() <= filter.kickoffAt.lte.getTime() : true)

test('the queue only asks for live pending rows', () => {
  const filter = buildPendingMatchFilter(NOW)

  assert.equal(filter.status, 'PENDING')
  assert.equal(filter.deletedAt, null)
  assert.equal(filter.kickoffAt.gt, NOW)
})

test('a fixture whose kickoff has passed is not a review request', () => {
  assert.equal(matchesFilter({ status: 'PENDING', deletedAt: null, kickoffAt: new Date('2026-10-10T11:59:00.000Z') }), false)
  // Exactly at kickoff the match has started, so it is excluded too.
  assert.equal(matchesFilter({ status: 'PENDING', deletedAt: null, kickoffAt: NOW }), false)
})

test('a legitimate future pending match stays visible', () => {
  assert.equal(matchesFilter({ status: 'PENDING', deletedAt: null, kickoffAt: new Date('2026-10-10T12:01:00.000Z') }), true)
  // A kickoff on the far side of a timezone boundary is still just a future instant.
  assert.equal(matchesFilter({ status: 'PENDING', deletedAt: null, kickoffAt: new Date('2026-10-11T04:00:00+06:00') }), true)
})

test('rejected and published rows are never part of the queue', () => {
  assert.equal(matchesFilter({ status: 'REJECTED', deletedAt: new Date(), kickoffAt: new Date('2026-10-11T12:00:00.000Z') }), false)
  assert.equal(matchesFilter({ status: 'UPCOMING', deletedAt: null, kickoffAt: new Date('2026-10-11T12:00:00.000Z') }), false)
})

test('a kickoff range narrows the queue without replacing the future floor', () => {
  const filter = buildPendingMatchFilter(NOW, {
    from: new Date('2026-10-11T00:00:00.000Z'),
    to: new Date('2026-10-11T23:59:59.999Z'),
  })

  assert.equal(matchesFilter({ status: 'PENDING', deletedAt: null, kickoffAt: new Date('2026-10-11T12:00:00.000Z') }, filter), true)
  assert.equal(matchesFilter({ status: 'PENDING', deletedAt: null, kickoffAt: new Date('2026-10-12T00:00:00.000Z') }, filter), false)
  assert.equal(matchesFilter({ status: 'PENDING', deletedAt: null, kickoffAt: new Date('2026-10-10T23:59:00.000Z') }, filter), false)
})

test('the end of a range is inclusive, so the last instant of a Bangladesh day is in scope', () => {
  const to = new Date('2026-10-11T17:59:59.999Z')
  const filter = buildPendingMatchFilter(NOW, { from: new Date('2026-10-10T18:00:00.000Z'), to })

  assert.equal(matchesFilter({ status: 'PENDING', deletedAt: null, kickoffAt: to }, filter), true)
  assert.equal(matchesFilter({ status: 'PENDING', deletedAt: null, kickoffAt: new Date(to.getTime() + 1) }, filter), false)
})

test('a range that starts in the past cannot re-expose an expired fixture', () => {
  const filter = buildPendingMatchFilter(NOW, { from: new Date('2026-10-01T00:00:00.000Z'), to: new Date('2026-10-20T00:00:00.000Z') })

  assert.equal(filter.kickoffAt.gt, NOW)
  assert.equal(matchesFilter({ status: 'PENDING', deletedAt: null, kickoffAt: new Date('2026-10-05T12:00:00.000Z') }, filter), false)
  assert.equal(matchesFilter({ status: 'PENDING', deletedAt: null, kickoffAt: new Date('2026-10-15T12:00:00.000Z') }, filter), true)
})

test('no range at all keeps the plain "every upcoming fixture" behaviour', () => {
  const parsed = parsePendingMatchFilters({}, NOW)

  assert.equal(parsed.ok, true)
  assert.ok(parsed.ok)
  assert.deepEqual(parsed.filter, buildPendingMatchFilter(NOW))
  assert.deepEqual(parsed.range, { from: NOW, to: null })
})

test('parses the admin query parameters into real instants across a Bangladesh day boundary', () => {
  const parsed = parsePendingMatchFilters(
    { kickoffFrom: '2026-10-10T18:00:00.000Z', kickoffTo: '2026-10-11T17:59:59.999Z' },
    NOW,
  )

  assert.ok(parsed.ok)
  assert.equal(parsed.filter.kickoffAt.gt.toISOString(), '2026-10-10T18:00:00.000Z')
  assert.equal(parsed.filter.kickoffAt.lte?.toISOString(), '2026-10-11T17:59:59.999Z')
  assert.equal(parsed.range.to?.toISOString(), '2026-10-11T17:59:59.999Z')
})

test('reports the applied range when the requested start is clamped to now', () => {
  const parsed = parsePendingMatchFilters({ kickoffFrom: '2026-10-01T00:00:00.000Z' }, NOW)

  assert.ok(parsed.ok)
  assert.equal(parsed.range.from, NOW)
  assert.equal(parsed.range.to, null)
})

test('rejects a malformed instant instead of silently ignoring the filter', () => {
  for (const query of [{ kickoffFrom: 'yesterday' }, { kickoffTo: 'not-a-date' }, { kickoffFrom: '   ' }, { kickoffFrom: 42 }]) {
    const parsed = parsePendingMatchFilters(query, NOW)
    assert.equal(parsed.ok, false)
    assert.ok(!parsed.ok)
    assert.equal(parsed.message, 'Invalid date filter.')
  }
})

test('rejects an inverted range rather than returning an empty queue', () => {
  const parsed = parsePendingMatchFilters(
    { kickoffFrom: '2026-10-12T00:00:00.000Z', kickoffTo: '2026-10-11T00:00:00.000Z' },
    NOW,
  )

  assert.ok(!parsed.ok)
  assert.equal(parsed.message, 'The end date must be after the start date.')

  const sameInstant = parsePendingMatchFilters(
    { kickoffFrom: '2026-10-12T00:00:00.000Z', kickoffTo: '2026-10-12T00:00:00.000Z' },
    NOW,
  )
  assert.equal(sameInstant.ok, false)
})
