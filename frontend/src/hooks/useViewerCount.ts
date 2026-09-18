import { startTransition, useEffect, useState } from 'react'
import { useSocket } from './useSocket'

export function useViewerCount(channelId?: string | null, initialCount?: number) {
  const [count, setCount] = useState<number>(initialCount ?? 0)
  const { socket } = useSocket()

  useEffect(() => {
    if (!channelId) {
      startTransition(() => setCount(initialCount ?? 0))
      return
    }

    if (!socket) return

    const handleViewerCountUpdate = (data: { channelId: string; count: number }) => {
      if (data.channelId === channelId) {
        setCount(Number.isFinite(data.count) ? data.count : 0)
      }
    }

    socket.on('viewerCountUpdate', handleViewerCountUpdate)

    return () => {
      socket.off('viewerCountUpdate', handleViewerCountUpdate)
    }
  }, [channelId, initialCount, socket])

  return count
}

