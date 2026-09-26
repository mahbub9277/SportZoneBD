import { startTransition, useEffect, useState } from 'react'
import { useSocket } from './useSocket'

export function useResourceViewerCount(kind: 'channel' | 'match' | 'stream', resourceId: string | undefined, initialCount: number | null = null) {
  const [count, setCount] = useState<number | null>(initialCount)
  const { socket } = useSocket()

  useEffect(() => startTransition(() => setCount(initialCount)), [initialCount, resourceId])
  useEffect(() => {
    if (!socket || !resourceId) return
    const handleUpdate = (payload: { kind: string; resourceId: string; count: number | null }) => {
      if (payload.kind === kind && payload.resourceId === resourceId) {
        setCount(typeof payload.count === 'number' && Number.isFinite(payload.count) ? Math.max(0, payload.count) : null)
      }
    }
    socket.on('resourceViewerCountUpdate', handleUpdate)
    return () => {
      socket.off('resourceViewerCountUpdate', handleUpdate)
    }
  }, [kind, resourceId, socket])

  return count
}