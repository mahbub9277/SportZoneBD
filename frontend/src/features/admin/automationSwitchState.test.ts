import assert from 'node:assert/strict'
import { test } from 'node:test'
import { describeAutomationSwitch } from './automationSwitchState.ts'

import type { AutomationSwitchState } from './automationSwitches.api.ts'

const baseState = (overrides: Partial<AutomationSwitchState> = {}): AutomationSwitchState => ({
  key: 'pushNotifications',
  settingKey: 'automation.pushNotifications.enabled',
  label: 'Push Notifications Automation',
  description: 'Automated match reminders and match-start alerts.',
  desired: true,
  operational: true,
  degraded: false,
  degradedReason: null,
  confirmedAt: '2026-10-11T05:00:00.000Z',
  instancesConfirmed: 'this-instance-only',
  transition: 'applied',
  dependencies: [{ name: 'webPushDelivery', ok: true, detail: 'Web push credentials are configured.' }],
  notes: [],
  ...overrides,
})

const view = (state: AutomationSwitchState | undefined, overrides: Partial<Parameters<typeof describeAutomationSwitch>[0]> = {}) =>
  describeAutomationSwitch({ state, isFetching: false, isSaving: false, isError: false, hasPermission: true, ...overrides })

test('an unloaded switch is never shown as enabled', () => {
  const loading = view(undefined, { isFetching: true })
  assert.equal(loading.state, 'loading')
  assert.equal(loading.enabled, false)
  assert.equal(loading.canToggle, false)

  const failed = view(undefined, { isError: true })
  assert.equal(failed.state, 'error')
  assert.equal(failed.enabled, false)
  assert.equal(failed.canToggle, false)
})

test('the confirmed value is what the control shows', () => {
  assert.equal(view(baseState()).state, 'on')
  assert.equal(view(baseState()).enabled, true)
  assert.equal(view(baseState({ desired: false })).state, 'off')
  assert.equal(view(baseState({ desired: false })).enabled, false)
})

test('a save in flight keeps showing the last confirmed value and blocks a second toggle', () => {
  const saving = view(baseState({ desired: true }), { isSaving: true })

  assert.equal(saving.state, 'saving')
  assert.equal(saving.enabled, true, 'the control must not jump to the requested value before the server confirms it')
  assert.equal(saving.canToggle, false)
})

test('a value the backend could not confirm is shown as unconfirmed, not as off or on', () => {
  const unconfirmed = view(baseState({ desired: null, operational: false, degraded: true, transition: 'unavailable' }))

  assert.equal(unconfirmed.state, 'unavailable')
  assert.equal(unconfirmed.enabled, false)
  assert.match(unconfirmed.message, /could not be confirmed/)
})

test('a blocked dependency is surfaced as degraded while the value stays on', () => {
  const degraded = view(baseState({
    transition: 'degraded',
    dependencies: [{ name: 'webPushDelivery', ok: false, detail: 'VAPID keys are missing or invalid, so no push can be delivered.' }],
  }))

  assert.equal(degraded.state, 'degraded')
  assert.equal(degraded.enabled, true)
  assert.match(degraded.message, /VAPID keys/)
})

test('a value that is not operational is not presented as applied', () => {
  const notApplied = view(baseState({ operational: false }))

  assert.equal(notApplied.state, 'degraded')
  assert.equal(notApplied.enabled, false)
  assert.equal(notApplied.statusLabel, 'Not applied')
})

test('a failed request keeps the last confirmed value visible and says so', () => {
  const failedSave = view(baseState({ desired: true }), { isError: true })

  assert.equal(failedSave.state, 'error')
  assert.equal(failedSave.enabled, true, 'the last confirmed value stays visible after a failure')
  assert.match(failedSave.message, /last value the server confirmed/)
})

test('an operator without the settings permission can see the state but not change it', () => {
  const readOnly = view(baseState(), { hasPermission: false })

  assert.equal(readOnly.state, 'on')
  assert.equal(readOnly.enabled, true)
  assert.equal(readOnly.canToggle, false)
})
