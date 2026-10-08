import test from 'node:test'
import assert from 'node:assert/strict'
import { rankRecentMatches, sortMatches } from './matchOrdering.ts'
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

test('recent puts live matches first, then the next kickoffs, then what just finished', () => {
  const ranked = rankRecentMatches([
    match('finished-old', 'FINISHED', '2026-10-01T18:00:00.000Z', { finishedAt: '2026-10-01T20:00:00.000Z' }),
    match('upcoming-later', 'UPCOMING', '2026-10-09T18:00:00.000Z'),
    match('live-b', 'LIVE', '2026-10-08T16:00:00.000Z'),
    match('upcoming-sooner', 'UPCOMING', '2026-10-08T20:00:00.000Z'),
    match('live-a', 'LIVE', '2026-10-08T12:00:00.000Z'),
    match('finished-new', 'FINISHED', '2026-10-07T18:00:00.000Z', { finishedAt: '2026-10-07T20:30:00.000Z' }),
  ])

  assert.deepEqual(ids(ranked), ['live-a', 'live-b', 'upcoming-sooner', 'upcoming-later', 'finished-new', 'finished-old'])
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
