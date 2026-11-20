-- Apply with the corresponding dispatch-push worker release, before enabling reservation changes.
-- Additive queue metadata; no original table policies are changed.
begin;
alter table public.dispatch_push_queue add column if not exists event_kind text not null default 'dispatch';
create or replace function public.queue_dispatch_push()
returns trigger language plpgsql security definer set search_path='' as $$
declare recipient uuid; event_name text;
begin
  if new.status='confirmed' and new.driver_id is not null then
    recipient:=new.driver_id;
    if old.status is distinct from new.status or old.driver_id is distinct from new.driver_id then
      event_name:='dispatch';
    elsif row(old.departure_address,old.destination_address,old.scheduled_at,old.requested_note,old.trip_type,old.waiting_required,old.waiting_minutes)
      is distinct from row(new.departure_address,new.destination_address,new.scheduled_at,new.requested_note,new.trip_type,new.waiting_required,new.waiting_minutes) then
      event_name:='change';
    end if;
  elsif old.status='confirmed' and old.driver_id is not null and new.status='cancelled' then
    recipient:=old.driver_id;
    event_name:='cancel';
  end if;
  if event_name is not null then
    insert into public.dispatch_push_queue(reservation_id,driver_id,event_kind) values(new.id,recipient,event_name)
    on conflict(reservation_id) do update set driver_id=excluded.driver_id,event_kind=excluded.event_kind,
      sent_at=null,created_at=clock_timestamp(),next_attempt_at=now(),delivered_endpoints='{}';
  end if;
  return new;
end $$;
revoke all on function public.queue_dispatch_push() from public,anon,authenticated;
commit;
