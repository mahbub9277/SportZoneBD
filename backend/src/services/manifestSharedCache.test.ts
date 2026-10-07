import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createManifestSharedCache, type ManifestCacheEntry } from './manifestSharedCache.js'

const entry: ManifestCacheEntry = {
  expiresAt: Date.now() + 5_000,
  body: '#EXTM3U\n#EXT-X-VERSION:3\n',
  contentType: 'application/vnd.apple.mpegurl',
  sourceUrl: 'https://origin.example/live/index.m3u8',
  usedBackup: false,
}

function createCountingClient() {
  const calls: Array<{ command: string; args: unknown[] }> = []
  return {
    calls,
    client: {
      get: async (...args: unknown[]) => {
        calls.push({ command: 'get', args })
        return null
      },
      set: async (...args: unknown[]) => {
        calls.push({ command: 'set', args })
        return 'OK'
      },
    },
  }
}

test('a single-instance deployment issues no Redis command for manifest sharing', async () => {
  const { calls, client } = createCountingClient()
  const sharedCache = createManifestSharedCache({ enabled: false, ttlMs: 5_000, client })

  assert.equal(await sharedCache.read('stream-1:primary:https://origin.example/live/index.m3u8'), null)
  await sharedCache.write('stream-1:primary:https://origin.example/live/index.m3u8', entry)

  assert.deepEqual(calls, [], 'no read and no write may reach Redis while the shared cache is disabled')
})

test('a multi-instance deployment reads and writes the shared manifest entry', async () => {
  const cacheKey = 'stream-1:primary:https://origin.example/live/index.m3u8'
  const { calls, client } = createCountingClient()
  const sharedCache = createManifestSharedCache({ enabled: true, ttlMs: 5_000, client })

  assert.equal(await sharedCache.read(cacheKey), null, 'a miss stays a miss')
  await sharedCache.write(cacheKey, entry)

  assert.deepEqual(calls.map((call) => call.command), ['get', 'set'])
  assert.deepEqual(calls[0].args, ['sportzone:stream:manifest:stream-1:primary:https://origin.example/live/index.m3u8'])
  // The shared copy keeps the lifetime of the process-local entry it mirrors: 5s, never longer.
  assert.deepEqual(calls[1].args, [
    'sportzone:stream:manifest:stream-1:primary:https://origin.example/live/index.m3u8',
    JSON.stringify(entry),
    'EX',
    5,
  ])
})

test('a multi-instance deployment parses a manifest another instance resolved', async () => {
  const stored = JSON.stringify(entry)
  const sharedCache = createManifestSharedCache({
    enabled: true,
    ttlMs: 5_000,
    client: {
      get: async () => stored,
      set: async () => 'OK',
    },
  })

  assert.deepEqual(await sharedCache.read('any-key'), entry)
})

test('the shared TTL can never outlive the process-local manifest window', async () => {
  const { calls, client } = createCountingClient()
  const sharedCache = createManifestSharedCache({ enabled: true, ttlMs: 4_500, client })

  await sharedCache.write('key', entry)

  assert.deepEqual(calls[0].args.slice(-2), ['EX', 5], 'a sub-second TTL still rounds to whole seconds')
})

test('a malformed shared entry surfaces to the caller that logs and falls back to the origin', async () => {
  const sharedCache = createManifestSharedCache({
    enabled: true,
    ttlMs: 5_000,
    client: {
      get: async () => '{not-json',
      set: async () => 'OK',
    },
  })

  await assert.rejects(() => sharedCache.read('key'), SyntaxError)
})
