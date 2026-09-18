import { startTransition, useEffect, useState } from 'react'
import { useSocket } from './useSocket'

export function useResourceViewerCount(kind: 'channel' | 'match' | 'stream', resourceId: string | undefined, initialCount = 0) {
  const [count, setCount] = useState(initialCount)
  const { socket } = useSocket()

  useEffect(() => startTransition(() => setCount(initialCount)), [initialCount, resourceId])
  useEffect(() => {
    if (!socket || !resourceId) return
    const handleUpdate = (payload: { kind: string; resourceId: string; count: number }) => {
      if (payload.kind === kind && payload.resourceId === resourceId) setCount(Math.max(0, Number(payload.count) || 0))
    }
    socket.on('resourceViewerCountUpdate', handleUpdate)
    return () => {
      socket.off('resourceViewerCountUpdate', handleUpdate)
    }
  }, [kind, resourceId, socket])

  return count
}