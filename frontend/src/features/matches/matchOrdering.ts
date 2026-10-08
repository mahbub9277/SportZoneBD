import type { Match } from './matches.types'

export type MatchStatus = 'LIVE' | 'UPCOMING' | 'FINISHED'

export const getMatchStatus = (match: Pick<Match, 'status'>): MatchStatus | null => {
  const status = match.status?.toUpperCase()
  return status === 'LIVE' || status === 'UPCOMING' || status === 'FINISHED' ? status : null
}

const getTime = (value?: string | null) => {
  const time = value ? new Date(value).getTime() : NaN
  return Number.isFinite(time) ? time : 0
}

/** Live first, then what starts next, then what is already over. Shared by both orderings below. */
const STATUS_PRIORITY = { LIVE: 0, UPCOMING: 1, FINISHED: 2 } as const

const getStatusPriority = (status: MatchStatus | null) => status === null ? 3 : STATUS_PRIORITY[status]

export const sortMatches = (matches: Match[]): Match[] => [...matches].sort((left, right) => {
  const leftStatus = getMatchStatus(left)
  const rightStatus = getMatchStatus(right)
  const statusOrder = getStatusPriority(leftStatus) - getStatusPriority(rightStatus)
  if (statusOrder !== 0) return statusOrder

  const leftKickoff = getTime(left.kickoffAt)
  const rightKickoff = getTime(right.kickoffAt)
  if (leftStatus === 'FINISHED') {
    if (leftKickoff !== rightKickoff) return rightKickoff - leftKickoff
  } else if (leftKickoff !== rightKickoff) {
    return leftKickoff - rightKickoff
  }

  return String(left.id).localeCompare(String(right.id))
})

/**
 * Relevance order for the Recent feed: matches happening now, then the fixtures starting soonest, then
 * the ones that just finished (most recently finished first). The status ordering is the same as
 * `sortMatches`, so a match never moves for a reason other than its own real timestamps.
 */
export const rankRecentMatches = (matches: Match[]): Match[] => [...matches].sort((left, right) => {
  const leftStatus = getMatchStatus(left)
  const rightStatus = getMatchStatus(right)
  const statusOrder = getStatusPriority(leftStatus) - getStatusPriority(rightStatus)
  if (statusOrder !== 0) return statusOrder

  if (leftStatus === 'FINISHED') {
    const leftFinished = getTime(left.finishedAt)
    const rightFinished = getTime(right.finishedAt)
    if (leftFinished !== rightFinished) return rightFinished - leftFinished
  }

  const leftKickoff = getTime(left.kickoffAt)
  const rightKickoff = getTime(right.kickoffAt)
  if (leftKickoff !== rightKickoff) return leftStatus === 'FINISHED' ? rightKickoff - leftKickoff : leftKickoff - rightKickoff

  return String(left.id).localeCompare(String(right.id))
})

export const filterMatches = (matches: Match[], status?: MatchStatus | null, premiumOnly = false): Match[] =>
  matches.filter((match) => {
    const matchStatus = getMatchStatus(match)
    return (!status || matchStatus === status) && (!premiumOnly || match.premium === true)
  })
