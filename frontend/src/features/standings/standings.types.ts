export interface StandingTeam {
  rank: number
  team: {
    id: number | string
    name: string
    logo?: string | null
  }
  points: number
  played: number
  win: number
  draw: number
  loss: number
  goalsFor: number
  goalsAgainst: number
  goalDifference: number
  form?: string | null
  status?: string | null
  group?: string | null
}

export interface StandingsTable {
  league: {
    id: number | string
    name: string
    country: string
    logo?: string | null
    season: number
  }
  table: StandingTeam[]
}
