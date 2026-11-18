-- Read-only permission checks, followed by a rolled-back test using the authorized fake reservation.
select
  not has_function_privilege('anon','public.verify_dispatch_worker(text)','execute') as anon_worker_denied,
  not has_function_privilege('authenticated','public.claim_dispatch_push()','execute') as user_queue_denied,
  not has_function_privilege('authenticated','public.invoke_dispatch_push()','execute') as user_invoke_denied,
  not has_table_privilege('authenticated','public.push_subscriptions','select') as user_subscriptions_denied,
  not has_table_privilege('authenticated','public.dispatch_push_queue','update') as user_queue_write_denied,
  not public.verify_dispatch_worker(repeat('0',64)) as invalid_secret_denied;

begin;
update public.reservations set status='confirmed',driver_id='60874bf9-2dec-4e86-b733-6cc242787f4f',
  vehicle_id='fd39b056-ef5f-46c8-8799-27caa275550c'
where id='6e9e7a2b-97ad-4fec-823a-1985b9a414ac';
select reservation_id,driver_id,sent_at is null as pending from public.dispatch_push_queue
where reservation_id='6e9e7a2b-97ad-4fec-823a-1985b9a414ac';
select count(*) as first_claim from public.claim_dispatch_push();
select count(*) as concurrent_claim_should_be_zero from public.claim_dispatch_push();
rollback;
