const {test}=require('node:test'),assert=require('node:assert/strict');
const {boot,tick}=require('./helpers/app-harness.cjs');
test('Each equipment position has two phases, no block confirmations',async()=>{
 const {c}=await boot(false),t=c.__test;
 for(const id of ['sound','light','video','stage']){
 const e={id:'E',blocks:{h:{[id]:{items:[{id:'a',name:'A'},{id:'b',name:'B'}]}}}};
 const html=t.catRead(e,'h',{id,name:id},{},{});
 assert.equal((html.match(/type="checkbox"/g)||[]).length,4);assert.doesNotMatch(html,/block-checks|Всё оборудование/);
 }
 const e={id:'E',blocks:{h:{extra:{items:[{id:'task',name:'Task'}]}}}};
 assert.equal((t.catRead(e,'h',{id:'extra',name:'Extra'},{},{}).match(/type="checkbox"/g)||[]).length,1);
});
test('Each stage property has separate phases, including additional stages',async()=>{
 const {c}=await boot(false),t=c.__test;
 const html=t.stagesRead({spec:{id:'s',w:'8',cover:'Carpet'},stages:[{id:'s2',w:'2'}]},'h|stage','E');
 assert.equal((html.match(/type="checkbox"/g)||[]).length,6);assert.match(html,/arrival:s2:size/);
});
test('Existing per-item check becomes installed, arrival stays independent',async()=>{
 const {c}=await boot(false),t=c.__test;
 const html=t.itemPhases('E','a','Mic',{a:{by:'Иванов Иван <x>',at:'2026-11-17T09:00:00Z'}});
 assert.equal((html.match(/ checked/g)||[]).length,1);assert.match(html,/Иванов Иван &lt;x&gt;/);assert.match(html,/Смонтировано/);
});
test('Arrival uses dedicated RPC; installation retains original item check',async()=>{
 const {c,rpcCalls}=await boot(false,false,false,[],{role:false,getSession:async()=>({data:{session:{user:{id:'tech',email:'tech@example.com',user_metadata:{technician_name:'Иванов Иван'}}}}})}),t=c.__test;
 t.setCheck('E','arrival:item',true);await tick();
 const call=rpcCalls.find(x=>x.name==='set_item_arrival');assert.equal(call.args.p_item,'item');assert.equal(call.args.p_by,'Иванов Иван');
 t.setCheck('E','item',true);await tick();assert.ok(rpcCalls.some(x=>x.name==='set_check'));
});
test('Hall ready requires both per-item phases and ignores obsolete block marks',async()=>{
 const done=[{item_id:'item',by_name:'Иванов Иван'},{item_id:'block:["h","sound","present"]',by_name:'Иванов Иван'}];
 const x=await boot(false,false,false,done);assert.equal(x.c.__test.hallProgress(x.c.__test.getState().events[0],'h').done,false);
 done.push({item_id:'arrival:item',by_name:'Иванов Иван'});await x.c.__test.loadChecks('E');assert.equal(x.c.__test.hallProgress(x.c.__test.getState().events[0],'h').done,true);
});
