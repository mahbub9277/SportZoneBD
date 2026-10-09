import assert from 'node:assert/strict'
import test from 'node:test'

// `socketManager` imports the auth module, which refuses to load without JWT secrets configured, so the
// module under test is imported dynamically after the test-only secrets are set.
process.env.JWT_SECRET ??= 'socket-resilience-test-secret'
process.env.JWT_REFRESH_SECRET ??= 'socket-resilience-test-refresh-secret'

const {
  emitUserNotification,
  emitViewerCountUpdate,
  initializeSocketHandlers,
  runSocketEventHandler,
  setIoInstance,
  setSocketBroadcastGuard,
  setSocketClusterAdapterEnabled,
} = await import('./socketManager.js')
const { forgetViewerCount, resetViewerCountEmitState } = await import('./viewerPresence.js')

const CHANNEL_ID = '11111111-2222-4333-8444-555555555555'

type RecordedHandler = (...args: any[]) => unknown

/** The smallest io/socket pair the public handlers need, recording everything that is emitted. */
function createFakeSocketIo(options: { publishThrows?: boolean } = {}) {
  const published: Array<{ room: string | string[]; event: string }> = []
  const handlers = new Map<string, RecordedHandler>()
  const socketRooms = new Set<string>([CHANNEL_ID])

  const socket = {
    id: 'socket-1',
    rooms: socketRooms,
    join: async (room: string) => { socketRooms.add(room); return undefined },
    leave: async (room: string) => { socketRooms.delete(room); return undefined },
    on: (event: string, handler: RecordedHandler) => { handlers.set(event, handler); return socket },
    emit: () => undefined,
  }

  const broadcastOperator = (room: string | string[]) => ({
    emit: (event: string) => {
      if (options.publishThrows) {
        throw new Error("Stream isn't writeable and enableOfflineQueue options is false")
      }
      published.push({ room, event })
      return true
    },
  })

  const io: any = {
    use: () => io,
    on: (event: string, handler: RecordedHandler) => { handlers.set(event, handler); return io },
    of: () => io,
    to: (room: string | string[]) => broadcastOperator(room),
    emit: (event: string) => { published.push({ room: '*', event }); return true },
    sockets: { adapter: { rooms: new Map() } },
  }

  return { io, socket, handlers, published }
}

test('a viewer-count broadcast is skipped while the Redis adapter client cannot publish', () => {
  resetViewerCountEmitState()
  const { io, published } = createFakeSocketIo()
  setIoInstance(io)
  setSocketAdapterFlagForTest()

  setSocketBroadcastGuard(() => false)
  const emitted = emitViewerCountUpdate(CHANNEL_ID, 3)

  assert.equal(emitted, false, 'the caller learns that nothing was broadcast')
  assert.equal(published.length, 0, 'no publish is attempted, so the adapter cannot reject')
})

test('the same viewer count is broadcast again once Redis is writable', () => {
  resetViewerCountEmitState()
  const { io, published } = createFakeSocketIo()
  setIoInstance(io)

  setSocketBroadcastGuard(() => false)
  assert.equal(emitViewerCountUpdate(CHANNEL_ID, 5), false)

  setSocketBroadcastGuard(() => true)
  assert.equal(emitViewerCountUpdate(CHANNEL_ID, 5), true, 'a skipped update is not treated as delivered')
  assert.deepEqual(published, [{ room: CHANNEL_ID, event: 'viewerCountUpdate' }])
})

test('a skipped update is re-sent even when the next one is passive', () => {
  resetViewerCountEmitState()
  const { io, published } = createFakeSocketIo()
  setIoInstance(io)

  setSocketBroadcastGuard(() => false)
  assert.equal(emitViewerCountUpdate(CHANNEL_ID, 9, 'onChange'), false)
  // 'onChange' would normally treat 9 as already delivered; the rollback keeps the client correct.
  assert.equal(emitViewerCountUpdate(CHANNEL_ID, 9, 'onChange'), false, 'still skipped while Redis is unwritable')

  setSocketBroadcastGuard(() => true)
  assert.equal(emitViewerCountUpdate(CHANNEL_ID, 9, 'onChange'), true)
  assert.deepEqual(published, [{ room: CHANNEL_ID, event: 'viewerCountUpdate' }])
})

test('a synchronously failing broadcast is reported instead of escaping', () => {
  resetViewerCountEmitState()
  const { io } = createFakeSocketIo({ publishThrows: true })
  setIoInstance(io)
  setSocketBroadcastGuard(() => true)

  assert.doesNotThrow(() => emitViewerCountUpdate(CHANNEL_ID, 2))
  assert.equal(emitViewerCountUpdate(CHANNEL_ID, 4), false)
})

test('a rejected notification broadcast does not escape as an unhandled rejection', () => {
  const { io } = createFakeSocketIo()
  setIoInstance(io)
  setSocketBroadcastGuard(() => true)

  assert.doesNotThrow(() => emitUserNotification('user-1', {
    id: 'n1',
    userId: 'user-1',
    title: 'title',
    body: 'body',
    type: 'MATCH',
    channel: 'PUSH',
    createdAt: new Date(),
  }))
})

test('an async socket handler rejection is contained instead of reaching the process', async () => {
  const unhandled: unknown[] = []
  const onUnhandled = (reason: unknown) => { unhandled.push(reason) }
  process.on('unhandledRejection', onUnhandled)

  try {
    runSocketEventHandler('testEvent', async () => {
      throw new Error("Stream isn't writeable and enableOfflineQueue options is false")
    })
    // Two macrotask turns are enough for the rejection to have surfaced if it were unhandled.
    await new Promise((resolve) => setTimeout(resolve, 10))
  } finally {
    process.off('unhandledRejection', onUnhandled)
  }

  assert.deepEqual(unhandled, [], 'the rejection is handled and logged, never left unhandled')
})

test('viewer-room events keep working end to end and report the current count', async () => {
  resetViewerCountEmitState()
  const { io, socket, handlers, published } = createFakeSocketIo()
  setIoInstance(io)
  setSocketClusterAdapterEnabled(false)
  setSocketBroadcastGuard(() => true)

  initializeSocketHandlers(io)
  const connection = handlers.get('connection')
  assert.ok(connection, 'the public namespace registers a connection handler')
  connection(socket)

  const joinStream = handlers.get('joinStream')
  assert.ok(joinStream, 'joinStream is registered')

  joinStream({ streamId: CHANNEL_ID, kind: 'channel' })
  await new Promise((resolve) => setTimeout(resolve, 10))

  assert.ok(published.some((entry) => entry.event === 'resourceViewerCountUpdate'), 'the join is broadcast')
  assert.ok(published.some((entry) => entry.event === 'viewerCountUpdate'), 'the legacy channel event is broadcast too')

  forgetViewerCount(`channel:${CHANNEL_ID}`)
})

test('an invalid resource id is ignored without touching the broadcast path', async () => {
  resetViewerCountEmitState()
  const { io, socket, handlers, published } = createFakeSocketIo()
  setIoInstance(io)
  setSocketBroadcastGuard(() => true)

  initializeSocketHandlers(io)
  handlers.get('connection')?.(socket)

  handlers.get('joinChannel')?.({ channelId: 'not-a-uuid' })
  handlers.get('leaveStream')?.({ streamId: 42, kind: 'channel' })
  await new Promise((resolve) => setTimeout(resolve, 10))

  assert.equal(published.length, 0)
})

/** The publish guard is process state; keep tests from leaking it into one another. */
function setSocketAdapterFlagForTest(): void {
  setSocketClusterAdapterEnabled(false)
}
