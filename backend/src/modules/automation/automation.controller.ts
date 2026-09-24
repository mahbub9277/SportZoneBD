import { Request, Response } from 'express'
import { prisma } from '../../core/prisma.js'
import { successResponse, errorResponse } from '../../core/api-response.js'
import asyncHandler from '../../utils/asyncHandler.js'
import { matchAutomationService } from '../../services/matchAutomation.service.js'

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

    // Run automation in background (don't await to respond quickly)
    matchAutomationService.runAutomation().then(async () => {
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

  const [logs, matchCreates, streamValidations] = await Promise.all([
    prisma.automationLog.findMany({
      where: { jobId: job.id },
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

  const successfulRuns = logs.filter((log) => log.status === 'SUCCESS').length
  const failedRuns = logs.filter((log) => log.status === 'FAILED').length

  res.status(200).json(
    successResponse(
      {
        totalRuns: logs.length,
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
