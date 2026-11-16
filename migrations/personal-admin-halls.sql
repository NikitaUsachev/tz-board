-- Personal catalogues. The legacy catalogue remains read-only for historical events.
create table public.admin_hall_settings (
 user_id uuid primary key references auth.users(id) on delete cascade,
 data jsonb not null default '{"halls":[]}'::jsonb,
 updated_at timestamptz not null default now(),
 constraint admin_halls_array check (jsonb_typeof(data->'halls')='array')
);
alter table public.admin_hall_settings enable row level security;
revoke all on public.admin_hall_settings from anon, authenticated;
grant select,insert,update on public.admin_hall_settings to authenticated;
create policy own_admin_halls on public.admin_hall_settings for all to authenticated
 using ((select auth.uid())=user_id and (select public.is_admin()))
 with check ((select auth.uid())=user_id and (select public.is_admin()));
insert into public.admin_hall_settings(user_id,data)
 select u.id,jsonb_build_object('halls',coalesce(s.data->'halls','[]'::jsonb))
 from auth.users u join public.admins a on lower(a.email)=lower(u.email)
 left join public.settings s on s.id=1
 on conflict do nothing;

create schema if not exists tz_private;
revoke all on schema tz_private from public;
create or replace function tz_private.freeze_legacy_halls() returns trigger
 language plpgsql set search_path='' as $$
begin
 if TG_OP='DELETE' or new.data->'halls' is distinct from old.data->'halls' then
  raise exception 'Обновите страницу: теперь у каждого администратора свой список залов.';
 end if;
 return new;
end $$;
revoke all on function tz_private.freeze_legacy_halls() from public;
create trigger freeze_legacy_halls before update or delete on public.settings
 for each row execute function tz_private.freeze_legacy_halls();

create or replace function tz_private.snapshot_event_halls() returns trigger
 language plpgsql set search_path='' as $$
declare hid text; nm text; names jsonb:=coalesce(new.data->'hallNames','{}'::jsonb); old_names jsonb:='{}'::jsonb;
begin
 if TG_OP='UPDATE' then old_names:=coalesce(old.data->'hallNames','{}'::jsonb); end if;
 if jsonb_typeof(names)<>'object' then names:='{}'::jsonb; end if;
 for hid in select jsonb_array_elements_text(coalesce(new.data->'halls','[]'::jsonb)) loop
  nm:=coalesce(nullif(names->>hid,''),nullif(old_names->>hid,''));
  if nm is null then
   select h->>'name' into nm from public.settings s cross join lateral jsonb_array_elements(s.data->'halls') h where s.id=1 and h->>'id'=hid limit 1;
  end if;
  if nm is null then
   select h->>'name' into nm from public.admin_hall_settings s cross join lateral jsonb_array_elements(s.data->'halls') h where s.user_id=auth.uid() and h->>'id'=hid limit 1;
  end if;
  names:=names||jsonb_build_object(hid,coalesce(nm,hid));
 end loop;
 new.data:=jsonb_set(new.data,'{hallNames}',names);
 return new;
end $$;
revoke all on function tz_private.snapshot_event_halls() from public;
create trigger snapshot_event_halls before insert or update on public.events
 for each row execute function tz_private.snapshot_event_halls();

CREATE OR REPLACE FUNCTION tz_telegram.on_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
 lines:=tz_telegram.file_update_lines(old.data,new.data);
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
   select coalesce(new.data#>>array['hallNames',coalesce(a.hall,b.hall)],old.data#>>array['hallNames',coalesce(a.hall,b.hall)],(select h->>'name' from public.settings s cross join lateral jsonb_array_elements(case when jsonb_typeof(s.data->'halls')='array' then s.data->'halls' else '[]'::jsonb end) h where s.id=1 and h->>'id'=coalesce(a.hall,b.hall) limit 1),'Зал')||': '||
    case when b.id is null then 'добавлено — '||a.description when a.id is null then 'убрано — '||b.description else b.description||' → '||a.description end
   from before_items b full join after_items a using(hall,department,id)
   where b.description is distinct from a.description
   order by coalesce(a.hall,b.hall),coalesce(a.id,b.id) limit 6
  loop lines:=array_append(lines,label); end loop;
  if cardinality(lines)=0 then lines:=array_append(lines,'Подробности по залам — в ТЗ.'); end if;
 end if;
 if old.data->'halls' is distinct from new.data->'halls' then lines:=array_append(lines,'Изменился список залов.'); end if;
 if cardinality(lines)=0 then lines:=array_append(lines,'Обновлены сведения о мероприятии.'); end if;
 insert into tz_telegram.outbox(chat,event,kind,message) select chat,new.id,'edit',left('Изменения в ТЗ · '||coalesce(new.data->>'title','Мероприятие')||E'\n'||array_to_string(lines,E'\n'),3400) from tz_telegram.subs where event=new.id;
 return new;
end $function$
;

CREATE OR REPLACE FUNCTION public.tg_hall_ready(p_event text, p_hall text, p_name text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
 select chat,p_event,'ready',concat_ws(E'\n',coalesce(d#>>array['hallNames',p_hall],hall_name,p_hall)||' - задачи по ТЗ выполнены',d->>'title',d->>'date','Подтвердил: '||n) from tz_telegram.admin_chats;
 return true;
end $function$
;

CREATE OR REPLACE FUNCTION tz_telegram.file_update_lines(before_data jsonb, after_data jsonb)
 RETURNS text[]
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare result text[]:='{}'; details text[]; hid text; hall_name text; key text; label text;
begin
 for hid in
  select distinct value from (
   select jsonb_array_elements_text(case when jsonb_typeof(before_data->'halls')='array' then before_data->'halls' else '[]'::jsonb end) value
   union select jsonb_array_elements_text(case when jsonb_typeof(after_data->'halls')='array' then after_data->'halls' else '[]'::jsonb end)
  ) halls order by value
 loop
  details:='{}';
  if tz_telegram.file_signature(before_data#>array['hallFiles',hid]) is distinct from tz_telegram.file_signature(after_data#>array['hallFiles',hid]) then
   details:=array_append(details,'• Обновлена схема зала');
  end if;
  for key,label in select * from (values ('light','Обновлён плот по свету'),('sound','Обновлены файлы по звуку'),('video','Обновлены файлы по видео'),('stage','Обновлены файлы по сцене'),('extra','Обновлены дополнительные файлы')) f(k,l) loop
   if tz_telegram.file_signature(before_data#>array['blocks',hid,key,'files']) is distinct from tz_telegram.file_signature(after_data#>array['blocks',hid,key,'files']) then
    details:=array_append(details,'• '||label);
   end if;
  end loop;
  if cardinality(details)>0 then
   select h->>'name' into hall_name from public.settings s cross join lateral jsonb_array_elements(s.data->'halls') h where s.id=1 and h->>'id'=hid limit 1;
   result:=result||array[coalesce(after_data#>>array['hallNames',hid],before_data#>>array['hallNames',hid],hall_name,hid)]||details;
  end if;
 end loop;
 details:='{}';
 for key,label in select * from (values ('tech','Обновлён технический сценарий'),('director','Обновлён режиссёрский сценарий'),('scheme','Обновлена общая схема')) f(k,l) loop
  if tz_telegram.file_signature(before_data#>array['docs',key]) is distinct from tz_telegram.file_signature(after_data#>array['docs',key]) then
   details:=array_append(details,'• '||label);
  end if;
 end loop;
 if cardinality(details)>0 then result:=result||array['Общие документы']||details; end if;
 return result;
end $function$
;
