-- Run after applying update-file-notifications.sql; fixtures are rolled back.
-- No test messages are committed to the delivery queue.
begin;

do $test$
declare eid text:='test-file-notifications-'||gen_random_uuid(); message_text text; message_count integer;
begin
 insert into public.events(id,data) values(eid,'{"title":"Проверка уведомлений","status":"draft","halls":["test"],"blocks":{}}');
 insert into tz_telegram.subs(event,chat) values(eid,-999999999999);
 update public.events set data=data||'{"blocks":{"test":{"light":{"files":[{"name":"plot.pdf","path":"plot-v2"}]}}},"hallFiles":{"test":[{"path":"hall"}]},"docs":{"tech":[{"path":"script"}],"director":[{"path":"director"}],"scheme":[{"path":"general"}]}}'::jsonb where id=eid;
 select count(*),max(message) into message_count,message_text from tz_telegram.outbox where event=eid;
 assert message_count=1,'Expected one combined notification';
 assert position('Обновлён плот по свету' in message_text)>0,message_text;
 assert position('Обновлена схема зала' in message_text)>0,message_text;
 assert position('Обновлён технический сценарий' in message_text)>0,message_text;
 assert position('Обновлён режиссёрский сценарий' in message_text)>0,message_text;
 assert position('Обновлена общая схема' in message_text)>0,message_text;
 assert position(E'\n' in message_text)>0,'Expected actual newlines';
 assert position('Подробности по залам' in message_text)=0,'File changes should have specific descriptions';
 update public.events set data=data where id=eid;
 assert (select count(*) from tz_telegram.outbox where event=eid)=1,'Unchanged save produced a duplicate';
end $test$;

rollback;
