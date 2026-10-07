/**
 * Canonical team-name key.
 *
 * This is the exact value stored in `Team.normalizedName`, so every producer and consumer of team
 * identity must agree on it. It lives in its own module (free of Prisma) so that pure helpers and
 * tests can reuse it without paying for a database client import.
 */
export const normalizeTeamName = (name: string): string => name.trim().replace(/\s+/g, ' ').toLowerCase()
