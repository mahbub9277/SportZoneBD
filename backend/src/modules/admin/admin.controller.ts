import { Request, Response } from 'express'
import asyncHandler from '../../utils/asyncHandler.js'
import { prisma } from '../../core/prisma.js';
import { Prisma } from '@prisma/client';
import { successResponse } from '../../core/api-response.js'
import { cache } from '../../core/cache.js'
import { getTotalLiveViewers } from '../../core/socketManager.js'

/**
 * @desc    Get dashboard statistics
 * @route   GET /api/v1/admin/stats
 * @access  Private (Admin)
 */
export const getDashboardStats = asyncHandler(async (_req: Request, res: Response) => {
  const now = new Date()
  const [totalUsers, totalMatches, totalSubscriptions, activeSubscriptions, expiredSubscriptions, premiumUsers, liveMatches, pendingPayments, successfulPayments, rejectedPayments, failedPayments, totalTransactions, totalPlans, paymentData] = await prisma.$transaction([
    prisma.user.count({ where: { guestMode: false, deletedAt: null } }),
    prisma.match.count(),
    prisma.subscription.count({ where: { deletedAt: null } }),
    prisma.subscription.count({ where: { status: 'ACTIVE', expiresAt: { gt: now }, deletedAt: null } }),
    prisma.subscription.count({ where: { deletedAt: null, OR: [{ status: 'EXPIRED' }, { status: 'ACTIVE', expiresAt: { lte: now } }] } }),
    prisma.user.count({ where: { guestMode: false, deletedAt: null, subscriptions: { some: { status: 'ACTIVE', expiresAt: { gt: now }, deletedAt: null } } } }),
    prisma.match.count({ where: { status: 'LIVE', deletedAt: null } }),
    prisma.payment.count({ where: { status: { in: ['PENDING', 'PENDING_REVIEW'] }, deletedAt: null } }),
    prisma.payment.count({ where: { status: { in: ['APPROVED', 'COMPLETED'] }, deletedAt: null } }),
    prisma.payment.count({ where: { status: 'REJECTED', deletedAt: null } }),
    prisma.payment.count({ where: { status: { in: ['FAILED', 'REFUNDED'] }, deletedAt: null } }),
    prisma.payment.count({ where: { deletedAt: null } }),
    prisma.subscriptionPlan.count({ where: { deletedAt: null } }),
    prisma.payment.aggregate({
      _sum: { amount: true },
      where: { status: { in: ['APPROVED', 'COMPLETED'] }, deletedAt: null },
    }),
  ])
  const totalLiveViewers = await getTotalLiveViewers()

  res.status(200).json(successResponse({
    totalUsers,
    totalMatches,
    totalSubscriptions,
    activeSubscriptions,
    expiredSubscriptions,
    premiumUsers,
    totalRevenue: Number(paymentData._sum?.amount ?? 0),
    liveMatches,
    totalLiveViewers,
    pendingPayments,
    successfulPayments,
    rejectedPayments,
    failedPayments,
    totalTransactions,
    totalPlans,
  }))
})

/**
 * @desc    Get data for dashboard charts
 * @route   GET /api/v1/admin/chart-data
 * @access  Private (Admin)
 */
export const getChartData = asyncHandler(async (_req: Request, res: Response) => {
  // Get last 12 months of revenue
  const revenueData = await prisma.$queryRaw`
    SELECT
      TO_CHAR(p."createdAt", 'YYYY-MM') AS month,
      SUM(p.amount)::float AS total
    FROM "Payment" p
    WHERE p.status IN ('APPROVED', 'COMPLETED')
      AND p."deletedAt" IS NULL
      AND p."createdAt" > NOW() - INTERVAL '12 months'
    GROUP BY month
    ORDER BY month;
  `

  // Get last 30 days of user signups
  const userSignupsData = await prisma.$queryRaw`
    SELECT
      TO_CHAR(u."createdAt", 'YYYY-MM-DD') AS day,
      COUNT(u.id)::int AS count
    FROM "User" u
    WHERE u."guestMode" = false
      AND u."deletedAt" IS NULL
      AND u."createdAt" > NOW() - INTERVAL '30 days'
    GROUP BY day
    ORDER BY day;
  `

  res.status(200).json(successResponse({ revenue: revenueData, userSignups: userSignupsData }))
})

/**
 * @desc    Get recently registered users
 * @route   GET /api/v1/admin/recent-users
 * @access  Private (Admin)
 */
export const getRecentUsers = asyncHandler(async (_req: Request, res: Response) => {
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
  res.status(200).json(successResponse(recentUsers));
})

export const getAdvertisementAnalytics = asyncHandler(async (req: Request, res: Response) => {
  const periodValue = typeof req.query.period === 'string' ? req.query.period : '1'
  const period = periodValue === 'all' ? null : Number(periodValue)
  if (period !== null && ![1, 3, 6, 9, 12].includes(period)) {
    return res.status(400).json({ success: false, message: 'Period must be 1, 3, 6, 9, 12, or all.' })
  }

  const since = period === null ? null : new Date(Date.now() - period * 30 * 24 * 60 * 60 * 1000)
  const periodFilter = since ? { createdAt: { gte: since } } : {}
  const adTypes = ['ADVERTISEMENT_IMPRESSION', 'ADVERTISEMENT_WATCH_NOW', 'ADVERTISEMENT_SESSION_STARTED', 'ADVERTISEMENT_SESSION_COMPLETED', 'ADVERTISEMENT_SESSION_CANCELLED']

  const [events, uniqueUsers, byType, audience] = await prisma.$transaction([
    prisma.analyticsEvent.count({ where: { ...periodFilter, type: { in: adTypes } } }),
    prisma.analyticsEvent.findMany({ where: { ...periodFilter, type: { in: adTypes }, userId: { not: null } }, distinct: ['userId'], select: { userId: true } }),
    prisma.analyticsEvent.groupBy({ by: ['type'], where: { ...periodFilter, type: { in: adTypes } }, orderBy: { type: 'asc' }, _count: { _all: true } }),
    prisma.$queryRaw<Array<{ audience: string; count: number }>>`
      SELECT CASE
        WHEN u.id IS NULL THEN 'GUEST'
        WHEN EXISTS (
          SELECT 1 FROM "Subscription" s
          WHERE s."userId" = u.id AND s.status = 'ACTIVE' AND s."expiresAt" > NOW() AND s."deletedAt" IS NULL
        ) THEN 'PREMIUM'
        ELSE 'STANDARD'
      END AS audience, COUNT(*)::int AS count
      FROM "AnalyticsEvent" e
      LEFT JOIN "User" u ON u.id = e."userId"
      WHERE e.type IN ('ADVERTISEMENT_IMPRESSION', 'ADVERTISEMENT_WATCH_NOW', 'ADVERTISEMENT_SESSION_STARTED', 'ADVERTISEMENT_SESSION_COMPLETED', 'ADVERTISEMENT_SESSION_CANCELLED')
        ${since ? Prisma.sql`AND e."createdAt" >= ${since}` : Prisma.empty}
      GROUP BY audience
    `,
  ])

  const countByType = Object.fromEntries(byType.map((item) => [item.type, Number((item._count as { _all?: number } | undefined)?._all ?? 0)]))
  const audienceCounts = Object.fromEntries(audience.map((item) => [item.audience, Number(item.count)]))
  res.json(successResponse({
    period: periodValue,
    totalEvents: events,
    uniqueUsers: uniqueUsers.length,
    impressions: countByType.ADVERTISEMENT_IMPRESSION ?? 0,
    watchClicks: countByType.ADVERTISEMENT_WATCH_NOW ?? 0,
    sessionsStarted: countByType.ADVERTISEMENT_SESSION_STARTED ?? 0,
    sessionsCompleted: countByType.ADVERTISEMENT_SESSION_COMPLETED ?? 0,
    sessionsCancelled: countByType.ADVERTISEMENT_SESSION_CANCELLED ?? 0,
    standardEvents: audienceCounts.STANDARD ?? 0,
    premiumEvents: audienceCounts.PREMIUM ?? 0,
    guestEvents: audienceCounts.GUEST ?? 0,
  }))
})