-- Run in Supabase SQL Editor as the project owner, after inspecting the current schema.
-- Transactional: an error rolls back all changes in this script.
-- Preserves SMTP, accounts and Storage configuration; hardens check RPCs without changing their signatures.
begin;

-- Keep a server-side copy of the previous event before updates and physical deletion.
create table if not exists public.event_history (
 id bigint generated always as identity primary key,
 event_id text not null,
 event_version integer not null,
 data jsonb not null,
 saved_at timestamptz not null default now(),
 saved_by text,
 operation text not null check (operation in ('UPDATE','DELETE'))
);
create index if not exists event_history_event_saved on public.event_history(event_id,saved_at desc);
alter table public.event_history enable row level security;
revoke all on public.event_history from anon,authenticated;
grant select on public.event_history to authenticated;
drop policy if exists "history admins read" on public.event_history;
create policy "history admins read" on public.event_history for select to authenticated using (public.is_admin());

create or replace function public.record_event_history_v28() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if tg_op='DELETE' then
  insert into public.event_history(event_id,event_version,data,saved_by,operation)
  values(old.id,old.version,old.data,auth.jwt()->>'email',tg_op);
  return old;
 elsif old.data is distinct from new.data then
  insert into public.event_history(event_id,event_version,data,saved_by,operation)
  values(old.id,old.version,old.data,auth.jwt()->>'email',tg_op);
 end if;
 return new;
end $$;
revoke all on function public.record_event_history_v28() from public,anon,authenticated;
drop trigger if exists events_history_v28 on public.events;
create trigger events_history_v28 after update or delete on public.events
for each row execute function public.record_event_history_v28();

-- Make old permissive read policies unable to expose the whole board to technicians.
drop policy if exists "events direct read guard v28" on public.events;
create policy "events direct read guard v28" on public.events as restrictive
for select to anon,authenticated using (public.is_admin());

-- New RPC: compatible with the website and excludes events in the trash.
create or replace function public.get_event_v2(p_id text)
returns table(id text,data jsonb,version integer,updated_at timestamptz)
language sql stable security definer set search_path=public,pg_temp as $$
 select e.id,e.data,e.version,e.updated_at from public.events e
 where e.id=p_id and nullif(e.data->>'deletedAt','') is null;
$$;
revoke all on function public.get_event_v2(text) from public;
grant execute on function public.get_event_v2(text) to anon,authenticated;
-- Preserve old open technician pages while closing access to trashed events.
create or replace function public.get_event(p_id text)
returns table(id text,data jsonb,version integer,updated_at timestamptz)
language sql stable security definer set search_path=public,pg_temp as $$
 select e.id,e.data,e.version,e.updated_at from public.events e
 where e.id=p_id and nullif(e.data->>'deletedAt','') is null;
$$;
revoke all on function public.get_event(text) from public;
grant execute on function public.get_event(text) to anon,authenticated;

-- A task is available only while its hall and its visible item/spec are in this TЗ.
create or replace function public.event_has_task_v28(d jsonb,p_item text)
returns boolean language plpgsql immutable set search_path=public,pg_temp as $$
declare h record; b record; sp jsonb; suffix text;
begin
 if d is null or p_item is null or length(p_item)=0 or length(p_item)>60 then return false; end if;
 if jsonb_typeof(d->'halls') is distinct from 'array' or jsonb_typeof(d->'blocks') is distinct from 'object' then return false; end if;
 for h in select key,value from jsonb_each(d->'blocks') loop
  if not (d->'halls' ? h.key) or jsonb_typeof(h.value)<>'object' then continue; end if;
  for b in select key,value from jsonb_each(h.value) loop
   if jsonb_path_exists(b.value,'$.items[*] ? (@.id == $i)',jsonb_build_object('i',p_item))
      and exists(select 1 from jsonb_array_elements(case when jsonb_typeof(b.value->'items')='array' then b.value->'items' else '[]'::jsonb end) it
                 where it->>'id'=p_item and nullif(btrim(it->>'name'),'') is not null) then return true; end if;
   sp:=b.value->'spec';suffix:=split_part(p_item,':',2);
   if b.key='stage' and sp->>'id'=split_part(p_item,':',1)
      and p_item=(sp->>'id')||':'||suffix then
    if suffix='size' and coalesce(nullif(btrim(sp->>'w'),''),nullif(btrim(sp->>'d'),''),nullif(btrim(sp->>'h'),'')) is not null then return true; end if;
    if suffix='cover' and coalesce(nullif(btrim(sp->>'cover'),''),nullif(btrim(sp->>'coverNote'),'')) is not null then return true; end if;
    if suffix='raus' and (sp->>'raus'='yes' or nullif(btrim(sp->>'rausNote'),'') is not null) then return true; end if;
    if suffix='steps' and coalesce(nullif(btrim(sp->>'stepsFront'),''),nullif(btrim(sp->>'stepsSide'),'')) is not null then return true; end if;
   end if;
  end loop;
 end loop;
 return false;
end $$;
revoke all on function public.event_has_task_v28(jsonb,text) from public,anon,authenticated;

create or replace function public.get_checks(p_id text)
returns table(item_id text,by_name text,at timestamptz)
language sql stable security definer set search_path=public,pg_temp as $$
 select c.item_id,c.by_name,c.at from public.checks c
 join public.events e on e.id=c.event_id
 where c.event_id=p_id and c.done and nullif(e.data->>'deletedAt','') is null
 and public.event_has_task_v28(e.data,c.item_id);
$$;
revoke all on function public.get_checks(text) from public;
grant execute on function public.get_checks(text) to anon,authenticated;

create or replace function public.set_check(p_event text,p_item text,p_done boolean,p_by text)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare d jsonb; nm text:=left(nullif(btrim(regexp_replace(coalesce(p_by,''),'[[:space:]]+',' ','g')),''),60);
begin
 if p_done is null then raise exception 'Не указано состояние отметки'; end if;
 if p_done and nm is null then raise exception 'Укажите имя перед первой отметкой'; end if;
 -- Share lock prevents the task being removed while this check is being recorded.
 select data into d from public.events where id=p_event for share;
 if d is null or nullif(d->>'deletedAt','') is not null then raise exception 'ТЗ не найдено'; end if;
 if not public.event_has_task_v28(d,p_item) then raise exception 'Пункт изменён или больше не входит в ТЗ. Обновите страницу.'; end if;
 insert into public.checks(event_id,item_id,done,by_name,at)
 values(p_event,p_item,p_done,nm,now())
 on conflict(event_id,item_id) do update set done=excluded.done,by_name=excluded.by_name,at=now();
end $$;
revoke all on function public.set_check(text,text,boolean,text) from public;
grant execute on function public.set_check(text,text,boolean,text) to anon,authenticated;

-- Serialize bookings by date. This does not restrict using a hall on different dates.
create or replace function public.guard_event_booking_v28() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare
 event_date text; old_date text; lock_date text; chosen_halls jsonb; conflicting_id text;
begin
 event_date:=nullif(new.data->>'date','');
 if tg_op='UPDATE' then old_date:=nullif(old.data->>'date',''); end if;
 for lock_date in select distinct x from unnest(array[event_date,old_date]) x where x is not null order by x loop
  perform pg_advisory_xact_lock(hashtextextended('tz-board/date/'||lock_date,0));
 end loop;
 if nullif(new.data->>'deletedAt','') is not null or event_date is null then return new; end if;
 perform event_date::date;
 chosen_halls:=coalesce(new.data->'halls','[]'::jsonb);
 if jsonb_typeof(chosen_halls)<>'array' then raise exception 'Некорректный список залов'; end if;
 if jsonb_array_length(chosen_halls)=0 then return new; end if;
 select e.id into conflicting_id from public.events e
 where e.id<>new.id and e.data->>'date'=event_date and nullif(e.data->>'deletedAt','') is null
 and exists (
  select 1 from jsonb_array_elements_text(case when jsonb_typeof(e.data->'halls')='array' then e.data->'halls' else '[]'::jsonb end) a
  join jsonb_array_elements_text(chosen_halls) b on a.value=b.value
 ) limit 1;
 if conflicting_id is not null then
  raise exception using errcode='23514',message='Один из залов уже указан в другом мероприятии на эту дату. Обновите доску и проверьте дату и залы.';
 end if;
 return new;
end $$;
revoke all on function public.guard_event_booking_v28() from public,anon,authenticated;
drop trigger if exists events_booking_guard_v28 on public.events;
create trigger events_booking_guard_v28 before insert or update on public.events
for each row execute function public.guard_event_booking_v28();

-- New schemas must increment event versions for optimistic locking to work.
-- Abort rather than silently pretending the application has concurrency protection.
do $$ begin
 if not exists(select 1 from pg_trigger where tgrelid='public.events'::regclass and not tgisinternal and tgenabled<>'D' and tgfoid=to_regprocedure('public.touch_event()')) then
  raise exception 'Не найден действующий триггер touch_event. Нужна проверка схемы до применения обновления.';
 end if;
end $$;

notify pgrst,'reload schema';
commit;
