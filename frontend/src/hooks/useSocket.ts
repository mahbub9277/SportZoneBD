import React, { createContext, startTransition, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { io, type Socket } from 'socket.io-client'
import { useAppSelector } from '../app/hooks'
import { useAppDispatch } from '../app/hooks'
import { selectCurrentToken, selectIsAuthenticated } from '../features/auth/authSlice'
import { notificationsApi } from '../features/notifications/notification.api'
import type { Notification } from '../features/notifications/notification.types'
import { matchesApi } from '../features/matches/matches.api'

declare global {
  interface ImportMeta {
    readonly env: ImportMetaEnv
  }

  interface ImportMetaEnv {
    readonly VITE_API_URL?: string
    readonly VITE_API_PROXY_TARGET?: string
  }
}

export type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>

export interface SocketContextType {
  socket: AppSocket | null
  adminSocket: AppSocket | null
  isConnected: boolean
  isAdminConnected: boolean
}

export const SocketContext = createContext<SocketContextType | null>(null)

type JsonValue = string | number | boolean | { [key: string]: JsonValue } | JsonValue[] | null

export interface SocketAutomationLog {
  id: string
  jobId: string
  action: string
  status: 'SUCCESS' | 'FAILED' | 'RUNNING' | 'PARTIAL' | 'SKIPPED'
  summary?: string | null
  errorMessage?: string | null
  details?: JsonValue
  createdAt: Date
  updatedAt: Date
}

export interface SocketAutomationStatus {
  id: string
  name: string
  status: 'IDLE' | 'RUNNING' | 'ERROR' | 'PAUSED'
  lastRunAt?: Date | null
  nextRunAt?: Date | null
  isEnabled: boolean
  cronExpression?: string | null
  createdAt: Date
  updatedAt: Date
  deletedAt?: Date | null
  logs: SocketAutomationLog[]
}

export interface SocketAutomationMetrics {
  totalRuns: number
  successfulRuns: number
  failedRuns: number
  lastRunAt?: Date | null
  matchesCreatedLast24h: number
  streamsValidatedLast24h: number
  jobStatus: string
  isEnabled: boolean
}

export interface ServerToClientEvents {
  viewerCountUpdate: (payload: { channelId: string; count: number }) => void
  resourceViewerCountUpdate: (payload: { kind: 'channel' | 'match' | 'stream'; resourceId: string; count: number }) => void
  liveViewersUpdate: (payload: { totalLiveViewers: number }) => void
  'analytics:stream-health': (payload: StreamHealthSummary) => void
  automationStatusUpdate: (payload: SocketAutomationStatus) => void
  automationMetricsUpdate: (payload: SocketAutomationMetrics) => void
  automationLogEntry: (payload: SocketAutomationLog) => void
  matchStatusUpdated: (payload: { id: string; status: string; finishedAt?: string | null }) => void
  notificationCreated: (payload: { id: string; userId: string; title: string; body: string; type: string; channel: string; link?: string | null; createdAt: string }) => void
}

export interface StreamHealthSummary {
  totalActiveViewers: number
  healthyViewers: number
  bufferingViewers: number
  errorViewers: number
  healthPercentage: number | null
  bufferingPercentage: number | null
  topErroredStreams?: Array<{ resource: string; errorCount: number; activeViewers: number; counters?: Record<string, unknown> }>
}

export interface ClientToServerEvents {
  joinChannel: (payload: { channelId: string }) => void
  leaveChannel: (payload: { channelId: string }) => void
  joinStream: (payload: { streamId: string; kind?: 'stream' | 'channel' | 'match' }) => void
  leaveStream: (payload: { streamId: string; kind?: 'stream' | 'channel' | 'match' }) => void
  viewerHeartbeat: (payload: { streamId: string; kind?: 'stream' | 'channel' | 'match' }) => void
}

const getSocketBackendUrl = () => {
  const configuredUrl = import.meta.env.VITE_SOCKET_URL?.trim()

  // Reject values such as "http" before Socket.IO interprets them as a host.
  if (configuredUrl) {
    try {
      const parsedUrl = new URL(configuredUrl)
      if ((parsedUrl.protocol === 'http:' || parsedUrl.protocol === 'https:') && parsedUrl.hostname) {
        return parsedUrl.origin
      }
    } catch {
      // Fall through to the environment-specific default.
    }
  }

  if (import.meta.env.DEV) {
    const proxyTarget = import.meta.env.VITE_API_PROXY_TARGET?.trim()
    if (proxyTarget) {
      try {
        const parsedProxyTarget = new URL(proxyTarget)
        if ((parsedProxyTarget.protocol === 'http:' || parsedProxyTarget.protocol === 'https:') && parsedProxyTarget.hostname) {
          return parsedProxyTarget.origin
        }
      } catch {
        // Use the local backend fallback below.
      }
    }
    return 'http://localhost:5000'
  }

  // In production, use the frontend origin when the backend shares the domain.
  return window.location.origin
}

export const SocketProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const authToken = useAppSelector(selectCurrentToken)
  const isAuthenticated = useAppSelector(selectIsAuthenticated)
  const dispatch = useAppDispatch()
  const [socket, setSocket] = useState<AppSocket | null>(null)
  const [adminSocket, setAdminSocket] = useState<AppSocket | null>(null)
  const [isConnected, setIsConnected] = useState(false)
  const [isAdminConnected, setIsAdminConnected] = useState(false)
  const publicSocketRef = useRef<AppSocket | null>(null)
  const adminSocketRef = useRef<AppSocket | null>(null)
  const socketBackendUrl = useMemo(() => getSocketBackendUrl(), [])

  useEffect(() => {
    const publicSocketInstance = io(socketBackendUrl, {
      transports: ['websocket'],
      withCredentials: true,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 500,
      reconnectionDelayMax: 3000,
      timeout: 20000,
      autoConnect: true,
    }) as AppSocket

    publicSocketRef.current = publicSocketInstance
    startTransition(() => {
      setSocket(publicSocketInstance)
      setIsConnected(publicSocketInstance.connected)
    })

    let hasConnectedOnce = false
    const handleConnect = () => {
      startTransition(() => setIsConnected(true))
      if (hasConnectedOnce) {
        dispatch(notificationsApi.util.invalidateTags(['Notifications']))
      }
      hasConnectedOnce = true
    }
    const handleDisconnect = () => startTransition(() => setIsConnected(false))
    const handleConnectError = () => startTransition(() => setIsConnected(false))
    const handleMatchStatusUpdated = () => {
      dispatch(matchesApi.util.invalidateTags([{ type: 'Matches', id: 'LIST' }]))
    }
    const handleNotificationCreated = (payload: Parameters<ServerToClientEvents['notificationCreated']>[0]) => {
      dispatch(notificationsApi.util.updateQueryData('getUnreadNotificationCount', undefined, (draft) => {
        draft.count += 1
      }))
      dispatch(notificationsApi.util.updateQueryData('getNotifications', { page: 1, limit: 25 }, (draft) => {
        if (draft.items.some((notification) => notification.id === payload.id)) return

        draft.items.unshift({
          ...payload,
          isRead: false,
          type: payload.type as Notification['type'],
        })
        draft.items = draft.items.slice(0, draft.meta.itemsPerPage)
        draft.meta.totalItems += 1
        draft.meta.totalPages = Math.max(1, Math.ceil(draft.meta.totalItems / draft.meta.itemsPerPage))
      }))
    }

    publicSocketInstance.on('connect', handleConnect)
    publicSocketInstance.on('disconnect', handleDisconnect)
    publicSocketInstance.on('connect_error', handleConnectError)
    publicSocketInstance.on('matchStatusUpdated', handleMatchStatusUpdated)
    publicSocketInstance.on('notificationCreated', handleNotificationCreated)

    return () => {
      publicSocketInstance.off('connect', handleConnect)
      publicSocketInstance.off('disconnect', handleDisconnect)
      publicSocketInstance.off('connect_error', handleConnectError)
      publicSocketInstance.off('matchStatusUpdated', handleMatchStatusUpdated)
      publicSocketInstance.off('notificationCreated', handleNotificationCreated)
      publicSocketInstance.removeAllListeners()
      publicSocketInstance.disconnect()
      publicSocketRef.current = null
      startTransition(() => {
        setSocket(null)
        setIsConnected(false)
      })
    }
  }, [dispatch, socketBackendUrl])

  useEffect(() => {
    const previousAdminSocket = adminSocketRef.current
    if (previousAdminSocket) {
      previousAdminSocket.removeAllListeners()
      previousAdminSocket.disconnect()
      adminSocketRef.current = null
      startTransition(() => {
        setAdminSocket(null)
        setIsAdminConnected(false)
      })
    }

    if (!isAuthenticated) return

    const adminSocketInstance = io(`${socketBackendUrl}/admin`, {
      transports: ['websocket'],
      withCredentials: true,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 500,
      reconnectionDelayMax: 3000,
      timeout: 20000,
      autoConnect: true,
      ...(authToken ? { auth: { token: authToken } } : {}),
    }) as AppSocket

    adminSocketRef.current = adminSocketInstance
    startTransition(() => {
      setAdminSocket(adminSocketInstance)
      setIsAdminConnected(adminSocketInstance.connected)
    })

    const handleAdminConnect = () => startTransition(() => setIsAdminConnected(true))
    const handleAdminDisconnect = () => startTransition(() => setIsAdminConnected(false))
    const handleAdminConnectError = () => startTransition(() => setIsAdminConnected(false))

    adminSocketInstance.on('connect', handleAdminConnect)
    adminSocketInstance.on('disconnect', handleAdminDisconnect)
    adminSocketInstance.on('connect_error', handleAdminConnectError)

    return () => {
      adminSocketInstance.off('connect', handleAdminConnect)
      adminSocketInstance.off('disconnect', handleAdminDisconnect)
      adminSocketInstance.off('connect_error', handleAdminConnectError)
      adminSocketInstance.removeAllListeners()
      adminSocketInstance.disconnect()
      adminSocketRef.current = null
      startTransition(() => {
        setAdminSocket(null)
        setIsAdminConnected(false)
      })
    }
  }, [authToken, isAuthenticated, socketBackendUrl])

  const value = useMemo(
    () => ({ socket, adminSocket, isConnected, isAdminConnected }),
    [socket, adminSocket, isConnected, isAdminConnected],
  )

  return React.createElement(SocketContext.Provider, { value }, children)
}

export function useSocket() {
  const context = useContext(SocketContext)
  if (!context) {
    throw new Error('useSocket must be used within a SocketProvider')
  }
  return context
}

export function useAutomationEvents() {
  const { adminSocket } = useSocket()

  const on = useCallback(<E extends keyof ServerToClientEvents>(event: E, callback: ServerToClientEvents[E]) => {
    const listener = callback as (...args: any[]) => void
    adminSocket?.on(event as any, listener as any)
    return () => {
      adminSocket?.off(event as any, listener as any)
    }
  }, [adminSocket])

  return { on }
}

