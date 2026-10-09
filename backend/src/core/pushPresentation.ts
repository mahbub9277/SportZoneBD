/**
 * Push presentation and identity for match alerts.
 *
 * Everything here is pure on purpose. Two things need to be exactly right and are easy to get wrong:
 * the *identity* of a reminder (which decides whether a rescheduled match can still remind its
 * viewers) and the *content* of the notification (which is built from real match data only).
 *
 * The rich content lives in `MatchPushExtras`, never in the shared `title`/`body`: those feed the
 * focused-tab toast as well, and only the browser/device push notification is in scope.
 */

export type MatchPushKind = 'reminder' | 'started'

/** The real match fields a push needs. Every one of them is already stored on the match row. */
export interface MatchPushSource {
  id: string
  title: string
  kickoffAt: Date | string
  tournamentName?: string | null
  homeTeamLogo?: string | null
  awayTeamLogo?: string | null
}

/**
 * The parts of a match push that only the browser needs.
 *
 * These are push-only fields. The shared `title`/`body` of the event are left exactly as they were,
 * because the same event also feeds the focused-tab toast; everything premium is added here instead
 * and rendered by the service worker.
 *
 * It rides along in the queue payload so the notification is built once per match instead of being
 * looked up again for every recipient.
 */
export interface MatchPushExtras {
  matchId: string
  kind: MatchPushKind
  /** The home crest, used as the notification icon. */
  icon: string | null
  /** The away crest, used as the expanded image so both teams are visible. */
  image: string | null
  /** ISO kickoff, so the browser can show the time in the viewer's own timezone. */
  kickoffAt: string | null
  /** The match's own stored competition name, or null when it is unknown. */
  competition: string | null
}

export interface MatchPushPresentation {
  /** The real status, unchanged from the text the app already used. */
  title: string
  /** The real match text, unchanged from the text the app already used. */
  body: string
  /** The click destination: always the match page, plus the schedule marker that keeps the identity stable. */
  link: string
  extras: MatchPushExtras
}

export const MATCH_REMINDER_TITLE = 'Match Starting Soon'
export const MATCH_STARTED_TITLE = 'Match Started'
export const MATCH_PUSH_WATCH_CTA = 'Tap to watch live.'
/** Longer than any real crest host URL, short enough that a payload can never be bloated by one. */
const MAX_LOGO_URL_LENGTH = 500
const MAX_COMPETITION_LENGTH = 60

/**
 * The reminder identity: the match id *and* the kickoff it was scheduled for.
 *
 * The stored notification row is what makes a broadcast idempotent, and its identity is
 * (userId, type, channel, link). Without the kickoff in that link, a match that is moved to a new time
 * could never remind its viewers again — the row from the old kickoff would suppress the new one. The
 * query string is ignored by the match route, so the click destination is unchanged.
 */
export function buildMatchPushLink(matchId: string, kickoffAt: Date | string): string {
  const kickoff = new Date(kickoffAt)
  const marker = Number.isNaN(kickoff.getTime()) ? null : String(kickoff.getTime())
  return marker ? `/matches/${matchId}?k=${marker}` : `/matches/${matchId}`
}

export interface ParsedMatchPushLink {
  matchId: string
  /** The kickoff marker the reminder was scheduled for, or null for links without one. */
  kickoffMarker: string | null
}

export function parseMatchPushLink(link: string | null | undefined): ParsedMatchPushLink | null {
  if (typeof link !== 'string') return null
  const match = link.trim().match(/^\/matches\/([0-9a-f-]{36})(?:\?k=(\d{1,15}))?$/i)
  if (!match) return null
  return { matchId: match[1], kickoffMarker: match[2] ?? null }
}

/** Keeps provider/admin text to one readable line, so a notification can never be broken by it. */
function cleanText(value: string | null | undefined, maxLength: number): string | null {
  if (typeof value !== 'string') return null
  const cleaned = value.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim()
  if (!cleaned) return null
  return cleaned.length > maxLength ? `${cleaned.slice(0, maxLength - 1).trimEnd()}…` : cleaned
}

function httpsUrl(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > MAX_LOGO_URL_LENGTH) return null
  try {
    const url = new URL(trimmed)
    return url.protocol === 'https:' && url.hostname ? url.href : null
  } catch {
    return null
  }
}

/**
 * Builds a match notification from the match's own stored data.
 *
 * The `title` and `body` are deliberately the same strings the app already used, because the same
 * event is also surfaced as a focused-tab toast and that text must not change. Everything premium is
 * carried in `extras` instead: the real competition name, both real crests and the real kickoff.
 *
 * Both crests use the only two image slots the platform offers: the notification icon and the
 * expanded image. Nothing is invented - a missing crest simply leaves its slot empty, and an unknown
 * competition simply drops the label.
 */
export function buildMatchPushPresentation(match: MatchPushSource, kind: MatchPushKind): MatchPushPresentation {
  const homeLogo = httpsUrl(match.homeTeamLogo)
  const awayLogo = httpsUrl(match.awayTeamLogo)
  const kickoff = new Date(match.kickoffAt)

  return {
    title: kind === 'reminder' ? MATCH_REMINDER_TITLE : MATCH_STARTED_TITLE,
    body: kind === 'reminder'
      ? `${match.title} starts soon! ${MATCH_PUSH_WATCH_CTA}`
      : `${match.title} has started! ${MATCH_PUSH_WATCH_CTA}`,
    link: kind === 'reminder' ? buildMatchPushLink(match.id, match.kickoffAt) : `/matches/${match.id}`,
    extras: {
      matchId: match.id,
      kind,
      icon: homeLogo ?? awayLogo,
      // Only sent when both crests exist, so one team's logo is never shown twice.
      image: homeLogo && awayLogo ? awayLogo : null,
      kickoffAt: kind === 'reminder' && !Number.isNaN(kickoff.getTime()) ? kickoff.toISOString() : null,
      competition: cleanText(match.tournamentName, MAX_COMPETITION_LENGTH),
    },
  }
}

export interface MatchDeliverySnapshot {
  status: string
  kickoffAt: Date | string
  deletedAt: Date | null
}

/**
 * Whether an enqueued match push is still worth delivering.
 *
 * Delivery can lag (the worker is rate-limited), so this is re-checked when the job runs: a reminder
 * whose match has started, finished, been removed, or been moved to another kickoff is stale and is
 * dropped instead of telling a viewer to tune in at a time that no longer applies. The replacement
 * reminder for the new kickoff carries a different identity and is not suppressed by this one.
 */
export function isMatchPushDeliveryValid(
  kind: MatchPushKind | null,
  kickoffMarker: string | null,
  match: MatchDeliverySnapshot | null,
): boolean {
  // Not a match alert (highlight, admin broadcast): there is no schedule to re-validate.
  if (kind === null) return true
  if (!match || match.deletedAt) return false

  if (kind === 'reminder') {
    if (match.status !== 'UPCOMING') return false
    if (!kickoffMarker) return true
    const kickoff = new Date(match.kickoffAt)
    return !Number.isNaN(kickoff.getTime()) && String(kickoff.getTime()) === kickoffMarker
  }

  if (kind === 'started') {
    // "has started" is only true once it started: a match still waiting, rejected or never published
    // must not claim it.
    return match.status === 'LIVE' || match.status === 'FINISHED'
  }

  return true
}

export interface PushMessageInput {
  title: string
  body: string
  type: string
  link: string
  notificationId: string
  extras?: MatchPushExtras | null
}

/**
 * The exact JSON pushed to a browser.
 *
 * Kept as a pure function so its size is measurable: a push payload is encrypted and delivered whole,
 * so the extras are deliberately limited to the crest URLs, the kickoff and the match id.
 */
export function buildPushMessage({ title, body, type, link, notificationId, extras }: PushMessageInput): string {
  const icon = httpsUrl(extras?.icon)
  const image = httpsUrl(extras?.image)
  const kickoffAt = extras?.kickoffAt && !Number.isNaN(new Date(extras.kickoffAt).getTime())
    ? new Date(extras.kickoffAt).toISOString()
    : null
  const competition = cleanText(extras?.competition, MAX_COMPETITION_LENGTH)

  return JSON.stringify({
    title,
    body,
    type,
    link,
    notificationId,
    ...(icon ? { icon } : {}),
    ...(image ? { image } : {}),
    ...(extras ? { matchId: extras.matchId, kind: extras.kind } : {}),
    ...(kickoffAt ? { kickoffAt } : {}),
    ...(competition ? { competition } : {}),
  })
}
