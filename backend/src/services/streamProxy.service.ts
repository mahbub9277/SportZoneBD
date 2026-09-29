import http, { type ClientRequest, type IncomingMessage } from 'node:http'
import https from 'node:https'
import { prisma } from '../core/prisma.js'
import logger from '../core/logger.js'
import { cacheRedis } from '../core/redis.js'
import { getRedisErrorCode } from '../core/redisFailover.js'
import { createPinnedLookup, validateProxyRedirect, validateProxyTargetUrl } from '../utils/ssrfGuard.js'
import { rewriteManifestBody } from '../utils/streamManifest.js'

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

interface CacheEntry {
  expiresAt: number
  body: string
  contentType: string
  sourceUrl: string
  usedBackup: boolean
}

const manifestCache = new Map<string, CacheEntry>()
const manifestTtlMs = 5_000
const MAX_MANIFEST_CACHE_ENTRIES = 500
const MAX_MANIFEST_BYTES = 2 * 1024 * 1024
const MAX_REDIRECTS = 3
const inFlightManifestRequests = new Map<string, Promise<StreamManifestProxyResult>>()
const isProduction = process.env.NODE_ENV === 'production'

const getRedisManifestKey = (cacheKey: string) => `sportzone:stream:manifest:${cacheKey}`

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
      throw new Error('Manifest response is too large')
    }
    chunks.push(buffer)
  }

  return Buffer.concat(chunks).toString('utf8')
}

function requestManifestTarget(target: Awaited<ReturnType<typeof validateProxyTargetUrl>>, signal?: AbortSignal): Promise<IncomingMessage> {
  if (isProduction && target.url.protocol !== 'https:') {
    throw new Error('Only HTTPS stream targets are allowed in production')
  }

  const lookup = createPinnedLookup(target)
  const requestSignal = signal
    ? AbortSignal.any([signal, AbortSignal.timeout(10_000)])
    : AbortSignal.timeout(10_000)

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
): Promise<{ body: string; contentType: string; sourceUrl: string }> {
  let currentUrl = targetUrl

  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
    const validated = await validateProxyTargetUrl(currentUrl, validationOptions)
    const response = await requestManifestTarget(validated, signal)
    const responseStatus = response.statusCode ?? 0

    if (responseStatus >= 300 && responseStatus < 400) {
      const location = response.headers.location
      response.resume()
      if (!location || redirect === MAX_REDIRECTS) throw new Error('Too many manifest redirects')
      const redirectTarget = await validateProxyRedirect(
        Array.isArray(location) ? location[0] : location,
        validated.url,
        validationOptions,
        isProduction,
      )
      currentUrl = redirectTarget.url.toString()
      continue
    }

    if (responseStatus < 200 || responseStatus >= 300) {
      response.resume()
      throw new Error(`Upstream responded with ${responseStatus}`)
    }

    return {
      body: await readManifestBody(response),
      contentType: String(response.headers['content-type'] ?? 'application/vnd.apple.mpegurl'),
      sourceUrl: validated.url.toString(),
    }
  }

  throw new Error('Manifest resolution failed')
}

export async function getStreamManifestProxy({ streamId, channelId, type, targetUrl, signal }: StreamManifestProxyOptions): Promise<StreamManifestProxyResult> {
  const stream = streamId
    ? await prisma.stream.findUnique({
        where: {
          id: streamId,
          deletedAt: null,
        },
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
    throw new Error('Stream is unavailable')
  }

  const fallbackUrl = stream?.backupUrl?.trim() || null
  const primaryUrl = stream?.primaryUrl?.trim() || channel?.url?.trim() || explicitTargetUrl || ''
  const preferredUrls = [primaryUrl, fallbackUrl].filter((value): value is string => Boolean(value))

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
    throw new Error('Stream is unavailable')
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
    throw new Error('No stream URL is configured for the requested fallback type')
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
    const redisEntry = await cacheRedis.get(getRedisManifestKey(cacheKey))
    if (redisEntry) {
      const parsed = JSON.parse(redisEntry) as CacheEntry
      if (parsed.expiresAt > now && typeof parsed.body === 'string') {
        manifestCache.set(cacheKey, parsed)
        return {
          ...parsed,
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
      })
    }

    try {
      const manifest = await tryFetch(selectedUrl)
      const rewrittenManifest = rewriteManifestBody(manifest.body, manifest.sourceUrl)

      const entry: CacheEntry = {
        body: rewrittenManifest,
        contentType: manifest.contentType,
        sourceUrl: manifest.sourceUrl,
        usedBackup: type === 'backup',
        expiresAt: Date.now() + manifestTtlMs,
      }
      manifestCache.set(cacheKey, entry)
      await cacheRedis.set(getRedisManifestKey(cacheKey), JSON.stringify(entry), 'EX', Math.ceil(manifestTtlMs / 1000)).catch((error: unknown) => {
        logger.warn({ code: getRedisErrorCode(error) }, 'Unable to write resolved manifest cache')
      })

      return { ...entry, cacheControl: 'public, max-age=3, stale-while-revalidate=1' }
    } catch (error) {
      if (type === 'primary' && fallbackUrl) {
        const backupManifest = await tryFetch(fallbackUrl)
        const rewrittenManifest = rewriteManifestBody(backupManifest.body, backupManifest.sourceUrl)

        const backupEntry: CacheEntry = {
          body: rewrittenManifest,
          contentType: backupManifest.contentType,
          sourceUrl: backupManifest.sourceUrl,
          usedBackup: true,
          expiresAt: Date.now() + manifestTtlMs,
        }
        manifestCache.set(cacheKey, backupEntry)
        await cacheRedis.set(getRedisManifestKey(cacheKey), JSON.stringify(backupEntry), 'EX', Math.ceil(manifestTtlMs / 1000)).catch((cacheError: unknown) => {
          logger.warn({ code: getRedisErrorCode(cacheError) }, 'Unable to cache recovered backup manifest')
        })

        return { ...backupEntry, cacheControl: 'public, max-age=3, stale-while-revalidate=1' }
      }

      throw new Error(error instanceof Error ? error.message : 'Failed to fetch HLS manifest')
    }
  })()

  inFlightManifestRequests.set(cacheKey, request)
  try {
    return await request
  } finally {
    inFlightManifestRequests.delete(cacheKey)
  }
}

export type { StreamManifestProxyOptions, StreamManifestProxyResult }
