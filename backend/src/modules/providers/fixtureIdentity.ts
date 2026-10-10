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

/**
 * Indexes stored rows by their unique provider key.
 *
 * The cycle's window query only returns live rows whose kickoff falls inside the discovery window, but
 * the unique index does not: a reviewed rejection keeps its provider key after being soft-deleted, and a
 * row created for an earlier kickoff sits outside today's window. Reading the keys a cycle is about to
 * write turns those rows into the "existing match" the ingestion loop already knows how to update,
 * instead of an insert that fails on the unique constraint on every single cycle.
 */
export function buildProviderKeyOwners<S extends { providerFixtureKey: string | null }>(
  rows: readonly S[],
): Map<string, S> {
  const owners = new Map<string, S>()
  for (const row of rows) {
    const key = row.providerFixtureKey?.trim()
    if (key) owners.set(key, row)
  }
  return owners
}

/**
 * Whether a database error is the duplicate the fixture sync expects.
 *
 * Only the provider key may be treated as an expected duplicate: it is the one unique column the
 * discovery insert writes, so a conflict on anything else is a real defect and has to keep propagating.
 * Prisma reports the conflicting columns in `meta.target`; a conflict without that evidence is not
 * verified either, so it propagates as well rather than being silently swallowed.
 */
export function isProviderFixtureKeyConflict(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false

  const candidate = error as { code?: unknown; meta?: { target?: unknown } }
  if (candidate.code !== 'P2002') return false

  const target = candidate.meta?.target
  if (typeof target === 'string') return target.includes('providerFixtureKey')
  if (Array.isArray(target)) {
    return target.some((entry) => typeof entry === 'string' && entry.includes('providerFixtureKey'))
  }
  return false
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
