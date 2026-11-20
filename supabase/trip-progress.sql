begin;
alter table public.reservations add column if not exists trip_phase text
  check (trip_phase in ('moving','transporting','completed'));
update public.reservations set trip_phase=case when status='in_progress' then 'transporting' when status='completed' then 'completed' else null end
where trip_phase is null and status in ('in_progress','completed');

create or replace function public.sync_trip_phase() returns trigger
language plpgsql set search_path='' as $$
begin
  if new.status='completed' then new.trip_phase:='completed';
  elsif new.status<>'in_progress' then new.trip_phase:=null;
  elsif new.trip_phase is null then new.trip_phase:='transporting'; end if;
  return new;
end $$;
revoke all on function public.sync_trip_phase() from public,anon,authenticated;
create trigger sync_trip_phase before insert or update on public.reservations
for each row execute function public.sync_trip_phase();

create or replace function public.advance_trip(p_id uuid,p_expected text,p_next text)
returns uuid language plpgsql security invoker set search_path='' as $$
declare r public.reservations;
begin
  if not exists(select 1 from public.profiles p join public.drivers d on d.id=p.id
    where p.id=auth.uid() and p.role='admin' and p.is_active and d.is_active)
  then raise exception '활성 기사 계정으로 로그인해 주세요.'; end if;
  select * into r from public.reservations where id=p_id for update;
  if not found or r.driver_id is distinct from auth.uid() or not exists(
    select 1 from public.vehicles where id=r.vehicle_id and vehicle_number='71나9090')
  then raise exception '본인에게 배정된 9090 운행만 처리할 수 있습니다.'; end if;
  if ((r.status='confirmed' and r.trip_phase is null and p_expected='assigned' and p_next='moving')
    or (r.status='in_progress' and r.trip_phase='moving' and p_expected='moving' and p_next='transporting')
    or (r.status='in_progress' and r.trip_phase='transporting' and p_expected='transporting' and p_next='completed'))
    is not true then raise exception '운행 상태가 변경됐거나 처리 순서가 맞지 않습니다. 새로고침해 주세요.'; end if;
  update public.reservations set trip_phase=p_next,
    status=case when p_next='completed' then 'completed'::public.reservation_status else 'in_progress'::public.reservation_status end where id=p_id;
  return p_id;
end $$;
revoke all on function public.advance_trip(uuid,text,text) from public,anon;
grant execute on function public.advance_trip(uuid,text,text) to authenticated;

-- Postgres Changes applies existing SELECT RLS to each subscriber.
do $$ begin
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='reservations') then
    alter publication supabase_realtime add table public.reservations;
  end if;
end $$;
commit;
