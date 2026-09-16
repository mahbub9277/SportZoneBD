import { prisma } from '../../core/prisma.js';

export const findAllPlans = (includeDeleted = false) => {
  const where = includeDeleted ? {} : { deletedAt: null, status: 'ACTIVE' };

  return prisma.subscriptionPlan.findMany({
    where,
  });
};

export const findPlanById = (id) => {
  return prisma.subscriptionPlan.findFirst({
    where: {
      id,
      deletedAt: null, // Ensure we don't fetch soft-deleted plans
    },
  });
};

export const findActiveSubscriptionByUserId = (userId) => {
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

export const createSubscription = (data) => {
  return prisma.subscription.create({
    data,
  });
};

export const updateSubscriptionStatus = (subscriptionId, status) => {
  return prisma.subscription.update({
    where: { id: subscriptionId },
    data: { status },
  });
};

export const createPlan = (data) => {
  return prisma.subscriptionPlan.create({
    data,
  });
};

export const findPlanByName = (name) => {
  // Only find plans that have not been soft-deleted.
  return prisma.subscriptionPlan.findFirst({
    where: {
      name,
      deletedAt: null,
    },
  });
};

export const updatePlan = (id, data) => {
  return prisma.subscriptionPlan.update({
    where: { id },
    data,
  });
};

export const deletePlan = (id) => {
  return prisma.subscriptionPlan.update({
    where: { id },
    data: { deletedAt: new Date() },
  });
};

export const restorePlan = (id) => {
  return prisma.subscriptionPlan.update({
    where: { id },
    data: { deletedAt: null },
  });
};

export const permanentlyDeletePlan = async (id) => {
  const [subscriptions, payments] = await Promise.all([
    prisma.subscription.count({ where: { planId: id } }),
    prisma.payment.count({ where: { subscriptionPlanId: id } }),
  ])
  if (subscriptions > 0 || payments > 0) {
    const error = new Error('This plan has historical subscriptions or payments and cannot be permanently deleted.')
    error.code = 'PLAN_HISTORY_EXISTS'
    error.statusCode = 409
    throw error
  }
  return prisma.subscriptionPlan.delete({ where: { id } })
}