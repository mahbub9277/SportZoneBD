import type { AutomationSwitchState } from './automationSwitches.api'

/** The permission that guards both switch endpoints on the backend. */
export const AUTOMATION_SWITCH_PERMISSION = 'admin.settings.manage'

export type AutomationSwitchDisplayState =
  | 'loading'
  | 'on'
  | 'off'
  | 'saving'
  | 'degraded'
  | 'unavailable'
  | 'error'

export interface AutomationSwitchView {
  /** What the switch control shows. Never a requested value that the backend has not confirmed. */
  enabled: boolean
  state: AutomationSwitchDisplayState
  /** Short status word for the control. */
  statusLabel: string
  /** One sentence an operator can act on. */
  message: string
  tone: 'accent' | 'muted' | 'warning' | 'danger'
  canToggle: boolean
  lastConfirmedAt: string | null
}

export interface AutomationSwitchViewInput {
  state?: AutomationSwitchState
  isFetching: boolean
  isSaving: boolean
  isError: boolean
  hasPermission: boolean
}

/**
 * Turns the API payload into what the control shows.
 *
 * The rules that matter: the displayed value is always the last value the backend confirmed (a failed or
 * in-flight request never shows an optimistic switch position), an unconfirmed value is never shown as ON,
 * and a persisted-but-not-operational result is presented as degraded rather than as success.
 */
export function describeAutomationSwitch(input: AutomationSwitchViewInput): AutomationSwitchView {
  const { state, isFetching, isSaving, isError, hasPermission } = input
  const confirmed = state?.desired === true
  const lastConfirmedAt = state?.confirmedAt ?? null

  if (!state) {
    if (isError) {
      return {
        enabled: false,
        state: 'error',
        statusLabel: 'Unavailable',
        message: 'The automation state could not be loaded. Nothing has been changed.',
        tone: 'danger',
        canToggle: false,
        lastConfirmedAt,
      }
    }
    return {
      enabled: false,
      state: 'loading',
      statusLabel: isFetching ? 'Loading' : 'Unknown',
      message: isFetching ? 'Reading the current state from the server…' : 'The automation state has not been loaded yet.',
      tone: 'muted',
      canToggle: false,
      lastConfirmedAt,
    }
  }

  if (isSaving) {
    return {
      enabled: confirmed,
      state: 'saving',
      statusLabel: 'Saving',
      message: 'Applying the change on the server…',
      tone: 'muted',
      canToggle: false,
      lastConfirmedAt,
    }
  }

  if (state.desired === null || state.transition === 'unavailable') {
    return {
      enabled: false,
      state: 'unavailable',
      statusLabel: 'Unconfirmed',
      message: state.degradedReason
        ? `The stored value could not be confirmed (${state.degradedReason}). Automatic work stays paused until it can be read.`
        : 'The stored value could not be confirmed, so automatic work stays paused until it can be read.',
      tone: 'danger',
      canToggle: hasPermission,
      lastConfirmedAt,
    }
  }

  const blockedDependencies = state.dependencies.filter((dependency) => !dependency.ok && dependency.name !== 'notificationWorker')

  if (!state.degraded && !state.operational && confirmed) {
    return {
      enabled: false,
      state: 'degraded',
      statusLabel: 'Not applied',
      message: 'The server confirmed the value but is not enforcing it yet. Re-check before assuming the automation runs.',
      tone: 'warning',
      canToggle: hasPermission,
      lastConfirmedAt,
    }
  }

  if (confirmed && (state.transition === 'degraded' || blockedDependencies.length > 0)) {
    const reason = blockedDependencies[0]?.detail ?? 'A required dependency is not available.'
    return {
      enabled: true,
      state: 'degraded',
      statusLabel: 'ON (degraded)',
      message: `Automation is on, but it cannot do useful work: ${reason}`,
      tone: 'warning',
      canToggle: hasPermission,
      lastConfirmedAt,
    }
  }

  if (isError) {
    return {
      enabled: confirmed,
      state: 'error',
      statusLabel: confirmed ? 'ON' : 'OFF',
      message: 'The last change could not be confirmed. The switch shows the last value the server confirmed.',
      tone: 'danger',
      canToggle: hasPermission,
      lastConfirmedAt,
    }
  }

  return {
    enabled: confirmed,
    state: confirmed ? 'on' : 'off',
    statusLabel: confirmed ? 'ON' : 'OFF',
    message: confirmed
      ? `${state.description} Automatic work is running.`
      : `${state.description} New automatic work is paused; existing records and manual actions are unaffected.`,
    tone: confirmed ? 'accent' : 'muted',
    canToggle: hasPermission,
    lastConfirmedAt,
  }
}
