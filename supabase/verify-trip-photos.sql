begin;
update public.reservations set status='completed',driver_id='60874bf9-2dec-4e86-b733-6cc242787f4f',vehicle_id='fd39b056-ef5f-46c8-8799-27caa275550c'
where id='6e9e7a2b-97ad-4fec-823a-1985b9a414ac';
select set_config('request.jwt.claim.sub','60874bf9-2dec-4e86-b733-6cc242787f4f',true);
set local role authenticated;
do $$ begin
  if not public.can_access_trip_photo('6e9e7a2b-97ad-4fec-823a-1985b9a414ac/photo.jpg',true) then raise exception 'Assigned driver cannot upload'; end if;
  if public.can_access_trip_photo('6e9e7a2b-97ad-4fec-823a-1985b9a414ac/other.jpg',true) then raise exception 'Unexpected object accepted'; end if;
end $$;
select set_config('request.jwt.claim.sub','70c2f308-43f3-4f27-bcd0-ab77dfe4f6e2',true);
do $$ begin
  if not public.can_access_trip_photo('6e9e7a2b-97ad-4fec-823a-1985b9a414ac/photo.jpg',false) then raise exception 'Own hospital cannot download'; end if;
  if public.can_access_trip_photo('6e9e7a2b-97ad-4fec-823a-1985b9a414ac/photo.jpg',true) then raise exception 'Hospital can upload'; end if;
end $$;
reset role;
-- Change only the fake booking's hospital inside this rollback transaction.
update public.reservations set hospital_id=(select id from public.hospitals where id<>(select hospital_id from public.profiles where id='70c2f308-43f3-4f27-bcd0-ab77dfe4f6e2') limit 1)
where id='6e9e7a2b-97ad-4fec-823a-1985b9a414ac';
set local role authenticated;
do $$ begin
  if public.can_access_trip_photo('6e9e7a2b-97ad-4fec-823a-1985b9a414ac/photo.jpg',false) then raise exception 'Other hospital can download'; end if;
end $$;
select 'Driver upload, own hospital download, other hospital denial passed; rolling back' as result;
rollback;
