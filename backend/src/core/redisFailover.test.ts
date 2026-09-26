import assert from 'node:assert/strict'
import test from 'node:test'
import { RedisFailoverManager } from './redisFailover.js'

class FakeRedis {
  available = true
  setFailure = false
  commandCalls = 0
  pingCalls = 0

  async ping(): Promise<string> {
    this.pingCalls += 1
    if (!this.available) throw Object.assign(new Error('unavailable'), { code: 'ECONNREFUSED' })
    return 'PONG'
  }

  async get(): Promise<string> {
    this.commandCalls += 1
    if (!this.available) throw Object.assign(new Error('unavailable'), { code: 'ECONNREFUSED' })
    return 'value'
  }

  async set(): Promise<string> {
    this.commandCalls += 1
    if (!this.available || this.setFailure) throw Object.assign(new Error('connection reset'), { code: 'ECONNRESET' })
    return 'OK'
  }
}

const testLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
}

function makeManager(primary: FakeRedis, backup: FakeRedis) {
  return new RedisFailoverManager({
    providers: [
      { name: 'primary', client: primary, configured: true },
      { name: 'backup-1', client: backup, configured: true },
    ],
    logger: testLogger,
    failureThreshold: 3,
    cooldownMs: 0,
    commandTimeoutMs: 100,
    recoverySuccessThreshold: 3,
    recoveryIntervalMs: 30_000,
  })
}

test('fails over only after the configured consecutive failure threshold and does not replay commands', async () => {
  const primary = new FakeRedis()
  const backup = new FakeRedis()
  primary.available = false
  const manager = makeManager(primary, backup)

  for (let attempt = 0; attempt < 2; attempt += 1) {
    await assert.rejects(manager.execute((client) => client.get()))
  }
  assert.equal(manager.activeProvider, 'primary')

  await assert.rejects(manager.execute((client) => client.get()))
  assert.equal(manager.activeProvider, 'backup-1')
  assert.equal(primary.commandCalls, 3)
  assert.equal(backup.commandCalls, 0)
  assert.equal(await manager.execute((client) => client.get()), 'value')
  assert.equal(backup.commandCalls, 1)
})

test('returns to a recovered primary only after stable recovery probes', async () => {
  const primary = new FakeRedis()
  const backup = new FakeRedis()
  primary.available = false
  const manager = makeManager(primary, backup)

  for (let attempt = 0; attempt < 3; attempt += 1) {
    await assert.rejects(manager.execute((client) => client.get()))
  }
  assert.equal(manager.activeProvider, 'backup-1')

  primary.available = true
  await manager.checkForRecovery()
  await manager.checkForRecovery()
  assert.equal(manager.activeProvider, 'backup-1')
  await manager.checkForRecovery()
  assert.equal(manager.activeProvider, 'primary')
})

test('does not immediately fail back to a recovered primary when the backup fails', async () => {
  const primary = new FakeRedis()
  const backup = new FakeRedis()
  primary.available = false
  const manager = makeManager(primary, backup)

  for (let attempt = 0; attempt < 3; attempt += 1) {
    await assert.rejects(manager.execute((client) => client.get()))
  }
  primary.available = true
  backup.available = false
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await assert.rejects(manager.execute((client) => client.get()))
  }
  assert.equal(manager.activeProvider, null)

  await manager.checkForRecovery()
  assert.equal(manager.activeProvider, null)
  await manager.checkForRecovery()
  assert.equal(manager.activeProvider, 'primary')
})

test('skips unhealthy configured backups and reports all providers unavailable', async () => {
  const primary = new FakeRedis()
  const backup1 = new FakeRedis()
  const backup2 = new FakeRedis()
  primary.available = false
  backup1.available = false
  const manager = new RedisFailoverManager({
    providers: [
      { name: 'primary', client: primary, configured: true },
      { name: 'backup-1', client: backup1, configured: true },
      { name: 'backup-2', client: backup2, configured: true },
    ],
    logger: testLogger,
    failureThreshold: 1,
    cooldownMs: 0,
    commandTimeoutMs: 100,
    recoveryIntervalMs: 30_000,
  })

  await assert.rejects(manager.execute((client) => client.get()))
  assert.equal(manager.activeProvider, 'backup-2')

  backup2.available = false
  await assert.rejects(manager.execute((client) => client.get()))
  assert.equal(manager.activeProvider, null)
  await assert.rejects(manager.execute((client) => client.get()), /All configured Redis providers are unavailable/)
})

test('does not fail over for a non-provider Redis command error', async () => {
  const primary = new FakeRedis()
  const backup = new FakeRedis()
  const manager = makeManager(primary, backup)

  for (let attempt = 0; attempt < 3; attempt += 1) {
    await assert.rejects(manager.execute(async () => { throw new Error('WRONGTYPE Operation against a key holding the wrong kind of value') }))
  }

  assert.equal(manager.activeProvider, 'primary')
  assert.equal(backup.pingCalls, 0)
})

test('fails over after repeated provider quota-limit rejections', async () => {
  const primary = new FakeRedis()
  const backup = new FakeRedis()
  const manager = makeManager(primary, backup)

  for (let attempt = 0; attempt < 3; attempt += 1) {
    await assert.rejects(manager.execute(async () => { throw new Error('ERR max requests limit reached') }))
  }

  assert.equal(manager.activeProvider, 'backup-1')
})

test('fails over after repeated SET connection failures', async () => {
  const primary = new FakeRedis()
  const backup = new FakeRedis()
  primary.setFailure = true
  const manager = makeManager(primary, backup)

  for (let attempt = 0; attempt < 3; attempt += 1) {
    await assert.rejects(manager.execute((client) => client.set()))
  }

  assert.equal(manager.activeProvider, 'backup-1')
  assert.equal(primary.commandCalls, 3)
})

test('treats a command timeout as a provider failure', async () => {
  const primary = new FakeRedis()
  const backup = new FakeRedis()
  const manager = new RedisFailoverManager({
    providers: [
      { name: 'primary', client: primary, configured: true },
      { name: 'backup-1', client: backup, configured: true },
    ],
    logger: testLogger,
    failureThreshold: 1,
    cooldownMs: 0,
    commandTimeoutMs: 10,
    recoveryIntervalMs: 30_000,
  })

  await assert.rejects(manager.execute(() => new Promise<string>(() => undefined)), /timed out/)
  assert.equal(manager.activeProvider, 'backup-1')
})

test('uses the primary alone when no backups are configured', async () => {
  const primary = new FakeRedis()
  primary.available = false
  const manager = new RedisFailoverManager({
    providers: [
      { name: 'primary', client: primary, configured: true },
      { name: 'backup-1', client: new FakeRedis(), configured: false },
    ],
    logger: testLogger,
    failureThreshold: 1,
    cooldownMs: 0,
    commandTimeoutMs: 100,
    recoveryIntervalMs: 30_000,
  })

  await assert.rejects(manager.execute((client) => client.get()))
  assert.equal(manager.activeProvider, null)
})