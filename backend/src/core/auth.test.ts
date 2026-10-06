import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { before, test } from 'node:test'

type AuthModule = typeof import('./auth.js')

let hashPassword: AuthModule['hashPassword']
let comparePassword: AuthModule['comparePassword']
let hashOneTimeCode: AuthModule['hashOneTimeCode']
let verifyOneTimeCode: AuthModule['verifyOneTimeCode']
let isOneTimeCodeUsable: AuthModule['isOneTimeCodeUsable']
let hashRefreshToken: AuthModule['hashRefreshToken']
let compareRefreshToken: AuthModule['compareRefreshToken']
let digestRefreshToken: AuthModule['digestRefreshToken']
let isSupersededRefreshToken: AuthModule['isSupersededRefreshToken']
let parseSessionRefreshCredentials: AuthModule['parseSessionRefreshCredentials']
let serializeSessionRefreshCredentials: AuthModule['serializeSessionRefreshCredentials']
let nextSessionRefreshCredentials: AuthModule['nextSessionRefreshCredentials']
let signRefreshToken: AuthModule['signRefreshToken']
let ACCESS_TOKEN_MAX_AGE_MS: AuthModule['ACCESS_TOKEN_MAX_AGE_MS']
let SESSION_MAX_AGE_MS: AuthModule['SESSION_MAX_AGE_MS']
let REFRESH_ROTATION_GRACE_MS: AuthModule['REFRESH_ROTATION_GRACE_MS']
let TOKEN_EXPIRY: AuthModule['TOKEN_EXPIRY']

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
  digestRefreshToken = module.digestRefreshToken
  isSupersededRefreshToken = module.isSupersededRefreshToken
  parseSessionRefreshCredentials = module.parseSessionRefreshCredentials
  serializeSessionRefreshCredentials = module.serializeSessionRefreshCredentials
  nextSessionRefreshCredentials = module.nextSessionRefreshCredentials
  signRefreshToken = module.signRefreshToken
  ACCESS_TOKEN_MAX_AGE_MS = module.ACCESS_TOKEN_MAX_AGE_MS
  SESSION_MAX_AGE_MS = module.SESSION_MAX_AGE_MS
  REFRESH_ROTATION_GRACE_MS = module.REFRESH_ROTATION_GRACE_MS
  TOKEN_EXPIRY = module.TOKEN_EXPIRY
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

test('refresh tokens are stored as a sha256 digest instead of a bcrypt hash', async () => {
  const token = crypto.randomBytes(32).toString('hex')
  const hash = await hashRefreshToken(token)

  assert.match(hash, /^sha256\$[0-9a-f]{64}$/)
  assert.equal(hash, digestRefreshToken(token), 'the digest must be deterministic so rotation can compare it')
  assert.equal(await compareRefreshToken(token, hash), true)
  assert.equal(await compareRefreshToken(crypto.randomBytes(32).toString('hex'), hash), false)
})

test('a refresh-token digest binds the whole token, not just bcrypt`s first 72 bytes', async () => {
  // Bcrypt silently truncates at 72 bytes, so two tokens sharing a 72-byte prefix used to verify
  // against the same stored hash.
  const sharedPrefix = 'p'.repeat(72)
  const first = `${sharedPrefix}-first-signature`
  const second = `${sharedPrefix}-second-signature`

  const hash = await hashRefreshToken(first)

  assert.equal(await compareRefreshToken(first, hash), true)
  assert.equal(await compareRefreshToken(second, hash), false)
})

test('refresh tokens issued before this change still verify with bcrypt', async () => {
  const token = crypto.randomBytes(32).toString('hex')
  const legacyHash = await bcrypt.hash(token, 12)

  assert.equal(await compareRefreshToken(token, legacyHash), true)
  assert.equal(await compareRefreshToken(crypto.randomBytes(32).toString('hex'), legacyHash), false)
})

test('missing or malformed stored credentials never verify', async () => {
  const token = crypto.randomBytes(32).toString('hex')

  for (const stored of [null, undefined, '', 'sha256$', 'sha256$not-a-digest', 'sha256$abc$def$ghi']) {
    assert.equal(await compareRefreshToken(token, stored), false)
    assert.equal(await isSupersededRefreshToken(token, stored), false)
  }

  assert.equal(await compareRefreshToken('', await hashRefreshToken(token)), false)
})

test('rotation keeps the superseded credential acceptable only inside its grace window', async () => {
  const current = crypto.randomBytes(32).toString('hex')
  const previous = crypto.randomBytes(32).toString('hex')
  const rotatedAtMs = 1_700_000_000_000

  const stored = serializeSessionRefreshCredentials({
    current: await hashRefreshToken(current),
    previous: await hashRefreshToken(previous),
    rotatedAtMs,
  })

  assert.equal(await compareRefreshToken(current, stored), true, 'the current credential stays valid')
  assert.equal(await compareRefreshToken(previous, stored), false, 'a superseded credential is not the current one')
  assert.equal(
    await isSupersededRefreshToken(previous, stored, 60_000, rotatedAtMs + 30_000),
    true,
    'a racing request may present the credential the rotation replaced',
  )
  assert.equal(
    await isSupersededRefreshToken(previous, stored, 60_000, rotatedAtMs + 60_001),
    false,
    'the window must close',
  )
  assert.equal(
    await isSupersededRefreshToken(crypto.randomBytes(32).toString('hex'), stored, 60_000, rotatedAtMs + 1_000),
    false,
    'an unrelated token is never accepted as the superseded credential',
  )
  assert.equal(
    await isSupersededRefreshToken(previous, stored, 0, rotatedAtMs),
    false,
    'a disabled window accepts nothing',
  )
})

test('a rotation keeps the replaced credential inside the grace window and never extends it', async () => {
  const first = await hashRefreshToken(crypto.randomBytes(32).toString('hex'))
  const second = await hashRefreshToken(crypto.randomBytes(32).toString('hex'))
  const third = await hashRefreshToken(crypto.randomBytes(32).toString('hex'))

  const issued = serializeSessionRefreshCredentials({ current: first, previous: null, rotatedAtMs: null })

  // A normal refresh: the credential that was current becomes the superseded one, from now.
  const rotated = nextSessionRefreshCredentials(issued, true, second, 1_000)
  assert.deepEqual(rotated, { current: second, previous: first, rotatedAtMs: 1_000 })
  const storedRotation = serializeSessionRefreshCredentials(rotated)

  // A racing request presenting the superseded credential rotates again, but the original window is
  // preserved instead of being pushed forward.
  const raced = nextSessionRefreshCredentials(storedRotation, false, third, 30_000)
  assert.deepEqual(raced, { current: third, previous: first, rotatedAtMs: 1_000 })
})

test('a rotation of a legacy credential stores only the new digest', async () => {
  const legacyHash = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 12)
  const digest = await hashRefreshToken(crypto.randomBytes(32).toString('hex'))

  const rotated = nextSessionRefreshCredentials(legacyHash, true, digest, 5_000)

  assert.equal(serializeSessionRefreshCredentials(rotated), digest, 'a bcrypt hash must never be embedded as a previous digest')
})

test('credential state round-trips and never rewrites a legacy value', async () => {  const digest = await hashRefreshToken(crypto.randomBytes(32).toString('hex'))
  const previousDigest = await hashRefreshToken(crypto.randomBytes(32).toString('hex'))

  const single = serializeSessionRefreshCredentials({ current: digest, previous: null, rotatedAtMs: null })
  assert.equal(single, digest)
  assert.deepEqual(parseSessionRefreshCredentials(single), {
    current: digest,
    previous: null,
    rotatedAtMs: null,
  })

  const rotated = serializeSessionRefreshCredentials({ current: digest, previous: previousDigest, rotatedAtMs: 1234 })
  assert.deepEqual(parseSessionRefreshCredentials(rotated), {
    current: digest,
    previous: previousDigest,
    rotatedAtMs: 1234,
  })

  const legacyHash = await bcrypt.hash('legacy', 12)
  assert.equal(
    serializeSessionRefreshCredentials({ current: legacyHash, previous: null, rotatedAtMs: null }),
    legacyHash,
    'a legacy bcrypt hash must survive a rewrite untouched',
  )
  assert.deepEqual(parseSessionRefreshCredentials(legacyHash), { current: legacyHash, previous: null, rotatedAtMs: null })
  assert.equal(serializeSessionRefreshCredentials({ current: null, previous: null, rotatedAtMs: null }), '')
})

test('token lifetimes keep short access tokens with a long, bounded refresh session', () => {
  assert.equal(TOKEN_EXPIRY.ACCESS, '15m')
  assert.equal(TOKEN_EXPIRY.REFRESH, '30d')
  assert.equal(ACCESS_TOKEN_MAX_AGE_MS, 15 * 60 * 1000)
  assert.equal(SESSION_MAX_AGE_MS, 30 * 24 * 60 * 60 * 1000)
  assert.ok(REFRESH_ROTATION_GRACE_MS > 0 && REFRESH_ROTATION_GRACE_MS <= 5 * 60 * 1000)
})

test('a rotated refresh token can be limited to the remaining session lifetime', () => {
  const nowSeconds = Math.floor(Date.now() / 1000)

  const bounded = jwt.decode(signRefreshToken({ sub: 'user-id' }, 600)) as { iat: number; exp: number }
  assert.equal(bounded.exp - bounded.iat, 600)

  const defaulted = jwt.decode(signRefreshToken({ sub: 'user-id' })) as { iat: number; exp: number }
  assert.equal(defaulted.exp - defaulted.iat, 30 * 24 * 60 * 60)
  assert.ok(defaulted.iat >= nowSeconds)
})
