import assert from 'node:assert/strict'
import { test } from 'node:test'

import { PROVIDER_KEY_PREFIX, providerFixtureKey } from './types.js'

test('keeps the pre-existing football-data.org key prefix so stored rows stay unique', () => {
  assert.equal(
    providerFixtureKey({ provider: 'FOOTBALL_DATA', providerMatchId: '12345' }),
    'football-data-org:12345',
  )
})

test('namespaces every provider so ids from different sources cannot collide', () => {
  assert.equal(providerFixtureKey({ provider: 'API_FOOTBALL', providerMatchId: '12345' }), 'api-football:12345')
  assert.equal(providerFixtureKey({ provider: 'CRICKET_DATA', providerMatchId: '12345' }), 'cricket-data:12345')

  const keys = new Set(
    (Object.keys(PROVIDER_KEY_PREFIX) as Array<keyof typeof PROVIDER_KEY_PREFIX>).map(
      (provider) => providerFixtureKey({ provider, providerMatchId: '12345' }),
    ),
  )
  assert.equal(keys.size, 3)
})

test('returns null when a provider exposes no fixture id', () => {
  assert.equal(providerFixtureKey({ provider: 'API_FOOTBALL', providerMatchId: null }), null)
  assert.equal(providerFixtureKey({ provider: 'API_FOOTBALL', providerMatchId: '   ' }), null)
})
