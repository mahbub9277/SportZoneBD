/**
 * The hosted checkout: SportZoneBD creates the payment session, ZiniPay hosts the payment page, and only a
 * server-side verification of that invoice activates Premium.
 *
 * Order of operations, and why:
 *
 * 1. the payment record is written before the provider is asked for an invoice, so an attempt that fails is
 *    still an honest record and never an orphaned provider session;
 * 2. the provider's own invoice id is stored on the payment (unique), which is what makes a payment
 *    reconcilable from a webhook that only carries an invoice reference;
 * 3. the customer's browser is only ever sent to the returned `payment_url`; a redirect back is not proof of
 *    anything, so the return page triggers a server-side check instead;
 * 4. verification is throttled per payment, so refreshing the return page cannot become a request storm;
 * 5. a `COMPLETED` invoice activates the subscription through the shared compare-and-set, so the webhook and
 *    the return page racing each other still activate premium exactly once.
 */
import { customAlphabet } from 'nanoid'
import type { Prisma } from '@prisma/client'
import { prisma } from '../../core/prisma.js'
import { AppError } from '../../core/errors.js'
import logger from '../../core/logger.js'
import { invalidateTags } from '../../core/cache.js'
import { createPendingPaymentRecord, loadActivePlan, applyApprovedPayment, type ApprovalContext } from './paymentWorkflow.js'
import { resolvePaymentUrlConfig } from './paymentUrls.js'
import {
  buildProviderEvidence,
  readProviderEvidence,
  readTrxEvidence,
  toAdminEvidenceView,
  withTrxEvidence,
} from './providerEvidence.js'
import {
  ZiniPayCheckoutFailure,
  createZiniPayInvoice,
  getZiniPayCheckoutStatus,
  isZiniPayCheckoutConfigured,
  verifyZiniPayInvoice,
  type ZiniPayInvoiceCheck,
} from './zinipay.checkout.client.js'

const reference = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 12)

/** How long a hosted payment session may be reused instead of creating another invoice. */
const CHECKOUT_REUSE_MINUTES = 30
/**
 * How long a reservation may exist without an invoice before it is treated as abandoned. It only has to cover
 * a provider call that is still in flight, so it is comfortably longer than `ZINIPAY_TIMEOUT_MS`.
 */
const CHECKOUT_RESERVATION_TTL_MS = 120_000
/** How long a racing request waits for the winner's invoice before it is told to try again. */
const RESERVATION_WAIT_MS = 4_000
const RESERVATION_POLL_INTERVAL_MS = 400
/** The shortest interval between two server-side invoice checks for the same payment. */
const VERIFY_THROTTLE_MS = 5_000

export type HostedCheckoutStatus = 'PENDING' | 'COMPLETED' | 'FAILED' | 'UNKNOWN'

export interface HostedCheckoutResult {
  status: HostedCheckoutStatus
  /** A sentence the customer may see. */
  message: string
  paymentId: string
}

/** The stored, non-authoritative facts about the provider session behind a payment. */
interface CheckoutState {
  url: string | null
  environment: string | null
  createdAt: string | null
  lastCheckedAt: string | null
  lastStatus: string | null
  lastFailure: { kind: string; at: string; note: string | null } | null
}

/** Prisma stores the state as JSON; the domain type is a plain object with known keys. */
const asJson = (value: unknown) => value as unknown as Prisma.InputJsonValue

/** An open hosted session: the reservation row and, once the provider has answered, its payment page. */
interface OpenSession {
  id: string
  url: string | null
  amount: string
  currency: string
  /** Reuse is bounded: a session opened long ago is not handed out again. */
  sessionStartedAt: Date
  reservedAt: Date | null
}

function isReservationStale(reservedAt: Date | null, now: Date): boolean {
  if (!reservedAt) return false
  return now.getTime() - reservedAt.getTime() > CHECKOUT_RESERVATION_TTL_MS
}

/**
 * The customer's open session for this plan, if there is one.
 *
 * Only rows that carry a reservation timestamp are considered: those are the rows this flow created for a
 * hosted session, so legacy and unrelated payments can never be reused or blocked by it.
 */
async function findOpenSession(userId: string, subscriptionPlanId: string, now: () => Date): Promise<OpenSession | null> {
  const row = await prisma.payment.findFirst({
    where: {
      userId,
      subscriptionPlanId,
      provider: 'zinipay',
      status: 'PENDING',
      deletedAt: null,
      checkoutReservationAt: { not: null },
      createdAt: { gte: new Date(now().getTime() - CHECKOUT_REUSE_MINUTES * 60_000) },
    },
    orderBy: { createdAt: 'desc' },
    select: { id: true, amount: true, currency: true, providerCheckout: true, checkoutReservationAt: true, createdAt: true },
  })
  if (!row) return null

  return {
    id: row.id,
    url: readCheckoutState(row.providerCheckout).url,
    amount: row.amount.toString(),
    currency: row.currency,
    sessionStartedAt: row.createdAt,
    reservedAt: row.checkoutReservationAt,
  }
}

/**
 * Waits briefly for a reservation that is still being turned into an invoice.
 *
 * This is what a double click hits: the winner has already reserved and is calling the provider, so the loser
 * polls the row instead of creating a second invoice. Polling is outside any transaction and bounded.
 */
async function waitForSessionUrl(
  paymentId: string,
  now: () => Date,
  deps: HostedCheckoutDeps,
): Promise<OpenSession | null> {
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => { setTimeout(resolve, ms) }))
  const deadline = now().getTime() + RESERVATION_WAIT_MS

  while (now().getTime() < deadline) {
    await sleep(RESERVATION_POLL_INTERVAL_MS)

    const row = await prisma.payment.findFirst({
      where: { id: paymentId },
      select: { id: true, amount: true, currency: true, providerCheckout: true, status: true, checkoutReservationAt: true, createdAt: true },
    })
    if (!row) return null
    if (row.status !== 'PENDING') return null

    const url = readCheckoutState(row.providerCheckout).url
    if (url) {
      return {
        id: row.id,
        url,
        amount: row.amount.toString(),
        currency: row.currency,
        sessionStartedAt: row.createdAt,
        reservedAt: row.checkoutReservationAt,
      }
    }
  }

  return null
}

/**
 * Closes a reservation that never produced an invoice.
 *
 * The update is conditional on the row still being an open reservation, so it can never fail a session that
 * the winner finished attaching an invoice to in the meantime.
 */
async function abandonReservation(paymentId: string): Promise<void> {
  const closed = await prisma.payment.updateMany({
    where: { id: paymentId, status: 'PENDING', providerPaymentId: null, checkoutReservationAt: { not: null } },
    data: {
      status: 'FAILED',
      verificationResult: 'zinipay-checkout-abandoned',
      providerCheckout: asJson({ url: null, environment: null, createdAt: null, lastCheckedAt: null, lastStatus: null, lastFailure: { kind: 'reservation-expired', at: new Date().toISOString(), note: null } }),
    },
  })

  if (closed.count > 0) {
    logger.warn({ paymentId }, 'ZiniPay checkout reservation expired without an invoice')
  }
}

export function isHostedCheckoutAvailable(env: NodeJS.ProcessEnv = process.env): boolean {
  return isZiniPayCheckoutConfigured(env)
}

/** Strips everything but the stored facts, without trusting the stored shape. */
function readCheckoutState(value: unknown): CheckoutState {
  const record = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
  const text = (key: string) => (typeof record[key] === 'string' ? (record[key] as string) : null)
  return {
    url: text('url'),
    environment: text('environment'),
    createdAt: text('createdAt'),
    lastCheckedAt: text('lastCheckedAt'),
    lastStatus: text('lastStatus'),
    lastFailure: typeof record.lastFailure === 'object' && record.lastFailure !== null
      ? (record.lastFailure as CheckoutState['lastFailure'])
      : null,
  }
}

/** True when the last server-side check is too recent to repeat at the provider. */
export const isVerifyThrottled = (state: CheckoutState): boolean =>
  Boolean(state.lastCheckedAt) &&
  Date.now() - new Date(state.lastCheckedAt as string).getTime() < VERIFY_THROTTLE_MS &&
  state.lastStatus === 'PENDING'

/**
 * Builds the next provider-evidence record in its stored shape.
 *
 * Only ever called with the provider's own verified answer, so the record cannot be polluted by a callback
 * payload or a customer-supplied value. A later answer that omits a fact cannot erase an earlier one.
 */
function nextEvidence(
  payment: PaymentRow,
  check: ZiniPayInvoiceCheck | undefined,
  failure: { kind: string; note?: string | null } | null,
): Prisma.InputJsonValue {
  const previousRaw = payment.providerVerification
  const evidence = buildProviderEvidence(
    readProviderEvidence(previousRaw),
    {
      invoiceId: payment.providerPaymentId,
      expectedMerchantReference: payment.transactionId,
      check,
      failure,
    },
    new Date(),
  )

  // A transaction verification recorded for the same payment stays where it is: the invoice record and the
  // transaction record describe different facts and neither may overwrite the other.
  const trx = readTrxEvidence(previousRaw)
  return asJson(trx ? withTrxEvidence(evidence, trx) : evidence)
}

export interface HostedCheckoutDeps {
  env?: NodeJS.ProcessEnv
  /** Provider calls, replaceable in tests. Defaults to the real ZiniPay client. */
  createInvoice?: typeof createZiniPayInvoice
  verifyInvoice?: typeof verifyZiniPayInvoice
  /** Clock, replaceable in tests. */
  now?: () => Date
  /** Sleep used while waiting for a concurrent reservation, replaceable in tests. */
  sleep?: (ms: number) => Promise<void>
}

export interface StartHostedCheckoutArgs {
  userId: string
  subscriptionPlanId: string
  customerEmail: string | null
  customerName: string | null
}

export interface StartHostedCheckoutResult {
  paymentId: string
  paymentUrl: string
  amount: string
  currency: string
  planName: string
  reused: boolean
}

/**
 * Creates (or resumes) the hosted payment session for a plan.
 *
 * Concurrency is handled by the database, not by the read-then-write check: the payment row that backs a
 * session is the reservation, and the partial unique index on (`userId`, `subscriptionPlanId`) for open
 * reservations means two simultaneous requests for the same customer and plan cannot both create an invoice.
 * The loser of that race waits for the winner's invoice and then reuses it, so a double click resolves to one
 * usable session instead of an error. Different customers, and the same customer on a different plan, are
 * unaffected.
 *
 * The provider call happens outside any transaction, so a slow or hanging provider never holds a database
 * transaction open. A reservation that never produced an invoice (a crash or a provider timeout) is not
 * reused: after `CHECKOUT_RESERVATION_TTL_MS` it is failed and a fresh attempt is allowed.
 */
export async function startHostedCheckout(
  args: StartHostedCheckoutArgs,
  deps: HostedCheckoutDeps = {},
): Promise<StartHostedCheckoutResult> {
  return startHostedCheckoutAttempt(args, deps, 0)
}

/**
 * One attempt at creating the session, and at most one retry.
 *
 * The retry exists for the case where the request that won the reservation died before its invoice was
 * attached: the loser has waited, found nothing usable and is not going to be answered by a session that no
 * longer exists, so it reserves instead. `attempt` bounds that, so a repeatedly failing provider can never
 * turn one request into a loop.
 */
async function startHostedCheckoutAttempt(
  args: StartHostedCheckoutArgs,
  deps: HostedCheckoutDeps,
  attempt: number,
): Promise<StartHostedCheckoutResult> {
  const env = deps.env ?? process.env
  const createInvoice = deps.createInvoice ?? createZiniPayInvoice
  const now = deps.now ?? (() => new Date())

  if (!isHostedCheckoutAvailable(env)) {
    throw new AppError(503, 'Online payment is temporarily unavailable.')
  }
  if (!args.customerEmail) {
    throw new AppError(400, 'Your account has no email address, so a payment session cannot be created.')
  }

  const plan = await loadActivePlan(args.subscriptionPlanId)
  const urls = resolvePaymentUrlConfig(env)

  const existing = await findOpenSession(args.userId, plan.id, now)
  if (existing) {
    const resolved = existing.url
      ? existing
      : await waitForSessionUrl(existing.id, now, deps)

    if (resolved?.url) {
      return {
        paymentId: resolved.id,
        paymentUrl: resolved.url,
        amount: resolved.amount,
        currency: resolved.currency,
        planName: plan.name,
        reused: true,
      }
    }

    if (isReservationStale(existing.reservedAt, now())) {
      // The reservation never became a payable session, so it is closed and this attempt may reserve again.
      await abandonReservation(existing.id)
    } else {
      throw new AppError(409, 'A payment session for this plan is already being created. Please try again in a moment.')
    }
  }

  const merchantReference = `SZBD-${reference()}`
  const reservedAt = now()
  const payment = await createPendingPaymentRecord({
    userId: args.userId,
    subscriptionPlanId: plan.id,
    amount: plan.price,
    transactionId: merchantReference,
    provider: 'zinipay',
    status: 'PENDING',
    verificationResult: 'zinipay-checkout-created',
    checkoutReservationAt: reservedAt,
    providerCheckout: asJson({ url: null, environment: null, createdAt: null, lastCheckedAt: null, lastStatus: null, lastFailure: null }),
    // The unique index is the gate: a duplicate means another request already holds the reservation, which is
    // waited for below instead of turning into a second invoice.
    conflict: 'null',
    notification: {
      title: 'Payment Started',
      body: `Continue the payment for your ${plan.name} plan on the secure payment page. Premium activates automatically once the payment is confirmed.`,
    },
  })

  if (!payment) {
    const winner = await findOpenSession(args.userId, plan.id, now)
    if (winner?.url) {
      return {
        paymentId: winner.id,
        paymentUrl: winner.url,
        amount: winner.amount,
        currency: winner.currency,
        planName: plan.name,
        reused: true,
      }
    }

    // The other request is holding the reservation while it calls the provider, which is what a double click
    // looks like. Waiting here is what turns it into the same usable session rather than an error.
    const settled = winner ? await waitForSessionUrl(winner.id, now, deps) : null
    if (settled?.url) {
      logger.info({ paymentId: settled.id }, 'ZiniPay checkout race resolved onto the winner session')
      return {
        paymentId: settled.id,
        paymentUrl: settled.url,
        amount: settled.amount,
        currency: settled.currency,
        planName: plan.name,
        reused: true,
      }
    }

    // Nothing is holding the reservation any more (the winner failed or was abandoned), so this request may
    // reserve for itself rather than telling the customer to try again for no reason.
    const stillOpen = await findOpenSession(args.userId, plan.id, now)
    if (!stillOpen && attempt === 0) {
      logger.warn({ attempt }, 'ZiniPay checkout race left no open session; reserving again')
      return startHostedCheckoutAttempt(args, deps, attempt + 1)
    }

    throw new AppError(409, 'A payment session for this plan is already being created. Please try again in a moment.')
  }

  try {
    const invoice = await createInvoice({
      amount: Number(plan.price),
      customerEmail: args.customerEmail,
      customerName: args.customerName,
      merchantReference,
      redirectUrl: urls.redirectUrl(payment.id),
      cancelUrl: urls.cancelUrl(plan.id),
      // The callback is unsigned per the provider's own documentation, so it is used as a hint that
      // triggers a server-side verification and never as proof of payment.
      webhookUrl: urls.webhookUrl,
      metadata: { paymentId: payment.id, userId: args.userId, planId: plan.id },
    }, { env })

    const state: CheckoutState = {
      url: invoice.paymentUrl,
      environment: invoice.environment,
      createdAt: now().toISOString(),
      lastCheckedAt: null,
      lastStatus: null,
      lastFailure: null,
    }

    // Conditional on the reservation still being open: if it was abandoned in the meantime (a request that
    // waited past the TTL), nobody is sent to this invoice and the customer is asked to try again instead of
    // paying an invoice the platform no longer tracks as payable.
    const attached = await prisma.payment.updateMany({
      where: { id: payment.id, status: 'PENDING', checkoutReservationAt: { not: null } },
      data: { providerPaymentId: invoice.invoiceId, providerCheckout: asJson(state) },
    })

    if (attached.count === 0) {
      logger.warn({ paymentId: payment.id, environment: invoice.environment }, 'ZiniPay invoice was created but its reservation was gone')
      throw new ZiniPayCheckoutFailure('provider-error', null, 'the checkout reservation was replaced before the invoice was attached')
    }

    logger.info({ paymentId: payment.id, environment: invoice.environment }, 'ZiniPay hosted checkout created')

    return {
      paymentId: payment.id,
      paymentUrl: invoice.paymentUrl,
      amount: plan.price,
      currency: 'BDT',
      planName: plan.name,
      reused: false,
    }
  } catch (error) {
    const failure = error instanceof ZiniPayCheckoutFailure ? error : null
    // Diagnostics are the provider response's shape only (field names, flags, http status) — never values,
    // never the payment URL and never the API key — so a production failure is diagnosable from one log line.
    const diagnostics = failure?.diagnostics ?? null
    const failureNote = diagnostics === null
      ? (failure?.message ?? 'unknown').slice(0, 200)
      : `${(failure?.message ?? 'unknown').slice(0, 120)} (http=${diagnostics.httpStatus ?? 'n/a'} fields=${diagnostics.fields.join('|') || 'none'})`

    // The attempt is kept as a record, but it is not left looking like something the customer can still pay.
    await prisma.payment.updateMany({
      where: { id: payment.id, status: 'PENDING' },
      data: {
        status: 'FAILED',
        verificationResult: 'zinipay-checkout-failed',
        providerCheckout: asJson({
          url: null,
          environment: null,
          createdAt: new Date().toISOString(),
          lastCheckedAt: null,
          lastStatus: null,
          lastFailure: {
            kind: failure?.kind ?? 'unknown',
            at: new Date().toISOString(),
            note: failureNote,
          },
        }),
      },
    })

    logger.warn(
      { paymentId: payment.id, status: getZiniPayCheckoutStatus(error), kind: failure?.kind ?? 'unknown', diagnostics },
      'ZiniPay hosted checkout could not be created',
    )
    throw new AppError(503, failure?.userMessage ?? 'Online payment is temporarily unavailable.')
  }
}

export interface VerifyHostedCheckoutArgs {
  paymentId: string
  /** The customer who owns the payment, or null when a provider webhook is driving the check. */
  userId: string | null
}

interface PaymentRow {
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
}
async function loadPayment(paymentId: string): Promise<PaymentRow | null> {
  const payment = await prisma.payment.findFirst({
    where: { id: paymentId, deletedAt: null },
    select: {
      id: true,
      userId: true,
      provider: true,
      status: true,
      amount: true,
      currency: true,
      providerPaymentId: true,
      transactionId: true,
      providerCheckout: true,
      providerVerification: true,
      subscriptionPlanId: true,
      subscriptionPlan: { select: { name: true, durationDays: true } },
    },
  })
  if (!payment) return null
  return { ...payment, amount: payment.amount.toString() }
}

function messageForStatus(status: HostedCheckoutStatus, detail: string | null = null): string {
  switch (status) {
    case 'COMPLETED':
      return 'Payment confirmed and your subscription is now active.'
    case 'FAILED':
      return detail ?? 'The payment was not completed, so premium was not activated.'
    case 'UNKNOWN':
      return detail ?? 'The payment could not be confirmed with the payment provider.'
    case 'PENDING':
      return 'The payment provider has not confirmed this payment yet.'
  }
}

/**
 * Server-side verification of the invoice behind a payment, and the only place Premium is activated.
 *
 * Safe to call repeatedly: an already-decided payment is reported from the database, a check made moments
 * ago is not repeated at the provider, and two callers racing cannot both activate.
 */
export async function verifyHostedCheckout(
  args: VerifyHostedCheckoutArgs,
  deps: HostedCheckoutDeps = {},
): Promise<HostedCheckoutResult> {
  const env = deps.env ?? process.env
  const verifyInvoice = deps.verifyInvoice ?? verifyZiniPayInvoice

  const payment = await loadPayment(args.paymentId)
  if (!payment) throw new AppError(404, 'Payment not found.')
  // A payment that belongs to somebody else is reported as missing rather than as forbidden.
  if (args.userId && payment.userId !== args.userId) throw new AppError(404, 'Payment not found.')

  if (payment.status === 'APPROVED' || payment.status === 'COMPLETED') {
    return { status: 'COMPLETED', message: messageForStatus('COMPLETED'), paymentId: payment.id }
  }
  if (payment.status === 'REJECTED') {
    return { status: 'FAILED', message: messageForStatus('FAILED', 'This payment was not accepted.'), paymentId: payment.id }
  }
  if (payment.status === 'FAILED' || payment.status === 'REFUNDED') {
    return { status: 'FAILED', message: messageForStatus('FAILED'), paymentId: payment.id }
  }
  if (!payment.providerPaymentId) {
    throw new AppError(409, 'This payment has no provider session yet, so there is nothing to verify.')
  }
  if (!isHostedCheckoutAvailable(env)) {
    return { status: 'UNKNOWN', message: messageForStatus('UNKNOWN', 'Payment verification is temporarily unavailable.'), paymentId: payment.id }
  }

  const state = readCheckoutState(payment.providerCheckout)
  if (isVerifyThrottled(state)) {
    return { status: 'PENDING', message: messageForStatus('PENDING'), paymentId: payment.id }
  }

  let check: ZiniPayInvoiceCheck
  try {
    check = await verifyInvoice({ invoiceId: payment.providerPaymentId }, { env })
  } catch (error) {
    const failure = error instanceof ZiniPayCheckoutFailure ? error : null
    await storeCheckState(payment, state, {
      lastStatus: 'UNKNOWN',
      failureNote: failure?.message ?? 'unknown',
      failure: { kind: failure?.kind ? `provider-${failure.kind}` : 'provider-error', note: failure?.message ?? null },
    })
    logger.warn({ paymentId: payment.id, kind: failure?.kind ?? 'unknown' }, 'ZiniPay invoice could not be checked')

    if (failure?.kind === 'not-found') {
      return {
        status: 'UNKNOWN',
        message: messageForStatus('UNKNOWN', 'The payment provider no longer recognises this payment session, so nothing was activated. If money left your account, contact support with this reference.'),
        paymentId: payment.id,
      }
    }
    return { status: 'UNKNOWN', message: failure?.userMessage ?? messageForStatus('UNKNOWN'), paymentId: payment.id }
  }

  if (check.status === 'PENDING') {
    await storeCheckState(payment, state, { lastStatus: 'PENDING', check })
    return { status: 'PENDING', message: messageForStatus('PENDING'), paymentId: payment.id }
  }

  if (check.status === 'FAILED') {
    await prisma.payment.update({
      where: { id: payment.id },
      data: {
        status: 'FAILED',
        verificationResult: 'zinipay-invoice-failed',
        providerCheckout: asJson({ ...state, lastCheckedAt: new Date().toISOString(), lastStatus: 'FAILED' }),
        providerVerification: nextEvidence(payment, check, null),
      },
    })
    await invalidateTags([`user:${payment.userId}`])
    return { status: 'FAILED', message: messageForStatus('FAILED'), paymentId: payment.id }
  }

  return finalizeCompletedInvoice(payment, check, state)
}

/**
 * Activates the subscription for a `COMPLETED` invoice.
 *
 * Everything that could mean this is not the customer's payment is checked before the claim: the amount must
 * equal the amount stored for the plan, and the merchant reference and metadata the provider echoes back
 * must be the ones this payment was created with.
 */
async function finalizeCompletedInvoice(payment: PaymentRow, check: ZiniPayInvoiceCheck, state: CheckoutState): Promise<HostedCheckoutResult> {
  const expectedAmount = Number(payment.amount)
  if (check.amount === null || Math.round(check.amount * 100) !== Math.round(expectedAmount * 100)) {
    await prisma.payment.update({
      where: { id: payment.id },
      data: {
        verificationResult: 'zinipay-amount-mismatch',
        providerCheckout: asJson({ ...state, lastCheckedAt: new Date().toISOString(), lastStatus: 'COMPLETED' }),
        providerVerification: nextEvidence(payment, check, {
          kind: 'amount-mismatch',
          note: `provider amount ${check.amount ?? 'missing'} does not match the stored plan amount; premium not activated`,
        }),
      },
    })
    logger.error({ paymentId: payment.id, expected: expectedAmount, received: check.amount }, 'ZiniPay invoice amount does not match the stored payment')
    return {
      status: 'UNKNOWN',
      message: messageForStatus('UNKNOWN', 'The paid amount does not match this plan, so premium was not activated automatically. Our team will review the payment.'),
      paymentId: payment.id,
    }
  }

  if (check.merchantReference && check.merchantReference !== payment.transactionId) {
    await prisma.payment.update({
      where: { id: payment.id },
      data: {
        verificationResult: 'zinipay-reference-mismatch',
        providerVerification: nextEvidence(payment, check, {
          kind: 'reference-mismatch',
          note: 'the provider echoed a different merchant reference; premium not activated',
        }),
      },
    })
    logger.error({ paymentId: payment.id }, 'ZiniPay invoice reference does not match the stored payment')
    return {
      status: 'UNKNOWN',
      message: messageForStatus('UNKNOWN', 'The payment details do not match this purchase, so premium was not activated automatically. Our team will review the payment.'),
      paymentId: payment.id,
    }
  }

  if (check.metadata && typeof check.metadata.paymentId === 'string' && check.metadata.paymentId !== payment.id) {
    await prisma.payment.update({
      where: { id: payment.id },
      data: {
        verificationResult: 'zinipay-metadata-mismatch',
        providerVerification: nextEvidence(payment, check, {
          kind: 'metadata-mismatch',
          note: 'the provider echoed metadata for another payment; premium not activated',
        }),
      },
    })
    logger.error({ paymentId: payment.id }, 'ZiniPay invoice metadata belongs to another payment')
    return {
      status: 'UNKNOWN',
      message: messageForStatus('UNKNOWN', 'The payment details do not match this purchase, so premium was not activated automatically. Our team will review the payment.'),
      paymentId: payment.id,
    }
  }

  if (!payment.subscriptionPlan || !payment.subscriptionPlanId) {
    throw new AppError(500, 'The payment is not linked to a subscription plan.')
  }

  const context: ApprovalContext = {
    paymentId: payment.id,
    userId: payment.userId,
    status: 'PENDING',
    amount: payment.amount,
    currency: payment.currency,
    transactionId: payment.transactionId,
    subscriptionPlanId: payment.subscriptionPlanId,
    planName: payment.subscriptionPlan.name,
    planDurationDays: payment.subscriptionPlan.durationDays,
  }

  try {
    await prisma.$transaction(async (tx) => {
      await applyApprovedPayment(tx, context, {
        reviewedBy: null,
        verificationResult: 'zinipay-invoice-completed',
        // A hosted checkout starts at PENDING; the legacy review flow starts at PENDING_REVIEW.
        claimableStatuses: ['PENDING', 'PENDING_REVIEW'],
      })
    })
  } catch (error) {
    if (error instanceof AppError && error.statusCode === 409) {
      // Somebody else (the webhook, another tab) already activated this payment.
      return { status: 'COMPLETED', message: messageForStatus('COMPLETED'), paymentId: payment.id }
    }
    throw error
  }

  await prisma.payment.update({
    where: { id: payment.id },
    data: {
      providerCheckout: asJson({ ...state, lastCheckedAt: new Date().toISOString(), lastStatus: 'COMPLETED' }),
      providerVerification: nextEvidence(payment, check, null),
    },
  })
  await invalidateTags([`user:${payment.userId}`, 'user-list'])

  logger.info({ paymentId: payment.id, method: check.paymentMethod ?? 'unknown' }, 'ZiniPay hosted payment confirmed and activated')
  return { status: 'COMPLETED', message: messageForStatus('COMPLETED'), paymentId: payment.id }
}

async function storeCheckState(
  payment: PaymentRow,
  state: CheckoutState,
  update: { lastStatus: string; failureNote?: string; check?: ZiniPayInvoiceCheck; failure?: { kind: string; note?: string | null } | null },
) {
  const next: CheckoutState = {
    ...state,
    lastCheckedAt: new Date().toISOString(),
    lastStatus: update.lastStatus,
    lastFailure: update.failureNote
      ? { kind: `verify-${update.lastStatus.toLowerCase()}`, at: new Date().toISOString(), note: update.failureNote.slice(0, 200) }
      : state.lastFailure,
  }

  await prisma.payment.update({
    where: { id: payment.id },
    data: {
      providerCheckout: asJson(next),
      providerVerification: nextEvidence(payment, update.check, update.failure ?? null),
    },
  })
}

export interface HostedRecheckResult {
  outcome: HostedCheckoutStatus
  message: string
  paymentId: string
  /** False when nothing was asked of the provider, so the admin is not told a no-op succeeded. */
  providerContacted: boolean
  /** The sanitized evidence after the check, with references masked. */
  evidence: ReturnType<typeof toAdminEvidenceView>
  /** The payment's status after the check, for the admin's view and the audit event. */
  paymentStatus: string
}

/**
 * The admin recovery path for a hosted checkout that is stuck: it re-runs exactly the same server-side
 * invoice verification the customer's return page uses, so recovery is never a second, weaker path.
 *
 * This deliberately cannot approve anything. It has no override, no "mark as paid" and no way to set a
 * status: a payment becomes premium only if the provider itself reports the invoice as `COMPLETED` and every
 * consistency check passes, at which point the shared compare-and-set does the activation exactly once. A
 * payment that is already decided, or that never reached the provider, is refused before any provider call.
 */
export async function recheckHostedPayment(
  args: { paymentId: string },
  deps: HostedCheckoutDeps = {},
): Promise<HostedRecheckResult> {
  const env = deps.env ?? process.env

  const payment = await loadPayment(args.paymentId)
  if (!payment) throw new AppError(404, 'Payment not found.')

  if (payment.provider !== 'zinipay') {
    throw new AppError(400, 'Only payments made through the hosted ZiniPay checkout can be rechecked. Review this payment with the manual verification flow instead.')
  }
  if (payment.status === 'APPROVED' || payment.status === 'COMPLETED') {
    throw new AppError(400, 'This payment is already confirmed, so there is nothing to recheck.')
  }
  if (payment.status !== 'PENDING') {
    throw new AppError(400, `A payment with status ${payment.status} is closed and cannot be rechecked.`)
  }
  if (!payment.providerPaymentId) {
    throw new AppError(400, 'This payment never reached the payment provider, so there is no invoice to check. The customer can start the checkout again.')
  }

  const state = readCheckoutState(payment.providerCheckout)
  const throttled = isVerifyThrottled(state)
  const providerContacted = !throttled && isHostedCheckoutAvailable(env)

  const result = await verifyHostedCheckout({ paymentId: payment.id, userId: null }, deps)
  const stored = await prisma.payment.findFirst({
    where: { id: payment.id },
    select: { providerVerification: true, status: true },
  })

  return {
    outcome: result.status,
    message: throttled
      ? 'This payment was checked moments ago and the provider still has not confirmed it. Wait a few seconds and try again.'
      : result.message,
    paymentId: payment.id,
    providerContacted,
    evidence: toAdminEvidenceView(
      readProviderEvidence(stored?.providerVerification ?? payment.providerVerification),
      readTrxEvidence(stored?.providerVerification ?? payment.providerVerification),
    ),
    paymentStatus: stored?.status ?? payment.status,
  }
}
