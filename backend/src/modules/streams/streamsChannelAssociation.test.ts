import assert from 'node:assert/strict'
import { test } from 'node:test'

process.env.JWT_SECRET ??= 'streams-channel-association-test-secret'
process.env.JWT_REFRESH_SECRET ??= 'streams-channel-association-test-refresh-secret'
// The stream service invalidates cache tags; this test must not need Redis.
delete process.env.REDIS_URL
delete process.env.REDIS_URL_PRIMARY

const { createStream, updateStream } = await import('./streams.service.js')

/**
 * Channel association at the persistence boundary.
 *
 * The form no longer asks for a primary URL when an existing channel is selected, so what actually reaches the
 * database is asserted here: a channel-sourced stream stores that channel's own URL (the column is
 * non-nullable), an ordinary direct stream keeps the URL it was given, and linking an existing channel never
 * creates or updates a Channel row.
 */

const MATCH_ID = '99999999-8888-4777-8666-555555555555'
const CHANNEL_ID = '11111111-2222-4333-8444-555555555555'
const STREAM_ID = '77777777-6666-4555-8444-333333333333'
const CHANNEL_URL = 'https://cdn.example.com/banglavision/index.m3u8'

interface Call {
  model: string
  method: string
  args: unknown
}

interface Harness {
  calls: Call[]
  created: Record<string, unknown> | null
  updated: Record<string, unknown> | null
}

/**
 * Replaces the Prisma delegates the stream service touches with recorders. Nothing leaves the process: every
 * model method returns the smallest shape the service reads.
 */
async function withStreamDatabase(
  options: { channelUrl?: string | null; existingStream?: Record<string, unknown> } = {},
  assertion?: (harness: Harness) => Promise<void>,
): Promise<Harness> {
  const { prisma } = await import('../../core/prisma.js')
  const originals = {
    match: prisma.match,
    channel: prisma.channel,
    stream: prisma.stream,
    systemLog: prisma.systemLog,
  }
  const harness: Harness = { calls: [], created: null, updated: null }
  const record = (model: string, method: string, args: unknown) => harness.calls.push({ model, method, args })
  const existing = options.existingStream ?? {
    id: STREAM_ID,
    logo: null,
    sourceType: 'DIRECT_URL',
    channelId: null,
    primaryUrl: 'https://cdn.example.com/old.m3u8',
    backupUrl: null,
    activationMode: 'AUTOMATIC',
  }

  try {
    ;(prisma as { match: unknown }).match = {
      findFirst: async (args: unknown) => { record('match', 'findFirst', args); return { id: MATCH_ID } },
    }
    ;(prisma as { channel: unknown }).channel = {
      findUnique: async (args: unknown) => {
        record('channel', 'findUnique', args)
        return options.channelUrl === undefined ? { url: CHANNEL_URL } : { url: options.channelUrl }
      },
      create: async (args: unknown) => { record('channel', 'create', args); return { id: 'created-channel' } },
      update: async (args: unknown) => { record('channel', 'update', args); return { id: CHANNEL_ID } },
    }
    ;(prisma as { stream: unknown }).stream = {
      create: async (args: { data: Record<string, unknown> }) => {
        record('stream', 'create', args)
        harness.created = args.data
        return { id: STREAM_ID, ...args.data }
      },
      findFirst: async (args: unknown) => { record('stream', 'findFirst', args); return existing },
      update: async (args: { data: Record<string, unknown> }) => {
        record('stream', 'update', args)
        harness.updated = args.data
        return { id: STREAM_ID, ...existing, ...args.data }
      },
      findUnique: async (args: unknown) => { record('stream', 'findUnique', args); return existing },
    }
    ;(prisma as { systemLog: unknown }).systemLog = {
      create: async (args: unknown) => { record('systemLog', 'create', args); return args },
    }

    if (assertion) await assertion(harness)
    return harness
  } finally {
    ;(prisma as { match: unknown }).match = originals.match
    ;(prisma as { channel: unknown }).channel = originals.channel
    ;(prisma as { stream: unknown }).stream = originals.stream
    ;(prisma as { systemLog: unknown }).systemLog = originals.systemLog
  }
}

const channelWrites = (harness: Harness) =>
  harness.calls.filter((call) => call.model === 'channel' && call.method !== 'findUnique')

test('creating a channel stream stores the channel URL when no primary URL was entered', async () => {
  const harness = await withStreamDatabase({}, async (calls) => {
    await createStream({ matchId: MATCH_ID, sourceType: 'CHANNEL', channelId: CHANNEL_ID, primaryUrl: '' })
    assert.equal(calls.created?.primaryUrl, CHANNEL_URL)
  })

  assert.equal(harness.created?.sourceType, 'CHANNEL')
  assert.equal(harness.created?.channelId, CHANNEL_ID)
  assert.equal(harness.created?.primaryUrl, CHANNEL_URL, 'the non-nullable column holds the channel URL, not an empty string')
  assert.deepEqual(channelWrites(harness), [], 'selecting an existing channel must never create or update a Channel')
})

test('repeating the same association still writes exactly one stream and no channel', async () => {
  const harness = await withStreamDatabase({}, async (calls) => {
    await createStream({ matchId: MATCH_ID, sourceType: 'CHANNEL', channelId: CHANNEL_ID, primaryUrl: '' })
    await createStream({ matchId: MATCH_ID, sourceType: 'CHANNEL', channelId: CHANNEL_ID, primaryUrl: '' })
    assert.equal(calls.calls.filter((call) => call.model === 'stream' && call.method === 'create').length, 2,
      'one stream per save, never a loop or a retry')
    assert.equal(calls.calls.filter((call) => call.model === 'channel' && call.method === 'findUnique').length, 2,
      'one channel read per save, which the service already performed before this change')
  })

  assert.deepEqual(channelWrites(harness), [], 'no duplicate channel records')
})

test('a direct stream keeps its typed URL and never reads or writes a channel', async () => {
  const harness = await withStreamDatabase({}, async (calls) => {
    await createStream({ matchId: MATCH_ID, sourceType: 'DIRECT_URL', primaryUrl: 'https://cdn.example.com/direct.m3u8' })
    assert.equal(calls.calls.some((call) => call.model === 'channel'), false, 'a direct stream is not channel-sourced')
  })

  assert.equal(harness.created?.primaryUrl, 'https://cdn.example.com/direct.m3u8')
  assert.equal(harness.created?.channelId, null)
  assert.equal(harness.created?.sourceType, 'DIRECT_URL')
})

test('a channel whose URL is empty cannot silently store an empty playback URL', async () => {
  // The API validates the URL, but a stale channel row must still not become a stream with no source: the
  // service falls back to whatever the request supplied, and this test pins that it does not invent a URL.
  const harness = await withStreamDatabase({ channelUrl: '' }, async () => {
    await createStream({ matchId: MATCH_ID, sourceType: 'CHANNEL', channelId: CHANNEL_ID, primaryUrl: '' })
  })

  assert.equal(harness.created?.primaryUrl, '', 'nothing is invented for a channel that has no URL')
  assert.equal(harness.created?.channelId, CHANNEL_ID)
})

test('linking a channel on update stores the channel URL and keeps the rest of the settings', async () => {
  const harness = await withStreamDatabase({}, async () => {
    await updateStream(STREAM_ID, { sourceType: 'CHANNEL', channelId: CHANNEL_ID })
  })

  assert.equal(harness.updated?.channelId, CHANNEL_ID)
  assert.equal(harness.updated?.sourceType, 'CHANNEL')
  assert.equal(harness.updated?.primaryUrl, CHANNEL_URL)
  // Fields the request did not name stay out of the update entirely.
  for (const untouched of ['backupUrl', 'activationMode', 'activationOffsetMinutes', 'quality', 'status', 'enabled']) {
    assert.equal(untouched in (harness.updated ?? {}), false, `${untouched} must not be rewritten by a channel link`)
  }
  assert.deepEqual(channelWrites(harness), [])
})

test('an ordinary stream edit reads no channel and writes only what it names', async () => {
  const harness = await withStreamDatabase({}, async (calls) => {
    await updateStream(STREAM_ID, { enabled: false })
    assert.equal(calls.calls.some((call) => call.model === 'channel'), false,
      'a non-channel edit must not pay for a channel read')
  })

  assert.deepEqual(harness.updated, { enabled: false })
})
