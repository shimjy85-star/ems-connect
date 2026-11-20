begin;
update public.reservations set status='confirmed',driver_id='60874bf9-2dec-4e86-b733-6cc242787f4f',vehicle_id='fd39b056-ef5f-46c8-8799-27caa275550c' where id='6e9e7a2b-97ad-4fec-823a-1985b9a414ac';
select set_config('request.jwt.claim.sub','60874bf9-2dec-4e86-b733-6cc242787f4f',true);
set local role authenticated;
do $$ declare rid uuid:='6e9e7a2b-97ad-4fec-823a-1985b9a414ac'; begin
  begin
    perform public.advance_trip(rid,'assigned','completed');
    raise exception 'TEST FAILED: skipped phase';
  exception when others then
    if sqlerrm<>'운행 상태가 변경됐거나 처리 순서가 맞지 않습니다. 새로고침해 주세요.' then raise; end if;
  end;
  perform public.advance_trip(rid,'assigned','moving');
  if not exists(select 1 from public.reservations where id=rid and status='in_progress' and trip_phase='moving') then raise exception 'moving failed'; end if;
  begin
    perform public.advance_trip(rid,'assigned','moving');
    raise exception 'TEST FAILED: duplicate phase';
  exception when others then
    if sqlerrm<>'운행 상태가 변경됐거나 처리 순서가 맞지 않습니다. 새로고침해 주세요.' then raise; end if;
  end;
  perform public.advance_trip(rid,'moving','transporting');
  perform public.advance_trip(rid,'transporting','completed');
  if not exists(select 1 from public.reservations where id=rid and status='completed' and trip_phase='completed') then raise exception 'completion failed'; end if;
end $$;
select set_config('request.jwt.claim.sub','70c2f308-43f3-4f27-bcd0-ab77dfe4f6e2',true);
do $$ begin
  begin
    perform public.advance_trip('6e9e7a2b-97ad-4fec-823a-1985b9a414ac','assigned','moving');
    raise exception 'TEST FAILED: hospital changed trip';
  exception when others then
    if sqlerrm<>'활성 기사 계정으로 로그인해 주세요.' then raise; end if;
  end;
end $$;
select 'Trip sequence, duplicate/skip prevention and hospital denial passed; rolling back' as result;
rollback;
