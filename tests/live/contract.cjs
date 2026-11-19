// Read-only production contract gate; uses the same public credentials as the site.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const c={window:{}};vm.runInNewContext(fs.readFileSync('config.js','utf8'),c);
const cfg=c.window.TZ_CONFIG;
(async()=>{
 for(const rpc of ['get_event_v2','get_event','get_checks']){
 const started=performance.now();
 const r=await fetch(cfg.url+'/rest/v1/rpc/'+rpc,{method:'POST',headers:{apikey:cfg.key,'Content-Type':'application/json'},body:JSON.stringify({p_id:'contract-probe-no-event-'+require('node:crypto').randomUUID()}),signal:AbortSignal.timeout(15000)});
 assert.equal(r.status,200,rpc+' missing or inaccessible: '+await r.clone().text());
 assert.deepEqual(await r.json(),[],rpc+' must return an empty array for unknown event');
 console.log(rpc+': PASS '+Math.round(performance.now()-started)+'ms');
 }
})().catch(e=>{console.error(e.message);process.exitCode=1});
