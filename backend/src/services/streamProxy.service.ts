import { prisma } from '../core/prisma.js'
import logger from '../core/logger.js'
import { redis } from '../core/redis.js'
import { validateProxyTargetUrl } from '../utils/ssrfGuard.js'

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

function resolvePlaylistUri(rawValue: string, baseUrl: string): string {
  const trimmedValue = rawValue.trim()
  if (!trimmedValue || trimmedValue.startsWith('#')) {
    return rawValue
  }

  try {
    return new URL(trimmedValue, baseUrl).toString()
  } catch {
    return rawValue
  }
}

function rewriteManifestBody(body: string, baseUrl: string): string {
  return body
    .split(/\r?\n/)
    .map((line) => {
      const trimmedLine = line.trim()
      if (!trimmedLine) {
        return line
      }

      const uriMatch = trimmedLine.match(/URI="([^"]+)"/i)
      if (uriMatch) {
        const resolvedValue = resolvePlaylistUri(uriMatch[1], baseUrl)
        return line.replace(uriMatch[1], resolvedValue)
      }

      if (trimmedLine.startsWith('#')) {
        return line
      }

      return resolvePlaylistUri(trimmedLine, baseUrl)
    })
    .join('\n')
}

async function readManifestBody(response: Response): Promise<string> {
  if (!response.body) return response.text()

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  const chunks: string[] = []
  let totalBytes = 0

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      totalBytes += value.byteLength
      if (totalBytes > MAX_MANIFEST_BYTES) {
        await reader.cancel()
        throw new Error('Manifest response is too large')
      }
      chunks.push(decoder.decode(value, { stream: true }))
    }
    chunks.push(decoder.decode())
    return chunks.join('')
  } finally {
    reader.releaseLock()
  }
}

async function fetchManifest(
  targetUrl: string,
  signal: AbortSignal | undefined,
  validationOptions: { trustedUrls: string[]; allowedDomains: string[]; requireAllowlist: boolean },
): Promise<{ body: string; contentType: string; sourceUrl: string }> {
  let currentUrl = targetUrl

  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
    const validated = await validateProxyTargetUrl(currentUrl, validationOptions)
    const response = await fetch(validated.url, {
      redirect: 'manual',
      headers: {
        Accept: 'application/vnd.apple.mpegurl,text/plain,application/x-mpegURL,*/*',
        'User-Agent': 'SportZoneHlsProxy/1.0',
      },
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10_000)]) : AbortSignal.timeout(10_000),
    })

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location')
      if (!location || redirect === MAX_REDIRECTS) throw new Error('Too many manifest redirects')
      currentUrl = new URL(location, validated.url).toString()
      continue
    }

    if (!response.ok) throw new Error(`Upstream responded with ${response.status}`)

    return {
      body: await readManifestBody(response),
      contentType: response.headers.get('content-type') ?? 'application/vnd.apple.mpegurl',
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

    const validated = await validateProxyTargetUrl(primaryUrl, {
      trustedUrls: [primaryUrl],
      allowedDomains: [],
      requireAllowlist: false,
    })

    const manifest = await fetchManifest(validated.url.toString(), signal, { trustedUrls: [primaryUrl], allowedDomains: [], requireAllowlist: false })
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
    const redisEntry = await redis.get(getRedisManifestKey(cacheKey))
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
    logger.warn({ error, streamId, channelId }, 'Redis manifest cache unavailable; resolving from source')
  }

  const existingRequest = inFlightManifestRequests.get(cacheKey)
  if (existingRequest) return existingRequest

  const request = (async (): Promise<StreamManifestProxyResult> => {
    const tryFetch = async (targetUrl: string): Promise<{ body: string; contentType: string; sourceUrl: string }> => {
      const validated = await validateProxyTargetUrl(targetUrl, {
      trustedUrls: preferredUrls,
      allowedDomains: allowedDomainHosts,
      requireAllowlist: true,
      })

      return fetchManifest(validated.url.toString(), signal, {
        trustedUrls: preferredUrls,
        allowedDomains: allowedDomainHosts,
        requireAllowlist: true,
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
      await redis.set(getRedisManifestKey(cacheKey), JSON.stringify(entry), 'EX', Math.ceil(manifestTtlMs / 1000)).catch((error: unknown) => {
        logger.warn({ error, streamId, channelId }, 'Unable to write resolved manifest cache')
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
        await redis.set(getRedisManifestKey(cacheKey), JSON.stringify(backupEntry), 'EX', Math.ceil(manifestTtlMs / 1000)).catch((cacheError: unknown) => {
          logger.warn({ error: cacheError, streamId }, 'Unable to cache recovered backup manifest')
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
