-- Read only. No SMTP passwords, API keys, account passwords or event contents.
select schemaname,tablename,policyname,permissive,roles,cmd,qual,with_check
from pg_policies where schemaname in ('public','storage') order by schemaname,tablename,policyname;

select n.nspname as schema_name,p.proname,pg_get_function_identity_arguments(p.oid) as arguments,
 p.prosecdef as security_definer,p.proacl as permissions,pg_get_functiondef(p.oid) as definition
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.prokind='f' and p.proname in
 ('is_admin','get_event','get_event_v2','get_checks','set_check','my_request_status','list_admin_requests','decide_admin_request','touch_event')
order by p.proname;

select tgname,tgenabled,pg_get_triggerdef(oid) as definition from pg_trigger
where tgrelid='public.events'::regclass and not tgisinternal;

select c.relname,c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relkind='r';

select id,public,file_size_limit,allowed_mime_types from storage.buckets;

-- Aggregate only: detect room/date overlaps before installing the booking trigger.
select count(*) as conflicting_pairs from public.events a join public.events b on a.id<b.id
where nullif(a.data->>'deletedAt','') is null and nullif(b.data->>'deletedAt','') is null
and nullif(a.data->>'date','') is not null and a.data->>'date'=b.data->>'date'
and exists(select 1 from jsonb_array_elements_text(case when jsonb_typeof(a.data->'halls')='array' then a.data->'halls' else '[]'::jsonb end) x
join jsonb_array_elements_text(case when jsonb_typeof(b.data->'halls')='array' then b.data->'halls' else '[]'::jsonb end) y on x.value=y.value);
