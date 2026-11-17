begin;
insert into public.events(id,data) values('block-test-'||txid_current(),'{"title":"Block check test","halls":["h","other"],"blocks":{"h":{"sound":{"items":[{"id":"mic","name":"Mic"}]},"light":{"items":[{"id":"lamp","name":"Lamp"}]},"stage":{"items":[],"spec":{"id":"s","coverNote":"black"}}},"other":{"sound":{"items":[{"id":"mic2","name":"Mic"}]}}}}');
select set_config('test.block_event','block-test-'||txid_current(),true);
set local role anon;
do $$
declare eid text:=current_setting('test.block_event'); denied boolean;
begin
 perform public.set_block_check(eid,'h','sound','present',true,'Иванов Иван');
 perform public.set_block_check(eid,'h','sound','mounted',true,'Петров Пётр');
 perform public.set_block_check(eid,'other','sound','present',true,'Иванов Иван');
 perform public.set_block_check(eid,'h','light','present',true,'Иванов Иван');
 perform public.set_block_check(eid,'h','stage','mounted',true,'Иванов Иван');
 if (select count(*) from public.get_checks(eid))<>5 then raise exception 'Save/read failed'; end if;
 if not exists(select from public.get_checks(eid) where item_id='block:["h","sound","mounted"]' and by_name='Петров Пётр' and at is not null) then raise exception 'Attribution missing'; end if;
 perform public.set_block_check(eid,'h','sound','present',false,'Иванов Иван');
 if (select count(*) from public.get_checks(eid))<>4 then raise exception 'Independent uncheck failed'; end if;
 perform public.set_block_check(eid,'h','sound','present',true,'Иванов Иван');
 denied:=false;begin perform public.set_block_check(eid,'h','extra','present',true,'Иванов Иван');exception when others then denied:=true;end;if not denied then raise exception 'Extra accepted';end if;
 denied:=false;begin perform public.set_block_check(eid,'unknown','sound','present',true,'Иванов Иван');exception when others then denied:=true;end;if not denied then raise exception 'Unknown hall accepted';end if;
 denied:=false;begin perform public.set_block_check(eid,'h','video','present',true,'Иванов Иван');exception when others then denied:=true;end;if not denied then raise exception 'Empty block accepted';end if;
 denied:=false;begin perform public.set_block_check(eid,'h','sound','wrong',true,'Иванов Иван');exception when others then denied:=true;end;if not denied then raise exception 'Unknown phase accepted';end if;
 denied:=false;begin perform public.set_block_check(eid,'h','sound','present',true,' ');exception when others then denied:=true;end;if not denied then raise exception 'Empty name accepted';end if;
end $$;
reset role;
update public.events set data=jsonb_set(data,'{title}','"Renamed"') where id=current_setting('test.block_event');
do $$begin if (select count(*) from public.get_checks(current_setting('test.block_event')))<>5 then raise exception 'Title reset checks';end if;end $$;
update public.events set data=jsonb_set(data,'{blocks,h,sound,items,0,qty}','"3"') where id=current_setting('test.block_event');
do $$begin if (select count(*) from public.get_checks(current_setting('test.block_event')))<>3 then raise exception 'Block reset/isolation failed';end if;end $$;
update public.events set data=data||'{"deletedAt":"2026-11-17"}' where id=current_setting('test.block_event');
set local role anon;
do $$declare denied boolean:=false;begin
 begin perform public.set_block_check(current_setting('test.block_event'),'h','light','present',true,'Иванов Иван');exception when others then denied:=true;end;
 if not denied then raise exception 'Deleted event accepted';end if;
end $$;
reset role;
rollback;
