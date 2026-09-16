import { Router, type Router as ExpressRouter } from 'express'
import {
  getPlans,
  getPlanById,
  createPlan,
  updatePlan,
  deletePlan,
  restorePlan,
  permanentlyDeletePlan,
  getStatus,
} from './subscription.controller.js'
import type { RequestHandler } from 'express'
import { authenticate, requireRole } from '../../core/middleware/index.js'
import { cacheMiddleware } from '../../core/middleware/cache.middleware.js'
// It's a good practice to add input validation.
// You could use a library like express-validator or zod.
// import { body } from 'express-validator';

export const subscriptionRouter: ExpressRouter = Router()

// Group routes for the same path for better organization.
subscriptionRouter.get('/status', authenticate, getStatus as RequestHandler)

subscriptionRouter
  .route('/plans')
  // Public route to get plans for users - cache for 10 minutes
  .get((req, res, next) => {
    if (req.query.includeDeleted !== 'true') return next()
    return authenticate(req, res, (authError?: unknown) => {
      if (authError) return next(authError)
      return requireRole(['admin', 'super_admin'])(req, res, next)
    })
  }, cacheMiddleware(600, ['subscription-plans']), getPlans as RequestHandler)
  // Admin-only route to create a plan
  // TODO: Add validation middleware for the request body.
  .post(authenticate, requireRole(['admin', 'super_admin']), createPlan as RequestHandler)

subscriptionRouter
  .route('/plans/:id')
  // Public route for any user to get a single plan by ID - cache for 10 minutes
  .get(cacheMiddleware(600, ['subscription-plans']), getPlanById as RequestHandler)
  // Admin-only routes for managing a specific plan
  .patch(authenticate, requireRole(['admin', 'super_admin']), updatePlan as RequestHandler)
  .delete(authenticate, requireRole(['admin', 'super_admin']), deletePlan as RequestHandler)

subscriptionRouter.post('/plans/:id/restore', authenticate, requireRole(['admin', 'super_admin']), restorePlan as RequestHandler)
subscriptionRouter.delete('/plans/:id/permanent', authenticate, requireRole(['admin', 'super_admin']), permanentlyDeletePlan as RequestHandler)
