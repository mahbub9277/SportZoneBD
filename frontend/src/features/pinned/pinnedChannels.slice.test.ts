import assert from 'node:assert/strict'
import { before, test } from 'node:test'
import { configureStore } from '@reduxjs/toolkit'

const STORAGE_KEY = 'sportzonebd-pinned-channels'

// Minimal localStorage stand-in so the slice's real read/write paths run unmodified.
class MemoryStorage {
  private readonly values = new Map<string, string>()

  getItem(key: string): string | null {
    return this.values.has(key) ? this.values.get(key)! : null
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }

  seed(key: string, value: string): void {
    this.values.set(key, value)
  }
}

const storage = new MemoryStorage()

type SliceModule = typeof import('./pinnedChannels.slice.ts')

const createTestStore = (pinnedChannelsReducer: SliceModule['default'], listenerMiddleware: SliceModule['pinnedChannelsListenerMiddleware']) =>
  configureStore({
    reducer: { pinnedChannels: pinnedChannelsReducer },
    middleware: (getDefaultMiddleware) => getDefaultMiddleware().concat(listenerMiddleware.middleware),
  })

let slice: SliceModule
let store: ReturnType<typeof createTestStore>

const readPersistedIds = (): string[] => JSON.parse(storage.getItem(STORAGE_KEY) ?? '[]') as string[]

// The app's selector is typed against the whole RootState; the test store only holds this slice.
const pinnedIds = (): string[] => store.getState().pinnedChannels.pinnedChannelIds

before(async () => {
  ;(globalThis as unknown as { window: unknown }).window = { localStorage: storage }
  slice = await import('./pinnedChannels.slice.ts')
  store = createTestStore(slice.default, slice.pinnedChannelsListenerMiddleware)
})

test('pinning a channel adds it, and the same control unpins it again', () => {
  store.dispatch(slice.togglePinnedChannel('channel-a'))
  assert.deepEqual(pinnedIds(), ['channel-a'])

  store.dispatch(slice.togglePinnedChannel('channel-b'))
  assert.deepEqual(pinnedIds(), ['channel-a', 'channel-b'])

  store.dispatch(slice.togglePinnedChannel('channel-a'))
  assert.deepEqual(pinnedIds(), ['channel-b'])
})

test('every toggle is written to browser storage, so the state survives a refresh', () => {
  assert.deepEqual(readPersistedIds(), ['channel-b'])

  store.dispatch(slice.togglePinnedChannel('channel-c'))
  assert.deepEqual(readPersistedIds(), ['channel-b', 'channel-c'])

  store.dispatch(slice.togglePinnedChannel('channel-b'))
  assert.deepEqual(readPersistedIds(), ['channel-c'])
})

test('a channel can never be pinned twice', () => {
  // Pinned at the end of the previous test: unpinning and pinning again must leave exactly one entry.
  store.dispatch(slice.togglePinnedChannel('channel-c'))
  store.dispatch(slice.togglePinnedChannel('channel-c'))
  assert.deepEqual(pinnedIds(), ['channel-c'])
  assert.deepEqual(readPersistedIds(), ['channel-c'])
})

test('clearing the pinned list is persisted as well', () => {
  store.dispatch(slice.clearPinnedChannels())
  assert.deepEqual(pinnedIds(), [])
  assert.deepEqual(readPersistedIds(), [])

  // A cleared list is the persisted truth a refreshed page must restore.
  assert.deepEqual(JSON.parse(storage.getItem(STORAGE_KEY) ?? 'null'), [])
})

test('only channel ids are stored, and a blank id is ignored', () => {
  storage.seed(STORAGE_KEY, JSON.stringify(['channel-x']))
  store.dispatch(slice.togglePinnedChannel('   '))
  assert.deepEqual(pinnedIds(), [])
  assert.deepEqual(readPersistedIds(), [])
})

test('a corrupted stored payload falls back to an empty list instead of throwing', async () => {
  storage.seed(STORAGE_KEY, '{not-json')
  const fresh = await import(`./pinnedChannels.slice.ts?corrupt=${Date.now()}`)
  const initial = fresh.default(undefined, { type: 'init' })
  assert.deepEqual(initial.pinnedChannelIds, [])
})
