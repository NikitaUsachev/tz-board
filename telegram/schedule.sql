-- First create the Vault secret tz_telegram_job, identical to TELEGRAM_JOB_SECRET.
create extension if not exists pg_net;
create extension if not exists pg_cron;
do $$ begin
 if not exists(select from vault.decrypted_secrets where name='tz_telegram_job' and length(decrypted_secret)>=32) then
  raise exception 'Добавьте секрет tz_telegram_job в Vault';
 end if;
end $$;
select net.http_post(url:='https://bhokqekbxbmdjhsqyads.supabase.co/functions/v1/tz-telegram',
 headers:=jsonb_build_object('Content-Type','application/json','x-job-secret',(select decrypted_secret from vault.decrypted_secrets where name='tz_telegram_job')),
 body:='{"action":"setup"}'::jsonb,timeout_milliseconds:=30000) as setup_request_id;
select cron.schedule('tz-telegram-delivery','* * * * *',$job$
 select net.http_post(url:='https://bhokqekbxbmdjhsqyads.supabase.co/functions/v1/tz-telegram',
 headers:=jsonb_build_object('Content-Type','application/json','x-job-secret',(select decrypted_secret from vault.decrypted_secrets where name='tz_telegram_job')),
 body:='{"action":"dispatch"}'::jsonb,timeout_milliseconds:=50000);
$job$);
