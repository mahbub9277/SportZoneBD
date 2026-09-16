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
  processVerification,
  verifyManualPayment,
  getManualPaymentConfig,
  createIntentSchema,
  verifyPaymentSchema,
} from './payment.controller.js'
import type { RequestHandler } from 'express'
import { authenticate, requireRole } from '../../core/middleware/index.js'

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

// Admin-only route to get all payments
paymentRouter.get('/', requireRole('admin'), getAllPayments as RequestHandler)

// Admin-only routes for manual verification
paymentRouter.get('/manual-verification', requireRole('admin'), getPendingVerifications as RequestHandler)
paymentRouter.patch('/manual-verification/:id', requireRole('admin'), processVerification as RequestHandler)

// This route will be called by the frontend to get the user's payment history.
paymentRouter.get('/history', authenticate, getHistory as RequestHandler)
paymentRouter.delete('/history', authenticate, clearHistory as RequestHandler)

paymentRouter.post('/verify', authenticate, validateBody(verifyPaymentSchema), verifyManualPayment as RequestHandler)
