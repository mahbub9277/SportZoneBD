/**
 * The shared "healthy live" presentation.
 *
 * A live match or stream that is working is a positive state, so it is drawn with one green accent
 * everywhere — the same accent the channel page already used for its live line — while red stays
 * reserved for failures. Every class carries its light and dark variant, so contrast holds on both
 * themes instead of relying on a fixed colour.
 *
 * This is the *health* accent (a stream that is up, a viewer count that is current). The colour of a
 * match's own status is a different question and lives in `MATCH_STATUS_*` below.
 */
export const LIVE_BADGE_CLASS =
  'border-emerald-400/30 bg-emerald-500/12 text-emerald-700 dark:text-emerald-300'

/** Plain live text (elapsed time, "watching live") without a badge surface. */
export const LIVE_TEXT_CLASS = 'text-emerald-700 dark:text-emerald-300'

/** The pulsing live dot, with the same soft glow the channel page uses. */
export const LIVE_DOT_CLASS = 'bg-emerald-500 dark:bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.85)]'

/** Viewer counts are abbreviated exactly the way the channel page already showed them. */
export function formatViewerCount(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`
  return String(count)
}

/**
 * The three match states a viewer can see, drawn with one meaning each: red means "happening now",
 * amber means "not yet", green means "over". Both the match card and the match page read these, so the
 * same match can never be coloured two different ways on two screens.
 */
export type MatchStatusTone = 'LIVE' | 'UPCOMING' | 'FINISHED'

/**
 * Maps the backend match status onto the three states the UI draws.
 *
 * It reads the stored status only — never the title or any other display text — and anything the UI
 * does not draw as a state of its own (a pending or unpublished match) is presented as upcoming.
 */
export function matchStatusTone(status: string | null | undefined): MatchStatusTone {
  const normalized = status?.toUpperCase()
  return normalized === 'LIVE' || normalized === 'FINISHED' ? normalized : 'UPCOMING'
}

/**
 * The status badge surface. The colours are theme tokens declared in `index.css`
 * (`.match-status--*`), because the app is dark-first and a palette utility can resolve to an
 * inherited colour there; the tokens also let the light theme darken the text for contrast. The
 * live badge carries a soft red glow that costs no layout work.
 */
export const MATCH_STATUS_BADGE_CLASS: Record<MatchStatusTone, string> = {
  LIVE: 'match-status match-status--live',
  UPCOMING: 'match-status match-status--upcoming',
  FINISHED: 'match-status match-status--finished',
}

/**
 * The status indicator dot. Its colour comes from the tone class on the badge above it, so one value
 * serves all three tones; only the live dot glows.
 */
export const MATCH_STATUS_DOT_CLASS = 'match-status-dot'

/** Status text without a badge surface (for example the elapsed clock on a live match). */
export const MATCH_STATUS_TEXT_CLASS: Record<MatchStatusTone, string> = {
  LIVE: 'match-status-text--live',
  UPCOMING: 'match-status-text--upcoming',
  FINISHED: 'match-status-text--finished',
}
