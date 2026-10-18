import { Request, Response } from 'express'
import { prisma } from '../../core/prisma.js'
import { successResponse, errorResponse } from '../../core/api-response.js'
import asyncHandler from '../../utils/asyncHandler.js'
import logger from '../../core/logger.js'
import { writeAuditLog } from '../../core/audit.js'
import { matchAutomationService } from '../../services/matchAutomation.service.js'
import { pruneAutomationLogs } from '../../services/automationLogRetention.js'

/**
 * GET /api/admin/automation/status
 * Get current automation job status and recent logs
 */
const ensureAutomationJob = async () => {
  let job = await prisma.automationJob.findFirst({
    where: { name: 'Match Automation Scheduler' },
  })

  if (!job) {
    job = await prisma.automationJob.create({
      data: {
        name: 'Match Automation Scheduler',
        status: 'IDLE',
        cronExpression: '*/2 * * * *',
        isEnabled: true,
      },
    })
  }

  return job
}

export const getAutomationStatus = asyncHandler(async (req: Request, res: Response) => {
  const job = await ensureAutomationJob()
  const logs = await prisma.automationLog.findMany({
    where: { jobId: job.id },
    orderBy: { createdAt: 'desc' },
    take: 10,
  })

  if (!job) {
    return res.status(200).json(
      successResponse(
        {
          status: 'IDLE',
          lastRunAt: null,
          nextRunAt: null,
          isEnabled: false,
          logs: [],
        },
        'No automation job found',
      ),
    )
  }

  res.status(200).json(
    successResponse(
      {
        id: job.id,
        name: job.name,
        status: job.status,
        lastRunAt: job.lastRunAt,
        nextRunAt: job.nextRunAt,
        isEnabled: job.isEnabled,
        cronExpression: job.cronExpression,
        logs,
      },
      'Automation status retrieved',
    ),
  )
})

/**
 * POST /api/admin/automation/sync
 * Manually trigger an automation sync (for testing/admin)
 */
export const triggerManualSync = asyncHandler(async (req: Request, res: Response) => {
  try {
    // Update job status to running
    const job = await ensureAutomationJob()

    if (job.status === 'RUNNING') {
      return res.status(409).json(errorResponse('An automation sync is already running.', 'SYNC_IN_PROGRESS'))
    }

    await prisma.automationJob.update({
      where: { id: job.id },
      data: { status: 'RUNNING' },
    })

    // Run automation in background (don't await to respond quickly). A manual trigger is an explicit
    // administrator action, so it runs the pipeline even while the automatic switch is off.
    matchAutomationService.runAutomation({ trigger: 'manual' }).then(async () => {
      await prisma.automationJob.update({
        where: { id: job.id },
        data: { status: 'IDLE', lastRunAt: new Date() },
      })
    }).catch(async (error) => {
      await prisma.automationJob.update({
        where: { id: job.id },
        data: { status: 'ERROR', lastRunAt: new Date() },
      })
    })

    res.status(202).json(successResponse({ jobId: job.id }, 'Automation sync triggered'))
  } catch (error) {
    res.status(500).json(errorResponse('Failed to trigger sync', 'SYNC_FAILED'))
  }
})

/**
 * GET /api/admin/automation/logs
 * Get paginated automation logs
 */
export const getAutomationLogs = asyncHandler(async (req: Request, res: Response) => {
  const page = Math.max(1, Number(req.query.page) || 1)
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20))
  const skip = (page - 1) * limit
  const sortQuery = (req.query.sort as string) || 'createdAt:desc'
  const [field, order] = sortQuery.split(':')

  const orderBy = {
    [field]: order === 'asc' ? 'asc' : 'desc',
  }

  const [logs, total] = await Promise.all([
    prisma.automationLog.findMany({
      include: {
        job: true,
      },
      orderBy,
      skip,
      take: limit,
    }),
    prisma.automationLog.count(),
  ])

  res.status(200).json(
    successResponse(
      {
        logs,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit),
        },
      },
      'Automation logs retrieved',
    ),
  )
})

/**
 * GET /api/admin/automation/metrics
 * Get automation metrics summary
 */
export const getAutomationMetrics = asyncHandler(async (req: Request, res: Response) => {
  const job = await prisma.automationJob.findFirst({
    where: { name: 'Match Automation Scheduler' },
  })

  if (!job) {
    return res.status(200).json(
      successResponse(
        {
          totalRuns: 0,
          successfulRuns: 0,
          failedRuns: 0,
          lastRunAt: null,
          matchesCreatedLast24h: 0,
          streamsValidatedLast24h: 0,
        },
        'No metrics available',
      ),
    )
  }

  const last24h = new Date(Date.now() - 24 * 60 * 60 * 1000)

  const [logCounts, matchCreates, streamValidations] = await Promise.all([
    prisma.automationLog.groupBy({
      where: { jobId: job.id },
      by: ['status'],
      _count: { _all: true },
    }),
    prisma.automationLog.count({
      where: {
        jobId: job.id,
        action: 'DISCOVER_MATCHES',
        status: 'SUCCESS',
        createdAt: { gte: last24h },
      },
    }),
    prisma.automationLog.count({
      where: {
        jobId: job.id,
        action: 'VALIDATE_STREAMS',
        status: 'SUCCESS',
        createdAt: { gte: last24h },
      },
    }),
  ])

  const totalRuns = logCounts.reduce((total, group) => total + group._count._all, 0)
  const successfulRuns = logCounts.find((group) => group.status === 'SUCCESS')?._count._all ?? 0
  const failedRuns = logCounts.find((group) => group.status === 'FAILED')?._count._all ?? 0

  res.status(200).json(
    successResponse(
      {
        totalRuns,
        successfulRuns,
        failedRuns,
        lastRunAt: job.lastRunAt,
        matchesCreatedLast24h: matchCreates,
        streamsValidatedLast24h: streamValidations,
        jobStatus: job.status,
        isEnabled: job.isEnabled,
      },
      'Automation metrics retrieved',
    ),
  )
})

/**
 * DELETE /api/admin/automation/logs/:id
 * Delete a specific automation log entry
 */
export const deleteAutomationLog = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params
  await prisma.automationLog.delete({
    where: { id },
  })
  res.status(204).send()
})

/**
 * Writes the administrator's cleanup action to the project's audit trail (the `SystemLog` table).
 *
 * A failure to record the action must never change the answer: the rows are already deleted or not, so it is
 * logged and dropped instead of turning a completed cleanup into an error response.
 */
const recordRetentionAudit = async (message: string, meta: Record<string, unknown>, level: 'info' | 'error') => {
  try {
    await writeAuditLog(message, meta, level)
  } catch (error) {
    logger.warn({ error, audit: 'automation-log-retention' }, 'Automation log retention audit entry could not be written')
  }
}

/**
 * DELETE /api/admin/automation/logs/retention
 * Delete every automation log older than the retention window (30 days), in bounded batches.
 *
 * The response always reports what the database actually did. A run that stops at the per-request ceiling, or
 * that fails part-way, returns `complete: false` with the rows that were deleted and the rows still eligible —
 * never a bare success.
 */
export const deleteAutomationLogsOlderThanRetention = asyncHandler(async (req: Request, res: Response) => {
  const outcome = await pruneAutomationLogs()
  const actor = req.user as { id?: string; fullName?: string; name?: string } | undefined
  const auditMeta = {
    cutoff: outcome.cutoff,
    retentionDays: outcome.retentionDays,
    deletedCount: outcome.deletedCount,
    remainingCount: outcome.remainingCount,
    complete: outcome.complete,
    batches: outcome.batches,
    batchSize: outcome.batchSize,
    maxPerRequest: outcome.maxPerRequest,
    actorId: actor?.id ?? null,
    actorName: actor?.fullName ?? actor?.name ?? null,
    requestId: (req as Request & { id?: string }).id ?? null,
  }
  const payload = {
    cutoff: outcome.cutoff,
    deletedCount: outcome.deletedCount,
    remainingCount: outcome.remainingCount,
    complete: outcome.complete,
    retentionDays: outcome.retentionDays,
    batchSize: outcome.batchSize,
    maxPerRequest: outcome.maxPerRequest,
    batches: outcome.batches,
  }

  if (!outcome.ok) {
    if (outcome.alreadyRunning) {
      return res.status(409).json(
        errorResponse('A log cleanup is already running. Please wait for it to finish.', payload),
      )
    }

    // The failure reason (a Prisma message) stays in the audit entry and the server log: it can contain
    // database detail a client must never see.
    await recordRetentionAudit('Automation log retention cleanup failed', { ...auditMeta, reason: outcome.reason }, 'error')

    return res.status(500).json(
      errorResponse(
        'The cleanup could not be completed. The counts below are what the database currently holds.',
        payload,
      ),
    )
  }

  await recordRetentionAudit('Automation logs older than the retention window deleted', auditMeta, 'info')

  const deleted = outcome.deletedCount
  const remaining = outcome.remainingCount ?? 0
  const message = deleted === 0
    ? (remaining === 0
        ? `No automation logs are older than ${outcome.retentionDays} days.`
        : 'No logs were deleted; another cleanup is removing them.')
    : outcome.complete
      ? `Deleted ${deleted.toLocaleString('en-US')} automation log${deleted === 1 ? '' : 's'} older than ${outcome.retentionDays} days.`
      : `Deleted ${deleted.toLocaleString('en-US')} automation log${deleted === 1 ? '' : 's'} older than ${outcome.retentionDays} days; ${remaining.toLocaleString('en-US')} older record${remaining === 1 ? ' remains' : 's remain'}. Run the cleanup again to continue.`

  res.status(200).json(successResponse(payload, message))
})
