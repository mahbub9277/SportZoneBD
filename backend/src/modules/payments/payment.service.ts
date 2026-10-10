import { prisma } from '../../core/prisma.js';
import { PaymentStatus } from '@prisma/client';
import { customAlphabet } from 'nanoid';
import { AppError } from '../../core/errors.js';
import logger from '../../core/logger.js';
import { getPaginatedData } from '../../services/pagination.service.js';
import { invalidateTags } from '../../core/cache.js';
import { canReviewSubmission } from '../../core/moderationRules.js';
 
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

export async function getManualPaymentConfig() {
  const setting = await prisma.setting.findUnique({ where: { key: 'BKASH_MANUAL_PAYMENT_NUMBER' } });
  return { paymentNumber: setting?.value?.trim() || null };
}

export async function createManualPayment(args: { userId: string; subscriptionPlanId: string; transactionId: string }) {
  const plan = await prisma.subscriptionPlan.findUnique({
    where: { id: args.subscriptionPlanId },
    select: { id: true, deletedAt: true, status: true, price: true },
  });
  if (!plan || plan.deletedAt || plan.status !== 'ACTIVE') throw new AppError(404, 'Subscription plan not found.');

  try {
    return await prisma.$transaction(async (tx) => {
      const payment = await tx.payment.create({
        data: {
          userId: args.userId,
          subscriptionPlanId: plan.id,
          amount: plan.price,
          currency: 'BDT',
          provider: 'BKASH_MANUAL',
          transactionId: args.transactionId,
          status: 'PENDING_REVIEW',
          verificationResult: 'manual-verification-pending',
        },
        include: { subscriptionPlan: { select: { name: true, price: true, durationDays: true } } },
      });

      await tx.notification.create({
        data: {
          userId: args.userId,
          title: 'Payment Submitted',
          body: 'Your subscription payment is pending admin review.',
          type: 'info',
          channel: 'IN_APP',
        },
      });
      return payment;
    });
  } catch (error: any) {
    if (error?.code === 'P2002') throw new AppError(409, 'This Transaction ID has already been submitted.');
    throw error;
  }
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
 * Approves a pending manual payment and applies its subscription, atomically.
 *
 * The claim is a compare-and-set on `PENDING_REVIEW`, so two reviewers racing on the same submission
 * cannot both win: the loser's `updateMany` matches no row and is rejected. The reviewer is recorded on
 * the payment itself, and the submission owner is checked against the reviewer inside the same
 * transaction — a reviewer can never approve their own payment, and no client-supplied identity takes
 * part in either rule.
 */
export async function completePaymentAndUpdateSubscription(args: { paymentId: string; reviewerId: string }): Promise<PaymentReviewResult> {
  const { paymentId, reviewerId } = args;

  const result = await prisma.$transaction(async (tx) => {
    const payment = await tx.payment.findUnique({
      where: { id: paymentId },
      select: {
        userId: true,
        status: true,
        amount: true,
        currency: true,
        transactionId: true,
        subscriptionPlanId: true,
        subscriptionPlan: { select: { name: true, durationDays: true } },
      },
    });

    if (!payment) throw new AppError(404, 'Payment not found.');
    if (!canReviewSubmission(reviewerId, payment.userId)) {
      throw new AppError(403, 'You cannot review a payment you submitted yourself.');
    }
    if (payment.status !== 'PENDING_REVIEW') throw new AppError(400, 'This payment is no longer pending review.');
    if (!payment.subscriptionPlan || !payment.subscriptionPlanId) throw new AppError(400, 'Payment is not associated with a subscription plan.');

    const claimedPayment = await tx.payment.updateMany({
      where: { id: paymentId, status: 'PENDING_REVIEW' },
      data: { status: 'APPROVED', reviewedBy: reviewerId, reviewedAt: new Date(), verificationResult: 'manual-approved' },
    });
    if (claimedPayment.count === 0) throw new AppError(409, 'Payment is no longer pending review.');

    const now = new Date();
    const existingSubscription = await tx.subscription.findFirst({
      where: {
        userId: payment.userId,
        status: 'ACTIVE',
        expiresAt: {
          gt: now,
        },
        deletedAt: null,
      },
      orderBy: {
        expiresAt: 'desc',
      },
    });

    let subscriptionId: string;

    if (existingSubscription) {
      const extendedExpiry = new Date(existingSubscription.expiresAt);
      extendedExpiry.setDate(extendedExpiry.getDate() + payment.subscriptionPlan.durationDays);

      const updatedSubscription = await tx.subscription.update({
        where: { id: existingSubscription.id },
        data: {
          planId: payment.subscriptionPlanId,
          expiresAt: extendedExpiry,
          updatedAt: new Date(),
        },
      });

      subscriptionId = updatedSubscription.id;
    } else {
      const expiresAt = new Date(now);
      expiresAt.setDate(expiresAt.getDate() + payment.subscriptionPlan.durationDays);

      const subscription = await tx.subscription.create({
        data: {
          userId: payment.userId,
          planId: payment.subscriptionPlanId,
          status: 'ACTIVE',
          startedAt: now,
          expiresAt,
        },
      });

      subscriptionId = subscription.id;
    }

    const premiumUserRole = await tx.role.findUnique({
      where: { name: 'premium_user' },
      select: { id: true },
    });

    if (!premiumUserRole) {
      throw new AppError(500, '"premium_user" role not found in the database.');
    }

    await tx.userRole.upsert({
      where: {
        userId_roleId: {
          userId: payment.userId,
          roleId: premiumUserRole.id,
        },
      },
      create: { userId: payment.userId, roleId: premiumUserRole.id },
      update: {},
    });

    await tx.payment.update({
      where: { id: paymentId },
      data: { subscriptionId },
    });

    const expiryText = new Date(
      existingSubscription
        ? new Date(existingSubscription.expiresAt).getTime() + payment.subscriptionPlan.durationDays * 86400000
        : Date.now() + payment.subscriptionPlan.durationDays * 86400000,
    ).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
    await tx.notification.create({
      data: {
        userId: payment.userId,
        title: existingSubscription ? 'Premium Subscription Extended' : 'Premium Activated',
        body: existingSubscription
          ? `Your Premium subscription has been extended by ${payment.subscriptionPlan.durationDays} days. New expiry: ${expiryText}.`
          : `Your ${payment.subscriptionPlan.name} Premium subscription is now active. Valid until ${expiryText}.`,
        type: 'success',
        channel: 'IN_APP',
      },
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
      userId: payment.userId,
      action: 'approve',
      before: 'PENDING_REVIEW',
      after: 'APPROVED',
      amount: payment.amount.toString(),
      currency: payment.currency,
      planName: payment.subscriptionPlan.name,
      transactionId: payment.transactionId,
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

  // 1. Find the payment in our database using the transaction ID.
  const payment = await prisma.payment.findUnique({
    where: { transactionId },
    select: { status: true },
  });

  if (!payment) {
    logger.warn({ transactionId }, 'Webhook received for unknown transaction');
    // We return success to the provider to prevent retries for a non-existent transaction.
    return;
  }

  // 2. Idempotency Check: If payment is already completed, do nothing.
  if (payment.status === 'COMPLETED') {
    logger.info({ transactionId }, 'Webhook for already completed transaction - ignoring duplicate');
    return;
  }

  logger.info({ transactionId }, 'Automatic bKash verification is unavailable; payment remains pending review');
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
 * The manual review queue.
 *
 * The customer's id is included so the reviewer's own submission can be marked as not reviewable in the
 * interface; the backend refuses it regardless.
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
 * Records a reviewer's decision on a manual payment submission.
 *
 * Both decisions go through the same guards: the submission must still be pending review (checked with a
 * compare-and-set so a concurrent decision loses), and the reviewer may not be the person who submitted
 * it. The reviewer, the time and the reason are stored on the payment, and the decision summary is
 * returned so the caller can write the matching audit event.
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