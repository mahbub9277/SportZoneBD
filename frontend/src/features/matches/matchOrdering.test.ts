import test from 'node:test'
import assert from 'node:assert/strict'
import {
  getNextMatchTimeBoundary,
  isUpcomingMatchRecent,
  LIVE_SECTION_FINISHED_GRACE_MS,
  rankRecentMatches,
  RECENT_PRE_KICKOFF_WINDOW_MS,
  selectLiveSectionMatches,
  selectRecentMatches,
  selectUpcomingMatches,
  sortMatches,
} from './matchOrdering.ts'
import type { Match } from './matches.types'

/**
 * Shape-only fixtures: the ordering rules are about the real timestamps a match carries, so each case
 * below states exactly the instants it is testing.
 */
const match = (id: string, status: Match['status'], kickoffAt: string, extra: Partial<Match> = {}): Match => ({
  id,
  title: `Match ${id}`,
  kickoffAt,
  status,
  premium: false,
  streams: [],
  highlights: [],
  ...extra,
})

const ids = (matches: Match[]) => matches.map(({ id }) => id)
const NOW = Date.parse('2026-10-08T12:00:00.000Z')
const isoAt = (timestamp: number) => new Date(timestamp).toISOString()

test('recent puts newest-started live matches first, then next kickoffs, then recently finished', () => {
  const ranked = rankRecentMatches([
    match('finished-old', 'FINISHED', '2026-10-01T18:00:00.000Z', { finishedAt: '2026-10-01T20:00:00.000Z' }),
    match('upcoming-later', 'UPCOMING', '2026-10-09T18:00:00.000Z'),
    match('live-b', 'LIVE', '2026-10-08T16:00:00.000Z'),
    match('upcoming-sooner', 'UPCOMING', '2026-10-08T20:00:00.000Z'),
    match('live-a', 'LIVE', '2026-10-08T12:00:00.000Z'),
    match('finished-new', 'FINISHED', '2026-10-07T18:00:00.000Z', { finishedAt: '2026-10-07T20:30:00.000Z' }),
  ])

  assert.deepEqual(ids(ranked), ['live-b', 'live-a', 'upcoming-sooner', 'upcoming-later', 'finished-new', 'finished-old'])
})

test('recent orders finished matches by when they finished, not only by kickoff', () => {
  const ranked = rankRecentMatches([
    match('kickoff-later-finished-earlier', 'FINISHED', '2026-10-07T20:00:00.000Z', { finishedAt: '2026-10-07T21:00:00.000Z' }),
    match('kickoff-earlier-finished-later', 'FINISHED', '2026-10-07T18:00:00.000Z', { finishedAt: '2026-10-07T22:00:00.000Z' }),
  ])

  assert.deepEqual(ids(ranked), ['kickoff-earlier-finished-later', 'kickoff-later-finished-earlier'])
})

test('recent never drops a match and never duplicates one', () => {
  const input = [
    match('a', 'LIVE', '2026-10-08T12:00:00.000Z'),
    match('b', 'UPCOMING', '2026-10-08T12:00:00.000Z'),
    match('c', 'FINISHED', '2026-10-06T12:00:00.000Z', { finishedAt: '2026-10-06T14:00:00.000Z' }),
  ]

  const ranked = rankRecentMatches(input)
  assert.equal(ranked.length, input.length)
  assert.deepEqual([...ids(ranked)].sort(), ['a', 'b', 'c'])
  // The input array itself is left untouched.
  assert.deepEqual(ids(input), ['a', 'b', 'c'])
})

test('recent ranking deduplicates repeated match ids without mutating the input', () => {
  const input = [
    match('same-id', 'LIVE', '2026-10-08T12:00:00.000Z'),
    match('same-id', 'LIVE', '2026-10-08T13:00:00.000Z'),
    match('other-id', 'UPCOMING', '2026-10-08T14:00:00.000Z'),
  ]

  assert.deepEqual(ids(rankRecentMatches(input)), ['same-id', 'other-id'])
  assert.deepEqual(ids(input), ['same-id', 'same-id', 'other-id'])
})

test('a finished match without a finish time sorts behind ones that have one', () => {
  const ranked = rankRecentMatches([
    match('no-finish', 'FINISHED', '2026-10-07T18:00:00.000Z'),
    match('with-finish', 'FINISHED', '2026-10-07T18:00:00.000Z', { finishedAt: '2026-10-07T20:00:00.000Z' }),
  ])

  assert.deepEqual(ids(ranked), ['with-finish', 'no-finish'])
})

test('a match with an unusable status sorts behind the real ones', () => {
  const ranked = rankRecentMatches([
    match('unknown', undefined as unknown as Match['status'], '2026-10-08T12:00:00.000Z'),
    match('upcoming', 'UPCOMING', '2026-10-09T12:00:00.000Z'),
  ])

  assert.deepEqual(ids(ranked), ['upcoming', 'unknown'])
})

test('the existing upcoming/live ordering is unchanged', () => {
  const sorted = sortMatches([
    match('finished', 'FINISHED', '2026-10-07T18:00:00.000Z', { finishedAt: '2026-10-07T20:00:00.000Z' }),
    match('upcoming', 'UPCOMING', '2026-10-09T18:00:00.000Z'),
    match('live', 'LIVE', '2026-10-08T12:00:00.000Z'),
  ])

  assert.deepEqual(ids(sorted), ['live', 'upcoming', 'finished'])
})

test('a fixture more than 20 minutes before kickoff is Upcoming but not Recent or Live', () => {
  const fixture = match('not-recent-yet', 'UPCOMING', isoAt(NOW + RECENT_PRE_KICKOFF_WINDOW_MS + 1))

  assert.deepEqual(ids(selectUpcomingMatches([fixture], NOW, NOW + 24 * 60 * 60 * 1000)), ['not-recent-yet'])
  assert.deepEqual(ids(selectRecentMatches([fixture], NOW)), [])
  assert.deepEqual(ids(sortMatches([fixture]).filter(({ status }) => status === 'LIVE')), [])
})

test('a valid upcoming fixture becomes Recent exactly 20 minutes before kickoff', () => {
  const fixture = match('at-threshold', 'UPCOMING', isoAt(NOW + RECENT_PRE_KICKOFF_WINDOW_MS))

  assert.equal(isUpcomingMatchRecent(fixture, NOW), true)
  assert.deepEqual(ids(selectRecentMatches([fixture], NOW)), ['at-threshold'])
})

test('a pre-kickoff fixture can appear in Recent and Upcoming but never Live', () => {
  const fixture = match('double-section', 'UPCOMING', isoAt(NOW + 10 * 60 * 1000))

  assert.deepEqual(ids(selectRecentMatches([fixture], NOW)), ['double-section'])
  assert.deepEqual(ids(selectUpcomingMatches([fixture], NOW, NOW + 24 * 60 * 60 * 1000)), ['double-section'])
  assert.deepEqual(ids(sortMatches([fixture]).filter(({ status }) => status === 'LIVE')), [])
})

test('Recent membership changes from the supplied clock without requiring new match data', () => {
  const fixture = match('clock-transition', 'UPCOMING', isoAt(NOW + RECENT_PRE_KICKOFF_WINDOW_MS))

  assert.deepEqual(ids(selectRecentMatches([fixture], NOW - 1)), [])
  assert.deepEqual(ids(selectRecentMatches([fixture], NOW)), ['clock-transition'])
})

test('an authoritative LIVE status is in Recent and Live and no longer Upcoming', () => {
  const fixture = match('started', 'LIVE', isoAt(NOW + 10 * 60 * 1000))

  assert.deepEqual(ids(selectRecentMatches([fixture], NOW)), ['started'])
  assert.deepEqual(ids(sortMatches([fixture]).filter(({ status }) => status === 'LIVE')), ['started'])
  assert.deepEqual(ids(selectUpcomingMatches([fixture], NOW, NOW + 24 * 60 * 60 * 1000)), [])
})

test('an Upcoming match at kickoff is not promoted to Recent or Live by the local clock', () => {
  const fixture = match('kickoff-boundary', 'UPCOMING', isoAt(NOW))
  const liveFixture = { ...fixture, status: 'LIVE' as Match['status'] }

  assert.equal(isUpcomingMatchRecent(fixture, NOW), false)
  assert.deepEqual(ids(selectRecentMatches([fixture], NOW)), [])
  assert.deepEqual(ids(selectUpcomingMatches([fixture], NOW, NOW + 1)), ['kickoff-boundary'])
  assert.deepEqual(ids(sortMatches([fixture]).filter(({ status }) => status === 'LIVE')), [])
  assert.deepEqual(ids(selectRecentMatches([liveFixture], NOW)), ['kickoff-boundary'])
  assert.equal(getNextMatchTimeBoundary([fixture], NOW), NOW + 1)
})

test('missing or invalid kickoff values are not promoted into Recent or Upcoming', () => {
  const missing = match('missing-time', 'UPCOMING', '')
  const invalid = match('invalid-time', 'UPCOMING', 'not-a-date')

  assert.deepEqual(ids(selectRecentMatches([missing, invalid], NOW)), [])
  assert.deepEqual(ids(selectUpcomingMatches([missing, invalid], NOW, NOW + 24 * 60 * 60 * 1000)), [])
  assert.equal(getNextMatchTimeBoundary([missing, invalid], NOW), null)
})

test('exceptional or unknown statuses are not promoted by a stale kickoff time', () => {
  const cancelled = { ...match('cancelled', 'UPCOMING', isoAt(NOW + 10 * 60 * 1000)), status: 'CANCELLED' as Match['status'] }

  assert.deepEqual(ids(selectRecentMatches([cancelled], NOW)), [])
  assert.deepEqual(ids(selectUpcomingMatches([cancelled], NOW, NOW + 24 * 60 * 60 * 1000)), [])
})

test('finished matches supplied by the existing recent API remain included and ordered by finish time', () => {
  const older = match('finished-older', 'FINISHED', isoAt(NOW - 2 * 60 * 60 * 1000), {
    finishedAt: isoAt(NOW - 60 * 60 * 1000),
  })
  const newer = match('finished-newer', 'FINISHED', isoAt(NOW - 3 * 60 * 60 * 1000), {
    finishedAt: isoAt(NOW - 30 * 60 * 1000),
  })

  assert.deepEqual(ids(selectRecentMatches([older, newer], NOW)), ['finished-newer', 'finished-older'])
})

test('newly-live matches sort above older live matches in Live and Recent', () => {
  const olderLive = match('live-30m', 'LIVE', isoAt(NOW - 30 * 60 * 1000))
  const newestLive = match('live-just-started', 'LIVE', isoAt(NOW - 1 * 60 * 1000))

  assert.deepEqual(ids(sortMatches([olderLive, newestLive])), ['live-just-started', 'live-30m'])
  assert.deepEqual(ids(rankRecentMatches([olderLive, newestLive])), ['live-just-started', 'live-30m'])
})

test('equal or missing timestamps sort deterministically and duplicate ids appear only once', () => {
  const tiedB = match('tie-b', 'LIVE', isoAt(NOW))
  const tiedA = match('tie-a', 'LIVE', isoAt(NOW))
  const noTime = match('no-time', 'LIVE', 'invalid')
  const duplicate = match('tie-a', 'LIVE', isoAt(NOW + 1))
  const input = [tiedB, noTime, tiedA, duplicate]

  const sorted = sortMatches(input)
  assert.deepEqual(ids(sorted), ['tie-a', 'tie-b', 'no-time'])
  assert.deepEqual(ids(sortMatches(sorted)), ids(sorted))
  assert.deepEqual(ids(input), ['tie-b', 'no-time', 'tie-a', 'tie-a'])
})

test('the local timer boundary advances from Recent eligibility to kickoff', () => {
  const fixture = match('timer', 'UPCOMING', isoAt(NOW + 60 * 60 * 1000))
  const recentWindowStartsAt = NOW + 40 * 60 * 1000
  const kickoffAt = NOW + 60 * 60 * 1000

  assert.equal(getNextMatchTimeBoundary([fixture], NOW), recentWindowStartsAt)
  assert.equal(getNextMatchTimeBoundary([fixture], recentWindowStartsAt), kickoffAt)
  assert.equal(getNextMatchTimeBoundary([fixture], kickoffAt), kickoffAt + 1)
  assert.equal(getNextMatchTimeBoundary([fixture], kickoffAt + 1), null)
})

test('the Live section retains finished matches only until the exact grace boundary', () => {
  const newestLive = match('live-1m', 'LIVE', isoAt(NOW - 60 * 1000))
  const olderLive = match('live-30m', 'LIVE', isoAt(NOW - 30 * 60 * 1000))
  const newerFinished = match('finished-1m', 'FINISHED', isoAt(NOW - 40 * 60 * 1000), {
    finishedAt: isoAt(NOW - 60 * 1000),
  })
  const olderFinished = match('finished-19m', 'FINISHED', isoAt(NOW - 60 * 60 * 1000), {
    finishedAt: isoAt(NOW - 19 * 60 * 1000),
  })
  const atBoundary = match('finished-20m', 'FINISHED', isoAt(NOW - 90 * 60 * 1000), {
    finishedAt: isoAt(NOW - LIVE_SECTION_FINISHED_GRACE_MS),
  })
  const missingFinish = match('finished-missing', 'FINISHED', isoAt(NOW - 60 * 60 * 1000))

  const input = [olderFinished, olderLive, atBoundary, newerFinished, newestLive, missingFinish]
  const selected = selectLiveSectionMatches(input, NOW)

  assert.deepEqual(ids(selected), ['live-1m', 'live-30m', 'finished-1m', 'finished-19m'])
  assert.equal(selected[2].status, 'FINISHED')
  assert.equal(selected[3].status, 'FINISHED')
  assert.deepEqual(ids(selectLiveSectionMatches(input, NOW + 60 * 1000)), ['live-1m', 'live-30m', 'finished-1m'])
  assert.deepEqual(ids(input), ['finished-19m', 'live-30m', 'finished-20m', 'finished-1m', 'live-1m', 'finished-missing'])
})

test('a missing, invalid, or future finish moment is never treated as recently finished', () => {
  const missing = match('missing', 'FINISHED', isoAt(NOW))
  const invalid = match('invalid', 'FINISHED', isoAt(NOW), { finishedAt: 'not-a-date' })
  const future = match('future', 'FINISHED', isoAt(NOW), { finishedAt: isoAt(NOW + 1) })
  const upcoming = match('upcoming', 'UPCOMING', isoAt(NOW - 1))

  assert.deepEqual(ids(selectLiveSectionMatches([missing, invalid, future, upcoming], NOW)), [])
})

test('the local match clock schedules finished-section removal without refetching', () => {
  const finishedAt = NOW - 5 * 60 * 1000
  const finished = match('finished', 'FINISHED', isoAt(finishedAt), { finishedAt: isoAt(finishedAt) })
  const expiresAt = finishedAt + LIVE_SECTION_FINISHED_GRACE_MS

  assert.equal(getNextMatchTimeBoundary([finished], NOW), expiresAt)
  assert.equal(selectLiveSectionMatches([finished], expiresAt - 1).length, 1)
  assert.equal(selectLiveSectionMatches([finished], expiresAt).length, 0)
  assert.equal(getNextMatchTimeBoundary([finished], expiresAt), null)
})
