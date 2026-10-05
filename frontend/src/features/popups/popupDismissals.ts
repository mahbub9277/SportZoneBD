/**
 * Popup dismissal ("snooze") bookkeeping.
 *
 * A dismissed popup must stay hidden for six hours and become eligible again after that, so what is
 * stored is the dismissal *timestamp*, never a boolean: a boolean cannot expire, and an expired one
 * would hide the popup forever. The record also survives refreshes, restarts and navigation because
 * it lives in localStorage.
 *
 * Everything here is pure except the two storage helpers, and a storage that is missing or throws
 * (private mode, quota, corrupt JSON) degrades to "nothing remembered" instead of breaking the page.
 */

export const POPUP_DISMISSAL_TTL_MS = 6 * 60 * 60 * 1000
export const POPUP_DISMISSAL_STORAGE_KEY = 'sportzone_popup_dismissals'

/** popupId -> epoch milliseconds at which the popup was dismissed. */
export type PopupDismissals = Record<string, number>

type PopupStorage = Pick<Storage, 'getItem' | 'setItem'>

function getDefaultStorage(): PopupStorage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

function isUsableTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

/**
 * Loads the stored dismissals, ignoring malformed entries and any storage failure.
 * Called once per page load, the result is then kept in component state.
 */
export function readPopupDismissals(storage: PopupStorage | null = getDefaultStorage()): PopupDismissals {
  if (!storage) return {}

  try {
    const raw = storage.getItem(POPUP_DISMISSAL_STORAGE_KEY)
    if (!raw) return {}

    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}

    const dismissals: PopupDismissals = {}
    for (const [popupId, timestamp] of Object.entries(parsed as Record<string, unknown>)) {
      if (popupId && isUsableTimestamp(timestamp)) dismissals[popupId] = timestamp
    }

    return dismissals
  } catch {
    return {}
  }
}

/**
 * True while a popup is still inside its dismissal window.
 *
 * A timestamp in the future (a clock that moved backwards) is treated as expired rather than as an
 * endless snooze, so a wrong system clock can never hide a popup permanently.
 */
export function isPopupSnoozed(dismissals: PopupDismissals, popupId: string, now: number = Date.now()): boolean {
  const dismissedAt = dismissals[popupId]
  if (!isUsableTimestamp(dismissedAt) || dismissedAt > now) return false

  return now - dismissedAt < POPUP_DISMISSAL_TTL_MS
}

/** Keeps only the dismissals that are still inside their window, so storage cannot grow forever. */
export function prunePopupDismissals(dismissals: PopupDismissals, now: number = Date.now()): PopupDismissals {
  const pruned: PopupDismissals = {}

  for (const [popupId, dismissedAt] of Object.entries(dismissals)) {
    if (isPopupSnoozed(dismissals, popupId, now)) pruned[popupId] = dismissedAt
  }

  return pruned
}

/** Returns the dismissals with `popupId` snoozed from `now`. */
export function withPopupDismissed(
  dismissals: PopupDismissals,
  popupId: string,
  now: number = Date.now(),
): PopupDismissals {
  return { ...dismissals, [popupId]: now }
}

/**
 * Epoch milliseconds at which the earliest active dismissal expires, or null when nothing is snoozed.
 * The component schedules exactly one timer from this value, so no timer exists while all popups are
 * eligible.
 */
export function getNextPopupExpiry(dismissals: PopupDismissals, now: number = Date.now()): number | null {
  let nextExpiry: number | null = null

  for (const popupId of Object.keys(dismissals)) {
    if (!isPopupSnoozed(dismissals, popupId, now)) continue

    const expiry = dismissals[popupId] + POPUP_DISMISSAL_TTL_MS
    if (nextExpiry === null || expiry < nextExpiry) nextExpiry = expiry
  }

  return nextExpiry
}

/**
 * Persists the dismissals (pruned) and returns what was written, so callers keep exactly one copy of
 * the record in state.
 */
export function writePopupDismissals(
  dismissals: PopupDismissals,
  now: number = Date.now(),
  storage: PopupStorage | null = getDefaultStorage(),
): PopupDismissals {
  const pruned = prunePopupDismissals(dismissals, now)
  if (!storage) return pruned

  try {
    storage.setItem(POPUP_DISMISSAL_STORAGE_KEY, JSON.stringify(pruned))
  } catch {
    // Storage full or unavailable: the popup is still hidden for this page view.
  }

  return pruned
}
