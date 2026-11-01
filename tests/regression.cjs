
const assert=require("node:assert/strict");
const fs=require("node:fs"),vm=require("node:vm");
const source=fs.readFileSync(require("node:path").join(__dirname,"../app.js"),"utf8");
new vm.Script(source);
function part(a,b){return source.slice(source.indexOf(a),source.indexOf(b,source.indexOf(a)))}
async function status(result, rejection){
 const filters=[],updates=[],messages=[];let reloads=0;
 const current={id:"ev",title:"Original",status:"draft"};
 const query={update(p){updates.push(p);return this},eq(k,v){filters.push([k,v]);return this},select(){return rejection?Promise.reject(Error("network")):Promise.resolve(result)}};
 const c={evById:()=>current,isAdmin:true,busy:false,versions:{ev:7},cleanEvent:x=>structuredClone(x),sb:{from:()=>query},toast:x=>messages.push(x),loadAll:()=>{reloads++}};
 vm.createContext(c);vm.runInContext(part("function setStatus(","function deleteEvent("),c);
 c.setStatus("ev","ready");await new Promise(setImmediate);
 assert.deepEqual(filters,[["id","ev"],["version",7]]);
 assert.equal(current.status,"draft");assert.equal(c.busy,false);assert.equal(reloads,1);
 if(!result?.data?.length||rejection)assert.ok(messages.length);
}
async function uploads(){
 let resolveUpload;const removed=[];
 const owner={id:"original"},arr=[];
 const c={editing:owner,listFor:()=>arr,MAX_FILE:100,uid:()=>"random",fileExt:()=>"pdf",dirty:false,render(){},toast(){},BUCKET:"plots",Date,
 removeFiles:(paths,id)=>removed.push({paths,id}),
 sb:{storage:{from:()=>({upload:()=>new Promise(r=>{resolveUpload=r})})}}};
 vm.createContext(c);vm.runInContext(part("function uploadFiles(","function filesRead("),c);
 c.uploadFiles("d|tech",[{name:"plan.pdf",size:1}]);
 const other={id:"other"};c.editing=other;resolveUpload({});await new Promise(setImmediate);
 assert.equal(other._uploaded,undefined);assert.equal(removed.length,1);assert.equal(removed[0].id,"original");
}
function drag(){
 const listeners=[];const c={app:{addEventListener:(n,f)=>{if(n==="dragstart")listeners.push(f)}},document:{}};
 vm.createContext(c);vm.runInContext(part('/* drag to reorder items inside one block */','window.addEventListener("hashchange"'),c);
 listeners[0]({target:{closest:()=>({closest:()=>null})}});
 assert.equal(c.itemDrag,null);
}
(async()=>{await status({data:[{id:"ev"}]});await status({data:[]});await status({error:{message:"denied"}});await status(null,true);await uploads();drag();console.log("PASS: status success/conflict/error/network, upload ownership, hall drag guard, JS syntax")})().catch(e=>{console.error(e);process.exitCode=1});

