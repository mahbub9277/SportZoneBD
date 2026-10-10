import type { NextFunction, Request, Response } from 'express'
import { prisma } from '../../core/prisma.js'
import asyncHandler from '../../utils/asyncHandler.js'
import { errorResponse, successResponse } from '../../core/api-response.js'
import { AppError } from '../../core/errors.js'
import {
  REPORT_CATEGORIES,
  allowedReportTransitions,
  canTransitionReportStatus,
  isReportCategory,
  isReportStatus,
  requiresReportReason,
  type ReportCategory,
} from '../../core/moderationRules.js'
import { moderationLogFilter, readModerationEvent, recordModerationEvent } from '../../core/moderationAudit.js'

interface RequestWithUser extends Request {
  user?: { id: string; fullName?: string | null; email?: string | null }
}

/** The default page size. It is also the old fixed limit, so an unpaginated caller sees no change. */
const DEFAULT_REPORT_PAGE_SIZE = 50

/**
 * A report as the moderation interface needs it.
 *
 * The moves the backend would accept are attached to each report, and each move says whether it needs a
 * reason, so the client offers exactly the transitions this API enforces instead of duplicating the
 * policy.
 */
function withModerationHints<T extends { status: string }>(report: T) {
  const transitions = allowedReportTransitions(report.status)

  return {
    ...report,
    allowedTransitions: transitions.map((status) => ({ status, requiresReason: requiresReportReason(status) })),
  }
}

export const createReport = asyncHandler(async (req: RequestWithUser, res: Response) => {
  const userId = req.user?.id
  if (!userId) {
    return res.status(401).json(errorResponse('Authentication required.'))
  }

  const user = await prisma.user.findUnique({
    where: { id: userId, deletedAt: null },
    select: { isActive: true, isSuspended: true, isBanned: true },
  })

  if (!user || !user.isActive || user.isSuspended || user.isBanned) {
    return res.status(403).json(errorResponse('Your account is not allowed to submit reports.'))
  }

  const { category, summary, details } = req.body as {
    category?: string
    summary?: string
    details?: string
  }

  if (!category || !REPORT_CATEGORIES.includes(category as ReportCategory)) {
    return res.status(400).json(errorResponse('Please choose a valid report category.'))
  }

  if (!summary || typeof summary !== 'string' || !summary.trim() || summary.trim().length > 200) {
    return res.status(400).json(errorResponse('A short summary is required.'))
  }

  if (details !== undefined && (typeof details !== 'string' || details.length > 5000)) {
    return res.status(400).json(errorResponse('Report details must be 5000 characters or fewer.'))
  }

  const report = await prisma.report.create({
    data: {
      userId,
      category: category as ReportCategory,
      summary: summary.trim(),
      details: details?.trim() || 'No additional details provided.',
      status: 'OPEN',
    },
  })

  return res.status(201).json(successResponse(report, 'Report submitted successfully.'))
})

export const getMyReports = asyncHandler(async (req: RequestWithUser, res: Response) => {
  const userId = req.user?.id
  if (!userId) {
    return res.status(401).json(errorResponse('Authentication required.'))
  }

  const user = await prisma.user.findUnique({
    where: { id: userId, deletedAt: null },
    select: { isActive: true, isSuspended: true, isBanned: true },
  })

  if (!user || !user.isActive || user.isSuspended || user.isBanned) {
    return res.status(403).json(errorResponse('Your account is not allowed to access reports.'))
  }

  const reports = await prisma.report.findMany({
    where: { userId, deletedAt: null },
    orderBy: { createdAt: 'desc' },
    take: 8,
  })

  return res.status(200).json(successResponse(reports, 'Reports retrieved successfully.'))
})

export const getReportsForAdmin = asyncHandler(async (req: RequestWithUser, res: Response) => {
  const userId = req.user?.id
  if (!userId) {
    return res.status(401).json(errorResponse('Authentication required.'))
  }

  const user = await prisma.user.findUnique({
    where: { id: userId, deletedAt: null },
    select: { isActive: true, isSuspended: true, isBanned: true },
  })

  if (!user || !user.isActive || user.isSuspended || user.isBanned) {
    return res.status(403).json(errorResponse('Your account cannot access admin reports.'))
  }

  const category = isReportCategory(req.query.category) ? req.query.category : undefined
  const status = isReportStatus(req.query.status) ? req.query.status : undefined
  const search = typeof req.query.search === 'string' ? req.query.search.trim() : ''

  const requestedPage = Number(req.query.page)
  const requestedLimit = Number(req.query.limit)
  const page = Number.isFinite(requestedPage) && requestedPage > 0 ? Math.floor(requestedPage) : 1
  const limit = Number.isFinite(requestedLimit) && requestedLimit > 0
    ? Math.min(100, Math.floor(requestedLimit))
    : DEFAULT_REPORT_PAGE_SIZE

  const from = typeof req.query.from === 'string' ? new Date(req.query.from) : null
  const to = typeof req.query.to === 'string' ? new Date(req.query.to) : null

  const where = {
    deletedAt: null,
    ...(category ? { category } : {}),
    ...(status ? { status } : {}),
    ...(from && !Number.isNaN(from.getTime()) ? { createdAt: { gte: from } } : {}),
    ...(to && !Number.isNaN(to.getTime()) ? { createdAt: { lte: to } } : {}),
    ...(search ? {
      OR: [
        { category: { contains: search, mode: 'insensitive' as const } },
        { summary: { contains: search, mode: 'insensitive' as const } },
        { details: { contains: search, mode: 'insensitive' as const } },
        { user: { fullName: { contains: search, mode: 'insensitive' as const } } },
        { user: { email: { contains: search, mode: 'insensitive' as const } } },
      ],
    } : {}),
  }

  // A bounded, ordered page plus the real total, so the list can be paged instead of silently cut off.
  const [items, totalItems] = await prisma.$transaction([
    prisma.report.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (page - 1) * limit,
      take: limit,
      include: {
        user: {
          select: {
            id: true,
            fullName: true,
            email: true,
          },
        },
      },
    }),
    prisma.report.count({ where }),
  ])

  return res.status(200).json(successResponse(
    items.map(withModerationHints),
    'Reports retrieved successfully.',
    {
      totalItems,
      itemCount: items.length,
      itemsPerPage: limit,
      totalPages: Math.max(1, Math.ceil(totalItems / limit)),
      currentPage: page,
    },
  ))
})

/**
 * One report with the moderation actions already recorded against it.
 *
 * The history comes from the audit store, which is the only place a report action is written, so a
 * reviewer sees who did what, when, with what outcome and — for a reopen — why.
 */
export const getReportDetail = asyncHandler(async (req: RequestWithUser, res: Response) => {
  if (!req.user?.id) {
    return res.status(401).json(errorResponse('Authentication required.'))
  }

  const report = await prisma.report.findFirst({
    where: { id: req.params.id, deletedAt: null },
    include: { user: { select: { id: true, fullName: true, email: true } } },
  })

  if (!report) {
    return res.status(404).json(errorResponse('Report not found.'))
  }

  const history = await prisma.systemLog.findMany({
    where: moderationLogFilter({ entityType: 'report', entityId: report.id }),
    orderBy: { createdAt: 'desc' },
    take: 50,
  })

  return res.status(200).json(successResponse(
    { ...withModerationHints(report), history: history.map(readModerationEvent) },
    'Report retrieved successfully.',
  ))
})

/**
 * Moves a report to another status.
 *
 * Three things make this trustworthy rather than best-effort: the transition table decides what is
 * allowed (so a second resolution of the same report is refused), the write is a compare-and-set on the
 * status the reviewer actually saw (so two reviewers cannot both win), and the audit event is written in
 * the same transaction as the status change with the actor taken from the authenticated session.
 */
export const updateReportStatus = asyncHandler(async (req: RequestWithUser, res: Response) => {
  const actorId = req.user?.id
  if (!actorId) {
    return res.status(401).json(errorResponse('Authentication required.'))
  }

  const { status, reason } = req.body as { status?: string; reason?: string }

  if (!isReportStatus(status)) {
    return res.status(400).json(errorResponse('Please choose a valid report status.'))
  }

  const trimmedReason = typeof reason === 'string' ? reason.trim().slice(0, 500) : ''
  if (requiresReportReason(status) && !trimmedReason) {
    return res.status(400).json(errorResponse(`A reason is required when moving a report to ${status}.`))
  }

  const result = await prisma.$transaction(async (tx) => {
    const report = await tx.report.findFirst({ where: { id: req.params.id, deletedAt: null } })

    if (!report) {
      throw new AppError(404, 'Report not found.')
    }

    if (!canTransitionReportStatus(report.status, status)) {
      throw new AppError(
        409,
        report.status === status
          ? `This report is already ${status}.`
          : `A report that is ${report.status} cannot be moved to ${status}.`,
      )
    }

    const claimed = await tx.report.updateMany({
      where: { id: report.id, status: report.status },
      data: { status },
    })

    if (claimed.count === 0) {
      throw new AppError(409, 'This report was updated by someone else. Reload it and try again.')
    }

    const updatedReport = await tx.report.findUnique({
      where: { id: report.id },
      include: { user: { select: { id: true, fullName: true, email: true } } },
    })

    if (!updatedReport) {
      throw new AppError(404, 'Report not found.')
    }

    await recordModerationEvent({
      action: 'report.status.updated',
      actorId,
      actorName: req.user?.fullName ?? null,
      entityId: report.id,
      reason: trimmedReason || null,
      requestId: (req as Request & { id?: string }).id ?? null,
      before: { status: report.status },
      after: { status },
      // The report's own content is what the reviewer read, so only its identity is repeated here.
      details: { category: report.category, summary: report.summary.slice(0, 120) },
    }, tx)

    return updatedReport
  })

  return res.status(200).json(successResponse(withModerationHints(result), 'Report status updated successfully.'))
})
