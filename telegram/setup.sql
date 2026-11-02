begin;
create schema if not exists tz_telegram;
revoke all on schema tz_telegram from public, anon, authenticated;
create table if not exists tz_telegram.bot (id boolean primary key check(id), username text not null, heartbeat timestamptz not null);
create table if not exists tz_telegram.admin_chats (chat bigint primary key);
create table if not exists tz_telegram.subs (event text references public.events(id) on delete cascade, chat bigint, primary key(event,chat));
create table if not exists tz_telegram.ready (event text references public.events(id) on delete cascade, hall text, technician text not null, primary key(event,hall));
create table if not exists tz_telegram.outbox (id bigint generated always as identity primary key, chat bigint not null, event text references public.events(id) on delete cascade, kind text not null, message text not null, due timestamptz not null default now(), attempts int not null default 0);
create index if not exists tg_delivery on tz_telegram.outbox(due,id);
create or replace function public.tg_event_info(p_event text) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('username',b.username,'ready',coalesce((select jsonb_object_agg(r.hall,r.technician) from tz_telegram.ready r where r.event=e.id),'{}'::jsonb))
 from tz_telegram.bot b join public.events e on e.id=p_event
 where b.heartbeat>now()-interval '3 minutes' and coalesce(e.data->>'deletedAt','')='' and coalesce(e.data->>'status','')<>'done'
$$;
create or replace function public.tg_hall_ready(p_event text,p_hall text,p_name text) returns boolean language plpgsql security definer set search_path='' as $$
declare d jsonb; hall_name text; n text:=trim(p_name);
begin
 select data into d from public.events where id=p_event for share;
 if d is null or coalesce(d->>'deletedAt','')<>'' or d->>'status'='done' or not coalesce((d->'halls') ? p_hall,false) then raise exception 'Зал недоступен'; end if;
 if n is null or length(n) not between 1 and 60 or not exists(select from public.checks where event_id=p_event and done and by_name=n) then raise exception 'Сначала отметьте выполненный пункт в этом ТЗ'; end if;
 if not exists(select from tz_telegram.bot where heartbeat>now()-interval '3 minutes') or not exists(select from tz_telegram.admin_chats) then raise exception 'Администраторы пока не подключены'; end if;
 select h->>'name' into hall_name from public.settings s cross join lateral jsonb_array_elements(s.data->'halls') h where s.id=1 and h->>'id'=p_hall;
 insert into tz_telegram.ready values(p_event,p_hall,n) on conflict do nothing;
 if not found then return false; end if;
 insert into tz_telegram.outbox(chat,event,kind,message)
 select chat,p_event,'ready',concat_ws(E'\n',coalesce(hall_name,p_hall)||' готов к прогонам',d->>'title',d->>'date','Подтвердил: '||n) from tz_telegram.admin_chats;
 return true;
end $$;
create or replace function tz_telegram.on_change() returns trigger language plpgsql security definer set search_path='' as $$
declare lines text[]:='{}'; k text; label text;
begin
 if coalesce(new.data->>'deletedAt','')<>'' or new.data->>'status'='done' then
  delete from tz_telegram.outbox where event=new.id;
  delete from tz_telegram.subs where event=new.id;
  delete from tz_telegram.ready where event=new.id;
  return new;
 end if;
 delete from tz_telegram.ready where event=new.id and not coalesce((new.data->'halls') ? hall,false);
 if not exists(select from tz_telegram.subs where event=new.id) then return new; end if;
 for k,label in select * from (values ('title','Название'),('date','Дата'),('mountDate','Дата монтажа'),('mount','Монтаж'),('rehearsal','Прогоны'),('start','Начало'),('end','Завершение')) as f(k,l) loop
  if old.data->>k is distinct from new.data->>k then
   lines:=array_append(lines,label||': '||coalesce(nullif(old.data->>k,''),'—')||' → '||coalesce(nullif(new.data->>k,''),'—'));
  end if;
 end loop;
 if old.data->'blocks' is distinct from new.data->'blocks' then
  for label in
   with items as (
    select side, hall.key hall, category.key department, item->>'id' id,
     concat_ws(' × ',nullif(item->>'name',''),nullif(item->>'qty','')) description
    from (values ('old',old.data),('new',new.data)) snapshots(side,d)
    cross join lateral jsonb_each(case when jsonb_typeof(d->'blocks')='object' then d->'blocks' else '{}'::jsonb end) hall
    cross join lateral jsonb_each(case when jsonb_typeof(hall.value)='object' then hall.value else '{}'::jsonb end) category
    cross join lateral jsonb_array_elements(case when jsonb_typeof(category.value->'items')='array' then category.value->'items' else '[]'::jsonb end) item
    where item->>'id' is not null
   ), before_items as (select * from items where side='old'), after_items as (select * from items where side='new')
   select coalesce((select h->>'name' from public.settings s cross join lateral jsonb_array_elements(case when jsonb_typeof(s.data->'halls')='array' then s.data->'halls' else '[]'::jsonb end) h where s.id=1 and h->>'id'=coalesce(a.hall,b.hall) limit 1),'Зал')||': '||
    case when b.id is null then 'добавлено — '||a.description when a.id is null then 'убрано — '||b.description else b.description||' → '||a.description end
   from before_items b full join after_items a using(hall,department,id)
   where b.description is distinct from a.description
   order by coalesce(a.hall,b.hall),coalesce(a.id,b.id) limit 6
  loop lines:=array_append(lines,label); end loop;
  lines:=array_append(lines,'Подробности по залам — в ТЗ.');
 end if;
 if old.data->'halls' is distinct from new.data->'halls' then lines:=array_append(lines,'Изменился список залов.'); end if;
 if cardinality(lines)=0 then lines:=array_append(lines,'Обновлены сведения о мероприятии.'); end if;
 insert into tz_telegram.outbox(chat,event,kind,message) select chat,new.id,'edit',left('Изменения в ТЗ · '||coalesce(new.data->>'title','Мероприятие')||E'\n'||array_to_string(lines,E'\n'),3400) from tz_telegram.subs where event=new.id;
 return new;
end $$;
drop trigger if exists tz_telegram_change on public.events;
create trigger tz_telegram_change after update on public.events for each row when (old.data is distinct from new.data) execute function tz_telegram.on_change();
revoke all on function public.tg_event_info(text),public.tg_hall_ready(text,text,text) from public;
grant execute on function public.tg_event_info(text),public.tg_hall_ready(text,text,text) to anon,authenticated;
-- Only the Edge Function can process messages and deliver the queue.
create table if not exists tz_telegram.updates (id bigint primary key, received timestamptz default now());
alter table tz_telegram.outbox add column if not exists lease uuid;
create or replace function public.tg_command(p_update bigint,p_chat bigint,p_command text,p_arg text,p_admin boolean)
returns void language plpgsql security definer set search_path='' as $$
declare title text; reply text;
begin
 insert into tz_telegram.updates(id) values(p_update) on conflict do nothing;
 if not found then return; end if;
 if p_command='/stop' then
  delete from tz_telegram.admin_chats where chat=p_chat;
  delete from tz_telegram.subs where chat=p_chat;
  delete from tz_telegram.outbox where chat=p_chat;
  reply:='Уведомления отключены.';
 elsif p_command='/id' then reply:='Ваш номер чата: '||p_chat;
 elsif p_command='/start' and p_arg ~ '^[A-Za-z0-9_-]{1,64}$' then
  select coalesce(data->>'title','Мероприятие') into title from public.events where id=p_arg and coalesce(data->>'deletedAt','')='' and coalesce(data->>'status','')<>'done' for share;
  if found then
   insert into tz_telegram.subs values(p_arg,p_chat) on conflict do nothing;
   reply:='Вы подписаны на ТЗ «'||left(title,180)||'». Отключить уведомления — /stop.';
  else reply:='ТЗ недоступно.'; end if;
 elsif p_command='/start' and p_admin and p_arg='' then
  insert into tz_telegram.admin_chats values(p_chat) on conflict do nothing;
  reply:='Сообщения о готовности залов включены.';
 else reply:='Для подписки откройте ссылку из нужного ТЗ. Чтобы узнать номер чата, отправьте /id.'; end if;
 insert into tz_telegram.outbox(chat,kind,message) values(p_chat,'reply',reply);
end $$;
create or replace function public.tg_tick(p_username text,p_admins bigint[]) returns void language plpgsql security definer set search_path='' as $$
begin
 delete from tz_telegram.updates where received<now()-interval '7 days';
 delete from tz_telegram.admin_chats where not(chat=any(p_admins));
 delete from tz_telegram.outbox where kind='ready' and not(chat=any(p_admins));
 insert into tz_telegram.bot values(true,p_username,now()) on conflict(id) do update set heartbeat=now(),username=excluded.username;
end $$;
create or replace function public.tg_claim() returns jsonb language sql security definer set search_path='' as $$
 with claimed as (update tz_telegram.outbox set due=now()+interval '2 minutes',lease=gen_random_uuid(),attempts=attempts+1 where id=(select id from tz_telegram.outbox where due<=now() order by id limit 1 for update skip locked) returning *) select to_jsonb(c) from claimed c
$$;
create or replace function public.tg_finish(p_id bigint,p_lease uuid,p_code integer,p_retry integer) returns void language plpgsql security definer set search_path='' as $$
declare cid bigint;
begin
 select chat into cid from tz_telegram.outbox where id=p_id and lease=p_lease for update;
 if not found then return; end if;
 if p_code=403 then
  delete from tz_telegram.subs where chat=cid;
  delete from tz_telegram.admin_chats where chat=cid;
  delete from tz_telegram.outbox where chat=cid;
 elsif p_code in (200,400) then delete from tz_telegram.outbox where id=p_id;
 else update tz_telegram.outbox set due=now()+make_interval(secs=>greatest(1,p_retry)),lease=null where id=p_id; end if;
end $$;
revoke all on function public.tg_command(bigint,bigint,text,text,boolean), public.tg_tick(text,bigint[]),public.tg_claim(),public.tg_finish(bigint,uuid,int,int) from public,anon,authenticated;
grant execute on function public.tg_command(bigint,bigint,text,text,boolean), public.tg_tick(text,bigint[]),public.tg_claim(),public.tg_finish(bigint,uuid,int,int) to service_role;
notify pgrst,'reload schema';
commit;
