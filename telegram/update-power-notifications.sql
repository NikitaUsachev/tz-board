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
  if tz_telegram.file_signature(before_data#>array['hallPowerFiles',hid]) is distinct from tz_telegram.file_signature(after_data#>array['hallPowerFiles',hid]) then
   details:=array_append(details,'• Обновлена схема электропитания');
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
 for key,label in select * from (values ('tech','Обновлён технический сценарий'),('director','Обновлён режиссёрский сценарий'),('scheme','Обновлена общая схема'),('power','Обновлена схема электропитания')) f(k,l) loop
  if tz_telegram.file_signature(before_data#>array['docs',key]) is distinct from tz_telegram.file_signature(after_data#>array['docs',key]) then
   details:=array_append(details,'• '||label);
  end if;
 end loop;
 if cardinality(details)>0 then result:=result||array['Общие документы']||details; end if;
 return result;
end $function$
;