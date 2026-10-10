import type { Prisma } from '@prisma/client'
import { writeAuditLog, type AuditClient } from './audit.js'

/**
 * The moderation audit trail.
 *
 * Moderation actions are written to the application's existing audit store (`SystemLog`) with a
 * structured `meta` block, so nothing has to be duplicated and the operations that already call
 * `writeAuditLog` keep working unchanged. The actor is always the authenticated user the backend
 * resolved for the request: the client never supplies it, and nothing here can edit or delete a row.
 */

/** Marks a log row as a moderation audit event, so system logs and audit events stay separable. */
export const MODERATION_AUDIT_KIND = 'moderation'

/** Prefix of every moderation audit message, which is also what the queries below filter on. */
export const MODERATION_AUDIT_PREFIX = 'Moderation:'

export type ModerationAction =
  | 'report.status.updated'
  | 'payment.review.approved'
  | 'payment.review.rejected'
  | 'push.campaign.sent'
  | 'email.campaign.sent'

export type ModerationOutcome = 'success' | 'failure'

interface ModerationActionDescriptor {
  /** Human-readable sentence stored in `SystemLog.message`. */
  message: string
  /** What the action was performed on, e.g. `report`. */
  entityType: string
}

export const MODERATION_ACTIONS: Record<ModerationAction, ModerationActionDescriptor> = {
  'report.status.updated': { message: `${MODERATION_AUDIT_PREFIX} Report status updated`, entityType: 'report' },
  'payment.review.approved': { message: `${MODERATION_AUDIT_PREFIX} Manual payment approved`, entityType: 'payment' },
  'payment.review.rejected': { message: `${MODERATION_AUDIT_PREFIX} Manual payment rejected`, entityType: 'payment' },
  'push.campaign.sent': { message: `${MODERATION_AUDIT_PREFIX} Push campaign queued`, entityType: 'push-campaign' },
  'email.campaign.sent': { message: `${MODERATION_AUDIT_PREFIX} Email campaign sent`, entityType: 'email-campaign' },
}

export interface ModerationEventInput {
  action: ModerationAction
  actorId: string
  actorName?: string | null
  entityId: string
  outcome?: ModerationOutcome
  reason?: string | null
  requestId?: string | null
  /** State before the action, for a real mutation. Sensitive keys are stripped. */
  before?: Record<string, unknown> | null
  /** State after the action. Sensitive keys are stripped. */
  after?: Record<string, unknown> | null
  /** Action-specific facts that are neither before nor after, e.g. audience and delivery counts. */
  details?: Record<string, unknown> | null
}

/** Keys that must never reach the audit store, whatever a caller passes. */
const SENSITIVE_KEY_PATTERN = /pass|secret|token|otp|hash|authorization|cookie|credential|p256dh|auth$/i

const MAX_STRING_LENGTH = 500
const MAX_KEYS = 24

/**
 * Strips credentials and trims oversized values out of a recorded state.
 *
 * An audit row is read by staff who are allowed to see what changed, not the secrets involved in the
 * change, so password hashes, tokens and provider keys are dropped by name and every long string is
 * truncated. Nested objects are cleaned one level deep, which is as far as the moderation events
 * written here ever nest.
 */
export function sanitizeAuditState(state: Record<string, unknown> | null | undefined): Record<string, unknown> | undefined {
  if (!state) return undefined

  const cleaned: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(state)) {
    if (Object.keys(cleaned).length >= MAX_KEYS) break
    if (SENSITIVE_KEY_PATTERN.test(key)) continue

    if (typeof value === 'string') {
      cleaned[key] = value.length > MAX_STRING_LENGTH ? `${value.slice(0, MAX_STRING_LENGTH)}…` : value
    } else if (value instanceof Date) {
      cleaned[key] = value.toISOString()
    } else if (value === null || typeof value === 'number' || typeof value === 'boolean') {
      cleaned[key] = value
    } else if (Array.isArray(value)) {
      cleaned[key] = value.slice(0, MAX_KEYS).map((item) => (item instanceof Date ? item.toISOString() : item))
    } else if (typeof value === 'object') {
      cleaned[key] = sanitizeAuditState(value as Record<string, unknown>) ?? null
    }
  }

  return Object.keys(cleaned).length > 0 ? cleaned : undefined
}

/** The structured meta block written for one moderation event. */
export function buildModerationMeta(input: ModerationEventInput): Record<string, unknown> {
  if (!input.actorId) {
    throw new Error('A moderation audit event requires the authenticated actor.')
  }

  const meta: Record<string, unknown> = {
    kind: MODERATION_AUDIT_KIND,
    action: input.action,
    outcome: input.outcome ?? 'success',
    actorId: input.actorId,
    entityType: MODERATION_ACTIONS[input.action].entityType,
    entityId: input.entityId,
  }

  if (input.actorName) meta.actorName = input.actorName
  if (input.reason) meta.reason = input.reason.slice(0, MAX_STRING_LENGTH)
  if (input.requestId) meta.requestId = input.requestId

  const before = sanitizeAuditState(input.before)
  const after = sanitizeAuditState(input.after)
  const details = sanitizeAuditState(input.details)
  if (before) meta.before = before
  if (after) meta.after = after
  if (details) meta.details = details

  return meta
}

/**
 * Records one moderation event in the audit store.
 *
 * A failed operation is recorded with `warn` so the outcome is visible in the existing log views, and
 * the returned row id is handed back so a caller can reference the exact event it just created. Passing
 * the caller's transaction writes the event in the same atomic unit as the change it describes.
 */
export async function recordModerationEvent(
  input: ModerationEventInput,
  client?: AuditClient,
): Promise<string> {
  const meta = buildModerationMeta(input)
  const outcome = input.outcome ?? 'success'
  const log = await writeAuditLog(
    MODERATION_ACTIONS[input.action].message,
    meta,
    outcome === 'failure' ? 'warn' : 'info',
    client,
  )

  return log.id
}

export interface ModerationLogFilter {
  actorId?: string
  action?: string
  outcome?: string
  entityType?: string
  entityId?: string
  from?: Date
  to?: Date
  search?: string
}

/**
 * Narrows the audit store to the moderation events a caller asked for.
 *
 * The actor, action, outcome and entity facts live inside the JSON `meta` column, so they are matched
 * with JSON path filters. System logs written by other features never carry the `kind` marker, which is
 * what keeps this view from listing operations that have nothing to do with moderation.
 */
export function moderationLogFilter(filter: ModerationLogFilter): Prisma.SystemLogWhereInput {
  const conditions: Prisma.SystemLogWhereInput[] = [{ meta: { path: ['kind'], equals: MODERATION_AUDIT_KIND } }]

  if (filter.actorId) conditions.push({ meta: { path: ['actorId'], equals: filter.actorId } })
  if (filter.action) conditions.push({ meta: { path: ['action'], equals: filter.action } })
  if (filter.outcome) conditions.push({ meta: { path: ['outcome'], equals: filter.outcome } })
  if (filter.entityType) conditions.push({ meta: { path: ['entityType'], equals: filter.entityType } })
  if (filter.entityId) conditions.push({ meta: { path: ['entityId'], equals: filter.entityId } })

  if (filter.from || filter.to) {
    conditions.push({
      createdAt: {
        ...(filter.from ? { gte: filter.from } : {}),
        ...(filter.to ? { lte: filter.to } : {}),
      },
    })
  }

  if (filter.search?.trim()) {
    conditions.push({ message: { contains: filter.search.trim(), mode: 'insensitive' } })
  }

  return { AND: conditions }
}

export interface ModerationEventView {
  id: string
  action: string | null
  outcome: ModerationOutcome
  actorId: string | null
  actorName: string | null
  entityType: string | null
  entityId: string | null
  reason: string | null
  requestId: string | null
  before: Record<string, unknown> | null
  after: Record<string, unknown> | null
  details: Record<string, unknown> | null
  createdAt: Date
  message: string
}

function readObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

/**
 * Reads a stored log row back as a moderation event.
 *
 * Rows written before this feature existed — or by anything else that happened to use the same
 * message — degrade to an event with the fields that are genuinely present instead of inventing an
 * actor or an outcome.
 */
export function readModerationEvent(log: { id: string; message: string; meta: unknown; createdAt: Date }): ModerationEventView {
  const meta = readObject(log.meta) ?? {}
  const outcome = meta.outcome === 'failure' ? 'failure' : 'success'

  return {
    id: log.id,
    action: readString(meta.action),
    outcome,
    actorId: readString(meta.actorId),
    actorName: readString(meta.actorName),
    entityType: readString(meta.entityType),
    entityId: readString(meta.entityId),
    reason: readString(meta.reason),
    requestId: readString(meta.requestId),
    before: readObject(meta.before),
    after: readObject(meta.after),
    details: readObject(meta.details),
    createdAt: log.createdAt,
    message: log.message,
  }
}

/** The action labels the UI offers as filters, newest vocabulary first. */
export function moderationActionOptions(): Array<{ value: ModerationAction; label: string }> {
  return (Object.keys(MODERATION_ACTIONS) as ModerationAction[]).map((action) => ({
    value: action,
    label: MODERATION_ACTIONS[action].message.replace(`${MODERATION_AUDIT_PREFIX} `, ''),
  }))
}
