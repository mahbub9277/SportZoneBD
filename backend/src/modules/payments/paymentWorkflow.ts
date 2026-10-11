/**
 * The trusted payment lifecycle steps, shared by the manual review flow and the automatic ZiniPay flow.
 *
 * Both flows must end the same way: the payment is claimed with a compare-and-set, the subscription is
 * created or extended, the premium role is granted, the payment is linked to the subscription, and the
 * customer is told. Keeping that in one place is what makes "no duplicate premium activation" true by
 * construction rather than by two implementations agreeing with each other.
 */
import type { Prisma, PaymentStatus } from '@prisma/client'
import { prisma } from '../../core/prisma.js'
import { AppError } from '../../core/errors.js'
import { canReviewSubmission } from '../../core/moderationRules.js'

export type PaymentTransaction = Prisma.TransactionClient

export interface ActiveSubscriptionPlan {
  id: string
  name: string
  price: string
  durationDays: number
}

/** Loads a plan that may be purchased: existing, not deleted, and active. */
export async function loadActivePlan(planId: string): Promise<ActiveSubscriptionPlan> {
  const plan = await prisma.subscriptionPlan.findUnique({
    where: { id: planId },
    select: { id: true, name: true, deletedAt: true, status: true, price: true, durationDays: true },
  })
  if (!plan || plan.deletedAt || plan.status !== 'ACTIVE') throw new AppError(404, 'Subscription plan not found.')

  return { id: plan.id, name: plan.name, price: plan.price.toString(), durationDays: plan.durationDays }
}

/**
 * Creates the payment record that a provider session is about to be created for.
 *
 * The reference (`transactionId`) is unique, so the database — not the application — decides that two
 * attempts cannot both own the same reference. The status is the one the flow starts in: a hosted checkout
 * starts at `PENDING`, the legacy review flow started at `PENDING_REVIEW`. The notification text is passed
 * in by the caller because only the caller knows which flow is running.
 */
export async function createPendingPaymentRecord(args: {
  userId: string
  subscriptionPlanId: string
  amount: string
  currency?: string
  transactionId: string
  provider: string
  verificationResult: string
  status?: PaymentStatus
  /**
   * Set when this row *is* the reservation behind a hosted checkout session. The partial unique index on
   * (`userId`, `subscriptionPlanId`) applies to exactly these rows, so one customer cannot hold two open
   * sessions for the same plan.
   */
  checkoutReservationAt?: Date
  providerCheckout?: Prisma.InputJsonValue
  /** `null` returns null on a duplicate reference instead of throwing, which callers turn into a lookup. */
  conflict?: 'throw' | 'null'
  notification: { title: string; body: string }
}) {
  try {
    return await prisma.$transaction(async (tx) => {
      const payment = await tx.payment.create({
        data: {
          userId: args.userId,
          subscriptionPlanId: args.subscriptionPlanId,
          amount: args.amount,
          currency: args.currency ?? 'BDT',
          provider: args.provider,
          transactionId: args.transactionId,
          status: args.status ?? 'PENDING_REVIEW',
          verificationResult: args.verificationResult,
          ...(args.checkoutReservationAt ? { checkoutReservationAt: args.checkoutReservationAt } : {}),
          ...(args.providerCheckout ? { providerCheckout: args.providerCheckout } : {}),
        },
        include: { subscriptionPlan: { select: { name: true, price: true, durationDays: true } } },
      })

      await tx.notification.create({
        data: {
          userId: args.userId,
          title: args.notification.title,
          body: args.notification.body,
          type: 'info',
          channel: 'IN_APP',
        },
      })

      return payment
    })
  } catch (error) {
    if ((error as { code?: string } | null)?.code === 'P2002') {
      if (args.conflict === 'null') return null
      throw new AppError(409, 'This payment reference has already been used.')
    }
    throw error
  }
}

export interface ApprovalContext {
  paymentId: string
  userId: string
  status: PaymentStatus
  amount: string
  currency: string
  transactionId: string
  subscriptionPlanId: string
  planName: string
  planDurationDays: number
}

/**
 * Reads the payment an approval is about to finalize, refusing anything that cannot be approved.
 *
 * The checks are ordered the way they always were: an unknown payment is 404, an administrator deciding on
 * their own submission is 403 (when an actor is given, which the automatic path has not), and a payment
 * that is no longer pending review or has no plan is 400.
 */
export async function loadApprovalContext(
  tx: PaymentTransaction,
  paymentId: string,
  options: { requireDistinctActor?: string } = {},
): Promise<ApprovalContext> {
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
  })

  if (!payment) throw new AppError(404, 'Payment not found.')
  if (options.requireDistinctActor && !canReviewSubmission(options.requireDistinctActor, payment.userId)) {
    throw new AppError(403, 'You cannot review a payment you submitted yourself.')
  }
  if (payment.status !== 'PENDING_REVIEW') throw new AppError(400, 'This payment is no longer pending review.')
  if (!payment.subscriptionPlan || !payment.subscriptionPlanId) throw new AppError(400, 'Payment is not associated with a subscription plan.')

  return {
    paymentId,
    userId: payment.userId,
    status: payment.status,
    amount: payment.amount.toString(),
    currency: payment.currency,
    transactionId: payment.transactionId,
    subscriptionPlanId: payment.subscriptionPlanId,
    planName: payment.subscriptionPlan.name,
    planDurationDays: payment.subscriptionPlan.durationDays,
  }
}

/**
 * Claims the payment and applies its subscription. Must be called inside a transaction.
 *
 * The claim is a compare-and-set on the statuses the caller allows, so two racing writers (a webhook and the
 * customer's return page, or two reviewers) cannot both win and a repeated call cannot activate premium
 * twice. `reviewedBy` is the administrator who decided, or null when the payment was verified by the
 * provider instead. The loser gets a 409, which callers treat as "somebody else already decided this".
 */
export async function applyApprovedPayment(
  tx: PaymentTransaction,
  context: ApprovalContext,
  options: { reviewedBy: string | null; verificationResult: string; claimableStatuses?: PaymentStatus[] },
): Promise<{ subscriptionId: string; extendedExistingSubscription: boolean }> {
  const claimed = await tx.payment.updateMany({
    where: { id: context.paymentId, status: { in: options.claimableStatuses ?? ['PENDING_REVIEW'] } },
    data: {
      status: 'APPROVED',
      verificationResult: options.verificationResult,
      ...(options.reviewedBy ? { reviewedBy: options.reviewedBy, reviewedAt: new Date() } : {}),
    },
  })
  if (claimed.count === 0) throw new AppError(409, 'Payment is no longer pending review.')

  const now = new Date()
  const existingSubscription = await tx.subscription.findFirst({
    where: {
      userId: context.userId,
      status: 'ACTIVE',
      expiresAt: { gt: now },
      deletedAt: null,
    },
    orderBy: { expiresAt: 'desc' },
  })

  let subscriptionId: string

  if (existingSubscription) {
    const extendedExpiry = new Date(existingSubscription.expiresAt)
    extendedExpiry.setDate(extendedExpiry.getDate() + context.planDurationDays)

    const updatedSubscription = await tx.subscription.update({
      where: { id: existingSubscription.id },
      data: { planId: context.subscriptionPlanId, expiresAt: extendedExpiry, updatedAt: new Date() },
    })

    subscriptionId = updatedSubscription.id
  } else {
    const expiresAt = new Date(now)
    expiresAt.setDate(expiresAt.getDate() + context.planDurationDays)

    const subscription = await tx.subscription.create({
      data: {
        userId: context.userId,
        planId: context.subscriptionPlanId,
        status: 'ACTIVE',
        startedAt: now,
        expiresAt,
      },
    })

    subscriptionId = subscription.id
  }

  const premiumUserRole = await tx.role.findUnique({ where: { name: 'premium_user' }, select: { id: true } })
  if (!premiumUserRole) throw new AppError(500, '"premium_user" role not found in the database.')

  await tx.userRole.upsert({
    where: { userId_roleId: { userId: context.userId, roleId: premiumUserRole.id } },
    create: { userId: context.userId, roleId: premiumUserRole.id },
    update: {},
  })

  await tx.payment.update({ where: { id: context.paymentId }, data: { subscriptionId } })

  const expiryText = new Date(
    existingSubscription
      ? new Date(existingSubscription.expiresAt).getTime() + context.planDurationDays * 86400000
      : Date.now() + context.planDurationDays * 86400000,
  ).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })

  await tx.notification.create({
    data: {
      userId: context.userId,
      title: existingSubscription ? 'Premium Subscription Extended' : 'Premium Activated',
      body: existingSubscription
        ? `Your Premium subscription has been extended by ${context.planDurationDays} days. New expiry: ${expiryText}.`
        : `Your ${context.planName} Premium subscription is now active. Valid until ${expiryText}.`,
      type: 'success',
      channel: 'IN_APP',
    },
  })

  return { subscriptionId, extendedExistingSubscription: Boolean(existingSubscription) }
}
