import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import './App.css'
import { connectPush } from './lib/push'
import { supabase, supabaseConfigured } from './lib/supabase'
import { createXlsxBlob } from './lib/xlsx'
import { ReservationChanges } from './ReservationChanges'

type NavItem = {
  label: string
  icon: 'grid' | 'calendar' | 'history'
}

const mainNav: NavItem[] = [
  { label: '대시보드', icon: 'grid' },
  { label: '예약 관리', icon: 'calendar' },
]

const hospitalNav: NavItem[] = [mainNav[1]]

type StatKey = 'today' | 'pending' | 'confirmed' | 'inProgress' | 'availableVehicles'

type DashboardStat = {
  key: StatKey
  label: string
  icon: string
  tone: string
  unit: string
}

const hospitalStats: DashboardStat[] = [
  { key: 'today', label: '오늘 이송', icon: 'calendar', tone: 'blue', unit: '건' },
  { key: 'pending', label: '배차 검토 중', icon: 'dispatch', tone: 'orange', unit: '건' },
  { key: 'confirmed', label: '배차 확정', icon: 'ambulance', tone: 'teal', unit: '건' },
  { key: 'inProgress', label: '운행 중', icon: 'route', tone: 'purple', unit: '건' },
]

const adminStats: DashboardStat[] = [
  { key: 'today', label: '오늘 예약', icon: 'calendar', tone: 'blue', unit: '건' },
  { key: 'pending', label: '배차 대기', icon: 'dispatch', tone: 'orange', unit: '건' },
  { key: 'inProgress', label: '운행 중', icon: 'route', tone: 'teal', unit: '건' },
  { key: 'availableVehicles', label: '운용 가능 차량', icon: 'vehicle', tone: 'purple', unit: '대' },
]

type ReservationStatus = 'requested' | 'approval_pending' | 'confirmed' | 'external_dispatch' | 'in_progress' | 'completed' | 'rejected' | 'cancelled'

type ReservationRow = {
  id: string
  departure_address: string
  destination_address: string
  scheduled_at: string
  status: ReservationStatus
  created_at: string
  requested_note?: string | null
  updated_at?: string
  trip_phase?: 'moving' | 'transporting' | 'completed' | null
  trip_type?: TripType | null
  waiting_required?: boolean | null
  waiting_minutes?: number | null
}

type TripType = 'one_way' | 'round_trip'

const reservationColumns = 'id, departure_address, destination_address, scheduled_at, status, created_at, updated_at, requested_note, trip_type, waiting_required, waiting_minutes, trip_phase'

function TripProgress({ reservation: r }: { reservation: ReservationRow }) {
  const phase = r.status === 'completed' ? 'completed' : r.status === 'in_progress' ? r.trip_phase || 'transporting' : null
  return <p className="trip-progress" aria-live="polite">{phase ? `운행 상태: ${phase === 'moving' ? '● 이동중 → ○ 이송중 → ○ 완료' : phase === 'transporting' ? '✓ 이동중 → ● 이송중 → ○ 완료' : '✓ 이동중 → ✓ 이송중 → ● 완료'}` : `운행 상태: ${statusLabels[r.status]}${r.status === 'confirmed' ? ' · 출발 대기' : ''}`}</p>
}

function TripButtons({ reservation: r, onChanged }: { reservation: ReservationRow; onChanged: () => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const phase = r.status === 'confirmed' ? 'assigned' : r.trip_phase || 'transporting'
  const next = phase === 'assigned' ? 'moving' : phase === 'moving' ? 'transporting' : 'completed'
  async function advance() {
    if (!supabase || busy) return
    setBusy(true); setError('')
    try {
      const result = await supabase.rpc('advance_trip', { p_id: r.id, p_expected: phase, p_next: next })
      if (result.error) throw result.error
      onChanged()
    } catch (e) { setError(e instanceof Error ? e.message : '상태 변경에 실패했습니다. 새로고침 후 확인해 주세요.') }
    finally { setBusy(false) }
  }
  return <div><TripProgress reservation={r} /><div className="trip-buttons">{(['moving', 'transporting', 'completed'] as const).map((value, i) => <button type="button" className="primary-button" key={value} disabled={busy || next !== value || !['confirmed', 'in_progress'].includes(r.status)} onClick={() => void advance()}>{busy && next === value ? '저장 중…' : ['이동중', '이송중', '완료'][i]}</button>)}</div>{error && <p role="alert">{error}</p>}</div>
}

function transportSummary(reservation: ReservationRow) {
  const trip = reservation.trip_type === 'round_trip' ? '왕복' : reservation.trip_type === 'one_way' ? '편도' : '운행 유형 미확인'
  const waiting = reservation.waiting_required === true
    ? `현장 대기 필요 · ${reservation.waiting_minutes ?? 0}분`
    : reservation.waiting_required === false ? '현장 대기 없음' : '대기 여부 미확인'
  return `${trip} · ${waiting}`
}

function localDateTimeValue(date: Date) {
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return localDate.toISOString().slice(0, 16)
}

const statusLabels: Record<ReservationStatus, string> = {
  requested: '접수',
  approval_pending: '승인 대기',
  confirmed: '배차완료',
  external_dispatch: '타차량 배차',
  in_progress: '운행 중',
  completed: '이송완료',
  rejected: '반려',
  cancelled: '취소',
}

function roleLabel(role: string) {
  const labels: Record<string, string> = {
    admin: '플랫폼 관리자',
    hospital_admin: '병원 관리자',
    hospital_staff: '병원 담당자',
  }
  return labels[role] ?? '등록된 사용자'
}

function formatScheduledAt(value: string) {
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

function patientNameFromNote(value: string | null | undefined) {
  return value?.match(/^환자명:\s*(.+)$/m)?.[1]?.trim() ?? ''
}

function Icon({ name, size = 18 }: { name: string; size?: number }) {
  const paths: Record<string, ReactNode> = {
    grid: <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 10h18" /></>,
    dispatch: <><path d="M3 12h12M11 7l5 5-5 5" /><path d="M16 6h3a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-3" /></>,
    vehicle: <><path d="M3 15V7a2 2 0 0 1 2-2h10l4 5h2v7h-2" /><path d="M3 14h3m4 0h4m-8 4a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm10 0a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM15 5v5h4" /></>,
    driver: <><circle cx="12" cy="8" r="4" /><path d="M5 21v-2a7 7 0 0 1 14 0v2" /></>,
    hospital: <><path d="M4 21V5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v16M9 21v-4h6v4M12 7v6M9 10h6" /></>,
    history: <><path d="M3 12a9 9 0 1 0 2.64-6.36L3 8" /><path d="M3 3v5h5m4-1v5l3 2" /></>,
    settings: <><circle cx="12" cy="12" r="3" /><path d="m19.4 15 .1.1 1.4 1.1-1.4 2.4-1.7-.7a8 8 0 0 1-1.5.9l-.3 1.8h-2.8l-.3-1.8a8 8 0 0 1-1.5-.9l-1.7.7-1.4-2.4 1.4-1.1a7 7 0 0 1 0-1.8l-1.4-1.1 1.4-2.4 1.7.7a8 8 0 0 1 1.5-.9l.3-1.8h2.8l.3 1.8a8 8 0 0 1 1.5.9l1.7-.7 1.4 2.4-1.4 1.1a7 7 0 0 1 0 1.8Z" /></>,
    route: <><circle cx="6" cy="18" r="2" /><circle cx="18" cy="6" r="2" /><path d="M8 18h4a4 4 0 0 0 4-4V10a4 4 0 0 1 4-4" /></>,
    search: <><circle cx="10.8" cy="10.8" r="6.8" /><path d="m16 16 5 5" /></>,
    refresh: <><path d="M20 7v5h-5" /><path d="M4.9 9a7.5 7.5 0 0 1 12.6-2L20 12M4 17v-5h5" /><path d="M19.1 15a7.5 7.5 0 0 1-12.6 2L4 12" /></>,
    arrow: <><path d="M7 17 17 7M8 7h9v9" /></>,
    ambulance: <><path d="M3 7h11v11H3zM14 11h4l3 3v4h-7z" /><path d="M8.5 10v5m-2.5-2.5h5M6 21a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm12 0a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z" /></>,
  }

  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[name] ?? paths.grid}
    </svg>
  )
}

function NavButton({ item, active, onClick }: { item: NavItem; active: boolean; onClick: () => void }) {
  return (
    <button className={`nav-item${active ? ' active' : ''}`} onClick={onClick} type="button">
      <Icon name={item.icon} size={18} />
      <span>{item.label}</span>
    </button>
  )
}

function LoginScreen({
  email,
  password,
  fullName,
  error,
  notice,
  busy,
  onEmailChange,
  onPasswordChange,
  onFullNameChange,
  onSubmit,
  onSignUp,
  onRequestPasswordReset,
}: {
  email: string
  password: string
  fullName: string
  error: string
  notice: string
  busy: boolean
  onEmailChange: (value: string) => void
  onPasswordChange: (value: string) => void
  onFullNameChange: (value: string) => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  onSignUp: (event: FormEvent<HTMLFormElement>) => void
  onRequestPasswordReset: () => void
}) {
  const [isSignUp, setIsSignUp] = useState(false)

  return (
    <main className="login-screen">
      <section className="login-card">
        <a className="login-brand" href="#login">
          <span className="brand-mark"><Icon name="ambulance" size={22} /></span>
          <span className="brand-copy"><strong>EMS CONNECT</strong><small>응급 이송 통합 관리</small></span>
        </a>
        <p className="eyebrow">SECURE OPERATIONS PORTAL</p>
        <h1>{isSignUp ? '가입 신청' : '로그인'}</h1>
        <p className="login-description">{isSignUp ? '이메일 확인 후 관리자가 병원과 권한을 연결합니다.' : '등록된 EMS CONNECT 계정으로 로그인하세요.'}</p>
        <form className="login-form" onSubmit={isSignUp ? onSignUp : onSubmit}>
          {isSignUp && <>
            <label htmlFor="signup-full-name">이름</label>
            <input id="signup-full-name" type="text" autoComplete="name" value={fullName} onChange={(event) => onFullNameChange(event.target.value)} placeholder="이름을 입력하세요" maxLength={100} required />
          </>}
          <label htmlFor="login-email">이메일</label>
          <input id="login-email" type="email" autoComplete="email" value={email} onChange={(event) => onEmailChange(event.target.value)} placeholder="name@hospital.org" required />
          <label htmlFor="login-password">비밀번호</label>
          <input id="login-password" type="password" autoComplete={isSignUp ? 'new-password' : 'current-password'} minLength={8} value={password} onChange={(event) => onPasswordChange(event.target.value)} placeholder={isSignUp ? '8자 이상 입력하세요' : '비밀번호를 입력하세요'} required />
          {error && <p className="login-error" role="alert">{error}</p>}
          {notice && <p className="login-notice" role="status">{notice}</p>}
          <button className="primary-button login-submit" type="submit" disabled={busy}>{busy ? (isSignUp ? '가입 신청 중…' : '로그인 중…') : (isSignUp ? '가입 신청' : '로그인')}</button>
        </form>
        {!isSignUp && <button className="login-mode-button password-reset-link" type="button" onClick={onRequestPasswordReset}>비밀번호를 잊으셨나요?</button>}
        <button className="login-mode-button" type="button" onClick={() => setIsSignUp((value) => !value)}>{isSignUp ? '이미 계정이 있나요? 로그인' : '처음 이용하시나요? 가입 신청'}</button>
        <p className="login-security"><span className="security-dot" />로그인한 계정에 허용된 데이터만 표시됩니다.</p>
      </section>
      <p className="login-footer">EMS CONNECT <span>·</span> 응급 이송 운영 플랫폼</p>
    </main>
  )
}

function PasswordRecoveryScreen({
  busy,
  error,
  notice,
  onSubmit,
  onCancel,
}: {
  busy: boolean
  error: string
  notice: string
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  onCancel: () => void
}) {
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [formError, setFormError] = useState('')

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (newPassword !== confirmPassword) {
      setFormError('새 비밀번호가 서로 다릅니다.')
      return
    }
    setFormError('')
    onSubmit(event)
  }

  return (
    <main className="login-screen">
      <section className="login-card">
        <a className="login-brand" href="#login">
          <span className="brand-mark"><Icon name="ambulance" size={22} /></span>
          <span className="brand-copy"><strong>EMS CONNECT</strong><small>응급 이송 통합 관리</small></span>
        </a>
        <p className="eyebrow">ACCOUNT SECURITY</p>
        <h1>새 비밀번호 설정</h1>
        <p className="login-description">다른 사람이 추측하기 어려운 8자 이상의 비밀번호를 입력하세요.</p>
        <form className="login-form" onSubmit={handleSubmit}>
          <label htmlFor="new-password">새 비밀번호</label>
          <input id="new-password" name="new-password" type="password" autoComplete="new-password" minLength={8} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} required />
          <label htmlFor="confirm-new-password">새 비밀번호 확인</label>
          <input id="confirm-new-password" type="password" autoComplete="new-password" minLength={8} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} required />
          {(formError || error) && <p className="login-error" role="alert">{formError || error}</p>}
          {notice && <p className="login-notice" role="status">{notice}</p>}
          <button className="primary-button login-submit" type="submit" disabled={busy}>{busy ? '변경 중…' : '비밀번호 변경'}</button>
        </form>
        <button className="login-mode-button" type="button" onClick={onCancel}>로그인 화면으로 돌아가기</button>
      </section>
      <p className="login-footer">EMS CONNECT <span>·</span> 응급 이송 운영 플랫폼</p>
    </main>
  )
}

type ApprovalProfile = {
  id: string
  full_name: string | null
  role: 'hospital_admin' | 'hospital_staff' | 'admin'
  hospital_id: string | null
  is_active: boolean
  created_at: string
}

type HospitalOption = { id: string; name: string }

type HospitalHistoryRow = ReservationRow & { hospital_id: string }

const KOREA_DAY_MS = 24 * 60 * 60 * 1000

function koreanDateParts(value: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value)
  return Object.fromEntries(parts.map((part) => [part.type, part.value])) as { year: string; month: string; day: string }
}

function koreanWeekStart(value: Date) {
  const parts = koreanDateParts(value)
  const dateAtUtcMidnight = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day))
  const weekday = new Date(dateAtUtcMidnight).getUTCDay()
  const mondayAtUtcMidnight = dateAtUtcMidnight - ((weekday + 6) % 7) * KOREA_DAY_MS
  return new Date(mondayAtUtcMidnight - 9 * 60 * 60 * 1000)
}

function koreanWeekLabel(start: Date) {
  const end = new Date(start.getTime() + 6 * KOREA_DAY_MS)
  const formatter = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: 'long', day: 'numeric' })
  return `${formatter.format(start)} – ${formatter.format(end)}`
}

function koreanWeekFilePart(start: Date) {
  const midpoint = new Date(start.getTime() + 2 * KOREA_DAY_MS)
  const parts = koreanDateParts(midpoint)
  return `${parts.year}${parts.month}-${Math.ceil(Number(parts.day) / 7)}주차`
}

function noteValue(note: string | null | undefined, label: string) {
  const safeLabel = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return note?.match(new RegExp(`^${safeLabel}:\\s*(.*)$`, 'm'))?.[1]?.trim() ?? ''
}

function AccountGate({
  name,
  state,
  onRefresh,
  onSignOut,
}: {
  name: string
  state: 'pending' | 'inactive' | 'missing'
  onRefresh: () => void
  onSignOut: () => void
}) {
  useEffect(() => {
    const refreshTimer = window.setInterval(onRefresh, 5_000)
    window.addEventListener('focus', onRefresh)
    return () => {
      window.clearInterval(refreshTimer)
      window.removeEventListener('focus', onRefresh)
    }
  }, [onRefresh])

  const copy = state === 'pending'
    ? { title: '관리자 승인을 기다리고 있습니다', detail: '이메일 확인은 완료되었습니다. 관리자가 소속 병원과 권한을 지정하면 EMS CONNECT를 사용할 수 있습니다. 승인되면 이 화면이 자동으로 바뀝니다.' }
    : state === 'inactive'
      ? { title: '계정이 비활성 상태입니다', detail: '플랫폼 관리자에게 계정 상태를 확인해 주세요.' }
      : { title: '계정 프로필을 확인할 수 없습니다', detail: 'Supabase 인증 계정에 연결된 profiles 항목이 없습니다. 관리자에게 문의해 주세요.' }

  return (
    <main className="login-screen">
      <section className="login-card account-gate-card">
        <a className="login-brand" href="#login">
          <span className="brand-mark"><Icon name="ambulance" size={22} /></span>
          <span className="brand-copy"><strong>EMS CONNECT</strong><small>응급 이송 통합 관리</small></span>
        </a>
        <p className="eyebrow">ACCOUNT REVIEW</p>
        <h1>{copy.title}</h1>
        <p className="login-description">{name}님, {copy.detail}</p>
        <div className="account-gate-actions">
          <button className="primary-button" type="button" onClick={onRefresh}>승인 상태 새로고침</button>
          <button className="form-cancel-button" type="button" onClick={onSignOut}>로그아웃</button>
        </div>
      </section>
      <p className="login-footer">EMS CONNECT <span>·</span> 응급 이송 운영 플랫폼</p>
    </main>
  )
}

function ApprovalManagement({ refreshToken }: { refreshToken: number }) {
  const [profiles, setProfiles] = useState<ApprovalProfile[]>([])
  const [hospitals, setHospitals] = useState<HospitalOption[]>([])
  const [selectedHospitals, setSelectedHospitals] = useState<Record<string, string>>({})
  const [selectedRoles, setSelectedRoles] = useState<Record<string, 'hospital_admin' | 'hospital_staff'>>({})
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState('')
  const [copiedProfileId, setCopiedProfileId] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const loadApprovals = useCallback(async (showLoading = true) => {
    if (!supabase) return
    if (showLoading) setLoading(true)
    const [profileResult, hospitalResult] = await Promise.all([
      supabase.from('profiles').select('id, full_name, role, hospital_id, is_active, created_at')
        .is('hospital_id', null).neq('role', 'admin').order('created_at', { ascending: true }),
      supabase.from('hospitals').select('id, name').eq('is_active', true).order('name'),
    ])
    if (profileResult.error || hospitalResult.error) {
      setError('가입 신청을 불러오지 못했습니다. 관리자 권한과 기존 RLS 설정을 확인해 주세요.')
      setLoading(false)
      return
    }
    setError('')
    const nextProfiles = (profileResult.data ?? []) as ApprovalProfile[]
    const nextHospitals = (hospitalResult.data ?? []) as HospitalOption[]
    setProfiles(nextProfiles)
    setHospitals(nextHospitals)
    setSelectedHospitals((current) => Object.fromEntries(nextProfiles.map((profile) => [profile.id, current[profile.id] ?? nextHospitals[0]?.id ?? ''])))
    setSelectedRoles((current) => Object.fromEntries(nextProfiles.map((profile) => [profile.id, current[profile.id] ?? 'hospital_staff'])))
    setLoading(false)
  }, [])

  useEffect(() => { void loadApprovals(false) }, [loadApprovals, refreshToken])

  const handleCopyProfileId = async (profileId: string) => {
    try {
      await navigator.clipboard.writeText(profileId)
      setCopiedProfileId(profileId)
      window.setTimeout(() => setCopiedProfileId(''), 1800)
    } catch {
      setError('UID를 복사하지 못했습니다. 브라우저에서 클립보드 권한을 확인해 주세요.')
    }
  }

  const handleApprove = async (profile: ApprovalProfile) => {
    const hospitalId = selectedHospitals[profile.id]
    if (!supabase || !hospitalId) return
    setBusyId(profile.id)
    setError('')
    setNotice('')
    const { data: approvedProfile, error: updateError } = await supabase.from('profiles').update({
      hospital_id: hospitalId,
      role: selectedRoles[profile.id] ?? 'hospital_staff',
      is_active: true,
    }).eq('id', profile.id).is('hospital_id', null).select('id').maybeSingle()
    if (updateError || !approvedProfile) {
      setError('승인하지 못했습니다. 기존 profiles 관리자 정책을 확인해 주세요.')
      setBusyId('')
      return
    }
    setNotice(`${profile.full_name || '가입자'} 계정을 승인했습니다.`)
    setBusyId('')
    await loadApprovals()
  }

  return (
    <>
      <section className="page-heading reservation-page-heading">
        <div><p className="eyebrow">PLATFORM ADMIN</p><h1>가입 신청 승인</h1><p className="heading-subtitle">병원 정보가 아직 연결되지 않은 계정을 검토합니다.</p></div>
        <button className="form-cancel-button" type="button" onClick={() => void loadApprovals()}>새로고침</button>
      </section>
      <div className="connection-banner"><span className="connection-indicator" /><div className="connection-copy"><strong>승인 기준</strong><span>기존 스키마에는 별도 승인 상태가 없어 hospital_id가 비어 있는 프로필을 대기 신청으로 표시합니다. 신청자 이메일은 profiles에 저장되지 않습니다.</span></div></div>
      {notice && <div className="success-banner" role="status"><span>✓</span>{notice}</div>}
      {error && <div className="form-error" role="alert">{error}</div>}
      <section className="panel reservation-management-panel approval-panel">
        {loading ? <div className="table-empty"><strong>가입 신청을 불러오고 있습니다…</strong></div>
          : profiles.length === 0 ? <div className="table-empty"><span className="table-empty-icon"><Icon name="history" size={20} /></span><strong>대기 중인 가입 신청이 없습니다</strong><span>회원가입 후 이메일 확인을 마친 계정이 여기에 표시됩니다.</span></div>
            : <>
              {hospitals.length === 0 && <div className="form-info-banner"><span className="connection-indicator" /><span>활성 병원이 없습니다. 병원 정보를 먼저 등록해야 신청을 승인할 수 있습니다.</span></div>}
              <div className="approval-list">
                {profiles.map((profile) => (
                  <article className="approval-card" key={profile.id}>
                    <div className="approval-person"><strong>{profile.full_name || '이름 미등록'}</strong><span>{profile.is_active ? '승인 대기' : '비활성 계정'} · {new Date(profile.created_at).toLocaleDateString('ko-KR')}</span><div className="approval-id-row"><code>{profile.id}</code><button className="copy-id-button" type="button" onClick={() => void handleCopyProfileId(profile.id)}>{copiedProfileId === profile.id ? '복사됨' : 'UID 복사'}</button></div></div>
                    <div className="approval-controls">
                      <label><span>병원</span><select value={selectedHospitals[profile.id] ?? ''} onChange={(event) => setSelectedHospitals((current) => ({ ...current, [profile.id]: event.target.value }))} disabled={!hospitals.length}><option value="">병원 선택</option>{hospitals.map((hospital) => <option key={hospital.id} value={hospital.id}>{hospital.name}</option>)}</select></label>
                      <label><span>권한</span><select value={selectedRoles[profile.id] ?? 'hospital_staff'} onChange={(event) => setSelectedRoles((current) => ({ ...current, [profile.id]: event.target.value as 'hospital_admin' | 'hospital_staff' }))}><option value="hospital_staff">병원 담당자</option><option value="hospital_admin">병원 관리자</option></select></label>
                      <button className="primary-button" type="button" onClick={() => void handleApprove(profile)} disabled={!hospitals.length || !selectedHospitals[profile.id] || busyId === profile.id}>{busyId === profile.id ? '승인 중…' : '승인'}</button>
                    </div>
                  </article>
                ))}
              </div>
            </>}
      </section>
      <p className="role-note">이 화면은 관리자 계정에서만 노출됩니다. 변경은 profiles 행의 병원·역할·활성 상태에만 적용됩니다.</p>
    </>
  )
}

function HospitalTransferHistory({ refreshToken }: { refreshToken: number }) {
  const [weekStart, setWeekStart] = useState(() => koreanWeekStart(new Date()))
  const [currentWeekStart] = useState(() => koreanWeekStart(new Date()))
  const [hospitals, setHospitals] = useState<HospitalOption[]>([])
  const [reservations, setReservations] = useState<HospitalHistoryRow[]>([])
  const [loading, setLoading] = useState(Boolean(supabase))
  const [error, setError] = useState(supabase ? '' : 'Supabase 연결이 필요합니다. 관리자 로그인 후 다시 확인해 주세요.')
  const [refreshKey, setRefreshKey] = useState(0)
  const isCurrentWeek = weekStart.getTime() >= currentWeekStart.getTime()
  const weekStartTimestamp = weekStart.getTime()
  const weekEndTimestamp = weekStartTimestamp + 7 * KOREA_DAY_MS
  const weekFilePart = koreanWeekFilePart(weekStart)

  useEffect(() => {
    const client = supabase
    if (!client) return

    let active = true
    const loadWeek = async () => {
      try {
        const hospitalResult = await client.from('hospitals').select('id, name').order('name')
        if (hospitalResult.error) throw hospitalResult.error

        const allRows: HospitalHistoryRow[] = []
        for (let offset = 0; offset < 10_000; offset += 1_000) {
          const { data, error: reservationError } = await client.from('reservations')
            .select(`${reservationColumns}, hospital_id`)
            .gte('scheduled_at', new Date(weekStartTimestamp).toISOString()).lt('scheduled_at', new Date(weekEndTimestamp).toISOString())
            .order('scheduled_at', { ascending: true }).range(offset, offset + 999)
          if (reservationError) throw reservationError
          const rows = (data ?? []) as HospitalHistoryRow[]
          allRows.push(...rows)
          if (rows.length < 1_000) break
          if (offset === 9_000) throw new Error('주간 예약이 10,000건을 초과해 한 번에 불러올 수 없습니다.')
        }

        if (!active) return
        setHospitals((hospitalResult.data ?? []) as HospitalOption[])
        setReservations(allRows)
      } catch {
        if (!active) return
        setError('병원별 이송 내역을 불러오지 못했습니다. 관리자 예약 조회 권한과 기존 RLS 설정을 확인해 주세요.')
      } finally {
        if (active) setLoading(false)
      }
    }

    void loadWeek()
    return () => { active = false }
  }, [weekStartTimestamp, weekEndTimestamp, refreshKey, refreshToken])

  const downloadHospitalWeek = (hospital: HospitalOption) => {
    const hospitalRows = reservations.filter((reservation) => reservation.hospital_id === hospital.id)
    const headers = ['예약번호', '환자명', '출발지', '목적지', '출발시각', '보호자 연락처', '감염 여부', '산소 사용 여부', '동승 여부', '상태', '추가 요청', '운행·대기 정보']
    const rows = hospitalRows.map((reservation) => [
      reservation.id,
      patientNameFromNote(reservation.requested_note),
      reservation.departure_address,
      reservation.destination_address,
      new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(reservation.scheduled_at)),
      noteValue(reservation.requested_note, '보호자 연락처'),
      noteValue(reservation.requested_note, '감염 여부'),
      noteValue(reservation.requested_note, '산소 사용 여부'),
      noteValue(reservation.requested_note, '동승 여부'),
      statusLabels[reservation.status] ?? reservation.status,
      reservation.requested_note?.split('[추가 요청]')[1]?.trim() ?? '',
      transportSummary(reservation),
    ])
    const blob = createXlsxBlob(headers, rows)
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    const safeHospitalName = hospital.name.replace(/[\\/:*?"<>|]/g, '_')
    anchor.href = url
    anchor.download = `${safeHospitalName}_${weekFilePart}.xlsx`
    anchor.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000)
  }

  return (
    <>
      <section className="page-heading reservation-page-heading">
        <div><p className="eyebrow">PLATFORM ADMIN</p><h1>업체별 이송내역</h1><p className="heading-subtitle">병원별 주간 예약을 확인하고 Excel 파일로 저장합니다.</p></div>
        <button className="form-cancel-button" type="button" onClick={() => { setError(''); setLoading(true); setRefreshKey((value) => value + 1) }} disabled={loading}>새로고침</button>
      </section>

      <div className="connection-banner"><span className="connection-indicator" /><div className="connection-copy"><strong>주간 내역 · {reservations.length}건</strong><span>지난 주차의 예약은 기존 기록에서 자동으로 병원별 정리됩니다. 병원별 엑셀 저장 버튼을 눌러 파일을 내려받으세요.</span></div></div>

      <section className="panel hospital-history-panel">
        <div className="history-week-toolbar">
          <button className="subtle-button" type="button" onClick={() => { setError(''); setLoading(true); setWeekStart((current) => new Date(current.getTime() - 7 * KOREA_DAY_MS)) }}>← 이전 주</button>
          <div><strong>{koreanWeekLabel(weekStart)}</strong><span>{weekFilePart}</span></div>
          <button className="subtle-button" type="button" onClick={() => { setError(''); setLoading(true); setWeekStart((current) => new Date(current.getTime() + 7 * KOREA_DAY_MS)) }} disabled={isCurrentWeek}>다음 주 →</button>
        </div>

        {error ? <div className="table-empty"><strong>{error}</strong><span>DB 테이블과 RLS 정책은 변경하지 않았습니다.</span></div>
          : loading ? <div className="table-empty"><strong>선택한 주의 병원별 예약을 불러오고 있습니다…</strong></div>
            : hospitals.length === 0 ? <div className="table-empty"><strong>등록된 병원이 없습니다</strong></div>
              : <div className="hospital-history-board">
                {hospitals.map((hospital) => {
                  const hospitalRows = reservations.filter((reservation) => reservation.hospital_id === hospital.id)
                  return (
                    <section className="hospital-history-lane" key={hospital.id}>
                      <header className="hospital-history-lane-header">
                        <div><h2>{hospital.name}</h2><span>{hospitalRows.length}건</span></div>
                        <button className="subtle-button" type="button" onClick={() => downloadHospitalWeek(hospital)}>엑셀 저장</button>
                      </header>
                      <div className="hospital-history-lane-body">
                        {hospitalRows.length === 0 ? <div className="history-lane-empty">이 주의 내역이 없습니다.</div>
                          : hospitalRows.map((reservation) => {
                            const patientName = patientNameFromNote(reservation.requested_note)
                            return <article className="hospital-history-card" key={reservation.id}>
                              <div className="history-card-top"><span className="reservation-id">#{reservation.id.slice(0, 8).toUpperCase()}</span><span className={`status-pill status-${reservation.status}`}>{statusLabels[reservation.status] ?? reservation.status}</span></div>
                              <h3>{patientName || '환자명 미등록'}</h3>
                              <p className="history-card-time">{formatScheduledAt(reservation.scheduled_at)}</p>
                              <div className="history-card-route"><span>{reservation.departure_address}</span><b>↓</b><span>{reservation.destination_address}</span></div>
                              <div className="history-card-details">
                                <span>보호자 {noteValue(reservation.requested_note, '보호자 연락처') || '미입력'}</span>
                                <span>감염 {noteValue(reservation.requested_note, '감염 여부') || '미확인'}</span>
                                <span>산소 {noteValue(reservation.requested_note, '산소 사용 여부') || '미입력'}</span>
                                <span>동승 {noteValue(reservation.requested_note, '동승 여부') || '미입력'}</span>
                              </div>
                            </article>
                          })}
                      </div>
                    </section>
                  )
                })}
              </div>}
      </section>
      <p className="role-note">파일 이름은 병원명과 선택 주차를 사용합니다. 예: 더조은요양병원_202611-1주차.xlsx. PC에 저장하려면 병원별 엑셀 저장 버튼을 눌러야 합니다.</p>
    </>
  )
}

function ReservationForm({
  session,
  hospitalId,
  canSubmitRequest,
  onCreated,
}: {
  session: Session | null
  hospitalId: string | null
  canSubmitRequest: boolean
  onCreated: () => void
}) {
  const [patientName, setPatientName] = useState('')
  const [departure, setDeparture] = useState('')
  const [destination, setDestination] = useState('')
  const [guardianPhone, setGuardianPhone] = useState('')
  const [infectionStatus, setInfectionStatus] = useState('확인 필요')
  const [oxygenRequired, setOxygenRequired] = useState(false)
  const [companionRequired, setCompanionRequired] = useState(false)
  const [scheduledAt, setScheduledAt] = useState(() => localDateTimeValue(new Date(Date.now() + 60 * 60_000)))
  const [tripType, setTripType] = useState<TripType>('one_way')
  const [waitingRequired, setWaitingRequired] = useState(false)
  const [waitingMinutes, setWaitingMinutes] = useState('0')
  const [requestedNote, setRequestedNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [minDateTime] = useState(() => localDateTimeValue(new Date()))

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!supabase || !session || !hospitalId) return
    if (new Date(scheduledAt).getTime() <= Date.now()) {
      setError('예약 일시는 현재 시각 이후로 선택해 주세요.')
      return
    }
    setBusy(true)
    setError('')
    const patientDetails = [
      '[환자 정보]',
      `환자명: ${patientName.trim()}`,
      `보호자 연락처: ${guardianPhone.trim()}`,
      `감염 여부: ${infectionStatus}`,
      `산소 사용 여부: ${oxygenRequired ? '필요' : '불필요'}`,
      `동승 여부: ${companionRequired ? '필요' : '불필요'}`,
    ].join('\n')
    const fullRequestNote = [patientDetails, requestedNote.trim() ? `[추가 요청]\n${requestedNote.trim()}` : '']
      .filter(Boolean).join('\n\n')
    try {
      const { error: insertError } = await supabase.from('reservations').insert({
        hospital_id: hospitalId,
        requested_by: session.user.id,
        departure_address: departure.trim(),
        destination_address: destination.trim(),
        scheduled_at: new Date(scheduledAt).toISOString(),
        trip_type: tripType,
        waiting_required: waitingRequired,
        waiting_minutes: waitingRequired ? Number(waitingMinutes) : 0,
        requested_note: fullRequestNote,
        status: 'requested',
      })
      if (insertError) {
        setError('예약 접수에 실패했습니다. 로그인 계정의 병원 정보와 예약 권한을 확인해 주세요.')
        return
      }
      setPatientName('')
      setDeparture('')
      setDestination('')
      setGuardianPhone('')
      setInfectionStatus('확인 필요')
      setOxygenRequired(false)
      setCompanionRequired(false)
      setScheduledAt(localDateTimeValue(new Date(Date.now() + 60 * 60_000)))
      setTripType('one_way')
      setWaitingRequired(false)
      setWaitingMinutes('0')
      setRequestedNote('')
      onCreated()
    } catch {
      setError('Supabase에 연결하지 못했습니다. 연결 설정을 확인해 주세요.')
    } finally {
      setBusy(false)
    }
  }

  const canSubmit = Boolean(supabase && session && hospitalId && canSubmitRequest)

  return (
    <section className="panel reservation-form-panel">
      <div className="panel-heading form-panel-heading">
        <div><p className="eyebrow">NEW TRANSPORT REQUEST</p><h2>신규 이송 예약</h2><p>환자 및 이송 정보를 입력해 예약 요청을 접수합니다.</p></div>
      </div>
      {!canSubmit && <div className="form-info-banner"><span className="connection-indicator" /><span>{!supabase ? '미리보기 화면입니다. Supabase 설정과 병원 담당자 로그인을 완료한 뒤 접수할 수 있습니다.' : !session ? '병원 직원 계정으로 로그인해야 접수할 수 있습니다.' : !canSubmitRequest ? '관리자 미리보기입니다. 실제 예약 접수는 병원 담당자 계정에서 할 수 있습니다.' : '로그인 계정에 연결된 병원 프로필이 필요합니다.'}</span></div>}
      <form className="reservation-form" onSubmit={handleSubmit}>
        <div className="form-grid">
          <label className="form-field"><span>환자명 <b>필수</b></span><input value={patientName} onChange={(event) => setPatientName(event.target.value)} autoComplete="off" maxLength={100} placeholder="환자 이름" required /></label>
          <label className="form-field"><span>보호자 연락처 <b>필수</b></span><input type="tel" autoComplete="tel" value={guardianPhone} onChange={(event) => setGuardianPhone(event.target.value)} maxLength={30} placeholder="010-0000-0000" required /></label>
          <label className="form-field"><span>출발지 <b>필수</b></span><input value={departure} onChange={(event) => setDeparture(event.target.value)} maxLength={300} placeholder="예: 서울시 ○○구 ○○로 00, ○○병원" required /></label>
          <label className="form-field"><span>목적지 <b>필수</b></span><input value={destination} onChange={(event) => setDestination(event.target.value)} maxLength={300} placeholder="예: 서울시 ○○구 ○○로 00, ○○병원" required /></label>
          <label className="form-field"><span>출발 시각 <b>필수</b></span><input type="datetime-local" min={minDateTime} value={scheduledAt} onChange={(event) => setScheduledAt(event.target.value)} required /></label>
          <label className="form-field"><span>감염 여부</span><select value={infectionStatus} onChange={(event) => setInfectionStatus(event.target.value)}><option value="확인 필요">확인 필요</option><option value="없음">없음</option><option value="있음">있음</option></select></label>
          <label className="form-field"><span>산소 사용 여부</span><select value={oxygenRequired ? 'yes' : 'no'} onChange={(event) => setOxygenRequired(event.target.value === 'yes')}><option value="no">필요 없음</option><option value="yes">필요함</option></select></label>
          <label className="form-field"><span>동승 여부</span><select value={companionRequired ? 'yes' : 'no'} onChange={(event) => setCompanionRequired(event.target.value === 'yes')}><option value="no">동승자 없음</option><option value="yes">동승자 있음</option></select></label>
          <label className="form-field"><span>운행 유형</span><select value={tripType} onChange={(event) => setTripType(event.target.value as TripType)}><option value="one_way">편도</option><option value="round_trip">왕복</option></select></label>
          <div className="form-field waiting-field">
            <span>현장 대기</span>
            <label className="checkbox-line"><input type="checkbox" checked={waitingRequired} onChange={(event) => setWaitingRequired(event.target.checked)} /><span>현장 대기가 필요합니다</span></label>
          </div>
          {waitingRequired && <label className="form-field"><span>대기 시간 (분)</span><input type="number" min="0" max="1440" step="15" value={waitingMinutes} onChange={(event) => setWaitingMinutes(event.target.value)} required /></label>}
          <label className="form-field note-field"><span>추가 요청 메모 <small>선택</small></span><textarea value={requestedNote} onChange={(event) => setRequestedNote(event.target.value)} rows={3} maxLength={300} placeholder="운행 담당자에게 전달할 내용을 입력하세요." /></label>
        </div>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="form-footer"><p>환자 정보와 연락처는 예약 요청 메모(requested_note)에 함께 저장됩니다.</p><div><button className="primary-button" type="submit" disabled={!canSubmit || busy}>{busy ? '접수 중…' : '예약 요청 접수'}</button></div></div>
      </form>
    </section>
  )
}

function ReservationManagement({
  session,
  profileRole,
  hospitalId,
  reservations,
  loading,
  error,
  hasMore,
  loadingMore,
  loadMoreError,
  onLoadMore,
  onRefresh,
}: {
  session: Session | null
  profileRole: string
  hospitalId: string | null
  reservations: ReservationRow[]
  loading: boolean
  error: string
  hasMore: boolean
  loadingMore: boolean
  loadMoreError: string
  onLoadMore: () => void
  onRefresh: () => void
}) {
  const [searchText, setSearchText] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [notice, setNotice] = useState('')
  const canRequest = profileRole === 'hospital_staff' || profileRole === 'hospital_admin'
  const canViewForm = !supabaseConfigured || canRequest
  const filteredReservations = reservations.filter((reservation) => {
    const matchesSearch = `${reservation.id} ${patientNameFromNote(reservation.requested_note)} ${reservation.departure_address} ${reservation.destination_address}`.toLowerCase().includes(searchText.toLowerCase())
    return matchesSearch && (statusFilter === 'all' || reservation.status === statusFilter)
  })

  return (
    <>
      <section className="page-heading reservation-page-heading">
        <div><p className="eyebrow">HOSPITAL WORKSPACE</p><h1>이송 예약 관리</h1><p className="heading-subtitle">이송 예약 현황과 배차 상태를 확인합니다.</p></div>
      </section>

      {!supabaseConfigured && <div className="connection-banner" role="status"><span className="connection-indicator" /><div className="connection-copy"><strong>화면 미리보기</strong><span>실제 예약 정보 없이 병원 직원 화면을 미리 볼 수 있습니다. DB 연결 후 권한에 맞는 예약만 표시됩니다.</span></div></div>}
      {notice && <div className="success-banner" role="status"><span>✓</span>{notice}</div>}

      <div className={`reservation-workspace-grid${canViewForm ? '' : ' list-only'}`}>
        {canViewForm && <ReservationForm session={session} hospitalId={hospitalId} canSubmitRequest={canRequest} onCreated={() => { setNotice('예약 요청이 접수되었습니다.'); onRefresh() }} />}
        <section className="panel reservation-management-panel">
        <div className="management-toolbar">
          <div><h2>예약 목록</h2><p>{loading ? '불러오는 중…' : `${reservations.length}건 표시 · 현재 계정에 허용된 예약`}</p></div>
          <div className="reservation-filters">
            <label className="search-field"><Icon name="search" size={16} /><input value={searchText} onChange={(event) => setSearchText(event.target.value)} placeholder="주소 또는 예약 번호 검색" /></label>
            <select aria-label="예약 상태 필터" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="all">전체 상태</option>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
          </div>
        </div>
        <div className="table-wrap">
          <table className="management-table">
            <thead><tr><th>예약 번호</th><th>출발지</th><th>목적지</th><th>희망 일시</th><th>상태</th>{profileRole === 'admin' && <th className="admin-action-heading">관리자 처리</th>}</tr></thead>
            <tbody>
              {loading ? <tr><td colSpan={profileRole === 'admin' ? 6 : 5}><div className="table-empty"><strong>예약 목록을 불러오고 있습니다…</strong></div></td></tr>
                : error ? <tr><td colSpan={profileRole === 'admin' ? 6 : 5}><div className="table-empty"><strong>{error}</strong><span>예약 조회 권한과 연결 상태를 확인해 주세요.</span></div></td></tr>
                  : filteredReservations.length ? filteredReservations.map((reservation) => <tr className="reservation-row" key={reservation.id}><td><span className="reservation-id">#{reservation.id.slice(0, 8).toUpperCase()}</span>{patientNameFromNote(reservation.requested_note) && <span className="reservation-patient-name">{patientNameFromNote(reservation.requested_note)}</span>}</td><td className="address-cell">{reservation.departure_address}<details className="reservation-details"><summary>예약 상세 · 운행 상태 · 수정/취소</summary><TripProgress reservation={reservation} /><p>{transportSummary(reservation)}</p><p>{reservation.requested_note || '추가 정보가 없습니다.'}</p><ReservationChanges reservation={reservation} admin={profileRole === 'admin'} onChanged={onRefresh} /></details></td><td className="address-cell">{reservation.destination_address}</td><td className="date-cell">{formatScheduledAt(reservation.scheduled_at)}</td><td><span className={`status-pill status-${reservation.status}`}>{statusLabels[reservation.status] ?? reservation.status}</span></td>{profileRole === 'admin' && <td className="admin-action-cell"><DispatchActions reservation={reservation} onChanged={onRefresh} /></td>}</tr>)
                    : <tr><td colSpan={profileRole === 'admin' ? 6 : 5}><div className="table-empty"><span className="table-empty-icon"><Icon name="calendar" size={20} /></span><strong>{searchText || statusFilter !== 'all' ? '검색 조건에 맞는 예약이 없습니다' : '접수된 예약이 없습니다'}</strong><span>예약 요청을 접수하면 이 목록에서 진행 상태를 확인할 수 있습니다.</span></div></td></tr>}
            </tbody>
          </table>
        </div>
        {reservations.length > 0 && <div className="management-footer"><span>검색은 현재 불러온 기록에서 찾습니다. 표시 데이터는 계정 권한에 따라 제한됩니다.</span><div className="management-footer-actions">{hasMore && <button className="subtle-button" type="button" onClick={onLoadMore} disabled={loadingMore}>{loadingMore ? '불러오는 중…' : '이전 예약 더 불러오기'}</button>}<button className="subtle-button" type="button" onClick={onRefresh}>새로고침</button></div></div>}
        {loadMoreError && <p className="form-error pagination-error" role="alert">{loadMoreError}</p>}
        </section>
      </div>
      {supabaseConfigured && session && !canRequest && <p className="role-note">예약 접수는 병원 담당자 계정에서 사용할 수 있습니다. 관리자는 예약 목록에서 9090 배차와 운행 상태를 처리할 수 있습니다.</p>}
    </>
  )
}

function DispatchActions({ reservation, onChanged }: { reservation: ReservationRow; onChanged: () => void }) {
  const [drivers, setDrivers] = useState<{id: string; name: string}[]>([])
  const [driverId, setDriverId] = useState('')
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const pending = ['requested', 'approval_pending'].includes(reservation.status)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 30000); return () => window.clearInterval(timer) }, [])
  const expired = now >= new Date(reservation.created_at).getTime() + 86400000
  async function prepare() {
    if (!supabase || busy) return
    setBusy(true); setError('')
    try {
      const result = await supabase.from('drivers').select('id, name').eq('is_active', true).order('name')
      if (result.error) throw result.error
      setDrivers(result.data ?? []); setOpen(true)
      if (!result.data?.length) setError('등록된 기사가 없습니다. 9090 기사 등록 후 배차할 수 있습니다.')
    } catch { setError('기사 목록을 불러오지 못했습니다. 다시 시도해 주세요.') }
    finally { setBusy(false) }
  }
  async function save() {
    if (!supabase || busy) return
    setBusy(true); setError('')
    try {
      const result = pending
        ? await supabase.rpc('dispatch_9090', {p_reservation_id: reservation.id, p_driver_id: driverId})
        : await supabase.rpc('advance_9090', {p_reservation_id: reservation.id, p_expected: reservation.status, p_next: reservation.status === 'confirmed' ? 'in_progress' : 'completed'})
      if (result.error) throw result.error
      if (!result.data) throw new Error('변경 결과를 확인하지 못했습니다.')
      setOpen(false); onChanged()
    } catch (err) { setError(err instanceof Error ? err.message : '처리하지 못했습니다. 상태를 새로고침해 확인해 주세요.') }
    finally { setBusy(false) }
  }
  async function finishPending(next: 'external_dispatch' | 'cancelled') {
    if (!supabase || busy) return
    setBusy(true); setError('')
    try {
      const result = await supabase.rpc('resolve_pending_reservation', { p_reservation_id: reservation.id, p_next: next })
      if (result.error) throw result.error
      if (!result.data) throw new Error('변경 결과를 확인하지 못했습니다.')
      onChanged()
    } catch (err) { setError(err instanceof Error ? err.message : '처리하지 못했습니다. 새로고침 후 다시 시도해 주세요.') }
    finally { setBusy(false) }
  }
  if (!pending && !['confirmed', 'in_progress'].includes(reservation.status)) return <span className="action-complete">처리 완료</span>
  return <div className="dispatch-actions">
    {pending && expired ? <small>24시간 경과 · 자동 취소 처리 대기</small> : pending ? <>
      {!open ? <div className="dispatch-choice-buttons">
        <button type="button" className="dispatch-primary-button" disabled={busy} onClick={() => void prepare()}>9090 배차</button>
        <button type="button" className="external-dispatch-button" disabled={busy} onClick={() => void finishPending('external_dispatch')}>타차량 배차</button>
        <button type="button" className="cancel-reservation-button" disabled={busy} onClick={() => void finishPending('cancelled')}>예약 취소</button>
      </div> : <>
        <label>9090 담당 기사<select aria-label="9090 담당 기사" value={driverId} onChange={event => setDriverId(event.target.value)} disabled={busy}><option value="">기사를 선택하세요</option>{drivers.map(driver => <option key={driver.id} value={driver.id}>{driver.name}</option>)}</select></label>
        <button type="button" className="primary-button" disabled={busy || !driverId} onClick={() => void save()}>{busy ? '처리 중…' : '배차완료 확정'}</button>
        <button type="button" className="subtle-button" disabled={busy} onClick={() => setOpen(false)}>닫기</button>
      </>}
    </> : <TripButtons reservation={reservation} onChanged={onChanged} />}
    {error && <p className="form-error" role="alert">{error}</p>}
  </div>
}

type InstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> }

function MobileAppTools() {
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null)
  const [notificationState, setNotificationState] = useState('idle')
  const [notice, setNotice] = useState('')
  useEffect(() => {
    const receivePrompt = (event: Event) => { event.preventDefault(); setInstallPrompt(event as InstallPromptEvent) }
    window.addEventListener('beforeinstallprompt', receivePrompt)
    return () => window.removeEventListener('beforeinstallprompt', receivePrompt)
  }, [])
  async function enableNotifications() {
    setNotificationState('busy')
    try { await connectPush(); setNotificationState('connected'); setNotice('이 기기의 푸시 구독을 서버에 등록했습니다.') }
    catch (error) { setNotificationState('idle'); setNotice(error instanceof Error ? error.message : '연결에 실패했습니다.') }
  }
  async function install() {
    if (!installPrompt) { setNotice('휴대폰 브라우저 메뉴에서 “홈 화면에 추가”를 선택해 주세요.'); return }
    await installPrompt.prompt(); await installPrompt.userChoice; setInstallPrompt(null)
  }
  return <section className="mobile-app-tools" aria-label="휴대폰 앱 설정">
    <div><strong>9090 휴대폰 앱</strong><span>홈 화면에 설치하고 배차 알림을 켜세요.</span></div>
    <button type="button" className="subtle-button" onClick={() => void install()}>휴대폰에 설치</button>
    <button type="button" className="primary-button" disabled={notificationState === 'busy'} onClick={() => void enableNotifications()}>{notificationState === 'busy' ? '연결 중…' : notificationState === 'connected' ? '알림 다시 연결' : '배차 알림 연결'}</button>
    {notice && <small>{notice}</small>}
  </section>
}

function MyTrips({ userId, onChanged, refreshToken }: { userId: string; onChanged: () => void; refreshToken: number }) {
  const [rows, setRows] = useState<ReservationRow[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [refresh, setRefresh] = useState(0)
  const [limit, setLimit] = useState(50)
  useEffect(() => {
    let active = true
    const load = async () => {
      if (!supabase) return
      try {
        const result = await supabase.from('reservations').select(reservationColumns)
          .eq('driver_id', userId).in('status', ['confirmed', 'in_progress']).order('scheduled_at').order('id').limit(limit)
        if (!active) return
        if (result.error) throw result.error
        setRows(result.data ?? []); setError('')
      } catch { if (active) setError('운행 목록을 갱신하지 못했습니다. 새로고침해 주세요.') }
      finally { if (active) setLoading(false) }
    }
    void load()
    const timer = window.setInterval(() => void load(), 5000)
    const channel = supabase?.channel(`my-trips-${userId}`).on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'reservations' }, () => void load()).subscribe()
    return () => { active = false; window.clearInterval(timer); if (channel) void supabase?.removeChannel(channel) }
  }, [userId, refresh, limit, refreshToken])
  return <section className="panel my-trips"><h1>내 운행 · 71나9090</h1><p>이동중 → 이송중 → 완료 순서로 처리하세요. 상태는 실시간으로 공유되며 연결 지연 시 5초마다 다시 확인합니다.</p>
    <MobileAppTools />
    <button type="button" className="subtle-button" onClick={() => setRefresh(v => v + 1)}>새로고침</button>
    {error && <p className="form-error" role="alert">{error}</p>}
    {loading ? <p>불러오는 중…</p> : !rows.length && !error ? <p>현재 배정된 운행이 없습니다.</p> : rows.map(r => <article className="trip-card" key={r.id}>
      <h2>{patientNameFromNote(r.requested_note) || '이송 예약'}</h2><p>{formatScheduledAt(r.scheduled_at)} · {statusLabels[r.status]}</p>
      <p><strong>{transportSummary(r)}</strong></p><p>{r.departure_address} → {r.destination_address}</p><p className="trip-notes">{r.requested_note}</p>
      <DispatchActions reservation={r} onChanged={() => { setRefresh(v => v + 1); onChanged() }} />
    </article>)}
    {rows.length === limit && <button type="button" className="subtle-button" onClick={() => setLimit(v => v + 50)}>다음 운행 더 보기</button>}
  </section>
}

function App() {
  const [adminActivePage, setAdminActivePage] = useState(() => window.location.hash === '#my-trips' ? '내 운행' : '대시보드')
  useEffect(() => {
    const openTrips = () => { if (window.location.hash === '#my-trips') setAdminActivePage('내 운행') }
    window.addEventListener('hashchange', openTrips)
    const onMessage = (event: MessageEvent) => { if (event.data?.type === 'OPEN_MY_TRIPS') setAdminActivePage('내 운행') }
    navigator.serviceWorker?.addEventListener('message', onMessage)
    return () => {
      window.removeEventListener('hashchange', openTrips)
      navigator.serviceWorker?.removeEventListener('message', onMessage)
    }
  }, [])
  const [session, setSession] = useState<Session | null>(null)
  const [authLoading, setAuthLoading] = useState(supabaseConfigured)
  const [passwordRecovery, setPasswordRecovery] = useState(false)
  const [passwordRecoveryBusy, setPasswordRecoveryBusy] = useState(false)
  const [passwordRecoveryError, setPasswordRecoveryError] = useState('')
  const [passwordRecoveryNotice, setPasswordRecoveryNotice] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [loginError, setLoginError] = useState('')
  const [signupNotice, setSignupNotice] = useState('')
  const [loginBusy, setLoginBusy] = useState(false)
  const [profileName, setProfileName] = useState('운영자')
  const [profileRole, setProfileRole] = useState('')
  const dashboardIsAdmin = profileRole === 'admin'
  const activePage = dashboardIsAdmin ? adminActivePage : '예약 관리'
  const setActivePage = setAdminActivePage
  const [profileHospitalId, setProfileHospitalId] = useState<string | null>(null)
  const [profileState, setProfileState] = useState<'loading' | 'ready' | 'pending' | 'inactive' | 'missing'>('loading')
  const [reservations, setReservations] = useState<ReservationRow[]>([])
  const [hasMoreReservations, setHasMoreReservations] = useState(false)
  const [loadingMoreReservations, setLoadingMoreReservations] = useState(false)
  const [loadMoreError, setLoadMoreError] = useState('')
  const [nextReservation, setNextReservation] = useState<ReservationRow | null>(null)
  const [upcomingError, setUpcomingError] = useState(false)
  const [reservationCounts, setReservationCounts] = useState({ today: null as number | null, pending: null as number | null, confirmed: null as number | null, inProgress: null as number | null, availableVehicles: null as number | null })
  const [reservationLoading, setReservationLoading] = useState(false)
  const [reservationError, setReservationError] = useState('')
  const [refreshKey, setRefreshKey] = useState(0)
  const refreshProfile = useCallback(() => setRefreshKey((value) => value + 1), [])
  const [today] = useState(() => new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  }).format(new Date()))

  useEffect(() => {
    const client = supabase
    if (!client) return

    let active = true
    void client.auth.getSession().then(({ data, error }) => {
      if (!active) return
      if (error) setLoginError('로그인 상태를 확인하지 못했습니다. 페이지를 새로고침해 주세요.')
      setSession(data.session)
      setProfileState(data.session ? 'loading' : 'ready')
      setAuthLoading(false)
    })
    const { data: { subscription } } = client.auth.onAuthStateChange((event, nextSession) => {
      if (event === 'PASSWORD_RECOVERY') {
        setPasswordRecovery(true)
        setPasswordRecoveryError('')
        setPasswordRecoveryNotice('')
      }
      setSession(nextSession)
      setProfileState(nextSession ? 'loading' : 'ready')
      setLoginError('')
    })

    return () => {
      active = false
      subscription.unsubscribe()
    }
  }, [])

  useEffect(() => {
    const client = supabase
    if (!client || !session?.user) return

    let active = true
    const loadDashboard = async () => {
      setReservationLoading(true)
      setReservationError('')

      const { data: profile, error: profileError } = await client.from('profiles')
        .select('full_name, role, hospital_id, is_active').eq('id', session.user.id).maybeSingle()

      if (!active) return
      if (profileError || !profile) {
        setProfileState('missing')
        setReservations([])
        setNextReservation(null)
        setUpcomingError(false)
        setReservationCounts({ today: null, pending: null, confirmed: null, inProgress: null, availableVehicles: null })
        setReservationLoading(false)
        return
      }
      if (profile?.full_name) setProfileName(profile.full_name)
      if (profile?.role) setProfileRole(profile.role)
      setProfileHospitalId(profile?.hospital_id ?? null)

      if (!profile.is_active) {
        setProfileState('inactive')
        setReservations([])
        setNextReservation(null)
        setUpcomingError(false)
        setReservationCounts({ today: null, pending: null, confirmed: null, inProgress: null, availableVehicles: null })
        setReservationLoading(false)
        return
      }
      if (profile.role !== 'admin' && !profile.hospital_id) {
        setProfileState('pending')
        setReservations([])
        setNextReservation(null)
        setUpcomingError(false)
        setReservationCounts({ today: null, pending: null, confirmed: null, inProgress: null, availableVehicles: null })
        setReservationLoading(false)
        return
      }
      setProfileState('ready')

      const [reservationResult, upcomingResult] = await Promise.all([
        client.from('reservations').select(reservationColumns)
          .order('created_at', { ascending: false }).order('id', { ascending: true }).limit(25),
        client.from('reservations').select(reservationColumns)
          .gte('scheduled_at', new Date().toISOString()).order('scheduled_at', { ascending: true }).limit(25),
      ])

      if (!active) return
      if (reservationResult.error) {
        setReservationError('예약 정보를 불러오지 못했습니다. 이 계정의 예약 조회 권한을 확인해 주세요.')
        setReservations([])
        setNextReservation(null)
        setUpcomingError(false)
        setReservationCounts({ today: null, pending: null, confirmed: null, inProgress: null, availableVehicles: null })
        setReservationLoading(false)
        return
      }

      const rows = (reservationResult.data ?? []) as ReservationRow[]
      setReservations(rows)
      setHasMoreReservations(rows.length === 25)
      setLoadMoreError('')
      const upcomingRows = (upcomingResult.data ?? []) as ReservationRow[]
      setUpcomingError(Boolean(upcomingResult.error))
      setNextReservation(upcomingRows.find((reservation) => !['completed', 'rejected', 'cancelled'].includes(reservation.status)) ?? null)

      const startOfToday = new Date()
      startOfToday.setHours(0, 0, 0, 0)
      const startOfTomorrow = new Date(startOfToday)
      startOfTomorrow.setDate(startOfTomorrow.getDate() + 1)
      const [todayResult, pendingResult, confirmedResult, inProgressResult] = await Promise.all([
        client.from('reservations').select('id', { count: 'exact', head: true })
          .gte('scheduled_at', startOfToday.toISOString()).lt('scheduled_at', startOfTomorrow.toISOString())
          .neq('status', 'cancelled').neq('status', 'rejected'),
        client.from('reservations').select('id', { count: 'exact', head: true }).eq('status', 'requested'),
        client.from('reservations').select('id', { count: 'exact', head: true }).eq('status', 'confirmed'),
        client.from('reservations').select('id', { count: 'exact', head: true }).eq('status', 'in_progress'),
      ])

      let availableVehicles: number | null = null
      if (profile?.role === 'admin') {
        const vehicleResult = await client.from('vehicles').select('id', { count: 'exact', head: true }).eq('status', 'available')
        if (!vehicleResult.error) availableVehicles = vehicleResult.count ?? 0
      }
      if (!active) return
      setReservationCounts({
        today: todayResult.error ? null : todayResult.count ?? 0,
        pending: pendingResult.error ? null : pendingResult.count ?? 0,
        confirmed: confirmedResult.error ? null : confirmedResult.count ?? 0,
        inProgress: inProgressResult.error ? null : inProgressResult.count ?? 0,
        availableVehicles,
      })
      setReservationLoading(false)
    }

    void loadDashboard().catch(() => {
      if (!active) return
      setReservationError('데이터를 불러오지 못했습니다. 연결 설정과 계정 권한을 확인해 주세요.')
      setReservationLoading(false)
    })

    return () => { active = false }
  }, [session, refreshKey])

  // Keep cross-account updates visible without unmounting forms or dispatch controls.
  useEffect(() => {
    const client = supabase
    if (!client || !session || profileState !== 'ready' || reservationLoading || loadingMoreReservations) return
    let active = true
    let fetching = false
    const refreshVisibleReservations = async () => {
      if (document.visibilityState === 'hidden' || fetching) return
      fetching = true
      try {
        const result = await client.from('reservations').select(reservationColumns)
          .order('created_at', { ascending: false }).order('id', { ascending: true })
          .limit(Math.max(25, reservations.length))
        if (!active) return
        if (result.error) throw result.error
        setReservations(result.data as ReservationRow[])
        setHasMoreReservations(result.data.length >= Math.max(25, reservations.length))
        setReservationError('')
      } catch {
        if (active) setReservationError('예약 자동 갱신에 실패했습니다. 연결을 확인하고 새로고침해 주세요.')
      } finally { fetching = false }
    }
    const timer = window.setInterval(() => void refreshVisibleReservations(), 5000)
    const channel = client.channel(`reservation-progress-${session.user.id}`).on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'reservations' }, () => void refreshVisibleReservations()).subscribe()
    const resume = () => { void refreshVisibleReservations() }
    document.addEventListener('visibilitychange', resume)
    window.addEventListener('online', resume)
    return () => {
      active = false
      window.clearInterval(timer)
      void client.removeChannel(channel)
      document.removeEventListener('visibilitychange', resume)
      window.removeEventListener('online', resume)
    }
  }, [session, profileState, reservationLoading, loadingMoreReservations, reservations.length, refreshKey])

  const loadMoreReservations = useCallback(async () => {
    if (!supabase || loadingMoreReservations || !hasMoreReservations) return
    setLoadingMoreReservations(true)
    setLoadMoreError('')
    try {
      const start = reservations.length
      const { data, error } = await supabase.from('reservations')
        .select(reservationColumns)
        .order('created_at', { ascending: false }).order('id', { ascending: true }).range(start, start + 24)
      if (error) throw error
      const nextRows = (data ?? []) as ReservationRow[]
      setReservations((current) => [...current, ...nextRows])
      setHasMoreReservations(nextRows.length === 25)
    } catch {
      setLoadMoreError('이전 예약을 불러오지 못했습니다. 연결 상태와 계정 권한을 확인한 뒤 다시 시도해 주세요.')
    } finally {
      setLoadingMoreReservations(false)
    }
  }, [hasMoreReservations, loadingMoreReservations, reservations.length])

  const handleLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!supabase) return
    setLoginBusy(true)
    setLoginError('')
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) setLoginError('로그인에 실패했습니다. 계정 정보와 프로젝트 접속 설정을 확인해 주세요.')
    } catch {
      setLoginError('Supabase에 연결하지 못했습니다. 네트워크와 프로젝트 설정을 확인해 주세요.')
    } finally {
      setLoginBusy(false)
    }
  }

  const handleSignUp = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!supabase) return
    setLoginBusy(true)
    setLoginError('')
    setSignupNotice('')
    try {
      const { data, error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          data: { full_name: fullName.trim() },
          emailRedirectTo: window.location.origin,
        },
      })
      if (error) {
        setLoginError('가입 신청을 완료하지 못했습니다. 이메일 사용 여부와 비밀번호 조건을 확인해 주세요.')
      } else {
        setPassword('')
        setSignupNotice(data.session
          ? '가입 신청이 접수되었습니다. 이메일을 확인한 뒤 관리자 승인을 기다려 주세요.'
          : '확인 이메일을 보냈습니다. 이메일 주소를 확인하면 관리자가 병원과 권한을 연결합니다.')
      }
    } catch {
      setLoginError('Supabase에 연결하지 못했습니다. 네트워크와 프로젝트 설정을 확인해 주세요.')
    } finally {
      setLoginBusy(false)
    }
  }

  const handleRequestPasswordReset = async () => {
    if (!supabase) return
    const recoveryEmail = email.trim()
    if (!recoveryEmail || !recoveryEmail.includes('@')) {
      setLoginError('비밀번호 재설정 이메일을 받을 계정 이메일을 먼저 입력해 주세요.')
      setSignupNotice('')
      return
    }
    setLoginError('')
    setSignupNotice('')
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(recoveryEmail, {
        redirectTo: window.location.origin,
      })
      if (error) {
        setLoginError('재설정 이메일을 보내지 못했습니다. 잠시 후 다시 시도하거나 관리자에게 문의해 주세요.')
        return
      }
      setSignupNotice('해당 이메일로 계정이 등록되어 있다면 비밀번호 재설정 링크가 전송됩니다. 받은편지함을 확인해 주세요.')
    } catch {
      setLoginError('Supabase에 연결하지 못했습니다. 네트워크 상태를 확인해 주세요.')
    }
  }

  const handlePasswordRecoverySubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!supabase) return
    const form = event.currentTarget
    const passwordInput = form.elements.namedItem('new-password')
    const newPassword = passwordInput instanceof HTMLInputElement ? passwordInput.value : ''
    setPasswordRecoveryBusy(true)
    setPasswordRecoveryError('')
    setPasswordRecoveryNotice('')
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword })
      if (error) {
        setPasswordRecoveryError('비밀번호를 변경하지 못했습니다. 재설정 링크가 만료되지 않았는지 확인해 주세요.')
        return
      }
      await supabase.auth.signOut()
      setPasswordRecovery(false)
      setPasswordRecoveryNotice('')
      setSignupNotice('비밀번호가 변경되었습니다. 새 비밀번호로 로그인해 주세요.')
    } catch {
      setPasswordRecoveryError('비밀번호를 변경하지 못했습니다. 재설정 링크를 다시 요청해 주세요.')
    } finally {
      setPasswordRecoveryBusy(false)
    }
  }

  const handleSignOut = async () => {
    if (!supabase) return
    await supabase.auth.signOut()
    setProfileName('운영자')
    setProfileRole('')
    setProfileHospitalId(null)
    setProfileState('ready')
    setPasswordRecovery(false)
    setReservations([])
    setHasMoreReservations(false)
    setLoadMoreError('')
    setNextReservation(null)
    setUpcomingError(false)
    setReservationError('')
    setReservationLoading(false)
    setReservationCounts({ today: null, pending: null, confirmed: null, inProgress: null, availableVehicles: null })
  }

  const sidebarNav = dashboardIsAdmin ? mainNav : hospitalNav
  const dashboardStats = dashboardIsAdmin ? adminStats : hospitalStats
  if (authLoading) {
    return <main className="auth-loading"><span className="loading-spinner" /><p>로그인 상태를 확인하고 있습니다.</p></main>
  }
  if (passwordRecovery) {
    return <PasswordRecoveryScreen busy={passwordRecoveryBusy} error={passwordRecoveryError} notice={passwordRecoveryNotice} onSubmit={handlePasswordRecoverySubmit} onCancel={() => void handleSignOut()} />
  }
  if (supabaseConfigured && !session) {
    return <LoginScreen email={email} password={password} fullName={fullName} error={loginError} notice={signupNotice} busy={loginBusy} onEmailChange={setEmail} onPasswordChange={setPassword} onFullNameChange={setFullName} onSubmit={handleLogin} onSignUp={handleSignUp} onRequestPasswordReset={() => void handleRequestPasswordReset()} />
  }
  if (supabaseConfigured && session && profileState === 'loading') {
    return <main className="auth-loading"><span className="loading-spinner" /><p>계정 승인 상태를 확인하고 있습니다.</p></main>
  }
  if (supabaseConfigured && session && (profileState === 'pending' || profileState === 'inactive' || profileState === 'missing')) {
    return <AccountGate name={profileName} state={profileState} onRefresh={refreshProfile} onSignOut={() => void handleSignOut()} />
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href={dashboardIsAdmin ? '#dashboard' : '#reservations'} onClick={() => setActivePage(dashboardIsAdmin ? '대시보드' : '예약 관리')}>
          <span className="brand-mark"><Icon name="ambulance" size={22} /></span>
          <span className="brand-copy"><strong>EMS CONNECT</strong><small>응급 이송 통합 관리</small></span>
        </a>

        <div className="workspace-switcher">
          <span className="workspace-avatar">E</span>
          <span className="workspace-copy"><strong>{dashboardIsAdmin ? 'EMS 운영센터' : '병원 워크스페이스'}</strong><small>{dashboardIsAdmin ? '운영 워크스페이스' : '병원 업무 공간'}</small></span>
        </div>

        <nav className="sidebar-nav" aria-label="주 메뉴">
          <p className="nav-label">{dashboardIsAdmin ? '업무' : '병원 업무'}</p>
          {sidebarNav.map((item) => <NavButton key={item.label} item={item} active={activePage === item.label} onClick={() => setActivePage(item.label)} />)}
          {profileRole === 'admin' && <><NavButton item={{ label: '내 운행', icon: 'calendar' }} active={activePage === '내 운행'} onClick={() => setActivePage('내 운행')} /><p className="nav-label">관리</p><NavButton item={{ label: '가입 승인', icon: 'history' }} active={activePage === '가입 승인'} onClick={() => setActivePage('가입 승인')} /><NavButton item={{ label: '업체별 이송내역', icon: 'calendar' }} active={activePage === '업체별 이송내역'} onClick={() => setActivePage('업체별 이송내역')} /></>}
        </nav>

        <div className="sidebar-bottom">
          <div className="user-card">
            <div className="user-avatar">{profileName.slice(0, 1) || '관'}</div>
            <div className="user-copy"><strong>{session ? profileName : '미로그인'}</strong><small>{session ? roleLabel(profileRole) : '로그인 정보 필요'}</small></div>
            {session && <button className="signout-button" type="button" onClick={() => void handleSignOut()}>로그아웃</button>}
          </div>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div className="breadcrumb"><span>{dashboardIsAdmin ? 'EMS 운영' : '병원 업무'}</span><span className="breadcrumb-divider">/</span><strong>{activePage}</strong></div>
          <div className="topbar-actions">
            <span className="today-label">{today}</span>
            <button className="icon-button" type="button" aria-label="예약 목록 열기" title="예약 목록" onClick={() => setActivePage('예약 관리')}><Icon name="search" /></button>
            <button className="icon-button" type="button" aria-label="현재 화면 새로고침" title="현재 화면 새로고침" onClick={() => setRefreshKey((value) => value + 1)} disabled={!session}><Icon name="refresh" /></button>
            <div className="topbar-divider" />
            <div className="top-avatar" aria-label={session ? profileName : '미로그인'}>{profileName.slice(0, 1) || '관'}</div>
          </div>
        </header>

        <div className="page-wrap">
          {activePage === '내 운행' && profileRole === 'admin' && session ? (<MyTrips userId={session.user.id} onChanged={refreshProfile} refreshToken={refreshKey} />) : activePage === '업체별 이송내역' && profileRole === 'admin' ? (
            <HospitalTransferHistory refreshToken={refreshKey} />
          ) : activePage === '가입 승인' && profileRole === 'admin' ? (
            <ApprovalManagement refreshToken={refreshKey} />
          ) : activePage === '대시보드' && dashboardIsAdmin ? (
            <>
              <section className="page-heading">
                <div>
                  <p className="eyebrow">EMS CONNECT · OPERATIONS OVERVIEW</p>
                  <h1>안녕하세요, {session ? profileName : '병원 담당자'}님 <span className="wave">✦</span></h1>
                  <p className="heading-subtitle">{dashboardIsAdmin ? '가입 신청과 이송 운영 현황을 확인하세요.' : '새 이송을 신청하고 예약 진행 상태를 확인하세요.'}</p>
                </div>
                <button className="primary-button" type="button" onClick={() => setActivePage(dashboardIsAdmin ? '가입 승인' : '예약 관리')}>
                  <span className="button-plus">＋</span> {dashboardIsAdmin ? '가입 신청 검토' : '새 예약 신청'}
                </button>
              </section>

              <div className={`connection-banner${supabaseConfigured ? ' configured' : ''}`} role="status">
            <span className="connection-indicator" />
                <div className="connection-copy">
              <strong>{session ? '로그인 세션 확인됨 · RLS 적용' : 'Supabase 연결 설정이 필요합니다'}</strong>
              <span>{session ? '현재 계정에 허용된 예약만 읽어옵니다.' : '환경 설정과 기존 계정 로그인이 완료되면 실제 예약을 읽습니다.'}</span>
                </div>
            <span className="connection-step">{session ? (profileRole ? roleLabel(profileRole) : '계정 권한 확인 중') : '로그인 정보가 아직 설정되지 않음'}</span>
              </div>

              <section className="stats-grid" aria-label={dashboardIsAdmin ? '운영 현황 요약' : '병원 이송 현황 요약'}>
                {dashboardStats.map((stat) => {
                  const value = reservationCounts[stat.key]
                  const displayValue = !session ? '—' : reservationLoading ? '…' : value === null ? '—' : value
                  const footnote = !session ? 'DB 연결 후 표시됩니다'
                    : stat.key === 'availableVehicles' && profileRole !== 'admin' ? '관리자 계정에서만 조회 가능'
                      : reservationLoading ? '불러오는 중'
                        : value === null ? '조회 권한 또는 연결 확인 필요' : '허용된 예약 기준'
                  return <article className="stat-card" key={stat.label}>
                    <div className="stat-top"><span className={`stat-icon ${stat.tone}`}><Icon name={stat.icon} size={18} /></span><span className="stat-more">···</span></div>
                    <p className="stat-label">{stat.label}</p>
                    <div className="stat-value-row"><strong className="stat-value">{displayValue}</strong><span className="stat-unit">{stat.unit}</span></div>
                    <p className="stat-footnote">{footnote}</p>
                  </article>
                })}
              </section>

              <div className="content-grid">
                <section className="panel dashboard-workflow-panel">
                  <div className="panel-heading">
                    <div><h2>{dashboardIsAdmin ? '가입 신청 승인' : '이송 예약 진행 순서'}</h2><p>{dashboardIsAdmin ? '병원 직원의 가입 신청을 검토합니다.' : '신청한 이송 요청의 진행 상태를 확인하세요.'}</p></div>
                  </div>
                  <ol className="workflow-steps">
                    {dashboardIsAdmin ? <>
                      <li><span>1</span><div><strong>가입자 확인</strong><small>신청자 UID로 등록 정보를 확인합니다.</small></div></li>
                      <li><span>2</span><div><strong>병원과 권한 선택</strong><small>소속 병원과 병원 담당자 권한을 지정합니다.</small></div></li>
                      <li><span>3</span><div><strong>승인</strong><small>승인 후 병원 직원이 예약을 신청할 수 있습니다.</small></div></li>
                    </> : <>
                      <li><span>1</span><div><strong>이송 예약 신청</strong><small>출발지, 목적지, 희망 일시를 입력합니다.</small></div></li>
                      <li><span>2</span><div><strong>배차 확인</strong><small>배차 담당자가 요청을 검토하고 결과를 반영합니다.</small></div></li>
                      <li><span>3</span><div><strong>운행 상태 확인</strong><small>예약 목록에서 접수부터 완료까지 상태를 확인합니다.</small></div></li>
                    </>}
                  </ol>
                  <button className="wide-secondary-button" type="button" onClick={() => setActivePage(dashboardIsAdmin ? '가입 승인' : '예약 관리')}>
                    {dashboardIsAdmin ? '가입 신청 확인하기' : '예약 목록 보기'} <Icon name="arrow" size={15} />
                  </button>
                </section>

                <section className="panel next-reservation-panel">
                  <div className="panel-heading">
                    <div><h2>{dashboardIsAdmin ? '예정된 이송' : '가장 가까운 이송'}</h2><p>예약 일시가 빠른 순서</p></div>
                    {nextReservation && <span className="queue-badge">{statusLabels[nextReservation.status]}</span>}
                  </div>
                  {nextReservation ? <div className="upcoming-reservation">
                    <p className="upcoming-date"><Icon name="calendar" size={16} />{formatScheduledAt(nextReservation.scheduled_at)}</p>
                    <div className="upcoming-route"><span>{nextReservation.departure_address}</span><b>↓</b><span>{nextReservation.destination_address}</span></div>
                    <p className="upcoming-id">예약 번호 #{nextReservation.id.slice(0, 8).toUpperCase()}</p>
                  </div> : <div className="empty-state compact-empty">
                    <span className="empty-icon"><Icon name="calendar" size={22} /></span>
                    <strong>{reservationLoading ? '예약 정보를 불러오고 있습니다…' : upcomingError ? '예정 일정을 불러오지 못했습니다' : '예정된 이송이 없습니다'}</strong>
                    <span>{upcomingError ? '예약 조회 권한을 확인한 뒤 새로고침해 주세요.' : dashboardIsAdmin ? '예약이 접수되면 이곳에서 가장 가까운 일정을 확인할 수 있습니다.' : '새 이송을 신청하면 배차 진행 상황을 이곳에서 확인할 수 있습니다.'}</span>
                  </div>}
                  <button className="wide-secondary-button" type="button" onClick={() => setActivePage('예약 관리')}>예약 관리로 이동 <Icon name="arrow" size={15} /></button>
                </section>
              </div>

              <section className="panel reservations-panel">
                <div className="panel-heading reservation-heading">
                  <div><h2>최근 예약</h2><p>최근 접수된 이송 예약 내역</p></div>
                  <button className="subtle-button" type="button" onClick={() => setActivePage('예약 관리')}>예약 목록 보기 <Icon name="arrow" size={15} /></button>
                </div>
                <div className="table-wrap">
                  <table>
                    <thead><tr><th>예약 정보</th><th>출발지</th><th>목적지</th><th>예약 일시</th><th>상태</th></tr></thead>
                    <tbody>
                      {reservationLoading ? <tr><td colSpan={5}><div className="table-empty"><strong>예약을 불러오고 있습니다…</strong></div></td></tr>
                        : reservationError ? <tr><td colSpan={5}><div className="table-empty"><strong>{reservationError}</strong><span>DB 테이블이나 RLS 정책은 변경하지 않았습니다.</span></div></td></tr>
                          : reservations.length > 0 ? reservations.slice(0, 5).map((reservation) => (
                            <tr className="reservation-row" key={reservation.id}>
                              <td><span className="reservation-id">#{reservation.id.slice(0, 8).toUpperCase()}</span></td>
                              <td className="address-cell">{reservation.departure_address}<details className="reservation-details"><summary>예약 상세 보기</summary><p>{transportSummary(reservation)}</p><p>{reservation.requested_note || '추가 정보가 없습니다.'}</p></details></td>
                              <td className="address-cell">{reservation.destination_address}</td>
                              <td className="date-cell">{formatScheduledAt(reservation.scheduled_at)}</td>
                              <td><span className={`status-pill status-${reservation.status}`}>{statusLabels[reservation.status] ?? reservation.status}</span></td>
                            </tr>
                          ))
                            : <tr><td colSpan={5}><div className="table-empty"><span className="table-empty-icon"><Icon name="calendar" size={20} /></span><strong>표시할 예약이 없습니다</strong><span>현재 계정에 RLS가 허용한 예약만 이곳에 표시됩니다.</span></div></td></tr>}
                    </tbody>
                  </table>
                </div>
              </section>

              <footer className="page-footer"><span>EMS CONNECT <b>·</b> 응급 이송 운영 플랫폼</span><span>안전하고 신속한 이송을 위해</span></footer>
            </>
          ) : activePage === '예약 관리' ? (
            <ReservationManagement
              session={session}
              profileRole={profileRole}
              hospitalId={profileHospitalId}
              reservations={reservations}
              loading={reservationLoading}
              error={reservationError}
              hasMore={hasMoreReservations}
              loadingMore={loadingMoreReservations}
              loadMoreError={loadMoreError}
              onLoadMore={() => void loadMoreReservations()}
              onRefresh={() => setRefreshKey((value) => value + 1)}
            />
          ) : (
            <section className="coming-soon panel">
              <span className="coming-icon"><Icon name={mainNav.find((item) => item.label === activePage)?.icon ?? 'settings'} size={23} /></span>
              <p className="eyebrow">EMS CONNECT</p>
              <h1>{activePage}</h1>
              <p>기존 Supabase 권한과 로그인 흐름을 검토한 뒤 이 화면을 연결합니다.</p>
              <button className="primary-button" type="button" onClick={() => setActivePage('대시보드')}>대시보드로 돌아가기</button>
            </section>
          )}
        </div>
      </main>
    </div>
  )
}

export default App
