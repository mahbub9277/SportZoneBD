import test from 'node:test'
import assert from 'node:assert/strict'
import {
  FINISHED_MATCH_MIN_RETENTION_MINUTES,
  isFinishedMatchExpired,
  resolveFinishedMatchCleanupCutoff,
  resolveFinishedMatchRetentionMinutes,
} from './finishedMatchRetention.js'

const finishedMatch = (finishedAt: Date | null, updatedAt = finishedAt ?? new Date()) => ({
  status: 'FINISHED',
  deletedAt: null,
  finishedAt,
  updatedAt,
})

test('defaults the finished match retention to the 30 minute product rule', () => {
  assert.equal(FINISHED_MATCH_MIN_RETENTION_MINUTES, 30)
  assert.equal(resolveFinishedMatchRetentionMinutes(undefined), 30)
  assert.equal(resolveFinishedMatchRetentionMinutes(null), 30)
  assert.equal(resolveFinishedMatchRetentionMinutes(''), 30)
  assert.equal(resolveFinishedMatchRetentionMinutes('not-a-number'), 30)
  assert.equal(resolveFinishedMatchRetentionMinutes('-30'), 30)
  assert.equal(resolveFinishedMatchRetentionMinutes('0'), 30)
})

test('never shortens retention below 30 minutes', () => {
  assert.equal(resolveFinishedMatchRetentionMinutes('1'), 30)
  assert.equal(resolveFinishedMatchRetentionMinutes('15'), 30)
  assert.equal(resolveFinishedMatchRetentionMinutes('29'), 30)
  assert.equal(resolveFinishedMatchRetentionMinutes('29.9'), 30)
  assert.equal(resolveFinishedMatchRetentionMinutes('30'), 30)
})

test('honours a longer explicitly configured retention window', () => {
  assert.equal(resolveFinishedMatchRetentionMinutes('60'), 60)
  assert.equal(resolveFinishedMatchRetentionMinutes(1440), 1440)
})

test('a match becomes eligible exactly 30 minutes after it finished', () => {
  const minutes = resolveFinishedMatchRetentionMinutes()
  const finishedAt = new Date('2026-01-01T20:00:00.000Z')
  const eligibleAt = resolveFinishedMatchCleanupCutoff(new Date('2026-01-01T20:30:00.000Z'), minutes)
  const tooEarlyAt = resolveFinishedMatchCleanupCutoff(new Date('2026-01-01T20:29:59.000Z'), minutes)

  assert.equal(minutes, 30)
  assert.equal(eligibleAt.toISOString(), finishedAt.toISOString())
  assert.equal(isFinishedMatchExpired(finishedMatch(finishedAt), eligibleAt), true)
  assert.equal(isFinishedMatchExpired(finishedMatch(finishedAt), tooEarlyAt), false)
})

test('keeps matches that are still inside the retention window', () => {
  const now = new Date('2026-01-01T20:30:00.000Z')
  const cutoff = resolveFinishedMatchCleanupCutoff(now, 30)
  assert.equal(isFinishedMatchExpired(finishedMatch(new Date('2026-01-01T20:01:00.000Z')), cutoff), false)
  assert.equal(isFinishedMatchExpired(finishedMatch(new Date('2026-01-01T20:00:00.000Z')), cutoff), true)
})

test('never expires live, upcoming or soft deleted matches', () => {
  const cutoff = resolveFinishedMatchCleanupCutoff(new Date('2026-01-01T20:30:00.000Z'), 30)
  const finishedAt = new Date('2026-01-01T19:00:00.000Z')

  assert.equal(isFinishedMatchExpired({ ...finishedMatch(finishedAt), status: 'LIVE' }, cutoff), false)
  assert.equal(isFinishedMatchExpired({ ...finishedMatch(finishedAt), status: 'UPCOMING' }, cutoff), false)
  assert.equal(isFinishedMatchExpired({ ...finishedMatch(finishedAt), deletedAt: new Date() }, cutoff), false)
})

test('falls back to updatedAt when no finish moment was recorded', () => {
  const cutoff = resolveFinishedMatchCleanupCutoff(new Date('2026-01-01T20:30:00.000Z'), 30)

  assert.equal(isFinishedMatchExpired(finishedMatch(null, new Date('2026-01-01T20:01:00.000Z')), cutoff), false)
  assert.equal(isFinishedMatchExpired(finishedMatch(null, new Date('2026-01-01T19:59:00.000Z')), cutoff), true)
})

test('supports a longer retention window end to end', () => {
  const cutoff = resolveFinishedMatchCleanupCutoff(new Date('2026-01-01T20:30:00.000Z'), 1440)
  assert.equal(isFinishedMatchExpired(finishedMatch(new Date('2026-01-01T20:00:00.000Z')), cutoff), false)
  assert.equal(isFinishedMatchExpired(finishedMatch(new Date('2025-12-31T19:00:00.000Z')), cutoff), true)
})
