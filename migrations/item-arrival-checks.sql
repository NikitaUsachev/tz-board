-- Arrival marks complement existing per-item completion marks (installation).
create or replace function public.set_item_arrival(p_event text,p_item text,p_done boolean,p_by text)
returns void language plpgsql security definer set search_path='' as $$
declare d jsonb; valid boolean; n text:=btrim(p_by);
begin
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
 insert into public.checks(event_id,item_id,done,by_name,at) values(p_event,'arrival:'||p_item,coalesce(p_done,false),n,now())
 on conflict(event_id,item_id) do update set done=excluded.done,by_name=excluded.by_name,at=excluded.at;
end $$;
revoke all on function public.set_item_arrival(text,text,boolean,text) from public;
grant execute on function public.set_item_arrival(text,text,boolean,text) to anon,authenticated;
