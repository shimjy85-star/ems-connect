-- Additive migration; existing reservation/profile policies are not replaced.
begin;
create table if not exists public.reservation_changes (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null references public.reservations(id),
  hospital_id uuid not null references public.hospitals(id),
  requested_by uuid not null references public.profiles(id),
  kind text not null check(kind in ('edit','cancel')),
  proposed jsonb not null default '{}',
  before_data jsonb not null,
  base_version timestamptz not null,
  reason text not null check(length(trim(reason)) between 1 and 500),
  state text not null check(state in ('pending','applied','rejected')),
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists one_pending_reservation_change on public.reservation_changes(reservation_id) where state='pending';
alter table public.reservation_changes enable row level security;
revoke all on public.reservation_changes from anon,authenticated;
grant select on public.reservation_changes to authenticated;
create policy read_authorized_changes on public.reservation_changes for select to authenticated using (
  exists(select 1 from public.profiles p where p.id=auth.uid() and p.is_active
    and (p.role='admin' or (p.role in ('hospital_admin','hospital_staff') and p.hospital_id=reservation_changes.hospital_id)))
);

-- Internal helper; never directly callable by browser roles.
create or replace function public.validate_reservation_change(r public.reservations,p_kind text,p_data jsonb)
returns public.reservations language plpgsql set search_path='' as $$
declare v public.reservations;
begin
  if p_kind='cancel' and p_data='{}'::jsonb then return r; end if;
  if p_kind is distinct from 'edit' or jsonb_typeof(p_data) is distinct from 'object' or exists (
    select 1 from jsonb_object_keys(p_data) k where k not in
      ('departure_address','destination_address','scheduled_at','trip_type','waiting_required','waiting_minutes','requested_note')
  ) then raise exception '허용되지 않은 변경 항목입니다.'; end if;
  select * into v from jsonb_populate_record(r,p_data);
  if v.departure_address is null or length(trim(v.departure_address)) not between 1 and 300
    or v.destination_address is null or length(trim(v.destination_address)) not between 1 and 300
    or v.scheduled_at is null or v.scheduled_at<=clock_timestamp()
    or v.trip_type is null or v.trip_type::text not in ('one_way','round_trip')
    or v.waiting_required is null or v.waiting_minutes is null or v.waiting_minutes not between 0 and 1440
    or v.requested_note is null or length(v.requested_note)>2000
  then raise exception '출발 시각과 필수 예약 정보를 확인해 주세요.'; end if;
  return v;
end $$;
revoke all on function public.validate_reservation_change(public.reservations,text,jsonb) from public,anon,authenticated;

create or replace function public.apply_reservation_change(p_id uuid,p_kind text,p_data jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare r public.reservations; v public.reservations;
begin
  select * into strict r from public.reservations where id=p_id for update;
  v:=public.validate_reservation_change(r,p_kind,p_data);
  if p_kind='cancel' then
    update public.reservations set status='cancelled',driver_id=null,vehicle_id=null where id=p_id;
    return;
  end if;
  update public.reservations set departure_address=trim(v.departure_address),destination_address=trim(v.destination_address),
    scheduled_at=v.scheduled_at,trip_type=v.trip_type,waiting_required=v.waiting_required,
    waiting_minutes=case when v.waiting_required then v.waiting_minutes else 0 end,requested_note=v.requested_note where id=p_id;
end $$;
revoke all on function public.apply_reservation_change(uuid,text,jsonb) from public,anon,authenticated;

create or replace function public.submit_reservation_change(p_id uuid,p_version timestamptz,p_kind text,p_data jsonb,p_reason text)
returns uuid language plpgsql security definer set search_path='' as $$
declare r public.reservations; actor public.profiles; change_id uuid; next_state text;
begin
  select * into actor from public.profiles where id=auth.uid() and is_active;
  if not found then raise exception '활성 계정으로 로그인해 주세요.'; end if;
  select * into r from public.reservations where id=p_id for update;
  if not found or (actor.role='admin' or (actor.role in ('hospital_admin','hospital_staff') and actor.hospital_id=r.hospital_id)) is not true
    then raise exception '예약을 변경할 권한이 없습니다.'; end if;
  if p_version is null or r.updated_at is distinct from p_version then raise exception '예약이 변경됐습니다. 새로고침 후 다시 시도해 주세요.'; end if;
  if r.status not in ('requested','approval_pending','confirmed','external_dispatch') then raise exception '운행 중이거나 종료된 예약은 변경할 수 없습니다.'; end if;
  if r.status in ('requested','approval_pending') and r.created_at<=clock_timestamp()-interval '24 hours' then raise exception '접수 후 24시간이 지난 예약입니다.'; end if;
  if p_kind is null or p_kind not in ('edit','cancel') or p_reason is null or length(trim(p_reason)) not between 1 and 500
    or p_data is null or jsonb_typeof(p_data)<>'object' then raise exception '변경 내용과 사유를 확인해 주세요.'; end if;
  if exists(select 1 from public.reservation_changes where reservation_id=p_id and state='pending') then raise exception '이미 승인 대기 중인 요청이 있습니다.'; end if;
  perform public.validate_reservation_change(r,p_kind,p_data);
  next_state:=case when actor.role='admin' or r.status in ('requested','approval_pending') then 'applied' else 'pending' end;
  insert into public.reservation_changes(reservation_id,hospital_id,requested_by,kind,proposed,before_data,base_version,reason,state,reviewed_by,reviewed_at)
  values(r.id,r.hospital_id,actor.id,p_kind,p_data,to_jsonb(r),r.updated_at,trim(p_reason),next_state,
    case when next_state='applied' then actor.id end,case when next_state='applied' then now() end) returning id into change_id;
  if next_state='applied' then perform public.apply_reservation_change(r.id,p_kind,p_data); end if;
  return change_id;
end $$;
revoke all on function public.submit_reservation_change(uuid,timestamptz,text,jsonb,text) from public,anon;
grant execute on function public.submit_reservation_change(uuid,timestamptz,text,jsonb,text) to authenticated;

create or replace function public.review_reservation_change(p_change_id uuid,p_approve boolean)
returns uuid language plpgsql security definer set search_path='' as $$
declare c public.reservation_changes; r public.reservations;
begin
  if not exists(select 1 from public.profiles where id=auth.uid() and role='admin' and is_active) then raise exception '관리자만 승인할 수 있습니다.'; end if;
  if p_approve is null then raise exception '승인 여부를 선택해 주세요.'; end if;
  select * into c from public.reservation_changes where id=p_change_id;
  if not found then raise exception '요청을 찾을 수 없습니다.'; end if;
  -- Same lock order as submission: reservation first, then request.
  select * into strict r from public.reservations where id=c.reservation_id for update;
  select * into strict c from public.reservation_changes where id=p_change_id for update;
  if c.state<>'pending' then raise exception '이미 처리된 요청입니다.'; end if;
  if p_approve then
    if r.updated_at is distinct from c.base_version or r.status not in ('confirmed','external_dispatch') then
      raise exception '예약 상태가 변경되어 승인할 수 없습니다. 요청을 반려하고 현재 예약을 확인해 주세요.';
    end if;
    perform public.apply_reservation_change(r.id,c.kind,c.proposed);
  end if;
  update public.reservation_changes set state=case when p_approve then 'applied' else 'rejected' end,
    reviewed_by=auth.uid(),reviewed_at=now() where id=c.id;
  return c.id;
end $$;
revoke all on function public.review_reservation_change(uuid,boolean) from public,anon;
grant execute on function public.review_reservation_change(uuid,boolean) to authenticated;
commit;
