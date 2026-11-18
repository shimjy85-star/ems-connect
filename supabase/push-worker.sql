-- Additive worker setup. No existing reservation/profile RLS changes.
begin;
create extension if not exists pg_net with schema extensions;
do $$ begin
  if not exists (select 1 from vault.secrets where name='ems_dispatch_worker') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32),'hex'),'ems_dispatch_worker');
  end if;
end $$;

create or replace function public.verify_dispatch_worker(candidate text)
returns boolean language sql security definer set search_path='' as $$
  select coalesce(length(candidate)=64 and exists (
    select 1 from vault.decrypted_secrets
    where name='ems_dispatch_worker' and decrypted_secret=candidate
  ),false);
$$;
revoke all on function public.verify_dispatch_worker(text) from public,anon,authenticated;
grant execute on function public.verify_dispatch_worker(text) to service_role;

alter table public.dispatch_push_queue
  add column if not exists next_attempt_at timestamptz not null default now(),
  add column if not exists delivered_endpoints text[] not null default '{}';

create or replace function public.claim_dispatch_push()
returns setof public.dispatch_push_queue language sql security definer set search_path='' as $$
  update public.dispatch_push_queue q set next_attempt_at=now()+interval '2 minutes'
  where q.reservation_id in (
    select reservation_id from public.dispatch_push_queue
    where sent_at is null and next_attempt_at<=now()
    order by next_attempt_at limit 5 for update skip locked
  ) returning q.*;
$$;
revoke all on function public.claim_dispatch_push() from public,anon,authenticated;
grant execute on function public.claim_dispatch_push() to service_role;

create or replace function public.queue_dispatch_push()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.status='confirmed' and new.driver_id is not null and
    (old.status is distinct from new.status or old.driver_id is distinct from new.driver_id) then
    insert into public.dispatch_push_queue(reservation_id,driver_id) values(new.id,new.driver_id)
    on conflict(reservation_id) do update set driver_id=excluded.driver_id,sent_at=null,
      created_at=clock_timestamp(),next_attempt_at=now(),delivered_endpoints='{}';
  end if;
  return new;
end $$;

create or replace function public.invoke_dispatch_push()
returns bigint language plpgsql security definer set search_path='' as $$
declare request_id bigint;
begin
  select net.http_post(
    url:='https://kxwxoemkkotsoqmneuuw.supabase.co/functions/v1/dispatch-push',
    headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||decrypted_secret),
    body:='{"action":"deliver"}'::jsonb,timeout_milliseconds:=60000
  ) into request_id from vault.decrypted_secrets where name='ems_dispatch_worker';
  return request_id;
end $$;
revoke all on function public.invoke_dispatch_push() from public,anon,authenticated;
-- The dedicated token can only invoke delivery; never use a service-role key in pg_net headers.
select cron.schedule('ems-dispatch-push','* * * * *','select public.invoke_dispatch_push();');
commit;
