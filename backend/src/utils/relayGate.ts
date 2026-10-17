/**
 * A concurrency gate for the media relay.
 *
 * Relaying a segment holds a socket and the response body for the length of a viewer's request, so an
 * unbounded number of them would let a handful of viewers exhaust the instance. The gate refuses — rather
 * than queues — when the limit is reached, because a viewer whose segment is queued behind others has
 * already missed its live window: the player retries with a fresh request instead of waiting on a backlog.
 */
export interface RelayGate {
  /** Reserves a slot, or returns null when the limit is already reached. */
  tryEnter: () => (() => void) | null
  inFlight: () => number
}

export function createRelayGate(maxConcurrent: number): RelayGate {
  let inFlight = 0

  return {
    tryEnter: () => {
      if (inFlight >= maxConcurrent) return null
      inFlight += 1

      let released = false
      return () => {
        if (released) return
        released = true
        inFlight -= 1
      }
    },
    inFlight: () => inFlight,
  }
}
