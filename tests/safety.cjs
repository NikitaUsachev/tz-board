const assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../app.js'),'utf8');
const part=(a,b)=>{const start=source.indexOf(a),end=source.indexOf(b,start);assert.ok(start>=0&&end>start,`${a} / ${b}`);return source.slice(start,end)};
const clone=x=>JSON.parse(JSON.stringify(x));
class DB{
 constructor(rows){this.rows=clone(rows);this.writes=[];this.reads=[];this.beforeWrite=null}
 from(){const db=this;return new class{
  constructor(){this.op='read';this.filters=[];this.payload=null;this.single=false}
  select(){return this}eq(k,v){this.filters.push([k,v,false]);return this}neq(k,v){this.filters.push([k,v,true]);return this}
  update(p){this.op='update';this.payload=clone(p);return this}insert(p){this.op='insert';this.payload=clone(p);return this}
  maybeSingle(){this.single=true;return this}
  then(resolve,reject){return Promise.resolve().then(()=>{
   if(this.op!=='read'&&db.beforeWrite){const fn=db.beforeWrite;db.beforeWrite=null;fn(db)}
   const matches=r=>this.filters.every(([k,v,not])=>{const value=k==='data->>date'?r.data.date:r[k];return not?value!==v:value===v});
   let rows=db.rows.filter(matches);
   if(this.op==='update'){db.writes.push({filters:clone(this.filters),payload:this.payload});rows.forEach(r=>{r.data=clone(this.payload.data);r.version++})}
   if(this.op==='insert'){if(db.rows.some(r=>r.id===this.payload.id))return {error:{message:'duplicate'},data:null};const row={...this.payload,version:1};db.rows.push(row);rows=[row];db.writes.push({insert:true,payload:this.payload})}
   if(this.op==='read')db.reads.push(clone(this.filters));
   return {data:this.single?(rows[0]?clone(rows[0]):null):clone(rows)};
  }).then(resolve,reject)}
 }}
}
function env(rows){
 const db=new DB(rows),store=new Map(),messages=[];const current=rows[0];
 const c={console,Date,JSON,Object,Array,Promise,Error,String,crypto:require('node:crypto').webcrypto,isAdmin:true,busy:false,editingVersion:current?.version,editingBase:clone(current?.data||{}),editing:clone(current?.data||{}),editingOrig:[],dirty:true,exitArmed:false,conflict:null,modal:null,state:{events:clone(rows.map(r=>({...r.data,id:r.id})))},versions:Object.fromEntries(rows.map(r=>[r.id,r.version])),CATS:[{id:'sound',name:'Звук'}],hallById:()=>null,
  clone,cleanEvent:clone,allPaths:()=>[],myEmail:()=> 'admin@example.com',showSaving(){},render(){},toast:m=>messages.push(m),route:()=>current?.id,location:{hash:'',pathname:'/',search:''},history:{replaceState(){}},go(){},ensureBlocks(){},renewChangedTasks(){},uid:()=>require('node:crypto').randomUUID(),sb:{from:()=>db.from()},
  localStorage:{getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v)},
  ls:{get:k=>store.has(k)?JSON.parse(store.get(k)):null,set:(k,v)=>store.set(k,JSON.stringify(v))},
  loadAll:async()=>{c.state.events=clone(db.rows.map(r=>({...r.data,id:r.id})));c.versions=Object.fromEntries(db.rows.map(r=>[r.id,r.version]))},
  fail:e=>{c.busy=false;messages.push(e.message);return false}
 };
 c.evById=id=>c.state.events.find(e=>e.id===id);
 vm.createContext(c);vm.runInContext(part('/* ---------- safe editing, merge and recovery ---------- */','/* ---------- UI bits'),c);
 return {c,db,store,messages};
}
const event=(id='E',extra={})=>({id,title:'Original',date:'2026-12-01',halls:[],blocks:{},...extra});
const row=(e,version=1)=>({id:e.id,data:e,version});
async function merge(){
 const {c,db}=env([row(event())]);c.editing.title='My title';db.rows[0].data.notes='Colleague notes';db.rows[0].version=2;
 assert.equal(await c.saveEvent(clone(c.editing),false,false),true);assert.equal(db.rows[0].data.title,'My title');assert.equal(db.rows[0].data.notes,'Colleague notes');
 assert.ok(db.writes.every(w=>w.filters.some(f=>f[0]==='version')));assert.equal(c.editing,null);
}
async function choices(){
 const {c,db}=env([row(event())]);c.editing.title='Mine';db.rows[0].data.title='Theirs';db.rows[0].version=2;
 assert.equal(await c.saveEvent(clone(c.editing),false,true),false);assert.equal(db.rows[0].data.title,'Theirs');assert.equal(c.conflict.issues.length,1);
 c.conflict.choices[0]='mine';c.applyConflictChoices();await new Promise(setImmediate);assert.equal(db.rows[0].data.title,'Mine');
}
async function deletedWhileEditing(){
 const {c,db}=env([row(event())]);db.rows[0].version=2;db.rows[0].data.deletedAt='2026-11-01';c.editing.title='Keep my work';
 assert.equal(await c.saveEvent(clone(c.editing),false,false),false);assert.equal(c.conflict.deleted,true);assert.equal(db.rows[0].data.title,'Original');assert.ok(c.drafts().E);
}
async function trash(){
 const {c,db}=env([row(event())]);assert.equal(await c.deleteEvent('E'),true);assert.equal(db.rows.length,1);assert.ok(db.rows[0].data.deletedAt);assert.equal(db.rows[0].data.title,'Original');
 assert.equal(await c.setDeleted('E',false),true);assert.equal(db.rows[0].data.deletedAt,undefined);assert.equal(db.rows[0].version,3);
 const stale=env([row(event())]);stale.db.beforeWrite=db=>{db.rows[0].data.title='Fresh work';db.rows[0].version++};assert.equal(await stale.c.deleteEvent('E'),false);assert.equal(stale.db.rows[0].data.deletedAt,undefined);assert.equal(stale.db.rows[0].data.title,'Fresh work');
}
async function bookings(){
 const {c,db}=env([row(event('E',{halls:['h']})),row(event('F',{halls:['h']}))]);
 assert.equal(await c.saveEvent(clone(c.editing),false,false),false);assert.equal(c.modal.t,'booking');assert.equal(db.writes.length,0);
 c.editing.date='2026-12-02';assert.equal(await c.saveEvent(clone(c.editing),false,false),true);
 const deleted=env([row(event('E',{halls:['h']})),row(event('F',{halls:['h'],deletedAt:'2026-11-01'}))]);assert.equal(await deleted.c.verifyBooking(deleted.c.editing),true);
 const restore=env([row(event('E',{halls:['h'],deletedAt:'2026-11-01'})),row(event('F',{halls:['h']}))]);assert.equal(await restore.c.setDeleted('E',false),false);assert.ok(restore.db.rows[0].data.deletedAt);
}
function drafts(){
 const {c}=env([row(event())]);c.editing.title='Unsaved';assert.equal(c.persistDraft(),true);assert.equal(c.drafts().E.event.title,'Unsaved');c.editing=null;c.recoverDraft('E');assert.equal(c.editing.title,'Unsaved');assert.equal(c.editingVersion,1);assert.equal(c.dirty,true);c.dropDraft('E');assert.equal(Object.keys(c.drafts()).length,0);
}
function mergeLists(){
 const {c}=env([row(event())]);let issues=[];const merged=c.mergeChanges({sound:['old'],light:['old']},{sound:['mine'],light:['old']},{sound:['old'],light:['theirs']},[],issues);assert.equal(issues.length,0);assert.deepEqual(JSON.parse(JSON.stringify(merged)),{sound:['mine'],light:['theirs']});
 assert.equal(c.sameValue([{id:'x',name:'Mic',qty:'2'}],[{qty:'2',name:'Mic',id:'x'}]),true,'JSONB property order must not create a false conflict');
 issues=[];c.mergeChanges(['base'],['mine'],['theirs'],['items'],issues);assert.equal(issues.length,1);
}
(async()=>{new vm.Script(source);await merge();await choices();await deletedWhileEditing();await trash();await bookings();drafts();mergeLists();console.log('PASS: independent merge, explicit field choices, no forced overwrite, concurrent delete, trash/restore, room/date checks, local draft recovery')})().catch(e=>{console.error(e);process.exitCode=1});
