import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  MODERATION_ACTIONS,
  MODERATION_AUDIT_KIND,
  buildModerationMeta,
  moderationActionOptions,
  moderationLogFilter,
  readModerationEvent,
  recordModerationEvent,
  sanitizeAuditState,
} from './moderationAudit.js'

test('a moderation event records the actor it was given and never a client-supplied one', () => {
  const meta = buildModerationMeta({
    action: 'report.status.updated',
    actorId: 'staff-1',
    entityId: 'report-1',
    before: { status: 'OPEN' },
    after: { status: 'RESOLVED' },
  })

  assert.equal(meta.kind, MODERATION_AUDIT_KIND)
  assert.equal(meta.actorId, 'staff-1')
  assert.equal(meta.action, 'report.status.updated')
  assert.equal(meta.outcome, 'success')
  assert.equal(meta.entityType, 'report')
  assert.deepEqual(meta.before, { status: 'OPEN' })
  assert.deepEqual(meta.after, { status: 'RESOLVED' })
})

test('an event without an authenticated actor is refused instead of written anonymously', () => {
  assert.throws(() => buildModerationMeta({ action: 'report.status.updated', actorId: '', entityId: 'r1' }))
})

test('sensitive fields are stripped from recorded state and long values are truncated', () => {
  const state = sanitizeAuditState({
    status: 'APPROVED',
    passwordHash: '$2b$10$secret',
    refreshToken: 'token',
    accessToken: 'token',
    verificationOtp: '123456',
    providerSecret: 'shh',
    cookie: 'value',
    note: 'x'.repeat(600),
    pending: null,
  })

  assert.deepEqual(Object.keys(state ?? {}).sort(), ['note', 'pending', 'status'])
  assert.equal((state?.note as string).length, 501)
  assert.ok((state?.note as string).endsWith('…'))
})

test('a failed operation is recorded with a warning level and its outcome', async () => {
  const meta = buildModerationMeta({
    action: 'email.campaign.sent',
    actorId: 'staff-2',
    entityId: 'campaign-1',
    outcome: 'failure',
  })
  assert.equal(meta.outcome, 'failure')

  const seen: Array<{ message: string; level: string; meta: unknown }> = []
  const client = {
    systemLog: {
      create: async ({ data }: { data: { message: string; level: string; meta: unknown } }) => {
        seen.push({ message: data.message, level: data.level, meta: data.meta })
        return { id: 'log-1' }
      },
    },
  }

  const id = await recordModerationEvent(
    { action: 'email.campaign.sent', actorId: 'staff-2', entityId: 'campaign-1', outcome: 'failure' },
    client as never,
  )

  assert.equal(id, 'log-1')
  assert.equal(seen[0].level, 'warn')
  assert.equal(seen[0].message, MODERATION_ACTIONS['email.campaign.sent'].message)
})

test('every moderation event carries the kind marker the audit view filters on', () => {
  const filter = moderationLogFilter({})
  assert.deepEqual(filter, { AND: [{ meta: { path: ['kind'], equals: MODERATION_AUDIT_KIND } }] })
})

test('the audit filter translates every supported filter into a meta condition', () => {
  const from = new Date('2026-01-01T00:00:00.000Z')
  const to = new Date('2026-02-01T00:00:00.000Z')
  const filter = moderationLogFilter({
    actorId: 'staff-1',
    action: 'payment.review.approved',
    outcome: 'success',
    entityType: 'payment',
    entityId: 'payment-1',
    from,
    to,
    search: 'approved',
  })

  const conditions = filter.AND as unknown[]
  assert.equal(conditions.length, 8)
  assert.deepEqual(conditions[1], { meta: { path: ['actorId'], equals: 'staff-1' } })
  assert.deepEqual(conditions[2], { meta: { path: ['action'], equals: 'payment.review.approved' } })
  assert.deepEqual(conditions[3], { meta: { path: ['outcome'], equals: 'success' } })
  assert.deepEqual(conditions[4], { meta: { path: ['entityType'], equals: 'payment' } })
  assert.deepEqual(conditions[5], { meta: { path: ['entityId'], equals: 'payment-1' } })
  assert.deepEqual(conditions[6], { createdAt: { gte: from, lte: to } })
  assert.deepEqual(conditions[7], { message: { contains: 'approved', mode: 'insensitive' } })
})

test('a stored row is read back with the facts it actually contains', () => {
  const event = readModerationEvent({
    id: 'log-9',
    message: MODERATION_ACTIONS['payment.review.rejected'].message,
    createdAt: new Date('2026-01-02T10:00:00.000Z'),
    meta: {
      kind: MODERATION_AUDIT_KIND,
      action: 'payment.review.rejected',
      outcome: 'success',
      actorId: 'staff-3',
      actorName: 'Rina',
      entityType: 'payment',
      entityId: 'payment-9',
      reason: 'Transaction ID could not be matched.',
      requestId: 'req-1',
      before: { status: 'PENDING_REVIEW' },
      after: { status: 'REJECTED' },
      details: { amount: '500' },
    },
  })

  assert.equal(event.action, 'payment.review.rejected')
  assert.equal(event.actorId, 'staff-3')
  assert.equal(event.actorName, 'Rina')
  assert.equal(event.reason, 'Transaction ID could not be matched.')
  assert.deepEqual(event.after, { status: 'REJECTED' })
  assert.equal(event.createdAt.toISOString(), '2026-01-02T10:00:00.000Z')
})

test('a row with no moderation meta degrades to what it really has', () => {
  const event = readModerationEvent({ id: 'log-2', message: 'Stream created', meta: null, createdAt: new Date() })

  assert.equal(event.action, null)
  assert.equal(event.actorId, null)
  assert.equal(event.outcome, 'success')
  assert.equal(event.before, null)
})

test('the filter vocabulary is the vocabulary of real actions', () => {
  const options = moderationActionOptions()
  assert.equal(options.length, Object.keys(MODERATION_ACTIONS).length)
  assert.deepEqual(options.map((option) => option.value), Object.keys(MODERATION_ACTIONS))
})
