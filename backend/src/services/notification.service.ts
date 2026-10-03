import { prisma } from '../core/prisma.js'
import type { Prisma } from '@prisma/client'
import { enqueueUserNotifications, type NotificationQueuePayload } from '../core/notificationQueue.js'

const BROADCAST_USER_BATCH_SIZE = 500

async function* iterateBroadcastUsers(where: Prisma.UserWhereInput, userId?: string): AsyncGenerator<Array<{ id: string }>> {
  if (userId) {
    yield [{ id: userId }]
    return
  }

  let afterId: string | undefined
  while (true) {
    const users = await prisma.user.findMany({
      where: afterId ? { AND: [where, { id: { gt: afterId } }] } : where,
      select: { id: true },
      orderBy: { id: 'asc' },
      take: BROADCAST_USER_BATCH_SIZE,
    })
    if (users.length === 0) return

    yield users
    afterId = users[users.length - 1].id
    if (users.length < BROADCAST_USER_BATCH_SIZE) return
  }
}

interface NotificationEvent {
  title: string
  body: string
  type?: string
  link?: string
  preference: 'matchStartPush' | 'newHighlightPush'
}

async function broadcastNotificationChannel(
  event: NotificationEvent,
  channel: 'IN_APP' | 'PUSH',
): Promise<number> {
  const existingNotificationWhere = event.type === 'match-reminder' || event.type === 'match-started'
    ? { type: event.type, channel, link: event.link ?? null, deletedAt: null }
    : { title: event.title, body: event.body, channel, link: event.link ?? null, deletedAt: null }

  const where: Prisma.UserWhereInput = {
    isActive: true,
    isSuspended: false,
    isBanned: false,
    deletedAt: null,
    notifications: { none: existingNotificationWhere },
    ...(channel === 'PUSH' ? {
      pushSubscriptions: { some: { isActive: true, deletedAt: null } },
      OR: [
        { notificationPreferences: null },
        { notificationPreferences: { is: { [event.preference]: true } } },
      ],
    } : {}),
  }

  let queuedCount = 0
  for await (const users of iterateBroadcastUsers(where)) {
    const payloads: NotificationQueuePayload[] = users.map((user) => ({
      userId: user.id,
      title: event.title,
      body: event.body,
      type: event.type ?? 'info',
      link: event.link,
      channel,
      dedupeKey: `${channel}:${event.title}:${event.body}:${event.link ?? ''}:${user.id}`,
    }))
    const results = await enqueueUserNotifications(payloads)
    queuedCount += results.filter(Boolean).length
  }

  return queuedCount
}

/**
 * Creates in-app notifications for opted-in active users without duplicating an event.
 */
export async function broadcastInAppNotification(event: NotificationEvent): Promise<number> {
  return broadcastNotificationChannel(event, 'IN_APP')
}

export async function notifyMatchStarted(match: { id: string; title: string }): Promise<number> {
  const inAppCount = await broadcastNotificationChannel(
    {
      title: 'Match Started',
      body: `${match.title} has started! Tap to watch live.`,
      type: 'match-started',
      link: `/matches/${match.id}`,
      preference: 'matchStartPush',
    },
    'IN_APP',
  )

  const pushCount = await broadcastNotificationChannel(
    {
      title: 'Match Started',
      body: `${match.title} has started! Tap to watch live.`,
      type: 'match-started',
      link: `/matches/${match.id}`,
      preference: 'matchStartPush',
    },
    'PUSH',
  )

  return inAppCount + pushCount
}

export async function notifyMatchReminder(match: { id: string; title: string }): Promise<number> {
  const eventData = {
    title: 'Match Starting Soon',
    body: `${match.title} starts soon! Tap to watch live.`,
    type: 'match-reminder',
    link: `/matches/${match.id}`,
    preference: 'matchStartPush',
  } as const

  const inAppCount = await broadcastNotificationChannel(eventData, 'IN_APP')
  const pushCount = await broadcastNotificationChannel(eventData, 'PUSH')

  return inAppCount + pushCount
}

export async function notifyHighlightAdded(highlight: { id: string; title: string; matchTitle?: string | null }): Promise<number> {
  const matchLabel = highlight.matchTitle ? ` from ${highlight.matchTitle}` : ''
  const inAppCount = await broadcastNotificationChannel(
    {
      title: 'New Highlight Available',
      body: `${highlight.title}${matchLabel} is now available to watch.`,
      type: 'success',
      preference: 'newHighlightPush',
    },
    'IN_APP',
  )

  const pushCount = await broadcastNotificationChannel(
    {
      title: 'New Highlight Available',
      body: `${highlight.title}${matchLabel} is now available to watch.`,
      type: 'success',
      preference: 'newHighlightPush',
    },
    'PUSH',
  )

  return inAppCount + pushCount
}

export async function createAdminBroadcastNotification(payload: {
  userId?: string
  title: string
  body: string
  type?: string
  link?: string
  targetAudience?: 'ALL' | 'PREMIUM' | 'FREE'
  channel?: 'IN_APP' | 'PUSH' | 'BOTH'
}): Promise<number> {
  const channel = payload.channel ?? 'BOTH'
  const targetWhere: Prisma.UserWhereInput = {
    isActive: true,
    isSuspended: false,
    isBanned: false,
    deletedAt: null,
    ...(payload.targetAudience === 'PREMIUM'
      ? { subscriptions: { some: { status: 'ACTIVE', expiresAt: { gt: new Date() }, deletedAt: null } } }
      : payload.targetAudience === 'FREE'
        ? { subscriptions: { none: { status: 'ACTIVE', expiresAt: { gt: new Date() }, deletedAt: null } } }
        : {}),
  }

  let recipientCount = 0
  for await (const targetUsers of iterateBroadcastUsers(targetWhere, payload.userId)) {
    const targetUserIds = targetUsers.map(({ id }) => id)
    const pushEligibleUserIds = channel === 'IN_APP'
      ? new Set<string>()
      : new Set((await prisma.pushSubscription.findMany({
          where: {
            userId: { in: targetUserIds },
            isActive: true,
            deletedAt: null,
          },
          select: { userId: true },
          distinct: ['userId'],
        })).map(({ userId }) => userId))

    const queuePayloads: NotificationQueuePayload[] = []
    targetUsers.forEach((user) => {
      if (channel !== 'PUSH') {
        queuePayloads.push({
          userId: user.id,
          title: payload.title,
          body: payload.body,
          type: payload.type ?? 'info',
          link: payload.link,
          channel: 'IN_APP',
          dedupeKey: `${payload.title}:${payload.body}:${payload.link ?? ''}:${user.id}:IN_APP`,
        })
      }

      if (channel !== 'IN_APP' && pushEligibleUserIds.has(user.id)) {
        queuePayloads.push({
          userId: user.id,
          title: payload.title,
          body: payload.body,
          type: payload.type ?? 'info',
          link: payload.link,
          channel: 'PUSH',
          dedupeKey: `${payload.title}:${payload.body}:${payload.link ?? ''}:${user.id}:PUSH`,
        })
      }
    })

    const results = await enqueueUserNotifications(queuePayloads)
    const acceptedRecipients = new Set<string>()
    queuePayloads.forEach((item, index) => {
      if (results[index]) acceptedRecipients.add(item.userId)
    })
    recipientCount += acceptedRecipients.size
  }

  return recipientCount
}
