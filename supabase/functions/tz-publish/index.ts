// @ts-nocheck
import {TARGET,documents,plan} from './content.mjs';
const root=Deno.env.get('SUPABASE_URL');
const key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const bot=Deno.env.get('TELEGRAM_BOT_TOKEN');
const cors={'Access-Control-Allow-Origin':'https://nikitausachev.github.io','Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info','Access-Control-Allow-Methods':'POST, OPTIONS','Vary':'Origin'};
const reply=(data,status=200)=>Response.json(data,{status,headers:cors});
class PublicError extends Error { constructor(message,status=400){super(message);this.status=status;} }
async function db(path,body,authorization='Bearer '+key){
 const r=await fetch(root+'/rest/v1/'+path,{method:body===undefined?'GET':'POST',headers:{apikey:key,Authorization:authorization,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(9000)});
 if(!r.ok){const t=await r.text();
 for(const [code,message] of Object.entries({version_changed:'ТЗ изменилось. Закройте окно и откройте предпросмотр заново.',publication_busy:'Отправка уже выполняется. Повторите через минуту.',delivery_uncertain:'Результат отправки неизвестен. Проверьте тему Telegram; автоматический повтор заблокирован во избежание дубля.',event_unavailable:'ТЗ удалено или недоступно.'}))if(t.includes(code))throw new PublicError(message,409);
 throw new PublicError('Не удалось сохранить состояние публикации. Проверьте соединение и повторите позже.',503);
 }return r.status===204?null:r.json();
}
async function tg(method,body){const r=await fetch('https://api.telegram.org/bot'+bot+'/'+method,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(10000)});return r.json();}
Deno.serve(async req=>{
 if(req.method==='OPTIONS')return new Response(null,{headers:cors});
 if(req.method!=='POST')return reply({error:'Метод не поддерживается'},405);
 try{
 const auth=req.headers.get('Authorization')||'';
 if(!/^Bearer .+/.test(auth))return reply({error:'Войдите как администратор'},401);
 // Validate a real user session; a public key or service-role JWT is not an admin session.
 const user=await fetch(root+'/auth/v1/user',{headers:{apikey:key,Authorization:auth},signal:AbortSignal.timeout(9000)});
 if(!user.ok)return reply({error:'Войдите заново'},401);
 if(!await db('rpc/is_admin',{},auth))return reply({error:'Доступ только администраторам'},403);
 const input=await req.json();
 if(!['preview','step'].includes(input.action)||typeof input.event!=='string'||input.event.length>100)throw new PublicError('Некорректный запрос');
 const rows=await db('events?id=eq.'+encodeURIComponent(input.event)+'&select=id,data,version',undefined,auth);
 const row=rows[0];if(!row||row.data.deletedAt)throw new PublicError('ТЗ недоступно',404);
 const ev={...row.data,id:row.id};
 // Legacy events may not yet contain hallNames snapshots.
 const settings=await db('settings?id=eq.1&select=data',undefined,auth);
 const halls=Object.fromEntries((settings[0]?.data?.halls||[]).map(h=>[h.id,h.name]));
 const desired=documents(ev,root,halls);
 const savedRows=await db('tg_test_publications?event_id=eq.'+encodeURIComponent(row.id)+'&select=messages,pending,lease_until');
 const saved=savedRows[0]||{messages:{}};
 const changes=plan(desired,saved.messages);
 if(input.action==='preview')return reply({target:TARGET,version:row.version,published:Object.keys(saved.messages).length>0,changes,pending:!!saved.pending});
 if(!Number.isInteger(input.version)||input.version!==row.version)throw new PublicError('ТЗ изменилось. Откройте предпросмотр заново.',409);
 if(!bot)throw new PublicError('Бот не настроен',503);
 const lease=crypto.randomUUID();
 const state=await db('rpc/tg_test_acquire',{p_event:row.id,p_version:input.version,p_lease:lease});
 // Resume an interrupted edit first: repeating editMessageText is safe.
 const operation=state.pending||plan(desired,state.messages)[0];
 if(!operation){await db('rpc/tg_test_finish',{p_event:row.id,p_lease:lease});return reply({done:true});}
 await db('rpc/tg_test_pending',{p_event:row.id,p_lease:lease,p_operation:operation});
 const args={chat_id:TARGET.chat_id,text:operation.text,link_preview_options:{is_disabled:true}};
 if(operation.kind==='send'){args.message_thread_id=TARGET.message_thread_id;args.disable_notification=true;}
 else args.message_id=operation.id;
 let result;
 try{result=await tg(operation.kind==='send'?'sendMessage':'editMessageText',args);}
 catch{throw new PublicError('Ответ Telegram не получен. Проверьте тему. Повторная отправка нового сообщения заблокирована, чтобы не создать дубль.',503);}
 const unchanged=operation.kind==='edit'&&result.error_code===400&&String(result.description).includes('message is not modified');
 if(!result.ok&&!unchanged){
 // Only definite client errors are safe to clear; an upstream 5xx may have delivered.
 if([400,401,403,404,429].includes(result.error_code))await db('rpc/tg_test_finish',{p_event:row.id,p_lease:lease});
 const detail=result.error_code===429?'Лимит Telegram. Повторите через '+(result.parameters?.retry_after||60)+' секунд.':result.error_code===403?'Добавьте @serp_tzbot в тестовую группу и разрешите отправку сообщений.':result.error_code===400?'Telegram отклонил запрос. Проверьте доступ бота к теме № 2; сообщение для обновления могло быть удалено.':'Telegram временно недоступен. Проверьте результат в теме.';
 throw new PublicError(detail,502);
 }
 const id=operation.id||result.result?.message_id;
 if(!Number.isSafeInteger(id))throw new PublicError('Telegram не подтвердил номер сообщения. Автоматический повтор остановлен.',503);
 await db('rpc/tg_test_finish',{p_event:row.id,p_lease:lease,p_message:{id,text:operation.text,title:operation.title,cancelled:!!operation.cancelled}});
 return reply({done:false,updated:operation.title});
 }catch(e){return reply({error:e instanceof PublicError?e.message:'Не удалось выполнить запрос. Откройте предпросмотр заново и проверьте состояние публикации.'},e instanceof PublicError?e.status:503);}
});
