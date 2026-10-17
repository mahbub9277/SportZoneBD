/**
 * The administrator-controlled HTTP stream relay switch.
 *
 * The relay serves an `http://` provider's manifests, playlists and segments over this site's HTTPS origin,
 * which is the only way such a source can play — and the only part of the application that puts media bytes
 * through the backend. This switch exists so an administrator can stop that on demand.
 *
 * The persisted `Setting` row is the single source of truth, exactly like the automation master switches:
 * the runtime state here is only a cache of the last *confirmed* value, a value that cannot be read is
 * treated as OFF (fail closed), and OFF is applied by this process the moment it persists the change.
 *
 * Propagation: the acting instance is immediate. Every other instance notices within
 * {@link STREAM_RELAY_TTL_MS} (10 seconds by default), because that is how long a confirmed read is trusted
 * before the next request re-reads the row; an instance that observes the switch turn off aborts the relay
 * requests it is currently streaming. There is no background worker and no polling: the refresh happens on
 * the next relay request each instance serves, which costs one indexed read per window per instance.
 */
import logger from './logger.js'
import { prisma } from './prisma.js'
import { writeAuditLog } from './audit.js'
import { AppError } from './errors.js'
import { emitApplicationSettingChanged } from './socketManager.js'

export const STREAM_RELAY_SETTING_KEY = 'stream.httpRelay.enabled'
export const STREAM_RELAY_LABEL = 'HTTP Stream Relay'
export const STREAM_RELAY_DESCRIPTION =
  'Relay approved HTTP streaming sources through the backend so browsers can play them over HTTPS.'

/**
 * The initial value for a deployment that has never stored this setting.
 *
 * OFF: the relay is new, it is the only relay-aware code path, and nothing in production depends on it yet.
 * A relay that starts by itself would spend bandwidth nobody asked it to spend, so it starts on demand and
 * is switched on deliberately.
 */
export const STREAM_RELAY_DEFAULT_ENABLED = false

/**
 * How long a confirmed read is trusted before the next request re-reads the row. This is the propagation
 * window for another instance switching the relay off; the acting instance is immediate.
 */
const RELAY_SWITCH_TTL_MS = Number(process.env.STREAM_RELAY_TTL_MS ?? 10_000)

/** A database that is down must not produce one log line per relayed segment. */
const FAILURE_LOG_INTERVAL_MS = 60_000

export interface StreamRelaySwitchReader {
  /** Returns the stored value, or null when the row does not exist. Throws when it cannot be read. */
  read: (settingKey: string) => Promise<string | null>
}

let reader: StreamRelaySwitchReader | null = null

/** Injectable for tests, which exercise this module without a database. */
export function setStreamRelaySwitchReader(next: StreamRelaySwitchReader | null): void {
  reader = next
}

interface RelaySwitchRuntimeState {
  /** Last authoritatively confirmed value; null means no read has succeeded yet in this process. */
  confirmed: boolean | null
  confirmedAt: number
  /** Last read attempt, successful or not: also throttles retries while the database is unavailable. */
  lastAttemptAt: number
  /** Why the authoritative value could not be read, while it remains unknown or stale. */
  degradedReason: string | null
  lastFailureLoggedAt: number
}

const runtimeState: RelaySwitchRuntimeState = {
  confirmed: null,
  confirmedAt: 0,
  lastAttemptAt: 0,
  degradedReason: null,
  lastFailureLoggedAt: 0,
}

function parseStoredValue(value: string | null | undefined): boolean | null {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : ''
  if (normalized === 'true') return true
  if (normalized === 'false') return false
  return null
}

function describeError(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  return String(error)
}

function logReadFailure(reason: string): void {
  const now = Date.now()
  if (now - runtimeState.lastFailureLoggedAt < FAILURE_LOG_INTERVAL_MS) return
  runtimeState.lastFailureLoggedAt = now
  logger.warn({ settingKey: STREAM_RELAY_SETTING_KEY, reason }, 'HTTP stream relay state could not be read; relay stays disabled')
}

async function loadStreamRelaySwitch(): Promise<boolean | null> {
  try {
    const raw = reader
      ? await reader.read(STREAM_RELAY_SETTING_KEY)
      : await prisma.setting.findUnique({ where: { key: STREAM_RELAY_SETTING_KEY }, select: { value: true, deletedAt: true } })
        .then((row) => (row && row.deletedAt === null ? row.value : null))

    // A missing row keeps the relay off rather than inventing an enabled state.
    if (raw === null || raw === undefined) return STREAM_RELAY_DEFAULT_ENABLED

    const stored = parseStoredValue(raw)
    if (stored === null) {
      // A value nobody can interpret is not evidence that the relay is allowed to run, and it is not
      // silently rewritten to "off" either: it is reported as unknown while the relay stays closed.
      runtimeState.degradedReason = `Unrecognised ${STREAM_RELAY_SETTING_KEY} value; the relay stays disabled`
      logReadFailure(runtimeState.degradedReason)
      return null
    }

    return stored
  } catch (error) {
    runtimeState.degradedReason = `Unable to read ${STREAM_RELAY_SETTING_KEY}: ${describeError(error)}`
    logReadFailure(runtimeState.degradedReason)
    return null
  }
}

/** Applies a value this process just confirmed, and stops anything that value no longer allows. */
function applyConfirmed(enabled: boolean): void {
  const wasEnabled = runtimeState.confirmed === true
  runtimeState.confirmed = enabled
  runtimeState.confirmedAt = Date.now()
  runtimeState.degradedReason = null

  // Switching off stops the relay requests this instance is streaming; they would otherwise keep pulling
  // media through the backend until the provider closed them.
  if (!enabled && wasEnabled) abortActiveRelays()
}

/**
 * Relay boundary: re-reads the authoritative value.
 *
 * A relay request that is about to fetch an `http://` resource uses this so the decision is never made from
 * a cache; the read is one indexed lookup and it happens once per request, not per segment of a playlist.
 */
export async function confirmStreamRelaySwitch(): Promise<boolean> {
  const loaded = await loadStreamRelaySwitch()
  if (loaded === null) {
    // Fail closed without clearing the last confirmed value: the status reports the degradation instead.
    return false
  }
  applyConfirmed(loaded)
  return loaded
}

/**
 * Hot boundary: a cached read for the many small requests a live stream makes.
 *
 * Fail closed: a value this process cannot confirm right now is treated as OFF, so an unreadable database
 * cannot keep media flowing through the relay.
 */
export async function isStreamRelaySwitchEnabled(): Promise<boolean> {
  const now = Date.now()
  if (runtimeState.lastAttemptAt > 0 && now - runtimeState.lastAttemptAt < RELAY_SWITCH_TTL_MS) {
    return runtimeState.confirmed === true && runtimeState.degradedReason === null
  }

  runtimeState.lastAttemptAt = now
  const loaded = await loadStreamRelaySwitch()
  if (loaded === null) return false
  applyConfirmed(loaded)
  return loaded
}

/** The value this process currently enforces, without any read. Fail closed when never confirmed. */
export function getAppliedStreamRelaySwitch(): boolean {
  return runtimeState.confirmed === true && runtimeState.degradedReason === null
}

/** Drops the cached value so the next request re-reads the row, without turning anything on or off. */
export function invalidateStreamRelaySwitchCache(): void {
  runtimeState.lastAttemptAt = 0
}

// ------------------------------------------------------------------------- active relay operations

const activeRelayRequests = new Set<AbortController>()

/**
 * Registers a relay request so switching the relay off can stop it.
 *
 * Returns the release function; it is idempotent, so a request that calls it in both its cleanup paths
 * cannot release another request's registration.
 */
export function registerRelayRequest(controller: AbortController): () => void {
  activeRelayRequests.add(controller)
  let released = false
  return () => {
    if (released) return
    released = true
    activeRelayRequests.delete(controller)
  }
}

/** Aborts every relay request this instance is currently streaming, and forgets them. */
export function abortActiveRelays(): number {
  const aborted = activeRelayRequests.size
  for (const controller of activeRelayRequests) {
    try {
      controller.abort()
    } catch {
      // An abort listener that throws must not stop the remaining requests from being stopped.
    }
  }
  activeRelayRequests.clear()
  if (aborted > 0) logger.info({ aborted }, 'Active HTTP stream relay requests were stopped')
  return aborted
}

export function activeRelayCount(): number {
  return activeRelayRequests.size
}

// ------------------------------------------------------------------------- status and updates

export interface StreamRelaySwitchStatus {
  settingKey: string
  label: string
  description: string
  /** Persisted value last confirmed by an authoritative read, or null when it could not be established. */
  desired: boolean | null
  /** Value this process enforces right now. Fail closed: false when the authoritative value is unknown. */
  operational: boolean
  degraded: boolean
  degradedReason: string | null
  confirmedAt: string | null
  /** Other instances apply a change within the propagation window; none of them is acknowledged here. */
  instancesConfirmed: 'this-instance-only'
  activeRelayRequests: number
}

export function getStreamRelaySwitchStatus(): StreamRelaySwitchStatus {
  return {
    settingKey: STREAM_RELAY_SETTING_KEY,
    label: STREAM_RELAY_LABEL,
    description: STREAM_RELAY_DESCRIPTION,
    desired: runtimeState.confirmed,
    operational: runtimeState.confirmed === true && runtimeState.degradedReason === null,
    degraded: runtimeState.confirmed === null || runtimeState.degradedReason !== null,
    degradedReason: runtimeState.degradedReason,
    confirmedAt: runtimeState.confirmedAt > 0 ? new Date(runtimeState.confirmedAt).toISOString() : null,
    instancesConfirmed: 'this-instance-only',
    activeRelayRequests: activeRelayRequests.size,
  }
}

export interface StreamRelayUpdateContext {
  actorId?: string | null
  actorName?: string | null
  requestId?: string | null
}

export interface StreamRelayUpdateResult {
  previous: boolean | null
  applied: boolean
  status: StreamRelaySwitchStatus
}

/** Creates the setting row when it is absent, without changing a value that already exists. */
export async function initializeStreamRelaySwitch(): Promise<void> {
  try {
    const existing = await prisma.setting.findUnique({ where: { key: STREAM_RELAY_SETTING_KEY }, select: { value: true } })
    if (!existing) {
      await prisma.setting.create({
        data: {
          key: STREAM_RELAY_SETTING_KEY,
          value: String(STREAM_RELAY_DEFAULT_ENABLED),
          type: 'boolean',
          description: STREAM_RELAY_DESCRIPTION,
        },
      })
    }
  } catch (error) {
    logger.warn({ reason: describeError(error) }, 'HTTP stream relay setting row could not be created')
  }

  const value = await confirmStreamRelaySwitch()
  if (!getStreamRelaySwitchStatus().degraded) {
    logger.info({ enabled: value }, 'HTTP stream relay setting loaded')
  } else {
    logger.warn('HTTP stream relay starts disabled until its persisted value can be read')
  }
}

/**
 * Persists the new value, records the change with its previous value in the same transaction, then applies
 * it to this process — including stopping requests the new value no longer allows.
 *
 * A write that fails applies nothing: the stored value is unchanged, so this process keeps enforcing what it
 * last confirmed and the caller is told the change did not happen.
 */
export async function setStreamRelaySwitch(
  enabled: boolean,
  context: StreamRelayUpdateContext = {},
): Promise<StreamRelayUpdateResult> {
  const value = String(enabled)

  let previous: boolean | null
  try {
    previous = await prisma.$transaction(async (tx) => {
      const existing = await tx.setting.findUnique({ where: { key: STREAM_RELAY_SETTING_KEY }, select: { value: true, deletedAt: true } })
      const previousValue = existing && existing.deletedAt === null ? parseStoredValue(existing.value) : null

      await tx.setting.upsert({
        where: { key: STREAM_RELAY_SETTING_KEY },
        update: { value, type: 'boolean', description: STREAM_RELAY_DESCRIPTION, deletedAt: null },
        create: { key: STREAM_RELAY_SETTING_KEY, value, type: 'boolean', description: STREAM_RELAY_DESCRIPTION },
      })

      await writeAuditLog(
        `HTTP stream relay turned ${enabled ? 'ON' : 'OFF'}`,
        {
          kind: 'stream-relay-switch',
          settingKey: STREAM_RELAY_SETTING_KEY,
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
    logger.error({ reason, requestedValue: enabled }, 'HTTP stream relay change could not be persisted')
    try {
      await writeAuditLog(
        'HTTP stream relay change failed',
        {
          kind: 'stream-relay-switch',
          settingKey: STREAM_RELAY_SETTING_KEY,
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
      // The audit table usually lives in the database that just failed; the log line above is the record.
    }
    throw new AppError(503, 'The HTTP stream relay setting could not be persisted, so nothing was changed.')
  }

  invalidateStreamRelaySwitchCache()
  applyConfirmed(enabled)
  emitApplicationSettingChanged(STREAM_RELAY_SETTING_KEY, value)

  return { previous, applied: true, status: getStreamRelaySwitchStatus() }
}
