-- Backend contract audit. Everything is rolled back, including queue entries.
begin;
create temp table audit_results(name text, passed boolean, detail text);
grant select,insert on audit_results to anon,authenticated;
create function pg_temp.record(n text,p boolean,d text default '') returns void language sql as $$ insert into audit_results values(n,coalesce(p,false),d) $$;
do $$
declare eid text:='audit-'||gen_random_uuid(); eid2 text:='audit-'||gen_random_uuid(); d jsonb;
begin
 perform set_config('test.eid',eid,true);perform set_config('test.eid2',eid2,true);
 d:='{"title":"Audit fixture","status":"prep","date":"2099-01-01","halls":["audit-hall"],"blocks":{"audit-hall":{"sound":{"items":[{"id":"audit-one","name":"Mic"},{"id":"audit-two","name":"Desk"}]},"stage":{"spec":{"id":"audit-stage","w":"8"},"stages":[{"id":"audit-extra","w":"2"}]}}}}';
 insert into public.events(id,data) values(eid,d);
 insert into public.events(id,data) values(eid2,d);
 perform pg_temp.record('DB rejects overlapping hall/date',false,'Two events with the same hall/date were accepted; frontend check is not atomic');
exception when exclusion_violation or unique_violation then
 perform pg_temp.record('DB rejects overlapping hall/date',true);
end $$;
set local role anon;
do $$
declare eid text:=current_setting('test.eid'); n int; denied boolean;
begin
 perform pg_temp.record('Technician can fetch a known event',(select count(*)=1 from public.get_event(eid)));
 begin perform * from public.events;perform pg_temp.record('Anon cannot list events',not exists(select from public.events));exception when insufficient_privilege then perform pg_temp.record('Anon cannot list events',true);end;
 begin insert into public.events(id,data) values('unauthorized','{}');perform pg_temp.record('Anon cannot create event',false);exception when insufficient_privilege then perform pg_temp.record('Anon cannot create event',true);end;
 begin perform * from public.admin_hall_settings;perform pg_temp.record('Anon cannot list personal halls',false);exception when insufficient_privilege then perform pg_temp.record('Anon cannot list personal halls',true);end;
 begin perform public.tg_claim();perform pg_temp.record('Anon cannot claim Telegram outbox',false);exception when insufficient_privilege then perform pg_temp.record('Anon cannot claim Telegram outbox',true);end;
 begin perform public.tg_command(999999999999,123,'/id','',true);perform pg_temp.record('Anon cannot forge bot command',false);exception when insufficient_privilege then perform pg_temp.record('Anon cannot forge bot command',true);end;
 perform public.set_check(eid,'audit-one',true,'Audit Tester');
 perform pg_temp.record('Valid task can be checked',(select count(*)=1 from public.get_checks(eid) where item_id='audit-one'));
 perform public.set_check(eid,'audit-one',false,'Audit Tester');
 perform pg_temp.record('Task can be unchecked',(select count(*)=0 from public.get_checks(eid) where item_id='audit-one'));
 denied:=false;begin perform public.set_check(eid,'unknown-item',true,'Audit Tester');exception when others then denied:=true;end;
 perform pg_temp.record('Unknown task rejected',denied);
 denied:=false;begin perform public.set_check(eid,'audit-one',true,'   ');exception when others then denied:=true;end;
 perform pg_temp.record('Blank technician name rejected',denied,'Server accepts an empty name although UI requires it');
 perform public.set_check(eid,'audit-extra:size',true,'Audit Tester');
 perform pg_temp.record('Additional stage task supported',(select count(*)=1 from public.get_checks(eid) where item_id='audit-extra:size'));
 denied:=false;begin perform public.set_check(eid,'audit-stage:cover',true,'Audit Tester');exception when others then denied:=true;end;
 perform pg_temp.record('Absent stage property rejected',denied,'A cover checkbox can be submitted for a stage without a cover');
end $$;
reset role;
-- Keep readiness infrastructure available only within this rolled-back transaction.
insert into tz_telegram.bot(id,username,heartbeat) values(true,'audit_bot',now()) on conflict(id) do update set heartbeat=now();
insert into tz_telegram.admin_chats(chat) values(-999999999999) on conflict do nothing;
set local role anon;
do $$
declare eid text:=current_setting('test.eid'); denied boolean:=false;
begin
 perform public.set_check(eid,'audit-one',true,'Audit Tester');
 begin perform public.tg_hall_ready(eid,'audit-hall','Audit Tester');exception when others then denied:=true;end;
 perform pg_temp.record('Hall ready rejected while tasks remain',denied,'Only one completed task is checked server-side; remaining tasks do not block RPC');
 denied:=false;begin perform public.tg_hall_ready(eid,'unknown-hall','Audit Tester');exception when others then denied:=true;end;
 perform pg_temp.record('Unknown hall readiness rejected',denied);
end $$;
reset role;
update public.events set data=data||'{"deletedAt":"2026-11-17"}' where id=current_setting('test.eid');
set local role anon;
do $$
declare eid text:=current_setting('test.eid'); denied boolean:=false;
begin
 perform pg_temp.record('Deleted event unavailable through RPC',(select count(*)=0 from public.get_event(eid)),'UI hides trash but direct get_event still returns its data');
 begin perform public.set_check(eid,'audit-two',true,'Audit Tester');exception when others then denied:=true;end;
 perform pg_temp.record('Deleted event check rejected',denied,'set_check does not inspect deletedAt');
 denied:=false;begin perform public.tg_hall_ready(eid,'audit-hall','Audit Tester');exception when others then denied:=true;end;
 perform pg_temp.record('Deleted hall readiness rejected',denied);
end $$;
reset role;
select set_config('request.jwt.claims',jsonb_build_object('sub',gen_random_uuid(),'role','authenticated')::text,true);
set local role authenticated;
do $$
begin
 perform pg_temp.record('Unapproved user is not admin',not public.is_admin());
 perform pg_temp.record('Unapproved user cannot list events',not exists(select from public.events));
 perform pg_temp.record('Unapproved user cannot read personal catalogues',not exists(select from public.admin_hall_settings));
 begin insert into public.events(id,data) values('unauthorized-user','{}');perform pg_temp.record('Unapproved user cannot create event',false);exception when insufficient_privilege then perform pg_temp.record('Unapproved user cannot create event',true);end;
end $$;
reset role;
select jsonb_agg(to_jsonb(r) order by name) as results from audit_results r;
rollback;

