-- Run in Supabase SQL Editor as the project owner, after inspecting the current schema.
-- Transactional: an error rolls back all changes in this script.
-- Does not change SMTP, accounts, existing technician-check RPCs or Storage access.
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
-- The website falls back only when the new RPC is absent. Disable the old public RPC
-- after v28 has been deployed so deleted events cannot be fetched via the old method.
do $$ begin
 if to_regprocedure('public.get_event(text)') is not null then
  execute 'revoke all on function public.get_event(text) from public,anon,authenticated';
 end if;
end $$;

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
