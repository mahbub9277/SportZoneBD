import assert from 'node:assert/strict'
import test from 'node:test'
import { parseMatchRound } from './matchRound.ts'

test('a real matchday is kept as a number', () => {
  assert.equal(parseMatchRound(7), 7)
  assert.equal(parseMatchRound('7'), 7)
  assert.equal(parseMatchRound(' 8 '), 8)
  assert.equal(parseMatchRound(200), 200)
})

test('an empty box means "not stated", never round zero', () => {
  assert.equal(parseMatchRound(''), null)
  assert.equal(parseMatchRound('   '), null)
  assert.equal(parseMatchRound(null), null)
  assert.equal(parseMatchRound(undefined), null)
  assert.equal(parseMatchRound(0), null)
  assert.equal(parseMatchRound('0'), null)
})

test('a typo never becomes a fabricated round', () => {
  assert.equal(parseMatchRound('Round 7'), null)
  assert.equal(parseMatchRound('7th'), null)
  assert.equal(parseMatchRound(7.5), null)
  assert.equal(parseMatchRound(-3), null)
  assert.equal(parseMatchRound(201), null)
  assert.equal(parseMatchRound({}), null)
})
