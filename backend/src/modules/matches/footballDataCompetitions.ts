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
  // Tournament cups stay listed for the competition selector, but their seasons are dormant
  // outside tournament years (no fixtures and no standings), so they are not polled.
  { code: 'WC', name: 'FIFA World Cup', type: 'CUP', matchDiscoverySupported: false, standingsSupported: false },
  { code: 'EC', name: 'European Championship', type: 'CUP', matchDiscoverySupported: false, standingsSupported: false },
] as const satisfies readonly FootballDataCompetitionDefinition[]

export type FootballDataCompetitionCode = typeof FOOTBALL_DATA_COMPETITIONS[number]['code']
export type StandingsCompetitionCode = Extract<
  typeof FOOTBALL_DATA_COMPETITIONS[number],
  { standingsSupported: true }
>['code']

/**
 * The competition name SportZoneBD stores and displays for a football-data.org competition.
 *
 * The provider names a competition itself ("Primera Division" for La Liga), so its payload must never
 * be trusted for a code this application already defines: the canonical name above wins. A code that
 * is not in the list (an operator-configured competition) keeps the provider's own name, because
 * inventing a name for an unknown competition would mislabel it.
 */
export function getCanonicalCompetitionName(competitionCode: string | null | undefined, providerName: string): string {
  const code = competitionCode?.trim().toUpperCase()
  return FOOTBALL_DATA_COMPETITIONS.find((competition) => competition.code === code)?.name ?? providerName
}