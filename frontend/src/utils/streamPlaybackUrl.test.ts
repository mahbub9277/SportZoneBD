import test from 'node:test'
import assert from 'node:assert/strict'
import { buildHlsPlaybackUrl, classifyPlaybackSourceScheme, hasSupportedPlaybackProtocol, insecureSourceAdminWarning, isInsecurePlaybackSource } from './streamPlaybackUrl.ts'
import { getStreamCandidateChain } from '../features/matches/matches.types.ts'

const CHANNEL_URL = 'https://cdn.example.com/banglavision/index.m3u8'

test('a source without a stream id is played directly', () => {
  // Channel playback (normal channel page and TV Mode) has no stream record, so no proxy is built.
  assert.equal(buildHlsPlaybackUrl({ url: CHANNEL_URL, usedBackup: false, forceDirectUrl: false }), CHANNEL_URL)
  assert.equal(buildHlsPlaybackUrl({ url: CHANNEL_URL, streamId: null, usedBackup: false, forceDirectUrl: false }), CHANNEL_URL)
})

test('a stream record is proxied with its stream id and primary/backup type', () => {
  const primary = buildHlsPlaybackUrl({ url: CHANNEL_URL, streamId: 'stream-1', usedBackup: false, forceDirectUrl: false })
  assert.equal(primary, `/api/v1/stream/proxy?streamId=stream-1&type=primary&url=${encodeURIComponent(CHANNEL_URL)}`)

  const backup = buildHlsPlaybackUrl({ url: CHANNEL_URL, streamId: 'stream-1', usedBackup: true, forceDirectUrl: false })
  assert.equal(backup, `/api/v1/stream/proxy?streamId=stream-1&type=backup&url=${encodeURIComponent(CHANNEL_URL)}`)
})

test('the direct-url fallback drops the proxy even for a stream record', () => {
  assert.equal(
    buildHlsPlaybackUrl({ url: CHANNEL_URL, streamId: 'stream-1', usedBackup: true, forceDirectUrl: true }),
    CHANNEL_URL,
  )
})

test('no url means no playback url at all', () => {
  assert.equal(buildHlsPlaybackUrl({ url: null, streamId: 'stream-1', usedBackup: false, forceDirectUrl: false }), null)
  assert.equal(buildHlsPlaybackUrl({ url: undefined, usedBackup: false, forceDirectUrl: false }), null)
})

test('the proxy url never carries a parameter other than streamId, type and url', () => {
  const proxied = buildHlsPlaybackUrl({ url: CHANNEL_URL, streamId: 'stream-1', usedBackup: false, forceDirectUrl: false })
  const params = new URLSearchParams(proxied!.split('?')[1])
  assert.deepEqual([...params.keys()].sort(), ['streamId', 'type', 'url'])
})

test('a playback source is classified by the scheme the browser will use to fetch it', () => {
  assert.equal(classifyPlaybackSourceScheme('https://cdn.example.com/live.m3u8', 'https:'), 'https')
  assert.equal(classifyPlaybackSourceScheme('http://cdn.example.com/live.m3u8', 'https:'), 'http')
  assert.equal(classifyPlaybackSourceScheme('HTTP://CDN.example.com/live.m3u8', 'https:'), 'http')
  assert.equal(classifyPlaybackSourceScheme('  https://cdn.example.com/live.m3u8  ', 'https:'), 'https')

  // A relative URL — the proxy path — inherits the page's scheme.
  assert.equal(classifyPlaybackSourceScheme('/api/v1/stream/proxy?streamId=s&type=primary', 'https:'), 'https')
  assert.equal(classifyPlaybackSourceScheme('/api/v1/stream/proxy?streamId=s&type=primary', 'http:'), 'http')
  assert.equal(classifyPlaybackSourceScheme('//cdn.example.com/live.m3u8', 'https:'), 'https')
  // Any relative reference is fetched from the page origin, so it inherits the page's scheme too.
  assert.equal(classifyPlaybackSourceScheme('live/master.m3u8', 'https:'), 'https')

  for (const unsupported of [null, undefined, '', '   ', 'blob:https://site/x', 'data:application/vnd.apple.mpegurl;base64,AA', 'ftp://cdn.example.com/live.m3u8']) {
    assert.equal(classifyPlaybackSourceScheme(unsupported, 'https:'), 'other', `classification for ${String(unsupported)}`)
  }
})

test('only an insecure source on a secure page is reported as blocked', () => {
  assert.equal(isInsecurePlaybackSource('http://cdn.example.com/live.m3u8', 'https:'), true)
  assert.equal(isInsecurePlaybackSource('http://cdn.example.com:8080/live.m3u8?token=abc', 'https:'), true)

  // The same source plays fine on an HTTP development page, and HTTPS is never insecure.
  assert.equal(isInsecurePlaybackSource('http://cdn.example.com/live.m3u8', 'http:'), false)
  assert.equal(isInsecurePlaybackSource('https://cdn.example.com/live.m3u8', 'https:'), false)
  assert.equal(isInsecurePlaybackSource('/api/v1/stream/proxy?streamId=s&type=primary', 'https:'), false)
  assert.equal(isInsecurePlaybackSource('', 'https:'), false)
  assert.equal(isInsecurePlaybackSource(null, 'https:'), false)
})

test('only http and https are accepted as a playback protocol', () => {
  assert.equal(hasSupportedPlaybackProtocol('http://stream.example.com/234/index.m3u8'), true)
  assert.equal(hasSupportedPlaybackProtocol('https://cdn.example.com/live.m3u8'), true)

  for (const value of ['ftp://stream.example.com/a.m3u8', 'file:///etc/passwd', 'data:x', 'blob:https://site/x', 'not a url', 'live/master.m3u8', '//cdn.example.com/a.m3u8', '', '   ', null, undefined]) {
    assert.equal(hasSupportedPlaybackProtocol(value), false, String(value))
  }
})

test('an admin is warned about an HTTP source and only about an HTTP source', () => {
  // The warning never depends on the page the admin edits from: the site is HTTPS in production.
  assert.match(insecureSourceAdminWarning('http://stream.example.com/234/index.m3u8') ?? '', /HTTPS/i)
  assert.match(insecureSourceAdminWarning('  http://stream.example.com/234/index.m3u8  ') ?? '', /HTTPS/i)

  for (const supported of ['https://stream.example.com/234/index.m3u8', '/api/v1/stream/proxy?streamId=s&type=primary', '', null, undefined, 'not a url', 'ftp://stream.example.com/x.m3u8']) {
    assert.equal(insecureSourceAdminWarning(supported), null, `warning for ${String(supported)}`)
  }
})

test('an insecure provider link is never rewritten to another scheme', () => {
  // Upgrading `http://` to `https://` in the player would only replace a transport the provider never
  // offered, so the stored URL must be delivered unchanged and the browser's own verdict reported.
  const httpSource = 'http://cdn.example.com/live/index.m3u8'
  assert.equal(buildHlsPlaybackUrl({ url: httpSource, usedBackup: false, forceDirectUrl: false }), httpSource)
  assert.equal(buildHlsPlaybackUrl({ url: httpSource, streamId: null, usedBackup: true, forceDirectUrl: false }), httpSource)

  // A stream record still goes through the proxy, whose own rules decide whether the upstream is
  // reachable — the client never decides that on the proxy's behalf.
  const proxied = buildHlsPlaybackUrl({ url: httpSource, streamId: 'stream-1', usedBackup: false, forceDirectUrl: false })
  assert.ok(proxied?.startsWith('/api/v1/stream/proxy?'))
  assert.equal(new URLSearchParams(proxied!.split('?')[1]).get('url'), httpSource)
})

test('the selected source type is what the proxy is asked for', () => {
  // End-to-end guard for the selection path: the chain's candidate decides the `type` parameter, so a
  // backup the viewer picked is served from the stream's backup URL and not from its primary.
  const chain = getStreamCandidateChain([
    { id: 'stream-1', primaryUrl: 'https://cdn.example.com/live.m3u8', backupUrl: 'https://cdn.example.com/live-backup.m3u8' },
  ])

  const paramsFor = (candidate: (typeof chain)[number]) => {
    const playbackUrl = buildHlsPlaybackUrl({
      url: candidate.url,
      streamId: candidate.streamId,
      usedBackup: candidate.sourceType === 'backup',
      forceDirectUrl: false,
    })
    assert.ok(playbackUrl, 'a stream candidate always resolves to a playback URL')
    return new URLSearchParams(playbackUrl.split('?')[1])
  }

  assert.equal(paramsFor(chain[0]).get('type'), 'primary')
  assert.equal(paramsFor(chain[1]).get('type'), 'backup')
  assert.equal(paramsFor(chain[1]).get('url'), 'https://cdn.example.com/live-backup.m3u8')
})

test('a stream record keeps using the proxy even when its primary is insecure', () => {
  // The HTTPS-backup fallback of a stream record must not be cut short by the mixed-content guard, which
  // only ever applies to sources the browser would fetch itself.
  const playbackUrl = buildHlsPlaybackUrl({
    url: 'http://stream.example.com/234/index.m3u8',
    streamId: 'stream-1',
    usedBackup: false,
    forceDirectUrl: false,
  })

  assert.ok(playbackUrl?.startsWith('/api/v1/stream/proxy?'))
  // The browser fetches the same-origin proxy path, so it is never reported as an insecure source.
  assert.equal(isInsecurePlaybackSource(playbackUrl, 'https:'), false)
})

test('a request whose url is a channel manifest still carries only the stream id', () => {
  // Regression guard for the TV Mode bug: a channel UUID sent as `streamId` produced a 404 for every
  // channel tune (primary and backup), so the identity has to be a stream record — never a channel id.
  const proxied = buildHlsPlaybackUrl({
    url: 'https://cdn.example.com/banglavision/index.m3u8',
    streamId: '11111111-2222-4333-8444-555555555555',
    usedBackup: false,
    forceDirectUrl: false,
  })
  assert.ok(proxied?.startsWith('/api/v1/stream/proxy?'))
  assert.equal(new URLSearchParams(proxied!.split('?')[1]).get('streamId'), '11111111-2222-4333-8444-555555555555')
  assert.equal(new URLSearchParams(proxied!.split('?')[1]).get('channelId'), null)
})
