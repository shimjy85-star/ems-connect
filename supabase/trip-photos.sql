-- Dedicated private bucket. Existing table policies remain unchanged.
begin;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('trip-photos','trip-photos',false,10485760,array['image/jpeg'])
on conflict(id) do nothing;

create or replace function public.can_access_trip_photo(object_name text,write_access boolean)
returns boolean language sql stable security invoker set search_path='' as $$
  select exists (
    select 1 from public.reservations r join public.profiles p on p.id=auth.uid()
    where object_name=r.id::text||'/photo.jpg' and p.is_active
    and case when write_access then p.role='admin' and r.driver_id=p.id
      and r.vehicle_id in(select id from public.vehicles where vehicle_number='71나9090')
      and r.status in('confirmed','in_progress','completed')
      and exists(select 1 from public.drivers where id=p.id and is_active)
    else p.role='admin' or (p.role in('hospital_admin','hospital_staff') and p.hospital_id=r.hospital_id) end
  );
$$;
revoke all on function public.can_access_trip_photo(text,boolean) from public,anon;
grant execute on function public.can_access_trip_photo(text,boolean) to authenticated;
create policy trip_photos_read on storage.objects for select to authenticated
using(bucket_id='trip-photos' and public.can_access_trip_photo(name,false));
create policy trip_photos_insert on storage.objects for insert to authenticated
with check(bucket_id='trip-photos' and public.can_access_trip_photo(name,true));
create policy trip_photos_update on storage.objects for update to authenticated
using(bucket_id='trip-photos' and public.can_access_trip_photo(name,true))
with check(bucket_id='trip-photos' and public.can_access_trip_photo(name,true));
commit;
