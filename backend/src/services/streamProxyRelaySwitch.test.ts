import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { NextFunction, Request, Response } from 'express'

process.env.JWT_SECRET ??= 'stream-relay-enforcement-test-secret'
process.env.JWT_REFRESH_SECRET ??= 'stream-relay-enforcement-test-refresh-secret'
process.env.STREAM_RELAY_TTL_MS = '200'

const {
  abortActiveRelays,
  getStreamRelaySwitchStatus,
  invalidateStreamRelaySwitchCache,
  isStreamRelaySwitchEnabled,
  setStreamRelaySwitchReader,
} = await import('../core/streamRelaySwitch.js')
const { getStreamManifestProxy } = await import('./streamProxy.service.js')
const { relayStreamResource } = await import('../controllers/streamProxy.controller.js')
const { errorHandler, notFound } = await import('../core/middleware.js')

test.afterEach(() => {
  setStreamRelaySwitchReader(null)
  invalidateStreamRelaySwitchCache()
  abortActiveRelays()
})

/** Drives the controller the way express would, and captures how it answered. */
async function callRelayHandler(url: string) {
  const req = {
    method: 'GET',
    query: Object.fromEntries(new URL(url, 'https://api.invalid').searchParams),
    headers: {},
    once: () => undefined,
    off: () => undefined,
  } as unknown as Request

  const res = {
    headersSent: false,
    writableEnded: false,
    statusCode: 0,
    body: null as unknown,
    status(code: number) {
      this.statusCode = code
      return this
    },
    json(payload: unknown) {
      this.body = payload
      return this
    },
    send(payload: unknown) {
      this.body = payload
      return this
    },
    end() {
      return this
    },
    setHeader() {
      return this
    },
    once: () => undefined,
    off: () => undefined,
  }

  let refusal: unknown = null
  const next: NextFunction = ((error?: unknown) => {
    if (error) refusal = error
  }) as NextFunction

  await relayStreamResource(req, res as unknown as Response, next).catch((error: unknown) => {
    refusal = error
  })

  return { refusal, res }
}

/** The JSON a client would receive for a refusal, produced by the real error handler. */
function respondToError(error: unknown) {
  const res = {
    headersSent: false,
    statusCode: 0,
    body: null as unknown,
    status(code: number) {
      this.statusCode = code
      return this
    },
    json(payload: unknown) {
      this.body = payload
      return this
    },
    setHeader() {
      return this
    },
    getHeader: () => undefined,
  }

  errorHandler(
    error,
    {
      id: 'req-1',
      method: 'GET',
      url: '/api/v1/stream/relay',
      get: () => undefined,
      headers: {},
    } as unknown as Request,
    res as unknown as Response,
    () => undefined,
  )
  return res
}

test('a switched-off relay refuses a relay request before the database, the gate or the upstream', async () => {
  setStreamRelaySwitchReader({ read: async () => 'false' })
  const { refusal } = await callRelayHandler('/api/v1/stream/relay?channelId=0d4b0e2a-3d09-4a4c-8f85-6b1f0ff5f2a1&type=primary&url=http%3A%2F%2Fprovider.example%2Fseg.ts')

  assert.ok(refusal, 'a relay request must be refused while the relay is off')
  assert.equal((refusal as { statusCode?: number }).statusCode, 503)
  assert.equal((refusal as Error).name, 'StreamRelayDisabledError')
})

test('the refusal answers with the 503 and the code the player recognises', async () => {
  setStreamRelaySwitchReader({ read: async () => 'false' })

  const { refusal } = await callRelayHandler('/api/v1/stream/relay?channelId=0d4b0e2a-3d09-4a4c-8f85-6b1f0ff5f2a1')
  assert.ok(refusal)

  const response = respondToError(refusal)

  assert.equal(response.statusCode, 503)
  assert.deepEqual(
    { code: (response.body as { code?: string }).code, success: (response.body as { success?: boolean }).success },
    { code: 'STREAM_RELAY_DISABLED', success: false },
  )
})

test('a refusal costs no concurrency slot, so a disabled relay can never report itself as busy', async () => {
  setStreamRelaySwitchReader({ read: async () => 'false' })

  // Well past RELAY_MAX_CONCURRENT: if the disabled gate were behind the slot, the later requests would
  // come back as "the stream relay is busy" instead.
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const { refusal, res } = await callRelayHandler('/api/v1/stream/relay?channelId=0d4b0e2a-3d09-4a4c-8f85-6b1f0ff5f2a1')

    assert.equal((refusal as Error | null)?.name, 'StreamRelayDisabledError', `attempt ${attempt + 1} was not refused as disabled`)
    assert.equal(res.statusCode, 0, `attempt ${attempt + 1} answered instead of refusing`)
  }
})

test('a switch that cannot be read leaves the relay closed too', async () => {
  setStreamRelaySwitchReader({
    read: async () => {
      throw Object.assign(new Error('connection refused'), { code: 'P1001' })
    },
  })

  assert.equal(await isStreamRelaySwitchEnabled(), false)

  const { refusal } = await callRelayHandler('/api/v1/stream/relay?channelId=0d4b0e2a-3d09-4a4c-8f85-6b1f0ff5f2a1')

  assert.equal((refusal as Error | null)?.name, 'StreamRelayDisabledError')
  assert.equal(getStreamRelaySwitchStatus().degraded, true)
})

test('an http source is refused by the manifest path itself, before any upstream socket is opened', async () => {
  setStreamRelaySwitchReader({ read: async () => 'false' })

  // A public address literal, so the guard — not DNS — is what decides: if this were fetched, the request
  // would leave the process.
  await assert.rejects(
    () => getStreamManifestProxy({
      type: 'primary',
      targetUrl: 'http://93.184.216.34/index.m3u8',
    }),
    (error: unknown) => {
      assert.equal((error as Error).name, 'StreamRelayDisabledError', `expected the relay refusal, got ${String(error)}`)
      assert.equal((error as { statusCode?: number }).statusCode, 503)
      return true
    },
  )
})

test('an https source is not affected by the relay switch', async () => {
  setStreamRelaySwitchReader({ read: async () => 'false' })

  // The switch only governs non-HTTPS relay work, so this source reaches the provider step: the signal is
  // already aborted, which ends the attempt without a live provider and without a relay refusal.
  await assert.rejects(
    () => getStreamManifestProxy({
      type: 'primary',
      targetUrl: 'https://93.184.216.34/index.m3u8',
      signal: AbortSignal.timeout(5),
    }),
    (error: unknown) => {
      assert.notEqual((error as Error).name, 'StreamRelayDisabledError')
      return true
    },
  )
})

test('an unknown API path is still answered generically, so the relay switch never becomes a catch-all', () => {
  let refusal: unknown = null
  notFound({ id: 'req-2', method: 'GET', url: '/api/v1/nope' } as unknown as Request, {} as Response, (error?: unknown) => {
    refusal = error
  })

  assert.equal((refusal as { statusCode?: number } | null)?.statusCode, 404)
})

/** Runs `assertion` against a stream record, without a database behind the stream (and channel) lookups. */
async function withStreamRecord(stream: Record<string, unknown>, assertion: () => Promise<void>) {
  const { prisma } = await import('../core/prisma.js')
  const originalStream = prisma.stream
  const originalAllowedDomain = prisma.allowedDomain

  try {
    ;(prisma as { stream: unknown }).stream = { findUnique: async () => stream }
    ;(prisma as { allowedDomain: unknown }).allowedDomain = { findMany: async () => [] }
    await assertion()
  } finally {
    ;(prisma as { stream: unknown }).stream = originalStream
    ;(prisma as { allowedDomain: unknown }).allowedDomain = originalAllowedDomain
  }
}

/** The record path (a stream or channel id) is the one a real viewer uses. */
test('a stream record whose source is http is refused as a relay refusal, not as a bad gateway', async () => {
  setStreamRelaySwitchReader({ read: async () => 'false' })

  await withStreamRecord(
    {
      id: '11111111-2222-4333-8444-555555555555',
      enabled: true,
      sourceType: 'DIRECT_URL',
      primaryUrl: 'http://93.184.216.34/index.m3u8',
      backupUrl: null,
      channel: null,
    },
    () => assert.rejects(
      () => getStreamManifestProxy({
        streamId: '11111111-2222-4333-8444-555555555555',
        type: 'primary',
      }),
      (error: unknown) => {
        assert.equal((error as Error).name, 'StreamRelayDisabledError', `expected the relay refusal, got ${String(error)}`)
        assert.equal((error as { statusCode?: number }).statusCode, 503)
        return true
      },
    ),
  )
})

test('an http primary that the relay refuses still tries the stream’s https backup', async () => {
  setStreamRelaySwitchReader({ read: async () => 'false' })

  await withStreamRecord(
    {
      id: '11111111-2222-4333-8444-555555555555',
      enabled: true,
      sourceType: 'DIRECT_URL',
      primaryUrl: 'http://93.184.216.34/index.m3u8',
      // A backup the SSRF guard refuses: the point is that it was *reached*, which a refusal at validation
      // proves without a live provider. If the primary's relay refusal ended the attempt, this never runs.
      backupUrl: 'https://169.254.169.254/index.m3u8',
      channel: null,
    },
    () => assert.rejects(
      () => getStreamManifestProxy({
        streamId: '11111111-2222-4333-8444-555555555555',
        type: 'primary',
      }),
      (error: unknown) => {
        assert.notEqual((error as Error).name, 'StreamRelayDisabledError', 'the https backup must be attempted first')
        assert.match(String((error as Error).message), /local hosts/i)
        return true
      },
    ),
  )
})
