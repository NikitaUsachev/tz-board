-- Обновить только текст будущих уведомлений о готовности зала.
do $patch$
declare
  definition text := pg_get_functiondef('public.tg_hall_ready(text,text,text)'::regprocedure);
  previous text := $old$||' готов к прогонам'$old$;
  replacement text := $new$||' - задачи по ТЗ выполнены'$new$;
begin
  if strpos(definition, previous) > 0 then
    execute replace(definition, previous, replacement);
  elsif strpos(definition, replacement) = 0 then
    raise exception 'Текст функции отличается от ожидаемого. Изменения не внесены.';
  end if;
end
$patch$;
