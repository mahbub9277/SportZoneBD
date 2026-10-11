import type { Request, Response } from 'express'
import { z } from 'zod'
import asyncHandler from '../../utils/asyncHandler.js'
import { successResponse } from '../../core/api-response.js'
import type { AuthenticatedRequest } from '../../core/middleware.js'
import { isRedisConfigured } from '../../core/redis.js'
import { isNotificationWorkerRunning, isPushDeliveryConfigured } from '../../core/notificationQueue.js'
import { matchAutomationService } from '../../services/matchAutomation.service.js'
import {
  confirmAutomationSwitch,
  getAutomationSwitchStatus,
  setAutomationSwitch,
  type AutomationSwitchKey,
} from '../../core/automationSwitches.js'

const switchBodySchema = z.object({ enabled: z.boolean() }).strict()

interface DependencyReport {
  name: string
  ok: boolean
  detail: string
}

/**
 * What the subsystem needs in order to actually work. Reported next to the switch value so an administrator
 * is never told "ON" without being told that delivery is impossible anyway, and nothing infrastructure-level
 * beyond these facts leaves the endpoint.
 */
function pushDependencies(): DependencyReport[] {
  const pushConfigured = isPushDeliveryConfigured()
  const workerRunning = isNotificationWorkerRunning()
  return [
    {
      name: 'webPushDelivery',
      ok: pushConfigured,
      detail: pushConfigured
        ? 'Web push credentials are configured.'
        : 'VAPID keys are missing or invalid, so no push can be delivered.',
    },
    {
      name: 'notificationWorker',
      ok: workerRunning,
      detail: workerRunning
        ? 'The notification worker is running in this process.'
        : 'The notification worker is not running in this process; queued work waits until it starts.',
    },
    {
      name: 'inAppDelivery',
      ok: true,
      detail: 'The notification queue and worker are shared with in-app notifications and are not switched off.',
    },
  ]
}

function matchDependencies(): DependencyReport[] {
  const redisConfigured = isRedisConfigured
  const footballKeyConfigured = Boolean(process.env.FOOTBALL_API_KEY?.trim())
  const schedulerRunning = matchAutomationService.isSchedulerRunning()
  return [
    {
      name: 'scheduler',
      ok: schedulerRunning,
      detail: schedulerRunning
        ? 'The minute-tick scheduler is running in this process.'
        : 'The minute-tick scheduler is not running in this process.',
    },
    {
      name: 'automationLock',
      ok: redisConfigured,
      detail: redisConfigured
        ? 'The Redis lock that serializes automation runs is configured.'
        : 'Redis is not configured, so an automatic run would be skipped.',
    },
    {
      name: 'footballDataProvider',
      ok: footballKeyConfigured,
      detail: footballKeyConfigured
        ? 'The football-data.org provider key is configured.'
        : 'The football-data.org provider key is not configured; that source would be skipped.',
    },
  ]
}

function buildPayload(key: AutomationSwitchKey, dependencies: DependencyReport[], options: { previousValue?: boolean | null } = {}) {
  const status = getAutomationSwitchStatus(key)
  const blockingDependencies = dependencies.filter((dependency) => !dependency.ok && dependency.name !== 'notificationWorker')
  // Persisted and applied are deliberately separate: the switch value is what this instance enforces now,
  // while a missing dependency means the subsystem cannot do useful work even while switched on.
  const transition = status.degraded ? 'unavailable' : status.operational && blockingDependencies.length > 0 ? 'degraded' : 'applied'

  return {
    ...status,
    transition,
    ...(options.previousValue === undefined ? {} : { previousValue: options.previousValue }),
    dependencies,
    notes: [
      'Only this instance is acknowledged here; other instances confirm the persisted value within about 10 seconds.',
      'Persistence and runtime application are separate steps: a persisted value is reported as applied only for this process.',
    ],
  }
}

/**
 * GET /api/v1/admin/automation/push-notifications
 * Desired value, the value this instance enforces, and what the push subsystem can actually do.
 */
export const getPushAutomationStatus = asyncHandler(async (_req: Request, res: Response) => {
  // Read-only status: it reports the state, it does not change anything, and it does not require the
  // subsystem to be running.
  await confirmAutomationSwitch('pushNotifications')
  res.status(200).json(successResponse(buildPayload('pushNotifications', pushDependencies()), 'Push notifications automation state retrieved'))
})

/**
 * PATCH /api/v1/admin/automation/push-notifications
 * Persists the switch (audited with its previous value) and applies it to this instance.
 */
export const updatePushAutomationStatus = asyncHandler(async (req: Request, res: Response) => {
  const { enabled } = switchBodySchema.parse(req.body)
  const user = (req as AuthenticatedRequest).user

  const result = await setAutomationSwitch('pushNotifications', enabled, {
    actorId: user?.id ?? null,
    actorName: user?.fullName ?? null,
    requestId: (req as Request & { id?: string }).id ?? null,
  })

  const payload = buildPayload('pushNotifications', pushDependencies(), { previousValue: result.previous })
  res.status(200).json(successResponse(payload, enabled
    ? 'Push notifications automation turned on.'
    : 'Push notifications automation turned off; no automatic push will be produced or delivered until it is turned on again.'))
})

/**
 * GET /api/v1/admin/automation/match-creation
 */
export const getMatchCreationStatus = asyncHandler(async (_req: Request, res: Response) => {
  await confirmAutomationSwitch('matchCreation')
  res.status(200).json(successResponse(buildPayload('matchCreation', matchDependencies()), 'Automatic match creation state retrieved'))
})

/**
 * PATCH /api/v1/admin/automation/match-creation
 */
export const updateMatchCreationStatus = asyncHandler(async (req: Request, res: Response) => {
  const { enabled } = switchBodySchema.parse(req.body)
  const user = (req as AuthenticatedRequest).user

  const result = await setAutomationSwitch('matchCreation', enabled, {
    actorId: user?.id ?? null,
    actorName: user?.fullName ?? null,
    requestId: (req as Request & { id?: string }).id ?? null,
  })

  const payload = buildPayload('matchCreation', matchDependencies(), { previousValue: result.previous })
  res.status(200).json(successResponse(payload, enabled
    ? 'Automatic match creation turned on.'
    : 'Automatic match creation paused; existing matches and manual match management are unaffected.'))
})
