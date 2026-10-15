/**
 * The playback URL for a source, resolving whether it goes through the manifest proxy.
 *
 * The proxy is only used for a real **stream** record: `/api/v1/stream/proxy` resolves `streamId`
 * against the stream table, so anything else (a channel or match id, or no id at all) is played
 * directly. Passing a non-stream id produced a request the backend could only answer with 404, and the
 * player then spent its primary/backup attempts on requests that could never succeed.
 */
export function buildHlsPlaybackUrl(options: {
  url: string | null | undefined
  streamId?: string | null
  usedBackup: boolean
  forceDirectUrl: boolean
}): string | null {
  const { url, streamId, usedBackup, forceDirectUrl } = options
  if (!url) return null
  if (!streamId || forceDirectUrl) return url

  const params = new URLSearchParams({
    streamId,
    type: usedBackup ? 'backup' : 'primary',
    url,
  })

  return `/api/v1/stream/proxy?${params.toString()}`
}

export type PlaybackSourceScheme = 'http' | 'https' | 'other'

/**
 * The scheme the browser will actually use to fetch a playback URL.
 *
 * A relative URL (the manifest proxy path) is resolved against the page, so it is reported with the
 * page's scheme. Values that are not http(s) at all — `blob:`, `data:`, a malformed string — are `other`.
 */
export function classifyPlaybackSourceScheme(url: string | null | undefined, pageProtocol: string): PlaybackSourceScheme {
  const trimmedUrl = typeof url === 'string' ? url.trim() : ''
  if (!trimmedUrl) return 'other'

  const base = pageProtocol.trim().toLowerCase() === 'http:' ? 'http://page.invalid' : 'https://page.invalid'

  try {
    const { protocol } = new URL(trimmedUrl, base)
    if (protocol === 'http:') return 'http'
    if (protocol === 'https:') return 'https'
    return 'other'
  } catch {
    return 'other'
  }
}

/**
 * Whether the browser itself will refuse to fetch this source.
 *
 * Mixed content protection blocks an `http:` subresource requested by an `https:` page before the request
 * is sent, so no retry, fallback, or server-side manifest rewrite can make it play — only an HTTPS link
 * from the provider can. The answer therefore depends on the page scheme, which is also why an HTTP
 * development page (where these sources do load) is not reported as insecure.
 *
 * A stream record is judged by its playback URL, not by its stored one: the browser fetches the manifest
 * proxy path instead, and the proxy's own HTTPS-only upstream rule decides what it may relay.
 */
export function isInsecurePlaybackSource(url: string | null | undefined, pageProtocol: string): boolean {
  if (pageProtocol.trim().toLowerCase() !== 'https:') return false
  return classifyPlaybackSourceScheme(url, pageProtocol) === 'http'
}

/**
 * Whether this is an absolute URL using a protocol the app can play: `http:` or `https:` and nothing else.
 *
 * It is stricter than {@link classifyPlaybackSourceScheme} on purpose: a relative reference resolves
 * against the page for playback, but an operator has to configure a real source, so `ftp:`, `file:`,
 * `blob:` and a bare path are all rejected. It mirrors the server-side rule exactly, so a value the form
 * accepts is a value the API accepts — HTTP included, because the site genuinely serves such providers.
 */
export function hasSupportedPlaybackProtocol(url: string | null | undefined): boolean {
  const trimmedUrl = typeof url === 'string' ? url.trim() : ''
  if (!trimmedUrl) return false

  try {
    const { protocol } = new URL(trimmedUrl)
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * The warning to show an admin who is about to save this source URL, or null when there is none.
 *
 * The deployed site is served over HTTPS, so an `http://` source is refused by the browser before the
 * request leaves the page. Deciding that is deliberately independent of the scheme the admin happens to
 * be editing from: a source saved from an HTTP development page still only ever runs on the HTTPS site.
 */
export function insecureSourceAdminWarning(url: string | null | undefined): string | null {
  return classifyPlaybackSourceScheme(url, 'https:') === 'http'
    ? 'HTTP sources are blocked by browsers on this HTTPS site. Use an HTTPS link from the provider.'
    : null
}
