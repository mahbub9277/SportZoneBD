/**
 * Which team logos a SportZoneBD team record is allowed to store.
 *
 * A team record's `logoUrl` / `logoPublicId` are the project's own assets: an administrator uploads them
 * to Cloudinary, and they are meant to be the one logo every surface shows for that team. A provider crest
 * is a different thing — football-data.org and API-Football publish it, the project may display it, but it
 * is not an asset the project owns, so it must never end up in those columns:
 *
 * - it would silently replace a curated logo with provider data on the next match save,
 * - `logoPublicId` is read as a Cloudinary public id by the asset-cleanup paths, and a provider URL there
 *   would make an asset look referenced (or deletable) for the wrong reason,
 * - the crest already travels on the match row itself (`homeTeamLogo`), which is where a fixture's
 *   provider branding belongs.
 *
 * This module is pure, so the rule is testable without a database.
 */

/** Hosts that serve a provider's own crest. */
export const PROVIDER_LOGO_HOSTS = ['crests.football-data.org', 'media.api-sports.io'] as const

const readHost = (value: string): string | null => {
  if (!/^(?:https?:)?\/\//i.test(value)) return null
  try {
    return new URL(value).hostname.toLowerCase()
  } catch {
    return null
  }
}

/** Whether a reference is a crest served by one of the fixture providers rather than an owned asset. */
export function isProviderLogoCrest(reference: string | null | undefined): boolean {
  const value = (reference ?? '').trim()
  if (!value) return false

  const host = readHost(value)
  if (!host) return false
  return PROVIDER_LOGO_HOSTS.some((provider) => host === provider || host.endsWith(`.${provider}`))
}

/**
 * The logo columns a team write may carry for the given input.
 *
 * An owned asset (a Cloudinary public id, a delivery URL or a local preview) is stored in both columns,
 * exactly as before. A provider crest, a blank value or nothing at all produces no columns, so the record
 * keeps whatever an administrator assigned.
 */
export function assignedTeamLogoFields(reference: string | null | undefined): { logoUrl?: string; logoPublicId?: string } {
  const value = (reference ?? '').trim()
  if (!value || isProviderLogoCrest(value)) return {}
  return { logoUrl: value, logoPublicId: value }
}
