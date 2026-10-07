import { cacheRedis } from '../core/redis.js'

/**
 * The shared, Redis-backed copy of a resolved HLS manifest.
 *
 * Every instance already keeps the manifest it resolved in a process-local cache for the full
 * lifetime of the playlist (`manifestTtlMs`, 5 seconds). This shared copy exists for exactly one
 * reason: another instance can reuse a manifest this one just resolved instead of going back to the
 * origin. Because both copies live for the same 5 seconds, a single-instance deployment can never
 * benefit from it — the shared entry expires with the local entry it mirrors, so each refresh would
 * pay a GET that misses and a SET that duplicates the local write. `enabled` therefore skips both
 * commands unless the deployment is explicitly declared multi-instance.
 */
export interface ManifestCacheEntry {
  expiresAt: number
  body: string
  contentType: string
  sourceUrl: string
  usedBackup: boolean
}

export interface ManifestSharedCache {
  read: (cacheKey: string) => Promise<ManifestCacheEntry | null>
  write: (cacheKey: string, entry: ManifestCacheEntry) => Promise<unknown>
}

export interface ManifestSharedCacheOptions {
  /** False on a single-instance deployment, which makes both operations inert. */
  enabled: boolean
  /** Lifetime of the process-local entry this copy mirrors, in milliseconds. */
  ttlMs: number
  /** Injectable for tests; defaults to the shared cache client. */
  client?: ManifestCacheClient
}

interface ManifestCacheClient {
  get: (key: string) => Promise<string | null>
  set: (key: string, value: string, expiryMode: 'EX', ttlSeconds: number) => Promise<unknown>
}

const SHARED_MANIFEST_KEY_PREFIX = 'sportzone:stream:manifest:'

export function createManifestSharedCache({ enabled, ttlMs, client }: ManifestSharedCacheOptions): ManifestSharedCache {
  if (!enabled) {
    // Nothing else can read the entry, so no Redis command is issued at all rather than reading a
    // guaranteed miss and writing a duplicate of the local entry.
    return {
      read: async () => null,
      write: async () => null,
    }
  }

  const redisClient = client ?? (cacheRedis as ManifestCacheClient)
  const ttlSeconds = Math.ceil(ttlMs / 1000)

  return {
    read: async (cacheKey) => {
      const stored = await redisClient.get(`${SHARED_MANIFEST_KEY_PREFIX}${cacheKey}`)
      return stored ? (JSON.parse(stored) as ManifestCacheEntry) : null
    },
    write: (cacheKey, entry) =>
      redisClient.set(`${SHARED_MANIFEST_KEY_PREFIX}${cacheKey}`, JSON.stringify(entry), 'EX', ttlSeconds),
  }
}
