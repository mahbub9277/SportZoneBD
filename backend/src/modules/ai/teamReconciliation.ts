import { normalizeTeamName } from '../teams/teamName.js'
import { normalizeBangla } from './matchParser.js'

/**
 * Turns the team names found by the parser (and by Gemini) into existing database teams.
 *
 * The rule is deliberately strict — names must match exactly after canonicalisation, optionally
 * ignoring a club affix ("FC Barcelona" ⇄ "Barcelona") — because a fuzzy match would silently attach
 * the wrong team, logo or id to a match. Anything less certain keeps the name only, and the admin
 * form stays editable.
 */

export interface TeamRecord {
  id: string
  name: string
  normalizedName: string
  logoUrl: string | null
}

/** A previously saved match, used only as a last-resort logo source. */
export interface LegacyTeamSnapshot {
  homeTeamName: string | null
  awayTeamName: string | null
  homeTeamLogo: string | null
  awayTeamLogo: string | null
}

export interface ReconciledTeam {
  id: string | null
  name: string
  logo: string | null
}

/** Club prefixes/suffixes that may or may not be part of the stored team name. */
const CLUB_AFFIXES = new Set(['fc', 'cf', 'sc', 'ac', 'afc', 'cfc', 'rb', 'cd', 'ud', 'sv', 'as', 'bk', 'kc', 'ss', 'club'])

/** Canonical key of a name mention: Unicode-normalised, then the shared `normalizedName` rule. */
export function canonicalTeamKey(name: string | null | undefined): string {
  if (!name) return ''
  return normalizeTeamName(normalizeBangla(name))
}

export function stripClubAffixes(key: string): string {
  const tokens = key.split(' ').filter(Boolean)
  while (tokens.length > 1 && CLUB_AFFIXES.has(tokens[0])) tokens.shift()
  while (tokens.length > 1 && CLUB_AFFIXES.has(tokens[tokens.length - 1])) tokens.pop()
  return tokens.join(' ')
}

/** Keys to query `Team.normalizedName` with for a given mention. */
export function teamLookupKeys(name: string | null | undefined): string[] {
  const base = canonicalTeamKey(name)
  if (!base) return []
  const keys = new Set([base])
  const core = stripClubAffixes(base)
  if (core) keys.add(core)
  return [...keys]
}

function isSameTeam(recordKey: string, base: string, core: string): boolean {
  if (recordKey === base) return true
  const recordCore = stripClubAffixes(recordKey)
  return recordCore === core && (recordCore !== recordKey || core !== base)
}

/** Picks the stored team for a mention, preferring an exact match over an affix-insensitive one. */
export function pickReconciledTeam(records: TeamRecord[], name: string | null | undefined): ReconciledTeam | null {
  const base = canonicalTeamKey(name)
  if (!base) return null
  const core = stripClubAffixes(base)

  const exact = records.find((record) => canonicalTeamKey(record.name) === base || canonicalTeamKey(record.normalizedName) === base)
  if (exact) return { id: exact.id, name: exact.name, logo: exact.logoUrl }

  // "FC Barcelona" for "Barcelona" is a normal spelling difference, but when more than one stored
  // team matches by core, guessing would attach the wrong logo and id — the admin keeps the name only.
  const variants = records.filter((record) => isSameTeam(canonicalTeamKey(record.name), base, core))
  const unique = variants.length === 1 ? variants[0] : undefined
  return unique ? { id: unique.id, name: unique.name, logo: unique.logoUrl } : null
}

/** Last-resort logo lookup from previously saved matches that used this team name. */
export function pickLegacyTeamLogo(snapshots: LegacyTeamSnapshot[], name: string | null | undefined): string | null {
  const base = canonicalTeamKey(name)
  if (!base) return null
  const core = stripClubAffixes(base)

  for (const snapshot of snapshots) {
    const pairs: Array<[string | null, string | null]> = [
      [snapshot.homeTeamName, snapshot.homeTeamLogo],
      [snapshot.awayTeamName, snapshot.awayTeamLogo],
    ]
    for (const [snapshotName, logo] of pairs) {
      if (!logo) continue
      const snapshotKey = canonicalTeamKey(snapshotName)
      if (snapshotKey && isSameTeam(snapshotKey, base, core)) return logo
    }
  }
  return null
}
