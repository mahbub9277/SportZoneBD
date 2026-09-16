import type { NextFunction, Request, Response } from 'express'
import { prisma } from '../../core/prisma.js'
import asyncHandler from '../../utils/asyncHandler.js'
import { errorResponse, successResponse } from '../../core/api-response.js'

interface RequestWithUser extends Request {
  user?: { id: string; fullName?: string | null; email?: string | null }
}

const REPORT_CATEGORIES = ['Bug', 'Playback', 'Payment', 'Account', 'Content'] as const
const REPORT_STATUSES = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'] as const

type ReportCategory = (typeof REPORT_CATEGORIES)[number]
type ReportStatus = (typeof REPORT_STATUSES)[number]

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

  const category = typeof req.query.category === 'string' && REPORT_CATEGORIES.includes(req.query.category as ReportCategory)
    ? req.query.category as ReportCategory
    : undefined
  const status = typeof req.query.status === 'string' && REPORT_STATUSES.includes(req.query.status as ReportStatus)
    ? req.query.status as ReportStatus
    : undefined
  const search = typeof req.query.search === 'string' ? req.query.search.trim() : ''

  const reports = await prisma.report.findMany({
    where: {
      deletedAt: null,
      ...(category ? { category } : {}),
      ...(status ? { status } : {}),
      ...(search ? {
        OR: [
          { category: { contains: search, mode: 'insensitive' } },
          { summary: { contains: search, mode: 'insensitive' } },
          { details: { contains: search, mode: 'insensitive' } },
          { user: { fullName: { contains: search, mode: 'insensitive' } } },
          { user: { email: { contains: search, mode: 'insensitive' } } },
        ],
      } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: 50,
    include: {
      user: {
        select: {
          id: true,
          fullName: true,
          email: true,
        },
      },
    },
  })

  return res.status(200).json(successResponse(reports, 'Reports retrieved successfully.'))
})

export const updateReportStatus = asyncHandler(async (req: RequestWithUser, res: Response) => {
  const userId = req.user?.id
  if (!userId) {
    return res.status(401).json(errorResponse('Authentication required.'))
  }

  const { status } = req.body as { status?: string }
  if (!status || !REPORT_STATUSES.includes(status as ReportStatus)) {
    return res.status(400).json(errorResponse('Please choose a valid report status.'))
  }

  const report = await prisma.report.findUnique({
    where: { id: req.params.id, deletedAt: null },
  })

  if (!report) {
    return res.status(404).json(errorResponse('Report not found.'))
  }

  const updatedReport = await prisma.report.update({
    where: { id: report.id },
    data: { status: status as ReportStatus },
    include: {
      user: {
        select: { id: true, fullName: true, email: true },
      },
    },
  })

  return res.status(200).json(successResponse(updatedReport, 'Report status updated successfully.'))
})
