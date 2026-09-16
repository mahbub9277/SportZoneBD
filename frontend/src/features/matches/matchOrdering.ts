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

export const sortMatches = (matches: Match[]): Match[] => [...matches].sort((left, right) => {
  const leftStatus = getMatchStatus(left)
  const rightStatus = getMatchStatus(right)
  const priority = { LIVE: 0, UPCOMING: 1, FINISHED: 2 }
  const statusOrder = (leftStatus === null ? 3 : priority[leftStatus]) - (rightStatus === null ? 3 : priority[rightStatus])
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

export const filterMatches = (matches: Match[], status?: MatchStatus | null, premiumOnly = false): Match[] =>
  matches.filter((match) => {
    const matchStatus = getMatchStatus(match)
    return (!status || matchStatus === status) && (!premiumOnly || match.premium === true)
  })
