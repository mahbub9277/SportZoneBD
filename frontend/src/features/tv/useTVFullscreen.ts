import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import {
  beginFullscreenSession,
  exitTVFullscreen,
  exitTVFullscreenByViewer,
  hasViewerDismissedFullscreen,
  isFullscreenActive,
  isFullscreenSupported,
  markFullscreenDismissed,
  requestTVFullscreen,
  subscribeToFullscreenChange,
} from './tvFullscreen'

export interface TVFullscreenApi {
  isFullscreen: boolean
  isSupported: boolean
  /** The browser refused the automatic request, so the manual control is the way in. */
  isBlocked: boolean
  toggle: () => void
  /** Leaves fullscreen because the viewer asked to (the remote's Back key), without leaving TV Mode. */
  exitByViewer: () => void
}

/**
 * TV Mode's fullscreen state.
 *
 * The experience owns the whole screen whenever the platform allows it: the activation click takes
 * fullscreen, this hook keeps the on-screen state honest, and it releases the screen on the way out.
 * When the browser refuses — a request outside a user gesture is the usual reason — the state stays
 * false, the manual control is offered, and the first key press or tap inside TV Mode is used as the
 * gesture that asks again, so the viewer never has to hunt for a fullscreen button.
 */
export function useTVFullscreen(rootRef: RefObject<HTMLElement | null>): TVFullscreenApi {
  const isSupported = isFullscreenSupported()
  const [isFullscreen, setIsFullscreen] = useState(() => isFullscreenActive())
  const [isBlocked, setIsBlocked] = useState(false)
  const releaseTimerRef = useRef<number | null>(null)

  // A visit to TV Mode always begins by asking again, even if the previous visit ended with the viewer
  // leaving fullscreen on purpose.
  useEffect(() => {
    beginFullscreenSession()
  }, [])

  useEffect(() => subscribeToFullscreenChange((active) => {
    setIsFullscreen(active)
    if (active) setIsBlocked(false)
  }), [])

  // Ask once, as soon as the shell exists. The activation click has usually already taken fullscreen;
  // when TV Mode was opened another way this is the attempt that may still be honoured.
  useEffect(() => {
    if (!isSupported || isFullscreenActive()) return

    let cancelled = false
    void requestTVFullscreen(rootRef.current).then((entered) => {
      if (cancelled) return
      setIsFullscreen(entered)
      setIsBlocked(!entered)
    })

    return () => {
      cancelled = true
    }
  }, [isSupported, rootRef])

  // The fallback for a browser that refused the automatic request: the next real gesture inside TV Mode
  // asks again. The key press is still handled normally — this only adds the request.
  useEffect(() => {
    if (!isBlocked) return undefined
    const root = rootRef.current
    if (!root) return undefined

    const retry = () => {
      if (hasViewerDismissedFullscreen() || isFullscreenActive()) return
      void requestTVFullscreen(root).then((entered) => {
        if (!entered) return
        setIsFullscreen(true)
        setIsBlocked(false)
      })
    }

    root.addEventListener('pointerdown', retry, true)
    root.addEventListener('keydown', retry, true)
    return () => {
      root.removeEventListener('pointerdown', retry, true)
      root.removeEventListener('keydown', retry, true)
    }
  }, [isBlocked, rootRef])

  // Leaving TV Mode releases the screen. The release is deferred by a tick so React's development
  // double-mount does not tear down the fullscreen that was just entered: a real unmount never comes
  // back to cancel it, while the remount clears it before it runs.
  useEffect(() => {
    if (releaseTimerRef.current !== null) {
      window.clearTimeout(releaseTimerRef.current)
      releaseTimerRef.current = null
    }

    return () => {
      releaseTimerRef.current = window.setTimeout(() => {
        releaseTimerRef.current = null
        void exitTVFullscreen()
      }, 0)
    }
  }, [])

  const toggle = useCallback(() => {
    if (!isSupported) return

    if (isFullscreenActive()) {
      void exitTVFullscreenByViewer()
      return
    }

    // The click itself is the gesture, so this request is honoured where an automatic one would not be.
    void requestTVFullscreen(rootRef.current).then((entered) => {
      setIsFullscreen(entered)
      if (entered) setIsBlocked(false)
    })
  }, [isSupported, rootRef])

  const exitByViewer = useCallback(() => {
    if (!isFullscreenActive()) return
    markFullscreenDismissed()
    void exitTVFullscreen()
  }, [])

  return { isFullscreen, isSupported, isBlocked, toggle, exitByViewer }
}
