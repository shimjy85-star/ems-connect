const VERSION = 'ems-connect-9090-v1'
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()))
self.addEventListener('push', event => {
  let data = {}
  try { data = event.data ? event.data.json() : {} } catch { /* Use the generic notification. */ }
  event.waitUntil(self.registration.showNotification(data.title || 'EMS CONNECT 새 배차', {
    body: '앱을 열어 금일운행과 명일운행계획을 확인해 주세요.',
    icon: '/icon-192.png', tag: data.tag || VERSION,
    data: { url: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(data.tag || '') ? `/#driver-trip/${data.tag}` : '/#my-trips' },
  }))
})
self.addEventListener('notificationclick', event => {
  event.notification.close()
  const path = event.notification.data?.url || '/#my-trips'
  const target = /^\/#driver-trip\/[0-9a-f-]{36}$/i.test(path) ? path : '/#my-trips'
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
    const existing = clients.find(client => new URL(client.url).origin === self.location.origin)
    if (existing) {
      return existing.navigate(target).then(client => client?.focus())
    }
    return self.clients.openWindow(target)
  }))
})
