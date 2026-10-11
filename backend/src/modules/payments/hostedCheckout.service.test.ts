import assert from 'node:assert/strict'
import { test } from 'node:test'

process.env.JWT_SECRET ??= 'hosted-checkout-test-secret'
process.env.JWT_REFRESH_SECRET ??= 'hosted-checkout-test-refresh-secret'

const { prisma } = await import('../../core/prisma.js')
const { ZiniPayCheckoutFailure } = await import('./zinipay.checkout.client.js')
const { verifyHostedCheckout, startHostedCheckout } = await import('./hostedCheckout.service.js')

/**
 * The rules that decide whether Premium is activated: a completed invoice that matches this payment exactly,
 * and a claim that can only be won once.
 *
 * The Prisma delegates and the provider calls are stand-ins, because what is asserted here is the decision
 * logic: what is written when the provider says COMPLETED, what is refused when the payment does not match,
 * and that a pending or unreachable provider never activates anything.
 */

const ENV = {
  ZINIPAY_API_KEY: 'brand-key-for-tests',
  ZINIPAY_PAYMENT_BASE_URL: 'https://api.example.test/v1/payment',
  FRONTEND_URL: 'https://app.example.test',
  BASE_URL: 'https://api.example.test',
} as NodeJS.ProcessEnv

interface PaymentRecord {
  id: string
  userId: string
  status: string
  amount: string
  currency: string
  providerPaymentId: string | null
  transactionId: string
  providerCheckout: unknown
  subscriptionPlanId: string | null
  subscriptionPlan: { name: string; durationDays: number } | null
  verificationResult?: string | null
  deletedAt?: Date | null
}

interface SubscriptionRecord {
  id: string
  userId: string
  expiresAt: Date
  planId: string
}

function installFakePaymentTable(rows: PaymentRecord[]) {
  const payment = prisma.payment as unknown as Record<string, unknown>
  const original = { findFirst: payment.findFirst, update: payment.update, updateMany: payment.updateMany }

  payment.findFirst = async (args: { where: { id?: string } }) => rows.find((entry) => entry.id === args.where.id) ?? null
  payment.update = async (args: { where: { id: string }; data: Record<string, unknown> }) => {
    const row = rows.find((entry) => entry.id === args.where.id)
    if (row) Object.assign(row, args.data)
    return row ?? null
  }
  payment.updateMany = async (args: { where: { id: string; status?: { in?: string[] } }; data: Record<string, unknown> }) => {
    const row = rows.find((entry) => entry.id === args.where.id)
    const allowed = args.where.status?.in
    if (!row || (allowed && !allowed.includes(row.status))) return { count: 0 }
    Object.assign(row, args.data)
    return { count: 1 }
  }

  return {
    restore: () => {
      payment.findFirst = original.findFirst
      payment.update = original.update
      payment.updateMany = original.updateMany
    },
  }
}

function installFakeTransaction(state: { subscriptions: SubscriptionRecord[]; notifications: unknown[]; userRoles: unknown[] }) {
  const original = prisma.$transaction
  const payment = prisma.payment as unknown as Record<string, unknown>

  prisma.$transaction = (async (callback: (tx: unknown) => Promise<unknown>) => {
    const tx = {
      // The compare-and-set is the real one, patched by installFakePaymentTable.
      payment: { updateMany: payment.updateMany, update: payment.update },
      subscription: {
        findFirst: async () => state.subscriptions[0] ?? null,
        create: async (args: { data: Record<string, unknown> }) => {
          const created = { id: `sub-${state.subscriptions.length + 1}`, ...(args.data as object) } as SubscriptionRecord
          state.subscriptions.push(created)
          return created
        },
        update: async (args: { where: { id: string }; data: Record<string, unknown> }) => {
          const row = state.subscriptions.find((entry) => entry.id === args.where.id)
          if (row) Object.assign(row, args.data)
          return row
        },
      },
      role: { findUnique: async () => ({ id: 'role-premium' }) },
      userRole: { upsert: async (args: { create: unknown }) => { state.userRoles.push(args.create); return args.create } },
      notification: { create: async (args: { data: unknown }) => { state.notifications.push(args.data); return args.data } },
    }
    return callback(tx)
  }) as unknown as typeof prisma.$transaction

  return { restore: () => { prisma.$transaction = original } }
}

const PENDING_PAYMENT: PaymentRecord = {
  id: 'payment-1',
  userId: 'user-1',
  status: 'PENDING',
  amount: '300',
  currency: 'BDT',
  providerPaymentId: 'INVOICE_ID',
  transactionId: 'SZBD-abc123',
  providerCheckout: { url: 'https://secure.zinipay.com/payment/INVOICE_ID', lastCheckedAt: null, lastStatus: null },
  subscriptionPlanId: 'plan-1',
  subscriptionPlan: { name: 'Monthly', durationDays: 30 },
}

interface FakeCheck {
  status: 'PENDING' | 'COMPLETED' | 'FAILED'
  amount?: number | null
  paymentMethod?: string | null
  transactionId?: string | null
  merchantReference?: string | null
  metadata?: Record<string, unknown> | null
}

const completedInvoice = (overrides: Partial<FakeCheck> = {}): FakeCheck => ({
  status: 'COMPLETED',
  amount: 300,
  paymentMethod: 'bkash',
  transactionId: 'TXN123456789',
  merchantReference: 'SZBD-abc123',
  metadata: { paymentId: 'payment-1', userId: 'user-1', planId: 'plan-1' },
  ...overrides,
})

function fakeProvider(checks: Array<{ invoiceId: string; result: FakeCheck | Error }>) {
  const calls: string[] = []
  let index = 0
  const verifyInvoice = (async ({ invoiceId }: { invoiceId: string }) => {
    calls.push(invoiceId)
    const next = checks[Math.min(index, checks.length - 1)]
    index += 1
    if (next.result instanceof Error) throw next.result
    return next.result
  }) as never
  return { calls, verifyInvoice }
}

function arrange(records: PaymentRecord[]) {
  const payment = installFakePaymentTable(records)
  const state = { subscriptions: [] as SubscriptionRecord[], notifications: [] as unknown[], userRoles: [] as unknown[] }
  const transaction = installFakeTransaction(state)
  return { payment, state, transaction, restore: () => { payment.restore(); transaction.restore() } }
}

test('a completed invoice that matches the payment activates premium exactly once', async () => {
  const rows = [{ ...PENDING_PAYMENT }]
  const { state, restore } = arrange(rows)
  const provider = fakeProvider([{ invoiceId: 'INVOICE_ID', result: completedInvoice() }])

  try {
    const result = await verifyHostedCheckout({ paymentId: 'payment-1', userId: 'user-1' }, { env: ENV, verifyInvoice: provider.verifyInvoice })

    assert.equal(result.status, 'COMPLETED')
    assert.equal(rows[0].status, 'APPROVED')
    assert.equal(rows[0].verificationResult, 'zinipay-invoice-completed')
    assert.equal(state.subscriptions.length, 1)
    assert.equal(state.notifications.length, 1)
    assert.equal(state.userRoles.length, 1)
    assert.deepEqual(provider.calls, ['INVOICE_ID'], 'the invoice is checked exactly once')
  } finally {
    restore()
  }
})

test('a payment that belongs to somebody else is reported as missing and never checked', async () => {
  const rows = [{ ...PENDING_PAYMENT }]
  const { restore } = arrange(rows)
  const provider = fakeProvider([])

  try {
    await assert.rejects(
      verifyHostedCheckout({ paymentId: 'payment-1', userId: 'someone-else' }, { env: ENV, verifyInvoice: provider.verifyInvoice }),
      (error: { statusCode?: number }) => error.statusCode === 404,
    )
    assert.equal(provider.calls.length, 0, 'another customer must not be able to spend a provider request')
  } finally {
    restore()
  }
})

test('an already activated payment is reported as completed without another provider call', async () => {
  const rows = [{ ...PENDING_PAYMENT, status: 'APPROVED' }]
  const { restore } = arrange(rows)
  const provider = fakeProvider([])

  try {
    const result = await verifyHostedCheckout({ paymentId: 'payment-1', userId: 'user-1' }, { env: ENV, verifyInvoice: provider.verifyInvoice })

    assert.equal(result.status, 'COMPLETED')
    assert.equal(provider.calls.length, 0)
  } finally {
    restore()
  }
})

test('a completed invoice for a different amount never activates premium', async () => {
  const rows = [{ ...PENDING_PAYMENT }]
  const { state, restore } = arrange(rows)
  const provider = fakeProvider([{ invoiceId: 'INVOICE_ID', result: completedInvoice({ amount: 100 }) }])

  try {
    const result = await verifyHostedCheckout({ paymentId: 'payment-1', userId: 'user-1' }, { env: ENV, verifyInvoice: provider.verifyInvoice })

    assert.equal(result.status, 'UNKNOWN')
    assert.equal(rows[0].status, 'PENDING', 'the payment is left for a human decision, never activated')
    assert.equal(rows[0].verificationResult, 'zinipay-amount-mismatch')
    assert.equal(state.subscriptions.length, 0)
  } finally {
    restore()
  }
})

test('a completed invoice for a different merchant reference never activates premium', async () => {
  const rows = [{ ...PENDING_PAYMENT }]
  const { state, restore } = arrange(rows)
  const provider = fakeProvider([{ invoiceId: 'INVOICE_ID', result: completedInvoice({ merchantReference: 'SZBD-other' }) }])

  try {
    const result = await verifyHostedCheckout({ paymentId: 'payment-1', userId: 'user-1' }, { env: ENV, verifyInvoice: provider.verifyInvoice })

    assert.equal(result.status, 'UNKNOWN')
    assert.equal(rows[0].verificationResult, 'zinipay-reference-mismatch')
    assert.equal(state.subscriptions.length, 0)
  } finally {
    restore()
  }
})

test('a completed invoice whose metadata belongs to another payment never activates premium', async () => {
  const rows = [{ ...PENDING_PAYMENT }]
  const { state, restore } = arrange(rows)
  const provider = fakeProvider([{ invoiceId: 'INVOICE_ID', result: completedInvoice({ metadata: { paymentId: 'payment-999' } }) }])

  try {
    const result = await verifyHostedCheckout({ paymentId: 'payment-1', userId: 'user-1' }, { env: ENV, verifyInvoice: provider.verifyInvoice })

    assert.equal(result.status, 'UNKNOWN')
    assert.equal(rows[0].verificationResult, 'zinipay-metadata-mismatch')
    assert.equal(state.subscriptions.length, 0)
  } finally {
    restore()
  }
})

test('a pending invoice keeps the payment pending and activates nothing', async () => {
  const rows = [{ ...PENDING_PAYMENT }]
  const { state, restore } = arrange(rows)
  const provider = fakeProvider([{ invoiceId: 'INVOICE_ID', result: completedInvoice({ status: 'PENDING', paymentMethod: null, transactionId: null }) }])

  try {
    const result = await verifyHostedCheckout({ paymentId: 'payment-1', userId: 'user-1' }, { env: ENV, verifyInvoice: provider.verifyInvoice })

    assert.equal(result.status, 'PENDING')
    assert.equal(rows[0].status, 'PENDING')
    assert.equal(state.subscriptions.length, 0)
    assert.equal((rows[0].providerCheckout as { lastStatus: string }).lastStatus, 'PENDING')
  } finally {
    restore()
  }
})

test('a check made moments ago is not repeated at the provider', async () => {
  const rows = [{ ...PENDING_PAYMENT, providerCheckout: { url: null, lastCheckedAt: new Date().toISOString(), lastStatus: 'PENDING' } }]
  const { restore } = arrange(rows)
  const provider = fakeProvider([])

  try {
    const result = await verifyHostedCheckout({ paymentId: 'payment-1', userId: 'user-1' }, { env: ENV, verifyInvoice: provider.verifyInvoice })

    assert.equal(result.status, 'PENDING')
    assert.equal(provider.calls.length, 0, 'a page refresh must not become a provider request')
  } finally {
    restore()
  }
})

test('a failed invoice marks the payment failed without activating premium', async () => {
  const rows = [{ ...PENDING_PAYMENT }]
  const { state, restore } = arrange(rows)
  const provider = fakeProvider([{ invoiceId: 'INVOICE_ID', result: completedInvoice({ status: 'FAILED', paymentMethod: null, transactionId: null }) }])

  try {
    const result = await verifyHostedCheckout({ paymentId: 'payment-1', userId: 'user-1' }, { env: ENV, verifyInvoice: provider.verifyInvoice })

    assert.equal(result.status, 'FAILED')
    assert.equal(rows[0].status, 'FAILED')
    assert.equal(state.subscriptions.length, 0)
  } finally {
    restore()
  }
})

test('a provider that cannot be reached is reported as unknown, never as failed or paid', async () => {
  const rows = [{ ...PENDING_PAYMENT }]
  const { restore } = arrange(rows)
  const provider = fakeProvider([{ invoiceId: 'INVOICE_ID', result: new ZiniPayCheckoutFailure('timeout', null, 'timeout') }])

  try {
    const result = await verifyHostedCheckout({ paymentId: 'payment-1', userId: 'user-1' }, { env: ENV, verifyInvoice: provider.verifyInvoice })

    assert.equal(result.status, 'UNKNOWN')
    assert.equal(rows[0].status, 'PENDING', 'an unknown answer must not change what the customer paid for')
    assert.equal((rows[0].providerCheckout as { lastStatus: string }).lastStatus, 'UNKNOWN')
  } finally {
    restore()
  }
})

test('an invoice the provider no longer knows is reported as unknown rather than as a failure', async () => {
  const rows = [{ ...PENDING_PAYMENT }]
  const { restore } = arrange(rows)
  const provider = fakeProvider([{ invoiceId: 'INVOICE_ID', result: new ZiniPayCheckoutFailure('not-found', 404, 'not found or expired') }])

  try {
    const result = await verifyHostedCheckout({ paymentId: 'payment-1', userId: 'user-1' }, { env: ENV, verifyInvoice: provider.verifyInvoice })

    assert.equal(result.status, 'UNKNOWN')
    assert.match(result.message, /no longer recognises/)
    assert.equal(rows[0].status, 'PENDING')
  } finally {
    restore()
  }
})

test('a second caller racing the same payment reports the state the winner produced', async () => {
  const rows = [{ ...PENDING_PAYMENT }]
  const { state, restore } = arrange(rows)
  const provider = fakeProvider([{ invoiceId: 'INVOICE_ID', result: completedInvoice() }])
  const payment = prisma.payment as unknown as Record<string, unknown>
  const originalUpdateMany = payment.updateMany

  try {
    // Another writer wins between the read and the claim, which is what a webhook racing the return page does.
    payment.updateMany = async () => ({ count: 0 })

    const result = await verifyHostedCheckout({ paymentId: 'payment-1', userId: 'user-1' }, { env: ENV, verifyInvoice: provider.verifyInvoice })

    assert.equal(result.status, 'COMPLETED', 'the losing caller reports the state the winner produced')
    assert.equal(state.subscriptions.length, 0, 'the loser activates nothing')
  } finally {
    payment.updateMany = originalUpdateMany
    restore()
  }
})

test('a session that already exists for the same plan is resumed instead of invoiced again', async () => {
  const rows = [{ ...PENDING_PAYMENT, providerCheckout: { url: 'https://secure.zinipay.com/payment/INVOICE_ID' } }]
  const payment = prisma.payment as unknown as Record<string, unknown>
  const plan = prisma.subscriptionPlan as unknown as Record<string, unknown>
  const originalFindFirst = payment.findFirst
  const originalPlanFindUnique = plan.findUnique
  const createCalls: unknown[] = []

  payment.findFirst = async () => rows[0]
  plan.findUnique = async () => ({ id: 'plan-1', name: 'Monthly', price: { toString: () => '300' }, durationDays: 30, status: 'ACTIVE', deletedAt: null })

  try {
    const session = await startHostedCheckout(
      { userId: 'user-1', subscriptionPlanId: 'plan-1', customerEmail: 'a@b.test', customerName: null },
      {
        env: ENV,
        createInvoice: (async (params: unknown) => {
          createCalls.push(params)
          return { invoiceId: 'X', paymentUrl: 'https://secure.zinipay.com/payment/X', environment: null }
        }) as never,
      },
    )

    assert.equal(session.reused, true)
    assert.equal(session.paymentUrl, 'https://secure.zinipay.com/payment/INVOICE_ID')
    assert.equal(createCalls.length, 0, 'resuming a session must not create another invoice')
  } finally {
    payment.findFirst = originalFindFirst
    plan.findUnique = originalPlanFindUnique
  }
})

test('the hosted checkout refuses to start when the integration is not configured', async () => {
  await assert.rejects(
    startHostedCheckout(
      { userId: 'user-1', subscriptionPlanId: 'plan-1', customerEmail: 'a@b.test', customerName: null },
      { env: {} as NodeJS.ProcessEnv },
    ),
    (error: { statusCode?: number }) => error.statusCode === 503,
  )
})

test('the hosted checkout refuses an account without an email address, which the provider requires', async () => {
  await assert.rejects(
    startHostedCheckout(
      { userId: 'user-1', subscriptionPlanId: 'plan-1', customerEmail: null, customerName: null },
      { env: ENV },
    ),
    (error: { statusCode?: number; message: string }) => error.statusCode === 400 && /email/.test(error.message),
  )
})
