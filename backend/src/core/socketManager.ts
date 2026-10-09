/**
 * Defines the types for socket events between the server and clients.
 * This provides a single source of truth for event names and their payloads.
 */
import type { AutomationLog, AutomationMetrics, AutomationStatus } from '../modules/automation/automation.types.js'
import type { Server, Socket } from 'socket.io'
import logger from './logger.js'
import { verifyAccessToken } from './auth.js'
import { prisma } from './prisma.js'
import { getRedisErrorCode } from './redisFailover.js'
import {
  clearUnavailableViewerCount,
  forgetViewerCount,
  isValidViewerResourceId,
  markViewerCountUnavailable,
  normalizeViewerResource,
  parseViewerRoom,
  shouldEmitViewerCount,
  viewerRoom,
  type ViewerCountEmitMode,
  type ViewerResource,
  type ViewerResourceKind,
} from './viewerPresence.js'

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
  viewerCountUpdate: (payload: { channelId: string; count: number | null }) => void
  resourceViewerCountUpdate: (payload: { kind: 'channel' | 'match' | 'stream'; resourceId: string; count: number | null }) => void
  liveViewersUpdate: (payload: { totalLiveViewers: number | null }) => void
  applicationSettingChanged: (payload: { key: string; value: string }) => void
  'analytics:stream-health': (payload: Record<string, unknown>) => void
  automationStatusUpdate: (payload: AutomationStatus) => void
  automationMetricsUpdate: (payload: AutomationMetrics) => void
  automationLogEntry: (payload: AutomationLog) => void
  adminResourceCreated: (payload: { type: string; id: string; data: Record<string, any> }) => void
  adminResourceUpdated: (payload: { type: string; id: string; data: Record<string, any> }) => void
  adminResourceDeleted: (payload: { type: string; id: string }) => void
  matchStatusUpdated: (payload: { id: string; status: string; finishedAt?: Date | null }) => void
  notificationCreated: (payload: { id: string; userId: string; title: string; body: string; type: string; channel: string; link?: string | null; createdAt: Date }) => void
  notificationTransient: (payload: { id: string; title: string; body: string; type: string; link?: string | null }) => void
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
const TELEMETRY_SETTING_KEY = 'telemetry.enabled'
// Viewer counts are derived from Socket.IO room membership, so this module needs no Redis presence
// keys, per-viewer timestamps and no heartbeats. `clusterAdapterEnabled` is set by the server once
// the Redis adapter is installed: membership then may span instances, so the adapter is asked how
// many servers are connected before a count is resolved cluster-wide.
let clusterAdapterEnabled = false
let totalLiveViewersUnavailable = false

/** How long the adapter's server count is trusted; one check per minute at most. */
const CLUSTER_SERVER_COUNT_CACHE_MS = 60_000
let clusterServerCount = 1
let clusterServerCountCheckedAt = 0

/** Called by the server when the Redis adapter is installed, so counts stay cluster-wide. */
export function setSocketClusterAdapterEnabled(enabled: boolean): void {
  clusterAdapterEnabled = enabled
  clusterServerCountCheckedAt = 0
}

/**
 * Tells this module whether a broadcast can currently reach Redis.
 *
 * With the Redis adapter installed every broadcast is published through the adapter's own pub client,
 * and that client rejects the publish outright while its connection is not writable
 * (`enableOfflineQueue: false`). The adapter ignores that rejection, so it escapes as an unhandled
 * rejection — which this process treats as fatal. Gating broadcasts on the client's own writability
 * therefore keeps a Redis outage from becoming an application outage, and matches the existing
 * semantics: viewer counts are change-gated values that are re-sent on the next membership change, so
 * a skipped update is coalesced rather than queued or retried.
 */
let adapterPublishable: (() => boolean) | null = null

export function setSocketBroadcastGuard(isPublishable: () => boolean): void {
  adapterPublishable = isPublishable
}

/** True while a broadcast can actually be published (no adapter, or a writable adapter client). */
export function isSocketBroadcastAvailable(): boolean {
  if (!ioInstance) return false
  if (!adapterPublishable) return true
  try {
    return adapterPublishable()
  } catch {
    return false
  }
}

/** Bounded, privacy-safe description of a socket/Redis failure for the log line. */
function describeSocketError(error: unknown): { code?: string; errorType: string; message: string } {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : 'Unknown socket error'
  return {
    code: getRedisErrorCode(error),
    errorType: error instanceof Error ? error.name : typeof error,
    message: message.slice(0, 300),
  }
}

/**
 * Runs a broadcast without letting a Redis outage escape as an unhandled rejection.
 *
 * Returns whether the emit was dispatched. A skipped broadcast is reported once per event name (see
 * `logSkippedBroadcast`) so an outage is visible without logging every viewer.
 */
function dispatchBroadcast(label: string, action: () => void): boolean {
  if (!isSocketBroadcastAvailable()) {
    logSkippedBroadcast(label)
    return false
  }

  try {
    action()
    return true
  } catch (error) {
    logger.error({ label, ...describeSocketError(error) }, 'Socket.IO broadcast failed')
    return false
  }
}

/**
 * Skipped broadcasts are summarised per event name at most once a minute: a Redis outage skips every
 * broadcast, and one line per event is enough to see it without drowning the log.
 */
const SKIPPED_BROADCAST_LOG_INTERVAL_MS = 60_000
const skippedBroadcastLogs = new Map<string, { at: number; count: number }>()

function logSkippedBroadcast(label: string): void {
  const now = Date.now()
  const entry = skippedBroadcastLogs.get(label)
  if (entry && now - entry.at < SKIPPED_BROADCAST_LOG_INTERVAL_MS) {
    entry.count += 1
    return
  }
  logger.warn({ label, skippedSinceLastLog: entry?.count ?? 0 }, 'Socket.IO broadcast skipped because the Redis adapter client is not writable')
  skippedBroadcastLogs.set(label, { at: now, count: 0 })
  if (skippedBroadcastLogs.size > 50) {
    for (const [key, value] of skippedBroadcastLogs) {
      if (now - value.at > SKIPPED_BROADCAST_LOG_INTERVAL_MS) skippedBroadcastLogs.delete(key)
    }
  }
}

/**
 * Runs an async socket event handler and turns any rejection into a logged failure.
 *
 * Socket.IO does not await handlers registered with `socket.on`, so a rejected promise from one would
 * otherwise escape the process entirely. Rejections are reported with the event name, the error class
 * and its Redis code, but never swallowed silently.
 */
export function runSocketEventHandler(label: string, task: () => Promise<unknown>): void {
  void task().catch((error) => {
    logger.error({ event: label, ...describeSocketError(error) }, 'Socket event handler failed')
  })
}

/**
 * True only while more than one Socket.IO server shares the adapter. A single instance keeps using
 * the process-local membership map, which costs no Redis commands at all; a real cluster resolves
 * rooms through the adapter that is already installed (no presence keys, no polling).
 */
export async function isSocketClusterActive(): Promise<boolean> {
  if (!clusterAdapterEnabled || !ioInstance) return false
  const now = Date.now()
  if (now - clusterServerCountCheckedAt < CLUSTER_SERVER_COUNT_CACHE_MS) return clusterServerCount > 1
  clusterServerCountCheckedAt = now
  try {
    clusterServerCount = await ioInstance.of('/').adapter.serverCount()
  } catch (error) {
    logger.warn({ error }, 'Unable to read the Socket.IO server count, assuming a single instance')
    clusterServerCount = 1
  }
  return clusterServerCount > 1
}

function localRoomViewerCount(room: string): number {
  return ioInstance?.sockets.adapter.rooms.get(room)?.size ?? 0
}

/** Every viewer room this process currently knows about, used for the admin total. */
function listLocalViewerRooms(): string[] {
  const rooms = ioInstance?.sockets.adapter.rooms
  if (!rooms) return []
  return [...rooms.keys()].filter((room) => parseViewerRoom(room) !== null)
}

async function countRoomViewers(room: string): Promise<number | null> {
  if (!ioInstance) return null
  if (await isSocketClusterActive()) {
    try {
      const sockets = await ioInstance.in(room).fetchSockets()
      return sockets.length
    } catch (error) {
      logger.warn({ error }, 'Cross-instance viewer count failed, falling back to the process-local room')
    }
  }
  return localRoomViewerCount(room)
}

async function emitLiveViewerCount(totalLiveViewers: number | null, mode: ViewerCountEmitMode = 'force'): Promise<void> {
  if (!ioInstance) return
  if (totalLiveViewers === null) {
    if (totalLiveViewersUnavailable) return
    totalLiveViewersUnavailable = true
    forgetViewerCount('total')
    const deliveredToAdmins = dispatchBroadcast('liveViewersUpdate', () => ioInstance!.of('/admin').to(ADMIN_ROOM).emit('liveViewersUpdate', { totalLiveViewers: null }))
    if (!deliveredToAdmins) rollbackSkippedEmit('total', true)
    return
  }
  totalLiveViewersUnavailable = false
  const count = Number.isFinite(totalLiveViewers) && totalLiveViewers > 0 ? Math.floor(totalLiveViewers) : 0
  if (!shouldEmitViewerCount('total', count, mode)) return
  const delivered = dispatchBroadcast('liveViewersUpdate', () => ioInstance!.of('/admin').to(ADMIN_ROOM).emit('liveViewersUpdate', { totalLiveViewers: count }))
  if (!delivered) rollbackSkippedEmit('total', false)
}

/**
 * Total viewers across the resources this process tracks. With a single instance that sum is exact
 * and costs no Redis commands; in a cluster the known rooms are resolved through the adapter, and an
 * instance that currently tracks no viewer room reports "unavailable" rather than a misleading zero.
 */
export async function getTotalLiveViewers(): Promise<number | null> {
  const io = ioInstance
  if (!io) return null
  const rooms = listLocalViewerRooms()
  const clusterActive = await isSocketClusterActive()
  if (rooms.length === 0) return clusterActive ? null : 0
  if (clusterActive) {
    try {
      const sockets = await io.in(rooms).fetchSockets()
      return sockets.length
    } catch (error) {
      logger.warn({ error }, 'Cross-instance total viewer count failed, using the process-local rooms')
    }
  }
  return rooms.reduce((total, room) => total + localRoomViewerCount(room), 0)
}

export async function getLiveViewerCount(kind: ViewerResourceKind, resourceId: string): Promise<number | null> {
  if (!isValidViewerResourceId(resourceId)) return null
  return countRoomViewers(viewerRoom({ kind, resourceId }))
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
  dispatchBroadcast('automationStatusUpdate', () => ioInstance!.to(ADMIN_ROOM).emit('automationStatusUpdate', data))
}

/** Emits an automation metrics update to all clients in the admin room. */
export function emitAutomationMetricsUpdate(metrics: AutomationMetrics): void {
  if (!ioInstance) {
    logger.warn('Socket.IO instance not available for emitAutomationMetricsUpdate.')
    return
  }
  dispatchBroadcast('automationMetricsUpdate', () => ioInstance!.to(ADMIN_ROOM).emit('automationMetricsUpdate', metrics))
}

/** Emits a new automation log entry to all clients in the admin room. */
export function emitAutomationLogEntry(logEntry: AutomationLog): void {
  if (!ioInstance) {
    logger.warn('Socket.IO instance not available for emitAutomationLogEntry.')
    return
  }
  dispatchBroadcast('automationLogEntry', () => ioInstance!.to(ADMIN_ROOM).emit('automationLogEntry', logEntry))
}

/**
 * Undoes the emit bookkeeping when nothing was actually published.
 *
 * A skipped broadcast must not be remembered as delivered, otherwise the next event for the same scope
 * would be suppressed as a duplicate and the client would keep showing a stale count until an
 * unrelated membership change forced a new value.
 */
function rollbackSkippedEmit(scope: string, wasUnavailable: boolean): void {
  forgetViewerCount(scope)
  if (wasUnavailable) clearUnavailableViewerCount(scope)
}

/** Emits a viewer count update to a specific channel room; returns true when it was broadcast. */
export function emitViewerCountUpdate(channelId: string, count: number | null, mode: ViewerCountEmitMode = 'force'): boolean {
  if (!ioInstance) {
    logger.warn('Socket.IO instance not available for emitViewerCountUpdate.')
    return false
  }
  const scope = `channel:${channelId}`
  if (count === null) {
    if (!markViewerCountUnavailable(scope)) return false
  } else {
    clearUnavailableViewerCount(scope)
    if (!shouldEmitViewerCount(scope, count, mode)) return false
  }

  const delivered = dispatchBroadcast('viewerCountUpdate', () => ioInstance!.to(channelId).emit('viewerCountUpdate', { channelId, count }))
  if (!delivered) rollbackSkippedEmit(scope, count === null)
  return delivered
}

export function emitResourceViewerCountUpdate(kind: ViewerResourceKind, resourceId: string, count: number | null, mode: ViewerCountEmitMode = 'force'): boolean {
  if (!ioInstance) return false
  const scope = viewerRoom({ kind, resourceId })
  if (count === null) {
    if (!markViewerCountUnavailable(scope)) return false
  } else {
    clearUnavailableViewerCount(scope)
    if (!shouldEmitViewerCount(scope, count, mode)) return false
  }

  const delivered = dispatchBroadcast('resourceViewerCountUpdate', () => ioInstance!.to(scope).emit('resourceViewerCountUpdate', { kind, resourceId, count }))
  if (!delivered) rollbackSkippedEmit(scope, count === null)
  return delivered
}

export function emitStreamUpdated(payload: { streamId?: string; channelId?: string; source: 'primary' | 'backup'; version: string }): void {
  if (!ioInstance) return
  dispatchBroadcast('stream:updated', () => ioInstance!.emit('stream:updated', payload))
}

/** Emits a resource creation event to all admins in the admin room. */
export function emitAdminResourceCreated(type: string, id: string, data: Record<string, any>): void {
  if (!ioInstance) {
    logger.warn('Socket.IO instance not available for emitAdminResourceCreated.')
    return
  }
  dispatchBroadcast('adminResourceCreated', () => ioInstance!.of('/admin').to(ADMIN_ROOM).emit('adminResourceCreated', { type, id, data }))
}

/** Emits a resource update event to all admins in the admin room. */
export function emitAdminResourceUpdated(type: string, id: string, data: Record<string, any>): void {
  if (!ioInstance) {
    logger.warn('Socket.IO instance not available for emitAdminResourceUpdated.')
    return
  }
  dispatchBroadcast('adminResourceUpdated', () => ioInstance!.of('/admin').to(ADMIN_ROOM).emit('adminResourceUpdated', { type, id, data }))
}

/** Emits a resource deletion event to all admins in the admin room. */
export function emitAdminResourceDeleted(type: string, id: string): void {
  if (!ioInstance) {
    logger.warn('Socket.IO instance not available for emitAdminResourceDeleted.')
    return
  }
  dispatchBroadcast('adminResourceDeleted', () => ioInstance!.of('/admin').to(ADMIN_ROOM).emit('adminResourceDeleted', { type, id }))
}

export function emitMatchStatusUpdated(payload: { id: string; status: string; finishedAt?: Date | null }): void {
  if (!ioInstance) return
  dispatchBroadcast('matchStatusUpdated', () => ioInstance!.emit('matchStatusUpdated', payload))
}

export function emitUserNotification(userId: string, payload: Parameters<ServerToClientEvents['notificationCreated']>[0]): void {
  if (!ioInstance) return
  dispatchBroadcast('notificationCreated', () => ioInstance!.to(`user:${userId}`).emit('notificationCreated', payload))
}

/**
 * Emits a UI-only alert to the open tabs of the given users. It is never persisted, never counted
 * as unread and never listed in the In-App inbox; it exists only so a focused tab still surfaces an
 * alert that the service worker intentionally suppresses while a SportZoneBD window is focused.
 * All recipients are targeted with a single room-set broadcast to avoid per-user adapter traffic.
 */
export function emitTransientNotification(userIds: string[], payload: Parameters<ServerToClientEvents['notificationTransient']>[0]): void {
  if (userIds.length === 0 || !ioInstance) return
  dispatchBroadcast('notificationTransient', () => ioInstance!.to(userIds.map((userId) => `user:${userId}`)).emit('notificationTransient', payload))
}

/** An admin setting change is only a UI hint, so it is broadcast through the same guarded path. */
export function emitApplicationSettingChanged(key: string, value: string): void {
  if (!ioInstance) return
  dispatchBroadcast('applicationSettingChanged', () => ioInstance!.emit('applicationSettingChanged', { key, value }))
}

/** Player health summary for the analytics dashboard, broadcast to admins through the guarded path. */
export function emitStreamHealthSummary(summary: Record<string, unknown>): void {
  if (!ioInstance) return
  dispatchBroadcast('analytics:stream-health', () => ioInstance!.of('/admin').to(ADMIN_ROOM).emit('analytics:stream-health', summary))
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
      || getCookieValue(socket.handshake.headers.cookie, ACCESS_TOKEN_COOKIE)
    if (!token) {
      return next(new Error('Authentication error: No token provided'))
    }

    try {
      const payload = verifyAccessToken(token)
      const session = await prisma.session.findFirst({
        where: {
          id: payload.jti,
          userId: payload.sub,
          deletedAt: null,
          expiresAt: { gt: new Date() },
        },
        select: { id: true },
      })
      if (!session) {
        return next(new Error('Authentication error: Session is unavailable'))
      }

      const user = await prisma.user.findUnique({
        where: { id: payload.sub, deletedAt: null },
        select: {
          isActive: true,
          isSuspended: true,
          isBanned: true,
          roles: {
            where: { deletedAt: null, role: { is: { deletedAt: null } } },
            select: { role: { select: { name: true } } },
          },
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
    // A freshly connected admin missed earlier updates, so it always gets the current total once.
    runSocketEventHandler('adminNamespaceConnection', async () => {
      await emitLiveViewerCount(await getTotalLiveViewers(), 'force')
    })
  })

  io.use((socket, next) => {
    const token = socket.handshake.auth?.token
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
    void prisma.setting.findUnique({ where: { key: TELEMETRY_SETTING_KEY } })
      .then((setting) => socket.emit('applicationSettingChanged', {
        key: TELEMETRY_SETTING_KEY,
        value: !setting || setting.deletedAt !== null || setting.value !== 'false' ? 'true' : 'false',
      }))
      .catch((error) => logger.warn({ error }, 'Unable to load telemetry setting for socket client'))

    const userId = (socket as any).user?.sub
    if (typeof userId === 'string') void socket.join(`user:${userId}`)

    // The count is whatever the room contains, so a repeat join cannot double count a socket
    // (Socket.IO rooms are sets) and a disconnect cannot leave a stale viewer behind.
    const updateAndEmitViewerCount = async (kind: ViewerResourceKind, resourceId: string, mode: ViewerCountEmitMode = 'force') => {
      const count = await getLiveViewerCount(kind, resourceId)
      const emittedChannel = kind === 'channel' ? emitViewerCountUpdate(resourceId, count, mode) : false
      const emittedResource = emitResourceViewerCountUpdate(kind, resourceId, count, mode)
      if (emittedChannel || emittedResource) await emitLiveViewerCount(await getTotalLiveViewers(), 'onChange')
    }

    // A session only ever views one resource, so switching (match A -> match B, channel -> match, …)
    // releases the previous room and emits its new count here too, not only on the client.
    const releaseOtherViewerRooms = async (target: ViewerResource) => {
      const targetRoom = viewerRoom(target)
      const otherResources = Array.from(socket.rooms)
        .map((room) => parseViewerRoom(room))
        .filter((resource): resource is ViewerResource => resource !== null && viewerRoom(resource) !== targetRoom)
      for (const resource of otherResources) await leaveViewerRoom(resource)
    }

    const joinViewerRoom = async (resource: ViewerResource, mode: ViewerCountEmitMode = 'force') => {
      const room = viewerRoom(resource)
      // A repeat join for the same resource is a membership no-op, so it must not re-broadcast.
      const alreadyCounted = socket.rooms.has(room)
      if (!alreadyCounted) await releaseOtherViewerRooms(resource)
      await socket.join(room)
      // The bare channel room is the legacy target of `viewerCountUpdate`; joining it keeps the
      // pre-existing event contract working for clients that still listen on it.
      if (resource.kind === 'channel') await socket.join(resource.resourceId)
      if (alreadyCounted) return
      await updateAndEmitViewerCount(resource.kind, resource.resourceId, mode)
    }

    const leaveViewerRoom = async (resource: ViewerResource, mode: ViewerCountEmitMode = 'force') => {
      await socket.leave(viewerRoom(resource))
      if (resource.kind === 'channel') await socket.leave(resource.resourceId)
      await updateAndEmitViewerCount(resource.kind, resource.resourceId, mode)
    }

    socket.on('joinChannel', ({ channelId }) => {
      const resource = normalizeViewerResource(channelId, 'channel')
      if (!resource) return

      runSocketEventHandler('joinChannel', async () => {
        const targetRoom = viewerRoom(resource)
        const previousRooms = Array.from(socket.rooms).filter((room) => room !== socket.id && !room.startsWith('user:') && room !== targetRoom)
        await Promise.all(previousRooms.map((room) => socket.leave(room)))

        await joinViewerRoom(resource)
      })
    })

    socket.on('leaveChannel', ({ channelId }) => {
      const resource = normalizeViewerResource(channelId, 'channel')
      if (!resource) return

      runSocketEventHandler('leaveChannel', () => leaveViewerRoom(resource))
    })

    socket.on('joinStream', ({ streamId, kind }) => {
      const resource = normalizeViewerResource(streamId, kind)
      if (!resource) return

      runSocketEventHandler('joinStream', () => joinViewerRoom(resource))
    })

    socket.on('leaveStream', ({ streamId, kind }) => {
      const resource = normalizeViewerResource(streamId, kind)
      if (!resource) return

      runSocketEventHandler('leaveStream', () => leaveViewerRoom(resource))
    })

    // Kept for clients that still send the previous 60s heartbeat. Socket.IO's own connection
    // lifecycle already handles liveness, so this only re-asserts membership and costs no I/O.
    socket.on('viewerHeartbeat', ({ streamId, kind }) => {
      const resource = normalizeViewerResource(streamId, kind)
      if (!resource || socket.rooms.has(viewerRoom(resource))) return

      runSocketEventHandler('viewerHeartbeat', () => joinViewerRoom(resource, 'onChange'))
    })

    // Rooms are still populated while 'disconnecting' runs but already cleaned up by 'disconnect',
    // so the departing resources are captured first and only then re-counted.
    let departingViewerResources: ViewerResource[] = []
    socket.on('disconnecting', () => {
      departingViewerResources = Array.from(socket.rooms)
        .map((room) => parseViewerRoom(room))
        .filter((resource): resource is ViewerResource => resource !== null)
    })

    // Disconnect cleanup is the last chance to correct a viewer count, so a failing re-count here must
    // never escape: it runs while the socket is already gone and has no caller to report to.
    socket.on('disconnect', () => {
      const resources = departingViewerResources
      departingViewerResources = []
      if (resources.length === 0) return

      runSocketEventHandler('disconnect', async () => {
        for (const resource of resources) {
          await updateAndEmitViewerCount(resource.kind, resource.resourceId)
        }
      })
    })
  })
}
