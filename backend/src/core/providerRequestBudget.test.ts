import assert from 'node:assert/strict'
import { before, test } from 'node:test'

type BudgetModule = typeof import('./providerRequestBudget.js')

let acquireProviderRequestSlot: BudgetModule['acquireProviderRequestSlot']
let getProviderBudgetKey: BudgetModule['getProviderBudgetKey']

before(async () => {
  process.env.REDIS_URL_PRIMARY = ''
  process.env.REDIS_URL = ''
  process.env.REDIS_URL_BACKUP_1 = ''
  process.env.REDIS_URL_BACKUP_2 = ''
  process.env.REDIS_URL_BACKUP_3 = ''

  const module = await import('./providerRequestBudget.js')
  acquireProviderRequestSlot = module.acquireProviderRequestSlot
  getProviderBudgetKey = module.getProviderBudgetKey
})

const NOW = Date.parse('2026-10-04T12:00:00.000Z')

test('budget key is per provider and per UTC day', () => {
  assert.equal(getProviderBudgetKey('API_FOOTBALL', NOW), 'sportzone:provider-budget:api_football:2026-10-04')
  assert.equal(getProviderBudgetKey('CRICKET_DATA', NOW), 'sportzone:provider-budget:cricket_data:2026-10-04')
  // A new UTC day starts a fresh budget.
  assert.equal(getProviderBudgetKey('API_FOOTBALL', NOW + 24 * 60 * 60 * 1000), 'sportzone:provider-budget:api_football:2026-10-05')
})

test('reserves atomically through Redis with the daily limit and a TTL', async () => {
  const calls: unknown[][] = []
  const client = {
    eval: async (...args: unknown[]) => {
      calls.push(args)
      return 1
    },
  }

  assert.equal(await acquireProviderRequestSlot('API_FOOTBALL', 100, NOW, { client, configured: true }), true)
  assert.equal(calls[0][1], 0)
  assert.equal(calls[0][2], 'sportzone:provider-budget:api_football:2026-10-04')
  assert.equal(calls[0][3], 100)
  assert.equal(calls[0][4], 2 * 24 * 60 * 60)
})

test('reports a denial when the daily limit is already spent', async () => {
  const client = { eval: async () => 0 }
  assert.equal(await acquireProviderRequestSlot('API_FOOTBALL', 100, NOW, { client, configured: true }), false)
})

test('a zero or negative limit never allows a request', async () => {
  const client = { eval: async () => 1 }
  assert.equal(await acquireProviderRequestSlot('API_FOOTBALL', 0, NOW, { client, configured: true }), false)
  assert.equal(await acquireProviderRequestSlot('API_FOOTBALL', -5, NOW, { client, configured: true }), false)
})

test('fails closed when Redis errors so the provider quota cannot be blown', async () => {
  const client = { eval: async () => { throw new Error('redis unavailable') } }
  assert.equal(await acquireProviderRequestSlot('CRICKET_DATA', 100, NOW, { client, configured: true }), false)
})

test('falls back to an in-process daily budget when Redis is not configured', async () => {
  const day = NOW + 5 * 24 * 60 * 60 * 1000 // isolated UTC day so shared local state cannot interfere

  assert.equal(await acquireProviderRequestSlot('LOCAL_TEST_PROVIDER', 2, day, { configured: false }), true)
  assert.equal(await acquireProviderRequestSlot('LOCAL_TEST_PROVIDER', 2, day, { configured: false }), true)
  assert.equal(await acquireProviderRequestSlot('LOCAL_TEST_PROVIDER', 2, day, { configured: false }), false)
  // The next day resets the local budget.
  assert.equal(await acquireProviderRequestSlot('LOCAL_TEST_PROVIDER', 2, day + 24 * 60 * 60 * 1000, { configured: false }), true)
})
