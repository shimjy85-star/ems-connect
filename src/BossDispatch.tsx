import { useEffect, useState } from 'react'
import { supabase } from './lib/supabase'
import './BossDispatch.css'

type Row = { id: string; hospital_id: string; departure_address: string; destination_address: string; scheduled_at: string; created_at: string; updated_at: string; requested_note: string | null; status: string; trip_type: string | null; waiting_required: boolean | null; waiting_minutes: number | null }
type Choice = '9090' | 'external_dispatch' | 'cancelled'
type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> }
const choiceLabel = { '9090': '9090 배차', external_dispatch: '타차량 배차', cancelled: '예약 취소' }
const patient = (r: Row) => r.requested_note?.match(/^환자명:\s*(.+)$/m)?.[1]?.trim() || '환자명 확인 필요'
const time = (value: string) => new Date(value).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: 'long', day: 'numeric', weekday: 'short', hour: 'numeric', minute: '2-digit' })

export function BossDispatch({ onSignOut }: { onSignOut: () => void }) {
  const [rows, setRows] = useState<Row[]>([])
  const [hospitals, setHospitals] = useState<Record<string, string>>({})
  const [selected, setSelected] = useState<{ row: Row; choice: Choice } | null>(null)
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [result, setResult] = useState('')
  const [refresh, setRefresh] = useState(0)
  const [lastUpdate, setLastUpdate] = useState('')
  const [now, setNow] = useState(Date.now)
  const [installEvent, setInstallEvent] = useState<InstallEvent | null>(null)
  const [installNotice, setInstallNotice] = useState('')
  useEffect(() => {
    const handle = (e: Event) => { e.preventDefault(); setInstallEvent(e as InstallEvent) }
    window.addEventListener('beforeinstallprompt', handle)
    return () => window.removeEventListener('beforeinstallprompt', handle)
  }, [])
  useEffect(() => {
    const client = supabase
    if (!client) return
    let active = true, fetching = false
    const load = async () => {
      if (fetching || document.visibilityState === 'hidden') return
      fetching = true
      try {
        const hospitalResult = await client.from('hospitals').select('id,name')
        if (hospitalResult.error) throw hospitalResult.error
        const all: Row[] = []
        for (let offset = 0; ; offset += 1000) {
          const response = await client.from('reservations').select('id,hospital_id,departure_address,destination_address,scheduled_at,created_at,updated_at,requested_note,status,trip_type,waiting_required,waiting_minutes')
            .in('status', ['requested', 'approval_pending']).order('scheduled_at').order('id').range(offset, offset + 999)
          if (response.error) throw response.error
          if (!active) return
          all.push(...response.data)
          if (response.data.length < 1000) break
        }
        if (!active) return
        setRows(all); setHospitals(Object.fromEntries((hospitalResult.data ?? []).map(h => [h.id, h.name])))
        setError(''); setNow(Date.now()); setLastUpdate(new Date().toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul' }))
      } catch { if (active) setError('인터넷 연결을 확인해 주세요. 새로고침을 눌러 다시 확인할 수 있습니다.') }
      finally { fetching = false; if (active) setLoading(false) }
    }
    void load()
    const resume = () => void load()
    const channel = client.channel('boss-dispatch').on('postgres_changes', { event: '*', schema: 'public', table: 'reservations' }, resume).subscribe()
    const timer = window.setInterval(resume, 5000)
    document.addEventListener('visibilitychange', resume); window.addEventListener('online', resume)
    return () => { active = false; window.clearInterval(timer); document.removeEventListener('visibilitychange', resume); window.removeEventListener('online', resume); void client.removeChannel(channel) }
  }, [refresh])
  async function confirm() {
    if (!selected || busy || !supabase) return
    setBusy(true); setError('')
    try {
      const latest = await supabase.from('reservations').select('updated_at,status').eq('id', selected.row.id).single()
      if (latest.error) throw latest.error
      if (latest.data.updated_at !== selected.row.updated_at || !['requested', 'approval_pending'].includes(latest.data.status)) throw new Error('예약 내용이 바뀌었습니다. 돌아가서 최신 예약을 확인해 주세요.')
      const response = selected.choice === '9090'
        ? await supabase.rpc('dispatch_9090', { p_reservation_id: selected.row.id, p_driver_id: '60874bf9-2dec-4e86-b733-6cc242787f4f' })
        : await supabase.rpc('resolve_pending_reservation', { p_reservation_id: selected.row.id, p_next: selected.choice })
      if (response.error) throw new Error(response.error.message)
      if (!response.data) throw new Error('처리 결과를 확인하지 못했습니다. 새로고침 후 확인해 주세요.')
      setResult(`${patient(selected.row)} · ${choiceLabel[selected.choice]} 처리했습니다.`)
      setRows(current => current.filter(r => r.id !== selected.row.id)); setSelected(null); setRefresh(v => v + 1)
    } catch (e) { setError(e instanceof Error ? e.message : '처리하지 못했습니다. 새로고침 후 확인해 주세요.') }
    finally { setBusy(false) }
  }
  async function install() {
    if (!installEvent) { setInstallNotice('갤럭시 크롬 오른쪽 위 ⋮ → 홈 화면에 추가 → 설치를 눌러 주세요. 아이폰은 Safari 공유 → 홈 화면에 추가를 사용하세요.'); return }
    try { await installEvent.prompt(); const answer = await installEvent.userChoice; setInstallNotice(answer.outcome === 'accepted' ? '설치를 요청했습니다. 홈 화면의 사장님 배차 아이콘으로 열어 주세요.' : '설치를 취소했습니다. 이 화면에서도 배차할 수 있습니다.'); setInstallEvent(null) }
    catch { setInstallNotice('브라우저 메뉴에서 홈 화면에 추가를 선택해 주세요.') }
  }
  const expired = (r: Row) => now >= new Date(r.created_at).getTime() + 86400000
  return <main className="boss-screen"><header className="boss-header"><div><small>EMS CONNECT</small><h1>사장님 배차</h1></div><button onClick={() => void install()}>휴대폰에 설치</button></header>
    {installNotice && <p className="boss-message" role="status">{installNotice}</p>}
    <div className="boss-toolbar"><strong>배차할 예약 {rows.filter(r => !expired(r)).length}건</strong><button disabled={busy} onClick={() => setRefresh(v => v + 1)}>새로고침</button></div>
    <p className="boss-updated">{lastUpdate ? `마지막 확인 ${lastUpdate} · 자동으로 새 예약을 확인합니다.` : '예약을 확인하고 있습니다.'}</p>
    {result && <p className="boss-success" role="status">✓ {result}</p>}
    {error && <p className="boss-error" role="alert">{error}</p>}
    {selected ? <section className="boss-card boss-confirm" aria-label="배차 최종 확인"><h2>{choiceLabel[selected.choice]} 하시겠습니까?</h2><p>{hospitals[selected.row.hospital_id]} · {patient(selected.row)}</p><strong>{time(selected.row.scheduled_at)}</strong><p>출발: {selected.row.departure_address}</p><p>도착: {selected.row.destination_address}</p><p>{selected.choice === '9090' ? '71나9090 · 심재용 기사에게 배차합니다.' : selected.choice === 'external_dispatch' ? '타차량배차 목록으로 옮깁니다. 다른 기사에게는 직접 연락해 주세요.' : '예약이 취소됩니다. 내용을 다시 확인해 주세요.'}</p><button className={selected.choice === 'cancelled' ? 'boss-danger' : 'boss-primary'} disabled={busy || !!error && !rows.length} onClick={() => void confirm()}>{busy ? '처리 중입니다…' : `예, ${choiceLabel[selected.choice]} 확정`}</button><button disabled={busy} onClick={() => { setSelected(null); setError('') }}>아니요, 돌아가기</button></section>
      : loading ? <p className="boss-message">예약을 불러오는 중입니다…</p> : !rows.length && !error ? <section className="boss-card"><h2>배차할 예약이 없습니다.</h2><p>새 예약이 들어오면 여기에 표시됩니다.</p></section> : rows.map(r => <article className="boss-card" key={r.id}><p className="boss-hospital">{hospitals[r.hospital_id] || '병원 확인 필요'}</p><h2>{patient(r)}</h2><p className="boss-time">{time(r.scheduled_at)}</p><dl><dt>출발</dt><dd>{r.departure_address}</dd><dt>도착</dt><dd>{r.destination_address}</dd></dl><p>{r.trip_type === 'round_trip' ? '왕복' : r.trip_type === 'one_way' ? '편도' : '운행 유형 확인 필요'} · {r.waiting_required ? `현장 대기 ${r.waiting_minutes ?? 0}분` : r.waiting_required === false ? '현장 대기 없음' : '대기 여부 확인 필요'}</p><details><summary>연락처·환자 요청 확인</summary><p className="boss-notes">{r.requested_note || '추가 요청 없음'}</p></details>
        {expired(r) ? <p>24시간 경과 · 자동 취소 확인 중</p> : <div className="boss-choices"><button className="boss-primary" disabled={!!error} onClick={() => { setSelected({ row: r, choice: '9090' }); setResult('') }}>9090 배차</button><button className="boss-external" disabled={!!error} onClick={() => { setSelected({ row: r, choice: 'external_dispatch' }); setResult('') }}>타차량 배차</button><button className="boss-cancel" disabled={!!error} onClick={() => { setSelected({ row: r, choice: 'cancelled' }); setResult('') }}>예약 취소</button></div>}</article>)}
    <footer className="boss-footer"><a href="/">관리자 전체 화면</a><button disabled={busy} onClick={onSignOut}>로그아웃</button></footer>
  </main>
}
