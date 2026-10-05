import { startTransition, useEffect, useState } from 'react'
import { useSocket } from './useSocket'

/**
 * Subscribes to the live viewer count of one resource and keeps this page counted as a viewer while
 * it is mounted. Joining is idempotent server side, so the player joining the same room changes
 * nothing, while leaving the page (or switching resource) removes the membership again.
 */
export function useResourceViewerCount(kind: 'channel' | 'match' | 'stream', resourceId: string | undefined, initialCount: number | null = null) {
  const [count, setCount] = useState<number | null>(initialCount)
  const { socket } = useSocket()

  useEffect(() => startTransition(() => setCount(initialCount)), [initialCount, resourceId])
  useEffect(() => {
    if (!socket || !resourceId) return

    const join = () => {
      if (socket.connected) socket.emit('joinStream', { streamId: resourceId, kind })
    }
    const handleUpdate = (payload: { kind: string; resourceId: string; count: number | null }) => {
      if (payload.kind === kind && payload.resourceId === resourceId) {
        setCount(typeof payload.count === 'number' && Number.isFinite(payload.count) ? Math.max(0, payload.count) : null)
      }
    }

    join()
    socket.on('connect', join)
    socket.on('resourceViewerCountUpdate', handleUpdate)
    return () => {
      socket.off('resourceViewerCountUpdate', handleUpdate)
      socket.off('connect', join)
      socket.emit('leaveStream', { streamId: resourceId, kind })
    }
  }, [kind, resourceId, socket])

  return count
}