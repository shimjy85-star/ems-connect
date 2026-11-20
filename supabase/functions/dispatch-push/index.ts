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
    const workerCheck = /^[a-f0-9]{64}$/.test(jwt)
      ? await admin.rpc('verify_dispatch_worker', { candidate: jwt }) : { data: false }
    const isWorker = workerCheck.data === true
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
    if (body.action === 'config' && userId) return reply({ publicKey })
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
    const { data: queue, error } = await admin.rpc('claim_dispatch_push')
    if (error) throw error
    let sent = 0
    const deadline = Date.now() + 45000
    for (const job of queue ?? []) {
      if (Date.now() >= deadline) break
      const finish = async (values: Record<string, unknown>) => {
        const { error: updateError } = await admin.from('dispatch_push_queue').update(values).eq('reservation_id', job.reservation_id).eq('created_at', job.created_at)
        if (updateError) throw updateError
      }
      const { data: reservation, error: reservationError } = await admin.from('reservations').select('status,driver_id').eq('id', job.reservation_id).maybeSingle()
      if (reservationError) throw reservationError
      const { data: driver, error: driverError } = await admin.from('drivers').select('is_active').eq('id', job.driver_id).maybeSingle()
      const { data: profile, error: profileError } = await admin.from('profiles').select('is_active,role').eq('id', job.driver_id).maybeSingle()
      if (driverError || profileError) throw driverError || profileError
      const validReservation = job.event_kind === 'cancel'
        ? reservation?.status === 'cancelled'
        : reservation?.status === 'confirmed' && reservation.driver_id === job.driver_id
      if (!validReservation || !driver?.is_active || !profile?.is_active || profile.role !== 'admin') {
        await finish({ sent_at: new Date().toISOString() }); continue
      }
      const { data: subscriptions, error: queryError } = await admin.from('push_subscriptions').select('*').eq('user_id', job.driver_id)
      if (queryError) throw queryError
      if (!subscriptions?.length) continue
      let successful = true
      const delivered = new Set<string>(job.delivered_endpoints ?? [])
      for (const s of subscriptions) {
        if (delivered.has(s.endpoint)) continue
        if (Date.now() >= deadline) { successful = false; break }
        if (!allowedEndpoint(s.endpoint)) { successful = false; continue }
        try {
          const title = job.event_kind === 'cancel' ? '9090 배차가 취소되었습니다' : job.event_kind === 'change' ? '9090 배차 정보가 변경되었습니다' : '새 9090 배차가 도착했습니다'
          await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify({ title, tag: job.reservation_id }), { TTL: 300, timeout: 5000 })
          sent++
          delivered.add(s.endpoint)
          await finish({ delivered_endpoints: [...delivered] })
        } catch (err) {
          const statusCode = (err as { statusCode?: number }).statusCode
          if (statusCode && [404,410].includes(statusCode)) await admin.from('push_subscriptions').delete().eq('endpoint', s.endpoint)
          else successful = false
        }
      }
      if (successful) await finish({ sent_at: new Date().toISOString() })
    }
    return reply({ sent })
  } catch { return reply({ error: 'Push processing failed' }, 500) }
})
