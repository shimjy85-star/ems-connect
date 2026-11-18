const VERSION = 'ems-connect-9090-v1'
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()))
self.addEventListener('push', event => {
  let data = {}
  try { data = event.data ? event.data.json() : {} } catch { /* Use the generic notification. */ }
  event.waitUntil(self.registration.showNotification(data.title || 'EMS CONNECT 새 배차', {
    body: '앱을 열어 9090 운행 정보를 확인해 주세요.',
    icon: '/ems-connect.svg', badge: '/ems-connect.svg', tag: data.tag || VERSION,
    data: { url: '/#my-trips' },
  }))
})
self.addEventListener('notificationclick', event => {
  event.notification.close()
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
    const existing = clients[0]
    return existing ? existing.navigate('/#my-trips').then(client => client?.focus()) : self.clients.openWindow('/#my-trips')
  }))
})
