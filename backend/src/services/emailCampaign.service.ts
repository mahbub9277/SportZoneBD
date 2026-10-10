import { prisma } from '../core/prisma.js'
import type { Prisma } from '@prisma/client'
import { sendEmail } from './email.service.js'
import { getEmailTemplate } from './email.templates.js'

/**
 * Email campaigns.
 *
 * The delivery rules live here rather than in a route handler so the same code path sends a campaign
 * whoever started it, and so the limits, the batching and the outcome counting are the same every time.
 * The provider is the only thing that decides success: a message that the SMTP transport rejected is
 * reported as failed, never as sent.
 */

export type EmailAudience = 'ALL' | 'PREMIUM' | 'FREE'

/**
 * The most recipients one campaign may contact.
 *
 * The cap is a safety valve against an accidental mass send, not a product limit: a campaign over it is
 * truncated and the caller is told exactly how many people were skipped. It is deliberately a whole
 * audience size rather than per-page, so the number is the same whether the campaign is started from the
 * console or from the existing template endpoint.
 */
export const EMAIL_CAMPAIGN_MAX_RECIPIENTS = Number(process.env.EMAIL_CAMPAIGN_MAX_RECIPIENTS ?? 500)

/** Sends in sequential batches, so a large campaign does not open one connection per recipient at once. */
export const EMAIL_CAMPAIGN_BATCH_SIZE = Number(process.env.EMAIL_CAMPAIGN_BATCH_SIZE ?? 20)

export const EMAIL_AUDIENCES: EmailAudience[] = ['ALL', 'PREMIUM', 'FREE']

export function isEmailAudience(value: unknown): value is EmailAudience {
  return typeof value === 'string' && (EMAIL_AUDIENCES as readonly string[]).includes(value)
}

/** The audience rule the rest of the platform uses: active, not suspended or banned, with an address. */
export function emailAudienceWhere(audience: EmailAudience): Prisma.UserWhereInput {
  return {
    email: { not: null },
    isActive: true,
    isSuspended: false,
    isBanned: false,
    deletedAt: null,
    ...(audience === 'PREMIUM'
      ? { subscriptions: { some: { status: 'ACTIVE', expiresAt: { gt: new Date() }, deletedAt: null } } }
      : audience === 'FREE'
        ? { subscriptions: { none: { status: 'ACTIVE', expiresAt: { gt: new Date() }, deletedAt: null } } }
        : {}),
  }
}

export interface EmailCampaignPlan {
  /** Recipients that will actually be contacted. */
  take: number
  /** True when the audience is larger than the campaign limit. */
  truncated: boolean
}

/** How much of an audience fits inside the campaign limit. Pure, so the rule can be asserted alone. */
export function planEmailCampaign(audienceSize: number, maxRecipients = EMAIL_CAMPAIGN_MAX_RECIPIENTS): EmailCampaignPlan {
  const safeMax = Number.isFinite(maxRecipients) && maxRecipients > 0 ? Math.floor(maxRecipients) : 0
  const size = Number.isFinite(audienceSize) && audienceSize > 0 ? Math.floor(audienceSize) : 0
  return { take: Math.min(size, safeMax), truncated: size > safeMax }
}

export interface EmailCampaignFailure {
  email: string
  reason: string
}

export interface EmailCampaignResult {
  audience: EmailAudience
  totalRecipients: number
  attempted: number
  sentCount: number
  failedCount: number
  skippedCount: number
  truncated: boolean
  failures: EmailCampaignFailure[]
}

/** The addressable recipients of one audience. Used for the pre-send confirmation and for the send. */
export async function countEmailAudience(audience: EmailAudience): Promise<number> {
  return prisma.user.count({ where: emailAudienceWhere(audience) })
}

function failureReason(error: unknown): string {
  if (error instanceof Error && error.message) return error.message.slice(0, 200)
  return 'The email provider rejected the message.'
}

/**
 * Sends one campaign and reports what really happened.
 *
 * Recipients are read once, truncated to the campaign limit and contacted in bounded batches. Every
 * outcome comes from the provider call itself: `sentCount` counts messages the transport accepted and
 * `failedCount` counts the ones it refused, with a few real reasons kept for the operator. Nothing is
 * counted as delivered just because it was attempted.
 */
export async function sendEmailCampaign(args: {
  subject: string
  body: string
  link?: string | null
  audience: EmailAudience
  maxRecipients?: number
}): Promise<EmailCampaignResult> {
  const { subject, body, link, audience } = args
  const totalRecipients = await countEmailAudience(audience)
  const plan = planEmailCampaign(totalRecipients, args.maxRecipients)

  if (plan.take === 0) {
    return {
      audience,
      totalRecipients,
      attempted: 0,
      sentCount: 0,
      failedCount: 0,
      skippedCount: totalRecipients,
      truncated: plan.truncated,
      failures: [],
    }
  }

  const recipients = await prisma.user.findMany({
    where: emailAudienceWhere(audience),
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: plan.take,
    select: { email: true },
  })

  const html = getEmailTemplate({ title: subject, bodyText: body, link: link ?? undefined })

  let sentCount = 0
  const failures: EmailCampaignFailure[] = []

  for (let offset = 0; offset < recipients.length; offset += EMAIL_CAMPAIGN_BATCH_SIZE) {
    const batch = recipients.slice(offset, offset + EMAIL_CAMPAIGN_BATCH_SIZE)
    const results = await Promise.allSettled(batch.map((recipient) => (
      recipient.email
        ? sendEmail({ to: recipient.email, subject, text: body, html })
        : Promise.reject(new Error('The recipient has no email address.'))
    )))

    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        sentCount += 1
        return
      }
      if (failures.length < 5) {
        failures.push({ email: batch[index]?.email ?? 'unknown', reason: failureReason(result.reason) })
      }
    })
  }

  const attempted = recipients.length
  return {
    audience,
    totalRecipients,
    attempted,
    sentCount,
    failedCount: attempted - sentCount,
    skippedCount: Math.max(0, totalRecipients - attempted),
    truncated: plan.truncated,
    failures,
  }
}
