import * as subscriptionService from './subscription.service.js';
import { successResponse, errorResponse } from '../../core/api-response.js';
import asyncHandler from '../../utils/asyncHandler.js';
import { Prisma } from '@prisma/client';
import { invalidateTags } from '../../core/cache.js'

export const getPlans = asyncHandler(async (req, res) => {
  const includeDeleted = req.query.includeDeleted === 'true' && ['admin', 'super_admin'].includes(req.user?.roles?.[0]?.name);
  const plans = await subscriptionService.getAllPlans(includeDeleted);
  res.status(200).json(successResponse(plans));
});

export const getPlanById = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const plan = await subscriptionService.getPlanById(id); // Assuming this service function exists

  if (!plan) {
    return res.status(404).json(errorResponse('Subscription plan not found.'));
  }

  res.status(200).json(successResponse(plan));
});

export const createPlan = asyncHandler(async (req, res) => {
  // Pre-check for duplicate plan name to return a clear 409 response.
  const name = req.body?.name;
  if (name) {
    const existing = await subscriptionService.getPlanByName(name);
    if (existing) {
      return res.status(409).json(errorResponse('A subscription plan with that name already exists.'));
    }
  }

  // Fall back to creating the plan and still handle DB unique constraint just in case of a race.
  try {
    const newPlan = await subscriptionService.createNewPlan(req.body);
    await invalidateTags(['subscription-plans'])
    return res.status(201).json(successResponse(newPlan, 'Subscription plan created successfully.'));
  } catch (error) {
    const isP2002 =
      error?.name === 'PrismaClientKnownRequestError' &&
      error?.code === 'P2002'

    if (isP2002 && error.meta?.target?.includes('name')) {
      return res.status(409).json(errorResponse('A subscription plan with that name already exists.'))
    }
    throw error
  }
});

export const updatePlan = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const updatedPlan = await subscriptionService.updateExistingPlan(id, req.body);
  await invalidateTags(['subscription-plans'])
  res.status(200).json(successResponse(updatedPlan, 'Subscription plan updated successfully.'));
});

export const deletePlan = asyncHandler(async (req, res) => {
  const { id } = req.params;
  await subscriptionService.deleteExistingPlan(id);
  await invalidateTags(['subscription-plans'])
  res.status(204).send();
});

export const restorePlan = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const restoredPlan = await subscriptionService.restoreExistingPlan(id);
  await invalidateTags(['subscription-plans'])
  res.status(200).json(successResponse(restoredPlan, 'Plan restored successfully.'));
});

export const getStatus = asyncHandler(async (req, res) => {
  const subscription = await subscriptionService.getUserSubscription(req.user.userId);
  res.status(200).json(successResponse(subscription));
});

export const permanentlyDeletePlan = asyncHandler(async (req, res) => {
  await subscriptionService.permanentlyDeleteExistingPlan(req.params.id)
  await invalidateTags(['subscription-plans'])
  res.status(204).send()
})