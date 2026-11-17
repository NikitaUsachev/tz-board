const {test}=require('node:test'),assert=require('node:assert/strict');
const {boot,tick}=require('./helpers/app-harness.cjs');
test('Four equipment categories have two independent block confirmations; extra has none',async()=>{
 const {c}=await boot(false),t=c.__test;
 for(const id of ['sound','light','video','stage']){
 const html=t.blockChecksRead({id:'E'},'h',{id,name:id},{items:[{name:'Equipment'}]},{});
 assert.equal((html.match(/type="checkbox"/g)||[]).length,2);assert.match(html,/Всё оборудование в зале/);assert.match(html,/Монтаж завершён/);
 }
 assert.equal(t.blockChecksRead({id:'E'},'h',{id:'extra'},{items:[{name:'Task'}]},{}),'');
 assert.equal(t.blockChecksRead({id:'E'},'h',{id:'sound'},{items:[]},{}),'');
});
test('Stage with dimensions only has confirmations and collapsed block keeps them visible',async()=>{
 const {c}=await boot(false),t=c.__test;
 assert.match(t.blockChecksRead({id:'E'},'h',{id:'stage',name:'Сцена'},{items:[],spec:{id:'s',w:'8'}},{}),/Монтаж завершён/);
 const ev=t.getState().events[0];assert.match(t.catRead(ev,'h',{id:'sound',name:'Звук'}, {}, {'h|sound':true}),/block-checks/);
});
test('Saved confirmation shows full escaped name and does not mark the other phase',async()=>{
 const {c}=await boot(false),t=c.__test,key=t.blockCheckId('h','sound','present');
 const html=t.blockChecksRead({id:'E'},'h',{id:'sound',name:'Звук'},{items:[{name:'Mic'}]},{[key]:{by:'Иванов Иван <x>',at:'2026-11-17T09:00:00Z'}});
 assert.equal((html.match(/ checked/g)||[]).length,1);assert.match(html,/Иванов Иван &lt;x&gt;/);assert.match(html,/Не подтверждено/);
});
test('Block check saves through dedicated RPC without changing item checks',async()=>{
 const {c,rpcCalls}=await boot(false,false,false,[],{storage:{'tz-me':JSON.stringify('Иванов Иван')}}),t=c.__test;
 t.setCheck('E',t.blockCheckId('h','sound','present'),true);await tick();
 const call=rpcCalls.find(x=>x.name==='set_block_check');assert.deepEqual(JSON.parse(JSON.stringify(call.args)),{p_event:'E',p_hall:'h',p_category:'sound',p_phase:'present',p_done:true,p_by:'Иванов Иван'});
 t.setCheck('E','item',true);await tick();assert.ok(rpcCalls.some(x=>x.name==='set_check'));
});
