import { useCallback, useEffect, useRef } from 'react'

const DEFAULT_HIDE_DELAY = 3000

interface UseAutoHideControlsOptions {
  isPlaying: boolean
  isVisible: boolean
  isSeeking: boolean
  isSettingsOpen: boolean
  hasError: boolean
  isTouchDevice: boolean
  isPointerInside?: boolean
  setVisible: (visible: boolean) => void
  delay?: number
}

export function useAutoHideControls({
  isPlaying,
  isVisible,
  isSeeking,
  isSettingsOpen,
  hasError,
  isTouchDevice,
  isPointerInside = false,
  setVisible,
  delay = DEFAULT_HIDE_DELAY,
}: UseAutoHideControlsOptions) {
  const timeoutRef = useRef<number | null>(null)

  const clearTimer = useCallback(() => {
    if (timeoutRef.current === null) return
    window.clearTimeout(timeoutRef.current)
    timeoutRef.current = null
  }, [])

  /**
   * A locked player is deliberately *not* kept visible: the unlock affordance auto-hides like the rest
   * of the chrome and is revealed again by the existing pointer/tap/focus handlers.
   */
  const mustStayVisible = !isPlaying || isSeeking || isSettingsOpen || hasError

  const hide = useCallback(() => {
    if (mustStayVisible) {
      setVisible(true)
      return
    }

    setVisible(false)
  }, [mustStayVisible, setVisible])

  const scheduleHide = useCallback(() => {
    clearTimer()
    if (mustStayVisible) {
      setVisible(true)
      return
    }

    timeoutRef.current = window.setTimeout(() => {
      timeoutRef.current = null
      hide()
    }, delay)
  }, [clearTimer, delay, hide, mustStayVisible, setVisible])

  const show = useCallback(() => {
    setVisible(true)
    scheduleHide()
  }, [scheduleHide, setVisible])

  const toggle = useCallback(() => {
    if (mustStayVisible) {
      setVisible(true)
      return
    }

    if (isPointerInside) {
      setVisible(true)
      return
    }

    clearTimer()
    setVisible(!isVisible)
  }, [clearTimer, isPointerInside, isVisible, mustStayVisible, setVisible])

  useEffect(() => {
    if (mustStayVisible) {
      clearTimer()
      setVisible(true)
      return
    }

    setVisible(true)
    scheduleHide()
    return clearTimer
  }, [clearTimer, isTouchDevice, mustStayVisible, scheduleHide, setVisible])

  useEffect(() => clearTimer, [clearTimer])

  return { show, hide, toggle, scheduleHide, clearTimer }
}