/**
 * Shared, framework-free advertisement visit model.
 *
 * Both advertisement surfaces — the global gate modal (`useAdvertisementGate`) and the standalone
 * interstitial page — drive their lifecycle from these helpers so the countdown, completion and
 * dismissal rules can never disagree. Everything here is pure (no React, no globals) so it can be
 * unit tested directly.
 */

export type AdVisitStatus = 'idle' | 'active' | 'verifying' | 'completed' | 'dismissed' | 'failed'

/** Why a visit ended without completing: the user closed it, or it was interrupted (e.g. tab return). */
export type AdDismissReason = 'closed' | 'interrupted'

export interface AdVisitState {
  status: AdVisitStatus
  dismissalReason: AdDismissReason | null
  errorMessage: string | null
  sessionId: string | null
  /** Epoch ms when the current visit started; null while idle. */
  startedAtMs: number | null
  /** Configured advertisement duration in seconds (never milliseconds). */
  durationSeconds: number
}

export const initialAdVisitState: AdVisitState = {
  status: 'idle',
  dismissalReason: null,
  errorMessage: null,
  sessionId: null,
  startedAtMs: null,
  durationSeconds: 0,
}

export type AdVisitEvent =
  | { type: 'start'; sessionId: string | null; startedAtMs: number; durationSeconds: number }
  | { type: 'beginCompletion' }
  | { type: 'completionSucceeded' }
  | { type: 'completionFailed'; message: string }
  | { type: 'dismiss'; reason: AdDismissReason }

/**
 * Deterministic visit transitions:
 * - `start` is ignored while a visit is already running (one session per visit).
 * - `beginCompletion` is idempotent and only valid from a running visit or a retry of a failed one.
 * - `completionSucceeded` is idempotent and never downgrades a completed visit.
 * - `dismiss` never turns a completed visit into a dismissed one (no false "not completed" state).
 */
export function reduceAdVisit(state: AdVisitState, event: AdVisitEvent): AdVisitState {
  switch (event.type) {
    case 'start':
      if (state.status === 'active' || state.status === 'verifying') return state
      return {
        status: 'active',
        dismissalReason: null,
        errorMessage: null,
        sessionId: event.sessionId,
        startedAtMs: event.startedAtMs,
        durationSeconds: normalizeAdDurationSeconds(event.durationSeconds),
      }
    case 'beginCompletion':
      if (state.status === 'verifying') return state
      // A failed attempt may be retried in place; anything else must not re-enter verification.
      if (state.status !== 'active' && state.status !== 'failed') return state
      return { ...state, status: 'verifying', errorMessage: null }
    case 'completionSucceeded':
      if (state.status === 'completed') return state
      if (state.status !== 'verifying' && state.status !== 'active') return state
      return { ...state, status: 'completed', dismissalReason: null, errorMessage: null }
    case 'completionFailed':
      if (state.status !== 'verifying') return state
      return { ...state, status: 'failed', errorMessage: event.message }
    case 'dismiss':
      if (state.status === 'completed' || state.status === 'dismissed') return state
      return { ...state, status: 'dismissed', dismissalReason: event.reason, errorMessage: null }
    default:
      return state
  }
}

/** A visit is "running" while its session is active or its completion is in flight. */
export const isAdVisitRunning = (state: AdVisitState): boolean => state.status === 'active' || state.status === 'verifying'

/**
 * Advertisement durations are configured in whole seconds (the backend enforces 3..120). Anything
 * that is not a finite positive number normalises to 0, which means "no waiting required" instead of
 * NaN or a negative countdown.
 */
export function normalizeAdDurationSeconds(value: unknown): number {
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric) || numeric <= 0) return 0
  return Math.floor(numeric)
}

export function countdownEndsAtMs(startedAtMs: number, durationSeconds: unknown): number {
  return startedAtMs + normalizeAdDurationSeconds(durationSeconds) * 1000
}

/**
 * Remaining whole seconds derived from real elapsed time (never from a decremented counter), so
 * background throttling cannot desynchronise it. Never negative.
 */
export function computeRemainingSeconds(startedAtMs: number, durationSeconds: unknown, nowMs: number): number {
  if (!Number.isFinite(startedAtMs)) return 0
  const remainingMs = countdownEndsAtMs(startedAtMs, durationSeconds) - nowMs
  return remainingMs > 0 ? Math.ceil(remainingMs / 1000) : 0
}

/** True only once the configured duration has fully elapsed — completion before that is never valid. */
export function hasDurationElapsed(startedAtMs: number, durationSeconds: unknown, nowMs: number): boolean {
  if (!Number.isFinite(startedAtMs)) return false
  return nowMs >= countdownEndsAtMs(startedAtMs, durationSeconds)
}

/** 0..1 progress derived from real elapsed time (used by both progress indicators). */
export function computeElapsedRatio(startedAtMs: number, durationSeconds: unknown, nowMs: number): number {
  const duration = normalizeAdDurationSeconds(durationSeconds)
  if (!Number.isFinite(startedAtMs) || duration <= 0) return 1
  const ratio = (nowMs - startedAtMs) / (duration * 1000)
  return Math.min(1, Math.max(0, ratio))
}

export interface UnlockLike {
  expiresAt: string | number | Date
}

/** Single place that decides whether a server-provided unlock is still active. */
export function isUnlockActive(unlock: UnlockLike | null | undefined, nowMs: number): boolean {
  if (!unlock || unlock.expiresAt === null || unlock.expiresAt === undefined) return false
  const expiresAtMs = unlock.expiresAt instanceof Date ? unlock.expiresAt.getTime() : new Date(unlock.expiresAt).getTime()
  return Number.isFinite(expiresAtMs) && expiresAtMs > nowMs
}

// ---------------------------------------------------------------------------------------------
// Local advertisement records
//
// Deliberately session-scoped and short lived: they only stop an advertisement from repeating too
// soon after a dismissal, and they are never proof of an unlock (the server owns unlocks). Nothing
// here can permanently block an advertisement.
// ---------------------------------------------------------------------------------------------

export type AdRecordState = 'completed' | 'dismissed'

export interface AdLocalRecord {
  state: AdRecordState
  at: number
}

export interface StorageLike {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
  removeItem: (key: string) => void
}

/** How long a dismissal suppresses the same advertisement again (matches the popup dismissal rule). */
export const AD_DISMISSAL_COOLDOWN_MS = 6 * 60 * 60 * 1000
/**
 * How long a just-completed advertisement stays suppressed. This only covers the moment between a
 * confirmed completion and the server unlock becoming visible to the client; it is deliberately
 * shorter than the smallest unlock (12h) so it can never disable advertising on its own.
 */
export const AD_COMPLETION_GRACE_MS = 5 * 60 * 1000
/** Records older than this are discarded, so no local entry can outlive the longest unlock. */
export const AD_RECORD_MAX_AGE_MS = 24 * 60 * 60 * 1000

export const adRecordKey = (advertisementId: string): string => `sportzone-ad:${advertisementId}`

/** Tolerates missing, blocked or corrupt storage — never throws. */
export function readAdRecord(storage: StorageLike | null | undefined, advertisementId: string, nowMs: number): AdLocalRecord | null {
  if (!storage || !advertisementId) return null
  try {
    const raw = storage.getItem(adRecordKey(advertisementId))
    if (!raw) return null
    const parsed = JSON.parse(raw) as unknown
    if (typeof parsed !== 'object' || parsed === null) return null
    const record = parsed as Partial<AdLocalRecord>
    if (record.state !== 'completed' && record.state !== 'dismissed') return null
    if (typeof record.at !== 'number' || !Number.isFinite(record.at)) return null
    if (nowMs - record.at > AD_RECORD_MAX_AGE_MS) {
      try {
        storage.removeItem(adRecordKey(advertisementId))
      } catch {
        // Ignore unavailable storage.
      }
      return null
    }
    return { state: record.state, at: record.at }
  } catch {
    return null
  }
}

export function writeAdRecord(storage: StorageLike | null | undefined, advertisementId: string, record: AdLocalRecord): void {
  if (!storage || !advertisementId) return
  try {
    storage.setItem(adRecordKey(advertisementId), JSON.stringify(record))
  } catch {
    // Storage can be unavailable (private mode); the visit still behaves correctly in memory.
  }
}

export function removeAdRecord(storage: StorageLike | null | undefined, advertisementId: string): void {
  if (!storage || !advertisementId) return
  try {
    storage.removeItem(adRecordKey(advertisementId))
  } catch {
    // Ignore unavailable storage.
  }
}

/** Best-effort localStorage access; null when storage is unavailable (private mode or no window). */
export function getAdStorage(): StorageLike | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

export interface AdEligibilityOptions {
  nowMs: number
  isPremium: boolean
  hasActiveUnlock: boolean
  dismissalCooldownMs?: number
  completionGraceMs?: number
}

/**
 * Whether the automatic (full page) advertisement may open.
 *
 * Entitlement always wins. A dismissal suppresses the same advertisement only until its short
 * cooldown has passed. A completed record is a short grace window — just long enough for the server
 * unlock to settle — rather than a permanent block, so an expired unlock makes the advertisement
 * eligible again instead of silently disabling advertising for a whole day.
 */
export function shouldAutoOpenAd(record: AdLocalRecord | null, options: AdEligibilityOptions): boolean {
  if (options.isPremium || options.hasActiveUnlock) return false
  if (!record) return true
  if (!Number.isFinite(options.nowMs) || !Number.isFinite(record.at)) return true
  if (record.state === 'completed') {
    return options.nowMs - record.at >= (options.completionGraceMs ?? AD_COMPLETION_GRACE_MS)
  }
  return options.nowMs - record.at >= (options.dismissalCooldownMs ?? AD_DISMISSAL_COOLDOWN_MS)
}

/** Manual dismissal bookkeeping — recorded with a timestamp so it is never mistaken for a completion. */
export function recordAdDismissal(storage: StorageLike | null | undefined, advertisementId: string, nowMs: number): void {
  writeAdRecord(storage, advertisementId, { state: 'dismissed', at: nowMs })
}

/** Completion bookkeeping: only a successful, server-confirmed completion may record this. */
export function recordAdCompletion(storage: StorageLike | null | undefined, advertisementId: string, nowMs: number): void {
  writeAdRecord(storage, advertisementId, { state: 'completed', at: nowMs })
}

// ---------------------------------------------------------------------------------------------
// Countdown clock
//
// One implementation of the ticking/completion/teardown rules, shared by every advertisement
// surface and directly testable through the injectable scheduler.
// ---------------------------------------------------------------------------------------------

export const AD_COUNTDOWN_TICK_MS = 500

export interface AdVisitClockScheduler {
  now: () => number
  setTimeout: (handler: () => void, ms: number) => number
  clearTimeout: (id: number) => void
  setInterval: (handler: () => void, ms: number) => number
  clearInterval: (id: number) => void
}

export const defaultAdVisitClockScheduler: AdVisitClockScheduler = {
  now: () => Date.now(),
  setTimeout: (handler, ms) => window.setTimeout(handler, ms),
  clearTimeout: (id) => window.clearTimeout(id),
  setInterval: (handler, ms) => window.setInterval(handler, ms),
  clearInterval: (id) => window.clearInterval(id),
}

export interface AdVisitClockOptions {
  startedAtMs: number
  durationSeconds: unknown
  onTick: (remainingSeconds: number) => void
  onElapsed: () => void
  tickMs?: number
  scheduler?: AdVisitClockScheduler
}

/**
 * Starts the countdown for one visit and returns its teardown function.
 *
 * - `onElapsed` fires exactly once, never before the configured duration, and both the deadline
 *   timeout and the display interval are cleared the moment it fires ("countdown stops exactly when
 *   completion occurs").
 * - The deadline timeout is authoritative, so a throttled interval in a background tab cannot delay
 *   or duplicate completion.
 * - The teardown clears both timers and makes any queued callback a no-op.
 */
export function startAdVisitClock(options: AdVisitClockOptions): () => void {
  const scheduler = options.scheduler ?? defaultAdVisitClockScheduler
  const durationSeconds = normalizeAdDurationSeconds(options.durationSeconds)
  const endsAtMs = countdownEndsAtMs(options.startedAtMs, durationSeconds)
  const tickMs = options.tickMs ?? AD_COUNTDOWN_TICK_MS

  let stopped = false
  let elapsedHandled = false
  let deadlineTimer = 0
  let intervalTimer = 0

  const stopTimers = () => {
    scheduler.clearTimeout(deadlineTimer)
    scheduler.clearInterval(intervalTimer)
    deadlineTimer = 0
    intervalTimer = 0
  }

  const finishOnce = () => {
    if (stopped || elapsedHandled) return
    elapsedHandled = true
    stopTimers()
    options.onElapsed()
  }

  const sync = () => {
    if (stopped || elapsedHandled) return
    const remainingSeconds = computeRemainingSeconds(options.startedAtMs, durationSeconds, scheduler.now())
    options.onTick(remainingSeconds)
    if (remainingSeconds === 0) finishOnce()
  }

  deadlineTimer = scheduler.setTimeout(finishOnce, Math.max(0, endsAtMs - scheduler.now()))
  intervalTimer = scheduler.setInterval(sync, tickMs)
  sync()

  return () => {
    if (stopped) return
    stopped = true
    stopTimers()
  }
}
