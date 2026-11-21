import { useEffect, useState } from 'react'
import { supabase } from './lib/supabase'
import { createXlsxBlob } from './lib/xlsx'
import { TripPhoto } from './TripPhoto'

type Row = { id: string; scheduled_at: string; departure_address: string; destination_address: string; requested_note: string | null; trip_type: string | null; waiting_required: boolean | null; waiting_minutes: number | null }
const value = (note: string | null, label: string) => note?.split('\n').find(line => line.startsWith(`${label}:`))?.slice(label.length + 1).trim() || ''
const date = (time: string) => new Date(time).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })

export function TripHistory({ userId, refreshToken }: { userId: string; refreshToken: number }) {
  const [month, setMonth] = useState(() => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit' }).format(new Date()).slice(0,7))
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [refresh, setRefresh] = useState(0)
  const [notice, setNotice] = useState('')
  useEffect(() => {
    const client = supabase
    if (!client) return
    let active = true, fetching = false
    const load = async () => {
      if (fetching) return
      fetching = true
      try {
        const [year, m] = month.split('-').map(Number)
        const all: Row[] = []
        for (let offset=0; ; offset+=1000) {
          const response = await client.from('reservations').select('id,scheduled_at,departure_address,destination_address,requested_note,trip_type,waiting_required,waiting_minutes')
            .eq('driver_id', userId).eq('status','completed')
            .gte('scheduled_at',new Date(`${month}-01T00:00:00+09:00`).toISOString()).lt('scheduled_at',new Date(Date.UTC(year,m,1)-9*3600000).toISOString())
            .order('scheduled_at',{ascending:false}).order('id').range(offset,offset+999)
          if (response.error) throw response.error
          if (!active) return
          all.push(...response.data)
          if (response.data.length<1000) break
        }
        if (active) { setRows(all); setError('') }
      } catch { if (active) setError('운행기록을 불러오지 못했습니다. 다시 조회해 주세요.') }
      finally { fetching=false; if(active) setLoading(false) }
    }
    void load()
    const channel=client.channel(`trip-history-${userId}`).on('postgres_changes',{event:'UPDATE',schema:'public',table:'reservations'},()=>void load()).subscribe()
    const timer=window.setInterval(()=>{if(document.visibilityState==='visible')void load()},15000)
    return ()=>{active=false;window.clearInterval(timer);void client.removeChannel(channel)}
  },[month,userId,refresh,refreshToken])
  function download() {
    if(loading || error || !rows.length)return
    try {
      const blob=createXlsxBlob(['예약번호','출발시각(한국시간)','환자명','출발지','목적지','보호자 연락처','감염 여부','산소','동승','운행유형','현장대기','대기시간(분)','운행상태','요청사항'],rows.map(r=>[r.id,date(r.scheduled_at),value(r.requested_note,'환자명'),r.departure_address,r.destination_address,value(r.requested_note,'보호자 연락처'),value(r.requested_note,'감염 여부'),value(r.requested_note,'산소 사용 여부'),value(r.requested_note,'동승 여부'),r.trip_type==='round_trip'?'왕복':r.trip_type==='one_way'?'편도':'확인 필요',r.waiting_required===true?'필요':r.waiting_required===false?'없음':'확인 필요',String(r.waiting_minutes??''),'완료',r.requested_note||'']))
      const url=URL.createObjectURL(blob),link=document.createElement('a')
      link.href=url;link.download=`71나9090_운행기록_${month.replace('-','')}.xlsx`;link.click();window.setTimeout(()=>URL.revokeObjectURL(url),60000)
      setNotice('엑셀 다운로드를 요청했습니다. 휴대폰의 다운로드 폴더를 확인해 주세요.')
    }catch{setNotice('엑셀 저장에 실패했습니다. 다시 시도해 주세요.')}
  }
  return <section className="panel my-trips trip-history"><h1>운행기록조회</h1><p>완료한 내 운행이 월별로 누적됩니다. 출발 예정일 · 한국 시간 기준입니다.</p><div className="trip-history-tools"><label>조회 월 <input type="month" value={month} onChange={e=>{if(/^\d{4}-\d{2}$/.test(e.target.value)){setMonth(e.target.value);setLoading(true);setRows([]);setNotice('')}}}/></label><button type="button" onClick={()=>{setLoading(true);setRefresh(v=>v+1)}}>조회</button><button type="button" className="primary-button" disabled={loading||!!error||!rows.length} onClick={download}>월별 엑셀 저장</button></div><p role="status">{loading?'조회 중…':`${month} · 완료 ${rows.length}건`}</p>{error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
    {!loading&&!error&&(!rows.length?<p>이 달의 완료 운행이 없습니다.</p>:rows.map(r=><article className="trip-card trip-history-card" key={r.id}><h2>{value(r.requested_note,'환자명')||'환자명 미등록'}</h2><p><strong>{date(r.scheduled_at)}</strong> · 완료</p><p>{r.departure_address} → {r.destination_address}</p><details><summary>기록 상세 · 사진</summary><p className="trip-notes">{r.requested_note}</p><TripPhoto id={r.id} upload /></details></article>))}
  </section>
}
