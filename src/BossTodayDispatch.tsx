import { useEffect, useState } from 'react'
import { supabase } from './lib/supabase'
import { koreaDay, tripDayBounds } from './lib/tripDates'

type DispatchRow = {
  id: string; hospital_id: string; scheduled_at: string; requested_note: string | null;
  departure_address: string; destination_address: string; status: string; trip_phase: string | null;
}
const clock = (value: string) => new Date(value).toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
function stateLabel(r: DispatchRow) {
  if (r.status === 'external_dispatch') return '타차량 배차'
  if (r.status === 'completed') return '이송완료'
  if (r.status === 'in_progress') return r.trip_phase === 'moving' ? '이동중' : '이송중'
  return '9090 배차완료'
}

export function BossTodayDispatch({ hospitals, refreshToken }: { hospitals: Record<string, string>; refreshToken: number }) {
  const [rows, setRows] = useState<DispatchRow[]>([])
  const [day, setDay] = useState(koreaDay)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [refresh, setRefresh] = useState(0)
  useEffect(() => {
    const client = supabase
    if (!client) return
    let active = true, fetching = false
    const load = async () => {
      if (fetching || document.visibilityState === 'hidden') return
      fetching = true
      const currentDay = koreaDay(), bounds = tripDayBounds(currentDay)
      try {
        const all: DispatchRow[] = []
        for (let offset = 0; ; offset += 1000) {
          const response = await client.from('reservations')
            .select('id,hospital_id,scheduled_at,requested_note,departure_address,destination_address,status,trip_phase')
            .gte('scheduled_at', bounds.start).lt('scheduled_at', bounds.end)
            .in('status', ['confirmed', 'in_progress', 'completed', 'external_dispatch'])
            .order('scheduled_at', { ascending: false }).order('id').range(offset, offset + 999)
          if (response.error) throw response.error
          if (!active) return
          all.push(...response.data)
          if (response.data.length < 1000) break
        }
        if (!active) return
        setRows(all); setDay(currentDay); setError('')
      } catch { if (active) setError('금일 배차 내역을 갱신하지 못했습니다. 표시된 내역은 최신 정보가 아닐 수 있습니다.') }
      finally { fetching = false; if (active) setLoading(false) }
    }
    void load()
    const resume = () => void load()
    const timer = window.setInterval(resume, 5000)
    const channel = client.channel('boss-today-dispatch').on('postgres_changes', { event: '*', schema: 'public', table: 'reservations' }, resume).subscribe()
    document.addEventListener('visibilitychange', resume); window.addEventListener('online', resume); window.addEventListener('focus', resume)
    return () => { active = false; window.clearInterval(timer); document.removeEventListener('visibilitychange', resume); window.removeEventListener('online', resume); window.removeEventListener('focus', resume); void client.removeChannel(channel) }
  }, [refresh, refreshToken])
  return <section className="boss-today" aria-labelledby="boss-today-title">
    <header className="boss-toolbar"><h2 id="boss-today-title">금일 배차 내역</h2><button type="button" onClick={() => setRefresh(v => v + 1)}>내역 새로고침</button></header>
    <p className="boss-updated">{day} · 오늘 운행 예정인 9090·타차량 배차 {rows.length}건<br />출발시각이 늦은 순서로 표시합니다.</p>
    {error && <p className="boss-error" role="alert">{error}</p>}
    {loading ? <p>배차 내역을 불러오는 중입니다…</p> : !rows.length && !error ? <p className="boss-message">오늘 운행 예정인 배차 내역이 없습니다.</p> : <ol className="boss-timeline">{rows.map((r,index) => <li key={r.id}>
      {(index === 0 || clock(rows[index-1].scheduled_at).slice(0,2) !== clock(r.scheduled_at).slice(0,2)) && <h3 className="boss-hour">{clock(r.scheduled_at).slice(0,2)}시대</h3>}
      <article className={`boss-history-card${r.status === 'external_dispatch' ? ' boss-history-external' : ''}`}>
        <div className="boss-history-top"><time dateTime={r.scheduled_at}>{clock(r.scheduled_at)}</time><strong className="boss-history-status">{stateLabel(r)}</strong></div>
        <h3>{r.requested_note?.match(/^환자명:\s*(.+)$/m)?.[1]?.trim() || '환자명 확인 필요'}</h3>
        <p className="boss-history-hospital">{hospitals[r.hospital_id] || r.departure_address}</p>
        <dl><dt>출발</dt><dd>{r.departure_address}</dd><dt>도착</dt><dd>{r.destination_address}</dd></dl>
        <small>예약번호 #{r.id.slice(0,8).toUpperCase()}</small>
      </article>
    </li>)}</ol>}
  </section>
}
