/**
 * The admin-managed team logo for a standings table.
 *
 * The Standings page is rendered from the provider payload, so it can only show the crest football-data.org
 * publishes. When an administrator assigned a logo to a team, that logo is the one the rest of the app
 * shows — so it is attached here, after the cached provider payload is read and never inside it, which
 * keeps an override visible immediately instead of after the cache expires.
 *
 * The lookup is one query for the whole table (no per-row query), and it matches on the canonical team key
 * the rest of the system uses (`Team.normalizedName`, an exact normalized match). Nothing is resolved by
 * substring, so a team can never inherit another team's logo.
 */

import { prisma } from '../../core/prisma.js'
import logger from '../../core/logger.js'
import { normalizeTeamName } from '../teams/teamName.js'
import type { LeagueStanding, LeagueStandingsResponse } from './footballDataStandings.service.js'

/** A standing's team as the API returns it, including the project's own logo when one is assigned. */
export interface StandingsTeamWithAssignedLogo {
  id: number
  name: string
  shortName: string | null
  tla: string | null
  crest: string | null
  /** The logo stored for this team in SportZoneBD, or null when the provider crest is all there is. */
  assignedLogo: string | null
}

export type StandingsResponseWithAssignedLogos = Omit<LeagueStandingsResponse, 'standings'> & {
  standings: Array<Omit<LeagueStanding, 'team'> & { team: StandingsTeamWithAssignedLogo }>
}

interface TeamLogoRecord {
  normalizedName: string
  logoUrl: string | null
}

/**
 * Applies a normalized-name → logo mapping to a standings table. Pure, so the matching rule is testable
 * without a database.
 */
export function applyAssignedTeamLogos(
  standings: LeagueStanding[],
  logos: TeamLogoRecord[],
): Array<Omit<LeagueStanding, 'team'> & { team: StandingsTeamWithAssignedLogo }> {
  const byNormalizedName = new Map<string, string | null>()
  for (const team of logos) {
    const logo = team.logoUrl?.trim()
    // A blank value is not an override, and the first real one wins if two records normalize the same.
    if (logo && !byNormalizedName.get(team.normalizedName)) byNormalizedName.set(team.normalizedName, logo)
  }

  return standings.map((standing) => ({
    ...standing,
    team: {
      ...standing.team,
      assignedLogo: byNormalizedName.get(normalizeTeamName(standing.team.name)) ?? null,
    },
  }))
}

/**
 * Attaches the assigned logo of every team in the table.
 *
 * A database problem must not take the standings down: when the lookup fails the provider crest is still
 * returned, exactly as before.
 */
export async function attachAssignedTeamLogos(
  response: LeagueStandingsResponse,
): Promise<StandingsResponseWithAssignedLogos> {
  const normalizedNames = [...new Set(response.standings.map((standing) => normalizeTeamName(standing.team.name)))]
  if (normalizedNames.length === 0) {
    return { ...response, standings: applyAssignedTeamLogos(response.standings, []) }
  }

  try {
    const teams = await prisma.team.findMany({
      where: { deletedAt: null, normalizedName: { in: normalizedNames } },
      select: { normalizedName: true, logoUrl: true },
    })
    return { ...response, standings: applyAssignedTeamLogos(response.standings, teams) }
  } catch (error) {
    logger.warn({ error }, 'Team logo lookup for standings failed; serving the provider crests only')
    return { ...response, standings: applyAssignedTeamLogos(response.standings, []) }
  }
}
