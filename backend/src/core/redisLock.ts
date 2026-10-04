import logger from './logger.js'
import { getRedisErrorCode } from './redisFailover.js'

/**
 * Renews a lock only while the caller still owns it. Returns 1 when the TTL was
 * extended, 0 when the lock is gone or owned by another process.
 */
export const RENEW_LOCK_SCRIPT =
  "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('expire', KEYS[1], ARGV[2]) else return 0 end"

export interface LockRenewalOptions {
  lockKey: string
  lockToken: string
  ttlSeconds: number
  intervalMs: number
  /** Must perform the token-checked renewal; resolves false when ownership was lost. */
  renew: (lockKey: string, lockToken: string, ttlSeconds: number) => Promise<boolean>
}

export interface LockRenewalHandle {
  stop: () => void
  isActive: () => boolean
}

export function renewLockWithRedis(
  redisClient: { eval: (script: string, numberOfKeys: number, ...args: (string | number)[]) => Promise<unknown> },
  lockKey: string,
  lockToken: string,
  ttlSeconds: number,
): Promise<boolean> {
  return redisClient
    .eval(RENEW_LOCK_SCRIPT, 1, lockKey, lockToken, ttlSeconds)
    .then((result) => Number(result) === 1)
}

/**
 * Keeps a long-running job's Redis lock alive with a single EXPIRE per interval.
 * Renewal stops on ownership loss, on errors, and when stop() is called, so a
 * finished or failed job never extends its lock.
 */
export function startLockRenewal(options: LockRenewalOptions): LockRenewalHandle {
  const { lockKey, lockToken, ttlSeconds, intervalMs, renew } = options
  let active = true
  let renewing = false
  let timer: ReturnType<typeof setInterval> | undefined

  const stop = (): void => {
    if (!active) return
    active = false
    if (timer) clearInterval(timer)
  }

  timer = setInterval(() => {
    if (!active || renewing) return
    renewing = true
    void renew(lockKey, lockToken, ttlSeconds)
      .then((renewed) => {
        if (renewed) return
        logger.warn({ lockKey }, 'Lock ownership was lost; stopping lock renewal')
        stop()
      })
      .catch((error: unknown) => {
        logger.warn({ code: getRedisErrorCode(error), lockKey }, 'Lock renewal failed; stopping lock renewal')
        stop()
      })
      .finally(() => {
        renewing = false
      })
  }, intervalMs)

  if (typeof timer.unref === 'function') timer.unref()

  return { stop, isActive: () => active }
}
