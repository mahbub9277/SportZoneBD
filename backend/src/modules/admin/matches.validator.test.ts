import assert from 'node:assert/strict'
import { test } from 'node:test'
import { bulkReviewSchema, matchSchema } from './matches.validator.js'

const base = { title: 'Arsenal vs Manchester City', kickoffAt: '2026-10-11T15:30:00.000Z' }

const roundOf = (round: unknown) => {
  const parsed = matchSchema.safeParse({ ...base, round })
  assert.equal(parsed.success, true, `expected round ${String(round)} to be accepted`)
  return parsed.success ? parsed.data.round : undefined
}

test('a real matchday typed by an admin is stored as a number', () => {
  assert.equal(roundOf(7), 7)
  assert.equal(roundOf('7'), 7)
  assert.equal(roundOf(200), 200)
})

test('an empty round field means "not stated" and never reaches the database as zero', () => {
  // The create/edit form sends every field it has, so an untouched round arrives as an empty string.
  assert.equal(roundOf(''), null)
  assert.equal(roundOf(null), null)
  assert.equal(roundOf(undefined), null)
})

test('a round outside the real matchday range is rejected instead of being stored', () => {
  for (const value of [0, -1, 201, 7.5]) {
    const parsed = matchSchema.safeParse({ ...base, round: value })
    assert.equal(parsed.success, false, `expected round ${value} to be rejected`)
  }
})

const MATCH_ID = '2f1c6a34-8f2b-4a5e-9d1c-0f5b7a9c3e11'

test('a bulk review accepts one or many real match ids', () => {
  assert.deepEqual(bulkReviewSchema.parse({ ids: [MATCH_ID] }).ids, [MATCH_ID])
  assert.equal(bulkReviewSchema.parse({ ids: [MATCH_ID, MATCH_ID] }).ids.length, 2)
})

test('a bulk review rejects an empty selection or a non-match id', () => {
  for (const payload of [{ ids: [] }, { ids: ['not-a-uuid'] }, { ids: [123] }, {}, { ids: MATCH_ID }]) {
    assert.equal(bulkReviewSchema.safeParse(payload).success, false, `expected ${JSON.stringify(payload)} to be rejected`)
  }
})

test('a bulk review refuses an unbounded batch instead of fanning out', () => {
  const tooMany = Array.from({ length: 201 }, () => MATCH_ID)

  assert.equal(bulkReviewSchema.safeParse({ ids: tooMany }).success, false)
  assert.equal(bulkReviewSchema.safeParse({ ids: tooMany.slice(0, 200) }).success, true)
})
