self.addEventListener('install', (event) => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('push', (event) => {
  if (!event.data) return

  const data = event.data.json()
  const options = {
    body: data.body,
    icon: data.icon || '/favicon.ico',
    badge: '/favicon.ico',
    data: {
      url: data.link || '/notifications',
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

      if (focused) {
        return focused.postMessage({ type: 'OPEN_NOTIFICATION', url: targetUrl })
      }

      return clients.openWindow(targetUrl)
    }),
  )
})
