const {test}=require('node:test'),assert=require('node:assert/strict');
const {boot,tick}=require('./helpers/app-harness.cjs');
function clock(){let id=0;const jobs=new Map();return {setTimeout(fn,ms){jobs.set(++id,{fn,ms});return id},clearTimeout(n){jobs.delete(n)},expire(){for(const [n,j] of [...jobs])if(j.ms===15000){jobs.delete(n);j.fn()}}}}
test('Hanging session shows retry; retry restores event without reloading',async()=>{
 const timers=clock();let stuck=true;
 const b=await boot(false,false,false,[],{...timers,getSession:()=>stuck?new Promise(()=>{}):Promise.resolve({data:{session:null}})});
 timers.expire();await tick();assert.match(b.app.innerHTML,/Повторить загрузку/);
 stuck=false;b.click('retry-start');await tick();await tick();assert.match(b.app.innerHTML,/Known event/);assert.doesNotMatch(b.app.innerHTML,/Повторить загрузку/);
});
test('Rejected session is handled and never silently hangs',async()=>{
 const b=await boot(false,false,false,[],{getSession:()=>Promise.reject(Error('offline'))});
 assert.match(b.app.innerHTML,/Не удалось восстановить вход/);
});
test('Hanging role check fails closed and offers retry',async()=>{
 const timers=clock();const b=await boot(true,false,false,[],{...timers,rpc:()=>new Promise(()=>{})});
 timers.expire();await tick();assert.match(b.app.innerHTML,/Не удалось проверить права/);assert.doesNotMatch(b.app.innerHTML,/data-act="new"/);
});
test('Hanging event request times out and late response cannot populate page',async()=>{
 const timers=clock();let resolve;
 const b=await boot(false,false,false,[],{...timers,rpc:name=>name==='get_event_v2'?new Promise(r=>resolve=r):Promise.resolve({data:[]})});
 timers.expire();await tick();assert.match(b.app.innerHTML,/за 15 секунд/);
 resolve({data:[{id:'E',data:{title:'STALE',halls:[]},version:1}]});await tick();assert.doesNotMatch(b.app.innerHTML,/STALE/);
});
test('Role server error is not interpreted as technician access',async()=>{
 const b=await boot(true,false,false,[],{rpc:()=>Promise.resolve({error:{message:'unavailable'}})});
 assert.match(b.app.innerHTML,/Не удалось проверить права/);
});
