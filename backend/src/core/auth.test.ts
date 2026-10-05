import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { before, test } from 'node:test'

type AuthModule = typeof import('./auth.js')

let hashPassword: AuthModule['hashPassword']
let comparePassword: AuthModule['comparePassword']
let hashOneTimeCode: AuthModule['hashOneTimeCode']
let verifyOneTimeCode: AuthModule['verifyOneTimeCode']
let isOneTimeCodeUsable: AuthModule['isOneTimeCodeUsable']
let hashRefreshToken: AuthModule['hashRefreshToken']
let compareRefreshToken: AuthModule['compareRefreshToken']

before(async () => {
  process.env.JWT_SECRET = process.env.JWT_SECRET ?? 'test-access-secret'
  process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET ?? 'test-refresh-secret'

  const module = await import('./auth.js')
  hashPassword = module.hashPassword
  comparePassword = module.comparePassword
  hashOneTimeCode = module.hashOneTimeCode
  verifyOneTimeCode = module.verifyOneTimeCode
  isOneTimeCodeUsable = module.isOneTimeCodeUsable
  hashRefreshToken = module.hashRefreshToken
  compareRefreshToken = module.compareRefreshToken
})

const CODE = '428913'
const sha256Hex = (value: string) => crypto.createHash('sha256').update(value).digest('hex')

test('one-time codes are stored as a bcrypt hash, never as the code itself', async () => {
  const hash = await hashOneTimeCode(CODE)

  assert.match(hash, /^\$2[aby]\$12\$/, 'the project cost factor must be used')
  assert.equal(hash.length, 60)
  assert.notEqual(hash, CODE)
  assert.ok(!hash.includes(CODE), 'the stored hash must not contain the code')
  assert.notEqual(await hashOneTimeCode(CODE), hash, 'a fresh salt must be used per code')
})

test('the correct code verifies and a wrong code does not', async () => {
  const hash = await hashOneTimeCode(CODE)

  assert.equal(await verifyOneTimeCode(CODE, hash), true)
  assert.equal(await verifyOneTimeCode('428914', hash), false)
  assert.equal(await verifyOneTimeCode(CODE, await hashOneTimeCode('000000')), false)
})

test('a leaked hash cannot be replayed as a code', async () => {
  const hash = await hashOneTimeCode(CODE)

  assert.equal(await verifyOneTimeCode(hash, hash), false)
})

test('missing, legacy, or malformed stored values never verify', async () => {
  assert.equal(await verifyOneTimeCode(CODE, null), false)
  assert.equal(await verifyOneTimeCode(CODE, undefined), false)
  assert.equal(await verifyOneTimeCode(CODE, ''), false)
  // Values written by the previous implementation: a sha256 digest of the code, and plaintext.
  assert.equal(await verifyOneTimeCode(CODE, sha256Hex(CODE)), false)
  assert.equal(await verifyOneTimeCode(CODE, CODE), false)
  assert.equal(await verifyOneTimeCode('', await hashOneTimeCode(CODE)), false)
})

test('an empty code cannot be hashed', async () => {
  await assert.rejects(() => hashOneTimeCode(''), /non-empty string/)
})

test('only an unexpired code is usable', () => {
  const now = new Date('2026-10-06T00:00:00.000Z')

  assert.equal(isOneTimeCodeUsable(new Date(now.getTime() + 60_000), now), true)
  assert.equal(isOneTimeCodeUsable(new Date(now.getTime() - 1), now), false)
  assert.equal(isOneTimeCodeUsable(now, now), false)
  assert.equal(isOneTimeCodeUsable(null, now), false)
  assert.equal(isOneTimeCodeUsable(undefined, now), false)
})

test('existing password hashing behaviour is unchanged', async () => {
  const hash = await hashPassword('Str0ngPassw0rd!')

  assert.match(hash, /^\$2[aby]\$12\$/)
  assert.equal(await comparePassword('Str0ngPassw0rd!', hash), true)
  assert.equal(await comparePassword('wrong-password', hash), false)
  assert.equal(await comparePassword('Str0ngPassw0rd!', ''), false)
})

test('existing refresh-token hashing behaviour is unchanged', async () => {
  const token = crypto.randomBytes(32).toString('hex')
  const hash = await hashRefreshToken(token)

  assert.match(hash, /^\$2[aby]\$12\$/)
  assert.equal(await compareRefreshToken(token, hash), true)
  assert.equal(await compareRefreshToken(crypto.randomBytes(32).toString('hex'), hash), false)
})
