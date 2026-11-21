import { useEffect, useRef, useState } from 'react'
import { supabase } from './lib/supabase'

export function TripPhoto({ id, upload = false, photoAvailable = false }: { id: string; upload?: boolean; photoAvailable?: boolean }) {
  const [exists, setExists] = useState(photoAvailable)
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [needsNotify, setNeedsNotify] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const path = `${id}/photo.jpg`
  useEffect(() => {
    let active = true
    const load = async () => {
      if (!supabase) { setReady(true); return }
      const result = await supabase.storage.from('trip-photos').list(id, { limit: 1, search: 'photo.jpg' })
      if (!active) return
      if (result.error) { setError('사진 정보를 불러오지 못했습니다.'); return }
      setExists(result.data.some(f => f.name === 'photo.jpg')); setReady(true)
    }
    void load()
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void load() }, 20000)
    return () => { active = false; window.clearInterval(timer) }
  }, [id, photoAvailable])
  async function notifyHospital() {
    if (!supabase) return false
    const response = await supabase.rpc('record_trip_photo', { p_id: id })
    setNeedsNotify(!!response.error)
    if (response.error) { setError('사진은 저장됐지만 병원 알림 반영에 실패했습니다. 알림 다시 보내기를 눌러 주세요.'); return false }
    setError(''); setNotice('사진을 저장하고 병원 알림에 반영했습니다.'); return true
  }
  async function save(file?: File) {
    if (!file || !supabase || busy) return
    setBusy(true); setError(''); setNotice('')
    try {
      if (!['image/jpeg','image/png','image/webp'].includes(file.type) || file.size > 20 * 1024 * 1024) throw new Error('20MB 이하 JPG·PNG·WebP 사진을 선택해 주세요.')
      // Re-encode pixels to JPEG, strip EXIF/location metadata, limit upload size.
      const bitmap = await createImageBitmap(file)
      const scale = Math.min(1, 2400 / Math.max(bitmap.width, bitmap.height))
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale))
      const ctx = canvas.getContext('2d')
      if (!ctx) { bitmap.close(); throw new Error('사진 처리에 실패했습니다.') }
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height); bitmap.close()
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error('사진 변환에 실패했습니다.')), 'image/jpeg', .88))
      if (blob.size > 10 * 1024 * 1024) throw new Error('사진 용량이 큽니다. 더 작은 사진을 선택해 주세요.')
      const result = await supabase.storage.from('trip-photos').upload(path, blob, { contentType: 'image/jpeg', upsert: true, cacheControl: '0' })
      if (result.error) throw new Error('사진 업로드에 실패했습니다. 배정된 기사 계정과 연결을 확인해 주세요.')
      setExists(true); setReady(true); await notifyHospital()
    } catch (e) { setError(e instanceof Error ? e.message : '사진 처리에 실패했습니다.') }
    finally { setBusy(false); if (input.current) input.current.value = '' }
  }
  async function download() {
    if (!supabase || busy) return
    setBusy(true); setError('')
    try {
      const result = await supabase.storage.from('trip-photos').download(path)
      if (result.error) throw result.error
      const url = URL.createObjectURL(result.data)
      const link = document.createElement('a'); link.href = url; link.download = `이송사진_${id.slice(0, 8)}.jpg`; link.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 60000)
    } catch { setError('다운로드에 실패했습니다. 권한과 연결을 확인해 주세요.') }
    finally { setBusy(false) }
  }
  return <div className={`trip-photo ${exists ? 'photo-attached' : 'photo-empty'}`}>
    {exists ? <><span className="photo-presence">사진 있음</span><button type="button" className="subtle-button" disabled={busy} onClick={() => void download()}>사진 다운로드</button></> : <span>{ready ? '사진 없음' : '확인 중…'}</span>}
    {needsNotify && <button type="button" disabled={busy} onClick={async()=>{setBusy(true);try{await notifyHospital()}finally{setBusy(false)}}}>병원 알림 다시 보내기</button>}
    {upload && <><input ref={input} type="file" accept="image/jpeg,image/png,image/webp" aria-label="운행 사진 1장 선택" disabled={busy} onChange={e => void save(e.target.files?.[0])} /><small>{busy ? '처리 중…' : '사진 1장 · 다시 올리면 기존 사진이 교체됩니다.'}</small></>}
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
  </div>
}
