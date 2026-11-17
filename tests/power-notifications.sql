begin;
do $$
declare base jsonb:='{"halls":["h"],"hallNames":{"h":"Тестовый зал"}}'; changed jsonb; replaced jsonb; lines text[];
begin
 changed:=base||'{"hallPowerFiles":{"h":[{"path":"hall.pdf","name":"hall.pdf"}]},"docs":{"power":[{"path":"general.pdf","name":"general.pdf"}]}}'::jsonb;
 lines:=tz_telegram.file_update_lines(base,changed);
 if lines is distinct from array['Тестовый зал','• Обновлена схема электропитания','Общие документы','• Обновлена схема электропитания'] then raise exception 'Addition: %',lines;end if;
 if cardinality(tz_telegram.file_update_lines(changed,changed))<>0 then raise exception 'Unchanged files notified';end if;
 replaced:=jsonb_set(changed,'{hallPowerFiles,h}','[{"path":"replacement.pdf","name":"replacement.pdf"}]');
 lines:=tz_telegram.file_update_lines(changed,replaced);
 if lines is distinct from array['Тестовый зал','• Обновлена схема электропитания'] then raise exception 'Replacement: %',lines;end if;
 lines:=tz_telegram.file_update_lines(changed,base);
 if cardinality(lines)<>4 then raise exception 'Removal: %',lines;end if;
 changed:=base||'{"hallFiles":{"h":[{"path":"layout.pdf"}]},"docs":{"tech":[{"path":"script.pdf"}]}}'::jsonb;
 lines:=tz_telegram.file_update_lines(base,changed);
 if lines is distinct from array['Тестовый зал','• Обновлена схема зала','Общие документы','• Обновлён технический сценарий'] then raise exception 'Existing document regression: %',lines;end if;
end $$;
rollback;
