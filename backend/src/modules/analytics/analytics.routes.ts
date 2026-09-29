import { Router } from 'express';
import { trackEvent } from './analytics.controller.js';
import { optionalProtect } from '../../core/middleware/index.js';
import { authenticate, requireRole } from '../../core/middleware/index.js'
import rateLimit from 'express-rate-limit'
import { getPlayerTelemetryHistory, getPlayerTelemetrySummary, ingestPlayerTelemetry, updateTelemetryStatus } from './analytics.controller.js'

export const analyticsRouter = Router();

analyticsRouter.post('/track', optionalProtect, trackEvent); // Use optionalProtect to allow guests
analyticsRouter.patch('/telemetry/status', authenticate, requireRole(['admin', 'super_admin']), updateTelemetryStatus)
analyticsRouter.post('/telemetry/events', rateLimit({ windowMs: 60 * 1000, max: 120, standardHeaders: true, legacyHeaders: false }), optionalProtect, ingestPlayerTelemetry)
analyticsRouter.get('/telemetry/summary', authenticate, requireRole(['admin', 'super_admin']), getPlayerTelemetrySummary)
analyticsRouter.get('/telemetry/history', authenticate, requireRole(['admin', 'super_admin']), getPlayerTelemetryHistory)