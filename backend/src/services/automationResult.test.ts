import assert from 'node:assert/strict'
import { test } from 'node:test'
import { resolveDiscoveryStatus, summarizeDiscoveryResult } from './automationResult.js'

test('reports SUCCESS when every competition request succeeded or simply had no fixtures', () => {
  assert.equal(resolveDiscoveryStatus(6, 0), 'SUCCESS')
  assert.equal(resolveDiscoveryStatus(0, 0), 'SUCCESS')
})

test('reports PARTIAL when only some competitions failed', () => {
  assert.equal(resolveDiscoveryStatus(6, 1), 'PARTIAL')
  assert.equal(resolveDiscoveryStatus(6, 5), 'PARTIAL')
})

test('reports FAILED only when every attempted competition failed', () => {
  assert.equal(resolveDiscoveryStatus(6, 6), 'FAILED')
  assert.equal(resolveDiscoveryStatus(1, 1), 'FAILED')
})

test('keeps an accurate count summary for a full-success run', () => {
  assert.equal(summarizeDiscoveryResult(5, 2, 1, 6, []), 'Created 5, updated 2, skipped 1')
})

test('names the failed competitions so partial success is never implied to be complete success', () => {
  assert.equal(
    summarizeDiscoveryResult(5, 2, 1, 6, ['PD', 'PPL']),
    'Created 5, updated 2, skipped 1, 2/6 competitions failed (PD, PPL)',
  )
})

test('describes an all-competition outage without hiding it behind zero counts', () => {
  assert.equal(
    summarizeDiscoveryResult(0, 0, 0, 3, ['PL', 'PD', 'SA']),
    'Created 0, updated 0, skipped 0, 3/3 competitions failed (PL, PD, SA)',
  )
})
