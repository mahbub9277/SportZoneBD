import { useEffect } from 'react'

import { useRecordSessionHeartbeatMutation } from './moderation.api'

/**
 * How often the console reports that it is still in use.
 *
 * Three minutes is inside the 2–5 minute window a heartbeat should use. It is one request per open
 * console per interval, and the backend writes a single timestamp on the session it already has — no
 * polling loop, no per-second writes and no separate presence service.
 */
export const HEARTBEAT_INTERVAL_MS = 3 * 60 * 1000

/**
 * Records that the signed-in staff member is still working in the console.
 *
 * The heartbeat only runs while the tab is visible: a hidden or backgrounded tab sends nothing, which is
 * what lets the activity view treat a long silence as an idle session rather than as work. It never
 * extends the session — the backend refuses to change the expiry — so it cannot keep a stale session
 * alive, and it stops entirely when the console unmounts.
 */
export function useSessionHeartbeat(enabled: boolean = true): void {
  const [recordHeartbeat] = useRecordSessionHeartbeatMutation()

  useEffect(() => {
    if (!enabled || typeof document === 'undefined') return undefined

    let timer: number | null = null

    const send = () => {
      // A failure needs no user-facing message: the next tick tries again, and a session that really
      // ended is already handled by the normal auth flow.
      void recordHeartbeat().catch(() => undefined)
    }

    const start = () => {
      if (timer !== null) return
      send()
      timer = window.setInterval(send, HEARTBEAT_INTERVAL_MS)
    }

    const stop = () => {
      if (timer === null) return
      window.clearInterval(timer)
      timer = null
    }

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') start()
      else stop()
    }

    handleVisibility()
    document.addEventListener('visibilitychange', handleVisibility)

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility)
      stop()
    }
  }, [enabled, recordHeartbeat])
}
