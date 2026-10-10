import type { Request, Response } from 'express'
import asyncHandler from '../../utils/asyncHandler.js'
import { prisma } from '../../core/prisma.js'
import { successResponse } from '../../core/api-response.js'
import { STAFF_ROLE_NAMES } from '../../core/access.js'
import {
  MODERATION_ACTIONS,
  moderationActionOptions,
  moderationLogFilter,
  readModerationEvent,
} from '../../core/moderationAudit.js'
import {
  SESSION_IDLE_TIMEOUT_MS,
  computeSessionActivity,
  summarizeSessionActivity,
  type SessionActivityInput,
} from '../../core/sessionActivity.js'
import { previewNotificationAudience } from '../../services/notification.service.js'

/**
 * The moderation console's read-only side: what is waiting, what was already done, and how much time was
 * actually spent in the console.
 *
 * Every number here is a count or a duration derived from real rows. Nothing is scored, sampled or
 * extrapolated, and a value the data cannot support is reported as unavailable rather than guessed.
 */

/** The default window for the "recent" figures on the dashboard. */
const DEFAULT_WINDOW_DAYS = 30
/** Sessions listed in one response. */
const DEFAULT_SESSION_LIMIT = 100
const MAX_PAGE_SIZE = 100
/** How many campaigns the dashboard totals are summed over, per channel. */
const CAMPAIGN_SAMPLE_LIMIT = 200

interface ActorScope {
  /** The signed-in staff member, whose own activity the dashboard summarises first. */
  actorId: string
  actorName: string | null
}

function readActor(req: Request): ActorScope | null {
  const user = (req as Request & { user?: { id?: string; fullName?: string | null } }).user
  if (!user?.id) return null
  return { actorId: user.id, actorName: user.fullName ?? null }
}

function parseDate(value: unknown): Date | null {
  if (typeof value !== 'string') return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function parsePositiveInteger(value: unknown, fallback: number, max: number): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return Math.min(max, Math.floor(parsed))
}

/** The requested window, defaulting to the last 30 days so a bare request still describes something real. */
function resolveWindow(req: Request): { from: Date; to: Date } {
  const to = parseDate(req.query.to) ?? new Date()
  const from = parseDate(req.query.from) ?? new Date(to.getTime() - DEFAULT_WINDOW_DAYS * 24 * 60 * 60 * 1000)
  return { from, to }
}

/** The staff accounts a moderator's activity can be filtered by. */
async function staffAccounts(): Promise<Array<{ id: string; fullName: string }>> {
  return prisma.user.findMany({
    where: {
      deletedAt: null,
      roles: {
        some: {
          deletedAt: null,
          role: { name: { in: [...STAFF_ROLE_NAMES] }, deletedAt: null },
        },
      },
    },
    select: { id: true, fullName: true },
    orderBy: { fullName: 'asc' },
    take: 200,
  })
}

function toSessionActivityInput(session: {
  createdAt: Date
  updatedAt: Date
  deletedAt: Date | null
  expiresAt: Date
}): SessionActivityInput {
  return {
    startedAt: session.createdAt,
    // The session row is touched by a credential refresh and by the console's activity heartbeat, so its
    // `updatedAt` is the last recorded activity of that session.
    lastSeenAt: session.updatedAt,
    endedAt: session.deletedAt,
    expiresAt: session.expiresAt,
    now: new Date(),
  }
}

/**
 * The moderator dashboard summary.
 *
 * "By me" figures come from the audit trail's actor, so they describe actions this staff member actually
 * took. Report and payment queues are counted from the same rows the queues themselves list.
 */
export const getModerationSummary = asyncHandler(async (req: Request, res: Response) => {
  const actor = readActor(req)
  const { from, to } = resolveWindow(req)
  const now = new Date()
  const expiringSoon = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)

  const ownEventFilter = moderationLogFilter({ actorId: actor?.actorId, from, to })
  const reportActionFilter = moderationLogFilter({ actorId: actor?.actorId, action: 'report.status.updated', from, to })

  const [
    openReports,
    inProgressReports,
    resolvedReports,
    closedReports,
    awaitingReview,
    approvedPayments,
    rejectedPayments,
    activeMembers,
    expiringMembers,
    resolvedByMe,
    closedByMe,
    approvedByMe,
    rejectedByMe,
    ownEvents,
    recentLogs,
  ] = await prisma.$transaction([
    prisma.report.count({ where: { status: 'OPEN', deletedAt: null } }),
    prisma.report.count({ where: { status: 'IN_PROGRESS', deletedAt: null } }),
    prisma.report.count({ where: { status: 'RESOLVED', deletedAt: null } }),
    prisma.report.count({ where: { status: 'CLOSED', deletedAt: null } }),
    prisma.payment.count({ where: { status: 'PENDING_REVIEW', deletedAt: null } }),
    prisma.payment.count({ where: { status: { in: ['APPROVED', 'COMPLETED'] }, deletedAt: null } }),
    prisma.payment.count({ where: { status: 'REJECTED', deletedAt: null } }),
    prisma.subscription.count({ where: { status: 'ACTIVE', expiresAt: { gt: now }, deletedAt: null } }),
    prisma.subscription.count({ where: { status: 'ACTIVE', expiresAt: { gt: now, lte: expiringSoon }, deletedAt: null } }),
    prisma.systemLog.count({ where: { AND: [reportActionFilter, { meta: { path: ['after', 'status'], equals: 'RESOLVED' } }] } }),
    prisma.systemLog.count({ where: { AND: [reportActionFilter, { meta: { path: ['after', 'status'], equals: 'CLOSED' } }] } }),
    prisma.systemLog.count({ where: moderationLogFilter({ actorId: actor?.actorId, action: 'payment.review.approved', from, to }) }),
    prisma.systemLog.count({ where: moderationLogFilter({ actorId: actor?.actorId, action: 'payment.review.rejected', from, to }) }),
    prisma.systemLog.count({ where: ownEventFilter }),
    prisma.systemLog.findMany({ where: ownEventFilter, orderBy: { createdAt: 'desc' }, take: 8 }),
  ])

  // The viewer's own sessions in the window, which is what the duration summary describes.
  const ownSessions = actor
    ? await prisma.session.findMany({
        where: { userId: actor.actorId, createdAt: { gte: from, lte: to } },
        select: { id: true, createdAt: true, updatedAt: true, deletedAt: true, expiresAt: true },
        orderBy: { createdAt: 'desc' },
        take: 200,
      })
    : []

  const pushCampaigns = await prisma.systemLog.findMany({
    where: moderationLogFilter({ action: 'push.campaign.sent', from, to }),
    select: { meta: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
    take: CAMPAIGN_SAMPLE_LIMIT,
  })
  const emailCampaigns = await prisma.systemLog.findMany({
    where: moderationLogFilter({ action: 'email.campaign.sent', from, to }),
    select: { meta: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
    take: CAMPAIGN_SAMPLE_LIMIT,
  })

  const sessionSummary = summarizeSessionActivity(
    ownSessions.map((session) => toSessionActivityInput(session)),
    { now },
  )

  const campaignTotals = (logs: Array<{ meta: unknown }>, key: 'queuedRecipients' | 'sentCount') => {
    let recipients = 0
    let failures = 0
    for (const log of logs) {
      const meta = log.meta && typeof log.meta === 'object' ? (log.meta as Record<string, unknown>) : {}
      const details = meta.details && typeof meta.details === 'object' ? (meta.details as Record<string, unknown>) : {}
      const value = Number(details[key])
      if (Number.isFinite(value)) recipients += value
      const failed = Number(details.failedCount)
      if (Number.isFinite(failed)) failures += failed
    }
    return { recipients, failures }
  }

  const pushTotals = campaignTotals(pushCampaigns, 'queuedRecipients')
  const emailTotals = campaignTotals(emailCampaigns, 'sentCount')

  res.status(200).json(successResponse({
    window: { from, to },
    scope: { actorId: actor?.actorId ?? null, actorName: actor?.actorName ?? null },
    reports: {
      awaitingAction: openReports + inProgressReports,
      open: openReports,
      inProgress: inProgressReports,
      resolved: resolvedReports,
      closed: closedReports,
      total: openReports + inProgressReports + resolvedReports + closedReports,
      resolvedByMe: resolvedByMe + closedByMe,
    },
    payments: {
      awaitingReview,
      approvedTotal: approvedPayments,
      rejectedTotal: rejectedPayments,
      reviewedByMe: approvedByMe + rejectedByMe,
    },
    premium: {
      activeMembers,
      expiringWithin7Days: expiringMembers,
    },
    campaigns: {
      pushCampaigns: pushCampaigns.length,
      pushQueuedRecipients: pushTotals.recipients,
      emailCampaigns: emailCampaigns.length,
      emailsSent: emailTotals.recipients,
      emailsFailed: emailTotals.failures,
      /**
       * These figures are summed over the most recent campaigns in the window, not over every campaign
       * ever started, and `countIsCapped` says when the sample limit was reached so the interface can say
       * so instead of presenting a partial number as a total.
       */
      basedOnCampaigns: pushCampaigns.length + emailCampaigns.length,
      countIsCapped: pushCampaigns.length >= CAMPAIGN_SAMPLE_LIMIT || emailCampaigns.length >= CAMPAIGN_SAMPLE_LIMIT,
    },
    activity: {
      recordedActions: ownEvents,
      sessionCount: sessionSummary.sessionCount,
      exactSessionCount: sessionSummary.exactSessionCount,
      estimatedSessionCount: sessionSummary.estimatedSessionCount,
      totalSessionMs: sessionSummary.totalDurationMs,
      estimatedActiveMs: sessionSummary.totalActiveMs,
      lastSeenAt: sessionSummary.lastSeenAt,
      /** Per-action duration is not measured: the platform records when an action happened, not how long it took. */
      actionDurationMeasured: false,
    },
    recentEvents: recentLogs.map(readModerationEvent),
  }))
})

/**
 * The moderation audit history, filtered.
 *
 * The totals next to the list are exact counts over the same filter, and the list itself is a bounded
 * page, so the numbers and the rows always describe the same set of events.
 */
export const getModerationActivity = asyncHandler(async (req: Request, res: Response) => {
  const actor = readActor(req)
  const page = parsePositiveInteger(req.query.page, 1, Number.MAX_SAFE_INTEGER)
  const limit = parsePositiveInteger(req.query.limit, 20, MAX_PAGE_SIZE)
  const from = parseDate(req.query.from)
  const to = parseDate(req.query.to)

  const actorIdParam = typeof req.query.actorId === 'string' && req.query.actorId.trim() ? req.query.actorId.trim() : undefined
  // `scope=me` is the default the console opens with; naming another moderator is an explicit filter.
  const scope = typeof req.query.scope === 'string' ? req.query.scope : 'me'
  const actorId = scope === 'all' ? actorIdParam : (actorIdParam ?? actor?.actorId)

  const filter = moderationLogFilter({
    actorId,
    action: typeof req.query.action === 'string' && req.query.action.trim() ? req.query.action.trim() : undefined,
    outcome: req.query.outcome === 'success' || req.query.outcome === 'failure' ? req.query.outcome : undefined,
    entityType: typeof req.query.entityType === 'string' && req.query.entityType.trim() ? req.query.entityType.trim() : undefined,
    search: typeof req.query.search === 'string' ? req.query.search : undefined,
    from: from ?? undefined,
    to: to ?? undefined,
  })

  const [items, totalItems, successCount, failureCount, ...actionCounts] = await prisma.$transaction([
    prisma.systemLog.findMany({ where: filter, orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: limit }),
    prisma.systemLog.count({ where: filter }),
    prisma.systemLog.count({ where: { AND: [filter, { meta: { path: ['outcome'], equals: 'success' } }] } }),
    prisma.systemLog.count({ where: { AND: [filter, { meta: { path: ['outcome'], equals: 'failure' } }] } }),
    ...Object.keys(MODERATION_ACTIONS).flatMap((action) => [
      prisma.systemLog.count({ where: { AND: [filter, { meta: { path: ['action'], equals: action } }] } }),
      prisma.systemLog.count({
        where: {
          AND: [filter, { meta: { path: ['action'], equals: action } }, { meta: { path: ['outcome'], equals: 'failure' } }],
        },
      }),
    ]),
  ])

  const actionKeys = Object.keys(MODERATION_ACTIONS)
  const byAction = actionKeys.map((action, index) => ({
    action,
    label: MODERATION_ACTIONS[action as keyof typeof MODERATION_ACTIONS].message,
    count: actionCounts[index * 2] ?? 0,
    failureCount: actionCounts[index * 2 + 1] ?? 0,
  }))

  return res.status(200).json(successResponse(
    { items: items.map(readModerationEvent), summary: { totalItems, successCount, failureCount, byAction } },
    'Moderation activity retrieved.',
    {
      totalItems,
      itemCount: items.length,
      itemsPerPage: limit,
      totalPages: Math.max(1, Math.ceil(totalItems / limit)),
      currentPage: page,
    },
  ))
})

/**
 * Session activity for the staff who work in the console.
 *
 * Durations are derived from the session rows: exact when the session was revoked or reached its expiry,
 * and otherwise a floor that stops at one bounded idle window after the last recorded activity. A session
 * with no recorded end is flagged as estimated so it cannot be read as a measured shift.
 */
export const getModerationSessions = asyncHandler(async (req: Request, res: Response) => {
  const actor = readActor(req)
  const { from, to } = resolveWindow(req)
  const limit = parsePositiveInteger(req.query.limit, DEFAULT_SESSION_LIMIT, 500)
  const requestedModeratorId = typeof req.query.moderatorId === 'string' && req.query.moderatorId.trim()
    ? req.query.moderatorId.trim()
    : undefined
  const moderatorId = requestedModeratorId ?? actor?.actorId

  const sessions = await prisma.session.findMany({
    where: {
      createdAt: { gte: from, lte: to },
      ...(moderatorId ? { userId: moderatorId } : {}),
      user: {
        deletedAt: null,
        roles: {
          some: {
            deletedAt: null,
            role: { name: { in: [...STAFF_ROLE_NAMES] }, deletedAt: null },
          },
        },
      },
    },
    select: {
      id: true,
      userId: true,
      createdAt: true,
      updatedAt: true,
      deletedAt: true,
      expiresAt: true,
      user: { select: { id: true, fullName: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
  })

  const now = new Date()
  const items = sessions.map((session) => {
    const activity = computeSessionActivity({ ...toSessionActivityInput(session), now })
    return {
      id: session.id,
      moderator: session.user,
      startedAt: session.createdAt,
      lastSeenAt: session.updatedAt,
      endedAt: activity.endedAt,
      endSource: activity.endSource,
      durationMs: activity.durationMs,
      activeMs: activity.activeMs,
      isEstimated: activity.isEstimated,
    }
  })

  const summary = summarizeSessionActivity(sessions.map((session) => toSessionActivityInput(session)), { now })

  return res.status(200).json(successResponse({
    items,
    window: { from, to },
    moderatorId: moderatorId ?? null,
    idleTimeoutMs: SESSION_IDLE_TIMEOUT_MS,
    summary: {
      ...summary,
      /** True when at least one listed session has no recorded end. */
      hasEstimatedSessions: summary.estimatedSessionCount > 0,
      listedSessions: items.length,
    },
  }, 'Session activity retrieved.'))
})

/** The filter vocabulary the activity view offers, including the staff an audit can be filtered by. */
export const getModerationAuditOptions = asyncHandler(async (_req: Request, res: Response) => {
  const moderators = await staffAccounts()

  res.status(200).json(successResponse({
    actions: moderationActionOptions(),
    outcomes: [
      { value: 'success', label: 'Succeeded' },
      { value: 'failure', label: 'Failed' },
    ],
    entityTypes: [...new Set(Object.values(MODERATION_ACTIONS).map((descriptor) => descriptor.entityType))],
    moderators,
  }))
})

/**
 * The audience sizes a push campaign is confirmed against.
 *
 * The same helper the fan-out uses resolves these, so the number the operator confirms is the audience
 * that will actually be targeted.
 */
export const getPushAudiencePreview = asyncHandler(async (_req: Request, res: Response) => {
  const [all, premium, free] = await Promise.all([
    previewNotificationAudience('ALL'),
    previewNotificationAudience('PREMIUM'),
    previewNotificationAudience('FREE'),
  ])

  res.status(200).json(successResponse({
    audiences: [
      { audience: 'ALL', ...all },
      { audience: 'PREMIUM', ...premium },
      { audience: 'FREE', ...free },
    ],
    /** Only queued delivery can be observed; the worker's per-recipient outcome is not stored per campaign. */
    deliveryConfirmationAvailable: false,
  }))
})
