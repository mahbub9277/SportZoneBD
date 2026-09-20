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

    const joinChannel = () => {
      if (channelId && socket.connected) socket.emit('joinChannel', { channelId })
    }

    joinChannel()

    const handleViewerCountUpdate = (data: { channelId: string; count: number }) => {
      if (data.channelId === channelId) {
        setCount(Number.isFinite(data.count) ? data.count : 0)
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

