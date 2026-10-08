/**
 * The channel TV Mode last played.
 *
 * Only the channel id is stored, exactly like the pinned-channels slice does it: the id is matched
 * against the channel data the page fetches anyway, so no channel detail is duplicated in the browser.
 */
const STORAGE_KEY = 'sportzonebd-tv-last-channel'

export function readLastTVChannelId(): string | null {
  if (typeof window === 'undefined') return null

  try {
    const saved = window.localStorage.getItem(STORAGE_KEY)
    return saved && saved.trim() ? saved : null
  } catch {
    return null
  }
}

export function writeLastTVChannelId(channelId: string | null): void {
  if (typeof window === 'undefined') return

  try {
    if (channelId) window.localStorage.setItem(STORAGE_KEY, channelId)
    else window.localStorage.removeItem(STORAGE_KEY)
  } catch {
    // A browser that refuses storage simply never remembers the channel.
  }
}
