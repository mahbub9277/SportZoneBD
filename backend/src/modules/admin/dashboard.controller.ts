import { type Request, type Response } from 'express'
import asyncHandler from '../../utils/asyncHandler.js'
import { prisma } from '../../core/prisma.js'
import { successResponse } from '../../core/api-response.js'
import { cache } from '../../core/cache.js'

/**
 * @desc    Get dashboard statistics
 * @route   GET /api/v1/admin/dashboard/stats
 * @access  Private (Admin)
 */
const getStats = asyncHandler(async (_req: Request, res: Response) => {
  const [totalUsers, totalMatches, totalSubscriptions, liveMatches, pendingPayments, paymentData] = await prisma.$transaction([
    prisma.user.count({ where: { guestMode: false } }),
    prisma.match.count(),
    prisma.subscription.count({ where: { status: 'ACTIVE' } }),
    prisma.match.count({ where: { status: 'LIVE', deletedAt: null } }),
    prisma.payment.count({ where: { status: 'PENDING' } }),
    prisma.payment.aggregate({
      _sum: { amount: true },
      where: { status: 'COMPLETED' },
    }),
  ])

  res.status(200).json(successResponse({
    totalUsers,
    totalMatches,
    totalSubscriptions,
    totalRevenue: paymentData._sum?.amount ?? 0,
    liveMatches,
    pendingPayments,
  }))
})

/**
 * @desc    Get data for dashboard charts
 * @route   GET /api/v1/admin/dashboard/chart-data
 * @access  Private (Admin)
 */
const getChartData = asyncHandler(async (_req: Request, res: Response) => {
  // Get last 12 months of revenue
  const revenueData = await prisma.$queryRaw`
    SELECT
      TO_CHAR(p."createdAt", 'YYYY-MM') AS month,
      SUM(p.amount)::float AS total
    FROM "Payment" p
    WHERE p.status = 'COMPLETED' AND p."createdAt" > NOW() - INTERVAL '12 months'
    GROUP BY month
    ORDER BY month;
  `

  // Get last 30 days of user signups
  const userSignupsData = await prisma.$queryRaw`
    SELECT
      TO_CHAR(u."createdAt", 'YYYY-MM-DD') AS day,
      COUNT(u.id)::int AS count
    FROM "User" u
    WHERE u."guestMode" = false AND u."createdAt" > NOW() - INTERVAL '30 days'
    GROUP BY day
    ORDER BY day;
  `

  res.status(200).json(successResponse({ revenue: revenueData, userSignups: userSignupsData }))
})

/**
 * @desc    Get recently registered users
 * @route   GET /api/v1/admin/dashboard/recent-users
 * @access  Private (Admin)
 */
const getRecentUsers = asyncHandler(async (_req: Request, res: Response) => {
  const cacheKey = 'recent-users'
  const ttlSeconds = 60 * 5 // Cache for 5 minutes

  const recentUsers = await cache(
    cacheKey,
    () =>
      prisma.user.findMany({
        where: { guestMode: false, deletedAt: null },
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: {
          id: true,
          fullName: true,
          email: true,
          avatar: true,
          createdAt: true,
        },
      }),
    ttlSeconds,
    ['recent-users'],
  )
  res.status(200).json(successResponse(recentUsers))
})

export const dashboardController = { getStats, getChartData, getRecentUsers }