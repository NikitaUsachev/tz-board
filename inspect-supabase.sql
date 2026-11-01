-- Read-only inspection. Does not include account passwords or SMTP credentials.
select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
from pg_policies where schemaname in ('public','storage') order by schemaname,tablename,policyname;

select n.nspname as schema_name, p.proname, pg_get_function_identity_arguments(p.oid) as arguments,
       p.prosecdef as security_definer, p.proacl as permissions, pg_get_functiondef(p.oid) as definition
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in
 ('is_admin','get_event','get_checks','set_check','my_request_status','list_admin_requests','decide_admin_request','touch_event')
order by p.proname;

select id, public, file_size_limit, allowed_mime_types from storage.buckets;
