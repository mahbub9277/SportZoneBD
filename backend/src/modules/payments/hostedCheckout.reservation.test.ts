import assert from 'node:assert/strict'
import { test } from 'node:test'

process.env.JWT_SECRET ??= 'hosted-reservation-test-secret'
process.env.JWT_REFRESH_SECRET ??= 'hosted-reservation-test-refresh-secret'

const { prisma } = await import('../../core/prisma.js')
const { ZiniPayCheckoutFailure, createZiniPayInvoice, verifyZiniPayInvoice } = await import('./zinipay.checkout.client.js')
const { startHostedCheckout } = await import('./hostedCheckout.service.js')

/**
 * Concurrent checkout requests, deterministic.
 *
 * The reservation is the payment row itself and the guarantee is a partial unique index, so these tests drive
 * the interleavings that the index and the reservation state machine have to survive: a second request while
 * the first is still calling the provider, a duplicate insert, an abandoned reservation, a provider failure,
 * and two different customers or plans. The database, the clock, the sleep and the provider are all
 * stand-ins, so nothing here depends on timing or on the network.
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
  provider: string
  providerPaymentId: string | null
  transactionId: string
  providerCheckout: unknown
  checkoutReservationAt: Date | null
  createdAt: Date
  deletedAt: Date | null
  subscriptionPlanId: string | null
  verificationResult?: string | null
}

interface FakeDatabase {
  payments: PaymentRecord[]
  created: PaymentRecord[]
  notifications: unknown[]
  subscriptions: unknown[]
  createCalls: number
  failNextInsertWithP2002: boolean
  restore: () => void
}

function installFakeDatabase(options: { payments?: PaymentRecord[]; planPrice?: string } = {}): FakeDatabase {
  const original = {
    paymentFindFirst: prisma.payment.findFirst,
    paymentUpdate: prisma.payment.update,
    paymentUpdateMany: prisma.payment.updateMany,
    transaction: prisma.$transaction,
    planFindUnique: (prisma.subscriptionPlan as unknown as Record<string, unknown>).findUnique,
  }

  const state: FakeDatabase = {
    payments: options.payments ?? [],
    created: [],
    notifications: [],
    subscriptions: [],
    createCalls: 0,
    failNextInsertWithP2002: false,
    restore: () => {
      payment.findFirst = original.paymentFindFirst
      payment.update = original.paymentUpdate
      payment.updateMany = original.paymentUpdateMany
      prisma.$transaction = original.transaction
      ;(prisma.subscriptionPlan as unknown as Record<string, unknown>).findUnique = original.planFindUnique
    },
  }

  const payment = prisma.payment as unknown as Record<string, unknown>

  const matches = (row: PaymentRecord, where: Record<string, unknown>) => {
    if (typeof where.id === 'string' && row.id !== where.id) return false
    if (typeof where.userId === 'string' && row.userId !== where.userId) return false
    if (typeof where.subscriptionPlanId === 'string' && row.subscriptionPlanId !== where.subscriptionPlanId) return false
    if (typeof where.provider === 'string' && row.provider !== where.provider) return false
    if (typeof where.status === 'string' && row.status !== where.status) return false
    if (where.status && typeof where.status === 'object' && 'in' in (where.status as object)) {
      if (!((where.status as { in: string[] }).in).includes(row.status)) return false
    }
    if (where.deletedAt === null && row.deletedAt !== null) return false
    if (where.checkoutReservationAt && typeof where.checkoutReservationAt === 'object') {
      const filter = where.checkoutReservationAt as { not?: null }
      if ('not' in filter && row.checkoutReservationAt === null) return false
    }
    if (where.providerPaymentId === null && row.providerPaymentId !== null) return false
    if (where.createdAt && typeof where.createdAt === 'object' && 'gte' in (where.createdAt as object)) {
      if (row.createdAt.getTime() < ((where.createdAt as { gte: Date }).gte).getTime()) return false
    }
    return true
  }

  payment.findFirst = async (args: { where: Record<string, unknown>; orderBy?: unknown }) => {
    const found = state.payments.filter((row) => matches(row, args.where))
    return found.length > 0 ? found[found.length - 1] : null
  }

  payment.create = async (args: { data: Record<string, unknown> }) => {
    state.createCalls += 1
    if (state.failNextInsertWithP2002) {
      state.failNextInsertWithP2002 = false
      throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002' })
    }
    const row: PaymentRecord = {
      id: `payment-${state.payments.length + 1}`,
      userId: String(args.data.userId),
      status: String(args.data.status),
      amount: String(args.data.amount),
      currency: String(args.data.currency ?? 'BDT'),
      provider: String(args.data.provider),
      providerPaymentId: (args.data.providerPaymentId as string | null) ?? null,
      transactionId: String(args.data.transactionId),
      providerCheckout: args.data.providerCheckout ?? null,
      checkoutReservationAt: (args.data.checkoutReservationAt as Date | null) ?? null,
      createdAt: args.data.createdAt instanceof Date ? (args.data.createdAt as Date) : new Date(),
      deletedAt: null,
      subscriptionPlanId: (args.data.subscriptionPlanId as string | null) ?? null,
      verificationResult: (args.data.verificationResult as string | null) ?? null,
    }
    state.payments.push(row)
    state.created.push(row)
    return { ...row, subscriptionPlan: { name: 'Monthly', price: '300', durationDays: 30 } }
  }

  payment.update = async (args: { where: { id: string }; data: Record<string, unknown> }) => {
    const row = state.payments.find((entry) => entry.id === args.where.id)
    if (row) Object.assign(row, args.data)
    return row ?? null
  }

  payment.updateMany = async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
    const rows = state.payments.filter((row) => matches(row, args.where))
    for (const row of rows) Object.assign(row, args.data)
    return { count: rows.length }
  }

  prisma.$transaction = (async (callback: (tx: unknown) => Promise<unknown>) => callback({
    payment: {
      create: payment.create,
      update: payment.update,
      updateMany: payment.updateMany,
    },
    notification: { create: async (args: { data: unknown }) => { state.notifications.push(args.data); return args.data } },
    subscription: {
      findFirst: async () => null,
      create: async (args: { data: unknown }) => { state.subscriptions.push(args.data); return { id: 'sub-1', ...(args.data as object) } },
      update: async () => null,
    },
    role: { findUnique: async () => ({ id: 'role-premium' }) },
    userRole: { upsert: async () => null },
  })) as unknown as typeof prisma.$transaction

  ;(prisma.subscriptionPlan as unknown as Record<string, unknown>).findUnique = async () => ({
    id: 'plan-1',
    name: 'Monthly',
    price: { toString: () => options.planPrice ?? '300' },
    durationDays: 30,
    status: 'ACTIVE',
    deletedAt: null,
  })

  return state
}

/** A clock and sleep that advance together, so the polling loop is exercised without real waiting. */
function fakeClock(start = new Date('2026-10-11T12:00:00.000Z')) {
  let current = start
  return {
    now: () => new Date(current.getTime()),
    sleep: async (ms: number) => { current = new Date(current.getTime() + ms) },
    advance: (ms: number) => { current = new Date(current.getTime() + ms) },
  }
}

function invoiceProvider() {
  const calls: Array<{ amount: number; merchantReference: string; redirectUrl: string; cancelUrl: string; webhookUrl: string }> = []
  let index = 0
  const createInvoice = (async (params: {
    amount: number
    merchantReference: string
    redirectUrl: string
    cancelUrl: string
    webhookUrl: string
  }) => {
    calls.push(params)
    index += 1
    return {
      invoiceId: `INVOICE-${index}`,
      paymentUrl: `https://secure.zinipay.com/payment/INVOICE-${index}`,
      environment: 'live',
    }
  }) as never
  return { calls, createInvoice }
}

const reservation = (id: string, overrides: Partial<PaymentRecord> = {}): PaymentRecord => ({
  id,
  userId: 'user-1',
  status: 'PENDING',
  amount: '300',
  currency: 'BDT',
  provider: 'zinipay',
  providerPaymentId: null,
  transactionId: `SZBD-${id}`,
  providerCheckout: { url: null, environment: null, createdAt: null, lastCheckedAt: null, lastStatus: null, lastFailure: null },
  checkoutReservationAt: new Date('2026-10-11T11:59:30.000Z'),
  createdAt: new Date('2026-10-11T11:59:30.000Z'),
  deletedAt: null,
  subscriptionPlanId: 'plan-1',
  verificationResult: 'zinipay-checkout-created',
  ...overrides,
})

test('the documented minimal provider response produces a usable session through the real parser', async () => {
  const db = installFakeDatabase()
  const clock = fakeClock()
  const invoiceId = 'test_000d0997-9f20-4989-89e9-f941d60876fa'
  const paymentUrl = `https://secure.zinipay.com/payment/${invoiceId}`
  let postedBody: Record<string, unknown> | null = null

  // The real client and the real service, with only the transport faked: this is the production shape that
  // previously failed — `{status, message, payment_url}` with no invoice id field.
  const http = {
    post: async (_url: string, body: unknown) => {
      postedBody = body as Record<string, unknown>
      return { status: 200, data: { status: true, message: 'Invoice created successfully.', payment_url: paymentUrl } }
    },
  }
  const createInvoice = ((params: Parameters<typeof createZiniPayInvoice>[0], deps: { env?: NodeJS.ProcessEnv }) =>
    createZiniPayInvoice(params, { env: deps.env, http })) as never

  try {
    const session = await startHostedCheckout(
      { userId: 'user-1', subscriptionPlanId: 'plan-1', customerEmail: 'a@b.test', customerName: 'A' },
      { env: ENV, createInvoice, now: clock.now, sleep: clock.sleep },
    )

    assert.equal(session.reused, false)
    assert.equal(session.paymentUrl, paymentUrl, 'the validated hosted page is what the browser is sent to')
    assert.equal(db.payments[0].providerPaymentId, invoiceId, 'the invoice id is read out of the payment url and stored')
    assert.equal(db.payments[0].status, 'PENDING')
    assert.equal(db.payments[0].verificationResult, 'zinipay-checkout-created')
    assert.equal((postedBody as Record<string, unknown> | null)?.val_id, db.payments[0].transactionId, 'our own reference is the merchant reference, never the invoice id')

    // And verification then uses the stored invoice id, so the session is reconcilable later.
    let verifyBody: Record<string, unknown> | null = null
    const verifyHttp = {
      post: async (_url: string, body: unknown) => {
        verifyBody = body as Record<string, unknown>
        return { status: 200, data: { invoice_id: invoiceId, val_id: db.payments[0].transactionId, amount: 300, status: 'PENDING' } }
      },
    }
    const check = await verifyZiniPayInvoice({ invoiceId: db.payments[0].providerPaymentId as string }, { env: ENV, http: verifyHttp })

    assert.equal(check.status, 'PENDING')
    assert.deepEqual(verifyBody, { invoice_id: invoiceId })
  } finally {
    db.restore()
  }
})

test('a documented minimal response with an unusable payment path fails safely and records the shape', async () => {
  const db = installFakeDatabase()
  const clock = fakeClock()

  // The provider answered successfully, but the hosted page carries no identifier this platform can verify.
  const http = {
    post: async () => ({
      status: 200,
      data: { status: true, message: 'Invoice created successfully.', payment_url: 'https://secure.zinipay.com/payment' },
    }),
  }
  const createInvoice = ((params: Parameters<typeof createZiniPayInvoice>[0], deps: { env?: NodeJS.ProcessEnv }) =>
    createZiniPayInvoice(params, { env: deps.env, http })) as never

  try {
    await assert.rejects(
      startHostedCheckout(
        { userId: 'user-1', subscriptionPlanId: 'plan-1', customerEmail: 'a@b.test', customerName: null },
        { env: ENV, createInvoice, now: clock.now, sleep: clock.sleep },
      ),
      (error: { statusCode?: number }) => error.statusCode === 503,
      'the customer is never redirected to a page that cannot be verified',
    )

    const stored = db.payments[0]
    assert.equal(stored.status, 'FAILED')
    assert.equal(stored.verificationResult, 'zinipay-checkout-failed')

    // The recorded note carries the response shape (field names) so the provider can be asked about it,
    // and no values.
    const note = (stored.providerCheckout as { lastFailure: { note: string } }).lastFailure.note
    assert.match(note, /no usable invoice id/)
    assert.match(note, /fields=status\|message\|payment_url/)
    assert.equal(note.includes('Invoice created successfully'), false, 'provider text is not copied into the record')
    assert.equal(note.includes('https://secure.zinipay.com'), false, 'the payment url is never recorded')
  } finally {
    db.restore()
  }
})

test('a first request reserves, invoices once and stores the trusted payment page', async () => {
  const db = installFakeDatabase()
  const clock = fakeClock()
  const provider = invoiceProvider()

  try {
    const session = await startHostedCheckout(
      { userId: 'user-1', subscriptionPlanId: 'plan-1', customerEmail: 'a@b.test', customerName: 'A' },
      { env: ENV, createInvoice: provider.createInvoice, now: clock.now, sleep: clock.sleep },
    )

    assert.equal(session.reused, false)
    assert.equal(session.paymentUrl, 'https://secure.zinipay.com/payment/INVOICE-1')
    assert.equal(provider.calls.length, 1)
    assert.equal(db.payments.length, 1)
    assert.equal(db.payments[0].checkoutReservationAt !== null, true, 'the row is the reservation')
    assert.equal(db.payments[0].providerPaymentId, 'INVOICE-1', 'the provider invoice id is stored for reconciliation')

    // The URLs handed to the provider come from the configured origins, never from the request.
    assert.equal(provider.calls[0].redirectUrl, `https://sport-zone-bd.vercel.app/checkout/return?payment=${db.payments[0].id}`)
    assert.equal(provider.calls[0].cancelUrl, 'https://sport-zone-bd.vercel.app/checkout?plan=plan-1&cancel=1')
    assert.equal(provider.calls[0].webhookUrl, 'https://sportzonebd-1.onrender.com/api/v1/payments/webhook/zinipay')
  } finally {
    db.restore()
  }
})

test('a second request for the same plan resumes the open session instead of invoicing again', async () => {
  const db = installFakeDatabase({
    payments: [reservation('payment-1', {
      providerPaymentId: 'INVOICE-1',
      providerCheckout: { url: 'https://secure.zinipay.com/payment/INVOICE-1', environment: 'live', createdAt: '2026-10-11T11:59:31.000Z', lastCheckedAt: null, lastStatus: null, lastFailure: null },
    })],
  })
  const clock = fakeClock()
  const provider = invoiceProvider()

  try {
    const session = await startHostedCheckout(
      { userId: 'user-1', subscriptionPlanId: 'plan-1', customerEmail: 'a@b.test', customerName: null },
      { env: ENV, createInvoice: provider.createInvoice, now: clock.now, sleep: clock.sleep },
    )

    assert.equal(session.reused, true)
    assert.equal(session.paymentId, 'payment-1')
    assert.equal(session.paymentUrl, 'https://secure.zinipay.com/payment/INVOICE-1')
    assert.equal(provider.calls.length, 0, 'resuming must not create another invoice')
    assert.equal(db.createCalls, 0)
  } finally {
    db.restore()
  }
})

test('a request racing the winner waits for the invoice and then reuses it', async () => {
  const row = reservation('payment-1')
  const db = installFakeDatabase({ payments: [row] })
  const clock = fakeClock()
  const provider = invoiceProvider()

  // The winner finishes its provider call while the loser is polling.
  const payment = prisma.payment as unknown as Record<string, unknown>
  const originalFindFirst = payment.findFirst as (args: unknown) => Promise<unknown>
  let reads = 0
  payment.findFirst = async (args: { where: Record<string, unknown> }) => {
    reads += 1
    if (reads > 1) {
      row.providerPaymentId = 'INVOICE-9'
      row.providerCheckout = { url: 'https://secure.zinipay.com/payment/INVOICE-9', environment: 'live', createdAt: '2026-10-11T12:00:01.000Z', lastCheckedAt: null, lastStatus: null, lastFailure: null }
    }
    return originalFindFirst.call(payment, args)
  }

  try {
    const session = await startHostedCheckout(
      { userId: 'user-1', subscriptionPlanId: 'plan-1', customerEmail: 'a@b.test', customerName: null },
      { env: ENV, createInvoice: provider.createInvoice, now: clock.now, sleep: clock.sleep },
    )

    assert.equal(session.reused, true)
    assert.equal(session.paymentUrl, 'https://secure.zinipay.com/payment/INVOICE-9')
    assert.equal(provider.calls.length, 0, 'the racing request must not create a second invoice')
  } finally {
    payment.findFirst = originalFindFirst
    db.restore()
  }
})

test('a request racing a winner that never produces an invoice is told to try again, with no second invoice', async () => {
  const db = installFakeDatabase({ payments: [reservation('payment-1')] })
  const clock = fakeClock()
  const provider = invoiceProvider()

  try {
    await assert.rejects(
      startHostedCheckout(
        { userId: 'user-1', subscriptionPlanId: 'plan-1', customerEmail: 'a@b.test', customerName: null },
        { env: ENV, createInvoice: provider.createInvoice, now: clock.now, sleep: clock.sleep },
      ),
      (error: { statusCode?: number; message: string }) => error.statusCode === 409 && /already being created/.test(error.message),
    )

    assert.equal(provider.calls.length, 0)
    assert.equal(db.createCalls, 0)
    assert.equal(db.payments[0].status, 'PENDING', 'a fresh reservation is left alone for the winner to finish')
  } finally {
    db.restore()
  }
})

test('losing the insert race reuses the winner session instead of creating a second invoice', async () => {
  const db = installFakeDatabase()
  const clock = fakeClock()
  const provider = invoiceProvider()

  // The winner commits its reservation between our lookup and our insert: the unique index rejects the insert
  // and the winner's session is what this request must return.
  const winner = reservation('payment-1', {
    providerPaymentId: 'INVOICE-1',
    providerCheckout: { url: 'https://secure.zinipay.com/payment/INVOICE-1', environment: 'live', createdAt: '2026-10-11T12:00:00.000Z', lastCheckedAt: null, lastStatus: null, lastFailure: null },
  })
  const payment = prisma.payment as unknown as Record<string, unknown>
  const create = payment.create as (args: unknown) => Promise<unknown>
  payment.create = async (args: unknown) => {
    db.payments.push(winner)
    throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002' })
  }

  try {
    const session = await startHostedCheckout(
      { userId: 'user-1', subscriptionPlanId: 'plan-1', customerEmail: 'a@b.test', customerName: null },
      { env: ENV, createInvoice: provider.createInvoice, now: clock.now, sleep: clock.sleep },
    )

    assert.equal(session.reused, true)
    assert.equal(session.paymentId, 'payment-1')
    assert.equal(session.paymentUrl, 'https://secure.zinipay.com/payment/INVOICE-1')
    assert.equal(provider.calls.length, 0)
  } finally {
    payment.create = create
    db.restore()
  }
})

test('an insert race whose winner is still calling the provider waits for that invoice instead of failing', async () => {
  const db = installFakeDatabase()
  const clock = fakeClock()
  const provider = invoiceProvider()

  const winner = reservation('payment-1')
  const payment = prisma.payment as unknown as Record<string, unknown>
  const create = payment.create as (args: unknown) => Promise<unknown>
  const findFirst = payment.findFirst as (args: { select?: Record<string, unknown> }) => Promise<unknown>

  // The winner commits its reservation first and is still talking to the provider when this request loses the
  // insert race. The invoice appears while the loser is waiting, which is what a double click looks like.
  let polls = 0
  payment.create = async () => {
    db.payments.push(winner)
    throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002' })
  }
  payment.findFirst = async (args: { select?: Record<string, unknown> }) => {
    const selected = args.select ?? {}
    if ('status' in selected) {
      polls += 1
      if (polls >= 2) {
        winner.providerPaymentId = 'INVOICE-1'
        winner.providerCheckout = { url: 'https://secure.zinipay.com/payment/INVOICE-1', environment: 'live', createdAt: null, lastCheckedAt: null, lastStatus: null, lastFailure: null }
      }
    }
    return findFirst(args)
  }

  try {
    const session = await startHostedCheckout(
      { userId: 'user-1', subscriptionPlanId: 'plan-1', customerEmail: 'a@b.test', customerName: null },
      { env: ENV, createInvoice: provider.createInvoice, now: clock.now, sleep: clock.sleep },
    )

    assert.equal(session.reused, true)
    assert.equal(session.paymentId, 'payment-1')
    assert.equal(session.paymentUrl, 'https://secure.zinipay.com/payment/INVOICE-1')
    assert.equal(provider.calls.length, 0, 'the loser never creates a second payable invoice')
    assert.equal(db.created.length, 0)
  } finally {
    payment.findFirst = findFirst
    payment.create = create
    db.restore()
  }
})

test('an insert race whose winner died is recovered by reserving again instead of failing the customer', async () => {
  const db = installFakeDatabase()
  const clock = fakeClock()
  const provider = invoiceProvider()

  const winner = reservation('payment-1')
  const payment = prisma.payment as unknown as Record<string, unknown>
  const create = payment.create as (args: unknown) => Promise<unknown>
  const findFirst = payment.findFirst as (args: { select?: Record<string, unknown> }) => Promise<unknown>

  let insertAttempted = false
  let winnerFailed = false
  payment.create = async (args: unknown) => {
    if (!insertAttempted) {
      insertAttempted = true
      db.payments.push(winner)
      throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002' })
    }
    return create(args)
  }
  payment.findFirst = async (args: { select?: Record<string, unknown> }) => {
    const selected = args.select ?? {}
    if ('status' in selected && !winnerFailed) {
      // The winner's provider call failed: it marks its own reservation as failed, so nothing is left to wait for.
      winnerFailed = true
      winner.status = 'FAILED'
    }
    return findFirst(args)
  }

  try {
    const session = await startHostedCheckout(
      { userId: 'user-1', subscriptionPlanId: 'plan-1', customerEmail: 'a@b.test', customerName: null },
      { env: ENV, createInvoice: provider.createInvoice, now: clock.now, sleep: clock.sleep },
    )

    assert.equal(session.reused, false, 'a dead reservation must not block the customer for the whole TTL')
    assert.equal(db.created.length, 1, 'exactly one new reservation is created')
    assert.equal(provider.calls.length, 1, 'exactly one invoice is created for it')
    assert.equal(winner.status, 'FAILED')
    assert.equal(db.created[0].providerPaymentId, 'INVOICE-1')
  } finally {
    payment.findFirst = findFirst
    payment.create = create
    db.restore()
  }
})

test('an abandoned reservation is failed and replaced instead of blocking the customer for ever', async () => {
  const stale = reservation('payment-1', { checkoutReservationAt: new Date('2026-10-11T11:50:00.000Z'), createdAt: new Date('2026-10-11T11:50:00.000Z') })
  const db = installFakeDatabase({ payments: [stale] })
  const clock = fakeClock()
  const provider = invoiceProvider()

  try {
    const session = await startHostedCheckout(
      { userId: 'user-1', subscriptionPlanId: 'plan-1', customerEmail: 'a@b.test', customerName: null },
      { env: ENV, createInvoice: provider.createInvoice, now: clock.now, sleep: clock.sleep },
    )

    assert.equal(session.reused, false)
    assert.equal(stale.status, 'FAILED')
    assert.equal(stale.verificationResult, 'zinipay-checkout-abandoned')
    assert.equal(provider.calls.length, 1, 'the customer gets a working invoice after the stale one is closed')
    assert.equal(db.payments.length, 2)
  } finally {
    db.restore()
  }
})

test('a provider failure is reported as unavailable and does not block the next attempt', async () => {
  const db = installFakeDatabase()
  const clock = fakeClock()
  const failing = (async () => { throw new ZiniPayCheckoutFailure('timeout', null, 'timeout') }) as never

  try {
    await assert.rejects(
      startHostedCheckout(
        { userId: 'user-1', subscriptionPlanId: 'plan-1', customerEmail: 'a@b.test', customerName: null },
        { env: ENV, createInvoice: failing, now: clock.now, sleep: clock.sleep },
      ),
      (error: { statusCode?: number }) => error.statusCode === 503,
    )

    assert.equal(db.payments[0].status, 'FAILED')
    assert.equal(db.payments[0].verificationResult, 'zinipay-checkout-failed')

    // The failed attempt is not an open reservation any more, so a retry may create a new one.
    const provider = invoiceProvider()
    const retry = await startHostedCheckout(
      { userId: 'user-1', subscriptionPlanId: 'plan-1', customerEmail: 'a@b.test', customerName: null },
      { env: ENV, createInvoice: provider.createInvoice, now: clock.now, sleep: clock.sleep },
    )

    assert.equal(retry.reused, false)
    assert.equal(provider.calls.length, 1)
  } finally {
    db.restore()
  }
})

test('an untrusted payment page from the provider is refused instead of being handed to the browser', async () => {
  const db = installFakeDatabase()
  const clock = fakeClock()
  const hostile = (async () => { throw new ZiniPayCheckoutFailure('provider-error', null, 'the payment url host is not trusted: evil.test') }) as never

  try {
    await assert.rejects(
      startHostedCheckout(
        { userId: 'user-1', subscriptionPlanId: 'plan-1', customerEmail: 'a@b.test', customerName: null },
        { env: ENV, createInvoice: hostile, now: clock.now, sleep: clock.sleep },
      ),
      (error: { statusCode?: number; message: string }) => error.statusCode === 503 && /temporarily unavailable/.test(error.message),
    )

    assert.equal(db.payments[0].status, 'FAILED')
    assert.equal(
      db.payments.some((row) => typeof row.providerCheckout === 'object' && row.providerCheckout !== null && 'url' in (row.providerCheckout as object) && (row.providerCheckout as { url: unknown }).url !== null),
      false,
      'no payment url is ever stored when the provider answer is not trusted',
    )
  } finally {
    db.restore()
  }
})

test('an invoice whose reservation was replaced is not exposed to the customer', async () => {
  const db = installFakeDatabase()
  const clock = fakeClock()
  const provider = invoiceProvider()

  // The reservation is closed while the provider call is in flight, so attaching the invoice cannot match.
  const payment = prisma.payment as unknown as Record<string, unknown>
  const originalUpdateMany = payment.updateMany as (args: unknown) => Promise<unknown>
  payment.updateMany = async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
    if (args.data && 'providerPaymentId' in args.data) {
      const row = db.payments.find((entry) => entry.id === args.where.id)
      if (row) row.status = 'FAILED'
      return { count: 0 }
    }
    return originalUpdateMany.call(payment, args)
  }

  try {
    await assert.rejects(
      startHostedCheckout(
        { userId: 'user-1', subscriptionPlanId: 'plan-1', customerEmail: 'a@b.test', customerName: null },
        { env: ENV, createInvoice: provider.createInvoice, now: clock.now, sleep: clock.sleep },
      ),
      (error: { statusCode?: number }) => error.statusCode === 503,
      'the customer is never sent to an invoice the platform no longer tracks',
    )
  } finally {
    payment.updateMany = originalUpdateMany
    db.restore()
  }
})

test('two customers, and the same customer on another plan, each get their own invoice', async () => {
  const db = installFakeDatabase({
    payments: [reservation('payment-1', {
      providerPaymentId: 'INVOICE-1',
      providerCheckout: { url: 'https://secure.zinipay.com/payment/INVOICE-1', environment: 'live', createdAt: '2026-10-11T12:00:00.000Z', lastCheckedAt: null, lastStatus: null, lastFailure: null },
    })],
  })
  const clock = fakeClock()
  const provider = invoiceProvider()

  const plan = prisma.subscriptionPlan as unknown as Record<string, unknown>
  const originalPlan = plan.findUnique
  const planIds: string[] = []
  plan.findUnique = async (args: { where: { id: string } }) => {
    planIds.push(args.where.id)
    return { id: args.where.id, name: `Plan ${args.where.id}`, price: { toString: () => '300' }, durationDays: 30, status: 'ACTIVE', deletedAt: null }
  }

  try {
    // Another customer, same plan.
    const otherCustomer = await startHostedCheckout(
      { userId: 'user-2', subscriptionPlanId: 'plan-1', customerEmail: 'other@b.test', customerName: null },
      { env: ENV, createInvoice: provider.createInvoice, now: clock.now, sleep: clock.sleep },
    )
    // Same customer, another plan.
    const otherPlan = await startHostedCheckout(
      { userId: 'user-1', subscriptionPlanId: 'plan-2', customerEmail: 'a@b.test', customerName: null },
      { env: ENV, createInvoice: provider.createInvoice, now: clock.now, sleep: clock.sleep },
    )

    assert.equal(otherCustomer.reused, false)
    assert.equal(otherPlan.reused, false)
    assert.equal(provider.calls.length, 2, 'different customer or different plan must not be blocked by the open session')
    assert.equal(planIds.length, 2)
  } finally {
    plan.findUnique = originalPlan
    db.restore()
  }
})
