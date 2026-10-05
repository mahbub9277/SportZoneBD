/**
 * Viewer presence for the public watch surfaces.
 *
 * A viewer is exactly one active Socket.IO session in a resource room, so the count is derived from
 * room membership that Socket.IO already maintains (`match:<id>`, `channel:<id>`, `stream:<id>`).
 * Nothing here writes to Redis or the database: joining a room is the only state change, Socket.IO's
 * own connection lifecycle removes the membership on disconnect, and the count is emitted when the
 * membership number actually differs from the last emitted value.
 *
 * The module therefore holds only the pure parts — resource validation, room naming and the
 * change-gated emit bookkeeping — which keeps them unit testable without a socket server.
 */
export type ViewerResourceKind = 'stream' | 'channel' | 'match'

export interface ViewerResource {
  kind: ViewerResourceKind
  resourceId: string
}

/** Join, leave and disconnect emit with `force`; passive re-asserts use `onChange`. */
export type ViewerCountEmitMode = 'force' | 'onChange'

const VIEWER_RESOURCE_KINDS: readonly ViewerResourceKind[] = ['stream', 'channel', 'match']
/** Channels, matches and streams all use uuid primary keys, so an id that is not a uuid is unknown. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_TRACKED_VIEWER_COUNT_SCOPES = 500

const emittedViewerCounts = new Map<string, number>()
const unavailableViewerCountScopes = new Set<string>()

export function isValidViewerResourceId(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value.trim())
}

/**
 * Validates a client supplied `{ streamId, kind }`. The id must be a uuid, which is what keeps a
 * client from joining an internal room (`user:<id>`, `admin-room`, …); an unknown kind is treated as
 * a plain stream so older clients keep working.
 */
export function normalizeViewerResource(resourceId: unknown, kind: unknown): ViewerResource | null {
  if (!isValidViewerResourceId(resourceId)) return null
  const normalizedKind = VIEWER_RESOURCE_KINDS.includes(kind as ViewerResourceKind)
    ? (kind as ViewerResourceKind)
    : 'stream'
  return { kind: normalizedKind, resourceId: resourceId.trim() }
}

/** The room that holds every viewer of a resource; its size is the viewer count. */
export function viewerRoom({ kind, resourceId }: ViewerResource): string {
  return `${kind}:${resourceId}`
}

/** Parses a room created by `viewerRoom` and ignores every other room in the namespace. */
export function parseViewerRoom(room: string): ViewerResource | null {
  const separator = room.indexOf(':')
  if (separator <= 0) return null
  const kind = room.slice(0, separator)
  const resourceId = room.slice(separator + 1)
  if (!VIEWER_RESOURCE_KINDS.includes(kind as ViewerResourceKind)) return null
  if (!isValidViewerResourceId(resourceId)) return null
  return { kind: kind as ViewerResourceKind, resourceId }
}

/**
 * Room membership changes are discrete events (never a timer), so a repeated value is still sent
 * when a viewer just joined and only suppressed for passive re-asserts of the same value.
 */
export function shouldEmitViewerCount(scope: string, count: number, mode: ViewerCountEmitMode): boolean {
  if (mode === 'onChange' && emittedViewerCounts.get(scope) === count) return false
  if (emittedViewerCounts.size > MAX_TRACKED_VIEWER_COUNT_SCOPES) emittedViewerCounts.clear()
  emittedViewerCounts.set(scope, count)
  return true
}

export function forgetViewerCount(scope: string): void {
  emittedViewerCounts.delete(scope)
}

/** Returns true only once while a scope stays unavailable, so `null` is not re-broadcast. */
export function markViewerCountUnavailable(scope: string): boolean {
  if (unavailableViewerCountScopes.has(scope)) return false
  unavailableViewerCountScopes.add(scope)
  forgetViewerCount(scope)
  return true
}

export function clearUnavailableViewerCount(scope: string): void {
  unavailableViewerCountScopes.delete(scope)
}

/** Test helper: clears the emit bookkeeping between cases. */
export function resetViewerCountEmitState(): void {
  emittedViewerCounts.clear()
  unavailableViewerCountScopes.clear()
}
