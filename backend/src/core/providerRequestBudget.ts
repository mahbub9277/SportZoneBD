import logger from './logger.js'
import { cacheRedis, isRedisConfigured } from './redis.js'
import { getRedisErrorCode } from './redisFailover.js'

/**
 * Per-provider daily request budget. External sports providers (API-Football, CricketData) meter
 * requests per calendar day, so a daily reservation is what keeps SportZoneBD inside its quota.
 * The existing per-minute football-data limiter is untouched.
 */

const BUDGET_KEY_PREFIX = 'sportzone:provider-budget'
const BUDGET_TTL_SECONDS = 2 * 24 * 60 * 60

const RESERVE_DAILY_REQUEST_SCRIPT = `
local key = ARGV[1]
local limit = tonumber(ARGV[2])
local used = tonumber(redis.call('GET', key) or '0')
if used >= limit then return 0 end
if used == 0 then
  redis.call('SET', key, 1, 'EX', ARGV[3])
else
  redis.call('INCR', key)
end
return 1
`

const localBudgets = new Map<string, { day: string; used: number }>()

export function getProviderBudgetKey(provider: string, now: number = Date.now()): string {
  const day = new Date(now).toISOString().slice(0, 10)
  return `${BUDGET_KEY_PREFIX}:${provider.toLowerCase()}:${day}`
}

function reserveLocalSlot(provider: string, dailyLimit: number, now: number): boolean {
  const day = new Date(now).toISOString().slice(0, 10)
  const current = localBudgets.get(provider)

  if (!current || current.day !== day) {
    localBudgets.set(provider, { day, used: 1 })
    return dailyLimit >= 1
  }

  if (current.used >= dailyLimit) return false
  current.used += 1
  return true
}

export interface ProviderBudgetDeps {
  client?: { eval: (...args: unknown[]) => Promise<unknown> }
  configured?: boolean
}

/**
 * Reserves one request against the provider's daily budget.
 * Fails closed on Redis errors: protecting the quota matters more than a single sync run,
 * and the next automation cycle will retry.
 */
export async function acquireProviderRequestSlot(
  provider: string,
  dailyLimit: number,
  now: number = Date.now(),
  deps: ProviderBudgetDeps = {},
): Promise<boolean> {
  if (dailyLimit <= 0) return false

  const client = deps.client ?? cacheRedis
  const configured = deps.configured ?? isRedisConfigured
  if (!configured) return reserveLocalSlot(provider, dailyLimit, now)

  try {
    const reserved = await client.eval(
      RESERVE_DAILY_REQUEST_SCRIPT,
      0,
      getProviderBudgetKey(provider, now),
      dailyLimit,
      BUDGET_TTL_SECONDS,
    )
    return Number(reserved) === 1
  } catch (error) {
    logger.warn({ code: getRedisErrorCode(error), provider }, 'Provider request budget unavailable; skipping this provider for now')
    return false
  }
}

/** Reads today's usage for observability; never throws. */
export async function getProviderRequestUsage(provider: string, now: number = Date.now()): Promise<number | null> {
  if (!isRedisConfigured) return null
  try {
    const used = await cacheRedis.get(getProviderBudgetKey(provider, now))
    return used === null ? 0 : Number(used)
  } catch {
    return null
  }
}
