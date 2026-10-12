import assert from 'node:assert/strict'
import { test } from 'node:test'

process.env.JWT_SECRET ??= 'trx-verification-test-secret'
process.env.JWT_REFRESH_SECRET ??= 'trx-verification-test-refresh-secret'

const { prisma } = await import('../../core/prisma.js')
const { ZiniPayTrxFailure } = await import('./zinipay.trx.client.js')
const { verifyPaymentTransaction, normalizeTransactionReference, isTransactionVerificationAvailable } = await import('./trxVerification.service.js')
const { readTrxEvidence, readProviderEvidence } = await import('./providerEvidence.js')

/**
 * What has to be true before a transaction reference can grant Premium.
 *
 * The customer supplies one string. Everything else — the amount, the plan, the ownership, whether the
 * transaction was already consumed — comes from the stored payment and from the provider. These tests assert
 * that no combination of a friendly-looking answer and a payment row can activate premium without the provider
 * confirming *and consuming* the transaction, and that a lost race is reported as success rather than as a
 * second activation.
 */

const ENABLED_ENV = {
  ZINIPAY_API_KEY: 'brand-key-for-tests',
  ZINIPAY_TRX_VERIFICATION_ENABLED: 'true',
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

const OPEN_PAYMENT: PaymentRecord = {
  id: 'payment-1',
  userId: 'user-1',
  provider: 'zinipay',
  status: 'PENDING',
  amount: '10',
  currency: 'BDT',
  providerPaymentId: 'INVOICE-1',
  transactionId: 'SZBD-abc123',
  providerCheckout: { url: 'https://secure.zinipay.com/payment/INVOICE-1', environment: 'live', createdAt: null, lastCheckedAt: null, lastStatus: null, lastFailure: null },
  providerVerification: { source: 'invoice-verify', checkedAt: '2026-10-12T07:57:00.000Z', checkCount: 1, providerStatus: 'PENDING', invoiceId: 'INVOICE-1' },
  subscriptionPlanId: 'plan-1',
  subscriptionPlan: { name: 'Weekly Plans', durationDays: 7 },
  deletedAt: null,
}

const activationState = { subscriptions: [] as unknown[], notifications: [] as unknown[], userRoles: [] as unknown[] }

function installFakeDatabase(rows: PaymentRecord[], options: { loseClaim?: boolean } = {}) {
  const payment = prisma.payment as unknown as Record<string, unknown>
  const original = {
    findFirst: payment.findFirst,
    update: payment.update,
    updateMany: payment.updateMany,
    transaction: prisma.$transaction,
  }

  payment.findFirst = async (args: { where: { id?: string } }) => rows.find((entry) => entry.id === args.where.id) ?? null
  payment.update = async (args: { where: { id: string }; data: Record<string, unknown> }) => {
    const row = rows.find((entry) => entry.id === args.where.id)
    if (row) Object.assign(row, args.data)
    return row ?? null
  }
  payment.updateMany = async (args: { where: { id: string; status?: { in?: string[] } }; data: Record<string, unknown> }) => {
    if (options.loseClaim) return { count: 0 }
    const row = rows.find((entry) => entry.id === args.where.id)
    const allowed = args.where.status?.in
    if (!row || (allowed && !allowed.includes(row.status))) return { count: 0 }
    Object.assign(row, args.data)
    return { count: 1 }
  }

  activationState.subscriptions.length = 0
  activationState.notifications.length = 0
  activationState.userRoles.length = 0

  prisma.$transaction = (async (callback: (tx: unknown) => Promise<unknown>) => callback({
    payment: { updateMany: payment.updateMany, update: payment.update },
    subscription: {
      findFirst: async () => null,
      create: async (args: { data: Record<string, unknown> }) => {
        const created = { id: `sub-${activationState.subscriptions.length + 1}`, ...(args.data as object) }
        activationState.subscriptions.push(created)
        return created
      },
      update: async () => null,
    },
    role: { findUnique: async () => ({ id: 'role-premium' }) },
    userRole: { upsert: async (args: { create: unknown }) => { activationState.userRoles.push(args.create); return args.create } },
    notification: { create: async (args: { data: unknown }) => { activationState.notifications.push(args.data); return args.data } },
  })) as unknown as typeof prisma.$transaction

  return {
    restore: () => {
      payment.findFirst = original.findFirst
      payment.update = original.update
      payment.updateMany = original.updateMany
      prisma.$transaction = original.transaction
    },
  }
}

const VERIFIED = {
  id: 1234,
  transactionId: 'TXN123456789',
  amount: 10,
  senderMasked: '017****5678',
  provider: 'bKash',
  status: 'UNUSED',
  timestamp: '2026-05-20T10:30:00.000Z',
}

function fakeProvider(options: { verify?: unknown; confirm?: unknown } = {}) {
  const calls: Array<{ step: string; params: Record<string, unknown> }> = []
  const verifyTransaction = (async (params: Record<string, unknown>) => {
    calls.push({ step: 'verify', params })
    if (options.verify instanceof Error) throw options.verify
    return options.verify ?? VERIFIED
  }) as never
  const confirmTransaction = (async (params: Record<string, unknown>) => {
    calls.push({ step: 'confirm', params })
    if (options.confirm instanceof Error) throw options.confirm
    return { id: 1234, transactionId: 'TXN123456789', amount: 10, senderMasked: '017****5678', provider: 'bKash', timestamp: null }
  }) as never
  return { calls, verifyTransaction, confirmTransaction }
}

test('a verified, confirmed transaction activates premium exactly once', async () => {
  const rows = [{ ...OPEN_PAYMENT }]
  const db = installFakeDatabase(rows)
  const provider = fakeProvider()

  try {
    const result = await verifyPaymentTransaction(
      { paymentId: 'payment-1', userId: 'user-1', transactionId: '  TXN123456789 ' },
      { env: ENABLED_ENV, verifyTransaction: provider.verifyTransaction, confirmTransaction: provider.confirmTransaction },
    )

    assert.equal(result.activated, true)
    assert.equal(result.status, 'CONFIRMED')
    assert.equal(rows[0].status, 'APPROVED')
    assert.equal(rows[0].verificationResult, 'zinipay-trx-confirmed')
    assert.equal(activationState.subscriptions.length, 1)
    assert.equal(activationState.userRoles.length, 1)

    // The reference is trimmed for the provider and only ever stored masked.
    assert.deepEqual(provider.calls.map((call) => call.step), ['verify', 'confirm'])
    assert.equal(provider.calls[0].params.transactionId, 'TXN123456789')
    assert.equal(provider.calls[1].params.id, 1234)

    const trx = readTrxEvidence(rows[0].providerVerification)
    assert.equal(trx?.confirmStatus, 'CONFIRMED')
    assert.equal(trx?.attempts, 1)
    assert.equal(trx?.referenceMasked, '********6789')
    assert.equal(JSON.stringify(rows[0].providerVerification).includes('TXN123456789'), false, 'the raw reference must never be stored')
    // The invoice facts recorded earlier stay where they are.
    assert.equal(readProviderEvidence(rows[0].providerVerification)?.providerStatus, 'PENDING')
  } finally {
    db.restore()
  }
})

test('an amount that does not match the payment is never confirmed and never activated', async () => {
  const rows = [{ ...OPEN_PAYMENT }]
  const db = installFakeDatabase(rows)
  const provider = fakeProvider({ verify: { ...VERIFIED, amount: 600 } })

  try {
    await assert.rejects(
      verifyPaymentTransaction(
        { paymentId: 'payment-1', userId: 'user-1', transactionId: 'TXN123456789' },
        { env: ENABLED_ENV, verifyTransaction: provider.verifyTransaction, confirmTransaction: provider.confirmTransaction },
      ),
      (error: { statusCode?: number }) => error.statusCode === 422,
    )

    assert.deepEqual(provider.calls.map((call) => call.step), ['verify'], 'a mismatched transaction must not be consumed')
    assert.equal(rows[0].status, 'PENDING')
    assert.equal(activationState.subscriptions.length, 0)
    assert.equal(readTrxEvidence(rows[0].providerVerification)?.lastFailure?.kind, 'amount-mismatch')
  } finally {
    db.restore()
  }
})

test('a refused verification activates nothing and is recorded', async () => {
  const rows = [{ ...OPEN_PAYMENT }]
  const db = installFakeDatabase(rows)
  const provider = fakeProvider({ verify: new ZiniPayTrxFailure('not-found', 404, 'Transaction not found') })

  try {
    await assert.rejects(
      verifyPaymentTransaction(
        { paymentId: 'payment-1', userId: 'user-1', transactionId: 'TXN123456789' },
        { env: ENABLED_ENV, verifyTransaction: provider.verifyTransaction, confirmTransaction: provider.confirmTransaction },
      ),
      (error: { statusCode?: number }) => error.statusCode === 422,
    )

    assert.deepEqual(provider.calls.map((call) => call.step), ['verify'])
    assert.equal(rows[0].status, 'PENDING')
    assert.equal(activationState.subscriptions.length, 0)
    const trx = readTrxEvidence(rows[0].providerVerification)
    assert.equal(trx?.lastFailure?.kind, 'not-found')
    assert.equal(trx?.attempts, 1)
  } finally {
    db.restore()
  }
})

test('a transaction the provider already consumed cannot activate premium', async () => {
  const rows = [{ ...OPEN_PAYMENT }]
  const db = installFakeDatabase(rows)
  const provider = fakeProvider({ verify: new ZiniPayTrxFailure('already-used', 400, 'Transaction is already used') })

  try {
    await assert.rejects(
      verifyPaymentTransaction(
        { paymentId: 'payment-1', userId: 'user-1', transactionId: 'TXN123456789' },
        { env: ENABLED_ENV, verifyTransaction: provider.verifyTransaction, confirmTransaction: provider.confirmTransaction },
      ),
      (error: { statusCode?: number }) => error.statusCode === 409,
    )

    assert.equal(rows[0].status, 'PENDING')
    assert.equal(activationState.subscriptions.length, 0)
  } finally {
    db.restore()
  }
})

test('an unclear confirm result activates nothing and says so', async () => {
  const rows = [{ ...OPEN_PAYMENT }]
  const db = installFakeDatabase(rows)
  const provider = fakeProvider({ confirm: new ZiniPayTrxFailure('timeout', null, 'timeout') })

  try {
    await assert.rejects(
      verifyPaymentTransaction(
        { paymentId: 'payment-1', userId: 'user-1', transactionId: 'TXN123456789' },
        { env: ENABLED_ENV, verifyTransaction: provider.verifyTransaction, confirmTransaction: provider.confirmTransaction },
      ),
      (error: { statusCode?: number; message: string }) => error.statusCode === 504 && /contact support/i.test(error.message),
    )

    assert.equal(rows[0].status, 'PENDING', 'premium is never activated on an unclear consumption')
    assert.equal(activationState.subscriptions.length, 0)
    const trx = readTrxEvidence(rows[0].providerVerification)
    assert.equal(trx?.confirmStatus, 'AMBIGUOUS')
    assert.equal(trx?.providerTransactionId, 1234, 'the provider id is kept so a human can finish the check')
  } finally {
    db.restore()
  }
})

test('a definite confirm refusal activates nothing', async () => {
  const rows = [{ ...OPEN_PAYMENT }]
  const db = installFakeDatabase(rows)
  const provider = fakeProvider({ confirm: new ZiniPayTrxFailure('device-offline', 403, 'Device is not connected with the service') })

  try {
    await assert.rejects(
      verifyPaymentTransaction(
        { paymentId: 'payment-1', userId: 'user-1', transactionId: 'TXN123456789' },
        { env: ENABLED_ENV, verifyTransaction: provider.verifyTransaction, confirmTransaction: provider.confirmTransaction },
      ),
      (error: { statusCode?: number }) => error.statusCode === 503,
    )

    assert.equal(rows[0].status, 'PENDING')
    assert.equal(readTrxEvidence(rows[0].providerVerification)?.confirmStatus, 'FAILED')
  } finally {
    db.restore()
  }
})

test('another customer\'s payment is reported as missing and never checked', async () => {
  const rows = [{ ...OPEN_PAYMENT }]
  const db = installFakeDatabase(rows)
  const provider = fakeProvider()

  try {
    await assert.rejects(
      verifyPaymentTransaction(
        { paymentId: 'payment-1', userId: 'someone-else', transactionId: 'TXN123456789' },
        { env: ENABLED_ENV, verifyTransaction: provider.verifyTransaction, confirmTransaction: provider.confirmTransaction },
      ),
      (error: { statusCode?: number }) => error.statusCode === 404,
    )

    assert.equal(provider.calls.length, 0, 'another customer must not be able to spend a verification credit')
  } finally {
    db.restore()
  }
})

test('a payment that is not an open hosted payment is never sent to the provider', async () => {
  const scenarios: Array<{ row: Partial<PaymentRecord>; status: number; name: string }> = [
    { name: 'a legacy provider', row: { provider: 'BKASH_MANUAL' }, status: 400 },
    { name: 'an approved payment', row: { status: 'APPROVED' }, status: 200 },
    { name: 'a failed payment', row: { status: 'FAILED' }, status: 409 },
    { name: 'a rejected payment', row: { status: 'REJECTED' }, status: 409 },
    { name: 'a payment with no invoice', row: { providerPaymentId: null }, status: 400 },
  ]

  for (const scenario of scenarios) {
    const rows = [{ ...OPEN_PAYMENT, ...scenario.row }]
    const db = installFakeDatabase(rows)
    const provider = fakeProvider()

    try {
      const outcome = await verifyPaymentTransaction(
        { paymentId: 'payment-1', userId: 'user-1', transactionId: 'TXN123456789' },
        { env: ENABLED_ENV, verifyTransaction: provider.verifyTransaction, confirmTransaction: provider.confirmTransaction },
      ).then((result) => ({ ok: result }), (error: { statusCode?: number }) => ({ error }))

      assert.equal(provider.calls.length, 0, `${scenario.name} must not reach the provider`)
      if ('error' in outcome) {
        assert.equal(outcome.error.statusCode, scenario.status, `${scenario.name} was answered with ${outcome.error.statusCode}`)
      } else {
        assert.equal(outcome.ok.activated, true, `${scenario.name} is already confirmed`)
      }
    } finally {
      db.restore()
    }
  }
})

test('a doubly raced activation reports success instead of activating twice', async () => {
  const rows = [{ ...OPEN_PAYMENT }]
  const db = installFakeDatabase(rows, { loseClaim: true })
  const provider = fakeProvider()

  try {
    const result = await verifyPaymentTransaction(
      { paymentId: 'payment-1', userId: 'user-1', transactionId: 'TXN123456789' },
      { env: ENABLED_ENV, verifyTransaction: provider.verifyTransaction, confirmTransaction: provider.confirmTransaction },
    )

    assert.equal(result.activated, true)
    assert.equal(activationState.subscriptions.length, 0, 'the losing writer must not activate anything of its own')
  } finally {
    db.restore()
  }
})

test('the capability is inert unless the deployment enables it', async () => {
  const rows = [{ ...OPEN_PAYMENT }]
  const db = installFakeDatabase(rows)
  const provider = fakeProvider()

  try {
    await assert.rejects(
      verifyPaymentTransaction(
        { paymentId: 'payment-1', userId: 'user-1', transactionId: 'TXN123456789' },
        { env: {} as NodeJS.ProcessEnv, verifyTransaction: provider.verifyTransaction, confirmTransaction: provider.confirmTransaction },
      ),
      (error: { statusCode?: number }) => error.statusCode === 503,
    )

    assert.equal(provider.calls.length, 0)
    assert.equal(isTransactionVerificationAvailable({} as NodeJS.ProcessEnv), false)
    assert.equal(isTransactionVerificationAvailable(ENABLED_ENV), true)
  } finally {
    db.restore()
  }
})

test('one payment cannot spend verification credits without limit', async () => {
  const rows = [{
    ...OPEN_PAYMENT,
    providerVerification: {
      ...(OPEN_PAYMENT.providerVerification as object),
      trxVerification: { source: 'trx-verify', attempts: 5, checkedAt: '2026-10-12T08:00:00.000Z' },
    },
  }]
  const db = installFakeDatabase(rows)
  const provider = fakeProvider()

  try {
    await assert.rejects(
      verifyPaymentTransaction(
        { paymentId: 'payment-1', userId: 'user-1', transactionId: 'TXN123456789' },
        { env: ENABLED_ENV, verifyTransaction: provider.verifyTransaction, confirmTransaction: provider.confirmTransaction },
      ),
      (error: { statusCode?: number }) => error.statusCode === 429,
    )

    assert.equal(provider.calls.length, 0)
  } finally {
    db.restore()
  }
})

test('a payment whose transaction was already consumed finishes activating without another provider call', async () => {
  const rows = [{
    ...OPEN_PAYMENT,
    providerVerification: {
      ...(OPEN_PAYMENT.providerVerification as object),
      trxVerification: {
        source: 'trx-verify',
        attempts: 1,
        confirmStatus: 'CONFIRMED',
        providerTransactionId: 1234,
        amount: 10,
        provider: 'bKash',
        senderMasked: '017****5678',
        verifyStatus: 'UNUSED',
        verifiedAt: '2026-10-12T08:00:00.000Z',
        confirmedAt: '2026-10-12T08:00:01.000Z',
        checkedAt: '2026-10-12T08:00:01.000Z',
      },
    },
  }]
  const db = installFakeDatabase(rows)
  const provider = fakeProvider()

  try {
    const result = await verifyPaymentTransaction(
      { paymentId: 'payment-1', userId: 'user-1', transactionId: 'TXN123456789' },
      { env: ENABLED_ENV, verifyTransaction: provider.verifyTransaction, confirmTransaction: provider.confirmTransaction },
    )

    assert.equal(result.activated, true)
    assert.equal(rows[0].status, 'APPROVED')
    assert.equal(activationState.subscriptions.length, 1)
    assert.equal(provider.calls.length, 0, 'a consumed transaction must never be verified or consumed again')
  } finally {
    db.restore()
  }
})

test('a reference that is not a reference is refused before any provider call', async () => {
  const invalid = ['', '   ', 'ABC', 'TXN123456789!', 'x'.repeat(41), 12345 as unknown as string]

  for (const value of invalid) {
    assert.throws(() => normalizeTransactionReference(value), /transaction id/i, `${JSON.stringify(value)} was accepted`)
  }

  // A dashed reference is normal for the provider, and stray spaces are a customer typing habit rather than
  // part of the reference: both must survive as the provider's own characters.
  assert.equal(normalizeTransactionReference(' TXN-123456789 '), 'TXN-123456789')
  assert.equal(normalizeTransactionReference('TXN 123 456789'), 'TXN123456789')

  const rows = [{ ...OPEN_PAYMENT }]
  const db = installFakeDatabase(rows)
  const provider = fakeProvider()
  try {
    await assert.rejects(
      verifyPaymentTransaction(
        { paymentId: 'payment-1', userId: 'user-1', transactionId: 'nope' },
        { env: ENABLED_ENV, verifyTransaction: provider.verifyTransaction, confirmTransaction: provider.confirmTransaction },
      ),
      (error: { statusCode?: number }) => error.statusCode === 400,
    )
    assert.equal(provider.calls.length, 0)
  } finally {
    db.restore()
  }
})
