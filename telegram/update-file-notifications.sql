-- Apply after telegram/setup.sql. Private helpers do not expose new RPCs.
begin;

create or replace function tz_telegram.file_signature(files jsonb) returns jsonb
language sql immutable set search_path='' as $$
 select coalesce(jsonb_agg(f order by f::text),'[]'::jsonb)
 from jsonb_array_elements(case when jsonb_typeof(files)='array' then files else '[]'::jsonb end) f
$$;
revoke all on function tz_telegram.file_signature(jsonb) from public,anon,authenticated;
create or replace function tz_telegram.file_update_lines(before_data jsonb,after_data jsonb) returns text[]
language plpgsql stable set search_path='' as $$
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
   result:=result||array[coalesce(hall_name,hid)]||details;
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
end $$;
revoke all on function tz_telegram.file_update_lines(jsonb,jsonb) from public,anon,authenticated;

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
   select coalesce((select h->>'name' from public.settings s cross join lateral jsonb_array_elements(case when jsonb_typeof(s.data->'halls')='array' then s.data->'halls' else '[]'::jsonb end) h where s.id=1 and h->>'id'=coalesce(a.hall,b.hall) limit 1),'Зал')||': '||
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
end $$;

commit;
