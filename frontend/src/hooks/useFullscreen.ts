import { useCallback, useEffect, useState, type RefObject } from 'react'

export function useFullscreen(containerRef: RefObject<HTMLElement | null>, isTouchDevice: boolean) {
  const [isFullscreen, setIsFullscreen] = useState(false)
  const isSupported = typeof document !== 'undefined'
    && typeof document.fullscreenEnabled === 'boolean'
    && typeof document.fullscreenElement !== 'undefined'

  const toggle = useCallback(async () => {
    const container = containerRef.current
    if (!container || !isSupported) return

    if (document.fullscreenElement) {
      try {
        await document.exitFullscreen?.()
      } catch {
        // Exiting fullscreen is best effort.
      }
      return
    }

    try {
      await container.requestFullscreen?.()
      const orientation = typeof screen !== 'undefined'
        ? screen.orientation as ScreenOrientation & { lock?: (orientation: string) => Promise<void> }
        : null
      if (isTouchDevice && orientation?.lock) {
        try {
          await orientation.lock('landscape')
        } catch {
          // Orientation lock is optional.
        }
      }
    } catch {
      // Unsupported or rejected fullscreen requests are non-fatal.
    }
  }, [containerRef, isSupported, isTouchDevice])

  useEffect(() => {
    const handleFullscreenChange = () => setIsFullscreen(Boolean(document.fullscreenElement))
    document.addEventListener('fullscreenchange', handleFullscreenChange)
    handleFullscreenChange()
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange)
  }, [])

  return { isFullscreen, isSupported, toggle }
}
