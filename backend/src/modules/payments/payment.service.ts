import { prisma } from '../../core/prisma.js';
import { PaymentStatus } from '@prisma/client';
import { customAlphabet } from 'nanoid';
import { AppError } from '../../core/errors.js';
import logger from '../../core/logger.js';
import { getPaginatedData } from '../../services/pagination.service.js';
import { invalidateTags } from '../../core/cache.js';
 
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
  const plan = await prisma.subscriptionPlan.findUnique({ where: { id: args.subscriptionPlanId } });
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
  const plan = await prisma.subscriptionPlan.findUnique({ where: { id: args.subscriptionPlanId } });
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

export async function completePaymentAndUpdateSubscription(args: { paymentId: string; reviewerId: string }) {
  const { paymentId, reviewerId } = args;

  return prisma.$transaction(async (tx) => {
    const payment = await tx.payment.findUnique({
      where: { id: paymentId },
      include: { subscriptionPlan: true },
    });

    if (!payment) throw new AppError(404, 'Payment not found.');
    if (payment.status !== 'PENDING_REVIEW') throw new AppError(400, 'This payment is no longer pending review.');
    if (!payment.subscriptionPlan || !payment.subscriptionPlanId) throw new AppError(400, 'Payment is not associated with a subscription plan.');

    const claimedPayment = await tx.payment.updateMany({
      where: { id: paymentId, status: 'PENDING_REVIEW' },
      data: { status: 'APPROVED', reviewedBy: reviewerId, reviewedAt: new Date() },
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

    await invalidateTags([`user:${payment.userId}`, 'user-list']);

    return tx.user.findUnique({ where: { id: payment.userId } });
  });
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
    orderBy: { createdAt: 'desc' },
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
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
      include: { user: { select: { id: true, fullName: true, email: true } }, subscriptionPlan: { select: { id: true, name: true } } },
    }),
    prisma.payment.count({ where }),
  ]);

  return {
    items,
    meta: { totalItems, itemCount: items.length, itemsPerPage: limit, totalPages: Math.ceil(totalItems / limit), currentPage: page },
  };
}

export async function getPendingVerifications() {
  return prisma.payment.findMany({
    where: { status: 'PENDING_REVIEW' },
    include: { user: { select: { fullName: true, email: true } }, subscriptionPlan: { select: { name: true, price: true, durationDays: true } } },
  });
}

export async function processVerification(paymentId: string, action: 'approve' | 'reject', reviewerId: string, rejectionReason?: string) {
  if (action === 'approve') {
    return completePaymentAndUpdateSubscription({ paymentId, reviewerId });
  }
  return prisma.$transaction(async (tx) => {
    const result = await tx.payment.updateMany({
      where: { id: paymentId, status: 'PENDING_REVIEW' },
      data: { status: 'REJECTED', verificationResult: rejectionReason || 'manual-rejected', reviewedBy: reviewerId, reviewedAt: new Date(), rejectionReason },
    });
    if (result.count === 0) throw new AppError(409, 'Payment is no longer pending review.');
    const payment = await tx.payment.findUnique({ where: { id: paymentId }, include: { subscriptionPlan: true } });
    if (!payment) throw new AppError(404, 'Payment not found.');
    await tx.notification.create({
      data: {
        userId: payment.userId,
        title: 'Payment Rejected',
        body: rejectionReason ? `Your subscription payment was rejected. Reason: ${rejectionReason}` : 'Your subscription payment was rejected.',
        type: 'error',
        channel: 'IN_APP',
      },
    });
    return payment;
  });
}