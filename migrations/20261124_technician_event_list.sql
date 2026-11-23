create or replace function public.list_technician_events()
returns table(id text,title text,status text,event_date text,mount_date text,start_time text,hall_names jsonb)
language sql stable security definer set search_path = ''
as $$
 select e.id, coalesce(e.data->>'title',''), e.data->>'status', e.data->>'date',
        e.data->>'mountDate', e.data->>'start',
        coalesce((select jsonb_agg(n.name order by n.ord)
                 from jsonb_array_elements_text(case when jsonb_typeof(e.data->'halls')='array' then e.data->'halls' else '[]'::jsonb end) with ordinality h(id,ord)
                 cross join lateral (select coalesce(e.data->'hallNames'->>h.id,
                   (select v->>'name' from public.settings s cross join lateral jsonb_array_elements(coalesce(s.data->'halls','[]'::jsonb)) v where s.id=1 and v->>'id'=h.id limit 1)) as name,h.ord) n
                 where n.name is not null),'[]'::jsonb)
 from public.events e
 where coalesce(e.data->>'deletedAt','')='' and e.data->>'status' in ('prep','ready')
   and exists(select from auth.users u where u.id=auth.uid() and u.email_confirmed_at is not null
     and nullif(btrim(u.raw_user_meta_data->>'technician_name'),'') is not null)
 order by e.data->>'date' nulls last,e.id;
$$;
revoke execute on function public.list_technician_events() from public, anon;
grant execute on function public.list_technician_events() to authenticated;
