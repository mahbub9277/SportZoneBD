import { prisma } from '../core/prisma.js'
import { enqueueUserNotifications, type NotificationQueuePayload } from '../core/notificationQueue.js'

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

  const users = await prisma.user.findMany({
    where: {
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
    },
    select: { id: true },
  })

  if (users.length === 0) return 0

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
  return results.filter(Boolean).length
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
  const inAppCount = await broadcastNotificationChannel(
    {
      title: 'Match Starting Soon',
      body: `${match.title} starts soon! Tap to watch live.`,
      type: 'match-reminder',
      link: `/matches/${match.id}`,
      preference: 'matchStartPush',
    },
    'IN_APP',
  )

  const pushCount = await broadcastNotificationChannel(
    {
      title: 'Match Starting Soon',
      body: `${match.title} starts soon! Tap to watch live.`,
      type: 'match-reminder',
      link: `/matches/${match.id}`,
      preference: 'matchStartPush',
    },
    'PUSH',
  )

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
  const targetUsers = payload.userId
    ? [{ id: payload.userId }]
    : await prisma.user.findMany({
        where: {
          isActive: true,
          isSuspended: false,
          isBanned: false,
          deletedAt: null,
          ...(payload.targetAudience === 'PREMIUM'
            ? { subscriptions: { some: { status: 'ACTIVE', expiresAt: { gt: new Date() }, deletedAt: null } } }
            : payload.targetAudience === 'FREE'
              ? { subscriptions: { none: { status: 'ACTIVE', expiresAt: { gt: new Date() }, deletedAt: null } } }
              : {}),
        },
        select: { id: true },
      })

  const pushEligibleUserIds = channel === 'IN_APP' || targetUsers.length === 0
    ? new Set<string>()
    : new Set((await prisma.pushSubscription.findMany({
        where: {
          userId: { in: targetUsers.map(({ id }) => id) },
          isActive: true,
          deletedAt: null,
        },
        select: { userId: true },
        distinct: ['userId'],
      })).map(({ userId }) => userId))

  const queuePayloads: NotificationQueuePayload[] = []
  const recipientIndexes: number[] = []
  targetUsers.forEach((user, index) => {
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
      recipientIndexes.push(index)
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
      recipientIndexes.push(index)
    }
  })

  const results = await enqueueUserNotifications(queuePayloads)
  return new Set(results.flatMap((result, index) => result ? [recipientIndexes[index]] : [])).size
}
