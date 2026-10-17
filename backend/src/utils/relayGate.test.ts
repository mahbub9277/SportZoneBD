import assert from 'node:assert/strict'
import test from 'node:test'
import { createRelayGate } from './relayGate.js'

test('the gate admits work up to its limit and refuses beyond it', () => {
  const gate = createRelayGate(2)

  const first = gate.tryEnter()
  const second = gate.tryEnter()
  assert.ok(first)
  assert.ok(second)
  assert.equal(gate.inFlight(), 2)

  // Refused, not queued: a viewer cannot wait behind other viewers for a live segment.
  assert.equal(gate.tryEnter(), null)
  assert.equal(gate.inFlight(), 2)

  first()
  assert.equal(gate.inFlight(), 1)
  assert.ok(gate.tryEnter())
  assert.equal(gate.inFlight(), 2)
})

test('releasing a slot twice can never inflate the count', () => {
  const gate = createRelayGate(1)
  const release = gate.tryEnter()
  assert.ok(release)

  release()
  release()
  assert.equal(gate.inFlight(), 0)
  assert.ok(gate.tryEnter())
  assert.equal(gate.inFlight(), 1)
})
