// Pure formatter: stable keys isolate updates to the affected hall/department.
export const TARGET = {chat_id:'-1004466460945',message_thread_id:2,url:'https://t.me/c/4466460945/2'};
const cats=[['sound','Звук'],['light','Свет'],['video','Видео'],['stage','Сцена'],['extra','Дополнительно']];
const str=v=>String(v??'').trim();
const person=p=>p?[p.role,p.name,p.phone].map(str).filter(Boolean).join(' · '):'';
const field=(label,value)=>str(value)?label+': '+str(value):'';
function split(text,limit=3500){
 const result=[];
 while(text.length>limit){let n=text.lastIndexOf('\n',limit);if(n<limit/2)n=limit;if(/[\uD800-\uDBFF]/.test(text[n-1]))n--;result.push(text.slice(0,n));text=text.slice(n).replace(/^\n/,'');}
 if(text)result.push(text);return result;
}
export function documents(ev,root,hallNames={}){
 const result=[];
 function add(key,title,lines){const body=lines.filter(x=>str(x)).join('\n');if(!body)return;
 split(body).forEach((part,i)=>result.push({key:key+':'+i,title,text:title.slice(0,250)+(i?' · продолжение '+(i+1):'')+'\n\n'+part}));}
 const files=arr=>(arr||[]).filter(f=>f.path&&!f.uploading).map(f=>str(f.name||'Файл')+'\n'+root+'/storage/v1/object/public/plots/'+String(f.path).split('/').map(encodeURIComponent).join('/'));
 add('head','ТЗ · '+str(ev.title),[
 field('Дата',ev.date),field('Монтажный день',ev.mountDate),field('Монтаж с',ev.mount),
 field('Прогоны',[(ev.rehearsalDay==='mount'?ev.mountDate:ev.date),ev.rehearsal].filter(Boolean).join(' ')),
 field('Начало',ev.start),field('Завершение',ev.end),field('Менеджер',ev.manager),field('Администратор',ev.padmin),field('Инженер',ev.engineer),
 ...((ev.soundchecks||[]).map(x=>field('Саундчек',[x.name,x.date,x.time].filter(Boolean).join(' · ')))),field('Примечания',ev.notes),
 'Открыть ТЗ: https://nikitausachev.github.io/tz-board/#ev-'+encodeURIComponent(ev.id)]);
 for(const [id,name] of [['tech','Технический сценарий'],['director','Режиссёрский сценарий'],['scheme','Общая схема'],['power','Схема электропитания']])add('docs:'+id,name,files(ev.docs?.[id]));
 for(const h of ev.halls||[]){const hall=ev.hallNames?.[h]||hallNames[h]||h;const title=hall+(ev.hallRoles?.[h]?' · '+ev.hallRoles[h]:'');
 add('hall:'+h+':scheme',title+' · Схема зала',files(ev.hallFiles?.[h]));
 add('hall:'+h+':power',title+' · Электропитание',files(ev.hallPowerFiles?.[h]));
 for(const [id,name] of cats){const b=ev.blocks?.[h]?.[id]||{};const lines=[];
 if(person(b.chief))lines.push('Бригадир: '+person(b.chief));
 if(id==='stage')for(const sp of [b.spec,...(b.stages||[])].filter(Boolean)){
 const spec=[field('Название',sp.name),field('Расположение',sp.location),
 [sp.w,sp.d,sp.h].some(str)?'Размеры (Ш × Г × В): '+[sp.w,sp.d,sp.h].map(v=>str(v)||'—').join(' × ')+' м':'',
 field('Покрытие',[sp.cover,sp.coverNote].filter(Boolean).join(' · ')),field('Раус',[sp.raus==='yes'?'Есть':'',sp.rausNote].filter(Boolean).join(' · ')),field('Ступени спереди',sp.stepsFront),field('Ступени сбоку',sp.stepsSide)].filter(Boolean);if(spec.length)lines.push(spec.join('\n'));}
 for(const it of b.items||[])if(str(it.name))lines.push('• '+str(it.name)+(str(it.qty)?' — '+str(it.qty):'')+(str(it.note)?'\n  '+str(it.note):''));
 lines.push(...files(b.files));for(const link of b.links||[])if(/^https?:\/\//i.test(str(link.url)))lines.push([link.title,link.url].filter(Boolean).join(': '));
 for(const p of b.staff||[])if(person(p))lines.push('Персонал: '+person(p));lines.push(field('Примечание',b.note));
 add('hall:'+h+':'+id,title+' · '+name,lines);
 }}return result;
}
export function plan(desired,saved={}){
 const ops=[];const keys=new Set(desired.map(d=>d.key));
 for(const d of desired){const old=saved[d.key];if(old?.text!==d.text)ops.push({...d,kind:old?.id?'edit':'send',id:old?.id||null});}
 for(const [key,old] of Object.entries(saved))if(!keys.has(key)&&!old.cancelled)ops.push({key,title:old.title||'Раздел',text:(old.title||'Раздел')+'\n\nРаздел отменён. Актуальное ТЗ — в приложении.',id:old.id,kind:'edit',cancelled:true});
 return ops;
}
