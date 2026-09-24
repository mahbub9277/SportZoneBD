import { prisma } from '../../core/prisma.js';
import type { Prisma, SubscriptionStatus } from '@prisma/client'

export const findAllPlans = (includeDeleted = false) => {
  const where: Prisma.SubscriptionPlanWhereInput = includeDeleted ? {} : { deletedAt: null, status: 'ACTIVE' };

  return prisma.subscriptionPlan.findMany({
    where,
  });
};

export const findPlanById = (id: string) => {
  return prisma.subscriptionPlan.findFirst({
    where: {
      id,
      deletedAt: null, // Ensure we don't fetch soft-deleted plans
    },
  });
};

export const findActiveSubscriptionByUserId = (userId: string) => {
  return prisma.subscription.findFirst({
    where: {
      userId,
      status: 'ACTIVE',
      expiresAt: {
        gt: new Date(),
      },
    },
    include: {
      plan: true,
    },
  });
};

export const createSubscription = (data: Prisma.SubscriptionCreateInput | Prisma.SubscriptionUncheckedCreateInput) => {
  return prisma.subscription.create({
    data,
  });
};

export const updateSubscriptionStatus = (subscriptionId: string, status: SubscriptionStatus) => {
  return prisma.subscription.update({
    where: { id: subscriptionId },
    data: { status },
  });
};

export const createPlan = (data: Prisma.SubscriptionPlanCreateInput | Prisma.SubscriptionPlanUncheckedCreateInput) => {
  return prisma.subscriptionPlan.create({
    data,
  });
};

export const findPlanByName = (name: string) => {
  // Only find plans that have not been soft-deleted.
  return prisma.subscriptionPlan.findFirst({
    where: {
      name,
      deletedAt: null,
    },
  });
};

export const updatePlan = (id: string, data: Prisma.SubscriptionPlanUpdateInput | Prisma.SubscriptionPlanUncheckedUpdateInput) => {
  return prisma.subscriptionPlan.update({
    where: { id },
    data,
  });
};

export const deletePlan = (id: string) => {
  return prisma.subscriptionPlan.update({
    where: { id },
    data: { deletedAt: new Date() },
  });
};

export const restorePlan = (id: string) => {
  return prisma.subscriptionPlan.update({
    where: { id },
    data: { deletedAt: null },
  });
};

export const permanentlyDeletePlan = async (id: string) => {
  const [subscriptions, payments] = await Promise.all([
    prisma.subscription.count({ where: { planId: id } }),
    prisma.payment.count({ where: { subscriptionPlanId: id } }),
  ])
  if (subscriptions > 0 || payments > 0) {
    const error = new Error('This plan has historical subscriptions or payments and cannot be permanently deleted.')
    ;(error as Error & { code?: string }).code = 'PLAN_HISTORY_EXISTS'
    ;(error as Error & { statusCode?: number }).statusCode = 409
    throw error
  }
  return prisma.subscriptionPlan.delete({ where: { id } })
}