-- Retain historical names and attach account IDs to new marks.
alter table public.checks add column if not exists actor_id uuid;

CREATE OR REPLACE FUNCTION public.set_check(p_event text, p_item text, p_done boolean, p_by text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare d jsonb; n text;
begin
  select left(nullif(btrim(u.raw_user_meta_data->>'technician_name'),''),60) into n
 from auth.users u where u.id=auth.uid() and u.email_confirmed_at is not null;
 if n is null and public.is_admin() then
   select left(split_part(u.email,'@',1),60) into n from auth.users u where u.id=auth.uid();
 end if;
 if n is null then raise exception 'Войдите и укажите имя техника'; end if;
  select data into d from public.events where id=p_event for update;
  if d is null or coalesce(d->>'deletedAt','')<>'' then raise exception 'ТЗ не найдено'; end if;
  if p_item is null or length(p_item)>60 then raise exception 'Позиция не найдена'; end if;
  if not (
    jsonb_path_exists(d,'$.blocks.*.*.items[*] ? (@.id == $i)',jsonb_build_object('i',p_item))
    or (split_part(p_item,':',2) in ('size','cover','raus','steps')
        and (jsonb_path_exists(d,'$.blocks.*.*.spec ? (@.id == $i)',jsonb_build_object('i',split_part(p_item,':',1)))
 or jsonb_path_exists(d,'$.blocks.*.*.stages[*] ? (@.id == $i)',jsonb_build_object('i',split_part(p_item,':',1)))))
  ) then
    raise exception 'Позиция не найдена';
  end if;
  insert into public.checks(event_id,item_id,done,by_name,at,actor_id)
  values(p_event,p_item,coalesce(p_done,false),n,now(),auth.uid())
  on conflict(event_id,item_id) do update set done=excluded.done,by_name=excluded.by_name,at=excluded.at,actor_id=excluded.actor_id;
end $function$;

CREATE OR REPLACE FUNCTION public.set_item_arrival(p_event text, p_item text, p_done boolean, p_by text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare d jsonb; valid boolean; n text;
begin
 select left(nullif(btrim(u.raw_user_meta_data->>'technician_name'),''),60) into n
 from auth.users u where u.id=auth.uid() and u.email_confirmed_at is not null;
 if n is null and public.is_admin() then
   select left(split_part(u.email,'@',1),60) into n from auth.users u where u.id=auth.uid();
 end if;
 if n is null then raise exception 'Войдите и укажите имя техника'; end if;
 select data into d from public.events where id=p_event for update;
 if d is null or coalesce(d->>'deletedAt','')<>'' then raise exception 'ТЗ недоступно';end if;
 if p_item is null or length(p_item)>60 or n is null or length(n) not between 1 and 60 then raise exception 'Проверьте позицию и имя';end if;
 select exists(
 select from jsonb_array_elements_text(coalesce(d->'halls','[]')) h
 cross join (values ('sound'),('light'),('video'),('stage')) cats(c)
 cross join lateral jsonb_array_elements(coalesce(d->'blocks'->h->c->'items','[]')) i
 where i->>'id'=p_item and btrim(coalesce(i->>'name',''))<>''
 ) or exists(
 select from jsonb_array_elements_text(coalesce(d->'halls','[]')) h
 cross join lateral jsonb_array_elements(jsonb_build_array(d->'blocks'->h->'stage'->'spec')||coalesce(d->'blocks'->h->'stage'->'stages','[]')) s
 where s->>'id'=split_part(p_item,':',1) and case split_part(p_item,':',2)
 when 'size' then coalesce(s->>'w','')<>'' or coalesce(s->>'d','')<>'' or coalesce(s->>'h','')<>''
 when 'cover' then coalesce(s->>'cover','')<>'' or btrim(coalesce(s->>'coverNote',''))<>''
 when 'raus' then s->>'raus'='yes' or btrim(coalesce(s->>'rausNote',''))<>''
 when 'steps' then coalesce(s->>'stepsFront','')<>'' or coalesce(s->>'stepsSide','')<>''
 else false end
 ) into valid;
 if not valid then raise exception 'Позиция не найдена';end if;
 insert into public.checks(event_id,item_id,done,by_name,at,actor_id) values(p_event,'arrival:'||p_item,coalesce(p_done,false),n,now(),auth.uid())
 on conflict(event_id,item_id) do update set done=excluded.done,by_name=excluded.by_name,at=excluded.at,actor_id=excluded.actor_id;
end $function$;

CREATE OR REPLACE FUNCTION public.tg_hall_ready(p_event text, p_hall text, p_name text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare d jsonb; hall_name text; n text;
begin
 select left(nullif(btrim(u.raw_user_meta_data->>'technician_name'),''),60) into n
 from auth.users u where u.id=auth.uid() and u.email_confirmed_at is not null;
 if n is null and public.is_admin() then
   select left(split_part(u.email,'@',1),60) into n from auth.users u where u.id=auth.uid();
 end if;
 if n is null then raise exception 'Войдите и укажите имя техника'; end if;
 select data into d from public.events where id=p_event for share;
 if d is null or coalesce(d->>'deletedAt','')<>'' or d->>'status'='done' or not coalesce((d->'halls') ? p_hall,false) then raise exception 'Зал недоступен'; end if;
 if n is null or length(n) not between 1 and 60 or not exists(select from public.checks where event_id=p_event and done and actor_id=auth.uid()) then raise exception 'Сначала отметьте выполненный пункт в этом ТЗ'; end if;
 if not exists(select from tz_telegram.bot where heartbeat>now()-interval '3 minutes') or not exists(select from tz_telegram.admin_chats) then raise exception 'Администраторы пока не подключены'; end if;
 select h->>'name' into hall_name from public.settings s cross join lateral jsonb_array_elements(s.data->'halls') h where s.id=1 and h->>'id'=p_hall;
 insert into tz_telegram.ready values(p_event,p_hall,n) on conflict do nothing;
 if not found then return false; end if;
 insert into tz_telegram.outbox(chat,event,kind,message)
 select chat,p_event,'ready',concat_ws(E'\n',coalesce(d#>>array['hallNames',p_hall],hall_name,p_hall)||' - задачи по ТЗ выполнены',d->>'title',d->>'date','Подтвердил: '||n) from tz_telegram.admin_chats;
 return true;
end $function$;

CREATE OR REPLACE FUNCTION public.list_admin_requests()
 RETURNS TABLE(email text, created_at timestamp with time zone, confirmed boolean, last_sign_in timestamp with time zone, rejected boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.is_admin() then raise exception 'Нет доступа'; end if;
  return query
    select u.email::text, u.created_at, (u.email_confirmed_at is not null), u.last_sign_in_at,
           exists(select 1 from public.admin_rejects r where lower(r.email)=lower(u.email))
    from auth.users u
    where u.email is not null
      and nullif(btrim(u.raw_user_meta_data->>'technician_name'),'') is null
      and not exists(select 1 from public.admins a where lower(a.email)=lower(u.email))
    order by u.created_at desc;
end $function$;

revoke execute on function public.set_check(text,text,boolean,text), public.set_item_arrival(text,text,boolean,text), public.tg_hall_ready(text,text,text) from public, anon;
grant execute on function public.set_check(text,text,boolean,text), public.set_item_arrival(text,text,boolean,text), public.tg_hall_ready(text,text,text) to authenticated;
