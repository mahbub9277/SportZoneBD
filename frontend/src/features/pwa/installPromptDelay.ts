/**
 * First-visit install prompt timing.
 *
 * The banner must never appear the instant the browser fires `beforeinstallprompt`: the visitor gets a
 * minimum amount of real elapsed time first. The remaining time is always derived from timestamps
 * (never from a decremented counter) so a throttled or early-firing timer cannot shorten the delay.
 */

export const INSTALL_PROMPT_DELAY_MS = 10_000

/** Milliseconds left before the install prompt may be offered. Never negative. */
export function installPromptDelayRemainingMs(startedAtMs: number, nowMs: number, delayMs = INSTALL_PROMPT_DELAY_MS): number {
  if (!Number.isFinite(startedAtMs) || !Number.isFinite(nowMs) || !Number.isFinite(delayMs)) return delayMs
  return Math.max(0, startedAtMs + delayMs - nowMs)
}
