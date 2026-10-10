import { Router, type Request, type Response, type Router as ExpressRouter } from 'express'
import { prisma } from '../../core/prisma.js'
import { successResponse } from '../../core/api-response.js'
import { validateBody } from '../../core/validation.js'
import {
  createIntent,
  completePayment,
  handleWebhook,
  getHistory,
  clearHistory,
  getAllPayments,
  getPendingVerifications,
  getPremiumMembers,
  processVerification,
  verifyManualPayment,
  getManualPaymentConfig,
  createIntentSchema,
  verifyPaymentSchema,
} from './payment.controller.js'
import type { RequestHandler } from 'express'
import { authenticate, requirePermission } from '../../core/middleware/index.js'

export const paymentRouter: ExpressRouter = Router()

paymentRouter.get('/methods', async (_req: Request, res: Response) => {
  const methods = await prisma.paymentMethod.findMany({
    where: { deletedAt: null },
    orderBy: { displayName: 'asc' },
    select: {
      id: true,
      name: true,
      displayName: true,
      enabled: true,
      createdAt: true,
      updatedAt: true,
    },
  })
  return res.json(successResponse(methods))
})

// This route will be called by the frontend to initiate a payment.
paymentRouter.post('/create-intent', authenticate, validateBody(createIntentSchema), createIntent as RequestHandler)

// This route completes the payment and updates the user's subscription.
paymentRouter.post('/complete', authenticate, completePayment as RequestHandler)
paymentRouter.get('/manual-config', authenticate, getManualPaymentConfig as RequestHandler)

// This route handles webhooks from payment providers
paymentRouter.post('/webhook/:provider', handleWebhook as RequestHandler);

// Payment records and the review queue. Both are gated by permission rather than by role name, so the
// same moderator console that lists payments is the only way in and the backend decides for itself.
paymentRouter.get('/', requirePermission('admin.payments.view'), getAllPayments as RequestHandler)

paymentRouter.get('/manual-verification', requirePermission('admin.payments.review'), getPendingVerifications as RequestHandler)
paymentRouter.patch('/manual-verification/:id', requirePermission('admin.payments.review'), processVerification as RequestHandler)

// Read-only premium membership view: subscription records joined with the payments behind them.
paymentRouter.get('/premium-members', requirePermission('admin.premium.view'), getPremiumMembers as RequestHandler)

// This route will be called by the frontend to get the user's payment history.
paymentRouter.get('/history', authenticate, getHistory as RequestHandler)
paymentRouter.delete('/history', authenticate, clearHistory as RequestHandler)

paymentRouter.post('/verify', authenticate, validateBody(verifyPaymentSchema), verifyManualPayment as RequestHandler)
