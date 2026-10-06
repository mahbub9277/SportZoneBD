/**
 * Lifecycle of the telemetry maintenance runtime.
 *
 * Telemetry OFF has to mean "completely dormant": the maintenance interval is never started, and a
 * running interval is cleared, instead of being left to fire and return early (an early return would
 * still have let the timer exist and would still have needed a settings read to decide). Keeping the
 * start/stop rules in this small module — with an injectable scheduler and an injected "is telemetry
 * enabled?" probe — makes the kill switch directly testable without Redis or a database.
 */

export interface TelemetryRuntimeScheduler {
  setInterval: (handler: () => void, ms: number) => unknown
  clearInterval: (handle: unknown) => void
  unref?: (handle: unknown) => void
}

export const createTelemetryRuntimeScheduler = (): TelemetryRuntimeScheduler => ({
  setInterval: (handler, ms) => setInterval(handler, ms),
  clearInterval: (handle) => clearInterval(handle as NodeJS.Timeout),
  unref: (handle) => {
    const timer = handle as { unref?: () => void } | null
    if (timer && typeof timer.unref === 'function') timer.unref()
  },
})

export interface TelemetryRuntimeOptions {
  intervalMs: number
  /** Authoritative, cached check of the telemetry setting. Must not perform telemetry data work. */
  isEnabled: () => Promise<boolean>
  /** One maintenance cycle. Only ever called while the setting is enabled. */
  runMaintenance: () => Promise<void> | void
  /** Called whenever the runtime observes telemetry switched off, so buffered work can be dropped. */
  onDisabled?: () => void
  onError?: (error: unknown) => void
  scheduler?: TelemetryRuntimeScheduler
}

export interface TelemetryRuntime {
  /** Applies a known setting value: starts the single maintenance timer when enabled, clears it when not. */
  apply: (enabled: boolean) => void
  /** Re-reads the setting (cached) and applies it. Returns the observed value. */
  sync: () => Promise<boolean>
  isTimerRunning: () => boolean
  stop: () => void
}

export function createTelemetryRuntime(options: TelemetryRuntimeOptions): TelemetryRuntime {
  const scheduler = options.scheduler ?? createTelemetryRuntimeScheduler()
  let timerHandle: unknown = null
  let maintenanceInFlight = false

  const stop = () => {
    if (timerHandle === null) return
    scheduler.clearInterval(timerHandle)
    timerHandle = null
  }

  const runTick = async () => {
    // One cycle at a time: a slow reconciliation must not overlap the next tick.
    if (maintenanceInFlight) return
    maintenanceInFlight = true
    try {
      const enabled = await options.isEnabled()
      if (!enabled) {
        // Telemetry was switched off elsewhere (another instance or the admin API): stop this timer too
        // so this process goes dormant without waiting for the next cycle.
        stop()
        options.onDisabled?.()
        return
      }
      await options.runMaintenance()
    } catch (error) {
      options.onError?.(error)
    } finally {
      maintenanceInFlight = false
    }
  }

  const start = () => {
    // Exactly one timer per process, however often apply(true) is called.
    if (timerHandle !== null) return
    timerHandle = scheduler.setInterval(() => { void runTick() }, options.intervalMs)
    scheduler.unref?.(timerHandle)
  }

  return {
    apply: (enabled) => {
      if (enabled) {
        start()
        return
      }
      stop()
      options.onDisabled?.()
    },
    sync: async () => {
      const enabled = await options.isEnabled()
      if (enabled) start()
      else {
        stop()
        options.onDisabled?.()
      }
      return enabled
    },
    isTimerRunning: () => timerHandle !== null,
    stop,
  }
}
