import assert from 'node:assert/strict'
import { test } from 'node:test'

process.env.JWT_SECRET ??= 'payment-workflow-test-secret'
process.env.JWT_REFRESH_SECRET ??= 'payment-workflow-test-refresh-secret'

const { applyApprovedPayment, loadApprovalContext } = await import('./paymentWorkflow.js')
const { AppError } = await import('../../core/errors.js')

/**
 * The trusted finalization step both approval paths share.
 *
 * The fake transaction client is deliberately faithful about the one thing that matters: the conditional
 * update only claims a payment that is still `PENDING_REVIEW`. That is the mechanism that stops two
 * approvals — an administrator clicking twice, an administrator and the automatic verification racing, a
 * retry after a network error — from activating premium access twice or extending a subscription twice.
 */

interface FakeState {
  payments: Map<string, {
    id: string
    userId: string
    status: string
    amount: string
    currency: string
    transactionId: string
    subscriptionPlanId: string | null
    subscriptionId: string | null
    planName: string | null
    planDurationDays: number
    verificationResult: string | null
  }>
  subscriptions: Array<{ id: string; userId: string; planId: string; status: string; startedAt: Date; expiresAt: Date }>
  notifications: Array<{ userId: string; title: string; body: string }>
  premiumRoleExists: boolean
  userRoles: Array<{ userId: string; roleId: string }>
}

function createState(payment: Partial<FakeState['payments'] extends Map<string, infer T> ? T : never> = {}): FakeState {
  const base = {
    id: 'payment-1',
    userId: 'user-1',
    status: 'PENDING_REVIEW',
    amount: '300',
    currency: 'BDT',
    transactionId: 'TRX12345',
    subscriptionPlanId: 'plan-1',
    subscriptionId: null,
    planName: 'Monthly',
    planDurationDays: 30,
    verificationResult: null,
    ...payment,
  }
  return {
    payments: new Map([[base.id, base]]),
    subscriptions: [],
    notifications: [],
    premiumRoleExists: true,
    userRoles: [],
  }
}

/** A transaction client with the same conditional semantics as the real one. */
function createTx(state: FakeState) {
  return {
    payment: {
      findUnique: async ({ where }: { where: { id: string } }) => {
        const payment = state.payments.get(where.id)
        if (!payment) return null
        return {
          userId: payment.userId,
          status: payment.status,
          amount: payment.amount,
          currency: payment.currency,
          transactionId: payment.transactionId,
          subscriptionPlanId: payment.subscriptionPlanId,
          subscriptionPlan: payment.planName ? { name: payment.planName, durationDays: payment.planDurationDays } : null,
        }
      },
      updateMany: async ({ where, data }: { where: { id: string; status?: string | { in: string[] } }; data: Record<string, unknown> }) => {
        const payment = state.payments.get(where.id)
        const allowed = typeof where.status === 'string' ? [where.status] : where.status?.in
        if (!payment || (allowed && !allowed.includes(payment.status))) return { count: 0 }
        Object.assign(payment, data)
        return { count: 1 }
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const payment = state.payments.get(where.id)
        if (!payment) throw new Error('payment row missing')
        Object.assign(payment, data)
        return payment
      },
    },
    subscription: {
      findFirst: async ({ where }: { where: { userId: string } }) =>
        state.subscriptions.find((subscription) => subscription.userId === where.userId && subscription.status === 'ACTIVE') ?? null,
      create: async ({ data }: { data: { userId: string; planId: string; status: string; startedAt: Date; expiresAt: Date } }) => {
        const subscription = { id: `sub-${state.subscriptions.length + 1}`, ...data }
        state.subscriptions.push(subscription)
        return subscription
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const subscription = state.subscriptions.find((entry) => entry.id === where.id)
        if (!subscription) throw new Error('subscription row missing')
        Object.assign(subscription, data)
        return subscription
      },
    },
    role: {
      findUnique: async () => (state.premiumRoleExists ? { id: 'role-premium' } : null),
    },
    userRole: {
      upsert: async ({ create, where }: { create: { userId: string; roleId: string }; where: { userId_roleId: { userId: string; roleId: string } } }) => {
        const exists = state.userRoles.some((entry) => entry.userId === where.userId_roleId.userId)
        if (!exists) state.userRoles.push(create)
        return create
      },
    },
    notification: {
      create: async ({ data }: { data: { userId: string; title: string; body: string } }) => {
        state.notifications.push(data)
        return data
      },
    },
  }
}

test('approving a payment once creates one subscription and one notification', async () => {
  const state = createState()
  const tx = createTx(state) as never

  const context = await loadApprovalContext(tx, 'payment-1')
  const result = await applyApprovedPayment(tx, context, { reviewedBy: null, verificationResult: 'zinipay-confirmed' })

  assert.equal(state.subscriptions.length, 1)
  assert.equal(state.notifications.length, 1)
  assert.equal(state.payments.get('payment-1')?.status, 'APPROVED')
  assert.equal(state.payments.get('payment-1')?.subscriptionId, result.subscriptionId)
  assert.equal(state.userRoles.length, 1)
})

test('finalizing the same payment twice activates premium exactly once', async () => {
  const state = createState()
  const tx = createTx(state) as never

  const context = await loadApprovalContext(tx, 'payment-1')
  await applyApprovedPayment(tx, context, { reviewedBy: 'admin-1', verificationResult: 'manual-approved' })

  await assert.rejects(
    loadApprovalContext(tx, 'payment-1'),
    (error: { statusCode?: number; message: string }) => error.statusCode === 400 && /no longer pending review/.test(error.message),
    'a second approval must be refused by the payment status, not by convention',
  )

  assert.equal(state.subscriptions.length, 1)
  assert.equal(state.notifications.length, 1)
  assert.equal(state.userRoles.length, 1)
  assert.equal(state.subscriptions[0].expiresAt.getTime() > Date.now(), true)
})

test('an administrator cannot approve their own submission, and the refusal precedes every other check', async () => {
  const state = createState()
  const tx = createTx(state) as never

  await assert.rejects(
    loadApprovalContext(tx, 'payment-1', { requireDistinctActor: 'user-1' }),
    (error: { statusCode?: number; message: string }) => error.statusCode === 403 && /submitted yourself/.test(error.message),
  )

  // The self-review rule is answered first, exactly as the admin review endpoint always answered it: an
  // administrator looking at their own already-decided payment is still told it is their own submission.
  state.payments.get('payment-1')!.status = 'APPROVED'

  await assert.rejects(
    loadApprovalContext(tx, 'payment-1', { requireDistinctActor: 'user-1' }),
    (error: { statusCode?: number }) => error.statusCode === 403,
  )
})

test('a payment claimed by another writer in the meantime cannot be approved', async () => {
  const state = createState()
  const tx = createTx(state) as never
  const context = await loadApprovalContext(tx, 'payment-1')

  // Another writer wins the race between the read and the claim.
  state.payments.get('payment-1')!.status = 'APPROVED'

  await assert.rejects(
    applyApprovedPayment(tx, context, { reviewedBy: null, verificationResult: 'zinipay-confirmed' }),
    (error: { statusCode?: number; message: string }) => error.statusCode === 409,
  )
  assert.equal(state.subscriptions.length, 0, 'no subscription is created by the loser of the race')
})

test('an extension of an active subscription adds the plan duration once', async () => {
  const state = createState()
  const existingExpiry = new Date(Date.now() + 10 * 86400000)
  state.subscriptions.push({ id: 'sub-existing', userId: 'user-1', planId: 'plan-1', status: 'ACTIVE', startedAt: new Date(), expiresAt: existingExpiry })
  const tx = createTx(state) as never

  const context = await loadApprovalContext(tx, 'payment-1')
  const result = await applyApprovedPayment(tx, context, { reviewedBy: 'admin-1', verificationResult: 'manual-approved' })

  assert.equal(state.subscriptions.length, 1, 'an active subscription is extended, not duplicated')
  assert.equal(result.subscriptionId, 'sub-existing')
  const expected = new Date(existingExpiry)
  expected.setDate(expected.getDate() + 30)
  assert.equal(state.subscriptions[0].expiresAt.toISOString(), expected.toISOString())
  assert.match(state.notifications[0].title, /Extended/)
})

test('a payment without a plan cannot be approved', async () => {
  const state = createState({ subscriptionPlanId: null, planName: null })
  const tx = createTx(state) as never

  await assert.rejects(
    loadApprovalContext(tx, 'payment-1'),
    (error: { statusCode?: number; message: string }) => error.statusCode === 400,
  )
})

test('a missing premium role refuses the approval instead of granting half of it', async () => {
  const state = createState()
  state.premiumRoleExists = false
  const tx = createTx(state) as never

  const context = await loadApprovalContext(tx, 'payment-1')
  await assert.rejects(
    applyApprovedPayment(tx, context, { reviewedBy: null, verificationResult: 'zinipay-confirmed' }),
    (error: { statusCode?: number; message: string }) => error.statusCode === 500,
  )
  assert.equal(state.subscriptions.length, 1, 'the subscription write happens inside the same transaction the caller rolls back')
})
