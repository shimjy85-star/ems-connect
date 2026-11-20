-- Run after reservation-changes.sql. Rollback prevents persistent test changes.
begin;
select
  not has_function_privilege('anon','public.submit_reservation_change(uuid,timestamptz,text,jsonb,text)','execute') as anonymous_denied,
  not has_function_privilege('authenticated','public.apply_reservation_change(uuid,text,jsonb)','execute') as helper_denied,
  not has_table_privilege('authenticated','public.reservation_changes','insert') as direct_insert_denied,
  not has_table_privilege('authenticated','public.reservation_changes','update') as direct_review_denied;

-- Existing authorized fake reservation; all fields restored by transaction rollback.
update public.reservations set status='requested',created_at=now(),scheduled_at=now()+interval '2 hours',
  driver_id=null,vehicle_id=null where id='6e9e7a2b-97ad-4fec-823a-1985b9a414ac';
select set_config('request.jwt.claim.sub','70c2f308-43f3-4f27-bcd0-ab77dfe4f6e2',true);
do $$ declare r public.reservations; cid uuid; begin
  select * into strict r from public.reservations where id='6e9e7a2b-97ad-4fec-823a-1985b9a414ac';
  cid:=public.submit_reservation_change(r.id,r.updated_at,'edit','{"departure_address":"가상 수정 출발지"}','가상 검증');
  if not exists(select 1 from public.reservations where id=r.id and departure_address='가상 수정 출발지') then raise exception 'edit failed'; end if;
  begin
    perform public.submit_reservation_change(r.id,r.updated_at-interval '1 second','cancel','{}','stale test');
    raise exception 'stale accepted';
  exception when others then
    if sqlerrm<>'예약이 변경됐습니다. 새로고침 후 다시 시도해 주세요.' then raise; end if;
  end;
end $$;

-- Null hospital and another hospital must fail closed. Subtransactions restore profiles.
do $$ declare r public.reservations; other_hospital uuid; begin
  select * into strict r from public.reservations where id='6e9e7a2b-97ad-4fec-823a-1985b9a414ac';
  begin
    update public.profiles set hospital_id=null where id=auth.uid();
    perform public.submit_reservation_change(r.id,r.updated_at,'cancel','{}','null hospital test');
    raise exception 'TEST FAILED: null hospital accepted';
  exception when others then
    if sqlerrm<>'예약을 변경할 권한이 없습니다.' then raise; end if;
  end;
  select id into strict other_hospital from public.hospitals where id<>r.hospital_id limit 1;
  begin
    update public.profiles set hospital_id=other_hospital where id=auth.uid();
    perform public.submit_reservation_change(r.id,r.updated_at,'cancel','{}','other hospital test');
    raise exception 'TEST FAILED: other hospital accepted';
  exception when others then
    if sqlerrm<>'예약을 변경할 권한이 없습니다.' then raise; end if;
  end;
  begin
    update public.profiles set is_active=false where id=auth.uid();
    perform public.submit_reservation_change(r.id,r.updated_at,'cancel','{}','inactive test');
    raise exception 'TEST FAILED: inactive accepted';
  exception when others then
    if sqlerrm<>'활성 계정으로 로그인해 주세요.' then raise; end if;
  end;
end $$;

-- Post-dispatch cancellation remains pending until an active administrator approves.
update public.reservations set status='confirmed',
  driver_id='60874bf9-2dec-4e86-b733-6cc242787f4f',
  vehicle_id='fd39b056-ef5f-46c8-8799-27caa275550c'
where id='6e9e7a2b-97ad-4fec-823a-1985b9a414ac';
do $$ declare r public.reservations; cid uuid; begin
  select * into strict r from public.reservations where id='6e9e7a2b-97ad-4fec-823a-1985b9a414ac';
  cid:=public.submit_reservation_change(r.id,r.updated_at,'cancel','{}','approval flow test');
  if not exists(select 1 from public.reservations where id=r.id and status='confirmed')
    or not exists(select 1 from public.reservation_changes where id=cid and state='pending')
  then raise exception 'TEST FAILED: pending request mutated booking'; end if;
  begin
    perform public.review_reservation_change(cid,true);
    raise exception 'TEST FAILED: hospital approved request';
  exception when others then
    if sqlerrm<>'관리자만 승인할 수 있습니다.' then raise; end if;
  end;
  perform set_config('request.jwt.claim.sub','60874bf9-2dec-4e86-b733-6cc242787f4f',true);
  perform public.review_reservation_change(cid,true);
  if not exists(select 1 from public.reservations where id=r.id and status='cancelled' and driver_id is null and vehicle_id is null)
    or not exists(select 1 from public.reservation_changes where id=cid and state='applied')
  then raise exception 'TEST FAILED: admin approval not applied'; end if;
  begin
    perform public.review_reservation_change(cid,true);
    raise exception 'TEST FAILED: double approval accepted';
  exception when others then
    if sqlerrm<>'이미 처리된 요청입니다.' then raise; end if;
  end;
end $$;
select 'All reservation-change assertions passed; transaction will roll back.' as result;
rollback;
