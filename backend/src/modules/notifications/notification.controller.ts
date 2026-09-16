import type { NextFunction, Request, Response } from 'express'
import { prisma } from '../../core/prisma.js'
import asyncHandler from '../../utils/asyncHandler.js'
import { errorResponse, successResponse, type PaginationMeta } from '../../core/api-response.js'
import { z } from 'zod'
import { createAdminBroadcastNotification } from '../../services/notification.service.js'

interface RequestWithUser extends Request {
  user?: { id: string }
}

/**
 * Gets the count of unread notifications for the authenticated user.
 */
export const getUnreadNotificationCount = asyncHandler(async (req: RequestWithUser, res: Response) => {
  const userId = req.user!.id
  const count = await prisma.notification.count({
    where: { userId, channel: 'IN_APP', isRead: false, deletedAt: null },
  })
  return res.status(200).json(successResponse({ count }))
})

export const registerPushSubscription = asyncHandler(async (req: RequestWithUser, res: Response) => {
  const { endpoint, keys } = req.body ?? {}

  if (typeof endpoint !== 'string' || endpoint.trim().length === 0) {
    return res.status(400).json(errorResponse('Push subscription endpoint is required.'))
  }

  if (!keys || typeof keys.p256dh !== 'string' || typeof keys.auth !== 'string') {
    return res.status(400).json(errorResponse('Push subscription keys are required.'))
  }

  const userId = req.user!.id
  const userAgent = typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null

  await prisma.pushSubscription.upsert({
    where: { endpoint: endpoint.trim() },
    update: {
      userId,
      p256dh: keys.p256dh.trim(),
      auth: keys.auth.trim(),
      userAgent,
      isActive: true,
      deletedAt: null,
    },
    create: {
      userId,
      endpoint: endpoint.trim(),
      p256dh: keys.p256dh.trim(),
      auth: keys.auth.trim(),
      userAgent,
      isActive: true,
    },
  })

  return res.status(201).json(successResponse({ success: true }, 'Push subscription registered successfully.'))
})

export const unregisterPushSubscription = asyncHandler(async (req: RequestWithUser, res: Response) => {
  const { endpoint } = req.body ?? {}

  if (typeof endpoint !== 'string' || endpoint.trim().length === 0) {
    return res.status(400).json(errorResponse('Push subscription endpoint is required.'))
  }

  await prisma.pushSubscription.updateMany({
    where: {
      userId: req.user!.id,
      endpoint: endpoint.trim(),
      deletedAt: null,
    },
    data: {
      isActive: false,
      deletedAt: new Date(),
    },
  })

  return res.status(200).json(successResponse({ success: true }, 'Push subscription removed successfully.'))
})

/**
 * Gets a paginated list of notifications for the authenticated user.
 */
export const getNotifications = asyncHandler(async (req: RequestWithUser, res: Response) => {
  const userId = req.user!.id
  const pagination = z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(25),
  }).safeParse(req.query)
  if (!pagination.success) return res.status(400).json(errorResponse('Invalid notification pagination.'))

  const { page, limit } = pagination.data
  const skip = (page - 1) * limit

  const [notifications, total] = await prisma.$transaction([
    prisma.notification.findMany({
      where: { userId, channel: 'IN_APP', deletedAt: null },
      select: {
        id: true,
        userId: true,
        title: true,
        body: true,
        link: true,
        type: true,
        channel: true,
        isRead: true,
        createdAt: true,
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit,
      skip,
    }),
    prisma.notification.count({
      where: { userId, channel: 'IN_APP', deletedAt: null },
    }),
  ])

  const matchIds = notifications
    .map((notification) => notification.link?.match(/^\/matches\/([0-9a-f-]{36})$/i)?.[1])
    .filter((id): id is string => Boolean(id))
  const matches = matchIds.length > 0
    ? await prisma.match.findMany({
        where: { id: { in: matchIds }, deletedAt: null },
        select: { id: true, homeTeamName: true, awayTeamName: true, homeTeamLogo: true, awayTeamLogo: true },
      })
    : []
  const matchById = new Map(matches.map((match) => [match.id, match]))
  const enrichedNotifications = notifications.map((notification) => {
    const matchId = notification.link?.match(/^\/matches\/([0-9a-f-]{36})$/i)?.[1]
    return matchId && matchById.has(matchId)
      ? { ...notification, match: matchById.get(matchId) }
      : notification
  })

  const meta: PaginationMeta = {
    currentPage: page,
    itemsPerPage: limit,
    totalItems: total,
    totalPages: Math.ceil(total / limit),
    itemCount: notifications.length,
  }

  return res.status(200).json(successResponse({ items: enrichedNotifications, meta }, 'Notifications retrieved successfully'))
})

export const deleteNotification = asyncHandler(async (req: RequestWithUser, res: Response) => {
  const notificationId = req.params.id
  if (!z.string().uuid().safeParse(notificationId).success) {
    return res.status(400).json(errorResponse('Notification ID is invalid.'))
  }

  const result = await prisma.notification.updateMany({
    where: { id: notificationId, userId: req.user!.id, channel: 'IN_APP', deletedAt: null },
    data: { deletedAt: new Date() },
  })
  if (result.count === 0) return res.status(404).json(errorResponse('Notification not found.'))
  return res.status(200).json(successResponse(null, 'Notification deleted.'))
})

export const deleteAllNotifications = asyncHandler(async (req: RequestWithUser, res: Response) => {
  await prisma.notification.updateMany({
    where: { userId: req.user!.id, channel: 'IN_APP', deletedAt: null },
    data: { deletedAt: new Date() },
  })
  return res.status(200).json(successResponse(null, 'All notifications deleted.'))
})

/**
 * Marks all unread notifications for the authenticated user as read.
 */
export const markAllNotificationsAsRead = asyncHandler(async (req: RequestWithUser, res: Response) => {
  const userId = req.user!.id

  await prisma.notification.updateMany({
    where: {
      userId,
      channel: 'IN_APP',
      isRead: false,
      deletedAt: null,
    },
    data: {
      isRead: true,
    },
  })

  return res.status(200).json(successResponse(null, 'All notifications marked as read.'))
})

/**
 * Marks a single notification as read.
 */
export const markNotificationAsRead = asyncHandler(async (req: RequestWithUser, res: Response) => {
  const userId = req.user!.id
  const { id: notificationId } = req.params

  if (!notificationId) {
    return res.status(400).json(errorResponse('Notification ID is required.'))
  }

  if (!z.string().uuid().safeParse(notificationId).success) {
    return res.status(400).json(errorResponse('Notification ID is invalid.'))
  }

  const result = await prisma.notification.updateMany({
    where: { id: notificationId, userId, deletedAt: null, isRead: false },
    data: { isRead: true },
  })

  if (result.count === 0) {
    const notification = await prisma.notification.findFirst({
      where: { id: notificationId, userId, channel: 'IN_APP', deletedAt: null },
      select: { id: true },
    })
    if (!notification) return res.status(404).json(errorResponse('Notification not found.'))
    return res.status(200).json(successResponse(null, 'Notification was already marked as read.'))
  }

  return res.status(200).json(successResponse(null, 'Notification marked as read.'))
})

export const broadcastSystemNotification = asyncHandler(async (req: RequestWithUser, res: Response) => {
  const { title, body, type, userId, link, targetAudience } = req.body ?? {}

  if (typeof title !== 'string' || title.trim().length < 3) {
    return res.status(400).json(errorResponse('Notification title is required.'))
  }

  if (typeof body !== 'string' || body.trim().length < 3) {
    return res.status(400).json(errorResponse('Notification body is required.'))
  }

  if (userId && typeof userId !== 'string') {
    return res.status(400).json(errorResponse('User ID must be a string.'))
  }

  if (link !== undefined && (typeof link !== 'string' || (!link.startsWith('/') && !/^https:\/\//i.test(link)))) {
    return res.status(400).json(errorResponse('Link must be an internal path or HTTPS URL.'))
  }

  if (targetAudience !== undefined && !['ALL', 'PREMIUM', 'FREE'].includes(targetAudience)) {
    return res.status(400).json(errorResponse('Invalid notification audience.'))
  }

  const createdCount = await createAdminBroadcastNotification({
    userId: typeof userId === 'string' ? userId : undefined,
    title: title.trim(),
    body: body.trim(),
    type: typeof type === 'string' ? type : 'info',
    link: typeof link === 'string' ? link.trim() : undefined,
    targetAudience: targetAudience as 'ALL' | 'PREMIUM' | 'FREE' | undefined,
  })

  return res.status(201).json(successResponse({ createdCount }, 'Notification broadcast queued successfully.'))
})