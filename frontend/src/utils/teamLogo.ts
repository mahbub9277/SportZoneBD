/**
 * @file Team-logo reference resolution — the one place every surface resolves team branding.
 *
 * A team logo can come from three places, and they are not equivalent:
 *
 * 1. **An assigned asset** — the logo stored for the team or the match by an administrator (a Cloudinary
 *    public id, an already-delivered Cloudinary URL, or a local preview). This always wins.
 * 2. **A provider crest** — `crests.football-data.org` (football-data.org) and `media.api-sports.io`
 *    (API-Football) serve the crest the providers themselves publish, which the project already renders on
 *    the Standings page and on match cards. It is used only when nothing was assigned.
 * 3. **Nothing usable** — the caller keeps its initials fallback.
 *
 * Two rules are enforced here rather than in each component:
 *
 * - An assigned logo beats a provider crest **regardless of the order the candidates are passed in**, so an
 *   administrator's override cannot be shadowed by provider data anywhere in the app.
 * - A reference the project has no licence to serve is never requested by the page. CricketData hosts its
 *   team images on its own CDN and does not permit hotlinking, so those are dropped even when one is still
 *   stored on an older record (the cricket normalizer no longer writes them).
 *
 * Nothing here fetches anything: resolution is a pure function of values already in the payload, which is
 * what keeps it free to run on every render.
 */

import { buildCloudinaryUrl, type CloudinaryTransformations } from './cloudinary.ts'

/** Hosts whose images must never be requested from the page. */
const NON_HOTLINKABLE_HOSTS = ['cricapi.com']

/**
 * Hosts that serve a provider's own crest. The app may display these (it already does), but they are not
 * assets it owns, so they never take priority over an assigned logo and are never stored as one.
 */
const PROVIDER_LOGO_HOSTS = ['crests.football-data.org', 'media.api-sports.io']

export type TeamLogoSource = 'assigned' | 'provider'

/** What a stored reference actually is. */
export type TeamLogoReferenceKind = TeamLogoSource | 'blocked' | 'none'

const readHost = (value: string): string | null => {
  if (!/^(?:https?:)?\/\//i.test(value)) return null
  try {
    return new URL(value.startsWith('//') ? `https:${value}` : value).hostname.toLowerCase()
  } catch {
    // An unparseable URL cannot be classified here; the image element's own error handling covers it.
    return null
  }
}

const matchesHost = (host: string, hosts: readonly string[]): boolean =>
  hosts.some((candidate) => host === candidate || host.endsWith(`.${candidate}`))

/**
 * Whether a stored reference may be requested by the browser.
 *
 * The host is compared as a whole label suffix (`g.cricapi.com` is blocked, `notcricapi.com` is not), so a
 * lookalike domain is never treated as the blocked provider. A value that is not an absolute http(s) URL —
 * a relative public id, a `data:` or `blob:` preview — has nothing to hotlink and stays usable.
 */
export function isHotlinkableTeamLogo(reference: string): boolean {
  const host = readHost(reference.trim())
  return !host || !matchesHost(host, NON_HOTLINKABLE_HOSTS)
}

/** Classifies a reference so the priority rule can be applied without guessing from the call order. */
export function classifyTeamLogoReference(reference: string | null | undefined): TeamLogoReferenceKind {
  const value = (reference ?? '').trim()
  if (!value) return 'none'

  const host = readHost(value)
  if (host && matchesHost(host, NON_HOTLINKABLE_HOSTS)) return 'blocked'
  if (host && matchesHost(host, PROVIDER_LOGO_HOSTS)) return 'provider'
  return 'assigned'
}

/**
 * The URL a team logo should be rendered with, or `null` when the caller must fall back instead.
 *
 * @param reference - The stored logo reference (public id or URL).
 * @param transformations - The transformations to deliver the logo with.
 */
export function resolveTeamLogoUrl(
  reference: string | null | undefined,
  transformations: CloudinaryTransformations = {},
): string | null {
  const value = (reference ?? '').trim()
  if (!value || !isHotlinkableTeamLogo(value)) return null
  return buildCloudinaryUrl(value, transformations)
}

export interface SelectedTeamLogo {
  url: string | null
  /** Where the rendered logo came from, or null when there is nothing to render. */
  source: TeamLogoSource | null
}

/**
 * Chooses the logo to render from the candidates a component holds, in priority order by *kind*: an
 * assigned logo wins over a provider crest however the candidates are ordered, and a blocked or empty
 * reference contributes nothing. A `null` result means "render the initials fallback".
 *
 * @param candidates - Every reference the component knows for this team (assigned and provider alike).
 * @param transformations - The transformations to deliver the logo with.
 */
export function selectTeamLogo(
  candidates: Array<string | null | undefined>,
  transformations: CloudinaryTransformations = {},
): SelectedTeamLogo {
  let providerUrl: string | null = null

  for (const candidate of candidates) {
    const kind = classifyTeamLogoReference(candidate)
    if (kind === 'assigned') return { url: resolveTeamLogoUrl(candidate, transformations), source: 'assigned' }
    if (kind === 'provider' && !providerUrl) {
      providerUrl = resolveTeamLogoUrl(candidate, transformations)
    }
  }

  return providerUrl ? { url: providerUrl, source: 'provider' } : { url: null, source: null }
}

export interface TeamInitialsOptions {
  /** The provider's short name, used before falling back to the full name. */
  shortName?: string | null
  /** The provider's three-letter code, which is the most stable short label when it exists. */
  tla?: string | null
  /** How many characters a name-derived label may use. */
  length?: number
  /** Shown when nothing usable is known, for example `T1` for an unnamed home side. */
  fallback?: string
}

/**
 * The initials shown when a team has no usable logo. Derived only from what the provider or the record
 * already states, so the same team reads the same way everywhere.
 */
export function teamInitials(name: string | null | undefined, options: TeamInitialsOptions = {}): string {
  const { shortName, tla, length = 2, fallback = '' } = options
  const code = tla?.trim()
  if (code) return code.toUpperCase()

  const short = shortName?.trim()
  if (short) return short.slice(0, Math.max(length, 3)).toUpperCase()

  const full = name?.trim().replace(/\s+/g, ' ')
  return full ? full.slice(0, length).toUpperCase() : fallback
}
