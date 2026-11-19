create or replace function public.get_event_v2(p_id text)
returns table(id text,data jsonb,version integer,updated_at timestamptz)
language sql stable security definer set search_path='' as $$
 select e.id,e.data,e.version,e.updated_at from public.events e
 where e.id=p_id and coalesce(e.data->>'deletedAt','')='';
$$;
revoke all on function public.get_event_v2(text) from public;
grant execute on function public.get_event_v2(text) to anon,authenticated;
create or replace function public.get_event(p_id text)
returns table(id text,data jsonb,version integer,updated_at timestamptz)
language sql stable security definer set search_path='' as $$
 select * from public.get_event_v2(p_id);
$$;
revoke all on function public.get_event(text) from public;
grant execute on function public.get_event(text) to anon,authenticated;

-- Internal task catalogue shared by validation and hall readiness.
create or replace function public.valid_event_tasks(d jsonb)
returns table(hall text,category text,item text)
language sql immutable set search_path='' as $$
 with blocks as (
 select h.value hall,c.category,d->'blocks'->h.value->c.category b
 from jsonb_array_elements_text(coalesce(d->'halls','[]')) h
 cross join (values ('sound'),('light'),('video'),('stage'),('extra')) c(category)
 ), specs as (
 select hall,category,s.value s from blocks
 cross join lateral jsonb_array_elements(
 jsonb_build_array(b->'spec')||coalesce(b->'stages','[]')) s
 where category='stage'
 )
 select hall,category,i->>'id' from blocks
 cross join lateral jsonb_array_elements(coalesce(b->'items','[]')) i
 where btrim(coalesce(i->>'name',''))<>'' and coalesce(i->>'id','')<>''
 union all
 select hall,category,(s->>'id')||':'||p.suffix from specs
 cross join lateral (values
 ('size',btrim(coalesce(s->>'w',''))<>'' or btrim(coalesce(s->>'d',''))<>'' or btrim(coalesce(s->>'h',''))<>''),
 ('cover',coalesce(s->>'cover','')<>'' or btrim(coalesce(s->>'coverNote',''))<>''),
 ('raus',s->>'raus'='yes' or btrim(coalesce(s->>'rausNote',''))<>''),
 ('steps',btrim(coalesce(s->>'stepsFront',''))<>'' or btrim(coalesce(s->>'stepsSide',''))<>'')
 ) p(suffix,shown)
 where coalesce(s->>'id','')<>'' and p.shown;
$$;
revoke all on function public.valid_event_tasks(jsonb) from public,anon,authenticated;

create or replace function public.set_check(p_event text,p_item text,p_done boolean,p_by text)
returns void language plpgsql security definer set search_path='' as $$
declare d jsonb;n text:=btrim(p_by);
begin
 select data into d from public.events where id=p_event for update;
 if d is null or coalesce(d->>'deletedAt','')<>'' then raise exception 'ТЗ недоступно';end if;
 if p_item is null or length(p_item)>60 or n is null or length(n) not between 1 and 60 then raise exception 'Проверьте позицию и имя';end if;
 if not exists(select from public.valid_event_tasks(d) t where t.item=p_item) then raise exception 'Позиция не найдена';end if;
 insert into public.checks(event_id,item_id,done,by_name,at)
 values(p_event,p_item,coalesce(p_done,false),n,now())
 on conflict(event_id,item_id) do update set done=excluded.done,by_name=excluded.by_name,at=excluded.at;
end $$;
revoke all on function public.set_check(text,text,boolean,text) from public;
grant execute on function public.set_check(text,text,boolean,text) to anon,authenticated;

create or replace function public.set_item_arrival(p_event text,p_item text,p_done boolean,p_by text)
returns void language plpgsql security definer set search_path='' as $$
declare d jsonb;n text:=btrim(p_by);
begin
 select data into d from public.events where id=p_event for update;
 if d is null or coalesce(d->>'deletedAt','')<>'' then raise exception 'ТЗ недоступно';end if;
 if p_item is null or length(p_item)>60 or n is null or length(n) not between 1 and 60 then raise exception 'Проверьте позицию и имя';end if;
 if not exists(select from public.valid_event_tasks(d) t where t.item=p_item and t.category<>'extra') then raise exception 'Позиция не найдена';end if;
 insert into public.checks(event_id,item_id,done,by_name,at)
 values(p_event,'arrival:'||p_item,coalesce(p_done,false),n,now())
 on conflict(event_id,item_id) do update set done=excluded.done,by_name=excluded.by_name,at=excluded.at;
end $$;
revoke all on function public.set_item_arrival(text,text,boolean,text) from public;
grant execute on function public.set_item_arrival(text,text,boolean,text) to anon,authenticated;
create or replace function public.get_checks(p_id text)
returns table(item_id text,by_name text,at timestamptz)
language sql stable security definer set search_path='' as $$
 select c.item_id,c.by_name,c.at from public.checks c
 join public.events e on e.id=c.event_id
 where c.event_id=p_id and c.done and coalesce(e.data->>'deletedAt','')='';
$$;

create or replace function public.tg_hall_ready(p_event text,p_hall text,p_name text)
returns boolean language plpgsql security definer set search_path='' as $$
declare d jsonb;hall_name text;n text:=btrim(p_name);
begin
 select data into d from public.events where id=p_event for update;
 if d is null or coalesce(d->>'deletedAt','')<>'' or d->>'status'='done' or not coalesce((d->'halls') ? p_hall,false) then raise exception 'Зал недоступен';end if;
 if n is null or length(n) not between 1 and 60 or not exists(select from public.checks where event_id=p_event and done and by_name=n) then raise exception 'Сначала отметьте выполненный пункт в этом ТЗ';end if;
 if not exists(select from public.valid_event_tasks(d) t where t.hall=p_hall)
 or exists(select from public.valid_event_tasks(d) t where t.hall=p_hall and (
 not exists(select from public.checks c where c.event_id=p_event and c.item_id=t.item and c.done)
 or (t.category<>'extra' and not exists(select from public.checks c where c.event_id=p_event and c.item_id='arrival:'||t.item and c.done))
 )) then raise exception 'Не все позиции зала доставлены и смонтированы';end if;
 if not exists(select from tz_telegram.bot where heartbeat>now()-interval '3 minutes') or not exists(select from tz_telegram.admin_chats) then raise exception 'Администраторы пока не подключены';end if;
 select h->>'name' into hall_name from public.settings s cross join lateral jsonb_array_elements(s.data->'halls') h where s.id=1 and h->>'id'=p_hall;
 insert into tz_telegram.ready values(p_event,p_hall,n) on conflict do nothing;
 if not found then return false;end if;
 insert into tz_telegram.outbox(chat,event,kind,message)
 select chat,p_event,'ready',concat_ws(E'\n',coalesce(d#>>array['hallNames',p_hall],hall_name,p_hall)||' - задачи по ТЗ выполнены',d->>'title',d->>'date','Подтвердил: '||n) from tz_telegram.admin_chats;
 return true;
end $$;
notify pgrst,'reload schema';
