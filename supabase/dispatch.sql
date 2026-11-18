-- Existing tables and RLS policies are preserved. Apply as project owner.
-- PostgreSQL requires a newly added enum value to be committed before functions use it.
alter type public.reservation_status add value if not exists 'external_dispatch';
commit;
begin;
insert into public.vehicles(vehicle_number)
select '71나9090' where not exists (select 1 from public.vehicles where vehicle_number='71나9090');

-- The designated administrator also acts as the 9090 driver. Reuse the profile UUID.
insert into public.drivers(id,name) select id,full_name from public.profiles
where id='60874bf9-2dec-4e86-b733-6cc242787f4f' and role='admin' and is_active
on conflict(id) do nothing;

create or replace function public.dispatch_9090(p_reservation_id uuid, p_driver_id uuid)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare r public.reservations; v uuid;
begin
  if not public.is_platform_admin() then raise exception '관리자만 배차할 수 있습니다.'; end if;
  select * into r from public.reservations where id=p_reservation_id for update;
  if not found then raise exception '예약을 찾을 수 없습니다.'; end if;
  if r.status not in ('requested','approval_pending') then raise exception '이미 처리된 예약입니다. 새로고침해 주세요.'; end if;
  if r.created_at <= clock_timestamp()-interval '24 hours' then raise exception '접수 후 24시간이 지나 배차할 수 없습니다.'; end if;
  if r.scheduled_at <= clock_timestamp() then raise exception '출발 예정 시각이 지났습니다.'; end if;
  select id into strict v from public.vehicles where vehicle_number='71나9090' and status <> 'maintenance';
  if not exists(select 1 from public.drivers d join public.profiles p on p.id=d.id where d.id=p_driver_id and d.is_active and p.is_active and p.role='admin') then raise exception '활성 기사를 선택해 주세요.'; end if;
  update public.reservations set status='confirmed', vehicle_id=v, driver_id=p_driver_id,
    approved_by=auth.uid(), approved_at=clock_timestamp() where id=r.id;
  return r.id;
end $$;
revoke all on function public.dispatch_9090(uuid,uuid) from public, anon;
grant execute on function public.dispatch_9090(uuid,uuid) to authenticated;

create or replace function public.advance_9090(p_reservation_id uuid, p_expected public.reservation_status, p_next public.reservation_status)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare changed uuid;
begin
  if not public.is_platform_admin() then raise exception '관리자만 처리할 수 있습니다.'; end if;
  if not ((p_expected='confirmed' and p_next='in_progress') or (p_expected='in_progress' and p_next='completed')) then
    raise exception '허용되지 않은 상태 변경입니다.';
  end if;
  update public.reservations set status=p_next where id=p_reservation_id and status=p_expected
    and vehicle_id in (select id from public.vehicles where vehicle_number='71나9090') returning id into changed;
  if changed is null then raise exception '예약 상태가 변경됐습니다. 새로고침해 주세요.'; end if;
  return changed;
end $$;
revoke all on function public.advance_9090(uuid,public.reservation_status,public.reservation_status) from public, anon;
grant execute on function public.advance_9090(uuid,public.reservation_status,public.reservation_status) to authenticated;

create or replace function public.resolve_pending_reservation(p_reservation_id uuid, p_next public.reservation_status)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare changed uuid;
begin
  if not public.is_platform_admin() then raise exception '관리자만 처리할 수 있습니다.'; end if;
  if p_next not in ('external_dispatch','cancelled') then raise exception '허용되지 않은 상태입니다.'; end if;
  update public.reservations set status=p_next, approved_by=auth.uid(), approved_at=clock_timestamp(), vehicle_id=null, driver_id=null
  where id=p_reservation_id and status in ('requested','approval_pending')
    and created_at > clock_timestamp()-interval '24 hours' returning id into changed;
  if changed is null then raise exception '이미 처리됐거나 24시간이 지난 예약입니다. 새로고침해 주세요.'; end if;
  return changed;
end $$;
revoke all on function public.resolve_pending_reservation(uuid,public.reservation_status) from public, anon;
grant execute on function public.resolve_pending_reservation(uuid,public.reservation_status) to authenticated;

create extension if not exists pg_cron;
-- Atomic conditional UPDATE serializes with dispatch_9090's row lock.
select cron.schedule('ems-expire-unassigned-24h', '* * * * *',
  $job$update public.reservations set status='cancelled'
  where status in ('requested','approval_pending') and created_at <= clock_timestamp()-interval '24 hours';$job$);
commit;
