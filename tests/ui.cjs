// Runs the complete script with a minimal DOM and API model; no live requests.
const assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../app.js'),'utf8');
const tick=()=>new Promise(setImmediate);
async function boot(admin,deleted=false,telegram=false,done=[]){
 const listeners={},winListeners={},store=new Map();let html='';
 const app={classList:{toggle(){}},addEventListener:(n,f)=>(listeners[n]??=[]).push(f),get innerHTML(){return html},set innerHTML(v){html=v}};
 const ev={id:'E',title:'Known event',date:'2026-12-01',halls:['h'],status:'prep',blocks:{h:{sound:{items:[{id:'item',name:'Microphone',qty:'2'}],note:''}}}};if(deleted)ev.deletedAt='2026-11-01';
 const rows=[{id:'E',data:ev,version:1,updated_at:'2026-11-01T00:00:00Z'}];
 const sb={auth:{getSession:async()=>({data:{session:admin?{user:{id:'user',email:'admin@example.com'}}:null}}),updateUser:async({data})=>({data:{user:{id:"user",email:"admin@example.com",user_metadata:data}}}),onAuthStateChange(){}},rpc:async(name)=>({data:name==='is_admin'?true:name==='get_event_v2'?rows:name==='get_checks'?done:name==='tg_event_info'?{username:'example_tz_bot',ready:{}}:[]}),from(table){return new class{
  constructor(){this.filters=[];this.op='read';this.single=false}
  select(){return this}eq(k,v){this.filters.push([k,v]);return this}neq(){return this}order(){return this}maybeSingle(){this.single=true;return this}insert(p){this.op='insert';this.p=p;return this}
  then(a,b){return Promise.resolve().then(()=>{let data=table==='events'?rows:table==='settings'?[{id:1,data:{halls:[{id:'h',name:'Main'}]},updated_at:'stamp'}]:[{email:'admin@example.com'}];if(this.op==='insert'){const r={...this.p,version:1,updated_at:'2026-11-01T00:00:00Z'};rows.push(r);data=[r]}else data=data.filter(r=>this.filters.every(([k,v])=>r[k]===v));return {data:this.single?(data[0]||null):JSON.parse(JSON.stringify(data))}}).then(a,b)}
 }},channel(){return {on(){return this},subscribe(){return this}}},removeChannel(){},storage:{from:()=>({getPublicUrl:()=>({data:{publicUrl:'https://example.test/file'}})})}};
 const location={hash:admin?'':'#ev-E',pathname:'/',search:'',origin:'https://example.test'};
 let hashValue=location.hash;Object.defineProperty(location,'hash',{get:()=>hashValue,set:v=>{hashValue=v?(String(v).startsWith('#')?String(v):'#'+v):''}});
 const nodes={app,toast:{},saving:{}};
 const document={title:'ТЗ',activeElement:null,hidden:false,cookie:'',documentElement:{getAttribute:()=>null,setAttribute(){}},getElementById:id=>nodes[id]||null,querySelector:()=>null,querySelectorAll:()=>[],addEventListener(){}};
 const c={console,JSON,Date,Promise,crypto:require('node:crypto').webcrypto,document,location,history:{replaceState(a,b,url){location.hash=url.includes('#')?'#'+url.split('#')[1]:''},pushState(a,b,url){location.hash=url.includes('#')?'#'+url.split('#')[1]:''}},localStorage:{getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v)},sessionStorage:{getItem:()=>null,setItem(){}},navigator:{},setTimeout:()=>1,clearTimeout(){},setInterval:()=>1,supabase:{createClient:()=>sb},TZ_CONFIG:{url:'https://example.test',key:'public',telegram},innerWidth:1200,scrollY:0,scrollTo(){},addEventListener:(n,f)=>(winListeners[n]??=[]).push(f)};c.window=c;
 vm.createContext(c);vm.runInContext(source,c);await tick();await tick();
 const click=(act,dataset={})=>{for(const f of listeners.click||[])f({target:{closest:()=>({getAttribute:()=>act,dataset,tagName:'BUTTON'})},preventDefault(){}})};
 const hash=()=>{for(const f of winListeners.hashchange||[])f()};
 return {c,app,click,hash,store,listeners,rows};
}
(async()=>{
 const sc=await boot(true);sc.click('new',{st:'draft'});sc.hash();
 assert.match(sc.app.innerHTML,/sc-1-name/);
 for(const [k,value] of [['name','Band <One>'],['date','2026-12-01'],['time','14:30']])for(const f of sc.listeners.input)f({target:{dataset:{f:'soundcheck',i:'0',k},value}});
 sc.click('soundcheck-add');assert.match(sc.app.innerHTML,/sc-2-name/);
 sc.click('soundcheck-remove',{i:'1'});assert.ok(!sc.app.innerHTML.includes('sc-2-name'));
 sc.click('save');await tick();await tick();
 const savedSC=sc.rows.find(r=>r.id!=='E');assert.equal(savedSC.data.soundchecks[0].name,'Band <One>');assert.equal(savedSC.data.soundchecks[0].time,'14:30');
 assert.match(sc.app.innerHTML,/Band &lt;One&gt;/);assert.match(sc.app.innerHTML,/14:30/);assert.ok(!sc.app.innerHTML.includes('Группа не указана'));

 const a=await boot(true);assert.match(a.app.innerHTML,/Версия \d+\.\d+/);assert.match(a.app.innerHTML,/Корзина/);
 assert.match(a.app.innerHTML,/version-link has-update/);a.click('releases');assert.ok(!a.app.innerHTML.includes('version-link has-update'));a.click('close');a.click('new',{st:'draft'});a.hash();
 for(const f of a.listeners.input)f({target:{dataset:{f:'title'},value:'My draft'}});
 a.c.location.hash='';a.hash();assert.match(a.app.innerHTML,/Есть несохранённые правки/);
 a.click('leave-draft');a.hash();assert.match(a.app.innerHTML,/Несохранённые изменения \(1\)/);
 const saved=JSON.parse(a.store.get('tz-drafts-admin@example.com'));const id=Object.keys(saved)[0];assert.equal(saved[id].event.title,'My draft');
 a.click('recover-draft',{id});assert.match(a.app.innerHTML,/My draft/);a.click('save');await tick();await tick();assert.ok(a.rows.some(r=>r.data.title==='My draft'));

 const review=await boot(true);
 review.click('new',{st:'prep'});review.hash();
 review.click('save');await tick();
 assert.match(review.app.innerHTML,/Проверьте ТЗ перед сохранением/);
 assert.match(review.app.innerHTML,/Выберите хотя бы один зал/);
 assert.ok(!review.app.innerHTML.includes('data-act="review-save"'));
 assert.equal(review.rows.length,1);
 review.click('review-field',{index:'0'});
 assert.match(review.app.innerHTML,/id="f-title"/);
 for(const [field,value] of [['title','Complete event'],['date','2026-12-03']])
  for(const listen of review.listeners.input)listen({target:{dataset:{f:field},value}});
 for(const listen of review.listeners.change)listen({target:{dataset:{hallpick:'h'},checked:true}});
 review.click('save');await tick();
 assert.match(review.app.innerHTML,/Не указано время начала/);
 assert.match(review.app.innerHTML,/Не указан инженер проекта/);
 assert.match(review.app.innerHTML,/data-act="review-save"/);
 assert.equal(review.rows.length,1);
 review.click('review-save');await tick();await tick();
 assert.equal(review.rows.length,2);
 assert.equal(review.rows[1].data.title,'Complete event');
 const profile=await boot(true);profile.click("account");assert.match(profile.app.innerHTML,/profile-form/);
 for(const [id,value] of [["profile-last","Усачёв"],["profile-first","Никита"]])for(const listen of profile.listeners.input)listen({target:{id,value,dataset:{}}});
 for(const listen of profile.listeners.submit)listen({preventDefault(){},target:{id:"profile-form"}});
 await tick();profile.click("close");assert.match(profile.app.innerHTML,/Усачёв Никита/);
 profile.click("account");assert.match(profile.app.innerHTML,/value="Усачёв"/);
 const adminSheet=await boot(true);adminSheet.c.location.hash='ev-E';adminSheet.hash();assert.match(adminSheet.app.innerHTML,/Known event/);assert.match(adminSheet.app.innerHTML,/sheet gut event-sheet/);assert.match(adminSheet.app.innerHTML,/Редактировать/);for(const action of ['drafts','trash','releases'])assert.ok(adminSheet.app.innerHTML.includes('data-act="'+action+'"'));
 const t=await boot(false);assert.ok(!t.app.innerHTML.includes('Несохранённые изменения'));assert.ok(!t.app.innerHTML.includes('Корзина'));assert.ok(!t.app.innerHTML.includes('Зарегистрироваться'));assert.match(t.app.innerHTML,/Known event/);assert.match(t.app.innerHTML,/sheet gut event-sheet/);
 for(const f of t.listeners.change)f({target:{dataset:{done:'E|item'},checked:true}});assert.match(t.app.innerHTML,/Как вас зовут/);
 assert.doesNotMatch(t.app.innerHTML,/Получать изменения в Telegram/);
 const tg=await boot(false,false,true);assert.match(tg.app.innerHTML,/example_tz_bot\?start=E/);assert.doesNotMatch(tg.app.innerHTML,/Зал готов/);assert.match(tg.app.innerHTML,/Осталось отметить: Звук — 1/);
 const completed=await boot(false,false,true,[{item_id:'item',by_name:'Имя'}]);assert.match(completed.app.innerHTML,/Зал готов/);
 const gone=await boot(false,true);assert.ok(!gone.app.innerHTML.includes('Known event'));assert.match(gone.app.innerHTML,/ТЗ не найдено/);
 console.log('PASS: full script boot, admin board, navigation guard, draft recovery and save, technician-only page, first-check name prompt, hidden trash events');
})().catch(e=>{console.error(e);process.exitCode=1});

