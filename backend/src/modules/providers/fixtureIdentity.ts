import type { CanonicalFixture } from './types.js'

/**
 * Fixture identity and review state, kept as pure functions so the automatic-discovery decisions
 * ("does this fixture already exist?", "did an admin already reject it?") are testable without a
 * database.
 */

/** Team-name normalisation used for fixture identity. Behaviour is unchanged from the automation service. */
export function normalizeFixtureName(value: string | null | undefined): string {
  return (value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9\s]/g, ' ')
    .replace(/\b(?:fc|cf|sc|ac|afc|cfc)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

/**
 * Kickoff-independent identity of a fixture: the two teams. A provider that moves a kickoff (or that
 * re-issues a fixture id after a postponement) still describes the same match, so review decisions and
 * existing rows have to be recognised without depending on the scheduled instant.
 */
export function getTeamsIdentity(homeTeamName: string | null | undefined, awayTeamName: string | null | undefined): string {
  return `${normalizeFixtureName(homeTeamName)}|${normalizeFixtureName(awayTeamName)}`
}

export interface ReviewStateRow {
  providerFixtureKey: string | null
  homeTeamName: string | null
  awayTeamName: string | null
  status: string
  deletedAt: Date | null
}

export interface RejectedFixtureLookup {
  keys: Set<string>
  teams: Set<string>
}

/**
 * A row an admin has rejected, in either of the two shapes rejection has ever had:
 * the explicit REJECTED review state, or the soft-deleted PENDING row older releases wrote.
 * A soft-deleted *published* match is an ordinary removal and is deliberately not a rejection.
 */
export const isRejectedRow = (row: Pick<ReviewStateRow, 'status' | 'deletedAt'>): boolean =>
  row.status === 'REJECTED' || (row.deletedAt !== null && row.status === 'PENDING')

export function buildRejectedFixtureLookup(rows: ReviewStateRow[]): RejectedFixtureLookup {
  const keys = new Set<string>()
  const teams = new Set<string>()

  for (const row of rows) {
    if (!isRejectedRow(row)) continue
    const key = row.providerFixtureKey?.trim()
    if (key) keys.add(key)
    const teamsIdentity = getTeamsIdentity(row.homeTeamName, row.awayTeamName)
    if (teamsIdentity !== '|') teams.add(teamsIdentity)
  }

  return { keys, teams }
}

/**
 * True when this fixture was already reviewed and rejected. The provider key is checked first, and the
 * team identity is the backstop for fixtures whose stored key embeds the old kickoff (a reschedule
 * changes that key, which used to let a rejected fixture come back as a new pending row).
 */
export function isFixtureRejected(
  lookup: RejectedFixtureLookup,
  providerFixtureKey: string,
  teamsIdentity: string,
): boolean {
  return lookup.keys.has(providerFixtureKey) || lookup.teams.has(teamsIdentity)
}

export interface ExistingMatchRow {
  id: string
  providerFixtureKey: string | null
  homeTeamName: string | null
  awayTeamName: string | null
  kickoffAt: Date | null
}

export interface ResolveExistingFixtureOptions {
  /** How far a kickoff may differ before the same two teams stop describing the same fixture. */
  identityWindowMs: number
  /** Lower is more authoritative; used to pick the canonical row when several describe one fixture. */
  rankOwner?: (row: ExistingMatchRow) => number
}

/**
 * The stored row this provider fixture belongs to, or null when it is genuinely new.
 *
 * 1. the provider's own fixture key (stable while the provider keeps its fixture id), then
 * 2. the same two teams inside the identity window, which survives kickoff moves and re-issued ids.
 *
 * Returns null only when nothing plausible exists, so a reschedule updates the existing row instead of
 * creating a second pending copy of a fixture an admin already approved.
 */
export function resolveExistingFixture<S extends ExistingMatchRow>(
  fixture: Pick<CanonicalFixture, 'homeTeamName' | 'awayTeamName' | 'kickoffAt'>,
  providerFixtureKey: string,
  candidates: readonly S[],
  options: ResolveExistingFixtureOptions,
): S | null {
  const byKey = candidates.find((candidate) => candidate.providerFixtureKey === providerFixtureKey)
  if (byKey) return byKey

  const kickoff = Date.parse(fixture.kickoffAt)
  if (!Number.isFinite(kickoff)) return null

  const teamsIdentity = getTeamsIdentity(fixture.homeTeamName, fixture.awayTeamName)
  const matches = candidates.filter((candidate) => {
    if (!candidate.kickoffAt) return false
    if (getTeamsIdentity(candidate.homeTeamName, candidate.awayTeamName) !== teamsIdentity) return false
    return Math.abs(candidate.kickoffAt.getTime() - kickoff) <= options.identityWindowMs
  })
  if (matches.length === 0) return null

  const rankOwner = options.rankOwner
  return rankOwner ? matches.reduce((best, row) => rankOwner(row) < rankOwner(best) ? row : best) : matches[0]
}
