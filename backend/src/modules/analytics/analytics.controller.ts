import type { Request, Response } from 'express';
import asyncHandler from '../../utils/asyncHandler.js';
import { prisma } from '../../core/prisma.js';
import { errorResponse, successResponse } from '../../core/api-response.js';
import { z } from 'zod';
import { TELEMETRY_EVENT_TYPES, getTelemetryEnabled, getTelemetryHistory, getTelemetrySummary, ingestTelemetry, setTelemetryEnabled } from './telemetry.service.js'

const telemetryStatusSchema = z.object({ enabled: z.boolean() }).strict()

export const updateTelemetryStatus = asyncHandler(async (req: Request, res: Response) => {
  const { enabled } = telemetryStatusSchema.parse(req.body)
  await setTelemetryEnabled(enabled)
  res.json(successResponse({ enabled }))
})

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
  const telemetryEnabled = await getTelemetryEnabled()
  if (!telemetryEnabled) return res.status(204).end()
  const telemetrySchema = createTelemetrySchema()
  const events = z.array(telemetrySchema).min(1).max(8).parse(req.body)
  for (const event of events) {
    await ingestTelemetry(event, telemetryEnabled)
  }
  res.status(202).json(successResponse(null, 'Telemetry accepted.'))
})

export const getPlayerTelemetrySummary = asyncHandler(async (_req: Request, res: Response) => {
  try {
    res.json(successResponse(await getTelemetrySummary()))
  } catch {
    res.status(503).json(errorResponse('Player telemetry is temporarily unavailable'))
  }
})

export const getPlayerTelemetryHistory = asyncHandler(async (req: Request, res: Response) => {
  const minutes = Math.min(1440, Math.max(15, Number(req.query.minutes) || 60))
  try {
    res.json(successResponse(await getTelemetryHistory(minutes)))
  } catch {
    res.status(503).json(errorResponse('Player telemetry is temporarily unavailable'))
  }
})