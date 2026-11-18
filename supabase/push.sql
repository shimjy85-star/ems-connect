-- Additive migration. Existing tables and RLS policies remain unchanged.
begin;
create table if not exists public.push_subscriptions (
  endpoint text primary key,
  user_id uuid not null references public.profiles(id),
  p256dh text not null,
  auth text not null,
  updated_at timestamptz not null default now()
);
alter table public.push_subscriptions enable row level security;
revoke all on public.push_subscriptions from anon, authenticated;
grant all on public.push_subscriptions to service_role;

create table if not exists public.dispatch_push_queue (
  reservation_id uuid primary key references public.reservations(id),
  driver_id uuid not null references public.drivers(id),
  sent_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.dispatch_push_queue enable row level security;
revoke all on public.dispatch_push_queue from anon, authenticated;
grant all on public.dispatch_push_queue to service_role;

create or replace function public.queue_dispatch_push()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.status='confirmed' and new.driver_id is not null and
    (old.status is distinct from new.status or old.driver_id is distinct from new.driver_id) then
    insert into public.dispatch_push_queue(reservation_id,driver_id) values(new.id,new.driver_id)
    on conflict(reservation_id) do update set driver_id=excluded.driver_id,sent_at=null,created_at=now();
  end if;
  return new;
end $$;
revoke all on function public.queue_dispatch_push() from public,anon,authenticated;
create trigger reservations_queue_push after update on public.reservations
for each row execute function public.queue_dispatch_push();
commit;
