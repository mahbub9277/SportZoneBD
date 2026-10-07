import test from 'node:test'
import assert from 'node:assert/strict'
import {
  findNextStreamCandidate,
  getStreamCandidateChain,
  type Stream,
} from './matches.types.ts'

const stream = (overrides: Partial<Stream> & { id: string }): Stream => ({
  status: 'READY',
  ...overrides,
})

const url = (name: string) => `https://cdn.example.com/${name}.m3u8`

test('the candidate chain keeps stream order and expands each stream in fallback order', () => {
  const chain = getStreamCandidateChain([
    stream({ id: 'a', name: 'Stream A', primaryUrl: url('a-primary'), backupUrl: url('a-backup'), backupUrls: [url('a-extra')] }),
    stream({ id: 'b', name: 'Stream B', url: url('b-url') }),
  ])

  assert.deepEqual(chain.map((candidate) => candidate.url), [
    url('a-primary'),
    url('a-backup'),
    url('a-extra'),
    url('b-url'),
  ])
  assert.deepEqual(chain.map((candidate) => candidate.streamId), ['a', 'a', 'a', 'b'])
  assert.equal(chain[0].streamName, 'Stream A')
})

test('a channel stream prefers its channel url', () => {
  const chain = getStreamCandidateChain([
    stream({
      id: 'a',
      sourceType: 'CHANNEL',
      primaryUrl: url('a-primary'),
      channel: { id: 'c1', name: 'Channel', url: url('channel') },
    }),
  ])

  assert.deepEqual(chain.map((candidate) => candidate.url), [url('channel'), url('a-primary')])
})

test('duplicate urls across streams are only attempted once', () => {
  const chain = getStreamCandidateChain([
    stream({ id: 'a', primaryUrl: url('same'), backupUrl: url('a-backup') }),
    stream({ id: 'b', primaryUrl: url('same'), url: url('b-url') }),
  ])

  assert.deepEqual(chain.map((candidate) => candidate.url), [url('same'), url('a-backup'), url('b-url')])
  assert.equal(new Set(chain.map((candidate) => candidate.url)).size, chain.length)
})

test('streams that are disabled or marked offline are never candidates', () => {
  const chain = getStreamCandidateChain([
    stream({ id: 'offline', status: 'OFFLINE', primaryUrl: url('offline') }),
    stream({ id: 'disabled', enabled: false, primaryUrl: url('disabled') }),
    stream({ id: 'empty', primaryUrl: null, backupUrl: null }),
    stream({ id: 'live', status: 'LIVE', primaryUrl: url('live') }),
  ])

  assert.deepEqual(chain.map((candidate) => candidate.url), [url('live')])
  assert.deepEqual(getStreamCandidateChain(null), [])
  assert.deepEqual(getStreamCandidateChain(undefined), [])
})

test('fallback moves forward through the chain and stops when nothing is left', () => {
  const chain = getStreamCandidateChain([
    stream({ id: 'a', primaryUrl: url('a-primary'), backupUrl: url('a-backup') }),
    stream({ id: 'b', primaryUrl: url('b-primary') }),
  ])

  const attempted = new Set<string>()
  const first = findNextStreamCandidate(chain, url('a-primary'), attempted)
  assert.equal(first?.url, url('a-backup'))

  attempted.add(url('a-primary'))
  attempted.add(url('a-backup'))
  const second = findNextStreamCandidate(chain, url('a-backup'), attempted)
  assert.equal(second?.url, url('b-primary'))
  assert.equal(second?.streamId, 'b')

  attempted.add(url('b-primary'))
  assert.equal(findNextStreamCandidate(chain, url('b-primary'), attempted), null)
})

test('a failed url that is not in the chain starts from the first un-attempted candidate', () => {
  const chain = getStreamCandidateChain([stream({ id: 'a', primaryUrl: url('a'), backupUrl: url('b') })])
  const attempted = new Set<string>([url('a')])

  assert.equal(findNextStreamCandidate(chain, 'https://unrelated.example.com/x.m3u8', attempted)?.url, url('b'))
  assert.equal(findNextStreamCandidate(chain, null, attempted)?.url, url('b'))
  assert.equal(findNextStreamCandidate([], url('a'), attempted), null)
})

test('each unique url is attempted at most once while falling back', () => {
  const chain = getStreamCandidateChain([
    stream({ id: 'a', primaryUrl: url('one'), backupUrl: url('two') }),
    stream({ id: 'b', primaryUrl: url('two'), backupUrl: url('three') }),
  ])

  const attempted = new Set<string>()
  const visited: string[] = []
  let current: string | null = chain[0].url
  while (current) {
    visited.push(current)
    attempted.add(current)
    current = findNextStreamCandidate(chain, current, attempted)?.url ?? null
  }

  assert.deepEqual(visited, [url('one'), url('two'), url('three')])
  assert.equal(new Set(visited).size, visited.length)
})
