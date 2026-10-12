import { Router, type Request, type Response, type Router as ExpressRouter } from 'express'
import { prisma } from '../../core/prisma.js'
import { successResponse } from '../../core/api-response.js'
import { validateBody } from '../../core/validation.js'
import {
  createIntent,
  completePayment,
  handleWebhook,
  handleZiniPayCallback,
  getHistory,
  clearHistory,
  getAllPayments,
  getPendingVerifications,
  getPremiumMembers,
  processVerification,
  recheckHostedPayment,
  startHostedCheckout,
  verifyHostedCheckout,
  createIntentSchema,
  startCheckoutSchema,
} from './payment.controller.js'
import type { RequestHandler } from 'express'
import { authenticate, requirePermission } from '../../core/middleware/index.js'
import { webhookLimiter } from '../../middleware/rateLimiter.js'

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

// The hosted checkout: the server creates the provider session and the customer is sent to the official
// payment page. Premium is activated only after the server verifies the invoice.
paymentRouter.post('/checkout', authenticate, validateBody(startCheckoutSchema), startHostedCheckout as RequestHandler)
paymentRouter.post('/checkout/:paymentId/verify', authenticate, verifyHostedCheckout as RequestHandler)

// This route handles webhooks from payment providers. It is unauthenticated because the provider's servers
// call it, so it carries its own (separate, more generous) limit and never trusts what it is told.
paymentRouter.post('/webhook/:provider', webhookLimiter, handleWebhook as RequestHandler);

// ZiniPay delivers its hosted-invoice callback with query parameters too, and production shows it calling this
// exact path with GET (which used to 404). Only this one provider gets a GET route: every other provider stays
// POST-only, and the request is still an untrusted hint that merely triggers server-side verification.
paymentRouter.get('/webhook/zinipay', webhookLimiter, handleZiniPayCallback as RequestHandler);

// Payment records and the review queue. Both are gated by permission rather than by role name, so the
// same moderator console that lists payments is the only way in and the backend decides for itself.
paymentRouter.get('/', requirePermission('admin.payments.view'), getAllPayments as RequestHandler)

paymentRouter.get('/manual-verification', requirePermission('admin.payments.review'), getPendingVerifications as RequestHandler)
paymentRouter.patch('/manual-verification/:id', requirePermission('admin.payments.review'), processVerification as RequestHandler)

// The recovery path for a hosted payment that is stuck: an administrator re-runs the provider's own
// verification and can only ever see what the provider reports. It cannot approve or override anything, so it
// is gated by the review permission rather than by a role name.
paymentRouter.post('/manual-verification/:id/recheck', requirePermission('admin.payments.review'), recheckHostedPayment as RequestHandler)

// Read-only premium membership view: subscription records joined with the payments behind them.
paymentRouter.get('/premium-members', requirePermission('admin.premium.view'), getPremiumMembers as RequestHandler)

// This route will be called by the frontend to get the user's payment history.
paymentRouter.get('/history', authenticate, getHistory as RequestHandler)
paymentRouter.delete('/history', authenticate, clearHistory as RequestHandler)
