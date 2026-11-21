import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { koreaDay, tripDayBounds, tripPage } from '../src/lib/tripDates.ts'

assert.equal(koreaDay('2026-11-21T14:59:59.999Z'), '2026-11-21')
assert.equal(koreaDay('2026-11-21T15:00:00Z'), '2026-11-22')
assert.deepEqual(tripDayBounds('2026-11-21'), { start: '2026-11-20T15:00:00.000Z', end: '2026-11-21T15:00:00.000Z' })
assert.equal(tripPage('2026-11-22T01:00Z', 'confirmed', '2026-11-21'), '명일운행계획')
assert.equal(tripPage('2026-11-22T01:00Z', 'confirmed', '2026-11-22'), '금일운행')
assert.equal(tripPage('2027-01-01T01:00Z', 'confirmed', '2026-12-31'), '명일운행계획')
assert.equal(tripPage('2028-03-01T01:00Z', 'confirmed', '2028-02-29'), '명일운행계획')
assert.equal(tripPage('2026-11-22T01:00Z', 'completed', '2026-11-22'), '운행기록조회')

const events = {}
let notification, destination, pending, focused = false, existing = true
const client = { url: 'https://k119.vercel.app/boss.html', navigate: async url => { destination = url; return client }, focus: async () => { focused = true } }
const self = {
  location: { origin: 'https://k119.vercel.app' },
  addEventListener: (name, callback) => { events[name] = callback },
  registration: { showNotification: async (title, options) => { notification = { title, ...options } } },
  clients: { matchAll: async () => existing ? [client] : [], openWindow: async url => { destination = url } },
}
vm.runInNewContext(readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8'), { self, URL })
const id = '150d6d5b-5cbb-43d2-8d94-88c1b849a321'
events.push({ data: { json: () => ({ title: '새 배차', tag: id }) }, waitUntil: p => { pending = p } })
await pending
assert.equal(notification.data.url, `/#driver-trip/${id}`)
events.notificationclick({ notification: { ...notification, close() {} }, waitUntil: p => { pending = p } })
await pending
assert.equal(destination, `/#driver-trip/${id}`)
assert.equal(focused, true)
existing = false
events.notificationclick({ notification: { data: { url: 'https://example.com/untrusted' }, close() {} }, waitUntil: p => { pending = p } })
await pending
assert.equal(destination, '/#my-trips')
events.push({ data: { json: () => { throw new Error('legacy payload') } }, waitUntil: p => { pending = p } })
await pending
assert.equal(notification.data.url, '/#my-trips')
console.log('Driver plan checks passed: KST midnight/date boundaries, notification routing, legacy payload and safe URL fallback.')
