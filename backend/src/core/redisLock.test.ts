import assert from 'node:assert/strict'
import { before, test } from 'node:test'

type RedisLockModule = typeof import('./redisLock.js')

let startLockRenewal: RedisLockModule['startLockRenewal']
let renewLockWithRedis: RedisLockModule['renewLockWithRedis']
let RENEW_LOCK_SCRIPT: RedisLockModule['RENEW_LOCK_SCRIPT']

before(async () => {
  process.env.REDIS_URL_PRIMARY = ''
  process.env.REDIS_URL = ''
  process.env.REDIS_URL_BACKUP_1 = ''
  process.env.REDIS_URL_BACKUP_2 = ''
  process.env.REDIS_URL_BACKUP_3 = ''

  const module = await import('./redisLock.js')
  startLockRenewal = module.startLockRenewal
  renewLockWithRedis = module.renewLockWithRedis
  RENEW_LOCK_SCRIPT = module.RENEW_LOCK_SCRIPT
})

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function waitFor(predicate: () => boolean, timeoutMs = 1000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await sleep(5)
  }
  throw new Error('Timed out waiting for condition')
}

test('renews the lock only after the first interval elapses', async () => {
  let calls = 0
  const handle = startLockRenewal({
    lockKey: 'lock',
    lockToken: 'token',
    ttlSeconds: 55,
    intervalMs: 60,
    renew: async () => { calls += 1; return true },
  })

  try {
    assert.equal(calls, 0)
    await waitFor(() => calls > 0)
    assert.equal(handle.isActive(), true)
  } finally {
    handle.stop()
  }
})

test('renews repeatedly while the process still owns the lock', async () => {
  let calls = 0
  const handle = startLockRenewal({
    lockKey: 'lock',
    lockToken: 'token',
    ttlSeconds: 55,
    intervalMs: 10,
    renew: async () => { calls += 1; return true },
  })

  try {
    await waitFor(() => calls >= 3)
    assert.equal(handle.isActive(), true)
  } finally {
    handle.stop()
  }
})

test('stops renewing once ownership of the lock is lost', async () => {
  let calls = 0
  const handle = startLockRenewal({
    lockKey: 'lock',
    lockToken: 'token',
    ttlSeconds: 55,
    intervalMs: 10,
    renew: async () => { calls += 1; return false },
  })

  await waitFor(() => !handle.isActive())
  const callsAtLoss = calls
  await sleep(60)
  assert.equal(calls, callsAtLoss)
})

test('stops renewing after the job completes', async () => {
  let calls = 0
  const handle = startLockRenewal({
    lockKey: 'lock',
    lockToken: 'token',
    ttlSeconds: 55,
    intervalMs: 10,
    renew: async () => { calls += 1; return true },
  })

  await waitFor(() => calls >= 2)
  handle.stop()
  const callsAtStop = calls
  await sleep(60)

  assert.equal(handle.isActive(), false)
  assert.equal(calls, callsAtStop)
})

test('tears down renewal when the guarded job throws, leaving no timer behind', async () => {
  let calls = 0
  let handle: ReturnType<RedisLockModule['startLockRenewal']> | undefined

  await assert.rejects(async () => {
    handle = startLockRenewal({
      lockKey: 'lock',
      lockToken: 'token',
      ttlSeconds: 55,
      intervalMs: 10,
      renew: async () => { calls += 1; return true },
    })

    try {
      await waitFor(() => calls >= 2)
      throw new Error('job aborted')
    } finally {
      handle.stop()
    }
  }, /job aborted/)

  const callsAtFailure = calls
  await sleep(60)

  assert.equal(handle?.isActive(), false)
  assert.equal(calls, callsAtFailure)
})

test('stops renewing when Redis rejects the renewal call', async () => {
  let calls = 0
  const handle = startLockRenewal({
    lockKey: 'lock',
    lockToken: 'token',
    ttlSeconds: 55,
    intervalMs: 10,
    renew: async () => { calls += 1; throw new Error('redis unavailable') },
  })

  await waitFor(() => !handle.isActive())
  assert.equal(calls, 1)
})

test('never overlaps renewals when a renewal is slower than the interval', async () => {
  let inFlight = 0
  let maxInFlight = 0
  const handle = startLockRenewal({
    lockKey: 'lock',
    lockToken: 'token',
    ttlSeconds: 55,
    intervalMs: 5,
    renew: async () => {
      inFlight += 1
      maxInFlight = Math.max(maxInFlight, inFlight)
      await sleep(25)
      inFlight -= 1
      return true
    },
  })

  try {
    await sleep(90)
    assert.equal(maxInFlight, 1)
  } finally {
    handle.stop()
  }
})

test('renewLockWithRedis only reports success for a token-checked extension', async () => {
  const calls: unknown[][] = []
  const fakeClient = {
    eval: async (...args: unknown[]) => {
      calls.push(args)
      return 1
    },
  }

  assert.equal(await renewLockWithRedis(fakeClient, 'sportzone:lock', 'token-1', 55), true)
  assert.deepEqual(calls[0], [RENEW_LOCK_SCRIPT, 1, 'sportzone:lock', 'token-1', 55])

  const staleClient = { eval: async () => 0 }
  assert.equal(await renewLockWithRedis(staleClient, 'sportzone:lock', 'token-2', 55), false)
})
