import assert from 'node:assert/strict'
import test from 'node:test'
import { execFileSync } from 'node:child_process'
import IORedis from 'ioredis'
import { isRedisProviderFailure } from './redisFailover.js'

/**
 * The Socket.IO Redis adapter broadcasts with `this.pubClient.publish(channel, msg)` and ignores the
 * returned promise (verified in `@socket.io/redis-adapter/dist/index.js`, `broadcast()`), so a publish
 * rejection has no handler anywhere in the chain — exactly the stack the production log showed:
 * `ioredis.sendCommand → ioredis.publish → RedisAdapter.broadcast → BroadcastOperator.emit →
 * emitViewerCountUpdate → updateAndEmitViewerCount → joinViewerRoom`.
 *
 * These tests pin the two halves of that incident: the driver rejects a publish on a client that cannot
 * write, and an unhandled rejection terminates a Node process that has no classifier for it.
 */

const UNREACHABLE_REDIS_URL = 'redis://127.0.0.1:6399'

/** A client shaped like the adapter's own clients, pointed at a port nothing listens on. */
function createUnwritableClient(): any {
  const Redis: any = (IORedis as any)?.default ?? IORedis
  return new Redis(UNREACHABLE_REDIS_URL, {
    enableOfflineQueue: false,
    maxRetriesPerRequest: null,
    connectTimeout: 500,
    retryStrategy: () => null,
  })
}

test('a publish on a client that cannot write is rejected with the production message', async () => {
  const client = createUnwritableClient()
  try {
    const message = await client.publish('socket.io#/admin#admin-room#', JSON.stringify({ type: 'viewerCountUpdate' }))
      .then(() => 'resolved', (error: Error) => error.message)

    assert.equal(message, "Stream isn't writeable and enableOfflineQueue options is false")
    assert.equal(isRedisProviderFailure(new Error(String(message))), true, 'and is classified as a Redis availability failure')
  } finally {
    client.disconnect()
  }
})

test('the same unhandled publish terminates a Node process that does not classify it', () => {
  // The adapter never awaits its publish, so this is the shape the process actually sees. It runs in a
  // child process because the consequence under test is process termination.
  const script = [
    "const IORedis = require('ioredis')",
    'const Redis = IORedis.default ?? IORedis',
    `const client = new Redis(${JSON.stringify(UNREACHABLE_REDIS_URL)}, { enableOfflineQueue: false, retryStrategy: () => null, connectTimeout: 500 })`,
    "client.publish('socket.io#/admin#admin-room#', '{}')",
    "setTimeout(() => { console.log('STILL-ALIVE'); process.exit(0) }, 400)",
  ].join('\n')

  let exitCode = 0
  let stderr = ''
  try {
    execFileSync(process.execPath, ['-e', script], { cwd: process.cwd(), encoding: 'utf8', timeout: 20_000 })
  } catch (error) {
    const failure = error as { status?: number; stderr?: string; stdout?: string }
    exitCode = failure.status ?? -1
    stderr = failure.stderr ?? ''
  }

  assert.notEqual(exitCode, 0, 'the process does not survive an unhandled publish rejection')
  assert.match(stderr, /Stream isn't writeable and enableOfflineQueue options is false/)
  assert.doesNotMatch(stderr, /STILL-ALIVE/, 'the process is gone before the timer fires')
})
