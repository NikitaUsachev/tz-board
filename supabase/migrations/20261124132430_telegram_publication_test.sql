-- Isolated test-topic publication; no triggers, no subscriber/outbox changes.
create table public.tg_test_publications (
 event_id text primary key references public.events(id),
 messages jsonb not null default '{}'::jsonb,
 pending jsonb,
 lease uuid,
 lease_until timestamptz,
 updated_at timestamptz not null default now()
);
alter table public.tg_test_publications enable row level security;
revoke all on public.tg_test_publications from public, anon, authenticated;
grant select,insert,update on public.tg_test_publications to service_role;
create function public.tg_test_acquire(p_event text,p_version integer,p_lease uuid)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare e public.events; p public.tg_test_publications;
begin
 select * into e from public.events where id=p_event for share;
 if not found or coalesce(e.data->>'deletedAt','')<>'' then raise exception 'event_unavailable'; end if;
 if e.version<>p_version then raise exception 'version_changed'; end if;
 insert into public.tg_test_publications(event_id) values(p_event) on conflict do nothing;
 select * into p from public.tg_test_publications where event_id=p_event for update;
 if p.lease_until>now() then raise exception 'publication_busy'; end if;
 if p.pending->>'kind'='send' then raise exception 'delivery_uncertain'; end if;
 update public.tg_test_publications set lease=p_lease,lease_until=now()+interval '60 seconds' where event_id=p_event;
 return jsonb_build_object('messages',p.messages,'pending',p.pending);
end $$;
create function public.tg_test_pending(p_event text,p_lease uuid,p_operation jsonb)
returns void language plpgsql security invoker set search_path=public as $$
begin
 update public.tg_test_publications set pending=p_operation where event_id=p_event and lease=p_lease and lease_until>now();
 if not found then raise exception 'lease_expired'; end if;
end $$;
create function public.tg_test_finish(p_event text,p_lease uuid,p_message jsonb default null)
returns void language plpgsql security invoker set search_path=public as $$
begin
 update public.tg_test_publications set
 messages=case when p_message is null then messages else jsonb_set(messages,array[pending->>'key'],p_message) end,
 pending=null,lease=null,lease_until=null,updated_at=now()
 where event_id=p_event and lease=p_lease;
 if not found then raise exception 'lease_expired'; end if;
end $$;
revoke all on function public.tg_test_acquire(text,integer,uuid),public.tg_test_pending(text,uuid,jsonb),public.tg_test_finish(text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.tg_test_acquire(text,integer,uuid),public.tg_test_pending(text,uuid,jsonb),public.tg_test_finish(text,uuid,jsonb) to service_role;
