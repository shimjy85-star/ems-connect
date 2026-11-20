import { useEffect, useState, type FormEvent } from 'react'
import { supabase } from './lib/supabase'

type EditableReservation = {
  id: string; status: string; updated_at?: string
  departure_address: string; destination_address: string; scheduled_at: string
  requested_note?: string | null; trip_type?: string | null
  waiting_required?: boolean | null; waiting_minutes?: number | null
}
type Change = { id: string; kind: string; proposed: Record<string, unknown>; reason: string; state: string; created_at: string }
const labels: Record<string, string> = { departure_address: '출발지', destination_address: '목적지', scheduled_at: '출발 시각', trip_type: '운행 유형', waiting_required: '현장 대기', waiting_minutes: '대기 시간(분)', requested_note: '환자 및 요청 정보' }
const localTime = (value: string) => { const d = new Date(value); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16) }
const display = (key: string, value: unknown) => key === 'scheduled_at' ? new Date(String(value)).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }) : value === 'round_trip' ? '왕복' : value === 'one_way' ? '편도' : typeof value === 'boolean' ? value ? '필요' : '불필요' : String(value ?? '')

export function ReservationChanges({ reservation: r, admin, onChanged }: { reservation: EditableReservation; admin: boolean; onChanged: () => void }) {
  const [mode, setMode] = useState<'edit' | 'cancel' | null>(null)
  const [changes, setChanges] = useState<Change[]>([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [revision, setRevision] = useState(0)
  const [reason, setReason] = useState('')
  const [draft, setDraft] = useState({ departure_address: '', destination_address: '', scheduled_at: '', trip_type: 'one_way', waiting_required: false, waiting_minutes: 0, requested_note: '' })
  const [version, setVersion] = useState<string>()
  const needsApproval = !admin && ['confirmed', 'external_dispatch'].includes(r.status)
  const pending = changes.find(c => c.state === 'pending')
  const editable = ['requested', 'approval_pending', 'confirmed', 'external_dispatch'].includes(r.status)
  useEffect(() => {
    let active = true
    const load = async () => {
      if (!supabase) return
      const result = await supabase.from('reservation_changes').select('id,kind,proposed,reason,state,created_at')
        .eq('reservation_id', r.id).order('created_at', { ascending: false }).limit(10)
      if (!active) return
      if (result.error) { setLoaded(false); setError('변경 요청 내역을 확인하지 못했습니다. 새로고침해 주세요.'); return }
      setChanges(result.data as Change[])
      setLoaded(true)
    }
    void load()
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void load() }, 30000)
    return () => { active = false; window.clearInterval(timer) }
  }, [r.id, revision])
  function open(next: 'edit' | 'cancel') {
    setVersion(r.updated_at); setReason(''); setError(''); setNotice(''); setMode(next)
    setDraft({ departure_address: r.departure_address, destination_address: r.destination_address, scheduled_at: localTime(r.scheduled_at), trip_type: r.trip_type || 'one_way', waiting_required: r.waiting_required ?? false, waiting_minutes: r.waiting_minutes ?? 0, requested_note: r.requested_note || '' })
  }
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!supabase || busy || !mode) return
    setBusy(true); setError('')
    try {
      const proposed = mode === 'cancel' ? {} : { ...draft, scheduled_at: new Date(draft.scheduled_at).toISOString(), waiting_minutes: draft.waiting_required ? draft.waiting_minutes : 0 }
      const result = await supabase.rpc('submit_reservation_change', { p_id: r.id, p_version: version, p_kind: mode, p_data: proposed, p_reason: reason.trim() })
      if (result.error) throw new Error(result.error.message)
      setNotice(needsApproval ? '관리자에게 요청했습니다. 승인 전까지 기존 예약이 유지됩니다.' : '예약에 반영했습니다.')
      setMode(null); setRevision(v => v + 1); onChanged()
    } catch (e) { setError(e instanceof Error ? e.message : '처리하지 못했습니다. 새로고침 후 확인해 주세요.') }
    finally { setBusy(false) }
  }
  async function review(approve: boolean) {
    if (!supabase || !pending || busy) return
    setBusy(true); setError('')
    try {
      const result = await supabase.rpc('review_reservation_change', { p_change_id: pending.id, p_approve: approve })
      if (result.error) throw new Error(result.error.message)
      setNotice(approve ? '변경 요청을 승인했습니다.' : '변경 요청을 반려했습니다.')
      setRevision(v => v + 1); onChanged()
    } catch (e) { setError(e instanceof Error ? e.message : '처리하지 못했습니다.') }
    finally { setBusy(false) }
  }
  return <div className="reservation-change-tools">
    {pending && <section aria-label="승인 대기 요청"><strong>{pending.kind === 'cancel' ? '취소' : '수정'} 승인 대기</strong><p>사유: {pending.reason}</p>
      {pending.kind === 'edit' && <dl>{Object.entries(pending.proposed).map(([key, value]) => <div key={key}><dt>{labels[key] || key}</dt><dd style={{ whiteSpace: 'pre-wrap' }}>{display(key, value)}</dd></div>)}</dl>}
      {admin && <><button type="button" disabled={busy} onClick={() => void review(true)}>요청 승인</button><button type="button" disabled={busy} onClick={() => void review(false)}>반려</button></>}
    </section>}
    {editable && !pending && !mode && <><button type="button" disabled={!loaded} onClick={() => open('edit')}>{needsApproval ? '수정 요청' : '예약 수정'}</button><button type="button" disabled={!loaded} onClick={() => open('cancel')}>{needsApproval ? '취소 요청' : '예약 취소'}</button></>}
    {mode && <form className="reservation-form" onSubmit={event => void submit(event)}>
      <strong>{mode === 'edit' ? '예약 수정' : '예약 취소'}{needsApproval ? ' 요청' : ''}</strong>
      {mode === 'edit' && <div className="form-grid">
        <label>출발지<input required maxLength={300} value={draft.departure_address} onChange={e => setDraft({ ...draft, departure_address: e.target.value })} /></label>
        <label>목적지<input required maxLength={300} value={draft.destination_address} onChange={e => setDraft({ ...draft, destination_address: e.target.value })} /></label>
        <label>출발 시각<input required type="datetime-local" value={draft.scheduled_at} onChange={e => setDraft({ ...draft, scheduled_at: e.target.value })} /></label>
        <label>운행 유형<select value={draft.trip_type} onChange={e => setDraft({ ...draft, trip_type: e.target.value })}><option value="one_way">편도</option><option value="round_trip">왕복</option></select></label>
        <label>현장 대기<input type="checkbox" checked={draft.waiting_required} onChange={e => setDraft({ ...draft, waiting_required: e.target.checked })} /></label>
        {draft.waiting_required && <label>대기 시간(분)<input required type="number" min={0} max={1440} value={draft.waiting_minutes} onChange={e => setDraft({ ...draft, waiting_minutes: Number(e.target.value) })} /></label>}
        <label className="note-field">환자 및 요청 정보<textarea required maxLength={2000} rows={10} value={draft.requested_note} onChange={e => setDraft({ ...draft, requested_note: e.target.value })} /></label>
      </div>}
      <label>변경 사유<textarea required maxLength={500} value={reason} onChange={e => setReason(e.target.value)} /></label>
      <p>{needsApproval ? '관리자 승인 후 예약에 반영됩니다.' : '확인하면 예약에 즉시 반영됩니다.'}</p>
      <button type="submit" disabled={busy}>{busy ? '처리 중…' : needsApproval ? '승인 요청 보내기' : '변경 확정'}</button><button type="button" disabled={busy} onClick={() => setMode(null)}>닫기</button>
    </form>}
    {error && <p role="alert" className="form-error">{error}</p>}{notice && <p role="status">{notice}</p>}
    {changes.length > 0 && <details><summary>최근 변경 이력</summary>{changes.map(c => <p key={c.id}>{new Date(c.created_at).toLocaleString('ko-KR')} · {c.kind === 'cancel' ? '취소' : '수정'} · {c.state === 'pending' ? '승인 대기' : c.state === 'applied' ? '반영 완료' : '반려'} · {c.reason}</p>)}</details>}
  </div>
}
