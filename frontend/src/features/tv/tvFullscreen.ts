/**
 * TV Mode's one place for the browser Fullscreen API.
 *
 * The whole experience lives in this module: which element is asked to fill the screen, whether the
 * viewer has already refused fullscreen, and how a change is observed. Nothing here pretends a request
 * succeeded — every entry point reports the real `document.fullscreenElement`, so the interface can
 * offer the manual control instead of claiming a screen the browser never handed over.
 */

/** The element TV Mode asks the browser to fill when the shell does not exist yet (the activation click). */
function getFallbackElement(): HTMLElement | null {
  return typeof document === 'undefined' ? null : document.documentElement
}

let viewerDismissedFullscreen = false

export function isFullscreenSupported(): boolean {
  return typeof document !== 'undefined'
    && typeof document.exitFullscreen === 'function'
    && typeof document.documentElement?.requestFullscreen === 'function'
    && document.fullscreenEnabled !== false
}

export function getFullscreenElement(): Element | null {
  return typeof document === 'undefined' ? null : document.fullscreenElement ?? null
}

export function isFullscreenActive(): boolean {
  return getFullscreenElement() !== null
}

/** True once the viewer has chosen to leave fullscreen, so TV Mode stops asking for it. */
export function hasViewerDismissedFullscreen(): boolean {
  return viewerDismissedFullscreen
}

export function markFullscreenDismissed(): void {
  viewerDismissedFullscreen = true
}

/** A fresh TV Mode session may ask for fullscreen again, even after a previous visit refused it. */
export function beginFullscreenSession(): void {
  viewerDismissedFullscreen = false
}

/**
 * Asks the browser to fill the screen with `target` — the TV shell when it is mounted, the document
 * otherwise — and reports whether fullscreen is really active afterwards.
 *
 * A browser that refuses the request (no live user gesture, or a platform that blocks the API) is an
 * expected outcome, not an error: the promise is never left to reject and `false` is returned so the
 * caller can fall back to the manual control.
 */
export async function requestTVFullscreen(target?: HTMLElement | null): Promise<boolean> {
  if (!isFullscreenSupported()) return false
  if (isFullscreenActive()) return true

  const element = target ?? getFallbackElement()
  if (!element?.requestFullscreen) return false

  try {
    await element.requestFullscreen()
    viewerDismissedFullscreen = false
    return isFullscreenActive()
  } catch {
    return false
  }
}

/** Leaves fullscreen when one is active. Best effort: the API can reject and nothing depends on it. */
export async function exitTVFullscreen(): Promise<boolean> {
  if (!isFullscreenActive()) return false

  try {
    await document.exitFullscreen?.()
    return true
  } catch {
    return false
  }
}

/** Leaves fullscreen because the viewer asked to, which also stops TV Mode from requesting it again. */
export async function exitTVFullscreenByViewer(): Promise<void> {
  markFullscreenDismissed()
  await exitTVFullscreen()
}

export function subscribeToFullscreenChange(listener: (isFullscreen: boolean) => void): () => void {
  if (typeof document === 'undefined') return () => undefined

  const handleChange = () => listener(isFullscreenActive())
  document.addEventListener('fullscreenchange', handleChange)
  return () => document.removeEventListener('fullscreenchange', handleChange)
}

/**
 * Takes fullscreen during the click that opens TV Mode.
 *
 * TV Mode's route is code-split, so the page mounts long after the activation and by then the browser
 * no longer counts the request as a user gesture. The click itself is that gesture, so the request
 * happens here — on the document, which will contain the shell — and the mounted page then finds
 * fullscreen already active instead of having to ask for a second interaction.
 */
export function requestTVFullscreenFromActivation(): void {
  beginFullscreenSession()
  void requestTVFullscreen(null)
}
