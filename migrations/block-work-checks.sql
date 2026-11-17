-- Additive migration. Existing per-item checks and RPCs remain compatible.
create or replace function public.set_block_check(p_event text,p_hall text,p_category text,p_phase text,p_done boolean,p_by text)
returns void language plpgsql security definer set search_path = '' as $$
declare d jsonb; b jsonb; k text; n text:=btrim(p_by);
begin
 select data into d from public.events where id=p_event for update;
 if d is null or coalesce(d->>'deletedAt','')<>'' then raise exception 'ТЗ недоступно'; end if;
 if p_category is null or p_category not in ('sound','light','video','stage') or p_phase is null or p_phase not in ('present','mounted') or p_hall is null or not coalesce(d->'halls' ? p_hall,false) then raise exception 'Блок недоступен'; end if;
 b:=d->'blocks'->p_hall->p_category;
 if b is null or not (
 exists(select from jsonb_array_elements(coalesce(b->'items','[]')) i where btrim(coalesce(i->>'name',''))<>'')
 or (p_category='stage' and exists(
 select from jsonb_array_elements(jsonb_build_array(b->'spec')||coalesce(b->'stages','[]')) s
 where coalesce(s->>'id','')<>'' and (
 coalesce(s->>'w','')<>'' or coalesce(s->>'d','')<>'' or coalesce(s->>'h','')<>'' or coalesce(s->>'cover','')<>'' or btrim(coalesce(s->>'coverNote',''))<>'' or btrim(coalesce(s->>'rausNote',''))<>'' or coalesce(s->>'raus','')='yes' or coalesce(s->>'stepsFront','')<>'' or coalesce(s->>'stepsSide','')<>'')))
 ) then raise exception 'В блоке нет оборудования'; end if;
 if n is null or length(n) not between 1 and 60 then raise exception 'Укажите имя и фамилию'; end if;
 k:='block:['||to_json(p_hall)::text||','||to_json(p_category)::text||','||to_json(p_phase)::text||']';
 insert into public.checks(event_id,item_id,done,by_name,at) values(p_event,k,coalesce(p_done,false),n,now())
 on conflict(event_id,item_id) do update set done=excluded.done,by_name=excluded.by_name,at=excluded.at;
end $$;
revoke all on function public.set_block_check(text,text,text,text,boolean,text) from public;
grant execute on function public.set_block_check(text,text,text,text,boolean,text) to anon,authenticated;

create or replace function public.reset_block_work_checks()
returns trigger language plpgsql security definer set search_path = '' as $$
declare h text; c text; phase text; a jsonb; b jsonb;
begin
 for h in select jsonb_object_keys(coalesce(old.data->'blocks','{}')) loop
  foreach c in array array['sound','light','video','stage'] loop
   a:=old.data->'blocks'->h->c; b:=new.data->'blocks'->h->c;
   if not coalesce(new.data->'halls' ? h,false) or
    jsonb_build_array(a->'items',a->'spec',a->'stages') is distinct from jsonb_build_array(b->'items',b->'spec',b->'stages') then
    foreach phase in array array['present','mounted'] loop
     delete from public.checks where event_id=new.id and item_id='block:['||to_json(h)::text||','||to_json(c)::text||','||to_json(phase)::text||']';
    end loop;
   end if;
  end loop;
 end loop;
 return new;
end $$;
revoke all on function public.reset_block_work_checks() from public,anon,authenticated;
drop trigger if exists reset_block_work_checks on public.events;
create trigger reset_block_work_checks after update of data on public.events for each row execute function public.reset_block_work_checks();
