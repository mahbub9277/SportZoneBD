import * as subscriptionRepository from './subscription.repository.js';
import type { Prisma } from '@prisma/client'

/**
 * Retrieves all active subscription plans.
 * @returns {Promise<Array<object>>} A list of subscription plans.
 */
export const getAllPlans = async (includeDeleted = false) => {
  return subscriptionRepository.findAllPlans(includeDeleted);
};

/**
 * Retrieves the active subscription for a user.
 * @param {string} userId - The ID of the user.
 * @returns {Promise<object|null>} The user's active subscription or null.
 */
export const getUserSubscription = async (userId: string) => {
  const subscription =
    await subscriptionRepository.findActiveSubscriptionByUserId(userId);
  if (!subscription) {
    return null;
  }
  return subscription;
};

/**
 * Retrieves a single subscription plan by its ID.
 * @param {string} planId - The ID of the subscription plan.
 * @returns {Promise<object|null>} The subscription plan or null if not found.
 */
export const getPlanById = async (planId: string) => {
  return subscriptionRepository.findPlanById(planId);
};

export const getPlanByName = async (name: string) => {
  return subscriptionRepository.findPlanByName(name);
};

export const createNewPlan = async (planData: Record<string, any>) => {
  return subscriptionRepository.createPlan(normalizePlanData(planData) as Prisma.SubscriptionPlanCreateInput);
};

export const updateExistingPlan = async (planId: string, planData: Record<string, any>) => {
  // In a real app, you might want to check if the plan has active subscribers
  // before allowing certain changes.
  return subscriptionRepository.updatePlan(planId, normalizePlanData(planData));
};

function normalizePlanData(planData: Record<string, any>): Record<string, any> {
  const normalized = { ...planData };
  if (normalized.name !== undefined) {
    if (typeof normalized.name !== 'string' || normalized.name.trim().length < 2 || normalized.name.trim().length > 120) {
      const error = new Error('Plan name must be between 2 and 120 characters.')
      ;(error as Error & { statusCode?: number }).statusCode = 400
      throw error
    }
    normalized.name = normalized.name.trim()
  }
  if (normalized.status !== undefined && !['ACTIVE', 'INACTIVE', 'ARCHIVED'].includes(normalized.status)) {
    const error = new Error('Invalid subscription plan status.')
    ;(error as Error & { statusCode?: number }).statusCode = 400
    throw error
  }
  if (normalized.price !== undefined) {
    const price = Number(normalized.price)
    if (!Number.isFinite(price) || price < 0 || price > 10000000) {
      const error = new Error('Plan price must be a valid amount between 0 and 10,000,000.')
      ;(error as Error & { statusCode?: number }).statusCode = 400
      throw error
    }
    normalized.price = price
  }
  if (normalized.durationDays !== undefined) {
    const durationDays = Number(normalized.durationDays)
    if (!Number.isInteger(durationDays) || durationDays < 1 || durationDays > 3650) {
      const error = new Error('Plan duration must be a whole number between 1 and 3650 days.')
      ;(error as Error & { statusCode?: number }).statusCode = 400
      throw error
    }
    normalized.durationDays = durationDays
  }
  if (normalized.maxDevices !== undefined) {
    const maxDevices = Number(normalized.maxDevices);
    if (!Number.isInteger(maxDevices) || maxDevices < 1 || maxDevices > 20) {
      const error = new Error('Maximum devices must be a whole number between 1 and 20.');
      ;(error as Error & { statusCode?: number }).statusCode = 400;
      throw error;
    }
    normalized.maxDevices = maxDevices;
  }
  if (normalized.description === '') normalized.description = null;
  return normalized;
}

export const deleteExistingPlan = async (planId: string) => {
  // We perform a soft delete by setting the `deletedAt` field.
  // You might want to add checks here, e.g., not allowing deletion of plans
  // with active subscribers.
  return subscriptionRepository.deletePlan(planId);
};

export const restoreExistingPlan = async (planId: string) => {
  return subscriptionRepository.restorePlan(planId);
};

export const permanentlyDeleteExistingPlan = async (planId: string) => {
  const plan = await subscriptionRepository.findPlanById(planId)
  if (!plan || !plan.deletedAt) {
    const error = new Error('Only soft-deleted plans can be permanently deleted.')
    ;(error as Error & { statusCode?: number }).statusCode = 400
    throw error
  }
  return subscriptionRepository.permanentlyDeletePlan(planId)
}

// In a real-world scenario, you'd also have services for creating and canceling subscriptions,
// likely triggered by payment events or user actions.