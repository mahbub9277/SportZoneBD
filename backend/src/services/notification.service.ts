import { prisma } from '../core/prisma.js'
import type { Prisma } from '@prisma/client'
import { enqueueUserNotifications, type NotificationQueuePayload } from '../core/notificationQueue.js'
import { emitTransientNotification } from '../core/socketManager.js'
import {
  buildMatchPushPresentation,
  type MatchPushExtras,
  type MatchPushKind,
  type MatchPushSource,
} from '../core/pushPresentation.js'

const BROADCAST_USER_BATCH_SIZE = 500

/**
 * The match columns a match push needs.
 *
 * Kept to one place so the reminder tick keeps using the same single bounded query it always did -
 * it simply carries the few extra columns the push presentation is built from.
 */
export const MATCH_PUSH_SELECT = {
  id: true,
  title: true,
  kickoffAt: true,
  tournamentName: true,
  homeTeamLogo: true,
  awayTeamLogo: true,
} satisfies Prisma.MatchSelect

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
  /** Match pushes only: the presentation extras that ride along with the queue payload. */
  pushMatch?: MatchPushExtras | null
}

/** Stable per-event id so the client can drop duplicate toasts after reconnects or re-emits. */
function transientEventId(event: NotificationEvent): string {
  return `transient:${event.type ?? 'info'}:${event.link ?? ''}:${event.title}`
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
      ...(event.pushMatch ? { pushMatch: event.pushMatch } : {}),
    }))
    const results = await enqueueUserNotifications(payloads)
    queuedCount += results.filter(Boolean).length

    if (channel === 'PUSH') {
      // Push-only alerts are also surfaced to focused tabs as transient UI. Nothing is persisted,
      // nothing reaches the In-App inbox and the unread badge is untouched.
      const notifiedUserIds = payloads.filter((_, index) => Boolean(results[index])).map((payload) => payload.userId)
      emitTransientNotification(notifiedUserIds, {
        id: transientEventId(event),
        title: event.title,
        body: event.body,
        type: event.type ?? 'info',
        link: event.link ?? null,
      })
    }
  }

  return queuedCount
}

/**
 * Creates in-app notifications for opted-in active users without duplicating an event.
 * Use this only for genuine persistent In-App notifications; automated sports alerts are push-only.
 */
export async function broadcastInAppNotification(event: NotificationEvent): Promise<number> {
  return broadcastNotificationChannel(event, 'IN_APP')
}

/**
 * Automated sports alerts are push-only: they are delivered to browsers/devices through the
 * PUSH channel and must NOT create persistent In-App notification records, so the In-App inbox
 * and its unread badge stay reserved for genuine product-level notifications.
 */
async function broadcastPushAlert(event: NotificationEvent): Promise<number> {
  return broadcastNotificationChannel(event, 'PUSH')
}

/**
 * Builds a match alert from the match's own stored data and hands the presentation to the queue.
 *
 * The presentation (competition, both crests, kickoff) is computed once here per match and carried in
 * the payload, so it is identical for every recipient and no longer re-read per delivery.
 */
async function broadcastMatchPush(match: MatchPushSource, kind: MatchPushKind): Promise<number> {
  const presentation = buildMatchPushPresentation(match, kind)
  return broadcastPushAlert({
    title: presentation.title,
    body: presentation.body,
    type: kind === 'reminder' ? 'match-reminder' : 'match-started',
    link: presentation.link,
    pushMatch: presentation.extras,
    preference: 'matchStartPush',
  })
}

export async function notifyMatchStarted(match: MatchPushSource): Promise<number> {
  return broadcastMatchPush(match, 'started')
}

export async function notifyMatchReminder(match: MatchPushSource): Promise<number> {
  return broadcastMatchPush(match, 'reminder')
}

export async function notifyHighlightAdded(highlight: { id: string; title: string; matchTitle?: string | null }): Promise<number> {
  const matchLabel = highlight.matchTitle ? ` from ${highlight.matchTitle}` : ''
  return broadcastPushAlert({
    title: 'New Highlight Available',
    body: `${highlight.title}${matchLabel} is now available to watch.`,
    type: 'success',
    preference: 'newHighlightPush',
  })
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
