import { startTransition, useEffect, useState } from 'react'
import { useSocket } from './useSocket'

export function useViewerCount(channelId?: string | null, initialCount?: number | null) {
  const [count, setCount] = useState<number | null>(initialCount ?? null)
  const { socket } = useSocket()

  useEffect(() => {
    if (!channelId) {
      startTransition(() => setCount(initialCount ?? null))
      return
    }

    if (!socket) return

    const joinChannel = () => {
      if (channelId && socket.connected) socket.emit('joinChannel', { channelId })
    }

    joinChannel()

    const handleViewerCountUpdate = (data: { channelId: string; count: number | null }) => {
      if (data.channelId === channelId) {
        setCount(typeof data.count === 'number' && Number.isFinite(data.count) && data.count >= 0 ? data.count : null)
      }
    }

    socket.on('viewerCountUpdate', handleViewerCountUpdate)
    socket.on('connect', joinChannel)

    return () => {
      socket.off('viewerCountUpdate', handleViewerCountUpdate)
      socket.off('connect', joinChannel)
      socket.emit('leaveChannel', { channelId })
    }
  }, [channelId, initialCount, socket])

  return count
}

