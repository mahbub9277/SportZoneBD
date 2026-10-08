import type { Prisma } from '@prisma/client'
import { getUpcomingVisibilityBounds } from '../../core/upcomingWindow.js'

/**
 * The public match-list filter, kept separate from the controller so the Recent semantics below stay
 * verifiable without a database.
 */

/** How far back a finished match still counts as "recent" (also the public finished-match retention window). */
export const RECENT_MATCH_WINDOW_DAYS = 7
/** A match added to the catalogue inside this window is recent regardless of how far away its kickoff is. */
export const RECENT_MATCH_ADDED_WINDOW_HOURS = 24

export interface MatchListFilters {
  status?: 'UPCOMING' | 'LIVE' | 'FINISHED'
  premium?: boolean
  activeOnly?: boolean
  recentOnly?: boolean
}

export function buildMatchListWhere(filters: MatchListFilters, now: Date = new Date()): Prisma.MatchWhereInput {
  const { status, premium, activeOnly, recentOnly } = filters

  // The Recent feed is "what is relevant right now", not "what finished recently": a match is recent
  // while it is live, while its kickoff is imminent (the existing upcoming visibility window), while it
  // has just finished (the existing retention window) or while it was just added to the catalogue. It is
  // deliberately narrower than "All", it is no longer restricted to one sport, and the Live/Upcoming
  // branches below keep their own filters untouched.
  const recentCandidates: Prisma.MatchWhereInput[] | null = recentOnly
    ? [
        { status: 'LIVE' },
        { status: 'UPCOMING', kickoffAt: getUpcomingVisibilityBounds(now) },
        {
          status: 'FINISHED',
          kickoffAt: { lte: now },
          finishedAt: { gte: new Date(now.getTime() - RECENT_MATCH_WINDOW_DAYS * 24 * 60 * 60 * 1000), lte: now },
        },
        { createdAt: { gte: new Date(now.getTime() - RECENT_MATCH_ADDED_WINDOW_HOURS * 60 * 60 * 1000) } },
      ]
    : null

  return {
    deletedAt: null,
    // Automatic discovery stores matches as PENDING; they stay invisible to public callers until an
    // admin accepts them. Expressing it as AND makes the exclusion impossible to override by the
    // status/recent/active branches below, so ?status=PENDING cannot leak them either.
    //
    // The recent branch is nested inside the same AND for the same reason: the pagination service
    // replaces a top-level OR with its search clause, so a top-level recent OR would quietly stop
    // filtering as soon as somebody typed in the search box.
    AND: [
      { status: { not: 'PENDING' } },
      ...(recentCandidates ? [{ OR: recentCandidates }] : []),
    ],
    ...(recentOnly
      ? {}
      : status === 'UPCOMING'
        ? { status, kickoffAt: getUpcomingVisibilityBounds(now) }
        : status
          ? { status }
          : activeOnly
            ? { OR: [{ status: 'LIVE' }, { status: 'UPCOMING', kickoffAt: getUpcomingVisibilityBounds(now) }] }
            : {}),
    ...(premium !== undefined ? { premium } : {}),
  }
}
