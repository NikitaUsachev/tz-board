begin;
insert into public.events(id,data) values ('contract-'||txid_current(),'{"title": "Contract test", "halls": ["h"], "blocks": {"h": {"sound": {"items": [{"id": "mic", "name": "Mic"}]}}, "removed": {"sound": {"items": [{"id": "foreign", "name": "Foreign"}]}}}}');
select set_config('test.eid','contract-'||txid_current(),true);
insert into tz_telegram.bot(id,username,heartbeat) values(true,'test_bot',now()) on conflict(id) do update set heartbeat=now();
insert into tz_telegram.admin_chats(chat) values(-999999999999) on conflict do nothing;
set local role anon;
do $$
declare eid text:=current_setting('test.eid'); denied boolean:=false;
begin
 if (select count(*) from public.get_event_v2(eid))<>1 then raise exception 'v2 read failed';end if;
 if (select data from public.get_event_v2(eid)) is distinct from (select data from public.get_event(eid)) then raise exception 'Read contract differs';end if;
 begin perform public.set_check(eid,'foreign',true,'Test');exception when others then denied:=true;end;
 if not denied then raise exception 'Removed hall accepted';end if;
 perform public.set_check(eid,'mic',true,'Test');
 denied:=false;
 begin perform public.tg_hall_ready(eid,'h','Test');exception when others then denied:=true;end;
 if not denied then raise exception 'Readiness without arrival accepted';end if;
 perform public.set_item_arrival(eid,'mic',true,'Test');
 if not public.tg_hall_ready(eid,'h','Test') then raise exception 'Valid readiness rejected';end if;
 if public.tg_hall_ready(eid,'h','Test') then raise exception 'Duplicate readiness accepted';end if;
end $$;
reset role;
update public.events set data=data||'{"deletedAt":"2026-11-20"}' where id=current_setting('test.eid');
set local role anon;
do $$begin
 if exists(select from public.get_event_v2(current_setting('test.eid'))) or exists(select from public.get_event(current_setting('test.eid'))) or exists(select from public.get_checks(current_setting('test.eid'))) then raise exception 'Trash exposed';end if;
end $$;
reset role;
rollback;
