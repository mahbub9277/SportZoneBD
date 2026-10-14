import type { Match } from './matches.types'

export type MatchStatus = 'LIVE' | 'UPCOMING' | 'FINISHED'

export const getMatchStatus = (match: Pick<Match, 'status'>): MatchStatus | null => {
  const status = typeof match.status === 'string' ? match.status.trim().toUpperCase() : ''
  return status === 'LIVE' || status === 'UPCOMING' || status === 'FINISHED' ? status : null
}

export const RECENT_PRE_KICKOFF_WINDOW_MS = 20 * 60 * 1000
export const LIVE_SECTION_FINISHED_GRACE_MS = 20 * 60 * 1000

const getTimestamp = (value?: string | null): number | null => {
  if (typeof value !== 'string' || value.trim() === '') return null
  const timestamp = new Date(value).getTime()
  return Number.isFinite(timestamp) ? timestamp : null
}

const getKickoffTimestamp = (match: Match) => getTimestamp(match.kickoffAt)

const compareTimestamps = (left: number | null, right: number | null, descending = false): number => {
  if (left === null) return right === null ? 0 : 1
  if (right === null) return -1
  return descending ? right - left : left - right
}

const uniqueMatches = (matches: readonly Match[]): Match[] => {
  const seenIds = new Set<string>()
  return matches.filter((match) => {
    if (seenIds.has(match.id)) return false
    seenIds.add(match.id)
    return true
  })
}

/** Live first (newest kickoff first), then what starts next, then what is already over. */
const STATUS_PRIORITY = { LIVE: 0, UPCOMING: 1, FINISHED: 2 } as const

const getStatusPriority = (status: MatchStatus | null) => status === null ? 3 : STATUS_PRIORITY[status]

export const sortMatches = (matches: Match[]): Match[] => uniqueMatches(matches).sort((left, right) => {
  const leftStatus = getMatchStatus(left)
  const rightStatus = getMatchStatus(right)
  const statusOrder = getStatusPriority(leftStatus) - getStatusPriority(rightStatus)
  if (statusOrder !== 0) return statusOrder

  const kickoffOrder = compareTimestamps(
    getKickoffTimestamp(left),
    getKickoffTimestamp(right),
    leftStatus === 'LIVE' || leftStatus === 'FINISHED',
  )
  if (kickoffOrder !== 0) return kickoffOrder

  return String(left.id).localeCompare(String(right.id))
})

/**
 * Relevance order for the Recent feed: newest-started live matches, fixtures starting soonest, then
 * the ones that just finished (most recently finished first). `startTime` is deliberately not used:
 * the backend also sets it to a pre-match monitoring time, so it is not a reliable live-transition time.
 */
export const rankRecentMatches = (matches: Match[]): Match[] => uniqueMatches(matches).sort((left, right) => {
  const leftStatus = getMatchStatus(left)
  const rightStatus = getMatchStatus(right)
  const statusOrder = getStatusPriority(leftStatus) - getStatusPriority(rightStatus)
  if (statusOrder !== 0) return statusOrder

  if (leftStatus === 'LIVE') {
    const liveOrder = compareTimestamps(getKickoffTimestamp(left), getKickoffTimestamp(right), true)
    if (liveOrder !== 0) return liveOrder
  }

  if (leftStatus === 'FINISHED') {
    const finishedOrder = compareTimestamps(getTimestamp(left.finishedAt), getTimestamp(right.finishedAt), true)
    if (finishedOrder !== 0) return finishedOrder
  }

  const kickoffOrder = compareTimestamps(
    getKickoffTimestamp(left),
    getKickoffTimestamp(right),
    leftStatus === 'FINISHED',
  )
  if (kickoffOrder !== 0) return kickoffOrder

  return String(left.id).localeCompare(String(right.id))
})

export const isUpcomingMatchRecent = (match: Match, now: number): boolean => {
  if (getMatchStatus(match) !== 'UPCOMING') return false
  const kickoffAt = getKickoffTimestamp(match)
  return kickoffAt !== null
    && kickoffAt > now
    && kickoffAt - RECENT_PRE_KICKOFF_WINDOW_MS <= now
}

/**
 * Applies the shared Recent membership rule to the backend's existing recent-candidate set.
 * The backend remains responsible for its existing live, finished-retention and newly-added rules.
 */
export const selectRecentMatches = (matches: Match[], now: number): Match[] =>
  rankRecentMatches(matches.filter((match) => {
    const status = getMatchStatus(match)
    return status === 'LIVE' || status === 'FINISHED' || isUpcomingMatchRecent(match, now)
  }))

/**
 * A recently finished match can remain in the Live section briefly, but its status stays FINISHED.
 * Missing, invalid, or future finish timestamps are not treated as a new finish.
 */
export const selectLiveSectionMatches = (matches: Match[], now: number): Match[] =>
  rankRecentMatches(matches.filter((match) => {
    const status = getMatchStatus(match)
    if (status === 'LIVE') return true
    if (status !== 'FINISHED') return false

    const finishedAt = getTimestamp(match.finishedAt)
    return finishedAt !== null
      && finishedAt <= now
      && now - finishedAt < LIVE_SECTION_FINISHED_GRACE_MS
  }))

/** The Upcoming view keeps future fixtures visible while they are also eligible for Recent. */
export const selectUpcomingMatches = (
  matches: Match[],
  now: number,
  windowEnd: number,
  premiumOnly = false,
): Match[] =>
  sortMatches(filterMatches(matches, 'UPCOMING', premiumOnly).filter((match) => {
    const kickoffAt = getKickoffTimestamp(match)
    return kickoffAt !== null && kickoffAt >= now && kickoffAt < windowEnd
  }))

/**
 * The next local section boundary: upcoming eligibility/kickoff or recently-finished expiry.
 */
export const getNextMatchTimeBoundary = (matches: readonly Match[], now: number): number | null => {
  let nextBoundary = Number.POSITIVE_INFINITY

  for (const match of matches) {
    const status = getMatchStatus(match)
    if (status === 'FINISHED') {
      const finishedAt = getTimestamp(match.finishedAt)
      if (finishedAt === null || finishedAt > now) continue

      const boundary = finishedAt + LIVE_SECTION_FINISHED_GRACE_MS
      if (boundary > now && boundary < nextBoundary) nextBoundary = boundary
      continue
    }
    if (status !== 'UPCOMING') continue

    const kickoffAt = getKickoffTimestamp(match)
    if (kickoffAt === null || kickoffAt < now) continue

    const recentWindowStartsAt = kickoffAt - RECENT_PRE_KICKOFF_WINDOW_MS
    const boundary = kickoffAt === now
      ? kickoffAt + 1
      : recentWindowStartsAt > now
        ? recentWindowStartsAt
        : kickoffAt
    if (boundary < nextBoundary) nextBoundary = boundary
  }

  return Number.isFinite(nextBoundary) ? nextBoundary : null
}

export const filterMatches = (matches: Match[], status?: MatchStatus | null, premiumOnly = false): Match[] =>
  matches.filter((match) => {
    const matchStatus = getMatchStatus(match)
    return (!status || matchStatus === status) && (!premiumOnly || match.premium === true)
  })
