begin;
create table if not exists tz_telegram.shop_subs(chat bigint primary key, next_send timestamptz not null);
alter table tz_telegram.shop_subs enable row level security;
revoke all on tz_telegram.shop_subs from public,anon,authenticated;
do $$ begin
 if to_regprocedure('public.tg_command_before_shop(bigint,bigint,text,text,boolean)') is null then
 alter function public.tg_command(bigint,bigint,text,text,boolean) rename to tg_command_before_shop;
 end if;
end $$;
create or replace function public.tg_command(p_update bigint,p_chat bigint,p_command text,p_arg text,p_admin boolean)
returns void language plpgsql security definer set search_path='' as $$
declare reply text;
begin
 if p_command not in ('/shop','/shop_on','/shop_off') then
  perform public.tg_command_before_shop(p_update,p_chat,p_command,p_arg,p_admin);
  if p_command='/stop' then delete from tz_telegram.shop_subs where chat=p_chat; end if;
  return;
 end if;
 insert into tz_telegram.updates(id) values(p_update) on conflict do nothing;
 if not found then return; end if;
 if p_command='/shop_on' then
  insert into tz_telegram.shop_subs values(p_chat,now()+interval '7 days') on conflict do nothing;
  reply:='Подписка на акции Пятёрочки по Москве включена. Каталог будет приходить раз в неделю.';
 elsif p_command='/shop_off' then
  delete from tz_telegram.shop_subs where chat=p_chat;
  delete from tz_telegram.outbox where chat=p_chat and kind='shop';
  reply:='Подписка на акции отключена.';
 else reply:='Пятёрочка выручает 🛒 · Москва'; end if;
 insert into tz_telegram.outbox(chat,kind,message) values(p_chat,'shop_reply',reply||E'\nКаталог акций по Москве (источник — Прошопер):\nhttps://proshoper.ru/actions/pyaterochka/moskva/\nЦены и наличие уточняйте в своём магазине.');
end $$;
create or replace function public.tg_shop_tick() returns void language sql security definer set search_path='' as $$
 with due as (
 update tz_telegram.shop_subs set next_send=now()+interval '7 days'
 where chat in (select chat from tz_telegram.shop_subs where next_send<=now() order by next_send limit 100 for update skip locked)
 returning chat
 )
 insert into tz_telegram.outbox(chat,kind,message)
 select chat,'shop',E'Пятёрочка выручает 🛒 · Москва\nПора проверить каталог акций!\nhttps://proshoper.ru/actions/pyaterochka/moskva/\nИсточник — Прошопер. Сроки акций, цены и наличие проверяйте в каталоге и своём магазине.' from due;
$$;
create or replace function public.tg_shop_block(p_chat bigint) returns void language sql security definer set search_path='' as $$
 delete from tz_telegram.shop_subs where chat=p_chat;
$$;
revoke all on function public.tg_command(bigint,bigint,text,text,boolean),public.tg_shop_tick(),public.tg_shop_block(bigint) from public,anon,authenticated;
grant execute on function public.tg_command(bigint,bigint,text,text,boolean),public.tg_shop_tick(),public.tg_shop_block(bigint) to service_role;
notify pgrst,'reload schema';
commit;