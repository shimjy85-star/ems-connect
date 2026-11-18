import { supabase } from './supabase'

export async function connectPush() {
  if (!supabase) throw new Error('로그인 연결을 확인해 주세요.')
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || typeof Notification === 'undefined') {
    throw new Error('이 브라우저는 푸시를 지원하지 않습니다. 휴대폰 홈 화면에 설치한 앱에서 다시 시도해 주세요.')
  }
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') throw new Error('브라우저 설정에서 알림을 허용해 주세요.')
  const config = await supabase.functions.invoke('dispatch-push', { body: { action: 'config' } })
  if (config.error || !config.data?.publicKey) throw new Error('푸시 서버 연결이 아직 준비되지 않았습니다.')
  const key = config.data.publicKey as string
  const bytes = Uint8Array.from(atob(key.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - key.length % 4) % 4)), c => c.charCodeAt(0))
  const registration = await navigator.serviceWorker.register('/sw.js')
  await navigator.serviceWorker.ready
  let subscription = await registration.pushManager.getSubscription()
  if (subscription && new Uint8Array(subscription.options.applicationServerKey ?? new ArrayBuffer(0)).join() !== bytes.join()) {
    await subscription.unsubscribe(); subscription = null
  }
  subscription ??= await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: bytes })
  const result = await supabase.functions.invoke('dispatch-push', { body: { action: 'subscribe', subscription: subscription.toJSON() } })
  if (result.error || !result.data?.saved) throw new Error('기기 등록에 실패했습니다. 다시 연결해 주세요.')
}
