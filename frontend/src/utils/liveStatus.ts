/**
 * The shared "healthy live" presentation.
 *
 * A live match or stream that is working is a positive state, so it is drawn with one green accent
 * everywhere — the same accent the channel page already used for its live line — while red stays
 * reserved for failures. Every class carries its light and dark variant, so contrast holds on both
 * themes instead of relying on a fixed colour.
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
