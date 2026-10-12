import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { NextFunction } from 'express'

process.env.JWT_SECRET ??= 'provider-evidence-test-secret'
process.env.JWT_REFRESH_SECRET ??= 'provider-evidence-test-refresh-secret'

const { prisma } = await import('../../core/prisma.js')
const { ZiniPayCheckoutFailure } = await import('./zinipay.checkout.client.js')
const { verifyHostedCheckout, recheckHostedPayment } = await import('./hostedCheckout.service.js')
const { readProviderEvidence, buildProviderEvidence } = await import('./providerEvidence.js')
const evidenceApi = await import('./providerEvidence.js')
const { paymentRouter } = await import('./payment.routes.js')

interface StackLayer {
  handle?: { name: string }
  route?: { path: string; methods: Record<string, boolean>; stack: Array<{ handle: unknown }> }
}

/** The names of the layers registered for a route, in order, as express would run them. */
function routeHandles(method: string, path: string): string[] {
  return (routeLayerHandles(method, path) as Array<{ name?: string }>).map((handle) => handle?.name ?? 'anonymous')
}

/** The actual layer functions registered for a route, for identity assertions. */
function routeLayerHandles(method: string, path: string): unknown[] {
  const layers = (paymentRouter as unknown as { stack: StackLayer[] }).stack
  const layer = layers.find((candidate) => (
    candidate.route
    && candidate.route.path === path
    && candidate.route.methods[method] === true
  ))
  assert.ok(layer?.route, `no ${method.toUpperCase()} ${path} route is registered`)
  return layer.route.stack.map((entry) => entry.handle)
}

/**
 * The two things this file has to prove.
 *
 * 1. Provider evidence is a record of what the *provider* said during a server-side verification. Nothing a
 *    browser, a callback or a customer supplied may appear in it, it may never erase a fact it learned
 *    earlier, and writing it may never change a payment's status.
 * 2. The admin recheck re-runs exactly the same verification. It has no override, it refuses anything that is
 *    not an open hosted payment before touching the provider, and it cannot activate a payment the provider
 *    has not confirmed.
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
  provider: string
  status: string
  amount: string
  currency: string
  providerPaymentId: string | null
  transactionId: string
  providerCheckout: unknown
  providerVerification: unknown
  subscriptionPlanId: string | null
  subscriptionPlan: { name: string; durationDays: number } | null
  verificationResult?: string | null
  deletedAt?: Date | null
}

interface FakeCheck {
  status: 'PENDING' | 'COMPLETED' | 'FAILED'
  amount?: number | null
  paymentMethod?: string | null
  transactionId?: string | null
  merchantReference?: string | null
  metadata?: Record<string, unknown> | null
}

const OPEN_PAYMENT: PaymentRecord = {
  id: 'payment-1',
  userId: 'user-1',
  provider: 'zinipay',
  status: 'PENDING',
  amount: '300',
  currency: 'BDT',
  providerPaymentId: 'INVOICE_ID',
  transactionId: 'SZBD-abc123',
  providerCheckout: { url: 'https://secure.zinipay.com/payment/INVOICE_ID', lastCheckedAt: null, lastStatus: null },
  providerVerification: null,
  subscriptionPlanId: 'plan-1',
  subscriptionPlan: { name: 'Monthly', durationDays: 30 },
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

const TX_STATE = { subscriptions: [] as unknown[], notifications: [] as unknown[], userRoles: [] as unknown[] }

function installFakeTransaction() {
  const original = prisma.$transaction
  const payment = prisma.payment as unknown as Record<string, unknown>

  prisma.$transaction = (async (callback: (tx: unknown) => Promise<unknown>) => {
    const tx = {
      payment: { updateMany: payment.updateMany, update: payment.update },
      subscription: {
        findFirst: async () => null,
        create: async (args: { data: Record<string, unknown> }) => {
          const created = { id: `sub-${TX_STATE.subscriptions.length + 1}`, ...(args.data as object) }
          TX_STATE.subscriptions.push(created)
          return created
        },
        update: async () => null,
      },
      role: { findUnique: async () => ({ id: 'role-premium' }) },
      userRole: { upsert: async (args: { create: unknown }) => { TX_STATE.userRoles.push(args.create); return args.create } },
      notification: { create: async (args: { data: unknown }) => { TX_STATE.notifications.push(args.data); return args.data } },
    }
    return callback(tx)
  }) as unknown as typeof prisma.$transaction

  return { restore: () => { prisma.$transaction = original } }
}

function fakeProvider(checks: Array<FakeCheck | Error>) {
  const calls: string[] = []
  let index = 0
  const verifyInvoice = (async ({ invoiceId }: { invoiceId: string }) => {
    calls.push(invoiceId)
    const next = checks[Math.min(index, checks.length - 1)]
    index += 1
    if (next instanceof Error) throw next
    return next
  }) as never
  return { calls, verifyInvoice }
}

function arrange(rows: PaymentRecord[]) {
  const payment = installFakePaymentTable(rows)
  const transaction = installFakeTransaction()
  TX_STATE.subscriptions.length = 0
  TX_STATE.notifications.length = 0
  TX_STATE.userRoles.length = 0
  return { restore: () => { payment.restore(); transaction.restore() } }
}

const evidenceOf = (row: PaymentRecord) => readProviderEvidence(row.providerVerification)

test('evidence is recorded from the provider answer, and only from it', async () => {
  const rows = [{ ...OPEN_PAYMENT }]
  const { restore } = arrange(rows)
  const provider = fakeProvider([{
    status: 'COMPLETED',
    amount: 300,
    paymentMethod: 'bkash',
    transactionId: 'TXN123456789',
    merchantReference: 'SZBD-abc123',
    metadata: { paymentId: 'payment-1', userId: 'user-1' },
  }])

  try {
    const result = await verifyHostedCheckout({ paymentId: 'payment-1', userId: 'user-1' }, { env: ENV, verifyInvoice: provider.verifyInvoice })
    const evidence = evidenceOf(rows[0])

    assert.equal(result.status, 'COMPLETED')
    assert.ok(evidence, 'the verification is recorded')
    assert.equal(evidence.source, 'invoice-verify')
    assert.equal(evidence.providerStatus, 'COMPLETED')
    assert.equal(evidence.amount, 300)
    assert.equal(evidence.paymentMethod, 'bkash')
    assert.equal(evidence.transactionId, 'TXN123456789')
    assert.equal(evidence.merchantReference, 'SZBD-abc123')
    assert.equal(evidence.invoiceId, 'INVOICE_ID')
    assert.equal(evidence.checkCount, 1)
    assert.ok(evidence.verifiedAt, 'a provider answer counts as a verification')
    assert.equal(evidence.lastFailure, null)
  } finally {
    restore()
  }
})

test('a pending answer cannot write facts the provider never sent', async () => {
  const rows = [{ ...OPEN_PAYMENT }]
  const { restore } = arrange(rows)
  // What a callback or a browser might claim, with no provider answer behind it.
  const provider = fakeProvider([{ status: 'PENDING', amount: null, transactionId: null, paymentMethod: null, merchantReference: null }])

  try {
    await verifyHostedCheckout({ paymentId: 'payment-1', userId: 'user-1' }, { env: ENV, verifyInvoice: provider.verifyInvoice })
    const evidence = evidenceOf(rows[0])

    assert.equal(rows[0].status, 'PENDING')
    assert.equal(evidence?.providerStatus, 'PENDING')
    assert.equal(evidence?.transactionId, null, 'no transaction reference may be invented')
    assert.equal(evidence?.amount, null)
    assert.equal(evidence?.paymentMethod, null)
  } finally {
    restore()
  }
})

test('a later check never erases a transaction reference learned earlier', async () => {
  const rows = [{ ...OPEN_PAYMENT }]
  const { restore } = arrange(rows)
  // First a mismatch that refuses activation (so the payment stays open), then a plain pending poll.
  const provider = fakeProvider([
    { status: 'COMPLETED', amount: 100, paymentMethod: 'nagad', transactionId: 'TXN-KEEP' },
    { status: 'PENDING' },
  ])

  try {
    await verifyHostedCheckout({ paymentId: 'payment-1', userId: 'user-1' }, { env: ENV, verifyInvoice: provider.verifyInvoice })
    assert.equal(evidenceOf(rows[0])?.lastFailure?.kind, 'amount-mismatch')
    assert.equal(evidenceOf(rows[0])?.transactionId, 'TXN-KEEP')

    await verifyHostedCheckout({ paymentId: 'payment-1', userId: 'user-1' }, { env: ENV, verifyInvoice: provider.verifyInvoice })
    const evidence = evidenceOf(rows[0])

    assert.equal(rows[0].status, 'PENDING', 'nothing was activated')
    assert.equal(evidence?.transactionId, 'TXN-KEEP', 'the earlier evidence survives a check that omits it')
    assert.equal(evidence?.paymentMethod, 'nagad')
    assert.equal(evidence?.amount, 100)
    assert.equal(evidence?.providerStatus, 'PENDING', 'the newest provider status is what is shown')
    assert.equal(evidence?.checkCount, 2)
    assert.equal(evidence?.lastFailure, null, 'a clean answer clears the failure summary')
  } finally {
    restore()
  }
})

test('a failed provider check is recorded without pretending anything was verified', async () => {
  const rows = [{ ...OPEN_PAYMENT }]
  const { restore } = arrange(rows)
  const provider = fakeProvider([new ZiniPayCheckoutFailure('provider-error', 500, 'The payment provider could not be reached.')])

  try {
    const result = await verifyHostedCheckout({ paymentId: 'payment-1', userId: 'user-1' }, { env: ENV, verifyInvoice: provider.verifyInvoice })
    const evidence = evidenceOf(rows[0])

    assert.equal(result.status, 'UNKNOWN')
    assert.equal(rows[0].status, 'PENDING', 'a failed check never decides anything')
    assert.equal(evidence?.lastFailure?.kind, 'provider-provider-error')
    assert.equal(evidence?.verifiedAt, null, 'a failed check is not a verification')
    assert.equal(evidence?.checkCount, 1)
  } finally {
    restore()
  }
})

test('a refused activation is recorded as a diagnostic, not as a success', async () => {
  const rows = [{ ...OPEN_PAYMENT }]
  const { restore } = arrange(rows)
  const provider = fakeProvider([{ status: 'COMPLETED', amount: 300, transactionId: 'TXN1', merchantReference: 'SZBD-someone-else' }])

  try {
    const result = await verifyHostedCheckout({ paymentId: 'payment-1', userId: 'user-1' }, { env: ENV, verifyInvoice: provider.verifyInvoice })
    const evidence = evidenceOf(rows[0])

    assert.equal(result.status, 'UNKNOWN')
    assert.equal(rows[0].verificationResult, 'zinipay-reference-mismatch')
    assert.equal(evidence?.lastFailure?.kind, 'reference-mismatch')
    assert.equal(evidence?.merchantReference, null, 'a reference that contradicts the payment is not stored as evidence of it')
  } finally {
    restore()
  }
})

test('a stored record of an earlier shape is not read as current evidence', () => {
  assert.equal(readProviderEvidence(null), null)
  assert.equal(readProviderEvidence('COMPLETED'), null)
  assert.equal(readProviderEvidence({ verificationId: 'abc', confirmed: true }), null)
  assert.equal(readProviderEvidence({ source: 'trx-verify', checkedAt: new Date().toISOString() }), null)

  const unknown = readProviderEvidence({ source: 'invoice-verify', checkedAt: new Date().toISOString(), checkCount: 'many', invoiceId: 7 })
  assert.equal(unknown?.checkCount, 0)
  assert.equal(unknown?.invoiceId, null)
  assert.equal(unknown?.providerStatus, null)
})

test('the merge is monotonic and bounded', () => {
  const first = buildProviderEvidence(null, {
    invoiceId: 'INVOICE_ID',
    expectedMerchantReference: 'SZBD-abc123',
    check: { status: 'COMPLETED', amount: 300, paymentMethod: 'bkash', transactionId: 'TXN1', merchantReference: 'SZBD-abc123', metadata: null },
  }, new Date('2026-01-01T00:00:00.000Z'))

  const second = buildProviderEvidence(first, {
    invoiceId: 'INVOICE_ID',
    expectedMerchantReference: 'SZBD-abc123',
    check: { status: 'PENDING', amount: null, paymentMethod: null, transactionId: null, merchantReference: null, metadata: null },
  }, new Date('2026-01-01T00:05:00.000Z'))

  assert.equal(second.transactionId, 'TXN1')
  assert.equal(second.amount, 300)
  assert.equal(second.providerStatus, 'PENDING')
  assert.equal(second.verifiedAt, '2026-01-01T00:05:00.000Z')
  assert.equal(second.checkCount, 2)
  assert.equal(second.checkedAt, '2026-01-01T00:05:00.000Z')

  const failed = buildProviderEvidence(second, {
    invoiceId: 'INVOICE_ID',
    expectedMerchantReference: 'SZBD-abc123',
    failure: { kind: 'provider-timeout', note: 'x'.repeat(500) },
  }, new Date('2026-01-01T00:06:00.000Z'))

  assert.equal(failed.transactionId, 'TXN1')
  assert.equal(failed.lastFailure?.kind, 'provider-timeout')
  assert.ok((failed.lastFailure?.note?.length ?? 0) <= 200, 'a note is bounded before it is stored')
  assert.equal(failed.verifiedAt, '2026-01-01T00:05:00.000Z', 'a failure does not overwrite the last real verification')
})

test('an administrator can recheck an open hosted payment and it activates only on a completed invoice', async () => {
  const rows = [{ ...OPEN_PAYMENT }]
  const { restore } = arrange(rows)
  const provider = fakeProvider([{
    status: 'COMPLETED',
    amount: 300,
    paymentMethod: 'bkash',
    transactionId: 'TXN123456789',
    merchantReference: 'SZBD-abc123',
    metadata: { paymentId: 'payment-1' },
  }])

  try {
    const result = await recheckHostedPayment({ paymentId: 'payment-1' }, { env: ENV, verifyInvoice: provider.verifyInvoice })

    assert.equal(result.outcome, 'COMPLETED')
    assert.equal(result.providerContacted, true)
    assert.equal(result.paymentStatus, 'APPROVED')
    assert.equal(rows[0].status, 'APPROVED')
    assert.deepEqual(provider.calls, ['INVOICE_ID'], 'the recheck uses the same server-side verification')
    assert.equal(result.evidence?.transactionReference, '********6789', 'references leaving the database are masked')
    assert.equal(result.evidence?.invoiceReference, '******E_ID')
  } finally {
    restore()
  }
})

test('an administrator recheck cannot approve anything the provider has not confirmed', async () => {
  const rows = [{ ...OPEN_PAYMENT }]
  const { restore } = arrange(rows)
  const provider = fakeProvider([{ status: 'PENDING' }])

  try {
    const result = await recheckHostedPayment({ paymentId: 'payment-1' }, { env: ENV, verifyInvoice: provider.verifyInvoice })

    assert.equal(result.outcome, 'PENDING')
    assert.equal(result.paymentStatus, 'PENDING')
    assert.equal(rows[0].status, 'PENDING')
    assert.equal(rows[0].verificationResult ?? null, null, 'nothing is decided')
  } finally {
    restore()
  }
})

test('a recheck of a decided or non-hosted payment never reaches the provider', async () => {
  const cases: Array<{ row: Partial<PaymentRecord>; expectedStatus: number }> = [
    { row: { status: 'APPROVED' }, expectedStatus: 400 },
    { row: { status: 'COMPLETED' }, expectedStatus: 400 },
    { row: { status: 'FAILED' }, expectedStatus: 400 },
    { row: { status: 'REJECTED' }, expectedStatus: 400 },
    { row: { status: 'PENDING_REVIEW' }, expectedStatus: 400 },
    { row: { provider: 'bkash' }, expectedStatus: 400 },
    { row: { providerPaymentId: null }, expectedStatus: 400 },
  ]

  for (const scenario of cases) {
    const rows = [{ ...OPEN_PAYMENT, ...scenario.row }]
    const { restore } = arrange(rows)
    const provider = fakeProvider([{ status: 'COMPLETED', amount: 300, merchantReference: 'SZBD-abc123' }])

    try {
      await assert.rejects(
        recheckHostedPayment({ paymentId: 'payment-1' }, { env: ENV, verifyInvoice: provider.verifyInvoice }),
        (error: { statusCode?: number }) => error.statusCode === scenario.expectedStatus,
        `expected a ${scenario.expectedStatus} for ${JSON.stringify(scenario.row)}`,
      )
      assert.equal(provider.calls.length, 0, 'a refused recheck must not spend a provider request')
      assert.equal(rows[0].providerVerification, scenario.row.providerVerification ?? null)
    } finally {
      restore()
    }
  }
})

test('a recheck of an unknown payment is reported as missing', async () => {
  const rows = [{ ...OPEN_PAYMENT }]
  const { restore } = arrange(rows)
  const provider = fakeProvider([{ status: 'PENDING' }])

  try {
    await assert.rejects(
      recheckHostedPayment({ paymentId: 'does-not-exist' }, { env: ENV, verifyInvoice: provider.verifyInvoice }),
      (error: { statusCode?: number }) => error.statusCode === 404,
    )
    assert.equal(provider.calls.length, 0)
  } finally {
    restore()
  }
})

test('a recheck moments after another check is reported truthfully instead of looking like a result', async () => {
  const rows = [{
    ...OPEN_PAYMENT,
    providerCheckout: { url: null, lastCheckedAt: new Date().toISOString(), lastStatus: 'PENDING' },
  }]
  const { restore } = arrange(rows)
  const provider = fakeProvider([{ status: 'COMPLETED', amount: 300, merchantReference: 'SZBD-abc123' }])

  try {
    const result = await recheckHostedPayment({ paymentId: 'payment-1' }, { env: ENV, verifyInvoice: provider.verifyInvoice })

    assert.equal(result.outcome, 'PENDING')
    assert.equal(result.providerContacted, false, 'the throttle is admitted rather than hidden')
    assert.equal(provider.calls.length, 0)
    assert.equal(rows[0].status, 'PENDING')
    assert.match(result.message, /checked moments ago/i)
  } finally {
    restore()
  }
})

test('the transaction-verification record and the invoice record coexist, and neither erases the other', () => {
  const { readTrxEvidence: read, buildTrxEvidence: build, withTrxEvidence: merge, toAdminEvidenceView: view } = evidenceApi

  const invoice = { source: 'invoice-verify', checkedAt: '2026-10-12T07:57:00.000Z', checkCount: 1, providerStatus: 'PENDING', invoiceId: 'INVOICE-1' }
  const trx = build({
    referenceMasked: '********6789',
    previous: null,
    verify: { providerTransactionId: 1234, amount: 10, provider: 'bKash', senderMasked: '017****5678', status: 'UNUSED' },
    confirmStatus: 'CONFIRMED',
  }, new Date('2026-10-12T08:10:00.000Z'))

  const stored = merge(invoice, trx)
  assert.equal(read(stored)?.confirmStatus, 'CONFIRMED')
  assert.equal((stored as { providerStatus?: string }).providerStatus, 'PENDING', 'the invoice facts are still there')

  // A later invoice check rewrites the invoice keys but keeps the transaction facts beside them.
  const rewritten = merge({ ...invoice, providerStatus: 'COMPLETED', checkCount: 2 }, trx)
  assert.equal((rewritten as { providerStatus?: string }).providerStatus, 'COMPLETED')
  assert.equal(read(rewritten)?.providerTransactionId, 1234)

  const adminView = view(null, trx)
  assert.equal(adminView?.transaction?.confirmStatus, 'CONFIRMED')
  assert.equal(JSON.stringify(adminView).includes('TXN123456789'), false)
})

test('a later transaction attempt cannot erase what an earlier one established', () => {
  const { buildTrxEvidence: build, readTrxEvidence: read } = evidenceApi

  const first = build({
    referenceMasked: '********6789',
    previous: null,
    verify: { providerTransactionId: 1234, amount: 10, provider: 'bKash', senderMasked: '017****5678', status: 'UNUSED' },
  }, new Date('2026-10-12T08:00:00.000Z'))

  const second = build({
    referenceMasked: '******4321',
    previous: first,
    failure: { kind: 'not-found', note: 'unknown transaction' },
  }, new Date('2026-10-12T08:05:00.000Z'))

  assert.equal(second.attempts, 2)
  assert.equal(second.providerTransactionId, 1234, 'the provider id survives a later failed attempt')
  assert.equal(second.verifiedAt, '2026-10-12T08:00:00.000Z')
  assert.equal(second.lastFailure?.kind, 'not-found')
  assert.equal(read(second)?.amount, 10)
})

test('a stored transaction record of an unknown shape is not read as evidence', () => {
  const { readTrxEvidence: read } = evidenceApi

  assert.equal(read(null), null)
  assert.equal(read({ trxVerification: 'CONFIRMED' }), null)
  assert.equal(read({ trxVerification: { source: 'trx-confirm', checkedAt: new Date().toISOString() } }), null)
  assert.equal(read({ trxVerification: { source: 'trx-verify' } }), null, 'a record without a timestamp is not usable')
  assert.equal(read({ source: 'invoice-verify', checkedAt: new Date().toISOString() }), null, 'an invoice record is not a transaction record')
  assert.equal(read({ trxVerification: { source: 'trx-verify', checkedAt: new Date().toISOString(), attempts: 'many', confirmStatus: 'MAYBE' } })?.attempts, 0)
  assert.equal(read({ trxVerification: { source: 'trx-verify', checkedAt: new Date().toISOString(), confirmStatus: 'MAYBE' } })?.confirmStatus, null)
  assert.equal(read({ source: 'trx-verify', checkedAt: new Date().toISOString(), attempts: 2 })?.attempts, 2)
})

test('the transaction-verification route is a customer route behind the payment limiter', async () => {
  const [paymentLimiter, verifyPaymentTransaction] = await Promise.all([
    import('../../middleware/rateLimiter.js').then((module) => module.paymentLimiter),
    import('./payment.controller.js').then((module) => module.verifyPaymentTransaction),
  ])

  const handles = routeLayerHandles('post', '/:paymentId/transaction-verification')

  // Exactly: the session, the credit-spending limiter and the handler — nothing that would demand an admin
  // permission (this is the customer's own payment) and nothing extra.
  assert.equal(handles.length, 3, `unexpected layer count: ${(handles as Array<{ name?: string }>).map((entry) => entry?.name ?? 'anonymous').join(', ')}`)
  assert.equal((handles[0] as { name?: string }).name, 'authenticate')
  assert.equal(handles[1], paymentLimiter)
  assert.equal(handles[2], verifyPaymentTransaction)

  const names = routeHandles('post', '/:paymentId/transaction-verification')
  assert.equal(
    names.some((name) => name.includes('requirePermission') || name.includes('requireRole')),
    false,
    `a customer endpoint must not be gated by an admin gate: ${names.join(', ')}`,
  )
})

test('the recheck route is gated by the payment review permission and cannot be reached anonymously', async () => {
  const { recheckHostedPayment: recheckHandler } = await import('./payment.controller.js')

  interface StackLayer {
    handle?: { name: string }
    route?: { path: string; methods: Record<string, boolean>; stack: Array<{ handle: unknown }> }
  }
  const layers = (paymentRouter as unknown as { stack: StackLayer[] }).stack
  const layer = layers.find((candidate) => (
    candidate.route
    && candidate.route.path === '/manual-verification/:id/recheck'
    && candidate.route.methods.post === true
  ))

  assert.ok(layer?.route, 'the recheck route is registered')
  const stack = layer.route.stack
  // One gate and one handler: nothing that would let an ungated path reach the recovery logic.
  assert.equal(stack.length, 2, `unexpected layer count: ${stack.map((entry) => (entry.handle as { name?: string }).name).join(', ')}`)
  assert.equal(stack[1].handle, recheckHandler, 'the handler is the recheck controller and nothing else')

  const runGate = async (user: unknown): Promise<unknown> => {
    const req = { user, query: {}, params: { id: 'payment-1' }, body: {}, headers: {} }
    const res = { status: () => res, json: () => res, cookie: () => res, clearCookie: () => res, setHeader: () => res, getHeader: () => undefined }
    let refusal: unknown = null
    await new Promise<void>((resolve) => {
      const next = ((error?: unknown) => {
        if (error) refusal = error
        resolve()
      }) as NextFunction
      const outcome = (stack[0].handle as unknown as (r: unknown, s: unknown, n: NextFunction) => unknown)(req, res, next)
      if (outcome && typeof (outcome as Promise<unknown>).then === 'function') {
        void (outcome as Promise<unknown>).then(() => resolve())
      } else {
        resolve()
      }
    })
    return refusal
  }

  // No session at all, then a console user who may look at payments but not review them.
  assert.equal((await runGate(undefined) as { statusCode?: number } | null)?.statusCode, 401)
  assert.equal(
    (await runGate({ id: 'moderator-1', roles: ['moderator'], permissions: ['admin.payments.view'] }) as { statusCode?: number } | null)?.statusCode,
    403,
    'holding only the payments-view permission must not allow a recheck',
  )
  assert.equal(await runGate({ id: 'admin-1', permissions: ['admin.payments.review'] }), null, 'the review permission is what the gate accepts')
})
