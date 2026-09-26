import { Queue, Worker, type Job } from 'bullmq'
import { createHash } from 'node:crypto'
import webPush from 'web-push'
import { prisma } from './prisma.js'
import { redis } from './redis.js'
import logger from './logger.js'
import { emitUserNotification } from './socketManager.js'

export const NOTIFICATION_QUEUE_NAME = 'notification-dispatch'
const NOTIFICATION_BATCH_SIZE = 100
const NOTIFICATION_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 1000 },
  removeOnComplete: { age: 60 * 60 * 24 },
  removeOnFail: { age: 60 * 60 * 24 * 7 },
}

export interface NotificationQueuePayload {
  userId: string
  title: string
  body: string
  type?: string
  link?: string
  channel?: 'IN_APP' | 'EMAIL' | 'PUSH'
  dedupeKey?: string
  retrySubscriptionIds?: string[]
  retryAllPushSubscriptions?: boolean
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
        ...NOTIFICATION_JOB_OPTIONS,
      },
    })
  : null

let workerInstance: Worker<NotificationQueuePayload> | null = null

async function sendPushNotification(
  notification: { id: string; userId: string; title: string; body: string; type: string; link?: string | null },
  subscriptionIds?: string[],
): Promise<string[]> {
  if (!pushConfigured) {
    return []
  }

  const subscriptions = await prisma.pushSubscription.findMany({
    where: {
      userId: notification.userId,
      isActive: true,
      deletedAt: null,
      ...(subscriptionIds ? { id: { in: subscriptionIds } } : {}),
    },
    select: {
      id: true,
      endpoint: true,
      p256dh: true,
      auth: true,
    },
  })

  if (subscriptions.length === 0) {
    return []
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

  const pushResults = await Promise.all(subscriptions.map(async (subscription) => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
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
          return { subscriptionId: subscription.id, status: 'fulfilled' as const }
      } catch (reason) {
        const statusCode = Number((reason as { statusCode?: unknown })?.statusCode)
        if (statusCode === 404 || statusCode === 410 || attempt === 2) {
          return { subscriptionId: subscription.id, status: 'rejected' as const, statusCode }
        }
        await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)))
      }
    }
    return { subscriptionId: subscription.id, status: 'rejected' as const, statusCode: 0 }
  }))

  const inactiveSubscriptions = subscriptions.filter((_, index) => {
    const result = pushResults[index]
    return result.status === 'rejected' && (result.statusCode === 404 || result.statusCode === 410)
  })
  const failedSubscriptionIds = pushResults
    .filter((result) => result.status === 'rejected' && result.statusCode !== 404 && result.statusCode !== 410)
    .map((result) => result.subscriptionId)

  const rejectedCount = pushResults.filter((result) => result.status === 'rejected').length
  const inactiveCount = inactiveSubscriptions.length
  if (rejectedCount > 0) {
    logger.warn({ userId: notification.userId, notificationId: notification.id, rejectedCount, inactiveCount }, 'Some web push deliveries failed after bounded retries')
  }

  if (inactiveSubscriptions.length > 0) {
    try {
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
    } catch {
      logger.warn({ userId: notification.userId, notificationId: notification.id, inactiveCount: inactiveSubscriptions.length }, 'Could not deactivate expired push subscriptions')
    }
  }

  return failedSubscriptionIds
}

export async function dispatchUserNotification(payload: NotificationQueuePayload): Promise<{ created: boolean; id?: string; failedPushSubscriptionIds?: string[] }> {
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
    if (notificationPayload.channel === 'PUSH' && (payload.retryAllPushSubscriptions || payload.retrySubscriptionIds?.length)) {
      const failedPushSubscriptionIds = await sendPushNotification({ ...notificationPayload, id: existingNotification.id }, payload.retryAllPushSubscriptions ? undefined : payload.retrySubscriptionIds)
      return { created: false, id: existingNotification.id, failedPushSubscriptionIds }
    }
    return { created: false, id: existingNotification.id }
  }

  const createdNotification = await prisma.notification.create({
    data: notificationPayload,
  })

  if (notificationPayload.channel === 'PUSH') {
    const failedPushSubscriptionIds = await sendPushNotification(createdNotification)
    return { created: true, id: createdNotification.id, failedPushSubscriptionIds }
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

function getNotificationJobId(payload: NotificationQueuePayload): string {
  const dedupeKey = payload.dedupeKey ?? `${payload.userId}:${payload.title}:${payload.body}:${payload.channel ?? 'IN_APP'}`
  return createHash('sha256').update(dedupeKey).digest('hex')
}

async function dispatchNotificationsDirectly(payloads: NotificationQueuePayload[]): Promise<Array<string | null>> {
  const ids: Array<string | null> = []
  for (const payload of payloads) {
    const result = await dispatchUserNotification(payload)
    ids.push(result.id ?? null)
  }
  return ids
}

export async function enqueueUserNotifications(payloads: NotificationQueuePayload[]): Promise<Array<string | null>> {
  if (payloads.length === 0) return []
  if (!queueInstance || !process.env.REDIS_URL) return dispatchNotificationsDirectly(payloads)

  const ids: Array<string | null> = []
  for (let offset = 0; offset < payloads.length; offset += NOTIFICATION_BATCH_SIZE) {
    const batch = payloads.slice(offset, offset + NOTIFICATION_BATCH_SIZE)
    try {
      const jobs = await queueInstance.addBulk(batch.map((payload) => ({
        name: 'send' as const,
        data: payload,
        opts: { jobId: getNotificationJobId(payload), ...NOTIFICATION_JOB_OPTIONS },
      })))
      ids.push(...jobs.map((job) => job.id ?? null))
    } catch (error) {
      logger.warn({ err: error, batchSize: batch.length }, 'Notification queue batch unavailable; dispatching directly')
      ids.push(...await dispatchNotificationsDirectly(batch))
    }
  }
  return ids
}

export async function enqueueUserNotification(payload: NotificationQueuePayload): Promise<string | null> {
  const [id] = await enqueueUserNotifications([payload])
  return id ?? null
}

export function startNotificationWorker(): void {
  if (!queueInstance || workerInstance) {
    return
  }

  try {
    workerInstance = new Worker<NotificationQueuePayload>(
      NOTIFICATION_QUEUE_NAME,
      async (job: Job<NotificationQueuePayload>) => {
        let result: Awaited<ReturnType<typeof dispatchUserNotification>>
        try {
          result = await dispatchUserNotification(job.data)
        } catch (error) {
          if (job.data.channel === 'PUSH') {
            await job.updateData({ ...job.data, retryAllPushSubscriptions: true, retrySubscriptionIds: undefined })
          }
          throw error
        }
        if (result.failedPushSubscriptionIds?.length) {
          await job.updateData({
            ...job.data,
            retryAllPushSubscriptions: false,
            retrySubscriptionIds: result.failedPushSubscriptionIds,
          })
          throw new Error(`Web Push delivery failed for ${result.failedPushSubscriptionIds.length} subscription(s)`)
        }
        logger.info({ jobId: job.id, userId: job.data.userId, created: result.created }, 'Notification job processed')
        return result
      },
      {
        connection: redis as any,
        concurrency: 5,
        limiter: { max: 100, duration: 60_000 },
        drainDelay: 10,
        removeOnComplete: NOTIFICATION_JOB_OPTIONS.removeOnComplete,
        removeOnFail: NOTIFICATION_JOB_OPTIONS.removeOnFail,
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
