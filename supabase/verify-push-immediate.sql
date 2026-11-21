-- Rollback-only verification with the previously authorized fake reservation.
-- pg_net requests are rolled back too; this sends no handset notification.
begin;
do $$ declare before_count int; after_count int;
begin
  select count(*) into before_count from net.http_request_queue;
  update public.reservations set status='confirmed',
    driver_id='60874bf9-2dec-4e86-b733-6cc242787f4f',
    vehicle_id='fd39b056-ef5f-46c8-8799-27caa275550c'
    where id='6e9e7a2b-97ad-4fec-823a-1985b9a414ac' and status='cancelled';
  if not found then raise exception 'Fake baseline changed'; end if;
  select count(*) into after_count from net.http_request_queue;
  if after_count<=before_count then raise exception 'Immediate push was not scheduled'; end if;
end $$;
rollback;
select 'immediate push transaction check passed; no notification sent' as result;
