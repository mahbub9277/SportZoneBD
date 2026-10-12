import assert from 'node:assert/strict'
import { test } from 'node:test'

process.env.JWT_SECRET ??= 'zinipay-callback-test-secret'
process.env.JWT_REFRESH_SECRET ??= 'zinipay-callback-test-refresh-secret'

const { prisma } = await import('../../core/prisma.js')
const { handleZiniPayWebhook } = await import('./payment.service.js')

/**
 * The provider callback, in the shape ZiniPay actually calls it.
 *
 * ZiniPay documents its hosted-invoice callback payload as a JSON body *or* query parameters, and production
 * shows `GET …/payments/webhook/zinipay?…` — so the query form has to work. Every test here also asserts the
 * security property that makes the callback safe to expose without a signature: the payload never decides the
 * outcome, the provider's own verification does, and a callback alone can never activate premium.
 */

const ENV = {
  ZINIPAY_API_KEY: 'brand-key-for-tests',
  ZINIPAY_PAYMENT_BASE_URL: 'https://api.example.test/v1/payment',
  FRONTEND_URL: 'https://sport-zone-bd.vercel.app',
  BASE_URL: 'https://sportzonebd-1.onrender.com',
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
}

/** The provider verification answers this test controls, and the calls it receives. */
function fakeProvider(results: Array<Record<string, unknown> | Error>) {
  const calls: string[] = []
  let index = 0
  const verifyInvoice = (async ({ invoiceId }: { invoiceId: string }) => {
    calls.push(invoiceId)
    const next = results[Math.min(index, results.length - 1)]
    index += 1
    if (next instanceof Error) throw next
    return next
  }) as never
  return { calls, verifyInvoice }
}

const PENDING_PAYMENT: PaymentRecord = {
  id: 'payment-1',
  userId: 'user-1',
  status: 'PENDING',
  amount: '15',
  currency: 'BDT',
  providerPaymentId: 'test_invoice_0001',
  transactionId: 'SZBD-callback1',
  providerCheckout: { url: 'https://secure.zinipay.com/payment/test_invoice_0001', lastCheckedAt: null, lastStatus: null, lastFailure: null },
  subscriptionPlanId: 'plan-1',
  subscriptionPlan: { name: 'Monthly', durationDays: 30 },
}

function arrange(rows: PaymentRecord[]) {
  const payment = prisma.payment as unknown as Record<string, unknown>
  const original = { findFirst: payment.findFirst, update: payment.update, updateMany: payment.updateMany, transaction: prisma.$transaction }
  const state = { subscriptions: [] as unknown[], notifications: [] as unknown[], userRoles: [] as unknown[] }

  payment.findFirst = async (args: { where: { id?: string; OR?: Array<Record<string, unknown>> } }) => {
    if (args.where.id) return rows.find((row) => row.id === args.where.id) ?? null
    // The callback lookup matches an invoice id or the merchant reference; return the row either way.
    return rows[0] ?? null
  }
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

  prisma.$transaction = (async (callback: (tx: unknown) => Promise<unknown>) => callback({
    payment: { updateMany: payment.updateMany, update: payment.update },
    subscription: {
      findFirst: async () => null,
      create: async (args: { data: unknown }) => { state.subscriptions.push(args.data); return { id: 'sub-1', ...(args.data as object) } },
      update: async () => null,
    },
    role: { findUnique: async () => ({ id: 'role-premium' }) },
    userRole: { upsert: async (args: { create: unknown }) => { state.userRoles.push(args.create); return args.create } },
    notification: { create: async (args: { data: unknown }) => { state.notifications.push(args.data); return args.data } },
  })) as unknown as typeof prisma.$transaction

  return {
    state,
    restore: () => {
      payment.findFirst = original.findFirst
      payment.update = original.update
      payment.updateMany = original.updateMany
      prisma.$transaction = original.transaction
    },
  }
}

const completed = (overrides: Record<string, unknown> = {}) => ({
  status: 'COMPLETED',
  amount: 15,
  paymentMethod: 'bkash',
  transactionId: 'TXN123',
  merchantReference: 'SZBD-callback1',
  metadata: { paymentId: 'payment-1' },
  ...overrides,
})

test('a query-parameter callback (the GET form) verifies the invoice and activates once', async () => {
  const rows = [{ ...PENDING_PAYMENT }]
  const db = arrange(rows)
  const provider = fakeProvider([completed()])

  try {
    // Exactly the shape production showed: query parameters only, no body.
    const result = await handleZiniPayWebhook(
      { body: undefined, query: { invoice_id: 'test_invoice_0001', status: 'true' } },
      { env: ENV, verifyInvoice: provider.verifyInvoice },
    )

    assert.equal(result.message, 'Checked: COMPLETED.')
    assert.deepEqual(provider.calls, ['test_invoice_0001'], 'the invoice is verified with the provider')
    assert.equal(rows[0].status, 'APPROVED')
    assert.equal(rows[0].verificationResult, 'zinipay-invoice-completed')
    assert.equal(db.state.subscriptions.length, 1)
    assert.equal(db.state.userRoles.length, 1)
  } finally {
    db.restore()
  }
})

test('the same callback twice activates premium exactly once', async () => {
  const rows = [{ ...PENDING_PAYMENT }]
  const db = arrange(rows)
  const provider = fakeProvider([completed()])

  try {
    const first = await handleZiniPayWebhook(
      { body: undefined, query: { invoice_id: 'test_invoice_0001' } },
      { env: ENV, verifyInvoice: provider.verifyInvoice },
    )
    const second = await handleZiniPayWebhook(
      { body: undefined, query: { invoice_id: 'test_invoice_0001' } },
      { env: ENV, verifyInvoice: provider.verifyInvoice },
    )

    assert.equal(first.message, 'Checked: COMPLETED.')
    assert.equal(second.message, 'Checked: COMPLETED.', 'a retry is answered truthfully')
    assert.equal(db.state.subscriptions.length, 1, 'the subscription is created once')
    assert.equal(db.state.notifications.length, 1, 'the customer is told once')
    assert.equal(provider.calls.length, 1, 'an already decided payment is not re-checked at the provider')
  } finally {
    db.restore()
  }
})

test('a callback claiming success cannot activate anything on its own', async () => {
  const rows = [{ ...PENDING_PAYMENT }]
  const db = arrange(rows)
  // The provider still says PENDING, whatever the callback claims.
  const provider = fakeProvider([{ status: 'PENDING', amount: 15, paymentMethod: null, transactionId: null, merchantReference: 'SZBD-callback1', metadata: null }])

  try {
    const result = await handleZiniPayWebhook(
      { body: undefined, query: { invoice_id: 'test_invoice_0001', status: 'true', val_id: 'SZBD-callback1' } },
      { env: ENV, verifyInvoice: provider.verifyInvoice },
    )

    assert.equal(result.message, 'Checked: PENDING.')
    assert.equal(rows[0].status, 'PENDING')
    assert.equal(db.state.subscriptions.length, 0, 'a callback status is never proof of payment')
  } finally {
    db.restore()
  }
})

test('a callback claiming failure cannot undo the provider’s own confirmation', async () => {
  const rows = [{ ...PENDING_PAYMENT }]
  const db = arrange(rows)
  const provider = fakeProvider([completed()])

  try {
    const result = await handleZiniPayWebhook(
      { body: { invoice_id: 'test_invoice_0001', status: 'false' }, query: {} },
      { env: ENV, verifyInvoice: provider.verifyInvoice },
    )

    assert.equal(result.message, 'Checked: COMPLETED.', 'the provider, not the payload, decides')
    assert.equal(rows[0].status, 'APPROVED')
  } finally {
    db.restore()
  }
})

test('a callback for an unknown invoice is ignored without any provider call', async () => {
  const payment = prisma.payment as unknown as Record<string, unknown>
  const original = payment.findFirst
  payment.findFirst = async () => null
  const provider = fakeProvider([completed()])

  try {
    const result = await handleZiniPayWebhook(
      { body: undefined, query: { invoice_id: 'test_invoice_unknown' } },
      { env: ENV, verifyInvoice: provider.verifyInvoice },
    )

    assert.equal(result.message, 'Ignored: unknown payment.')
    assert.equal(provider.calls.length, 0, 'an unknown reference must not spend a provider request')
  } finally {
    payment.findFirst = original
  }
})

test('a callback that carries no usable reference is ignored', async () => {
  const provider = fakeProvider([completed()])

  for (const query of [{}, { status: 'true' }, { invoice_id: '   ' }, { invoice_id: ['a', 'b'] }]) {
    const result = await handleZiniPayWebhook({ body: undefined, query }, { env: ENV, verifyInvoice: provider.verifyInvoice })
    assert.equal(result.message, 'Ignored: no invoice reference.', `${JSON.stringify(query)} should be ignored`)
  }

  assert.equal(provider.calls.length, 0)
})

test('a provider outage during a callback leaves the payment pending', async () => {
  const rows = [{ ...PENDING_PAYMENT }]
  const db = arrange(rows)
  const { ZiniPayCheckoutFailure } = await import('./zinipay.checkout.client.js')
  const provider = fakeProvider([new ZiniPayCheckoutFailure('timeout', null, 'timeout')])

  try {
    const result = await handleZiniPayWebhook(
      { body: undefined, query: { invoice_id: 'test_invoice_0001' } },
      { env: ENV, verifyInvoice: provider.verifyInvoice },
    )

    assert.equal(result.message, 'Checked: UNKNOWN.')
    assert.equal(rows[0].status, 'PENDING', 'an unanswered callback never becomes a success')
  } finally {
    db.restore()
  }
})
