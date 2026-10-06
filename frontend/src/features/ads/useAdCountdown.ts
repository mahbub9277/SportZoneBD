import { useCallback, useEffect, useRef, useState } from 'react'
import { computeRemainingSeconds, normalizeAdDurationSeconds, startAdVisitClock } from './adSession.ts'

interface UseAdCountdownOptions {
  /** Epoch ms the current visit started at, or null while nothing is running. */
  startedAtMs: number | null
  /** Configured advertisement duration in seconds (never milliseconds). */
  durationSeconds: number
  /** Whether a visit is running; when false every timer/listener is torn down. */
  active: boolean
  /** Called exactly once per run, only after the configured duration has elapsed. */
  onElapsed: () => void
  tickMs?: number
}

/**
 * React binding for the shared advertisement countdown clock. Remaining time comes from real elapsed
 * time (never a decremented counter), state is committed only when the displayed second changes, and
 * the clock is torn down on unmount or when the visit stops.
 */
export function useAdCountdown({ startedAtMs, durationSeconds, active, onElapsed, tickMs }: UseAdCountdownOptions): number {
  const [tick, setTick] = useState<{ startedAtMs: number; remainingSeconds: number } | null>(null)
  const onElapsedRef = useRef(onElapsed)
  // Synced in an effect declared before the clock effect, so the clock always calls the newest handler.
  useEffect(() => {
    onElapsedRef.current = onElapsed
  })

  const commit = useCallback((startedMs: number, remainingSeconds: number) => {
    setTick((current) => (current && current.startedAtMs === startedMs && current.remainingSeconds === remainingSeconds
      ? current
      : { startedAtMs: startedMs, remainingSeconds }))
  }, [])

  useEffect(() => {
    if (!active || startedAtMs === null) return

    const stopClock = startAdVisitClock({
      startedAtMs,
      durationSeconds,
      tickMs,
      onTick: (remainingSeconds) => commit(startedAtMs, remainingSeconds),
      onElapsed: () => onElapsedRef.current(),
    })
    // Returning from a hidden tab (for example the sponsor page) recalculates from real elapsed time.
    const handleVisibilityChange = () => {
      if (document.hidden) return
      commit(startedAtMs, computeRemainingSeconds(startedAtMs, durationSeconds, Date.now()))
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      stopClock()
    }
  }, [active, commit, durationSeconds, startedAtMs, tickMs])

  if (!active || startedAtMs === null) return 0
  // Until the clock's first tick the full configured duration is shown, so a brand new visit can never
  // paint a leftover number from the previous one and the render stays pure (no Date.now() in render).
  return tick && tick.startedAtMs === startedAtMs
    ? tick.remainingSeconds
    : normalizeAdDurationSeconds(durationSeconds)
}
