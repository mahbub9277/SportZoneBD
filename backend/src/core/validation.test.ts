import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseUuidParam } from './validation.js'
import { ValidationError } from './errors.js'

const MALFORMED_IDS = ['not-a-uuid', '123', '', '   ', '../../etc/passwd', '1 OR 1=1', '00000000-0000-0000-0000-00000000000']

test('accepts a well-formed UUID parameter', () => {
  const id = '3f2504e0-4f89-11d3-9a0c-0305e82c3301'
  assert.equal(parseUuidParam(id, 'stream id'), id)
})

test('rejects malformed ids with a 400 instead of letting them reach the database', () => {
  for (const value of [...MALFORMED_IDS, undefined, null, 42, {}]) {
    assert.throws(
      () => parseUuidParam(value, 'stream id'),
      (error: unknown) => error instanceof ValidationError
        && error.statusCode === 400
        && error.message === 'Invalid stream id',
      `expected ${String(value)} to be rejected`,
    )
  }
})

test('rejects malformed ids with an operational 400 that leaks no database internals', () => {
  try {
    parseUuidParam('not-a-uuid', 'stream id')
    assert.fail('expected malformed id to be rejected')
  } catch (error) {
    assert.ok(error instanceof ValidationError)
    assert.equal(error.statusCode, 400)
    assert.equal(error.isOperational, true)
    assert.ok(!/P2007|invalid input syntax|type uuid/i.test(error.message))
  }
})
