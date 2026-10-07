import assert from 'node:assert/strict'
import { test } from 'node:test'
import { resolveMultiInstanceEnabled } from './deployment.js'

test('the multi-instance behaviour is kept when the deployment does not declare a topology', () => {
  assert.equal(resolveMultiInstanceEnabled(undefined), true)
  assert.equal(resolveMultiInstanceEnabled(''), true)
  assert.equal(resolveMultiInstanceEnabled('   '), true)
})

test('an explicit single-instance declaration disables the shared coordination layers', () => {
  for (const value of ['false', 'FALSE', '0', 'off', 'no', 'none', 'disabled', ' false ']) {
    assert.equal(resolveMultiInstanceEnabled(value), false, `expected "${value}" to mean single instance`)
  }
})

test('any other value keeps the shared coordination layers enabled', () => {
  for (const value of ['true', 'TRUE', '1', 'on', 'yes', 'enabled']) {
    assert.equal(resolveMultiInstanceEnabled(value), true, `expected "${value}" to mean multi instance`)
  }
})
