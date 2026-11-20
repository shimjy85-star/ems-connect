import { useEffect, useState } from 'react'
import { supabase } from './lib/supabase'

type Row = { id: string; hospital_id: string; scheduled_at: string; departure_address: string; destination_address: string; requested_note: string | null }
const koreaDate = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
const columns = 'id,hospital_id,scheduled_at,departure_address,destination_address,requested_note'

export function ExternalDispatch({ refreshToken }: { refreshToken: number }) {
  const [today, setToday] = useState(koreaDate)
  const [month, setMonth] = useState(() => koreaDate().slice(0, 7))
  const [todayRows, setTodayRows] = useState<Row[]>([])
  const [monthRows, setMonthRows] = useState<Row[]>([])
  const [hospitals, setHospitals] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [refresh, setRefresh] = useState(0)
  useEffect(() => {
    const client = supabase
    if (!client) return
    let active = true
    let fetching = false
    async function read(start: string, end: string) {
      const rows: Row[] = []
      for (let offset = 0; ; offset += 1000) {
        const result = await client!.from('reservations').select(columns).eq('status', 'external_dispatch')
          .gte('scheduled_at', start).lt('scheduled_at', end).order('scheduled_at').order('id').range(offset, offset + 999)
        if (result.error) throw result.error
        if (!active) return []
        rows.push(...result.data)
        if (result.data.length < 1000) return rows
      }
    }
    async function load() {
      if (fetching) return
      fetching = true
      try {
        const dayStart = new Date(`${today}T00:00:00+09:00`)
        const [year, monthNumber] = month.split('-').map(Number)
        const [day, monthly, hospitalResult] = await Promise.all([
          read(dayStart.toISOString(), new Date(dayStart.getTime() + 86400000).toISOString()),
          read(new Date(`${month}-01T00:00:00+09:00`).toISOString(), new Date(Date.UTC(year, monthNumber, 1) - 9 * 3600000).toISOString()),
          client!.from('hospitals').select('id,name'),
        ])
        if (!active) return
        if (hospitalResult.error) throw hospitalResult.error
        setTodayRows(day); setMonthRows(monthly)
        setHospitals(Object.fromEntries((hospitalResult.data ?? []).map(h => [h.id, h.name])))
        setError('')
      } catch { if (active) setError('타차량배차 내역을 불러오지 못했습니다. 새로고침해 주세요.') }
      finally { fetching = false; if (active) setLoading(false) }
    }
    void load()
    const channel = client.channel('external-dispatch-board').on('postgres_changes', { event: '*', schema: 'public', table: 'reservations' }, () => void load()).subscribe()
    const resume = () => { if (document.visibilityState === 'visible') { setToday(koreaDate()); void load() } }
    const timer = window.setInterval(resume, 30000)
    document.addEventListener('visibilitychange', resume)
    window.addEventListener('online', resume)
    return () => { active = false; window.clearInterval(timer); document.removeEventListener('visibilitychange', resume); window.removeEventListener('online', resume); void client.removeChannel(channel) }
  }, [month, today, refresh, refreshToken])

  function table(rows: Row[]) {
    return <div className="table-wrap"><table className="management-table"><thead><tr><th>예약번호</th><th>희망일시</th><th>병원</th><th>환자명</th><th>출발지</th><th>목적지</th><th>운행상태</th></tr></thead><tbody>
      {rows.map(r => <tr key={r.id}><td>#{r.id.slice(0, 8).toUpperCase()}</td><td>{new Date(r.scheduled_at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}</td><td>{hospitals[r.hospital_id] || '병원 확인 필요'}</td><td>{r.requested_note?.match(/^환자명:\s*(.+)$/m)?.[1] || '미등록'}</td><td>{r.departure_address}</td><td>{r.destination_address}</td><td><span className="status-pill status-external_dispatch">타차량 배차</span></td></tr>)}
      {!rows.length && <tr><td colSpan={7}><div className="table-empty">해당 기간의 타차량배차 내역이 없습니다.</div></td></tr>}
    </tbody></table></div>
  }
  return <><section className="page-heading"><h1>타차량배차</h1><p>이송 예정일 기준 · 한국 시간 · 예약관리에서 타차량으로 배차한 건이 자동 반영됩니다.</p><button type="button" className="subtle-button" onClick={() => { setLoading(true); setRefresh(v => v + 1) }}>새로고침</button></section>
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="external-dispatch-panels" aria-busy={loading}>
      <section className="panel external-dispatch-panel"><h2>금일타차량배차</h2><p>{today} · {loading ? '불러오는 중…' : `${todayRows.length}건`}</p>{!loading && !error && table(todayRows)}</section>
      <section className="panel external-dispatch-panel"><div className="external-month-heading"><h2>월별 타차량배차 누적</h2><label>조회 월 <input type="month" value={month} onChange={e => { if (/^\d{4}-\d{2}$/.test(e.target.value)) { setMonth(e.target.value); setLoading(true) } }} /></label></div><p>{month} · {loading ? '불러오는 중…' : `총 ${monthRows.length}건`}</p>{!loading && !error && <><div className="external-hospital-totals">{Object.entries(hospitals).map(([id, name]) => <span key={id}>{name} {monthRows.filter(r => r.hospital_id === id).length}건</span>)}</div>{table(monthRows)}</>}</section>
    </div>
  </>
}
