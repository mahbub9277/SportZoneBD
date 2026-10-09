import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * Runs the real `public/sw.js` in a stubbed worker scope so the push presentation stays covered
 * without a browser. The service worker is a classic script, so it is evaluated as one.
 */
const swSource = readFileSync(fileURLToPath(new URL('../../../public/sw.js', import.meta.url)), 'utf8')

interface ShownNotification {
  title: string
  options: {
    body?: string
    icon?: string
    image?: string
    badge?: string
    tag?: string
    requireInteraction?: boolean
    data?: { url?: string; notificationId?: string }
  }
}

interface OpenWindowCall { url: string }
interface PostMessageCall { url: string }

const ORIGIN = 'https://sportzonebd.test'
// The worker passes a relative path; the browser resolves it against the worker's own origin
// (verified in Chrome: http://localhost:4179/android-chrome-192x192.png).
const BRAND_ICON = '/android-chrome-192x192.png'

function loadServiceWorker(options: { focusedClient?: boolean } = {}) {
  const listeners = new Map<string, (event: never) => void>()
  const shown: ShownNotification[] = []
  const opened: OpenWindowCall[] = []
  const posted: PostMessageCall[] = []
  const windowClient = {
    focused: true,
    visibilityState: 'visible',
    url: `${ORIGIN}/`,
    focus: () => Promise.resolve(),
    postMessage: (message: { type: string; url: string }) => {
      if (message.type === 'OPEN_NOTIFICATION') posted.push({ url: message.url })
    },
  }
  const matchAll = () => Promise.resolve(options.focusedClient ? [windowClient] : [])

  const scope = {
    location: { origin: ORIGIN },
    addEventListener: (type: string, handler: (event: never) => void) => { listeners.set(type, handler) },
    registration: {
      showNotification: (title: string, notificationOptions: ShownNotification['options']) => {
        shown.push({ title, options: notificationOptions })
        return Promise.resolve()
      },
    },
    clients: { matchAll },
    skipWaiting: () => Promise.resolve(),
  }
  const caches = {
    open: () => Promise.resolve({ add: () => Promise.resolve(), put: () => Promise.resolve() }),
    keys: () => Promise.resolve([]),
    match: () => Promise.resolve(undefined),
    delete: () => Promise.resolve(true),
  }
  const clients = {
    ...windowClient,
    matchAll,
    openWindow: (url: string) => { opened.push({ url }); return Promise.resolve() },
  }

  const evaluate = new Function('self', 'caches', 'clients', swSource)
  evaluate(scope, caches, clients)

  const deliver = async (payload: unknown) => {
    shown.length = 0
    posted.length = 0
    opened.length = 0
    const handler = listeners.get('push')
    assert.ok(handler, 'the push listener is registered')
    await handler({ data: { json: () => payload }, waitUntil: (promise: Promise<unknown>) => promise } as never)
    return shown
  }

  const click = async (url: string) => {
    posted.length = 0
    opened.length = 0
    const handler = listeners.get('notificationclick')
    assert.ok(handler, 'the notificationclick listener is registered')
    await handler({
      notification: { close: () => undefined, data: { url } },
      waitUntil: (promise: Promise<unknown>) => promise,
    } as never)
    return { posted, opened }
  }

  return { deliver, click, listeners }
}

const reminderPayload = {
  title: 'Match Starting Soon',
  body: 'Santos FC vs CR Flamengo starts soon! Tap to watch live.',
  type: 'match-reminder',
  link: '/matches/c8a56188-acba-46f4-9b77-0d1b0cbcb519?k=1791498600000',
  notificationId: '11111111-2222-4333-8444-555555555555',
  icon: 'https://crests.football-data.org/6685.png',
  image: 'https://crests.football-data.org/1783.png',
  matchId: 'c8a56188-acba-46f4-9b77-0d1b0cbcb519',
  kind: 'reminder',
  kickoffAt: '2026-10-08T22:30:00.000Z',
  competition: 'Campeonato Brasileiro Série A',
}

const localKickoff = new Date(reminderPayload.kickoffAt)
  .toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

test('a match reminder shows both real crests, the real competition and the branded status', async () => {
  const [shown] = await loadServiceWorker().deliver(reminderPayload)

  assert.equal(shown.title, 'SportZoneBD · Match Starting Soon')
  assert.equal(
    shown.options.body,
    `Kick-off ${localKickoff} · Campeonato Brasileiro Série A · Santos FC vs CR Flamengo starts soon! Tap to watch live.`,
  )
  assert.equal(shown.options.icon, reminderPayload.icon, 'the home crest is the icon')
  assert.equal(shown.options.image, reminderPayload.image, 'the away crest is the expanded image')
  assert.equal(shown.options.badge, '/favicon.ico')
  assert.equal(shown.options.tag, reminderPayload.notificationId)
  assert.equal(shown.options.requireInteraction, true)
  assert.equal(shown.options.data?.url, reminderPayload.link, 'the click destination is the match page')
})

test('a kickoff alert reports the real status without a kickoff time', async () => {
  const [shown] = await loadServiceWorker().deliver({
    ...reminderPayload,
    title: 'Match Started',
    body: 'Santos FC vs CR Flamengo has started! Tap to watch live.',
    kind: 'started',
    kickoffAt: undefined,
    link: `/matches/${reminderPayload.matchId}`,
  })

  assert.equal(shown.title, 'SportZoneBD · Match Started')
  assert.equal(shown.options.body, 'Campeonato Brasileiro Série A · Santos FC vs CR Flamengo has started! Tap to watch live.')
  assert.equal(shown.options.icon, reminderPayload.icon)
  assert.equal(shown.options.image, reminderPayload.image)
  assert.equal(shown.options.data?.url, `/matches/${reminderPayload.matchId}`)
})

test('a missing crest falls back to the SportZoneBD brand instead of an empty icon', async () => {
  const [shown] = await loadServiceWorker().deliver({ ...reminderPayload, icon: undefined, image: null })

  assert.equal(shown.options.icon, BRAND_ICON)
  assert.equal(shown.options.image, undefined, 'one crest is never shown twice')
  assert.ok(shown.options.body?.includes('Campeonato Brasileiro Série A'))
})

test('crest urls that are not https are refused', async () => {
  const [shown] = await loadServiceWorker().deliver({
    ...reminderPayload,
    icon: 'http://insecure.test/home.png',
    image: 'javascript:alert(1)',
  })

  assert.equal(shown.options.icon, BRAND_ICON)
  assert.equal(shown.options.image, undefined)
})

test('an unknown competition is left out of the body', async () => {
  const [shown] = await loadServiceWorker().deliver({ ...reminderPayload, competition: undefined })

  assert.equal(shown.options.body, `Kick-off ${localKickoff} · Santos FC vs CR Flamengo starts soon! Tap to watch live.`)
})

test('the push-only body is preferred when the payload carries real team names', async () => {
  const [shown] = await loadServiceWorker().deliver({
    ...reminderPayload,
    // The shared body can be a hand-written match title; the push-only body always names both teams.
    body: 'Brasileirão night double-header starts soon! Tap to watch live.',
    homeTeamName: 'Santos FC',
    awayTeamName: 'CR Flamengo',
    pushBody: 'Santos FC vs CR Flamengo starts soon! Tap to watch live.',
  })

  assert.equal(
    shown.options.body,
    `Kick-off ${localKickoff} · Campeonato Brasileiro Série A · Santos FC vs CR Flamengo starts soon! Tap to watch live.`,
  )
})

test('a payload without a push-only body keeps the shared text', async () => {
  const [shown] = await loadServiceWorker().deliver({ ...reminderPayload, pushBody: undefined, homeTeamName: null })
  assert.ok(shown.options.body?.endsWith('Santos FC vs CR Flamengo starts soon! Tap to watch live.'))
})

test('a long competition name is capped so the text stays readable', async () => {
  const [shown] = await loadServiceWorker().deliver({ ...reminderPayload, competition: 'x'.repeat(200) })

  assert.ok((shown.options.body ?? '').length < 200)
  assert.ok(shown.options.body?.startsWith(`Kick-off ${localKickoff} · ${'x'.repeat(60)}`))
})

test('non-match broadcasts keep their plain text and are still delivered', async () => {
  const [shown] = await loadServiceWorker().deliver({
    title: 'New Highlight Available',
    body: 'Goals from the derby are now available to watch.',
    type: 'success',
    link: '/notifications',
    notificationId: 'aaaa-highlight',
  })

  assert.equal(shown.title, 'New Highlight Available')
  assert.equal(shown.options.body, 'Goals from the derby are now available to watch.')
  assert.equal(shown.options.icon, BRAND_ICON)
  assert.equal(shown.options.image, undefined)
})

test('a payload without a title still shows the brand', async () => {
  const [shown] = await loadServiceWorker().deliver({ body: 'Something happened', link: '/notifications' })

  assert.equal(shown.title, 'SportZoneBD')
  assert.equal(shown.options.body, 'Something happened')
})

test('nothing is raised while a SportZoneBD window is focused', async () => {
  const shown = await loadServiceWorker({ focusedClient: true }).deliver(reminderPayload)

  assert.equal(shown.length, 0, 'the focused tab already surfaces the alert as a toast')
})

test('clicking a reminder hands the match url to the open tab', async () => {
  const { posted, opened } = await loadServiceWorker({ focusedClient: true }).click(reminderPayload.link)

  assert.deepEqual(posted, [{ url: reminderPayload.link }])
  assert.equal(opened.length, 0)
})

test('clicking with no open tab opens the match page', async () => {
  const { opened } = await loadServiceWorker().click(reminderPayload.link)

  assert.deepEqual(opened, [{ url: reminderPayload.link }])
})
