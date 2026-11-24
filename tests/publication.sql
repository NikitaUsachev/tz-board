-- Execute within BEGIN/ROLLBACK after applying the migration in that transaction.
do $$
declare e public.events; l uuid:=gen_random_uuid(); second uuid:=gen_random_uuid(); result jsonb;
begin
 if has_table_privilege('anon','public.tg_test_publications','select') or has_table_privilege('authenticated','public.tg_test_publications','update') then raise exception 'publication state exposed'; end if;
 if has_function_privilege('authenticated','public.tg_test_acquire(text,integer,uuid)','execute') then raise exception 'privileged RPC exposed'; end if;
 if not (select relrowsecurity from pg_class where oid='public.tg_test_publications'::regclass) then raise exception 'RLS missing'; end if;
 select * into e from public.events where coalesce(data->>'deletedAt','')='' limit 1;
 if not found then raise exception 'test requires one existing event'; end if;
 perform public.tg_test_acquire(e.id,e.version,l);
 begin perform public.tg_test_acquire(e.id,e.version,second); raise exception 'concurrent lease accepted'; exception when others then if sqlerrm<>'publication_busy' then raise; end if; end;
 perform public.tg_test_pending(e.id,l,'{"key":"head:0","kind":"send","text":"test"}');
 update public.tg_test_publications set lease_until=now()-interval '1 minute' where event_id=e.id;
 begin perform public.tg_test_acquire(e.id,e.version,second); raise exception 'uncertain send repeated'; exception when others then if sqlerrm<>'delivery_uncertain' then raise; end if; end;
 perform public.tg_test_finish(e.id,l,'{"id":42,"text":"test"}');
 select messages into result from public.tg_test_publications where event_id=e.id;
 if result#>>'{head:0,id}'<>'42' then raise exception 'checkpoint missing'; end if;
 perform public.tg_test_acquire(e.id,e.version,second);
 perform public.tg_test_pending(e.id,second,'{"key":"head:0","kind":"edit","id":42}');
 update public.tg_test_publications set lease_until=now()-interval '1 minute' where event_id=e.id;
 result:=public.tg_test_acquire(e.id,e.version,l);
 if result#>>'{pending,kind}'<>'edit' then raise exception 'edit recovery lost'; end if;
 begin perform public.tg_test_finish(e.id,second); raise exception 'old lease accepted'; exception when others then if sqlerrm<>'lease_expired' then raise; end if; end;
 perform public.tg_test_finish(e.id,l);
 begin perform public.tg_test_acquire(e.id,e.version+1,l); raise exception 'stale version accepted'; exception when others then if sqlerrm<>'version_changed' then raise; end if; end;
end $$;
