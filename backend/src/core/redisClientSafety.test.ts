import assert from 'node:assert/strict'
import test from 'node:test'
import { EventEmitter } from 'node:events'
import IORedis from 'ioredis'
import { attachRedisClientLogging, closeRedisClientSafely } from './redis.js'
import { isRedisProviderFailure } from './redisFailover.js'

/** An ioredis-shaped client whose `quit()` behaves exactly like the real one on a dead socket. */
class FakeRedisClient {
  status: string
  quitCalls = 0
  disconnectCalls = 0

  constructor(status: string, private readonly quitFails = false) {
    this.status = status
  }

  async quit(): Promise<'OK'> {
    this.quitCalls += 1
    if (this.quitFails) {
      throw new Error("Stream isn't writeable and enableOfflineQueue options is false")
    }
    this.status = 'end'
    return 'OK'
  }

  disconnect(): void {
    this.disconnectCalls += 1
    this.status = 'end'
  }
}

test('a connected client is quit gracefully', async () => {
  const client = new FakeRedisClient('ready')
  await closeRedisClientSafely(client, 'test-ready')
  assert.equal(client.quitCalls, 1)
  assert.equal(client.disconnectCalls, 0)
})

test('a client that is not connected is disconnected instead of being quit', async () => {
  const client = new FakeRedisClient('reconnecting')
  await closeRedisClientSafely(client, 'test-reconnecting')
  assert.equal(client.quitCalls, 0)
  assert.equal(client.disconnectCalls, 1)
})

test('a rejected quit is reported but never escapes the shutdown sequence', async () => {
  const client = new FakeRedisClient('ready', true)
  await closeRedisClientSafely(client, 'test-rejected-quit')
  assert.equal(client.quitCalls, 1)
  assert.equal(client.disconnectCalls, 1)
})

test('closing a missing or already released client is a no-op', async () => {
  await closeRedisClientSafely(null, 'test-null')
  await closeRedisClientSafely(undefined, 'test-undefined')
  const client = { disconnectCalls: 0, disconnect() { this.disconnectCalls += 1 } }
  await closeRedisClientSafely(client, 'test-no-quit')
  assert.equal(client.disconnectCalls, 1)
})

test('connection errors are logged once per interval with the suppressed count', () => {
  const client = new EventEmitter() as EventEmitter & { status: string }
  client.status = 'reconnecting'
  const lines: Array<Record<string, unknown>> = []
  const fakeLogger = {
    info: () => undefined,
    warn: () => undefined,
    error: (fields: Record<string, unknown>) => { lines.push(fields) },
  }

  attachRedisClientLogging(client, 'test-client', fakeLogger)
  const error = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' })
  client.emit('error', error)
  client.emit('error', error)
  client.emit('error', error)

  assert.equal(lines.length, 1, 'a burst of connection errors collapses into one line')
  assert.equal(lines[0].provider, 'test-client')
  assert.equal(lines[0].code, 'ECONNREFUSED')
  assert.equal(lines[0].status, 'reconnecting')
})

test('recovery is reported once the connection is ready again', () => {
  const client = new EventEmitter() as EventEmitter & { status: string }
  client.status = 'reconnecting'
  const recoveries: Array<Record<string, unknown>> = []
  const fakeLogger = {
    info: (fields: Record<string, unknown>) => { recoveries.push(fields) },
    warn: () => undefined,
    error: () => undefined,
  }

  attachRedisClientLogging(client, 'test-client', fakeLogger)
  client.emit('error', Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }))
  client.status = 'ready'
  client.emit('ready')

  assert.equal(recoveries.length, 1)
  assert.equal(recoveries[0].provider, 'test-client')
})

test('a real client that never reached the provider is closed without throwing', async () => {
  // The production shutdown case: the client exists but its connection is gone, so `quit()` would be
  // rejected with the offline-write error. Shutdown must still complete and report nothing fatal.
  const Redis: any = (IORedis as any)?.default ?? IORedis
  const client = new Redis('redis://127.0.0.1:6399', {
    enableOfflineQueue: false,
    maxRetriesPerRequest: null,
    connectTimeout: 300,
    retryStrategy: () => null,
  })

  const logged: string[] = []
  const fakeLogger = {
    info: (_fields: Record<string, unknown>, message: string) => { logged.push(`info:${message}`) },
    warn: (_fields: Record<string, unknown>, message: string) => { logged.push(`warn:${message}`) },
    error: (_fields: Record<string, unknown>, message: string) => { logged.push(`error:${message}`) },
  }

  try {
    await new Promise((resolve) => setTimeout(resolve, 150))
    await closeRedisClientSafely(client, 'test-real-unreachable', fakeLogger)
    assert.equal(client.status, 'end', 'the client is released even though it never connected')
    assert.ok(logged.some((line) => line.includes('Redis client disconnected')), 'the close is reported')
    assert.ok(!logged.some((line) => line.startsWith('error:')), 'a dead client is not reported as an error')
  } finally {
    client.disconnect()
  }
})

test('the ioredis offline-write failure is classified as a Redis availability failure', () => {
  assert.equal(isRedisProviderFailure(new Error("Stream isn't writeable and enableOfflineQueue options is false")), true)
  assert.equal(isRedisProviderFailure(Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' })), true)
  assert.equal(isRedisProviderFailure(Object.assign(new Error('max requests limit exceeded'), { code: 'ERR' })), true)
  assert.equal(isRedisProviderFailure(new Error('Connection is closed.')), true)
})

test('a programming error is still treated as fatal, not as a Redis outage', () => {
  assert.equal(isRedisProviderFailure(new TypeError('Cannot read properties of undefined')), false)
  assert.equal(isRedisProviderFailure(new Error('job payload is missing a userId')), false)
})
