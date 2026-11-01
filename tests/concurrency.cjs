const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../app.js'),'utf8');
const part=(a,b)=>source.slice(source.indexOf(a),source.indexOf(b,source.indexOf(a)));
const tick=()=>new Promise(setImmediate);
function ctx(obj,code){vm.createContext(obj);vm.runInContext(code,obj);return obj}
function tasks(){
 let seq=0;const c=ctx({CATS:[{id:'sound'},{id:'stage'}],clone:structuredClone,uid:()=>`new-${++seq}`},part('function renewChangedTasks(','function saveEditing('));
 const base={blocks:{h:{sound:{items:[{id:'one',name:'Mic',qty:'2',note:''},{id:'two',name:'Desk',qty:'1'}]},stage:{items:[],spec:{id:'spec',w:'8',d:'6'}}}}};
 const edited=structuredClone(base);edited.blocks.h.sound.items.reverse();
 c.renewChangedTasks(edited,base);assert.equal(seq,0,'Reordering must retain check IDs');
 edited.blocks.h.sound.items[1].qty='6';edited.blocks.h.stage.spec.w='10';
 c.renewChangedTasks(edited,base);assert.notEqual(edited.blocks.h.sound.items[1].id,'one');assert.notEqual(edited.blocks.h.stage.spec.id,'spec');assert.equal(edited.blocks.h.sound.items[0].id,'two');
 c.renewChangedTasks(edited,base);assert.equal(seq,2,'Retry must not rotate IDs again');
}
async function tech(){
 const pending={},state={halls:[],events:[]};let route='A';
 const c=ctx({state,isAdmin:false,versions:{},loaded:false,loadError:'',techRequest:0,route:()=>route,render(){},ls:{get:()=>null},markSeen(){},toast(){},flagTitle(){},sb:{from:()=>({select(){return this},eq(){return this},maybeSingle:()=>Promise.resolve({data:{data:{halls:[]}}})}),rpc:(_,p)=>new Promise(r=>pending[p.p_id]=r)}},part('function loadTech(','/* ---------- shared'));
 const a=c.loadTech('A');route='B';const b=c.loadTech('B');pending.B({data:[{id:'B',data:{title:'B'},version:2}]});await b;pending.A({data:[{id:'A',data:{title:'A'},version:1}]});await a;assert.equal(state.events[0].id,'B');
}
async function checks(){
 let calls=0,reject;let route='E';
 const c=ctx({checks:{},checksKey:'',checkRequest:0,checkPending:{},route:()=>route,myName:()=> 'Nikita',render(){},toast(){},loadChecks(){},sb:{rpc:()=>{calls++;return new Promise((_,r)=>reject=r)}}},part('function setCheck(','setInterval('));
 c.setCheck('E','item',true);c.setCheck('E','item',false);assert.equal(calls,1,'Duplicate write must be blocked');assert.equal(c.checks.item.by,'Nikita');
 reject(Error('offline'));await tick();assert.equal(c.checks.item,undefined);assert.equal(Object.keys(c.checkPending).length,0);
 c.setCheck('E','item',true);route='F';c.checks={foreign:{by:'Other'}};reject(Error('offline'));await tick();assert.deepEqual(Object.keys(c.checks),['foreign']);
}
async function settings(){
 let db={halls:[{id:'h',name:'Original'}],keep:'unchanged'};let stamp='old';
 const base=structuredClone(db),c={busy:false,isAdmin:true,settingsData:structuredClone(db),settingsStamp:stamp,modal:{settingsBase:structuredClone(base),settingsExists:true},state:{halls:[]},clone:structuredClone,showSaving(){},toast(){},render(){},fail(){return false},loadAll(){return Promise.resolve()}};
 c.sb={from:()=>({filters:{},update(p){this.p=p;return this},eq(k,v){this.filters[k]=v;return this},select(){const match=JSON.stringify(db)===this.filters.data;if(match){db=this.p.data;stamp='new'}return Promise.resolve({data:match?[{id:1,updated_at:stamp}]:[]})}})};
 ctx(c,part('function saveHalls(','/* ---------- UI bits'));
 db.halls[0].name='Colleague';assert.equal(await c.saveHalls([{id:'h',name:'Mine'}]),false);assert.equal(db.halls[0].name,'Colleague');
 c.modal.settingsBase=structuredClone(db);assert.equal(await c.saveHalls([{id:'h',name:'Accepted'}]),true);assert.equal(db.halls[0].name,'Accepted');assert.equal(db.keep,'unchanged');
}
function retainedFiles(){
 let removes=0;const c=ctx({BUCKET:'plots',state:{events:[]},pathInUse:()=>false,sb:{storage:{from:()=>({remove:()=>{removes++;return Promise.resolve({})}})}}},part('function removeFiles(','function uploading('));
 c.removeFiles(['saved/file.pdf'],'E');assert.equal(removes,0,'Committed files must not be physically deleted');c.removeFiles(['new/file.pdf'],'E',true);assert.equal(removes,1);
}
async function board(){
 let email='admin',pending=[];
 const c=ctx({allRequest:0,myEmail:()=>email,isAdmin:true,clone:structuredClone,settingsData:{},settingsStamp:null,state:{halls:[],events:[]},versions:{},loaded:false,loadError:'',render(){},sb:{from:table=>({select(){return this},eq(){return this},maybeSingle:()=>Promise.resolve({data:{updated_at:'stamp',data:{halls:[],extra:'keep'}}}),then:resolve=>new Promise(r=>pending.push(r)).then(resolve)})}},part('function loadAll(','function loadTech('));
 const first=c.loadAll();await tick();const second=c.loadAll();await tick();
 pending[1]({data:[{id:'latest',data:{},version:2}]});await second;pending[0]({data:[{id:'old',data:{},version:1}]});await first;
 assert.equal(c.state.events[0].id,'latest');assert.equal(c.settingsData.extra,'keep');
 const third=c.loadAll();await tick();email='different';pending[2]({data:[{id:'wrong-account',data:{},version:3}]});await third;assert.equal(c.state.events[0].id,'latest');
}
async function authRace(){
 let email='admin',resolveRole;const c=ctx({authRequest:0,myEmail:()=>email,session:{},isAdmin:false,sb:{rpc:()=>new Promise(r=>resolveRole=r)},authReady:false},part('function checkAdmin(','var requests='));
 const p=c.checkAdmin();email='other';resolveRole({data:true});await p;assert.equal(c.isAdmin,false);assert.equal(c.authReady,false);
}
(async()=>{tasks();await tech();await checks();await settings();retainedFiles();await board();await authRace();console.log('PASS: task revisions, stale event/board/auth responses, serialized checks, network rollback, settings CAS, retained shared files')})().catch(e=>{console.error(e);process.exitCode=1});
