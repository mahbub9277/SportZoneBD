import assert from 'node:assert/strict'
import test from 'node:test'
import {
  STREAM_CHANNEL_NOT_FOUND,
  STREAM_CHANNEL_REQUIRED,
  STREAM_CHANNEL_URL_MISSING,
  STREAM_PRIMARY_URL_INVALID,
  STREAM_PRIMARY_URL_PROTOCOL,
  STREAM_PRIMARY_URL_REQUIRED,
  isPlayableStreamUrl,
  resolveChannelPlaybackUrl,
  resolveStreamAssociation,
  streamFormSchema,
} from './streamFormValidation.ts'

/**
 * The stream form's save rules.
 *
 * The regression these cover: selecting an existing channel used to fail the save with "Primary URL is
 * required", because the primary URL was validated unconditionally. A channel-sourced stream plays from the
 * channel, so the channel selection is what has to be valid — and the primary URL the record stores is that
 * channel's own URL, never a proxy path and never an empty string in a non-nullable column.
 */

const CHANNEL_ID = '11111111-2222-4333-8444-555555555555'
const MATCH_ID = '99999999-8888-4777-8666-555555555555'

const channel = (overrides: Partial<{ id: string; name: string; url: string | null }> = {}) => ({
  id: CHANNEL_ID,
  name: 'Bangla Vision',
  url: 'https://cdn.example.com/banglavision/index.m3u8',
  status: 'ACTIVE',
  ...overrides,
})

const form = (overrides: Record<string, unknown> = {}) => ({
  name: 'Main stream',
  logo: '',
  primaryUrl: '',
  backupUrl: '',
  matchId: MATCH_ID,
  enabled: true,
  quality: '1080p',
  status: 'READY',
  sourceType: 'CHANNEL',
  channelId: CHANNEL_ID,
  ...overrides,
})

/** The zod issues for a form state, as `{ path: message }` pairs. */
function issuesFor(values: Record<string, unknown>) {
  const result = streamFormSchema.safeParse(values)
  if (result.success) return {}
  return Object.fromEntries(result.error.issues.map((issue) => [issue.path.join('.'), issue.message]))
}

test('an existing channel with no manually entered primary URL is accepted', () => {
  const issues = issuesFor(form({ primaryUrl: '' }))

  assert.deepEqual(issues, {}, `a channel stream must not require a primary URL (got ${JSON.stringify(issues)})`)
})

test('the same form without a selected channel is rejected on the channel field', () => {
  const issues = issuesFor(form({ channelId: '', primaryUrl: '' }))

  assert.equal(issues.channelId, STREAM_CHANNEL_REQUIRED)
  assert.equal(issues.primaryUrl, undefined, 'the primary URL is not what is missing here')
})

test('a malformed channel id is rejected', () => {
  const issues = issuesFor(form({ channelId: 'not-a-uuid' }))

  assert.match(String(issues.channelId), /Invalid channel ID/)
})

test('a direct stream still requires a valid primary URL', () => {
  const issues = issuesFor(form({ sourceType: 'DIRECT_URL', channelId: '', primaryUrl: '' }))

  assert.equal(issues.primaryUrl, STREAM_PRIMARY_URL_REQUIRED)
})

test('a direct stream still rejects a useless or non-http primary URL', () => {
  assert.equal(issuesFor(form({ sourceType: 'DIRECT_URL', channelId: '', primaryUrl: 'not a url' })).primaryUrl, STREAM_PRIMARY_URL_INVALID)
  assert.equal(issuesFor(form({ sourceType: 'DIRECT_URL', channelId: '', primaryUrl: 'ftp://cdn.example.com/live.m3u8' })).primaryUrl, STREAM_PRIMARY_URL_PROTOCOL)
  assert.deepEqual(issuesFor(form({ sourceType: 'DIRECT_URL', channelId: '', primaryUrl: 'https://cdn.example.com/live.m3u8' })), {})
})

test('a channel stream that still types a URL must type a usable one', () => {
  assert.equal(issuesFor(form({ primaryUrl: 'ftp://cdn.example.com/live.m3u8' })).primaryUrl, STREAM_PRIMARY_URL_PROTOCOL)
  assert.deepEqual(issuesFor(form({ primaryUrl: 'https://cdn.example.com/override.m3u8' })), {})
})

test('the payload for a channel stream uses the channel’s own playback URL', () => {
  const result = resolveStreamAssociation(form({ primaryUrl: '' }) as never, [channel()])

  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.equal(result.values.sourceType, 'CHANNEL')
  assert.equal(result.values.channelId, CHANNEL_ID)
  assert.equal(result.values.primaryUrl, 'https://cdn.example.com/banglavision/index.m3u8')
  // The stored URL is the provider URL the player already uses — never the backend relay/proxy path.
  assert.doesNotMatch(result.values.primaryUrl, /^\/api\/v1\/stream\//)
  assert.doesNotMatch(result.values.primaryUrl, /\/stream\/(proxy|relay)/)
})

test('a channel without a playback URL produces a clear error instead of saving', () => {
  for (const url of ['', '   ', null, 'not-a-url', 'ftp://cdn.example.com/live.m3u8']) {
    const result = resolveStreamAssociation(form() as never, [channel({ url: url as string | null })])

    assert.equal(result.ok, false, `a channel URL of ${JSON.stringify(url)} must not be accepted`)
    if (result.ok) continue
    assert.equal(result.field, 'channelId')
    assert.equal(result.message, STREAM_CHANNEL_URL_MISSING)
  }
})

test('a stale channel selection is reported rather than saved', () => {
  const result = resolveStreamAssociation(form() as never, [])

  assert.equal(result.ok, false)
  if (result.ok) return
  assert.equal(result.field, 'channelId')
  assert.equal(result.message, STREAM_CHANNEL_NOT_FOUND)
})

test('editing a channel stream keeps the channel association and every other setting', () => {
  const result = resolveStreamAssociation(
    form({ primaryUrl: '', backupUrl: 'https://cdn.example.com/backup.m3u8', enabled: false, quality: '720p', status: 'OFFLINE' }) as never,
    [channel()],
  )

  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.equal(result.values.channelId, CHANNEL_ID)
  assert.equal(result.values.backupUrl, 'https://cdn.example.com/backup.m3u8')
  assert.equal(result.values.enabled, false)
  assert.equal(result.values.quality, '720p')
  assert.equal(result.values.status, 'OFFLINE')
  assert.equal(result.values.matchId, MATCH_ID)
})

test('a direct stream keeps its typed URL and drops no channel link from the payload', () => {
  const result = resolveStreamAssociation(
    form({ sourceType: 'DIRECT_URL', primaryUrl: 'https://cdn.example.com/direct.m3u8' }) as never,
    [channel()],
  )

  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.equal(result.values.primaryUrl, 'https://cdn.example.com/direct.m3u8')
  assert.equal(result.values.channelId, undefined, 'a direct stream is not linked to a channel')
})

test('resolving the same form twice produces the same payload and writes nothing', () => {
  // A pure resolver: no network, no cache write, no counter — so a re-render or a second submit cannot
  // produce extra Channel or Stream writes on its own.
  const first = resolveStreamAssociation(form() as never, [channel()])
  const second = resolveStreamAssociation(form() as never, [channel()])

  assert.deepEqual(first, second)
})

test('only http(s) URLs with a host are playable channel URLs', () => {
  assert.equal(isPlayableStreamUrl('https://cdn.example.com/live.m3u8'), true)
  assert.equal(isPlayableStreamUrl('  http://stream.example.com/234/index.m3u8  '), true)
  assert.equal(isPlayableStreamUrl(''), false)
  assert.equal(isPlayableStreamUrl(null), false)
  assert.equal(isPlayableStreamUrl('/api/v1/stream/proxy?channelId=x'), false)
  assert.equal(isPlayableStreamUrl('ftp://cdn.example.com/live.m3u8'), false)
  assert.equal(resolveChannelPlaybackUrl(channel()), 'https://cdn.example.com/banglavision/index.m3u8')
  assert.equal(resolveChannelPlaybackUrl(null), null)
})
