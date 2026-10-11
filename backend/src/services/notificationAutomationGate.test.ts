import assert from 'node:assert/strict'
import { test } from 'node:test'

process.env.JWT_SECRET ??= 'notification-gate-test-secret'
process.env.JWT_REFRESH_SECRET ??= 'notification-gate-test-refresh-secret'
// These tests prove that the disabled path performs *no* persistence at all: an unreachable database makes
// any query fail immediately, and an unset Redis address keeps the BullMQ queue out of the picture.
delete process.env.REDIS_URL
delete process.env.REDIS_URL_PRIMARY
process.env.DATABASE_URL = 'postgresql://gate:none@127.0.0.1:1/none'

const { setAutomationSwitchReader } = await import('../core/automationSwitches.js')
const { dispatchUserNotification } = await import('../core/notificationQueue.js')
const {
  createAdminBroadcastNotification,
  notifyHighlightAdded,
  notifyMatchReminder,
  notifyMatchStarted,
} = await import('./notification.service.js')

const MATCH = {
  id: 'match-1',
  title: 'Home vs Away',
  kickoffAt: new Date(Date.now() + 30 * 60 * 1000),
  tournamentName: 'League',
  homeTeamName: 'Home',
  awayTeamName: 'Away',
  homeTeamLogo: null,
  awayTeamLogo: null,
}

/** Forces the push master switch to a known value without a database. */
function setPushAutomation(enabled: boolean) {
  setAutomationSwitchReader({ read: async () => String(enabled) })
}

test.afterEach(() => {
  setAutomationSwitchReader(null)
})

test('with push automation off the match pushes produce nothing and touch no database', async () => {
  setPushAutomation(false)

  assert.equal(await notifyMatchStarted(MATCH), 0)
  assert.equal(await notifyMatchReminder(MATCH), 0)
  assert.equal(await notifyHighlightAdded({ id: 'highlight-1', title: 'Big win' }), 0)
})

test('with push automation off an already queued push job cannot deliver', async () => {
  setPushAutomation(false)

  const result = await dispatchUserNotification({
    userId: 'user-1',
    title: 'Kickoff',
    body: 'Your match is starting',
    channel: 'PUSH',
  })

  assert.deepEqual(result, { created: false, pushSuppressed: true })
})

test('the delivery gate blocks push only: the in-app path still runs', async () => {
  setPushAutomation(false)

  // Reaching for the database proves the in-app branch was not suppressed by the push switch. It rejects
  // because this test has no database, which is exactly the point.
  await assert.rejects(dispatchUserNotification({
    userId: 'user-1',
    title: 'News',
    body: 'In-app only',
    channel: 'IN_APP',
  }))
})

test('a manual push-only campaign is refused while the switch is off, and says so', async () => {
  setPushAutomation(false)

  const result = await createAdminBroadcastNotification({
    title: 'Promo',
    body: 'Watch tonight',
    channel: 'PUSH',
    targetAudience: 'ALL',
  })

  assert.deepEqual(result, { recipientCount: 0, pushBlocked: true })
})

test('a mixed campaign is not refused: it keeps its in-app half', async () => {
  setPushAutomation(false)

  // The push half is dropped before any recipient is resolved, so the first thing that touches the
  // database is the in-app fan-out itself.
  await assert.rejects(createAdminBroadcastNotification({
    title: 'Promo',
    body: 'Watch tonight',
    channel: 'BOTH',
    targetAudience: 'ALL',
  }))
})

test('with push automation on the same producers proceed to real work', async () => {
  setPushAutomation(true)

  // Nothing is blocked, so the fan-out reaches the database (which this test does not have).
  await assert.rejects(notifyMatchReminder(MATCH))
  await assert.rejects(createAdminBroadcastNotification({
    title: 'Promo',
    body: 'Watch tonight',
    channel: 'PUSH',
    targetAudience: 'ALL',
  }))
})

test('a failed switch read fails closed for producers', async () => {
  setAutomationSwitchReader({ read: async () => { throw Object.assign(new Error('down'), { code: 'P1001' }) } })

  assert.equal(await notifyMatchStarted(MATCH), 0)
  assert.deepEqual(
    await dispatchUserNotification({ userId: 'user-1', title: 'Kickoff', body: 'Starting', channel: 'PUSH' }),
    { created: false, pushSuppressed: true },
  )
})
