import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

process.env.JWT_SECRET ??= 'match-stream-lifecycle-test-secret'
process.env.JWT_REFRESH_SECRET ??= 'match-stream-lifecycle-test-refresh-secret'
// This file must never need Redis or a database.
delete process.env.REDIS_URL
delete process.env.REDIS_URL_PRIMARY

const { buildFinishedMatchStreamUpdate } = await import('./matchStreamLifecycle.js')
const { cleanupMatch } = await import('./match-cleanup.service.js')
const { FINISHED_MATCH_MIN_RETENTION_MINUTES, resolveFinishedMatchRetentionMinutes } = await import('./finishedMatchRetention.js')

const BACKEND_SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const MATCH_ID = '11111111-2222-4333-8444-555555555555'

/**
 * The finished-match / stream lifecycle.
 *
 * A stream belongs to exactly one match, and the relation is `ON DELETE CASCADE`, so the whole lifecycle is:
 * finishing stops playback but keeps the row, and the retention cleanup deletes the match — taking exactly
 * that match's streams with it. These tests pin both halves and guard the two call sites that used to mark
 * the stream deleted half an hour early.
 */

const readSource = (relativePath: string) => readFileSync(path.join(BACKEND_SRC, relativePath), 'utf8')

interface CleanupHarness {
  calls: Array<{ model: string; method: string; args: unknown }>
  streamIds: string[]
  logs: Array<Record<string, unknown>>
}

/** Stubs the three Prisma delegates `cleanupMatch` touches; nothing leaves the process. */
async function withCleanupDatabase(
  options: {
    match?: Record<string, unknown> | null
    deleteError?: unknown
  },
  assertion: (harness: CleanupHarness) => Promise<void>,
): Promise<CleanupHarness> {
  const { prisma } = await import('../core/prisma.js')
  const originals = { match: prisma.match, systemLog: prisma.systemLog, $transaction: prisma.$transaction }

  const harness: CleanupHarness = { calls: [], streamIds: [], logs: [] }
  const record = (model: string, method: string, args: unknown) => harness.calls.push({ model, method, args })

  try {
    ;(prisma as { match: unknown }).match = {
      findUnique: async (args: unknown) => {
        record('match', 'findUnique', args)
        return options.match === undefined ? { id: MATCH_ID, status: 'FINISHED', homeTeamLogo: null, awayTeamLogo: null, streams: [] } : options.match
      },
      delete: async (args: unknown) => {
        record('match', 'delete', args)
        if (options.deleteError) throw options.deleteError
        return { id: MATCH_ID }
      },
    }
    ;(prisma as { systemLog: unknown }).systemLog = { create: async (args: unknown) => args }
    ;(prisma as { $transaction: unknown }).$transaction = async (operation: unknown) => {
      if (typeof operation === 'function') return (operation as (tx: unknown) => Promise<unknown>)({ match: prisma.match })
      throw new Error('unexpected transaction form')
    }

    await assertion(harness)
    return harness
  } finally {
    ;(prisma as { match: unknown }).match = originals.match
    ;(prisma as { systemLog: unknown }).systemLog = originals.systemLog
    ;(prisma as { $transaction: unknown }).$transaction = originals.$transaction
  }
}

test('finishing a match stops playback without deleting its stream', () => {
  const update = buildFinishedMatchStreamUpdate()

  assert.deepEqual(update, { enabled: false, status: 'OFFLINE' })
  assert.equal('deletedAt' in update, false, 'a finished match must keep its stream for the whole retention window')
})

test('the retention window is unchanged: 30 minutes, extendable but never shorter', () => {
  assert.equal(FINISHED_MATCH_MIN_RETENTION_MINUTES, 30)
  assert.equal(resolveFinishedMatchRetentionMinutes(undefined), 30)
  assert.equal(resolveFinishedMatchRetentionMinutes('15'), 30, 'a shorter configured value cannot shorten the product rule')
  assert.equal(resolveFinishedMatchRetentionMinutes('45'), 45)
})

test('both finish paths use the shared update instead of deleting the stream', () => {
  const automation = readSource('services/matchAutomation.service.ts')
  const adminMatches = readSource('modules/admin/admin.matches.controller.ts')

  for (const [name, source] of [['matchAutomation.service.ts', automation], ['admin.matches.controller.ts', adminMatches]] as const) {
    assert.match(source, /buildFinishedMatchStreamUpdate\(\)/, `${name} must apply the shared finished-match stream update`)
  }

  // The auto-finish transaction is the whole `matchesToFinish` block: no `deletedAt` may creep back in.
  const autoFinishBlock = automation.slice(automation.indexOf('matchesToFinish'), automation.indexOf('const cleanupCutoff'))
  assert.ok(autoFinishBlock.includes('buildFinishedMatchStreamUpdate()'))
  assert.doesNotMatch(autoFinishBlock, /deletedAt:\s*now/, 'auto-finishing a match must not mark its streams deleted')

  // The admin status update's FINISHED branch is the only place there that stops playback.
  const statusBranch = adminMatches.slice(adminMatches.indexOf("if (status === 'FINISHED')"), adminMatches.indexOf('return tx.match.update', adminMatches.indexOf("if (status === 'FINISHED')")))
  assert.ok(statusBranch.includes('buildFinishedMatchStreamUpdate()'))
  assert.doesNotMatch(statusBranch, /deletedAt:\s*new Date\(\)/, 'marking a match finished must not delete its streams')
})

test('the retention cleanup deletes the match, which removes its streams through the cascade', async () => {
  const streams = [{ id: 'stream-1', logo: 'https://cdn.example.com/s1.png' }, { id: 'stream-2', logo: null }]
  const harness = await withCleanupDatabase(
    { match: { id: MATCH_ID, status: 'FINISHED', homeTeamLogo: null, awayTeamLogo: null, streams } },
    async (calls) => {
      const result = await cleanupMatch(MATCH_ID, 'FINISHED_RETENTION_EXPIRED')

      assert.equal(result.deleted, true)
      assert.equal(result.streamCount, 2, 'the result reports the streams that went with the match')
    },
  )

  // One transactional delete of the match row: `Stream_matchId_fkey ON DELETE CASCADE` removes exactly
  // that match's streams, and nothing else is issued.
  assert.deepEqual(harness.calls.map((call) => `${call.model}.${call.method}`), ['match.findUnique', 'match.delete'])
  assert.deepEqual(harness.calls[1].args, { where: { id: MATCH_ID } })
  assert.equal(harness.calls.some((call) => call.model !== 'match'), false, 'no other table is written')
})

test('a rerun after the match is already gone is a safe no-op', async () => {
  const harness = await withCleanupDatabase({ match: null }, async () => {
    const result = await cleanupMatch(MATCH_ID, 'FINISHED_RETENTION_EXPIRED')
    assert.deepEqual(result, { deleted: false, streamCount: 0, assetCount: 0 })
  })

  assert.equal(harness.calls.some((call) => call.method === 'delete'), false, 'an idempotent rerun must not attempt a delete')
})

test('a lost race with another cleanup is treated as already deleted', async () => {
  const { Prisma } = await import('@prisma/client')
  const missing = new Prisma.PrismaClientKnownRequestError('Record to delete does not exist.', { code: 'P2025', clientVersion: 'test' })

  await withCleanupDatabase({ deleteError: missing }, async () => {
    const result = await cleanupMatch(MATCH_ID, 'FINISHED_RETENTION_EXPIRED')
    assert.equal(result.deleted, false)
  })
})

test('an unexpected database failure propagates instead of being swallowed', async () => {
  await withCleanupDatabase({ deleteError: Object.assign(new Error('connection terminated'), { code: 'P1001' }) }, async () => {
    await assert.rejects(() => cleanupMatch(MATCH_ID, 'FINISHED_RETENTION_EXPIRED'), /connection terminated/)
  })
})

test('a rejected match is never purged, so its stream survives with it', async () => {
  const harness = await withCleanupDatabase(
    { match: { id: MATCH_ID, status: 'REJECTED', homeTeamLogo: null, awayTeamLogo: null, streams: [{ id: 's', logo: null }] } },
    async () => {
      const result = await cleanupMatch(MATCH_ID, 'FINISHED_RETENTION_EXPIRED')
      assert.deepEqual(result, { deleted: false, streamCount: 0, assetCount: 0 })
    },
  )

  assert.equal(harness.calls.some((call) => call.method === 'delete'), false)
})

test('the cleanup never touches a channel or an independently managed stream', async () => {
  // The service only ever addresses the match row; channels are a separate relation
  // (`Stream_channelId_fkey … ON DELETE SET NULL`) and are never part of a match deletion.
  const source = readSource('services/match-cleanup.service.ts')

  assert.doesNotMatch(source, /prisma\.channel/, 'match cleanup must not write to Channel')
  assert.doesNotMatch(source, /stream\.(deleteMany|delete)\(/, 'streams are removed by the cascade, not by an explicit delete')
})
