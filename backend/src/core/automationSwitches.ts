/**
 * The two administrator-controlled automation master switches.
 *
 * Each switch is one row in the existing `Setting` table (`key`/`value`/`type`), so the state survives
 * restarts, deploys and process restarts, and every instance reads the same authoritative value. The
 * runtime state kept here is only a cache of the last *confirmed* value: it is never assumed, and a value
 * that cannot be read fails closed instead of being treated as "enabled".
 *
 * Two different questions are answered deliberately differently:
 *
 * - producers ask `confirmAutomationSwitch()` at their own boundary, which re-reads the row. A minute-tick
 *   and an admin action can afford one indexed read, and they are exactly the places where a stale
 *   "enabled" would create new work.
 * - the push delivery boundary asks `isAutomationSwitchEnabled()`, which is cached for a few seconds
 *   because it runs once per queued recipient. The cache is dropped the moment this instance applies a
 *   change, so the acting instance is immediate and other instances follow within the cache window.
 */
import logger from './logger.js'
import { prisma } from './prisma.js'
import { writeAuditLog } from './audit.js'
import { AppError } from './errors.js'
import { emitApplicationSettingChanged } from './socketManager.js'

export type AutomationSwitchKey = 'pushNotifications' | 'matchCreation'

export interface AutomationSwitchDefinition {
  key: AutomationSwitchKey
  settingKey: string
  label: string
  description: string
}

export const AUTOMATION_SWITCHES: Record<AutomationSwitchKey, AutomationSwitchDefinition> = {
  pushNotifications: {
    key: 'pushNotifications',
    settingKey: 'automation.pushNotifications.enabled',
    label: 'Push Notifications Automation',
    description: 'Automated match reminders, match-start alerts, highlight alerts and campaign push delivery.',
  },
  matchCreation: {
    key: 'matchCreation',
    settingKey: 'automation.matchCreation.enabled',
    label: 'Automatic Match Creation',
    description: 'Automatic fixture discovery, reconciliation and match creation from football data providers.',
  },
}

export const AUTOMATION_SWITCH_SETTING_KEYS: string[] = Object.values(AUTOMATION_SWITCHES).map((item) => item.settingKey)

/**
 * How long a read is trusted at the delivery boundary. Producers never rely on it: they re-read. The
 * window bounds how long another instance may keep delivering pushes after this one was switched off.
 * Overridable so the propagation window can be exercised in tests without waiting for it.
 */
const DELIVERY_BOUNDARY_TTL_MS = Number(process.env.AUTOMATION_SWITCH_TTL_MS ?? 10_000)

/** A database that is down must not produce one log line per queued notification job. */
const FAILURE_LOG_INTERVAL_MS = 60_000

const SETTING_DESCRIPTIONS: Record<AutomationSwitchKey, string> = {
  pushNotifications: 'Master switch for automated push notifications (reminders, match alerts and campaigns).',
  matchCreation: 'Master switch for automatic fixture discovery and match creation.',
}

interface SwitchRuntimeState {
  /** Last authoritatively confirmed value; null means no read has succeeded yet in this process. */
  confirmed: boolean | null
  confirmedAt: number
  /** Last read attempt, successful or not: also throttles retries while the database is unavailable. */
  lastAttemptAt: number
  /** Why the authoritative value could not be read, while it remains unknown or stale. */
  degradedReason: string | null
  lastFailureLoggedAt: number
}

const emptyState = (): SwitchRuntimeState => ({ confirmed: null, confirmedAt: 0, lastAttemptAt: 0, degradedReason: null, lastFailureLoggedAt: 0 })

const runtimeState: Record<AutomationSwitchKey, SwitchRuntimeState> = {
  pushNotifications: emptyState(),
  matchCreation: emptyState(),
}

/** Reads the raw persisted value; `null` means the row does not exist (or is soft-deleted). */
export interface AutomationSwitchReader {
  read: (settingKey: string) => Promise<string | null>
}

const defaultReader: AutomationSwitchReader = {
  read: async (settingKey) => {
    const setting = await prisma.setting.findUnique({ where: { key: settingKey }, select: { value: true, deletedAt: true } })
    if (!setting || setting.deletedAt !== null) return null
    return setting.value
  },
}

let reader: AutomationSwitchReader = defaultReader

/**
 * Test seam: swaps the persistence probe so the gate and its failure behaviour can be exercised without a
 * database, and clears every cached confirmation so a test never inherits the previous one.
 */
export function setAutomationSwitchReader(next: AutomationSwitchReader | null): void {
  reader = next ?? defaultReader
  for (const key of Object.keys(runtimeState) as AutomationSwitchKey[]) {
    runtimeState[key] = emptyState()
  }
}

/**
 * A missing row means the automation has always been running, so it stays enabled: an existing
 * installation must not change behaviour just because this switch was introduced. An unreadable row
 * (`null` from a read failure) is different and never enables anything.
 */
function parseStoredValue(value: string | null): boolean | null {
  if (value === null) return true
  if (value === 'true') return true
  if (value === 'false') return false
  return null
}

function describeError(error: unknown): string {
  const code = (error as { code?: unknown })?.code
  if (typeof code === 'string' && code) return code
  return error instanceof Error ? error.name : 'unknown error'
}

function logReadFailure(key: AutomationSwitchKey, reason: string): void {
  const state = runtimeState[key]
  const now = Date.now()
  if (now - state.lastFailureLoggedAt < FAILURE_LOG_INTERVAL_MS) return
  state.lastFailureLoggedAt = now
  logger.error(
    { automationSwitch: key, reason, confirmed: state.confirmed },
    'Automation switch state could not be confirmed; the affected automation stays disabled',
  )
}

function applyConfirmed(key: AutomationSwitchKey, enabled: boolean): void {
  const state = runtimeState[key]
  state.confirmed = enabled
  state.confirmedAt = Date.now()
  state.degradedReason = null
}

/** Reads the authoritative value and records it. Returns null when it cannot be established. */
async function loadAutomationSwitch(key: AutomationSwitchKey): Promise<boolean | null> {
  const { settingKey } = AUTOMATION_SWITCHES[key]
  const state = runtimeState[key]
  state.lastAttemptAt = Date.now()
  try {
    const raw = await reader.read(settingKey)
    const value = parseStoredValue(raw)
    if (value === null) {
      state.degradedReason = `Unrecognised stored value for ${settingKey}`
      logReadFailure(key, state.degradedReason)
      return null
    }
    applyConfirmed(key, value)
    return value
  } catch (error) {
    state.degradedReason = `Unable to read ${settingKey}: ${describeError(error)}`
    logReadFailure(key, state.degradedReason)
    return null
  }
}

/**
 * Producer boundary: re-reads the authoritative value, so a minute-tick or an admin action never acts on
 * a cached "enabled". A read that fails is treated as disabled (fail closed) and does not overwrite the
 * last confirmed value, which is reported as degraded instead of being presented as a real state.
 */
export async function confirmAutomationSwitch(key: AutomationSwitchKey): Promise<boolean> {
  const loaded = await loadAutomationSwitch(key)
  if (loaded !== null) return loaded
  return false
}

/**
 * Delivery boundary: cached read for the short window below, refreshed at most once per window even when
 * the read keeps failing (a Redis or database outage must not become one read attempt per queued job).
 * Fails closed: a stale "enabled" is not trusted.
 */
export async function isAutomationSwitchEnabled(key: AutomationSwitchKey): Promise<boolean> {
  const state = runtimeState[key]
  const now = Date.now()
  if (state.lastAttemptAt > 0 && now - state.lastAttemptAt < DELIVERY_BOUNDARY_TTL_MS) {
    return state.confirmed === true && now - state.confirmedAt < DELIVERY_BOUNDARY_TTL_MS
  }
  const loaded = await loadAutomationSwitch(key)
  return loaded === true
}

/** The value this process currently enforces, without any read. Fail closed when never confirmed. */
export function getAppliedAutomationSwitch(key: AutomationSwitchKey): boolean {
  return runtimeState[key].confirmed === true
}

/** Creates the settings rows when they are absent, without changing an existing value. */
export async function initializeAutomationSwitches(): Promise<void> {
  for (const definition of Object.values(AUTOMATION_SWITCHES)) {
    try {
      const existing = await prisma.setting.findUnique({ where: { key: definition.settingKey }, select: { value: true } })
      if (existing) continue
      await prisma.setting.create({
        data: {
          key: definition.settingKey,
          value: 'true',
          type: 'boolean',
          description: SETTING_DESCRIPTIONS[definition.key],
        },
      })
    } catch (error) {
      logger.warn({ automationSwitch: definition.key, reason: describeError(error) }, 'Automation switch row could not be created')
    }
  }
  for (const definition of Object.values(AUTOMATION_SWITCHES)) {
    const value = await loadAutomationSwitch(definition.key)
    if (value === null) {
      logger.warn({ automationSwitch: definition.key }, 'Automation switch starts disabled until its persisted value can be read')
    }
  }
}

export interface AutomationSwitchStatus {
  key: AutomationSwitchKey
  settingKey: string
  label: string
  description: string
  /** Persisted value last confirmed by an authoritative read, or null when it could not be established. */
  desired: boolean | null
  /** Value this process enforces right now. Fail closed: false when the authoritative value is unknown. */
  operational: boolean
  /** True when the authoritative value could not be confirmed; `operational` is then fail-closed. */
  degraded: boolean
  degradedReason: string | null
  confirmedAt: string | null
  /** Other instances apply a change within the delivery-boundary window; none of them is acknowledged here. */
  instancesConfirmed: 'this-instance-only'
}

export function getAutomationSwitchStatus(key: AutomationSwitchKey): AutomationSwitchStatus {
  const definition = AUTOMATION_SWITCHES[key]
  const state = runtimeState[key]
  return {
    key,
    settingKey: definition.settingKey,
    label: definition.label,
    description: definition.description,
    desired: state.confirmed,
    // What the gates actually do right now: a value this process cannot currently confirm is reported as
    // not operational, because the producers and the delivery boundary are failing closed on it.
    operational: state.confirmed === true && state.degradedReason === null,
    degraded: state.confirmed === null || state.degradedReason !== null,
    degradedReason: state.degradedReason,
    confirmedAt: state.confirmedAt > 0 ? new Date(state.confirmedAt).toISOString() : null,
    instancesConfirmed: 'this-instance-only',
  }
}

export interface AutomationSwitchUpdateContext {
  actorId?: string | null
  actorName?: string | null
  requestId?: string | null
}

export interface AutomationSwitchUpdateResult {
  previous: boolean | null
  applied: boolean
  status: AutomationSwitchStatus
}

/**
 * Persists the new value, records the change (with its previous value) in the same transaction as the
 * settings write, then applies it to this process.
 *
 * Concurrency: the setting row is the single source of truth and the write is a conditional upsert on its
 * unique key, so two administrators racing each other end with one value and two audit entries, each
 * carrying the previous value it observed. Applying is idempotent.
 */
export async function setAutomationSwitch(
  key: AutomationSwitchKey,
  enabled: boolean,
  context: AutomationSwitchUpdateContext = {},
): Promise<AutomationSwitchUpdateResult> {
  const definition = AUTOMATION_SWITCHES[key]
  const value = String(enabled)

  let previous: boolean | null
  try {
    previous = await prisma.$transaction(async (tx) => {
      const existing = await tx.setting.findUnique({ where: { key: definition.settingKey }, select: { value: true, deletedAt: true } })
      const previousValue = existing && existing.deletedAt === null ? parseStoredValue(existing.value) : null

      await tx.setting.upsert({
        where: { key: definition.settingKey },
        update: { value, type: 'boolean', description: SETTING_DESCRIPTIONS[key], deletedAt: null },
        create: { key: definition.settingKey, value, type: 'boolean', description: SETTING_DESCRIPTIONS[key] },
      })

      if (key === 'matchCreation') {
        // The automation dashboard reads this display flag; the switch row above stays authoritative.
        await tx.automationJob.updateMany({
          where: { name: 'Match Automation Scheduler' },
          data: { isEnabled: enabled },
        })
      }

      await writeAuditLog(
        `Automation switch "${definition.label}" turned ${enabled ? 'ON' : 'OFF'}`,
        {
          kind: 'automation-switch',
          switchKey: key,
          settingKey: definition.settingKey,
          previousValue,
          requestedValue: enabled,
          persisted: true,
          actorId: context.actorId ?? null,
          actorName: context.actorName ?? null,
          requestId: context.requestId ?? null,
        },
        'info',
        tx,
      )

      return previousValue
    })
  } catch (error) {
    const reason = describeError(error)
    logger.error({ automationSwitch: key, reason, requestedValue: enabled }, 'Automation switch change could not be persisted')
    // Best effort: the write that just failed is usually the database the audit row would go to, so a
    // second failure is expected and only the log line above has to survive.
    try {
      await writeAuditLog(
        `Automation switch "${definition.label}" change failed`,
        {
          kind: 'automation-switch',
          switchKey: key,
          settingKey: definition.settingKey,
          requestedValue: enabled,
          persisted: false,
          applied: false,
          reason,
          actorId: context.actorId ?? null,
          actorName: context.actorName ?? null,
          requestId: context.requestId ?? null,
        },
        'error',
      )
    } catch {
      // Nothing further can be recorded, and the failure is already logged above.
    }
    // Nothing is applied locally: the stored value is unchanged, so this process keeps enforcing what it
    // last confirmed and the caller is told the change did not happen.
    throw new AppError(503, 'The automation switch could not be persisted, so nothing was changed.')
  }

  applyConfirmed(key, enabled)
  emitApplicationSettingChanged(definition.settingKey, value)

  return { previous, applied: true, status: getAutomationSwitchStatus(key) }
}
