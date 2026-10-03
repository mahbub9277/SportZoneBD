import logger from '../../core/logger.js'
import { cacheRedis, isRedisConfigured } from '../../core/redis.js'
import { getRedisErrorCode } from '../../core/redisFailover.js'

export type FootballDataRequestKind = 'fixture' | 'standings'

const MAX_REQUESTS_PER_MINUTE = 9
const MAX_FIXTURE_REQUESTS_PER_MINUTE = 6
const RATE_LIMIT_KEY_PREFIX = 'sportzone:football:request-budget'
const RATE_LIMIT_TTL_SECONDS = 120
const RESERVE_REQUEST_SCRIPT = `
local time = redis.call('TIME')
local window = math.floor(tonumber(time[1]) / 60)
local totalKey = ARGV[1] .. ':total:' .. window
local fixtureKey = ARGV[1] .. ':fixtures:' .. window
local total = tonumber(redis.call('GET', totalKey) or '0')

if total >= tonumber(ARGV[2]) then return 0 end

if ARGV[3] == 'fixture' then
  local fixtures = tonumber(redis.call('GET', fixtureKey) or '0')
  if fixtures >= tonumber(ARGV[4]) then return 0 end
  if fixtures == 0 then
    redis.call('SET', fixtureKey, 1, 'EX', ARGV[5])
  else
    redis.call('INCR', fixtureKey)
  end
end

if total == 0 then
  redis.call('SET', totalKey, 1, 'EX', ARGV[5])
else
  redis.call('INCR', totalKey)
end

return 1
`

let localWindow = -1
let localTotalRequests = 0
let localFixtureRequests = 0

function reserveLocalRequest(kind: FootballDataRequestKind, now: number): boolean {
  const currentWindow = Math.floor(now / 60_000)
  if (currentWindow !== localWindow) {
    localWindow = currentWindow
    localTotalRequests = 0
    localFixtureRequests = 0
  }

  if (localTotalRequests >= MAX_REQUESTS_PER_MINUTE) return false
  if (kind === 'fixture' && localFixtureRequests >= MAX_FIXTURE_REQUESTS_PER_MINUTE) return false

  localTotalRequests += 1
  if (kind === 'fixture') localFixtureRequests += 1
  return true
}

export async function acquireFootballDataRequestSlot(
  kind: FootballDataRequestKind,
  now = Date.now(),
): Promise<boolean> {
  if (!isRedisConfigured) return reserveLocalRequest(kind, now)

  try {
    return Number(await cacheRedis.eval(
      RESERVE_REQUEST_SCRIPT,
      0,
      RATE_LIMIT_KEY_PREFIX,
      MAX_REQUESTS_PER_MINUTE,
      kind,
      MAX_FIXTURE_REQUESTS_PER_MINUTE,
      RATE_LIMIT_TTL_SECONDS,
    )) === 1
  } catch (error) {
    logger.warn({ code: getRedisErrorCode(error), kind }, 'Football-data.org request quota reservation failed')
    return false
  }
}