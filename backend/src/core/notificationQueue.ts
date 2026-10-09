import { Queue, Worker, type Job } from 'bullmq'
import { createHash } from 'node:crypto'
import webPush from 'web-push'
import { prisma } from './prisma.js'
import { getPrimaryRedisStatus, isRedisConfigured, redis } from './redis.js'
import { getRedisErrorCode } from './redisFailover.js'
import logger from './logger.js'
import { emitUserNotification } from './socketManager.js'
import {
  buildPushMessage,
  isMatchPushDeliveryValid,
  parseMatchPushLink,
  type MatchDeliverySnapshot,
  type MatchPushExtras,
} from './pushPresentation.js'

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
  /**
   * Presentation for a match push, built once per match by the notification service.
   * Carrying it here means the worker no longer re-reads the match row for every recipient.
   */
  pushMatch?: MatchPushExtras | null
  retrySubscriptionIds?: string[]
  retryAllPushSubscriptions?: boolean
}

const hasRedisConnection = isRedisConfigured
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

/** A burst of connection errors is summarised to one line per interval instead of one line per event. */
const WORKER_ERROR_LOG_INTERVAL_MS = 30_000

/**
 * Delivery-time match snapshot, cached for a few seconds.
 *
 * A broadcast fans out to many recipients and every recipient job needs to know whether its match is
 * still worth alerting about. A short TTL collapses that into one read per match per window, while a
 * kickoff or status change still takes effect within the same short window. A miss always re-reads,
 * so nothing here is authoritative for longer than the TTL.
 */
const MATCH_SNAPSHOT_TTL_MS = 30_000
const MATCH_SNAPSHOT_MAX_ENTRIES = 200
const matchSnapshotCache = new Map<string, { expiresAt: number; snapshot: MatchDeliverySnapshot | null }>()

async function getMatchSnapshot(matchId: string): Promise<MatchDeliverySnapshot | null> {
  const cached = matchSnapshotCache.get(matchId)
  if (cached) {
    if (cached.expiresAt > Date.now()) return cached.snapshot
    matchSnapshotCache.delete(matchId)
  }

  const snapshot = await prisma.match.findUnique({
    where: { id: matchId },
    select: { status: true, kickoffAt: true, deletedAt: true },
  })

  if (matchSnapshotCache.size >= MATCH_SNAPSHOT_MAX_ENTRIES) {
    const oldestKey = matchSnapshotCache.keys().next().value
    if (oldestKey !== undefined) matchSnapshotCache.delete(oldestKey)
  }
  matchSnapshotCache.set(matchId, { expiresAt: Date.now() + MATCH_SNAPSHOT_TTL_MS, snapshot })
  return snapshot
}

/**
 * Payload for any push that carries no match presentation with it.
 *
 * Only reached by a job that was already queued without match extras (for example an in-flight job
 * across a deploy). It keeps the previous single-icon behaviour instead of dropping the image.
 */
async function buildLegacyPushMessage(notification: {
  id: string
  title: string
  body: string
  type: string
  link?: string | null
}): Promise<string> {
  const matchId = parseMatchPushLink(notification.link)?.matchId
  const match = matchId
    ? await prisma.match.findUnique({
        where: { id: matchId },
        select: { homeTeamLogo: true, awayTeamLogo: true },
      })
    : null
  const icon = [match?.homeTeamLogo, match?.awayTeamLogo].find((value) => typeof value === 'string' && /^https?:\/\//i.test(value)) ?? null

  return JSON.stringify({
    title: notification.title,
    body: notification.body,
    type: notification.type,
    link: notification.link ?? '/notifications',
    notificationId: notification.id,
    ...(icon ? { icon } : {}),
  })
}

async function sendPushNotification(
  notification: {
    id: string
    userId: string
    title: string
    body: string
    type: string
    link?: string | null
    pushMatch?: MatchPushExtras | null
  },
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

  const payload = notification.pushMatch
    ? buildPushMessage({
        title: notification.title,
        body: notification.body,
        type: notification.type,
        link: notification.link ?? '/notifications',
        notificationId: notification.id,
        extras: notification.pushMatch,
      })
    : await buildLegacyPushMessage(notification)

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

  const pushMatch = payload.pushMatch ?? null
  if (pushMatch) {
    // The queue can lag behind the schedule, so a match alert is re-validated when it is actually
    // delivered. A reminder for a kickoff that moved (or for a match that already started, finished,
    // was rejected or was removed) is dropped here rather than telling a viewer to tune in at a time
    // that no longer applies. The replacement reminder has its own identity and is unaffected.
    const snapshot = await getMatchSnapshot(pushMatch.matchId)
    if (!isMatchPushDeliveryValid(pushMatch.kind, parseMatchPushLink(payload.link)?.kickoffMarker ?? null, snapshot)) {
      logger.info(
        { matchId: pushMatch.matchId, kind: pushMatch.kind, status: snapshot?.status },
        'Skipped a match push whose kickoff or status changed before delivery',
      )
      return { created: false }
    }
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
      const failedPushSubscriptionIds = await sendPushNotification({ ...notificationPayload, id: existingNotification.id, pushMatch }, payload.retryAllPushSubscriptions ? undefined : payload.retrySubscriptionIds)
      return { created: false, id: existingNotification.id, failedPushSubscriptionIds }
    }
    return { created: false, id: existingNotification.id }
  }

  try {
    const createdNotification = await prisma.notification.create({
      data: notificationPayload,
    })

    if (notificationPayload.channel === 'PUSH') {
      // The stored row is the delivery ledger for push-only notifications: it is what makes the
      // broadcast idempotent (the per-user `notifications: { none: ... }` filter stops the
      // per-minute match-reminder tick from re-sending) and what lets failed subscriptions be
      // retried. In-app queries always filter `channel: 'IN_APP'`, so this row is never shown in
      // the In-App inbox, never counted in the unread badge and never emitted over Socket.IO.
      const failedPushSubscriptionIds = await sendPushNotification({ ...createdNotification, pushMatch })
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
  } catch (error) {
    const duplicateKey = (error as { code?: string } | null)?.code
    if (duplicateKey === 'P2002') {
      const existingNotification = await prisma.notification.findFirst({
        where: {
          userId: payload.userId,
          type: notificationPayload.type,
          channel: notificationPayload.channel,
          link: payload.link ?? null,
          deletedAt: null,
        },
        select: { id: true },
      })

      if (existingNotification) {
        return { created: false, id: existingNotification.id }
      }
    }

    throw error
  }
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
  if (!queueInstance || !isRedisConfigured) return dispatchNotificationsDirectly(payloads)

  const uniquePayloads: NotificationQueuePayload[] = []
  const seenJobIds = new Set<string>()
  for (const payload of payloads) {
    const jobId = getNotificationJobId(payload)
    if (seenJobIds.has(jobId)) {
      continue
    }
    seenJobIds.add(jobId)
    uniquePayloads.push(payload)
  }

  if (uniquePayloads.length === 0) return Array(payloads.length).fill(null)

  const ids: Array<string | null> = []
  for (let offset = 0; offset < uniquePayloads.length; offset += NOTIFICATION_BATCH_SIZE) {
    const batch = uniquePayloads.slice(offset, offset + NOTIFICATION_BATCH_SIZE)
    try {
      const jobs = await queueInstance.addBulk(batch.map((payload) => ({
        name: 'send' as const,
        data: payload,
        opts: { jobId: getNotificationJobId(payload), ...NOTIFICATION_JOB_OPTIONS },
      })))
      ids.push(...jobs.map((job) => job.id ?? null))
    } catch (error) {
      logger.warn({ code: getRedisErrorCode(error), batchSize: batch.length }, 'Notification queue batch unavailable; dispatching directly')
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
        // Long poll interval while the queue is empty (BullMQ default is 5s).
        drainDelay: 30,
        removeOnComplete: NOTIFICATION_JOB_OPTIONS.removeOnComplete,
        removeOnFail: NOTIFICATION_JOB_OPTIONS.removeOnFail,
      },
    )

    workerInstance.on('failed', (job, err) => {
      logger.error({
        jobId: job?.id,
        jobName: job?.name,
        // Attempt metadata only: the job payload carries user ids, titles and bodies and must never be logged.
        attemptsMade: job?.attemptsMade,
        configuredAttempts: job?.opts?.attempts,
        code: getRedisErrorCode(err),
        errorType: err instanceof Error ? err.name : typeof err,
        message: (err instanceof Error ? err.message : String(err)).slice(0, 300),
      }, 'Notification worker job failed')
    })

    // BullMQ emits this once per connection problem, and a Redis outage produces a burst of them.
    // Each burst is summarised to one line per interval so the reason stays visible without filling
    // the log; the client's own connection status is included to tell "Redis is down" apart from a job
    // level failure.
    let lastWorkerErrorLoggedAt = 0
    let suppressedWorkerErrors = 0
    workerInstance.on('error', (err) => {
      const now = Date.now()
      if (now - lastWorkerErrorLoggedAt < WORKER_ERROR_LOG_INTERVAL_MS) {
        suppressedWorkerErrors += 1
        return
      }
      logger.error({
        code: getRedisErrorCode(err),
        errorType: err instanceof Error ? err.name : typeof err,
        message: (err instanceof Error ? err.message : String(err)).slice(0, 300),
        redisStatus: getPrimaryRedisStatus(),
        suppressedSinceLastLog: suppressedWorkerErrors,
      }, 'Notification worker error')
      suppressedWorkerErrors = 0
      lastWorkerErrorLoggedAt = now
    })
  } catch (error) {
    workerInstance = null
    logger.error({ err: error }, 'Notification worker could not start')
  }
}

export async function closeNotificationQueue(): Promise<void> {
  // Both are closed independently and never reject to the caller: during a shutdown after a Redis
  // outage the queue's connection may already be gone, and that must not skip the worker or mask the
  // original failure the shutdown was handling.
  try {
    await workerInstance?.close()
  } catch (error) {
    logger.warn({ code: getRedisErrorCode(error) }, 'Notification worker close failed during shutdown')
  }
  try {
    await queueInstance?.close()
  } catch (error) {
    logger.warn({ code: getRedisErrorCode(error) }, 'Notification queue close failed during shutdown')
  }
}
