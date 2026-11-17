begin;
insert into public.events(id,data) values('arrival-test-'||txid_current(),'{"title":"Arrival test","halls":["h"],"blocks":{"h":{"sound":{"items":[{"id":"mic","name":"Mic"},{"id":"desk","name":"Desk"}]},"extra":{"items":[{"id":"task","name":"Task"}]},"stage":{"items":[],"spec":{"id":"s","w":"8"},"stages":[{"id":"s2","coverNote":"black"}]}}}}');
select set_config('test.arrival_event','arrival-test-'||txid_current(),true);
set local role anon;
do $$declare eid text:=current_setting('test.arrival_event');denied boolean;begin
 perform public.set_check(eid,'mic',true,'Монтажник Иван');
 perform public.set_item_arrival(eid,'mic',true,'Техник Пётр');
 perform public.set_item_arrival(eid,'desk',true,'Техник Пётр');
 perform public.set_item_arrival(eid,'s:size',true,'Техник Пётр');
 perform public.set_item_arrival(eid,'s2:cover',true,'Техник Пётр');
 if (select count(*) from public.get_checks(eid))<>5 then raise exception 'Read/write failed';end if;
 if not exists(select from public.get_checks(eid) where item_id='mic' and by_name='Монтажник Иван') then raise exception 'Legacy installation overwritten';end if;
 if not exists(select from public.get_checks(eid) where item_id='arrival:mic' and by_name='Техник Пётр' and at is not null) then raise exception 'Arrival attribution missing';end if;
 perform public.set_item_arrival(eid,'mic',false,'Техник Пётр');
 if (select count(*) from public.get_checks(eid))<>4 then raise exception 'Independent undo failed';end if;
 denied:=false;begin perform public.set_item_arrival(eid,'task',true,'Техник');exception when others then denied:=true;end;if not denied then raise exception 'Extra accepted';end if;
 denied:=false;begin perform public.set_item_arrival(eid,'missing',true,'Техник');exception when others then denied:=true;end;if not denied then raise exception 'Missing accepted';end if;
 denied:=false;begin perform public.set_item_arrival(eid,'s:cover',true,'Техник');exception when others then denied:=true;end;if not denied then raise exception 'Absent property accepted';end if;
 denied:=false;begin perform public.set_item_arrival(eid,'mic',true,' ');exception when others then denied:=true;end;if not denied then raise exception 'Blank name accepted';end if;
end $$;
reset role;
update public.events set data=data||'{"deletedAt":"2026-11-17"}' where id=current_setting('test.arrival_event');
set local role anon;
do $$declare denied boolean:=false;begin
 begin perform public.set_item_arrival(current_setting('test.arrival_event'),'mic',true,'Техник');exception when others then denied:=true;end;
 if not denied then raise exception 'Deleted event accepted';end if;
end $$;
reset role;
rollback;
