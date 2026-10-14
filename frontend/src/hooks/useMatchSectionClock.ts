import { useEffect, useState } from 'react'
import type { Match } from '../features/matches/matches.types'
import { getNextMatchTimeBoundary } from '../features/matches/matchOrdering'

const MAX_TIMEOUT_MS = 2_147_000_000

/**
 * Keeps time-based match sections current with one timeout for the nearest boundary.
 * Match status still comes only from the API/socket; this clock only reevaluates local sections.
 */
export function useMatchSectionClock(matches: readonly Match[]): number {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    let timer: number | null = null

    const refreshClock = () => {
      if (document.visibilityState !== 'visible') return

      const currentNow = Date.now()
      if (timer !== null) window.clearTimeout(timer)
      setNow(currentNow)
      const nextBoundary = getNextMatchTimeBoundary(matches, currentNow)
      if (nextBoundary === null) {
        timer = null
        return
      }

      const delay = Math.min(Math.max(0, nextBoundary - currentNow), MAX_TIMEOUT_MS)
      timer = window.setTimeout(refreshClock, delay)
    }

    document.addEventListener('visibilitychange', refreshClock)
    // Resync after match data changes before scheduling its next time boundary.
    timer = window.setTimeout(refreshClock, 0)

    return () => {
      document.removeEventListener('visibilitychange', refreshClock)
      if (timer !== null) window.clearTimeout(timer)
    }
  }, [matches])

  return now
}
