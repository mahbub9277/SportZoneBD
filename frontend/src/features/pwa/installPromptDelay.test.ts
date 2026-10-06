import test from 'node:test'
import assert from 'node:assert/strict'
import { INSTALL_PROMPT_DELAY_MS, installPromptDelayRemainingMs } from './installPromptDelay.ts'

const START = 5_000_000

test('the install prompt waits the full minimum delay', () => {
  assert.equal(INSTALL_PROMPT_DELAY_MS, 10_000)
  assert.equal(installPromptDelayRemainingMs(START, START), 10_000)
  assert.equal(installPromptDelayRemainingMs(START, START + 1), 9_999)
  assert.equal(installPromptDelayRemainingMs(START, START + 9_999), 1)
})

test('the install prompt is eligible at and after the delay, never earlier', () => {
  assert.equal(installPromptDelayRemainingMs(START, START + 10_000), 0)
  assert.equal(installPromptDelayRemainingMs(START, START + 10_001), 0)
  assert.equal(installPromptDelayRemainingMs(START, START + 600_000), 0)
})

test('a resumed or clock-shifted page cannot shorten the delay below zero', () => {
  // Timer fired early (throttling / clock skew): the remaining time is still positive, so the caller
  // reschedules instead of showing the banner early.
  assert.equal(installPromptDelayRemainingMs(START, START + 4_000), 6_000)
  assert.equal(installPromptDelayRemainingMs(START, START - 5_000), 15_000)
  assert.equal(installPromptDelayRemainingMs(Number.NaN, START), INSTALL_PROMPT_DELAY_MS)
  assert.equal(installPromptDelayRemainingMs(START, Number.NaN), INSTALL_PROMPT_DELAY_MS)
})

test('a custom delay still resolves to a non-negative remaining time', () => {
  assert.equal(installPromptDelayRemainingMs(START, START, 0), 0)
  assert.equal(installPromptDelayRemainingMs(START, START + 100, 50), 0)
  assert.equal(installPromptDelayRemainingMs(START, START + 10, 50), 40)
})
