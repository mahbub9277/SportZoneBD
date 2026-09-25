const CACHE_NAME = 'sportzonebd-shell-v2'
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
  const options = {
    body: data.body,
    icon: data.icon || '/favicon.ico',
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
      return siteIsFocused ? undefined : self.registration.showNotification(data.title || 'SportZoneBD', options)
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
