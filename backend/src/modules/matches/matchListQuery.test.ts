import assert from 'node:assert/strict'
import test from 'node:test'
import { buildMatchListWhere, RECENT_MATCH_ADDED_WINDOW_HOURS, RECENT_MATCH_WINDOW_DAYS } from './matchListQuery.js'

const NOW = new Date('2026-10-08T12:00:00.000Z')
const iso = (offsetMs: number) => new Date(NOW.getTime() + offsetMs).toISOString()
const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

const recentBranches = (filters: Parameters<typeof buildMatchListWhere>[0]) => {
  const where = buildMatchListWhere(filters, NOW)
  const groups = where.AND as Record<string, any>[] | undefined
  const recent = groups?.[1]
  const branches = recent?.OR
  assert.ok(Array.isArray(branches), 'recentOnly must nest its candidate OR inside the AND group')
  return branches as Record<string, any>[]
}

/** Dates become ISO strings so every expectation below can be written as the real instant it means. */
const normalize = (value: unknown): unknown => {
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value)) return value.map(normalize)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, normalize(entry)]))
  return value
}

const normalizedWhere = (filters: Parameters<typeof buildMatchListWhere>[0]) => normalize(buildMatchListWhere(filters, NOW))

test('recent candidates are live, imminent, just finished or just added', () => {
  const branches = recentBranches({ recentOnly: true })

  assert.deepEqual(normalize(branches[0]), { status: 'LIVE' })
  assert.deepEqual(normalize(branches[1]), { status: 'UPCOMING', kickoffAt: { gte: iso(0), lte: iso(24 * HOUR) } })
  assert.deepEqual(normalize(branches[2]), {
    status: 'FINISHED',
    kickoffAt: { lte: iso(0) },
    finishedAt: { gte: iso(-RECENT_MATCH_WINDOW_DAYS * DAY), lte: iso(0) },
  })
  assert.deepEqual(normalize(branches[3]), { createdAt: { gte: iso(-RECENT_MATCH_ADDED_WINDOW_HOURS * HOUR) } })
})

test('the recent feed is not restricted to one sport or to finished matches', () => {
  const where = buildMatchListWhere({ recentOnly: true }, NOW)

  assert.equal(where.sport, undefined)
  assert.equal(where.status, undefined)
  assert.equal((where.AND as unknown[] | undefined)?.length, 2)
  // A search clause is written to the top level by the pagination service, so the recent candidates must
  // not sit there: they would be replaced the moment somebody searches.
  assert.equal(where.OR, undefined)
})

test('pending and rejected matches can never become public', () => {
  const where = buildMatchListWhere({ recentOnly: true }, NOW)
  // The exclusion is ANDed in, so no OR branch can re-admit a pending or rejected match.
  assert.deepEqual((where.AND as unknown[])[0], { status: { notIn: ['PENDING', 'REJECTED'] } })
  assert.deepEqual((normalizedWhere({}) as { AND: unknown[] }).AND, [{ status: { notIn: ['PENDING', 'REJECTED'] } }])
})

test('a newly added upcoming match stays recent even when its kickoff is far away', () => {
  const branches = recentBranches({ recentOnly: true })
  const added = branches[3] as { createdAt: { gte: Date } }
  assert.ok(added.createdAt.gte.getTime() > NOW.getTime() - RECENT_MATCH_ADDED_WINDOW_HOURS * HOUR - 1000)
  // Nothing in the finished branch requires a near kickoff either, which is what makes a far-away new fixture eligible.
  assert.equal((branches[2] as { kickoffAt: { gte?: Date } }).kickoffAt.gte, undefined)
})

test('live and upcoming tabs keep their own unchanged filters', () => {
  assert.deepEqual(normalizedWhere({ status: 'LIVE' }), {
    deletedAt: null,
    AND: [{ status: { notIn: ['PENDING', 'REJECTED'] } }],
    status: 'LIVE',
  })
  assert.deepEqual(normalizedWhere({ status: 'UPCOMING' }), {
    deletedAt: null,
    AND: [{ status: { notIn: ['PENDING', 'REJECTED'] } }],
    status: 'UPCOMING',
    kickoffAt: { gte: iso(0), lte: iso(24 * HOUR) },
  })
})

test('the all tab and activeOnly keep their own unchanged filters', () => {
  assert.deepEqual(normalizedWhere({}), { deletedAt: null, AND: [{ status: { notIn: ['PENDING', 'REJECTED'] } }] })
  assert.deepEqual(normalizedWhere({ activeOnly: true }), {
    deletedAt: null,
    AND: [{ status: { notIn: ['PENDING', 'REJECTED'] } }],
    OR: [{ status: 'LIVE' }, { status: 'UPCOMING', kickoffAt: { gte: iso(0), lte: iso(24 * HOUR) } }],
  })
})

test('premium is only applied when the caller asks for it', () => {
  assert.equal(buildMatchListWhere({ recentOnly: true }, NOW).premium, undefined)
  assert.equal(buildMatchListWhere({ recentOnly: true, premium: true }, NOW).premium, true)
  assert.equal(buildMatchListWhere({ recentOnly: true, premium: false }, NOW).premium, false)
})
