import { prisma } from '../core/prisma.js'
import { enqueueUserNotification } from '../core/notificationQueue.js'

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
  const users = await prisma.user.findMany({
    where: {
      isActive: true,
      isSuspended: false,
      isBanned: false,
      deletedAt: null,
      OR: [
        { notificationPreferences: null },
        { notificationPreferences: { is: { [event.preference]: true } } },
      ],
    },
    select: { id: true },
  })

  if (users.length === 0) return 0

  const createdIds: string[] = []
  for (const user of users) {
    const result = await enqueueUserNotification({
      userId: user.id,
      title: event.title,
      body: event.body,
      type: event.type ?? 'info',
      link: event.link,
      channel,
      dedupeKey: `${channel}:${event.title}:${event.body}:${event.link ?? ''}:${user.id}`,
    })

    if (result) {
      createdIds.push(result)
    }
  }

  return createdIds.length
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
}): Promise<number> {
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

  let createdCount = 0
  for (const user of targetUsers) {
    const inAppResult = await enqueueUserNotification({
      userId: user.id,
      title: payload.title,
      body: payload.body,
      type: payload.type ?? 'info',
      link: payload.link,
      channel: 'IN_APP',
      dedupeKey: `${payload.title}:${payload.body}:${payload.link ?? ''}:${user.id}:IN_APP`,
    })

    const pushResult = await enqueueUserNotification({
      userId: user.id,
      title: payload.title,
      body: payload.body,
      type: payload.type ?? 'info',
      link: payload.link,
      channel: 'PUSH',
      dedupeKey: `${payload.title}:${payload.body}:${payload.link ?? ''}:${user.id}:PUSH`,
    })

    if (inAppResult || pushResult) createdCount += 1
  }

  return createdCount
}
