import http, { type ClientRequest, type IncomingMessage } from 'node:http'
import https from 'node:https'
import { prisma } from '../core/prisma.js'
import logger from '../core/logger.js'
import { isRedisConfigured } from '../core/redis.js'
import { getRedisErrorCode } from '../core/redisFailover.js'
import { isMultiInstanceDeployment } from '../config/deployment.js'
import { createManifestSharedCache, type ManifestCacheEntry } from './manifestSharedCache.js'
import { createPinnedLookup, isHostAllowlisted, validateProxyRedirect, validateProxyTargetUrl } from '../utils/ssrfGuard.js'
import { rewriteManifestBody, type ManifestRewriteOptions } from '../utils/streamManifest.js'
import { resolveStreamSourceUrls } from '../utils/streamSourceUrls.js'
import { BadGatewayError, StreamRelayDisabledError } from '../core/errors.js'
import { confirmStreamRelaySwitch, isStreamRelaySwitchEnabled } from '../core/streamRelaySwitch.js'

interface StreamManifestProxyOptions {
  streamId?: string
  channelId?: string
  type: 'primary' | 'backup'
  targetUrl?: string | null
  signal?: AbortSignal
}

interface StreamManifestProxyResult {
  body: string
  contentType: string
  sourceUrl: string
  cacheControl: string
  usedBackup: boolean
}

const manifestCache = new Map<string, ManifestCacheEntry>()
const manifestTtlMs = 5_000
const MAX_MANIFEST_CACHE_ENTRIES = 500
const MAX_MANIFEST_BYTES = 2 * 1024 * 1024
const MAX_REDIRECTS = 3
const MANIFEST_TIMEOUT_MS = 10_000
/**
 * Ceiling for one relayed media resource.
 *
 * Segments are megabytes (a 5 s 1080p segment measured ~2.4 MB), so the manifest limit cannot apply, but
 * the relay still refuses to read an unbounded body into memory: past this size the upstream is destroyed
 * and the viewer's player retries instead.
 */
const MAX_RELAY_BYTES = 12 * 1024 * 1024
const RELAY_TIMEOUT_MS = 15_000
const RELAY_PATH = '/api/v1/stream/relay'
const inFlightManifestRequests = new Map<string, Promise<StreamManifestProxyResult>>()
const isProduction = process.env.NODE_ENV === 'production'

// The shared copy is only useful when another instance can read it, so it is skipped on a
// single-instance deployment where the process-local cache above is already the complete answer.
const sharedManifestCache = createManifestSharedCache({
  enabled: isMultiInstanceDeployment && isRedisConfigured,
  ttlMs: manifestTtlMs,
})

/**
 * A failure of the source itself, never of this service.
 *
 * Every reason here is about the upstream — it refused, it is missing, it answered with an error, or the
 * production HTTPS-only policy would not let us relay it — so it is reported as a bad gateway. The reason
 * stays in `details`, which production omits, keeping the upstream URL out of client-facing messages.
 */
function sourceUnavailable(reason: string): BadGatewayError {
  return new BadGatewayError('The stream source is unavailable.', { reason })
}

/** The record a relayed resource belongs to, and the allowlist that authorizes serving it. */
interface RelayContext {
  streamId?: string
  channelId?: string
  type: 'primary' | 'backup'
  allowedDomains: string[]
  /** Read once per manifest: when the relay is off a playlist is never pointed at it. */
  enabled: boolean
}

/**
 * The relay mapping applied to a playlist's URIs.
 *
 * Only an `http://` resource on an explicitly allowlisted host is rewritten: the browser refuses those from
 * our HTTPS page, so serving them through our own origin is the only way they can play at all. Everything
 * else keeps the provider's URL and is fetched directly by the browser, which is what keeps HTTPS sources
 * — and therefore almost all traffic — off this server.
 */
function buildRelayHref(context: RelayContext): NonNullable<ManifestRewriteOptions['relayHref']> {
  return (resourceUrl) => {
    // Switched off: the resource keeps its provider URL, so nothing asks a disabled relay to serve it and
    // an HTTP child simply fails the way the browser already refuses it. Flipped back on, the next manifest
    // is rewritten again.
    if (!context.enabled) return null

    try {
      const resource = new URL(resourceUrl)
      if (resource.protocol !== 'http:') return null
      if (!isHostAllowlisted(resource.hostname, context.allowedDomains)) return null

      const params = new URLSearchParams({
        ...(context.streamId ? { streamId: context.streamId } : { channelId: context.channelId ?? '' }),
        type: context.type,
        url: resource.toString(),
      })
      return `${RELAY_PATH}?${params.toString()}`
    } catch {
      return null
    }
  }
}

function pruneManifestCache(now: number): void {
  for (const [key, entry] of manifestCache) {
    if (entry.expiresAt <= now) manifestCache.delete(key)
  }

  while (manifestCache.size > MAX_MANIFEST_CACHE_ENTRIES) {
    const oldestKey = manifestCache.keys().next().value
    if (!oldestKey) break
    manifestCache.delete(oldestKey)
  }
}

async function readManifestBody(response: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  let totalBytes = 0

  for await (const chunk of response) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    totalBytes += buffer.byteLength
    if (totalBytes > MAX_MANIFEST_BYTES) {
      response.destroy()
      throw sourceUnavailable('Manifest response is too large')
    }
    chunks.push(buffer)
  }

  return Buffer.concat(chunks).toString('utf8')
}

/**
 * Opens one upstream resource, following at most {@link MAX_REDIRECTS} validated redirects.
 *
 * A non-HTTPS target is refused in production **unless its host is explicitly allowlisted**, which is the
 * single authorization that lets an `http://` provider be served: the allowlist is admin-managed (the
 * `AllowedDomain` table) or deployment-managed (`PROXY_ALLOWLIST`), and both are required for any upstream
 * in production anyway. Everything else — private addresses, DNS rebinding, redirects, credentials in the
 * URL — is still refused by the guard below.
 */
async function openResource(
  startUrl: string,
  signal: AbortSignal | undefined,
  validationOptions: { trustedUrls: string[]; allowedDomains: string[]; requireAllowlist: boolean },
  timeoutMs: number,
): Promise<{ response: IncomingMessage; sourceUrl: string }> {
  let currentUrl = startUrl

  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
    const validated = await validateProxyTargetUrl(currentUrl, validationOptions)
    const response = await requestTarget(validated, signal, timeoutMs, validationOptions.allowedDomains)
    const responseStatus = response.statusCode ?? 0

    if (responseStatus >= 300 && responseStatus < 400) {
      const location = response.headers.location
      response.resume()
      if (!location || redirect === MAX_REDIRECTS) throw sourceUnavailable('Too many manifest redirects')
      // The redirect target is validated against the same allowlist as the first hop, and the protocol rule
      // is enforced once in `requestTarget` (HTTPS unless the host is explicitly allowlisted) so a redirect
      // cannot be used to reach an unlisted or non-HTTPS host.
      const redirectTarget = await validateProxyRedirect(
        Array.isArray(location) ? location[0] : location,
        validated.url,
        validationOptions,
      )
      currentUrl = redirectTarget.url.toString()
      continue
    }

    if (responseStatus < 200 || responseStatus >= 300) {
      response.resume()
      throw sourceUnavailable(`Upstream responded with ${responseStatus}`)
    }

    return { response, sourceUrl: validated.url.toString() }
  }

  throw sourceUnavailable('Manifest resolution failed')
}

async function requestTarget(
  target: Awaited<ReturnType<typeof validateProxyTargetUrl>>,
  signal: AbortSignal | undefined,
  timeoutMs: number,
  allowedDomains: string[],
): Promise<IncomingMessage> {
  // A non-HTTPS target is relay work, so it is refused before any socket is opened when the administrator
  // has switched the relay off. HTTPS targets are ordinary provider-direct proxying and are unaffected.
  if (target.url.protocol !== 'https:' && !(await isStreamRelaySwitchEnabled())) {
    throw new StreamRelayDisabledError()
  }

  if (isProduction && target.url.protocol !== 'https:' && !isHostAllowlisted(target.url.hostname, allowedDomains)) {
    throw sourceUnavailable('Only HTTPS stream targets are allowed in production')
  }

  const lookup = createPinnedLookup(target)
  const requestSignal = signal
    ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])
    : AbortSignal.timeout(timeoutMs)

  return new Promise((resolve, reject) => {
    let agent: http.Agent | https.Agent
    let request: ClientRequest
    const options = {
      method: 'GET',
      headers: {
        Accept: 'application/vnd.apple.mpegurl,text/plain,application/x-mpegURL,*/*',
        'User-Agent': 'SportZoneHlsProxy/1.0',
      },
      signal: requestSignal,
    }

    if (target.url.protocol === 'https:') {
      agent = new https.Agent({ lookup })
      request = https.request(target.url, { ...options, agent }, (response) => {
        response.once('close', () => agent.destroy())
        resolve(response)
      })
    } else {
      agent = new http.Agent({ lookup })
      request = http.request(target.url, { ...options, agent }, (response) => {
        response.once('close', () => agent.destroy())
        resolve(response)
      })
    }

    request.once('error', (error) => {
      agent.destroy()
      reject(error)
    })
    request.end()
  })
}

async function fetchManifest(
  targetUrl: string,
  signal: AbortSignal | undefined,
  validationOptions: { trustedUrls: string[]; allowedDomains: string[]; requireAllowlist: boolean },
  relay?: RelayContext,
): Promise<{ body: string; contentType: string; sourceUrl: string }> {
  const { response, sourceUrl } = await openResource(targetUrl, signal, validationOptions, MANIFEST_TIMEOUT_MS)

  return {
    body: rewriteManifestBody(await readManifestBody(response), sourceUrl, relay ? { relayHref: buildRelayHref(relay) } : {}),
    contentType: String(response.headers['content-type'] ?? 'application/vnd.apple.mpegurl'),
    sourceUrl,
  }
}

export async function getStreamManifestProxy({ streamId, channelId, type, targetUrl, signal }: StreamManifestProxyOptions): Promise<StreamManifestProxyResult> {
  const stream = streamId
    ? await prisma.stream.findUnique({
        where: {
          id: streamId,
          deletedAt: null,
        },
        // The linked channel is read so a channel-sourced stream plays the channel's current URL instead of
        // the copy stored when the link was created.
        include: { channel: { select: { url: true } } },
      })
    : null
  const channel = channelId
    ? await prisma.channel.findFirst({
        where: { id: channelId, status: 'ACTIVE' },
        select: { id: true, url: true },
      })
    : null

  const explicitTargetUrl = typeof targetUrl === 'string' ? targetUrl.trim() : ''

  if (!stream && !channel && !explicitTargetUrl) {
    throw sourceUnavailable('Stream is unavailable')
  }

  const streamSources = resolveStreamSourceUrls(stream)
  const fallbackUrl = streamSources.backupUrl
  const primaryUrl = streamSources.primaryUrl || channel?.url?.trim() || explicitTargetUrl || ''
  const preferredUrls = [...new Set([...streamSources.trustedUrls, primaryUrl, fallbackUrl].filter((value): value is string => Boolean(value)))]

  if (!stream && explicitTargetUrl) {
    const cacheKey = `${streamId ?? 'direct'}:${type}:${primaryUrl}`
    const now = Date.now()
    pruneManifestCache(now)
    const cachedEntry = manifestCache.get(cacheKey)
    if (cachedEntry && cachedEntry.expiresAt > now) {
      return {
        body: cachedEntry.body,
        contentType: cachedEntry.contentType,
        sourceUrl: cachedEntry.sourceUrl,
        cacheControl: 'public, max-age=3, stale-while-revalidate=1',
        usedBackup: cachedEntry.usedBackup,
      }
    }

    const directAllowlist = String(process.env.PROXY_ALLOWLIST ?? '').split(',').map((host) => host.trim()).filter(Boolean)
    const validated = await validateProxyTargetUrl(primaryUrl, {
      trustedUrls: [primaryUrl],
      allowedDomains: directAllowlist,
      requireAllowlist: isProduction,
    })

    const validationOptions = { trustedUrls: [primaryUrl], allowedDomains: directAllowlist, requireAllowlist: isProduction }
    const manifest = await fetchManifest(validated.url.toString(), signal, validationOptions)
    const rewrittenManifest = rewriteManifestBody(manifest.body, manifest.sourceUrl)

    manifestCache.set(cacheKey, {
      body: rewrittenManifest,
      contentType: manifest.contentType,
      sourceUrl: manifest.sourceUrl,
      usedBackup: false,
      expiresAt: now + manifestTtlMs,
    })

    return {
      body: rewrittenManifest,
      contentType: manifest.contentType,
      sourceUrl: manifest.sourceUrl,
      cacheControl: 'public, max-age=3, stale-while-revalidate=1',
      usedBackup: false,
    }
  }

  if (stream && !stream.enabled) {
    throw sourceUnavailable('Stream is unavailable')
  }

  const allowedDomains = await (prisma as any).allowedDomain.findMany({
    where: {
      isEnabled: true,
    },
    select: {
      host: true,
    },
  })

  const allowedDomainHosts = allowedDomains.map((domain: { host: string }) => domain.host)
  const selectedUrl = type === 'backup' ? fallbackUrl : primaryUrl

  if (!selectedUrl) {
    throw sourceUnavailable('No stream URL is configured for the requested fallback type')
  }

  const cacheKey = `${stream?.id ?? `channel:${channel?.id}`}:${type}:${selectedUrl}`
  const now = Date.now()
  pruneManifestCache(now)
  const cachedEntry = manifestCache.get(cacheKey)
  if (cachedEntry && cachedEntry.expiresAt > now) {
    return {
      body: cachedEntry.body,
      contentType: cachedEntry.contentType,
      sourceUrl: cachedEntry.sourceUrl,
      cacheControl: 'public, max-age=3, stale-while-revalidate=1',
      usedBackup: cachedEntry.usedBackup,
    }
  }

  try {
    const redisEntry = await sharedManifestCache.read(cacheKey)
    if (redisEntry) {
      if (redisEntry.expiresAt > now && typeof redisEntry.body === 'string') {
        manifestCache.set(cacheKey, redisEntry)
        return {
          ...redisEntry,
          cacheControl: 'public, max-age=3, stale-while-revalidate=1',
        }
      }
    }
  } catch (error) {
    logger.warn({ code: getRedisErrorCode(error) }, 'Redis manifest cache unavailable; resolving from source')
  }

  const existingRequest = inFlightManifestRequests.get(cacheKey)
  if (existingRequest) return existingRequest

  const requireAllowlist = isProduction || allowedDomainHosts.length > 0

  const request = (async (): Promise<StreamManifestProxyResult> => {
    // An HTTP resource on an allowlisted host is served through the relay, so the manifest this returns
    // already points the browser at our own HTTPS origin for exactly those resources.
    const relay: RelayContext = {
      ...(streamId ? { streamId } : {}),
      ...(channelId ? { channelId } : {}),
      type,
      allowedDomains: allowedDomainHosts,
      enabled: await isStreamRelaySwitchEnabled(),
    }
    const tryFetch = async (targetUrl: string): Promise<{ body: string; contentType: string; sourceUrl: string }> => {
      const validated = await validateProxyTargetUrl(targetUrl, {
        trustedUrls: preferredUrls,
        allowedDomains: allowedDomainHosts,
        requireAllowlist,
      })

      return fetchManifest(validated.url.toString(), signal, {
        trustedUrls: preferredUrls,
        allowedDomains: allowedDomainHosts,
        requireAllowlist,
      }, relay)
    }

    try {
      const manifest = await tryFetch(selectedUrl)
      const relayedBody = manifest.body

      const entry: ManifestCacheEntry = {
        body: relayedBody,
        contentType: manifest.contentType,
        sourceUrl: manifest.sourceUrl,
        usedBackup: type === 'backup',
        expiresAt: Date.now() + manifestTtlMs,
      }
      manifestCache.set(cacheKey, entry)
      await sharedManifestCache.write(cacheKey, entry).catch((error: unknown) => {
        logger.warn({ code: getRedisErrorCode(error) }, 'Unable to write resolved manifest cache')
      })

      return { ...entry, cacheControl: 'public, max-age=3, stale-while-revalidate=1' }
    } catch (error) {
      if (type === 'primary' && fallbackUrl) {
        const backupManifest = await tryFetch(fallbackUrl)

        const backupEntry: ManifestCacheEntry = {
          body: backupManifest.body,
          contentType: backupManifest.contentType,
          sourceUrl: backupManifest.sourceUrl,
          usedBackup: true,
          expiresAt: Date.now() + manifestTtlMs,
        }
        manifestCache.set(cacheKey, backupEntry)
        await sharedManifestCache.write(cacheKey, backupEntry).catch((cacheError: unknown) => {
          logger.warn({ code: getRedisErrorCode(cacheError) }, 'Unable to cache recovered backup manifest')
        })

        return { ...backupEntry, cacheControl: 'public, max-age=3, stale-while-revalidate=1' }
      }

      // A relay the administrator switched off is not a provider failure, so it keeps its own 503 and code
      // instead of being reported as a bad gateway — the player and the admin console then read one answer.
      if (error instanceof StreamRelayDisabledError) throw error

      throw sourceUnavailable(error instanceof Error ? error.message : 'Failed to fetch HLS manifest')
    }
  })()

  inFlightManifestRequests.set(cacheKey, request)
  try {
    return await request
  } finally {
    inFlightManifestRequests.delete(cacheKey)
  }
}

export interface StreamRelayOptions {
  streamId?: string
  channelId?: string
  type: 'primary' | 'backup'
  /** The absolute upstream resource URL, taken from a playlist this service produced. */
  resourceUrl: string
  signal?: AbortSignal
}

export interface StreamRelayResult {
  contentType: string
  /** A rewritten playlist body, or null when the resource is media and arrives as a stream. */
  body: string | null
  upstream: IncomingMessage | null
  /** Byte ceiling the caller enforces while piping `upstream`, so a huge body cannot be buffered. */
  maxBytes: number
}

/**
 * Serves one media resource of an authorized `http://` stream over this site's HTTPS origin.
 *
 * It exists because a browser refuses `http://` media from an HTTPS page — the manifest proxy can rewrite
 * playlists, but the media itself would still be blocked. Three things keep it from becoming an open proxy:
 * the caller must name a real stream/channel record (authorization and premium checks happen in the
 * controller), the resource host must be explicitly allowlisted, and the URL is still put through the same
 * guard as every other upstream — private addresses, DNS rebinding, credentials and unsafe redirects are
 * refused. Only resources this service itself named in a playlist are ever requested, and HTTPS traffic
 * keeps going directly to the provider.
 */
export async function getStreamRelayResource({ streamId, channelId, type, resourceUrl, signal }: StreamRelayOptions): Promise<StreamRelayResult> {
  // Re-read the administrator's setting before anything else: a relay request that arrives while the relay
  // is off must not resolve records, resolve the allowlist or open an upstream socket.
  if (!(await confirmStreamRelaySwitch())) {
    throw new StreamRelayDisabledError()
  }

  const stream = streamId
    ? await prisma.stream.findUnique({
        where: { id: streamId, deletedAt: null },
        include: { channel: { select: { url: true } } },
      })
    : null
  const channel = channelId
    ? await prisma.channel.findFirst({ where: { id: channelId, status: 'ACTIVE' }, select: { id: true, url: true } })
    : null

  if (!stream && !channel) throw sourceUnavailable('Stream is unavailable')
  if (stream && !stream.enabled) throw sourceUnavailable('Stream is unavailable')

  const sources = resolveStreamSourceUrls(stream)
  const selectedUrl = type === 'backup' ? sources.backupUrl : sources.primaryUrl || channel?.url?.trim() || ''
  if (!selectedUrl) throw sourceUnavailable('No stream URL is configured for the requested fallback type')

  const allowedDomains = await (prisma as any).allowedDomain.findMany({ where: { isEnabled: true }, select: { host: true } })
  const allowedDomainHosts = allowedDomains.map((domain: { host: string }) => domain.host)

  let resourceHost: string
  try {
    resourceHost = new URL(resourceUrl).hostname
  } catch {
    throw sourceUnavailable('Resource URL is invalid')
  }
  if (!isHostAllowlisted(resourceHost, allowedDomainHosts)) {
    throw sourceUnavailable('Host is not allowlisted')
  }

  // The allowlist is the authorization here, not the record's own URL list: a playlist legitimately
  // references sibling and CDN resources, and `validateProxyTargetUrl` refuses any target outside the
  // allowlist anyway. The private-address, DNS-rebinding and credential checks still apply to every one.
  const validationOptions = {
    trustedUrls: [] as string[],
    allowedDomains: allowedDomainHosts,
    requireAllowlist: true,
  }
  const { response, sourceUrl } = await openResource(resourceUrl, signal, validationOptions, RELAY_TIMEOUT_MS)
  const contentType = String(response.headers['content-type'] ?? 'application/octet-stream')

  // A nested playlist reaches here too (a media playlist of an HTTP provider), so it is rewritten exactly
  // like the master: its own child URIs are HTTP and would otherwise stay blocked.
  if (/mpegurl|x-mpegurl/i.test(contentType) || new URL(sourceUrl).pathname.endsWith('.m3u8')) {
    const relay: RelayContext = {
      ...(streamId ? { streamId } : {}),
      ...(channelId ? { channelId } : {}),
      type,
      allowedDomains: allowedDomainHosts,
      enabled: true,
    }

    return {
      contentType,
      body: rewriteManifestBody(await readManifestBody(response), sourceUrl, { relayHref: buildRelayHref(relay) }),
      upstream: null,
      maxBytes: MAX_MANIFEST_BYTES,
    }
  }

  return { contentType, body: null, upstream: response, maxBytes: MAX_RELAY_BYTES }
}

export type { StreamManifestProxyOptions, StreamManifestProxyResult }
