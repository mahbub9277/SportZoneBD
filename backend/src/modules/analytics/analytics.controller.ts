import type { Request, Response } from 'express';
import asyncHandler from '../../utils/asyncHandler.js';
import { prisma } from '../../core/prisma.js';
import { successResponse } from '../../core/api-response.js';
import { z } from 'zod';
import { TELEMETRY_EVENT_TYPES, getTelemetryHistory, getTelemetrySummary, ingestTelemetry } from './telemetry.service.js'

const eventSchema = z.object({
  type: z.string(),
  entityId: z.string().uuid(),
});

export const trackEvent = asyncHandler(async (req: Request, res: Response) => {
  const { type, entityId } = eventSchema.parse(req.body);
  const userId = (req.user as { id: string })?.id; // Optional user ID

  await prisma.analyticsEvent.create({
    data: {
      type,
      entityId,
      userId,
      ipAddress: req.ip,
      userAgent: req.get('User-Agent'),
    },
  });

  res.status(201).json(successResponse(null, 'Event tracked.'));
});

const createTelemetrySchema = () => z.object({
  eventId: z.string().regex(/^[a-zA-Z0-9_-]{8,100}$/),
  sessionId: z.string().regex(/^[a-zA-Z0-9_-]{8,100}$/),
  eventType: z.enum(TELEMETRY_EVENT_TYPES),
  timestamp: z.number().int().min(Date.now() - 10 * 60 * 1000).max(Date.now() + 60 * 1000),
  streamId: z.string().uuid().optional(),
  channelId: z.string().uuid().optional(),
  matchId: z.string().uuid().optional(),
  metadata: z.record(z.union([z.string().max(120), z.number(), z.boolean(), z.null()])).optional(),
}).refine((value) => Boolean(value.streamId || value.channelId || value.matchId), 'A stream, channel, or match identity is required')

export const ingestPlayerTelemetry = asyncHandler(async (req: Request, res: Response) => {
  const telemetrySchema = createTelemetrySchema()
  const events = z.array(telemetrySchema).min(1).max(8).parse(req.body)
  for (const event of events) {
    await ingestTelemetry(event)
  }
  res.status(202).json(successResponse(null, 'Telemetry accepted.'))
})

export const getPlayerTelemetrySummary = asyncHandler(async (_req: Request, res: Response) => {
  res.json(successResponse(await getTelemetrySummary()))
})

export const getPlayerTelemetryHistory = asyncHandler(async (req: Request, res: Response) => {
  const minutes = Math.min(1440, Math.max(15, Number(req.query.minutes) || 60))
  res.json(successResponse(await getTelemetryHistory(minutes)))
})