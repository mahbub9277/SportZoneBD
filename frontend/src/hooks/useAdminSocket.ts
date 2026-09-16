import { useEffect } from 'react'
import { useDispatch } from 'react-redux'
import { io, type Socket } from 'socket.io-client'

let socketInstance: Socket | null = null

/**
 * Initialize Socket.IO connection to admin room
 * Called once on app load to establish real-time connection
 */
export function initAdminSocket() {
  if (socketInstance) return socketInstance

  const protocol = window.location.protocol === 'https:' ? 'https' : 'http'
  const host = window.location.host
  
  socketInstance = io(`${protocol}//${host}`, {
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    reconnectionAttempts: 5,
    transports: ['websocket', 'polling'],
  })

  socketInstance.on('connect', () => {
    console.log('[Socket.IO] Connected to server')
    // Join admin room
    socketInstance?.emit('join-admin-room', {}, (ack: any) => {
      if (ack?.success) {
        console.log('[Socket.IO] Joined admin room')
      }
    })
  })

  socketInstance.on('disconnect', () => {
    console.log('[Socket.IO] Disconnected from server')
  })

  socketInstance.on('error', (error: any) => {
    console.error('[Socket.IO] Error:', error)
  })

  return socketInstance
}

/**
 * Get the Socket.IO instance (singleton pattern)
 */
export function getAdminSocket(): Socket | null {
  return socketInstance
}

/**
 * Hook to listen for admin resource real-time updates
 * Automatically invalidates RTK Query cache when resources change
 */
export function useAdminSocketListener() {
  const dispatch = useDispatch()

  useEffect(() => {
    const socket = initAdminSocket()
    if (!socket) return

    // Listen for resource creation events
    const handleResourceCreated = (data: { type: string; id: string; data: any }) => {
      console.log('[Socket.IO] Resource created:', data)
      invalidateResourceCache(dispatch, data.type)
    }

    // Listen for resource update events
    const handleResourceUpdated = (data: { type: string; id: string; data: any }) => {
      console.log('[Socket.IO] Resource updated:', data)
      invalidateResourceCache(dispatch, data.type)
    }

    // Listen for resource deletion events
    const handleResourceDeleted = (data: { type: string; id: string }) => {
      console.log('[Socket.IO] Resource deleted:', data)
      invalidateResourceCache(dispatch, data.type)
    }

    socket.on('adminResourceCreated', handleResourceCreated)
    socket.on('adminResourceUpdated', handleResourceUpdated)
    socket.on('adminResourceDeleted', handleResourceDeleted)

    return () => {
      socket.off('adminResourceCreated', handleResourceCreated)
      socket.off('adminResourceUpdated', handleResourceUpdated)
      socket.off('adminResourceDeleted', handleResourceDeleted)
    }
  }, [dispatch])
}

/**
 * Invalidate RTK Query cache for a specific resource type
 */
function invalidateResourceCache(dispatch: any, resourceType: string) {
  const typeMap: { [key: string]: string } = {
    'User': 'User',
    'Match': 'Match',
    'Advertisement': 'Advertisement',
    'Popup': 'Popup',
    'Role': 'Role',
    'Stream': 'Stream',
    'Channel': 'Channel',
  }

  const type = typeMap[resourceType]
  if (!type) {
    console.warn(`Unknown resource type for cache invalidation: ${resourceType}`)
    return
  }

  // Dispatch RTK Query invalidation action
  // This uses the generic invalidateTags pattern supported by RTK Query
  dispatch({
    type: 'rtk-query-api/invalidateTags',
    payload: [{ type, id: 'LIST' }],
  })
}
