import { Queue, Worker, type Job } from 'bullmq'
import { createHash } from 'node:crypto'
import webPush from 'web-push'
import { prisma } from './prisma.js'
import { redis } from './redis.js'
import logger from './logger.js'
import { emitUserNotification } from './socketManager.js'

export const NOTIFICATION_QUEUE_NAME = 'notification-dispatch'

export interface NotificationQueuePayload {
  userId: string
  title: string
  body: string
  type?: string
  link?: string
  channel?: 'IN_APP' | 'EMAIL' | 'PUSH'
  dedupeKey?: string
}

const hasRedisConnection = Boolean(process.env.REDIS_URL?.trim())
const vapidPublicKey = process.env.VAPID_PUBLIC_KEY?.trim() ?? ''
const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY?.trim() ?? ''
const vapidSubject = process.env.VAPID_SUBJECT?.trim() || 'mailto:support@sportzonebd.com'
let pushConfigured = false

if (vapidPublicKey && vapidPrivateKey) {
  try {
    webPush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey)
    pushConfigured = true
    logger.info('Web Push VAPID configuration enabled')
  } catch (error) {
    logger.warn({ err: error }, 'Web Push VAPID configuration is invalid; push delivery disabled')
  }
} else {
  logger.warn('VAPID keys are not configured; push delivery disabled while in-app notifications remain available')
}

const queueInstance = hasRedisConnection
  ? new Queue<NotificationQueuePayload>(NOTIFICATION_QUEUE_NAME, {
      connection: redis as any,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000 },
        removeOnComplete: { age: 60 * 60 * 24 },
        removeOnFail: { age: 60 * 60 * 24 * 7 },
      },
    })
  : null

let workerInstance: Worker<NotificationQueuePayload> | null = null

async function sendPushNotification(notification: { id: string; userId: string; title: string; body: string; type: string; link?: string | null }): Promise<void> {
  if (!pushConfigured) {
    return
  }

  const subscriptions = await prisma.pushSubscription.findMany({
    where: {
      userId: notification.userId,
      isActive: true,
      deletedAt: null,
    },
    select: {
      endpoint: true,
      p256dh: true,
      auth: true,
    },
  })

  if (subscriptions.length === 0) {
    return
  }

  const matchId = notification.link?.match(/^\/matches\/([0-9a-f-]{36})$/i)?.[1]
  const match = matchId
    ? await prisma.match.findUnique({
        where: { id: matchId },
        select: { homeTeamLogo: true, awayTeamLogo: true },
      })
    : null
  const icon = [match?.homeTeamLogo, match?.awayTeamLogo].find((value) => typeof value === 'string' && /^https?:\/\//i.test(value)) ?? null

  const payload = JSON.stringify({
    title: notification.title,
    body: notification.body,
    type: notification.type,
    link: notification.link ?? '/notifications',
    notificationId: notification.id,
    ...(icon ? { icon } : {}),
  })

  const pushResults = await Promise.allSettled(
    subscriptions.map(async (subscription) => {
      await webPush.sendNotification(
        {
          endpoint: subscription.endpoint,
          keys: {
            p256dh: subscription.p256dh,
            auth: subscription.auth,
          },
        },
        payload,
      )
    }),
  )

  const inactiveSubscriptions = subscriptions.filter((_, index) => {
    const result = pushResults[index]
    return result.status === 'rejected' && (result.reason as any)?.statusCode === 410
  })

  const rejectedCount = pushResults.filter((result) => result.status === 'rejected').length
  if (rejectedCount > 0) {
    logger.warn({ userId: notification.userId, rejectedCount }, 'Some web push deliveries were rejected')
  }

  if (inactiveSubscriptions.length > 0) {
    await prisma.pushSubscription.updateMany({
      where: {
        userId: notification.userId,
        endpoint: { in: inactiveSubscriptions.map((item) => item.endpoint) },
      },
      data: {
        isActive: false,
        deletedAt: new Date(),
      },
    })
  }
}

export async function dispatchUserNotification(payload: NotificationQueuePayload): Promise<{ created: boolean; id?: string }> {
  const notificationPayload = {
    userId: payload.userId,
    title: payload.title,
    body: payload.body,
    type: payload.type ?? 'info',
    channel: payload.channel ?? 'IN_APP',
    ...(payload.link ? { link: payload.link } : {}),
  }

  const existingNotification = await prisma.notification.findFirst({
    where: notificationPayload.type === 'match-reminder' || notificationPayload.type === 'match-started'
      ? {
          userId: payload.userId,
          type: notificationPayload.type,
          channel: notificationPayload.channel,
          link: payload.link ?? null,
          deletedAt: null,
        }
      : {
          userId: payload.userId,
          title: payload.title,
          body: payload.body,
          channel: notificationPayload.channel,
          link: payload.link ?? null,
          deletedAt: null,
        },
    select: { id: true },
  })

  if (existingNotification) {
    return { created: false, id: existingNotification.id }
  }

  const createdNotification = await prisma.notification.create({
    data: notificationPayload,
  })

  if (notificationPayload.channel === 'PUSH') {
    try {
      await sendPushNotification(createdNotification)
    } catch (error) {
      logger.warn({ err: error, userId: payload.userId, notificationId: createdNotification.id }, 'Push notification delivery failed')
    }
  }

  if (notificationPayload.channel === 'IN_APP') {
    emitUserNotification(payload.userId, {
      id: createdNotification.id,
      userId: createdNotification.userId,
      title: createdNotification.title,
      body: createdNotification.body,
      type: createdNotification.type,
      channel: createdNotification.channel,
      link: createdNotification.link,
      createdAt: createdNotification.createdAt,
    })
  }

  return { created: true, id: createdNotification.id }
}

export async function enqueueUserNotification(payload: NotificationQueuePayload): Promise<string | null> {
  if (!queueInstance || !process.env.REDIS_URL) {
    const result = await dispatchUserNotification(payload)
    return result.id ?? null
  }

  const dedupeKey = payload.dedupeKey ?? `${payload.userId}:${payload.title}:${payload.body}:${payload.channel ?? 'IN_APP'}`
  const jobId = createHash('sha256').update(dedupeKey).digest('hex')
  try {
    const job = await queueInstance.add('send', payload, {
      jobId,
      attempts: 3,
      backoff: { type: 'exponential', delay: 1000 },
      removeOnComplete: { age: 60 * 60 * 24 },
      removeOnFail: { age: 60 * 60 * 24 * 7 },
    })

    return job?.id ?? null
  } catch (error) {
    logger.warn({ err: error, userId: payload.userId, channel: payload.channel ?? 'IN_APP' }, 'Notification queue unavailable; dispatching directly')
    const result = await dispatchUserNotification(payload)
    return result.id ?? null
  }
}

export function startNotificationWorker(): void {
  if (!queueInstance || workerInstance) {
    return
  }

  try {
    workerInstance = new Worker<NotificationQueuePayload>(
      NOTIFICATION_QUEUE_NAME,
      async (job: Job<NotificationQueuePayload>) => {
        const result = await dispatchUserNotification(job.data)
        logger.info({ jobId: job.id, userId: job.data.userId, created: result.created }, 'Notification job processed')
        return result
      },
      {
        connection: redis as any,
        concurrency: 5,
        limiter: { max: 100, duration: 60_000 },
        removeOnComplete: { age: 60 * 60 },
        removeOnFail: { age: 60 * 60 * 24 },
      },
    )

    workerInstance.on('failed', (job, err) => {
      logger.error({ jobId: job?.id, err }, 'Notification worker job failed')
    })
    workerInstance.on('error', (err) => {
      logger.error({ err }, 'Notification worker error')
    })
  } catch (error) {
    workerInstance = null
    logger.error({ err: error }, 'Notification worker could not start')
  }
}

export async function closeNotificationQueue(): Promise<void> {
  await queueInstance?.close()
  await workerInstance?.close()
}
