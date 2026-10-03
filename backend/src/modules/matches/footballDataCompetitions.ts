export type FootballDataCompetitionType = 'LEAGUE' | 'CUP'

interface FootballDataCompetitionDefinition {
  code: string
  name: string
  type: FootballDataCompetitionType
  matchDiscoverySupported: boolean
  standingsSupported: boolean
}

export const FOOTBALL_DATA_COMPETITIONS = [
  { code: 'PL', name: 'Premier League', type: 'LEAGUE', matchDiscoverySupported: true, standingsSupported: true },
  { code: 'PD', name: 'La Liga', type: 'LEAGUE', matchDiscoverySupported: true, standingsSupported: true },
  { code: 'CL', name: 'UEFA Champions League', type: 'CUP', matchDiscoverySupported: true, standingsSupported: true },
  { code: 'SA', name: 'Serie A', type: 'LEAGUE', matchDiscoverySupported: true, standingsSupported: true },
  { code: 'BL1', name: 'Bundesliga', type: 'LEAGUE', matchDiscoverySupported: true, standingsSupported: true },
  { code: 'DED', name: 'Eredivisie', type: 'LEAGUE', matchDiscoverySupported: true, standingsSupported: true },
  { code: 'BSA', name: 'Campeonato Brasileiro Série A', type: 'LEAGUE', matchDiscoverySupported: true, standingsSupported: true },
  { code: 'FL1', name: 'Ligue 1', type: 'LEAGUE', matchDiscoverySupported: true, standingsSupported: true },
  { code: 'ELC', name: 'Championship', type: 'LEAGUE', matchDiscoverySupported: true, standingsSupported: true },
  { code: 'PPL', name: 'Primeira Liga', type: 'LEAGUE', matchDiscoverySupported: true, standingsSupported: true },
  { code: 'WC', name: 'FIFA World Cup', type: 'CUP', matchDiscoverySupported: true, standingsSupported: false },
  { code: 'EC', name: 'European Championship', type: 'CUP', matchDiscoverySupported: true, standingsSupported: false },
] as const satisfies readonly FootballDataCompetitionDefinition[]

export type FootballDataCompetitionCode = typeof FOOTBALL_DATA_COMPETITIONS[number]['code']
export type StandingsCompetitionCode = Extract<
  typeof FOOTBALL_DATA_COMPETITIONS[number],
  { standingsSupported: true }
>['code']