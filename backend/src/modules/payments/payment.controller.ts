import type { Request, Response } from 'express';
import crypto from 'crypto';
import asyncHandler from '../../utils/asyncHandler.js';
import * as paymentService from './payment.service.js';
import { successResponse, errorResponse } from '../../core/api-response.js';
import logger from '../../core/logger.js';
import { z } from 'zod';
import { prisma } from '../../core/prisma.js';
import { UnauthorizedError } from '../../core/errors.js';

export const createIntentSchema = z.object({
  amount: z.number().positive('Amount must be positive'),
  subscriptionPlanId: z.string().uuid('A valid subscription plan ID is required.'),
  provider: z.string().min(1, 'Payment provider is required.'),
});

export const verifyPaymentSchema = z.object({
  transactionId: z.string().trim().min(1),
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

export const handleWebhook = asyncHandler(async (req: Request, res: Response) => {
  const { provider } = req.params;
  const signature = req.headers['x-bkash-signature'] as string; // Or the header your provider uses
  const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;

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
  const page = Number(req.query.page) || 1;
  const limit = Number(req.query.limit) || 10;
  const search = typeof req.query.search === 'string' ? req.query.search : undefined;
  const status = typeof req.query.status === 'string' ? req.query.status : undefined;
  const paginatedPayments = await paymentService.getAllPayments({ page, limit, search, status });
  res.status(200).json(successResponse(paginatedPayments, 'Payments retrieved successfully.'));
});

export const getPendingVerifications = asyncHandler(async (req: Request, res: Response) => {
  const payments = await paymentService.getPendingVerifications();
  res.status(200).json(successResponse(payments));
});

export const processVerification = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const action = z.enum(['approve', 'reject']).parse(req.body.action);
  const reviewerId = (req.user as { id: string })?.id;
  const updatedPayment = await paymentService.processVerification(id, action, reviewerId, req.body.rejectionReason);
  res.status(200).json(successResponse(updatedPayment));
});

export const verifyManualPayment = asyncHandler(async (req: Request, res: Response) => {
  const payload = verifyPaymentSchema.parse(req.body);
  const userId = (req.user as { id: string })?.id;
  if (!userId) return res.status(401).json(errorResponse('Authentication required.'));
  const payment = await paymentService.createManualPayment({ userId, ...payload });
  return res.status(201).json(successResponse(payment, 'Payment recorded and is pending verification.'));
});

export const getManualPaymentConfig = asyncHandler(async (_req: Request, res: Response) => {
  res.status(200).json(successResponse(await paymentService.getManualPaymentConfig()));
});