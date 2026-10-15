import assert from 'node:assert/strict'
import test from 'node:test'
import { BadGatewayError, ServiceUnavailableError } from './errors.js'

test('a source failure is answered as a bad gateway, never as an internal error', () => {
  const error = new BadGatewayError('The stream source is unavailable.', { reason: 'Upstream responded with 404' })

  assert.equal(error.statusCode, 502)
  assert.equal(error.name, 'BadGatewayError')
  assert.equal(error.isOperational, true)
  assert.deepEqual(error.details, { reason: 'Upstream responded with 404' })

  // The upstream reason stays in `details` (development only) and never in the client-facing message.
  assert.equal(error.message, 'The stream source is unavailable.')
  assert.doesNotMatch(error.message, /http|reason/i)

  assert.equal(new BadGatewayError().statusCode, 502)
})

test('the bad gateway stays an Error and stays distinct from a down service', () => {
  assert.ok(new BadGatewayError() instanceof Error)
  assert.equal(new BadGatewayError().statusCode, 502)
  assert.equal(new ServiceUnavailableError().statusCode, 503)
})
