begin;
alter table public.reservations add column if not exists photo_uploaded_at timestamptz;
update public.reservations r set photo_uploaded_at=o.updated_at from storage.objects o
where o.bucket_id='trip-photos' and o.name=r.id::text||'/photo.jpg' and r.photo_uploaded_at is null;
create or replace function public.record_trip_photo(p_id uuid) returns timestamptz
language plpgsql security invoker set search_path='' as $$
declare stamp timestamptz;
begin
  if not exists(select 1 from public.profiles p join public.drivers d on d.id=p.id
    where p.id=auth.uid() and p.role='admin' and p.is_active and d.is_active)
  then raise exception '배정된 기사 계정이 필요합니다.'; end if;
  if not exists(select 1 from storage.objects where bucket_id='trip-photos' and name=p_id::text||'/photo.jpg')
  then raise exception '저장된 사진을 확인할 수 없습니다.'; end if;
  update public.reservations set photo_uploaded_at=clock_timestamp()
    where id=p_id and driver_id=auth.uid() and status in('confirmed','in_progress','completed')
    and vehicle_id in(select id from public.vehicles where vehicle_number='71나9090')
    returning photo_uploaded_at into stamp;
  if stamp is null then raise exception '본인에게 배정된 운행만 사진 알림을 보낼 수 있습니다.'; end if;
  return stamp;
end $$;
revoke all on function public.record_trip_photo(uuid) from public,anon;
grant execute on function public.record_trip_photo(uuid) to authenticated;
commit;
