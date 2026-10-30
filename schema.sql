-- ТЗ на мероприятия: схема, права доступа, перенос данных
create table if not exists public.admins (email text primary key, added_at timestamptz not null default now());
create table if not exists public.settings (id int primary key default 1 check (id = 1), data jsonb not null default '{}'::jsonb, updated_at timestamptz not null default now());
create table if not exists public.events (id text primary key, data jsonb not null, version int not null default 1, updated_at timestamptz not null default now(), updated_by text);

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')));
$$;
revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to anon, authenticated;

create or replace function public.touch_event() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'UPDATE' then new.version := old.version + 1; end if;
  new.updated_at := now();
  new.updated_by := auth.jwt() ->> 'email';
  return new;
end $$;
drop trigger if exists events_touch on public.events;
create trigger events_touch before insert or update on public.events for each row execute function public.touch_event();

create or replace function public.lower_admin_email() returns trigger language plpgsql as $$
begin new.email := lower(trim(new.email)); return new; end $$;
drop trigger if exists admins_lower on public.admins;
create trigger admins_lower before insert or update on public.admins for each row execute function public.lower_admin_email();

alter table public.admins enable row level security;
alter table public.settings enable row level security;
alter table public.events enable row level security;

revoke all on public.admins, public.settings, public.events from anon, authenticated;
grant select on public.events, public.settings to anon, authenticated;
grant insert, update, delete on public.events, public.settings to authenticated;
grant select, insert, delete on public.admins to authenticated;

drop policy if exists "events read" on public.events;
drop policy if exists "events write" on public.events;
drop policy if exists "settings read" on public.settings;
drop policy if exists "settings write" on public.settings;
drop policy if exists "admins read" on public.admins;
drop policy if exists "admins add" on public.admins;
drop policy if exists "admins remove" on public.admins;
create policy "events read" on public.events for select to anon, authenticated using (true);
create policy "events write" on public.events for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "settings read" on public.settings for select to anon, authenticated using (true);
create policy "settings write" on public.settings for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "admins read" on public.admins for select to authenticated using (public.is_admin());
create policy "admins add" on public.admins for insert to authenticated with check (public.is_admin());
create policy "admins remove" on public.admins for delete to authenticated using (public.is_admin() and lower(email) <> lower(coalesce(auth.jwt() ->> 'email', '')));

do $$ begin
  begin alter publication supabase_realtime add table public.events; exception when others then null; end;
  begin alter publication supabase_realtime add table public.settings; exception when others then null; end;
end $$;

-- Первый администратор (замените адрес):
-- insert into public.admins (email) values ('you@example.com');
