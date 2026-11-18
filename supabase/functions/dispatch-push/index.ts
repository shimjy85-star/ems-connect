import { createClient } from 'npm:@supabase/supabase-js@2'
import webpush from 'npm:web-push@3.6.7'

const headers = { 'Access-Control-Allow-Origin': 'https://k119.vercel.app', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Content-Type': 'application/json' }
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers })
const allowedEndpoint = (value: unknown) => {
  if (typeof value !== 'string' || value.length > 4096) return false
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password && !url.port &&
      (url.hostname === 'fcm.googleapis.com' || url.hostname === 'updates.push.services.mozilla.com' || url.hostname.endsWith('.push.apple.com'))
  } catch { return false }
}

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers })
  if (request.method !== 'POST') return reply({ error: 'Method not allowed' }, 405)
  try {
    const url = Deno.env.get('SUPABASE_URL')!
    const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const jwt = request.headers.get('Authorization')?.replace(/^Bearer /i, '') ?? ''
    const workerSecret = Deno.env.get('PUSH_WORKER_SECRET')
    const isWorker = Boolean(workerSecret && jwt === workerSecret)
    const body = await request.json()
    let userId: string | undefined
    if (!isWorker) {
      const { data, error } = await admin.auth.getUser(jwt)
      if (error || !data.user) return reply({ error: 'Unauthorized' }, 401)
      userId = data.user.id
      const { data: profile } = await admin.from('profiles').select('role,is_active').eq('id', userId).single()
      if (profile?.role !== 'admin' || !profile.is_active) return reply({ error: 'Forbidden' }, 403)
    }
    const publicKey = Deno.env.get('VAPID_PUBLIC_KEY')
    const privateKey = Deno.env.get('VAPID_PRIVATE_KEY')
    if (!publicKey || !privateKey) return reply({ error: 'Push configuration missing' }, 503)
    if (body.action === 'config') return reply({ publicKey })
    if (body.action === 'subscribe' && userId) {
      const s = body.subscription
      if (!allowedEndpoint(s?.endpoint) || !/^[A-Za-z0-9_-]{80,100}$/.test(s?.keys?.p256dh ?? '') || !/^[A-Za-z0-9_-]{20,30}$/.test(s?.keys?.auth ?? '')) return reply({ error: 'Invalid subscription' }, 400)
      const { data: driver } = await admin.from('drivers').select('id').eq('id', userId).eq('is_active', true).maybeSingle()
      if (!driver) return reply({ error: 'Driver account required' }, 403)
      const { error } = await admin.from('push_subscriptions').upsert({ endpoint: s.endpoint, user_id: userId, p256dh: s.keys.p256dh, auth: s.keys.auth, updated_at: new Date().toISOString() })
      if (error) throw error
      return reply({ saved: true })
    }
    if (body.action !== 'deliver' || !isWorker) return reply({ error: 'Forbidden' }, 403)
    webpush.setVapidDetails('https://k119.vercel.app', publicKey, privateKey)
    const { data: queue, error } = await admin.from('dispatch_push_queue').select('*').is('sent_at', null).order('created_at').limit(50)
    if (error) throw error
    let sent = 0
    for (const job of queue ?? []) {
      const { data: reservation } = await admin.from('reservations').select('status,driver_id').eq('id', job.reservation_id).single()
      if (reservation?.status !== 'confirmed' || reservation.driver_id !== job.driver_id) continue
      const { data: subscriptions, error: queryError } = await admin.from('push_subscriptions').select('*').eq('user_id', job.driver_id)
      if (queryError) throw queryError
      if (!subscriptions?.length) continue
      let successful = true
      for (const s of subscriptions) {
        if (!allowedEndpoint(s.endpoint)) { successful = false; continue }
        try {
          await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify({ title: '새 9090 배차가 도착했습니다', tag: job.reservation_id }), { TTL: 300, timeout: 10000 })
          sent++
        } catch (err) {
          if ([404,410].includes(err.statusCode)) await admin.from('push_subscriptions').delete().eq('endpoint', s.endpoint)
          else successful = false
        }
      }
      if (successful) await admin.from('dispatch_push_queue').update({ sent_at: new Date().toISOString() }).eq('reservation_id', job.reservation_id).eq('created_at', job.created_at)
    }
    return reply({ sent })
  } catch { return reply({ error: 'Push processing failed' }, 500) }
})
