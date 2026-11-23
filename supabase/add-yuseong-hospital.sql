-- Add one requested hospital without resetting tables, data or policies.
begin;
insert into public.hospitals(name,is_active)
select '유성요양병원',true
where not exists(select 1 from public.hospitals where btrim(name)='유성요양병원');
do $$ begin
  if (select count(*) from public.hospitals where btrim(name)='유성요양병원')<>1
    or not exists(select 1 from public.hospitals where btrim(name)='유성요양병원' and is_active)
  then raise exception 'Expected exactly one active Yuseong hospital'; end if;
end $$;
commit;
select id,name,is_active from public.hospitals where btrim(name)='유성요양병원';
