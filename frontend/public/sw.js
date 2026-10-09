const CACHE_NAME = 'sportzonebd-shell-__APP_VERSION__'
const CACHE_PREFIX = 'sportzonebd-shell-'
const SHELL_URL = '/index.html'

const isCacheableStaticRequest = (request, url) => {
  if (request.method !== 'GET' || url.origin !== self.location.origin) return false
  if (url.pathname.startsWith('/api/') || url.pathname === '/sw.js') return false
  if (/\.(?:m3u8|ts|m4s|mp4|webm|mov)(?:$|\?)/i.test(url.pathname + url.search)) return false
  return ['script', 'style', 'worker', 'font', 'image'].includes(request.destination)
}

const getSafeNotificationUrl = (value) => {
  try {
    const url = new URL(typeof value === 'string' ? value : '/notifications', self.location.origin)
    if (url.origin !== self.location.origin) return '/notifications'
    return `${url.pathname}${url.search}${url.hash}`
  } catch {
    return '/notifications'
  }
}

const BRAND_ICON = '/android-chrome-192x192.png'
const MAX_IMAGE_URL_LENGTH = 500
const MAX_COMPETITION_LENGTH = 60

// Team crests are only ever loaded from https, and only up to a sane length, so a payload can never
// point the notification at an unexpected or oversized asset.
const getSafeImageUrl = (value) => {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > MAX_IMAGE_URL_LENGTH) return null
  try {
    const url = new URL(trimmed)
    return url.protocol === 'https:' ? url.href : null
  } catch {
    return null
  }
}

// The kickoff is stored in UTC and rendered here, so the viewer sees their own local time.
const describeKickoff = (data) => {
  if (data.kind !== 'reminder' || typeof data.kickoffAt !== 'string') return ''
  const kickoff = new Date(data.kickoffAt)
  if (Number.isNaN(kickoff.getTime())) return ''
  return `Kick-off ${kickoff.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · `
}

const describeCompetition = (data) => {
  if (typeof data.competition !== 'string') return ''
  const competition = data.competition.replace(/\s+/g, ' ').trim().slice(0, MAX_COMPETITION_LENGTH)
  return competition ? `${competition} · ` : ''
}

// Match alerts are enriched with the real competition and the local kickoff time. Everything else
// (highlight and admin broadcasts) keeps its plain title and body.
const describeMatchAlert = (data) => {
  if (!data.kind) {
    return { title: data.title || 'SportZoneBD', body: data.body ?? '' }
  }
  return {
    title: data.title ? `SportZoneBD · ${data.title}` : 'SportZoneBD',
    body: `${describeKickoff(data)}${describeCompetition(data)}${data.body ?? ''}`,
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.add(SHELL_URL)),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => Promise.all(
      cacheNames
        .filter((cacheName) => cacheName.startsWith(CACHE_PREFIX) && cacheName !== CACHE_NAME)
        .map((cacheName) => caches.delete(cacheName)),
    )).then(() => self.clients.claim()),
  )
})

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting()
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  const url = new URL(request.url)

  if (request.mode === 'navigate' && url.origin === self.location.origin) {
    event.respondWith(
      fetch(request).then((response) => {
        const responseCopy = response.clone()
        void caches.open(CACHE_NAME).then((cache) => cache.put(SHELL_URL, responseCopy))
        return response
      }).catch(async () => {
        const cachedShell = await caches.match(SHELL_URL)
        return cachedShell ?? Response.error()
      }),
    )
    return
  }

  if (!isCacheableStaticRequest(request, url)) return

  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      const refresh = fetch(request).then((response) => {
        if (response.ok) {
          const responseCopy = response.clone()
          void caches.open(CACHE_NAME).then((cache) => cache.put(request, responseCopy))
        }
        return response
      })
      return cachedResponse ?? refresh
    }),
  )
})

self.addEventListener('push', (event) => {
  if (!event.data) return

  const data = event.data.json()
  const awayCrest = getSafeImageUrl(data.image)
  const { title, body } = describeMatchAlert(data)
  const options = {
    body,
    // The home crest is the notification icon; the brand asset takes over when there is no crest.
    icon: getSafeImageUrl(data.icon) || BRAND_ICON,
    // The away crest rides in the expanded image slot, so both teams are shown where the platform
    // renders it. If it cannot be loaded the notification still appears, just without the image.
    ...(awayCrest ? { image: awayCrest } : {}),
    badge: '/favicon.ico',
    data: {
      url: getSafeNotificationUrl(data.link),
      notificationId: data.notificationId,
    },
    tag: data.notificationId || 'sportzonebd-notification',
    requireInteraction: true,
  }

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      const siteIsFocused = clientList.some((client) => client.visibilityState === 'visible' || client.focused)
      return siteIsFocused ? undefined : self.registration.showNotification(title, options)
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()

  const targetUrl = event.notification.data?.url || '/notifications'

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      const focused = clientList.find((client) => client.focused)
        || clientList.find((client) => client.visibilityState === 'visible')

      if (focused) {
        return focused.focus().then(() => focused.postMessage({ type: 'OPEN_NOTIFICATION', url: targetUrl }))
      }

      return clients.openWindow(targetUrl)
    }),
  )
})
