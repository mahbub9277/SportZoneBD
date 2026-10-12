import { prisma } from '../../core/prisma.js';
import { PaymentStatus } from '@prisma/client';
import { customAlphabet } from 'nanoid';
import { AppError } from '../../core/errors.js';
import logger from '../../core/logger.js';
import { getPaginatedData } from '../../services/pagination.service.js';
import { invalidateTags } from '../../core/cache.js';
import { canReviewSubmission } from '../../core/moderationRules.js';
import { applyApprovedPayment, loadApprovalContext } from './paymentWorkflow.js';
import {
  startHostedCheckout as startHostedCheckoutFlow,
  verifyHostedCheckout as verifyHostedCheckoutFlow,
  recheckHostedPayment as recheckHostedPaymentFlow,
  type HostedCheckoutDeps,
  type HostedCheckoutResult,
  type HostedRecheckResult,
  type StartHostedCheckoutResult,
} from './hostedCheckout.service.js';
import { resolveZiniPayWebhookReference } from './zinipay.webhook.js';
import { maskReference } from './referenceMask.js';

const nanoid = customAlphabet('1234567890abcdefghijklmnopqrstuvwxyz', 10);

interface CreatePaymentIntentArgs {
  userId: string;
  amount: number;
  subscriptionPlanId: string;
  provider: string;
}

/**
 * Creates a payment intent and records it in the database.
 * In a real app, this would interact with a payment provider like Stripe.
 * @param {CreatePaymentIntentArgs} args - The user ID and amount.
 * @returns The created payment record.
 */
export async function createPaymentIntent(args: CreatePaymentIntentArgs) {
  if (args.provider?.toLowerCase() === 'bkash') {
    throw new AppError(400, 'Use the manual bKash payment flow for this development environment.');
  }
  const plan = await prisma.subscriptionPlan.findUnique({
    where: { id: args.subscriptionPlanId },
    select: { id: true, deletedAt: true, status: true, price: true },
  });
  if (!plan || plan.deletedAt || plan.status !== 'ACTIVE') throw new AppError(404, 'Subscription plan not found.');
  return prisma.payment.create({
    data: {
      userId: args.userId,
      amount: plan.price,
      status: 'PENDING',
      provider: args.provider,
      transactionId: `txn_${nanoid()}`,
      currency: 'BDT',
      subscriptionPlanId: plan.id,
    },
  });
}

/**
 * Starts (or resumes) the hosted payment session for a plan.
 *
 * The customer never sends an amount: the price comes from the plan record the backend trusts, and only a
 * server-side verification of the invoice can activate Premium.
 */
export async function startHostedCheckout(args: {
  userId: string;
  subscriptionPlanId: string;
  customerEmail: string | null;
  customerName: string | null;
}): Promise<StartHostedCheckoutResult> {
  return startHostedCheckoutFlow(args);
}

/** Verifies the invoice behind a payment with the provider and reports the truthful outcome. */
export async function verifyHostedCheckout(args: {
  paymentId: string;
  userId: string | null;
}): Promise<HostedCheckoutResult> {
  return verifyHostedCheckoutFlow(args);
}

/**
 * Re-runs the provider-side verification for a hosted payment an administrator asked about.
 *
 * It is the same verification the customer's return page triggers, so an administrator can only ever see what
 * the provider actually reports: there is no way to approve, override or mark a payment as paid from here.
 */
export async function recheckHostedPayment(args: {
  paymentId: string;
}): Promise<HostedRecheckResult> {
  return recheckHostedPaymentFlow(args);
}

/**
 * Handles a provider callback for the hosted checkout.
 *
 * The callback carries no signature per the provider's own documentation, so it is only used to decide which
 * payment to look at: the payment is then proven by asking the provider from the server. A reference we do
 * not know is ignored without any provider request.
 */
export async function handleZiniPayWebhook(
  payload: {
    body: Record<string, unknown> | undefined;
    query: Record<string, unknown>;
  },
  deps: HostedCheckoutDeps = {},
): Promise<{ message: string }> {
  const reference = resolveZiniPayWebhookReference(payload.body, payload.query)
  if (!reference) {
    logger.warn('ZiniPay webhook carried no invoice reference');
    return { message: 'Ignored: no invoice reference.' };
  }

  const identifiers = [
    reference.invoiceId ? { providerPaymentId: reference.invoiceId } : null,
    reference.merchantReference ? { transactionId: reference.merchantReference } : null,
  ].filter((entry): entry is { providerPaymentId: string } | { transactionId: string } => entry !== null)

  const payment = await prisma.payment.findFirst({
    where: { deletedAt: null, OR: identifiers },
    select: { id: true },
  });

  if (!payment) {
    // Answering 200 keeps an unknown invoice from turning this URL into a way to make the server call the
    // provider over and over.
    logger.warn({ hasInvoiceId: Boolean(reference.invoiceId) }, 'ZiniPay webhook referenced an unknown payment');
    return { message: 'Ignored: unknown payment.' };
  }

  const result = await verifyHostedCheckoutFlow({ paymentId: payment.id, userId: null }, deps);
  return { message: `Checked: ${result.status}.` };
}

export interface PaymentReviewDecision {
  paymentId: string
  userId: string
  action: 'approve' | 'reject'
  before: PaymentStatus
  after: PaymentStatus
  amount: string
  currency: string
  planName: string | null
  transactionId: string
  subscriptionId: string | null
  reason: string | null
}

export interface PaymentReviewResult {
  payment: Awaited<ReturnType<typeof prisma.payment.findUnique>>
  decision: PaymentReviewDecision
}

/**
 * Approves a payment that is waiting for a decision and applies its subscription, atomically.
 *
 * This is the exception path: a payment arrives here only when the provider could not verify or confirm it,
 * so a human decides. The claim is a compare-and-set on `PENDING_REVIEW`, so two reviewers racing on the
 * same submission cannot both win: the loser's `updateMany` matches no row and is rejected. The reviewer is
 * recorded on the payment itself, and the submission owner is checked against the reviewer inside the same
 * transaction — a reviewer can never approve their own payment, and no client-supplied identity takes
 * part in either rule.
 */
export async function completePaymentAndUpdateSubscription(args: { paymentId: string; reviewerId: string }): Promise<PaymentReviewResult> {
  const { paymentId, reviewerId } = args;

  const result = await prisma.$transaction(async (tx) => {
    const context = await loadApprovalContext(tx, paymentId, { requireDistinctActor: reviewerId });

    const { subscriptionId } = await applyApprovedPayment(tx, context, {
      reviewedBy: reviewerId,
      verificationResult: 'manual-approved',
    });

    const updatedPayment = await tx.payment.findUnique({
      where: { id: paymentId },
      include: {
        user: { select: { id: true, fullName: true, email: true } },
        subscriptionPlan: { select: { id: true, name: true, durationDays: true } },
      },
    });

    const decision: PaymentReviewDecision = {
      paymentId,
      userId: context.userId,
      action: 'approve',
      before: 'PENDING_REVIEW',
      after: 'APPROVED',
      amount: context.amount,
      currency: context.currency,
      planName: context.planName,
      transactionId: context.transactionId,
      subscriptionId,
      reason: null,
    };

    return { payment: updatedPayment, decision };
  });

  await invalidateTags([`user:${result.decision.userId}`, 'user-list']);
  return result;
}

/**
 * Processes a webhook payload to verify and complete a payment.
 * @param webhookPayload - The payload from the payment provider's webhook.
 */
export async function verifyAndCompleteWebhookPayment(webhookPayload: { transactionId: string; [key: string]: any }) {
  const { transactionId } = webhookPayload;

  if (!transactionId) {
    throw new AppError(400, 'Webhook payload is missing transactionId.');
  }

  // The customer's transaction id is payment data: it is matched here, but never reproduced in a log line.
  const reference = maskReference(transactionId);

  // 1. Find the payment in our database using the transaction ID.
  const payment = await prisma.payment.findUnique({
    where: { transactionId },
    select: { status: true },
  });

  if (!payment) {
    logger.warn({ reference }, 'Webhook received for unknown transaction');
    // We return success to the provider to prevent retries for a non-existent transaction.
    return;
  }

  // 2. Idempotency Check: If payment is already completed, do nothing.
  if (payment.status === 'COMPLETED') {
    logger.info({ reference }, 'Webhook for already completed transaction - ignoring duplicate');
    return;
  }

  logger.info({ reference }, 'Automatic bKash verification is unavailable; payment remains pending review');
}

export async function getPaymentHistory(userId: string) {
  return prisma.payment.findMany({
    where: { userId, deletedAt: null },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    include: { subscriptionPlan: { select: { name: true } } },
  });
}

export async function clearPaymentHistory(userId: string) {
  const result = await prisma.payment.updateMany({
    where: { userId, deletedAt: null },
    data: { deletedAt: new Date() },
  })

  return { clearedCount: result.count }
}

export async function getAllPayments(args: { page: number; limit: number; search?: string; status?: string }) {
  const { page, limit, search, status } = args;
  const normalizedSearch = search?.trim();
  const statusAliases: Record<string, PaymentStatus> = {
    pending: PaymentStatus.PENDING,
    pending_review: PaymentStatus.PENDING_REVIEW,
    verified: PaymentStatus.COMPLETED,
    succeeded: PaymentStatus.COMPLETED,
    approved: PaymentStatus.APPROVED,
    completed: PaymentStatus.COMPLETED,
    rejected: PaymentStatus.REJECTED,
    failed: PaymentStatus.FAILED,
    refunded: PaymentStatus.REFUNDED,
    manual_verification: PaymentStatus.MANUAL_VERIFICATION,
  };
  const normalizedStatus = status?.trim().toLowerCase();
  const paymentStatus = normalizedStatus ? statusAliases[normalizedStatus] : undefined;

  if (normalizedStatus && !paymentStatus) {
    throw new AppError(400, 'Unsupported payment status filter.');
  }

  const where = {
    deletedAt: null,
    ...(paymentStatus ? { status: paymentStatus } : {}),
    ...(normalizedSearch ? {
      OR: [
        { transactionId: { contains: normalizedSearch, mode: 'insensitive' as const } },
        { provider: { contains: normalizedSearch, mode: 'insensitive' as const } },
        { user: { fullName: { contains: normalizedSearch, mode: 'insensitive' as const } } },
        { user: { email: { contains: normalizedSearch, mode: 'insensitive' as const } } },
        { subscriptionPlan: { name: { contains: normalizedSearch, mode: 'insensitive' as const } } },
      ],
    } : {}),
  };

  const [items, totalItems] = await prisma.$transaction([
    prisma.payment.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (page - 1) * limit,
      take: limit,
      include: { user: { select: { id: true, fullName: true, email: true } }, subscriptionPlan: { select: { id: true, name: true } } },
    }),
    prisma.payment.count({ where }),
  ]);

  // `reviewedBy` is a bare id column, so the reviewer's name is resolved once per page instead of
  // leaving the interface showing a uuid.
  const reviewerIds = [...new Set(items.map((item) => item.reviewedBy).filter((id): id is string => Boolean(id)))];
  const reviewers = reviewerIds.length > 0
    ? await prisma.user.findMany({ where: { id: { in: reviewerIds } }, select: { id: true, fullName: true } })
    : [];
  const reviewerNames = new Map(reviewers.map((reviewer) => [reviewer.id, reviewer.fullName]));

  return {
    items: items.map((item) => ({
      ...item,
      reviewedByName: item.reviewedBy ? reviewerNames.get(item.reviewedBy) ?? null : null,
    })),
    meta: { totalItems, itemCount: items.length, itemsPerPage: limit, totalPages: Math.ceil(totalItems / limit), currentPage: page },
  };
}

/**
 * The exception queue.
 *
 * Only payments that the provider verification could not finish appear here — a refusal, an unanswered
 * request or a confirmation that never completed. The customer's id is included so the reviewer's own
 * submission can be marked as not reviewable in the interface; the backend refuses it regardless.
 */
export async function getPendingVerifications() {
  return prisma.payment.findMany({
    where: { status: 'PENDING_REVIEW', deletedAt: null },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    include: {
      user: { select: { id: true, fullName: true, email: true } },
      subscriptionPlan: { select: { id: true, name: true, price: true, durationDays: true } },
    },
  });
}

/**
 * Records a reviewer's decision on a payment the automatic verification could not finish.
 *
 * Both decisions go through the same guards: the submission must still be waiting for a decision (checked
 * with a compare-and-set so a concurrent decision loses), and the reviewer may not be the person who
 * submitted it. The reviewer, the time and the reason are stored on the payment, and the decision summary
 * is returned so the caller can write the matching audit event.
 */
export async function processVerification(
  paymentId: string,
  action: 'approve' | 'reject',
  reviewerId: string,
  rejectionReason?: string,
): Promise<PaymentReviewResult> {
  if (action === 'approve') {
    return completePaymentAndUpdateSubscription({ paymentId, reviewerId });
  }

  return prisma.$transaction(async (tx) => {
    const existing = await tx.payment.findFirst({
      where: { id: paymentId, deletedAt: null },
      select: {
        userId: true,
        status: true,
        amount: true,
        currency: true,
        transactionId: true,
        subscriptionPlan: { select: { name: true } },
      },
    });

    if (!existing) throw new AppError(404, 'Payment not found.');
    if (!canReviewSubmission(reviewerId, existing.userId)) {
      throw new AppError(403, 'You cannot review a payment you submitted yourself.');
    }
    if (existing.status !== 'PENDING_REVIEW') throw new AppError(400, 'This payment is no longer pending review.');

    const reason = rejectionReason?.trim() ? rejectionReason.trim().slice(0, 500) : null;
    const result = await tx.payment.updateMany({
      where: { id: paymentId, status: 'PENDING_REVIEW' },
      data: { status: 'REJECTED', verificationResult: reason || 'manual-rejected', reviewedBy: reviewerId, reviewedAt: new Date(), rejectionReason: reason },
    });
    if (result.count === 0) throw new AppError(409, 'Payment is no longer pending review.');

    const payment = await tx.payment.findUnique({
      where: { id: paymentId },
      include: {
        user: { select: { id: true, fullName: true, email: true } },
        subscriptionPlan: { select: { id: true, name: true, durationDays: true } },
      },
    });
    if (!payment) throw new AppError(404, 'Payment not found.');

    await tx.notification.create({
      data: {
        userId: payment.userId,
        title: 'Payment Rejected',
        body: reason ? `Your subscription payment was rejected. Reason: ${reason}` : 'Your subscription payment was rejected.',
        type: 'error',
        channel: 'IN_APP',
      },
    });

    return {
      payment,
      decision: {
        paymentId,
        userId: existing.userId,
        action: 'reject' as const,
        before: 'PENDING_REVIEW' as PaymentStatus,
        after: 'REJECTED' as PaymentStatus,
        amount: existing.amount.toString(),
        currency: existing.currency,
        planName: existing.subscriptionPlan?.name ?? null,
        transactionId: existing.transactionId,
        subscriptionId: null,
        reason,
      },
    };
  });
}

/**
 * Premium members, read-only.
 *
 * The membership state is the same authoritative rule the rest of the platform uses: an `ACTIVE`
 * subscription that has not expired and is not deleted. A submitted or approved payment on its own never
 * makes anyone premium, which is why the payments are shown as the history behind the membership instead
 * of being used to decide it.
 */
export async function getPremiumMembers(args: { page: number; limit: number; search?: string; status?: string; planId?: string }) {
  const { page, limit, search, status, planId } = args
  const normalizedSearch = search?.trim()
  const now = new Date()

  const statusFilter = status?.trim().toUpperCase()
  const where = {
    deletedAt: null,
    ...(planId ? { planId } : {}),
    ...(statusFilter === 'ACTIVE' ? { status: 'ACTIVE' as const, expiresAt: { gt: now } } : {}),
    ...(statusFilter === 'EXPIRED' ? { OR: [{ status: 'EXPIRED' as const }, { status: 'ACTIVE' as const, expiresAt: { lte: now } }] } : {}),
    ...(statusFilter === 'CANCELLED' ? { status: 'CANCELLED' as const } : {}),
    ...(statusFilter === 'INACTIVE' ? { status: 'INACTIVE' as const } : {}),
    ...(normalizedSearch ? {
      user: {
        OR: [
          { fullName: { contains: normalizedSearch, mode: 'insensitive' as const } },
          { email: { contains: normalizedSearch, mode: 'insensitive' as const } },
          { username: { contains: normalizedSearch, mode: 'insensitive' as const } },
        ],
      },
    } : {}),
  }

  const [subscriptions, totalItems] = await prisma.$transaction([
    prisma.subscription.findMany({
      where,
      orderBy: [{ expiresAt: 'desc' }, { id: 'desc' }],
      skip: (page - 1) * limit,
      take: limit,
      select: {
        id: true,
        status: true,
        startedAt: true,
        expiresAt: true,
        autoRenew: true,
        createdAt: true,
        // The member's identity only: no password hash, tokens or other credentials are selected.
        user: { select: { id: true, fullName: true, email: true, avatar: true, isActive: true, isSuspended: true } },
        plan: { select: { id: true, name: true, price: true, durationDays: true, maxDevices: true } },
        // The five most recent payments behind the membership, which is the review history a moderator
        // needs to read. Bounded, so a member with years of history cannot inflate the page.
        payments: {
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: 5,
          select: {
            id: true,
            amount: true,
            currency: true,
            status: true,
            provider: true,
            transactionId: true,
            createdAt: true,
            reviewedAt: true,
            reviewedBy: true,
            rejectionReason: true,
            verificationResult: true,
            paymentMethod: { select: { displayName: true } },
          },
        },
      },
    }),
    prisma.subscription.count({ where }),
  ])

  const items = subscriptions.map((subscription) => {
    const approved = subscription.payments.filter((payment) => payment.status === 'APPROVED' || payment.status === 'COMPLETED')
    const rejected = subscription.payments.filter((payment) => payment.status === 'REJECTED')
    const latestPayment = subscription.payments[0] ?? null

    return {
      subscriptionId: subscription.id,
      member: subscription.user,
      plan: subscription.plan,
      membership: {
        status: subscription.status,
        startedAt: subscription.startedAt,
        expiresAt: subscription.expiresAt,
        autoRenew: subscription.autoRenew,
        isActive: subscription.status === 'ACTIVE' && subscription.expiresAt.getTime() > now.getTime(),
      },
      latestPayment: latestPayment
        ? {
            ...latestPayment,
            amount: latestPayment.amount.toString(),
            /** A payment is only successful once its review approved it. */
            isVerifiedPayment: latestPayment.status === 'APPROVED' || latestPayment.status === 'COMPLETED',
            isUnsuccessfulPayment: latestPayment.status === 'REJECTED' || latestPayment.status === 'FAILED' || latestPayment.status === 'REFUNDED',
            methodLabel: latestPayment.paymentMethod?.displayName ?? latestPayment.provider,
          }
        : null,
      paymentHistory: subscription.payments.map((payment) => ({
        ...payment,
        amount: payment.amount.toString(),
        isVerifiedPayment: payment.status === 'APPROVED' || payment.status === 'COMPLETED',
        isUnsuccessfulPayment: payment.status === 'REJECTED' || payment.status === 'FAILED' || payment.status === 'REFUNDED',
        methodLabel: payment.paymentMethod?.displayName ?? payment.provider,
      })),
      // Counts over the payments in this page, so the numbers describe exactly the history shown.
      paymentSummary: {
        recorded: subscription.payments.length,
        approved: approved.length,
        rejected: rejected.length,
      },
    }
  })

  return {
    items,
    meta: {
      totalItems,
      itemCount: items.length,
      itemsPerPage: limit,
      totalPages: Math.max(1, Math.ceil(totalItems / limit)),
      currentPage: page,
    },
  }
}