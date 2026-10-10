export type LeagueCode = string

export interface StandingsCompetition {
  code: LeagueCode
  name: string
  type: 'LEAGUE' | 'CUP'
  matchDiscoverySupported: boolean
  standingsSupported: boolean
}

export interface LeagueStanding {
  position: number
  team: {
    id: number
    name: string
    shortName: string | null
    tla: string | null
    crest: string | null
    /** The logo SportZoneBD stores for this team; it takes priority over the provider crest when set. */
    assignedLogo?: string | null
  }
  playedGames: number
  won: number
  draw: number
  lost: number
  goalsFor: number
  goalsAgainst: number
  goalDifference: number
  points: number
  description: string | null
}

export interface LeagueStandingsResponse {
  competition: {
    code: LeagueCode
    name: string
    emblem: string | null
  }
  season: {
    id: number
    startDate: string | null
    endDate: string | null
    currentMatchday: number | null
  }
  standings: LeagueStanding[]
  meta: {
    source: 'football-data.org' | 'cache'
    cached: boolean
    stale: boolean
  }
}

