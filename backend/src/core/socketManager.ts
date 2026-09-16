/**
 * Defines the types for socket events between the server and clients.
 * This provides a single source of truth for event names and their payloads.
 */
import type { AutomationLog, AutomationMetrics, AutomationStatus } from '../modules/automation/automation.types.js'
import type { Server, Socket } from 'socket.io'
import logger from './logger.js'
import { verifyAccessToken } from './auth.js'
import { prisma } from './prisma.js'
import { redis } from './redis.js'

/**
 * Global Socket.IO instance manager.
 * Provides access to the io instance for emitting events from services.
 */

let ioInstance: Server<ClientToServerEvents, ServerToClientEvents> | null = null

export function setIoInstance(io: Server<ClientToServerEvents, ServerToClientEvents>): void {
  ioInstance = io
}

export function getIoInstance(): Server<ClientToServerEvents, ServerToClientEvents> | null {
  return ioInstance
}

/**
 * A type-safe map of all possible server-to-client events.
 */
export interface ServerToClientEvents {
  'stream:updated': (payload: { streamId?: string; channelId?: string; source: 'primary' | 'backup'; version: string }) => void
  viewerCountUpdate: (payload: { channelId: string; count: number }) => void
  resourceViewerCountUpdate: (payload: { kind: 'channel' | 'match' | 'stream'; resourceId: string; count: number }) => void
  liveViewersUpdate: (payload: { totalLiveViewers: number }) => void
  'analytics:stream-health': (payload: Record<string, unknown>) => void
  automationStatusUpdate: (payload: AutomationStatus) => void
  automationMetricsUpdate: (payload: AutomationMetrics) => void
  automationLogEntry: (payload: AutomationLog) => void
  adminResourceCreated: (payload: { type: string; id: string; data: Record<string, any> }) => void
  adminResourceUpdated: (payload: { type: string; id: string; data: Record<string, any> }) => void
  adminResourceDeleted: (payload: { type: string; id: string }) => void
  matchStatusUpdated: (payload: { id: string; status: string; finishedAt?: Date | null }) => void
  notificationCreated: (payload: { id: string; userId: string; title: string; body: string; type: string; channel: string; link?: string | null; createdAt: Date }) => void
}

/**
 * A type-safe map of all possible client-to-server events.
 */
export interface ClientToServerEvents {
  joinChannel: (payload: { channelId: string }) => void
  leaveChannel: (payload: { channelId: string }) => void
  joinStream: (payload: { streamId: string; kind?: 'stream' | 'channel' | 'match' }) => void
  leaveStream: (payload: { streamId: string; kind?: 'stream' | 'channel' | 'match' }) => void
  viewerHeartbeat: (payload: { streamId: string; kind?: 'stream' | 'channel' | 'match' }) => void
}

const ADMIN_ROOM = 'admin-room'
const ACCESS_TOKEN_COOKIE = 'accessToken'
const VIEWER_TTL_SECONDS = 75
const VIEWER_ALL_KEY = 'sportzone:live-viewers:all'
const viewerResourceKey = (kind: string, id: string) => `sportzone:live-viewers:${kind}:${id}`
const viewerSocketKey = (socketId: string) => `sportzone:live-viewers:socket:${socketId}`

type ViewerPresence = { kind: 'stream' | 'channel' | 'match'; streamId: string }

function normalizeViewerPresence(streamId: unknown, kind: unknown): ViewerPresence | null {
  if (typeof streamId !== 'string' || !streamId.trim() || streamId.length > 255) return null
  const normalizedKind = kind === 'channel' || kind === 'match' ? kind : 'stream'
  return { kind: normalizedKind, streamId: streamId.trim() }
}

async function emitLiveViewerCount(totalLiveViewers: number): Promise<void> {
  if (!ioInstance) return
  const count = Number.isFinite(totalLiveViewers) && totalLiveViewers > 0 ? Math.floor(totalLiveViewers) : 0
  ioInstance.of('/admin').to(ADMIN_ROOM).emit('liveViewersUpdate', { totalLiveViewers: count })
}

export async function getTotalLiveViewers(): Promise<number> {
  try {
    const now = Date.now()
    await redis.zremrangebyscore(VIEWER_ALL_KEY, 0, now)
    const total = await redis.zcount(VIEWER_ALL_KEY, now, '+inf')
    return Number.isFinite(Number(total)) ? Math.max(0, Number(total)) : 0
  } catch (error) {
    logger.warn({ error }, 'Unable to read live viewer presence from Redis')
    return 0
  }
}

async function removeViewerPresence(socketId: string, expected?: ViewerPresence): Promise<number> {
  try {
    const rawPresence = await redis.get(viewerSocketKey(socketId))
    const presence = rawPresence ? JSON.parse(rawPresence) as ViewerPresence : null
    if (!presence || (expected && (presence.streamId !== expected.streamId || presence.kind !== expected.kind))) {
      return getTotalLiveViewers()
    }

    const now = Date.now()
    await Promise.all([
      redis.zrem(viewerResourceKey(presence.kind, presence.streamId), socketId),
      redis.zrem(VIEWER_ALL_KEY, socketId),
      redis.del(viewerSocketKey(socketId)),
    ])
    const total = await getTotalLiveViewers()
    await emitLiveViewerCount(total)
    return total
  } catch (error) {
    logger.warn({ error, socketId }, 'Unable to remove live viewer presence')
    return getTotalLiveViewers()
  }
}

async function refreshViewerPresence(socketId: string, requestedPresence: ViewerPresence): Promise<number> {
  try {
    const existingRaw = await redis.get(viewerSocketKey(socketId))
    const existing = existingRaw ? JSON.parse(existingRaw) as ViewerPresence : null
    if (existing && (existing.streamId !== requestedPresence.streamId || existing.kind !== requestedPresence.kind)) {
      await removeViewerPresence(socketId, existing)
    }

    const expiresAt = Date.now() + VIEWER_TTL_SECONDS * 1000
    await Promise.all([
      redis.zadd(viewerResourceKey(requestedPresence.kind, requestedPresence.streamId), expiresAt, socketId),
      redis.zadd(VIEWER_ALL_KEY, expiresAt, socketId),
      redis.set(viewerSocketKey(socketId), JSON.stringify(requestedPresence), 'EX', VIEWER_TTL_SECONDS),
    ])
    const total = await getTotalLiveViewers()
    await emitLiveViewerCount(total)
    return total
  } catch (error) {
    logger.warn({ error, socketId }, 'Unable to update live viewer presence')
    return getTotalLiveViewers()
  }
}

export async function getLiveViewerCount(kind: ViewerPresence['kind'], streamId: string): Promise<number> {
  try {
    const now = Date.now()
    const key = viewerResourceKey(kind, streamId)
    await redis.zremrangebyscore(key, 0, now)
    const count = await redis.zcount(key, now, '+inf')
    return Number.isFinite(Number(count)) ? Math.max(0, Number(count)) : 0
  } catch (error) {
    logger.warn({ error, kind, streamId }, 'Unable to read stream viewer presence from Redis')
    return 0
  }
}

function getCookieValue(cookieHeader: string | undefined, cookieName: string): string | undefined {
  if (!cookieHeader) return undefined

  const cookie = cookieHeader
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${cookieName}=`))

  if (!cookie) return undefined

  try {
    return decodeURIComponent(cookie.slice(cookieName.length + 1))
  } catch {
    return undefined
  }
}

/** Emits an automation status update to all clients in the admin room. */
export function emitAutomationStatusUpdate(data: AutomationStatus): void {
  if (!ioInstance) {
    logger.warn('Socket.IO instance not available for emitAutomationStatusUpdate.')
    return
  }
  ioInstance.to(ADMIN_ROOM).emit('automationStatusUpdate', data)
}

/** Emits an automation metrics update to all clients in the admin room. */
export function emitAutomationMetricsUpdate(metrics: AutomationMetrics): void {
  if (!ioInstance) {
    logger.warn('Socket.IO instance not available for emitAutomationMetricsUpdate.')
    return
  }
  ioInstance.to(ADMIN_ROOM).emit('automationMetricsUpdate', metrics)
}

/** Emits a new automation log entry to all clients in the admin room. */
export function emitAutomationLogEntry(logEntry: AutomationLog): void {
  if (!ioInstance) {
    logger.warn('Socket.IO instance not available for emitAutomationLogEntry.')
    return
  }
  ioInstance.to(ADMIN_ROOM).emit('automationLogEntry', logEntry)
}

/** Emits a viewer count update to a specific channel room. */
export function emitViewerCountUpdate(channelId: string, count: number): void {
  if (!ioInstance) {
    logger.warn('Socket.IO instance not available for emitViewerCountUpdate.')
    return
  }
  ioInstance.to(channelId).emit('viewerCountUpdate', { channelId, count })
}

export function emitResourceViewerCountUpdate(kind: ViewerPresence['kind'], resourceId: string, count: number): void {
  if (!ioInstance) return
  ioInstance.to(`${kind}:${resourceId}`).emit('resourceViewerCountUpdate', { kind, resourceId, count })
}

export function emitStreamUpdated(payload: { streamId?: string; channelId?: string; source: 'primary' | 'backup'; version: string }): void {
  if (!ioInstance) return
  ioInstance.emit('stream:updated', payload)
}

/** Emits a resource creation event to all admins in the admin room. */
export function emitAdminResourceCreated(type: string, id: string, data: Record<string, any>): void {
  if (!ioInstance) {
    logger.warn('Socket.IO instance not available for emitAdminResourceCreated.')
    return
  }
  ioInstance.of('/admin').to(ADMIN_ROOM).emit('adminResourceCreated', { type, id, data })
}

/** Emits a resource update event to all admins in the admin room. */
export function emitAdminResourceUpdated(type: string, id: string, data: Record<string, any>): void {
  if (!ioInstance) {
    logger.warn('Socket.IO instance not available for emitAdminResourceUpdated.')
    return
  }
  ioInstance.of('/admin').to(ADMIN_ROOM).emit('adminResourceUpdated', { type, id, data })
}

/** Emits a resource deletion event to all admins in the admin room. */
export function emitAdminResourceDeleted(type: string, id: string): void {
  if (!ioInstance) {
    logger.warn('Socket.IO instance not available for emitAdminResourceDeleted.')
    return
  }
  ioInstance.of('/admin').to(ADMIN_ROOM).emit('adminResourceDeleted', { type, id })
}

export function emitMatchStatusUpdated(payload: { id: string; status: string; finishedAt?: Date | null }): void {
  ioInstance?.emit('matchStatusUpdated', payload)
}

export function emitUserNotification(userId: string, payload: Parameters<ServerToClientEvents['notificationCreated']>[0]): void {
  ioInstance?.to(`user:${userId}`).emit('notificationCreated', payload)
}

/**
 * Initializes and configures all Socket.IO namespaces and event handlers.
 * @param io - The main Socket.IO server instance.
 */
export function initializeSocketHandlers(io: Server<ClientToServerEvents, ServerToClientEvents>) {
  // Admin Namespace with Authentication
  const adminNamespace = io.of('/admin')

  adminNamespace.use(async (socket, next) => {
    const token = socket.handshake.auth.token
      || socket.handshake.headers.authorization?.split(' ')[1]
      || getCookieValue(socket.handshake.headers.cookie, ACCESS_TOKEN_COOKIE)
    if (!token) {
      return next(new Error('Authentication error: No token provided'))
    }

    try {
      const payload = verifyAccessToken(token)
      const user = await prisma.user.findUnique({
        where: { id: payload.sub, deletedAt: null },
        select: {
          isActive: true,
          isSuspended: true,
          isBanned: true,
          roles: { select: { role: { select: { name: true } } } },
        },
      })
      const isAdmin = user?.roles.some(({ role }) => role.name === 'admin' || role.name === 'super_admin')

      if (!user || !user.isActive || user.isSuspended || user.isBanned || !isAdmin) {
        return next(new Error('Authentication error: Admin access required'))
      }

      ;(socket as any).user = payload // Attach user payload to the socket instance
      next()
    } catch (error) {
      logger.warn({ error: error instanceof Error ? error.message : 'Unknown socket authentication error' }, 'Admin socket authentication failed')
      next(new Error('Authentication error: Invalid token'))
    }
  })

  adminNamespace.on('connection', (socket) => {
    socket.join(ADMIN_ROOM)
    logger.info({ socketId: socket.id, user: (socket as any).user?.id }, 'Admin connected to socket namespace.')
  })

  io.use((socket, next) => {
    const token = socket.handshake.auth?.token
      || socket.handshake.headers.authorization?.split(' ')[1]
      || getCookieValue(socket.handshake.headers.cookie, ACCESS_TOKEN_COOKIE)
    if (!token) return next()
    try {
      ;(socket as any).user = verifyAccessToken(token)
      next()
    } catch {
      next()
    }
  })

  // Public Namespace for real-time viewer counting
  io.on('connection', (socket: Socket<ClientToServerEvents, ServerToClientEvents>) => {
    const userId = (socket as any).user?.sub
    if (typeof userId === 'string') void socket.join(`user:${userId}`)
    const updateAndEmitViewerCount = async (kind: ViewerPresence['kind'], resourceId: string) => {
      const count = await getLiveViewerCount(kind, resourceId)
      if (kind === 'channel') emitViewerCountUpdate(resourceId, count)
      emitResourceViewerCountUpdate(kind, resourceId, count)
    }

    socket.on('joinChannel', async ({ channelId }) => {
      if (!channelId) return

      const previousRooms = Array.from(socket.rooms).filter((room) => room !== socket.id && room !== channelId && !room.startsWith('user:'))
      await Promise.all(previousRooms.map((room) => socket.leave(room)))

      await socket.join(channelId)
      await refreshViewerPresence(socket.id, { kind: 'channel', streamId: channelId })
      await updateAndEmitViewerCount('channel', channelId)
    })

    socket.on('leaveChannel', async ({ channelId }) => {
      if (!channelId) return

      await socket.leave(channelId)
      await removeViewerPresence(socket.id, { kind: 'channel', streamId: channelId })
      await updateAndEmitViewerCount('channel', channelId)
    })

    socket.on('joinStream', async ({ streamId, kind }) => {
      const presence = normalizeViewerPresence(streamId, kind)
      if (presence) {
        await refreshViewerPresence(socket.id, presence)
        await socket.join(`${presence.kind}:${presence.streamId}`)
        if (presence.kind === 'channel') await socket.join(presence.streamId)
        await updateAndEmitViewerCount(presence.kind, presence.streamId)
      }
    })

    socket.on('leaveStream', async ({ streamId, kind }) => {
      const presence = normalizeViewerPresence(streamId, kind)
      if (presence) {
        await removeViewerPresence(socket.id, presence)
        await socket.leave(`${presence.kind}:${presence.streamId}`)
        if (presence.kind === 'channel') await socket.leave(presence.streamId)
        await updateAndEmitViewerCount(presence.kind, presence.streamId)
      }
    })

    socket.on('viewerHeartbeat', async ({ streamId, kind }) => {
      const presence = normalizeViewerPresence(streamId, kind)
      if (presence) {
        await refreshViewerPresence(socket.id, presence)
        await updateAndEmitViewerCount(presence.kind, presence.streamId)
      }
    })

    socket.on('disconnecting', async () => {
      const rooms = Array.from(socket.rooms).filter((room) => room !== socket.id && !room.startsWith('user:'))
      await removeViewerPresence(socket.id)
      await Promise.all(rooms.filter((room) => room.includes(':')).map(async (room) => {
        const [kind, resourceId] = room.split(':', 2)
        if (kind === 'channel' || kind === 'match' || kind === 'stream') await updateAndEmitViewerCount(kind, resourceId)
      }))
    })
  })
}
