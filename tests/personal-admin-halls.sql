begin;
-- Run inside a transaction and roll back; no test changes or notifications persist.
do $$
declare users uuid[]; a uuid; b uuid;
begin
 select array_agg(id order by id) into users from auth.users u where email_confirmed_at is not null and exists(select from public.admins x where lower(x.email)=lower(u.email));
 if cardinality(users)<2 then raise exception 'Two admins required'; end if;
 a:=users[1];b:=users[2];
 perform set_config('test.admin_b',b::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',a,'role','authenticated')::text,true);
end $$;
set local role authenticated;
do $$
declare n int; d jsonb; eid text:='personal-halls-test-'||gen_random_uuid()::text;
begin
 if not public.is_admin() then raise exception 'Admin authentication failed'; end if;
 select count(*) into n from public.admin_hall_settings;
 if n<>1 then raise exception 'Catalogue isolation failed: %',n; end if;
 update public.admin_hall_settings set data='{"halls":[]}' where user_id=current_setting('test.admin_b')::uuid;
 get diagnostics n=row_count;
 if n<>0 then raise exception 'Other catalogue was editable'; end if;
 begin
  update public.admin_hall_settings set user_id=current_setting('test.admin_b')::uuid where user_id=auth.uid();
  raise exception 'Ownership reassignment allowed';
 exception when insufficient_privilege or unique_violation then null;
 end;
 update public.admin_hall_settings set data='{"halls":[{"id":"test-personal-hall","name":"Личный зал"}]}' where user_id=auth.uid();
 insert into public.events(id,data) values(eid,'{"title":"Test","status":"draft","halls":["test-personal-hall"],"blocks":{}}');
 select data into d from public.events where id=eid;
 if d#>>'{hallNames,test-personal-hall}'<>'Личный зал' then raise exception 'Snapshot missing'; end if;
 update public.admin_hall_settings set data='{"halls":[]}' where user_id=auth.uid();
 update public.events set data=data-'hallNames' where id=eid;
 select data into d from public.events where id=eid;
 if d#>>'{hallNames,test-personal-hall}'<>'Личный зал' then raise exception 'Old client lost snapshot'; end if;
 perform set_config('test.event',eid,true);
 begin
  update public.settings set data=jsonb_set(data,'{halls}','[]') where id=1;
  raise exception 'Legacy catalogue not protected';
 exception when raise_exception then
  if SQLERRM not like 'Обновите страницу:%' then raise; end if;
 end;
end $$;
reset role;
do $$
begin
 perform set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.admin_b'),'role','authenticated')::text,true);
end $$;
set local role authenticated;
do $$
declare d jsonb;
begin
 update public.events set data=jsonb_set(data,'{title}','"Colleague edit"') where id=current_setting('test.event');
 select data into d from public.events where id=current_setting('test.event');
 if d#>>'{hallNames,test-personal-hall}'<>'Личный зал' then raise exception 'Colleague lost hall'; end if;
end $$;
reset role;
do $$
declare result text[];
begin
 result:=tz_telegram.file_update_lines('{"halls":["test"],"hallNames":{"test":"Мой зал"}}','{"halls":["test"],"hallNames":{"test":"Мой зал"},"hallFiles":{"test":[{"path":"new.pdf"}]}}');
 if result[1]<>'Мой зал' then raise exception 'Telegram hall name missing: %',result; end if;
end $$;
set local role anon;
do $$ begin
 begin perform * from public.admin_hall_settings;raise exception 'Anonymous catalogue access';exception when insufficient_privilege then null;end;
end $$;
reset role;

rollback;
