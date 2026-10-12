import type { Request, Response } from 'express';
import crypto from 'crypto';
import asyncHandler from '../../utils/asyncHandler.js';
import * as paymentService from './payment.service.js';
import { successResponse, errorResponse } from '../../core/api-response.js';
import logger from '../../core/logger.js';
import { z } from 'zod';
import { prisma } from '../../core/prisma.js';
import { UnauthorizedError } from '../../core/errors.js';
import { recordModerationEvent } from '../../core/moderationAudit.js';

export const createIntentSchema = z.object({
  amount: z.number().positive('Amount must be positive'),
  subscriptionPlanId: z.string().uuid('A valid subscription plan ID is required.'),
  provider: z.string().min(1, 'Payment provider is required.'),
});

/** The hosted checkout start payload: only the plan, never an amount. */
export const startCheckoutSchema = z.object({
  subscriptionPlanId: z.string().uuid(),
});

/**
 * Verifies the signature of an incoming webhook request.
 * @param signature - The signature from the request header (e.g., 'x-bkash-signature').
 * @param body - The raw request body buffer.
 * @returns {boolean} - True if the signature is valid.
 */
function verifyWebhookSignature(signature: string, body: Buffer): boolean {
  const secret = process.env.BKASH_WEBHOOK_SECRET; // Make sure to set this in your .env file
  if (!secret) {
    logger.error('Bkash webhook secret is not configured. Webhook verification will fail.');
    return false;
  }

  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(body);
  const generatedSignature = hmac.digest('hex');

  if (signature.length !== generatedSignature.length) {
    return false;
  }

  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(generatedSignature),
  );
}

export const createIntent = asyncHandler(async (req: Request, res: Response) => {
  // The `protect` middleware ensures req.user is available.
  const userId = (req.user as { id: string })?.id; 

  if (!userId) {
    return res.status(401).json(errorResponse('Authentication required to create a payment.'));
  }

  const { amount, subscriptionPlanId, provider } = createIntentSchema.parse(req.body);
  const result = await paymentService.createPaymentIntent({ userId, amount, subscriptionPlanId, provider });

  // Return the provider data (e.g., redirectURL) in the response data shape the frontend expects.
  res.status(201).json(successResponse(result, 'Payment intent created successfully.'));
});

export const completePayment = asyncHandler(async (req: Request, res: Response) => {
  const { paymentId } = req.body;
  const userId = (req.user as { id: string })?.id;

  if (!userId) {
    return res.status(401).json(errorResponse('Authentication required.'));
  }

  if (!paymentId) {
    return res.status(400).json(errorResponse('paymentId is required.'));
  }

  throw new UnauthorizedError('Subscription activation is performed only after admin payment approval.');
});

/**
 * The ZiniPay hosted-invoice callback, in the form the provider actually calls it.
 *
 * ZiniPay documents its callback payload as a JSON body *or* query parameters, and production shows it calling
 * this route with `GET …?invoice_id=…&status=…`, which used to 404 because only the POST route was
 * registered. The payload is still an untrusted hint: its reference only decides which payment to look at, and
 * the payment is proven by the server-side verification this shared handler runs.
 */
const processZiniPayCallback = async (req: Request, res: Response) => {
  const result = await paymentService.handleZiniPayWebhook({
    body: req.body as Record<string, unknown> | undefined,
    query: req.query as Record<string, unknown>,
  });
  return res.status(200).json({ success: true, message: result.message });
};

/** `GET` form of the callback, for the provider's query-parameter deliveries. */
export const handleZiniPayCallback = asyncHandler(processZiniPayCallback);

/**
 * Provider callbacks.
 *
 * `zinipay`: the hosted-checkout callback, accepted as POST (body form) and, on its own route, as GET (query
 * form). A callback about an invoice we do not know is answered with 200 and no provider request, so the
 * public URL cannot be used to make us call the provider in a loop.
 *
 * `bkash`: the pre-existing direct-webhook branch, kept exactly as it was.
 */
export const handleWebhook = asyncHandler(async (req: Request, res: Response) => {
  const { provider } = req.params;
  const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;

  if (provider.toLowerCase() === 'zinipay') {
    return processZiniPayCallback(req, res);
  }

  const signature = req.headers['x-bkash-signature'] as string; // Or the header your provider uses

  if (!rawBody) {
    throw new Error('Raw body not available for webhook verification. Ensure express.json `verify` is configured.');
  }

  // For now, we'll assume bKash. You can add a switch for different providers.
  if (provider.toLowerCase() === 'bkash') {
    if (!signature || !verifyWebhookSignature(signature, rawBody)) {
      throw new UnauthorizedError('Invalid webhook signature.');
    }
  }

  // The signature is valid, now process the payment.
  await paymentService.verifyAndCompleteWebhookPayment(req.body);

  res.status(200).json({ success: true, message: 'Webhook received and processed.' });
});

export const getHistory = asyncHandler(async (req: Request, res: Response) => {
  const userId = (req.user as { id: string })?.id;
  if (!userId) {
    return res.status(401).json(errorResponse('Authentication required.'));
  }
  const payments = await paymentService.getPaymentHistory(userId);
  res.status(200).json(successResponse(payments));
});

export const clearHistory = asyncHandler(async (req: Request, res: Response) => {
  const userId = (req.user as { id: string })?.id;
  if (!userId) {
    return res.status(401).json(errorResponse('Authentication required.'));
  }

  const result = await paymentService.clearPaymentHistory(userId);
  res.status(200).json(successResponse(result, 'Payment history cleared successfully.'));
});

export const getAllPayments = asyncHandler(async (req: Request, res: Response) => {
  const requestedPage = Number(req.query.page)
  const requestedLimit = Number(req.query.limit)
  const page = Number.isFinite(requestedPage) ? Math.max(1, Math.floor(requestedPage)) : 1
  const limit = Number.isFinite(requestedLimit) ? Math.min(100, Math.max(1, Math.floor(requestedLimit))) : 10
  const search = typeof req.query.search === 'string' ? req.query.search : undefined;
  const status = typeof req.query.status === 'string' ? req.query.status : undefined;
  const paginatedPayments = await paymentService.getAllPayments({ page, limit, search, status });
  res.status(200).json(successResponse(paginatedPayments, 'Payments retrieved successfully.'));
});

export const getPendingVerifications = asyncHandler(async (req: Request, res: Response) => {
  const payments = await paymentService.getPendingVerifications();
  res.status(200).json(successResponse(payments));
});

/**
 * Records a reviewer's decision on a manual payment submission.
 *
 * The service owns the transaction, the concurrency guard and the "not your own submission" rule; this
 * handler only supplies the authenticated reviewer and, once the decision is committed, writes the audit
 * event that names who decided what. The reviewer id comes from the session, so a client cannot choose it.
 */
export const processVerification = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const action = z.enum(['approve', 'reject']).parse(req.body.action);
  const rejectionReason = typeof req.body.rejectionReason === 'string' ? req.body.rejectionReason : undefined;
  const reviewerId = (req.user as { id: string })?.id;

  if (!reviewerId) {
    return res.status(401).json(errorResponse('Authentication required.'));
  }

  const { payment, decision } = await paymentService.processVerification(id, action, reviewerId, rejectionReason);

  await recordModerationEvent({
    action: action === 'approve' ? 'payment.review.approved' : 'payment.review.rejected',
    actorId: reviewerId,
    actorName: (req.user as { fullName?: string | null } | undefined)?.fullName ?? null,
    entityId: decision.paymentId,
    outcome: 'success',
    reason: decision.reason,
    requestId: (req as Request & { id?: string }).id ?? null,
    before: { status: decision.before },
    after: { status: decision.after },
    details: {
      customerId: decision.userId,
      amount: decision.amount,
      currency: decision.currency,
      plan: decision.planName,
      transactionId: decision.transactionId,
      subscriptionId: decision.subscriptionId,
    },
  })

  res.status(200).json(successResponse(payment, 'Payment review recorded.'));
});

/**
 * Re-runs the provider-side verification for a hosted payment an administrator is worried about.
 *
 * The administrator cannot approve, override or mark anything as paid: this calls exactly the same
 * server-side check the customer's return page calls, and the outcome is whatever the provider reports. Every
 * attempt — successful or not — is written to the audit trail with the actor, the outcome and the sanitized
 * provider evidence, so a recovery attempt is reviewable later.
 */
export const recheckHostedPayment = asyncHandler(async (req: Request, res: Response) => {
  const actorId = (req.user as { id: string })?.id;
  if (!actorId) {
    return res.status(401).json(errorResponse('Authentication required.'));
  }

  const paymentId = typeof req.params.id === 'string' ? req.params.id : '';
  const actorName = (req.user as { fullName?: string | null } | undefined)?.fullName ?? null;
  const requestId = (req as Request & { id?: string }).id ?? null;

  try {
    const result = await paymentService.recheckHostedPayment({ paymentId });

    await recordModerationEvent({
      action: 'payment.review.rechecked',
      actorId,
      actorName,
      entityId: result.paymentId,
      outcome: 'success',
      reason: result.providerContacted
        ? `provider reported ${result.outcome}`
        : 'no provider request: this payment was checked moments ago',
      requestId,
      after: { status: result.paymentStatus },
      details: { outcome: result.outcome, providerContacted: result.providerContacted, evidence: result.evidence },
    });

    return res.status(200).json(successResponse(result, result.message));
  } catch (error) {
    // A refused or failed recheck is recorded too: an attempt to recover a payment is part of the trail even
    // when it changes nothing. The message is only echoed when the service itself produced it.
    await recordModerationEvent({
      action: 'payment.review.rechecked',
      actorId,
      actorName,
      entityId: paymentId,
      outcome: 'failure',
      reason: error instanceof Error ? error.message : 'unexpected error',
      requestId,
    });

    throw error;
  }
});

/** Premium members and their payment history, read-only, for moderators and administrators. */
export const getPremiumMembers = asyncHandler(async (req: Request, res: Response) => {
  const requestedPage = Number(req.query.page)
  const requestedLimit = Number(req.query.limit)
  const page = Number.isFinite(requestedPage) ? Math.max(1, Math.floor(requestedPage)) : 1
  const limit = Number.isFinite(requestedLimit) ? Math.min(100, Math.max(1, Math.floor(requestedLimit))) : 10

  const members = await paymentService.getPremiumMembers({
    page,
    limit,
    search: typeof req.query.search === 'string' ? req.query.search : undefined,
    status: typeof req.query.status === 'string' ? req.query.status : undefined,
    planId: typeof req.query.planId === 'string' ? req.query.planId : undefined,
  })

  res.status(200).json(successResponse(members.items, 'Premium members retrieved successfully.', members.meta));
});

/**
 * Starts (or resumes) a hosted ZiniPay payment session for a plan.
 *
 * The customer is answered with the official payment page URL; the credentials and the invoice request stay on
 * the server.
 */
export const startHostedCheckout = asyncHandler(async (req: Request, res: Response) => {
  const userId = (req.user as { id: string })?.id;
  const user = req.user as { id?: string; email?: string | null; fullName?: string | null } | undefined;
  if (!userId) return res.status(401).json(errorResponse('Authentication required.'));

  const { subscriptionPlanId } = startCheckoutSchema.parse(req.body);
  const session = await paymentService.startHostedCheckout({
    userId,
    subscriptionPlanId,
    customerEmail: user?.email ?? null,
    customerName: user?.fullName ?? null,
  });

  return res.status(201).json(successResponse(session, session.reused ? 'Payment session resumed.' : 'Payment session created.'));
});

/**
 * Verifies the invoice behind a payment with ZiniPay, server-side, and reports the outcome.
 *
 * This is what the return page calls. Premium is activated here and nowhere else, exactly once, and a pending
 * or unknown answer never activates anything.
 */
export const verifyHostedCheckout = asyncHandler(async (req: Request, res: Response) => {
  const userId = (req.user as { id: string })?.id;
  if (!userId) return res.status(401).json(errorResponse('Authentication required.'));

  const paymentId = typeof req.params.paymentId === 'string' ? req.params.paymentId : '';
  const result = await paymentService.verifyHostedCheckout({ paymentId, userId });

  // A pending or failed payment is a truthful answer, not an error: the page shows the status it receives.
  return res.status(200).json(successResponse(result, result.message));
});