import assert from 'node:assert/strict'
import { test } from 'node:test'

process.env.JWT_SECRET ??= 'automation-persistence-test-secret'
process.env.JWT_REFRESH_SECRET ??= 'automation-persistence-test-refresh-secret'

const { prisma } = await import('./prisma.js')
const {
  AUTOMATION_SWITCHES,
  confirmAutomationSwitch,
  getAutomationSwitchStatus,
  initializeAutomationSwitches,
  setAutomationSwitch,
  setAutomationSwitchReader,
} = await import('./automationSwitches.js')

interface StoredSetting {
  key: string
  value: string
  type: string
  description: string | null
  deletedAt: Date | null
}

interface AuditRow {
  level: string
  message: string
  meta?: Record<string, unknown>
}

interface FakeDatabase {
  settings: Map<string, StoredSetting>
  audits: AuditRow[]
  jobFlags: boolean[]
  failWrites: boolean
  persistCalls: number
}

function createFakeDatabase(seeded: Array<Partial<StoredSetting> & { key: string }> = []): FakeDatabase {
  return {
    settings: new Map(seeded.map((entry) => [entry.key, {
      key: entry.key,
      value: entry.value ?? 'true',
      type: entry.type ?? 'boolean',
      description: entry.description ?? null,
      deletedAt: entry.deletedAt ?? null,
    }])),
    audits: [],
    jobFlags: [],
    failWrites: false,
    persistCalls: 0,
  }
}

/** Replaces the handful of Prisma calls the switch module makes, so the real transaction body runs. */
function installFakeDatabase(database: FakeDatabase) {
  const original = {
    findUnique: prisma.setting.findUnique,
    upsert: prisma.setting.upsert,
    create: prisma.setting.create,
    updateMany: prisma.automationJob.updateMany,
    systemLogCreate: prisma.systemLog.create,
    transaction: prisma.$transaction,
  }

  const setting = prisma.setting as unknown as Record<string, unknown>
  const automationJob = prisma.automationJob as unknown as Record<string, unknown>
  const systemLog = prisma.systemLog as unknown as Record<string, unknown>

  setting.findUnique = async (args: { where: { key: string } }) => database.settings.get(args.where.key) ?? null
  setting.create = async (args: { data: StoredSetting }) => {
    if (database.failWrites) throw Object.assign(new Error('write refused'), { code: 'P1001' })
    database.persistCalls += 1
    database.settings.set(args.data.key, { ...args.data })
    return args.data
  }
  setting.upsert = async (args: { where: { key: string }; update: Partial<StoredSetting>; create: StoredSetting }) => {
    if (database.failWrites) throw Object.assign(new Error('write refused'), { code: 'P1001' })
    database.persistCalls += 1
    const existing = database.settings.get(args.where.key)
    const next = existing ? { ...existing, ...args.update } : { ...args.create }
    database.settings.set(args.where.key, next as StoredSetting)
    return next
  }
  automationJob.updateMany = async (args: { data: { isEnabled: boolean } }) => {
    if (database.failWrites) throw Object.assign(new Error('write refused'), { code: 'P1001' })
    database.jobFlags.push(args.data.isEnabled)
    return { count: 1 }
  }
  systemLog.create = async (args: { data: AuditRow }) => {
    if (database.failWrites) throw Object.assign(new Error('write refused'), { code: 'P1001' })
    database.audits.push(args.data)
    return args.data
  }
  ;(prisma as unknown as Record<string, unknown>).$transaction = async (arg: unknown) => {
    if (typeof arg === 'function') return (arg as (client: unknown) => Promise<unknown>)(prisma)
    return Promise.all(arg as Array<Promise<unknown>>)
  }

  return () => {
    setting.findUnique = original.findUnique
    setting.upsert = original.upsert
    setting.create = original.create
    automationJob.updateMany = original.updateMany
    systemLog.create = original.systemLogCreate
    ;(prisma as unknown as Record<string, unknown>).$transaction = original.transaction
  }
}

test.afterEach(() => {
  setAutomationSwitchReader(null)
})

test('turning a switch off persists the value, audits what it replaced and applies it here', async () => {
  const database = createFakeDatabase([
    { key: AUTOMATION_SWITCHES.pushNotifications.settingKey, value: 'true' },
    { key: AUTOMATION_SWITCHES.matchCreation.settingKey, value: 'true' },
  ])
  const restore = installFakeDatabase(database)
  try {
    const result = await setAutomationSwitch('pushNotifications', false, { actorId: 'admin-1', actorName: 'Admin', requestId: 'req-1' })

    assert.equal(result.applied, true)
    assert.equal(result.previous, true, 'the previous value is read before the write')
    assert.equal(database.settings.get(AUTOMATION_SWITCHES.pushNotifications.settingKey)?.value, 'false')
    assert.equal(database.persistCalls, 1, 'one settings write for one switch flip')
    assert.equal(await confirmAutomationSwitch('pushNotifications'), false, 'the running process enforces the new value')

    const audit = database.audits.at(-1)
    assert.ok(audit, 'the change is audited')
    assert.equal(audit.meta?.kind, 'automation-switch')
    assert.equal(audit.meta?.switchKey, 'pushNotifications')
    assert.equal(audit.meta?.previousValue, true)
    assert.equal(audit.meta?.requestedValue, false)
    assert.equal(audit.meta?.persisted, true)
    assert.equal(audit.meta?.actorId, 'admin-1')
    assert.equal(audit.meta?.requestId, 'req-1')
  } finally {
    restore()
  }
})

test('the two switches stay independent when one of them is written', async () => {
  const database = createFakeDatabase([
    { key: AUTOMATION_SWITCHES.pushNotifications.settingKey, value: 'true' },
    { key: AUTOMATION_SWITCHES.matchCreation.settingKey, value: 'false' },
  ])
  const restore = installFakeDatabase(database)
  try {
    await setAutomationSwitch('pushNotifications', false, { actorId: 'admin-1' })

    assert.equal(database.settings.get(AUTOMATION_SWITCHES.matchCreation.settingKey)?.value, 'false', 'the other switch was not touched')
    assert.equal(database.persistCalls, 1)
    assert.equal(database.jobFlags.length, 0, 'only the match creation switch reflects into the automation job flag')

    await setAutomationSwitch('matchCreation', true, { actorId: 'admin-1' })
    assert.deepEqual(database.jobFlags, [true])
    assert.equal(database.settings.get(AUTOMATION_SWITCHES.matchCreation.settingKey)?.value, 'true')
    assert.equal(database.settings.get(AUTOMATION_SWITCHES.pushNotifications.settingKey)?.value, 'false')
  } finally {
    restore()
  }
})

test('repeating the same transition is idempotent', async () => {
  const database = createFakeDatabase([{ key: AUTOMATION_SWITCHES.pushNotifications.settingKey, value: 'true' }])
  const restore = installFakeDatabase(database)
  try {
    await setAutomationSwitch('pushNotifications', true, { actorId: 'admin-1' })
    await setAutomationSwitch('pushNotifications', true, { actorId: 'admin-1' })

    assert.equal(database.settings.get(AUTOMATION_SWITCHES.pushNotifications.settingKey)?.value, 'true')
    assert.equal(await confirmAutomationSwitch('pushNotifications'), true)
    // One audit row per request is correct: each request is a real administrative action, even when the
    // value it writes is the one already stored.
    assert.equal(database.audits.length, 2)
  } finally {
    restore()
  }
})

test('a write that fails changes nothing and does not apply locally', async () => {
  const database = createFakeDatabase([{ key: AUTOMATION_SWITCHES.pushNotifications.settingKey, value: 'true' }])
  const restore = installFakeDatabase(database)
  try {
    await setAutomationSwitch('pushNotifications', true, { actorId: 'admin-1' })
    database.failWrites = true

    await assert.rejects(
      setAutomationSwitch('pushNotifications', false, { actorId: 'admin-1' }),
      (error: { statusCode?: number }) => error.statusCode === 503,
    )

    assert.equal(database.settings.get(AUTOMATION_SWITCHES.pushNotifications.settingKey)?.value, 'true')
    assert.equal(await confirmAutomationSwitch('pushNotifications'), true, 'the last confirmed value is still enforced')
  } finally {
    restore()
  }
})

test('startup creates a missing row with the value the automation already had', async () => {
  const database = createFakeDatabase()
  const restore = installFakeDatabase(database)
  try {
    await initializeAutomationSwitches()

    for (const definition of Object.values(AUTOMATION_SWITCHES)) {
      assert.equal(database.settings.get(definition.settingKey)?.value, 'true', `${definition.settingKey} must default to the behaviour that was already running`)
    }
    // Nothing is enabled by assumption: the created rows are read back and confirmed.
    assert.equal(await confirmAutomationSwitch('matchCreation'), true)
    assert.equal(getAutomationSwitchStatus('matchCreation').degraded, false)
  } finally {
    restore()
  }
})

test('startup keeps an existing value, including an existing OFF', async () => {
  const database = createFakeDatabase([{ key: AUTOMATION_SWITCHES.pushNotifications.settingKey, value: 'false' }])
  const restore = installFakeDatabase(database)
  try {
    await initializeAutomationSwitches()

    assert.equal(database.settings.get(AUTOMATION_SWITCHES.pushNotifications.settingKey)?.value, 'false', 'a deployment must not re-enable what an administrator turned off')
    assert.equal(await confirmAutomationSwitch('pushNotifications'), false)
    assert.equal(database.settings.get(AUTOMATION_SWITCHES.matchCreation.settingKey)?.value, 'true')
  } finally {
    restore()
  }
})
