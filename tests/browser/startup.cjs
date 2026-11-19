const {chromium,webkit}=require('playwright'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.join(__dirname,'../..');
(async()=>{
 for(const engine of [chromium,webkit]){
 const browser=await engine.launch();
 for(const mode of ['data','script']){
 const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true});
 let stuck=true;const held=[];
 await page.clock.install();
 await page.route('**/*',async route=>{
 const u=new URL(route.request().url());
 if(u.hostname==='tz.test'){
 const file=u.pathname==='/'?'index.html':u.pathname.slice(1);
 if(mode==='script'&&file.startsWith('vendor/')){held.push(route);return}
 const contentType=file.endsWith('.css')?'text/css':file.endsWith('.js')?'application/javascript':'text/html';
 return route.fulfill({contentType,body:fs.readFileSync(path.join(root,file))});
 }
 if(stuck&&u.pathname.includes('get_event')){held.push(route);return}
 const body=u.pathname.includes('get_event')?[{id:'E',data:{title:'Recovered event',halls:[],blocks:{}},version:1}]:u.pathname.includes('/settings')?{data:{halls:[]}}:[];
 return route.fulfill({contentType:'application/json',body:JSON.stringify(body)});
 });
 await page.goto('https://tz.test/#ev-E',{waitUntil:'commit'});
 if(mode==='data'){
 await page.waitForFunction(()=>window.TZ_APP_STARTED);
 await page.clock.runFor(16000);
 await page.getByRole('button',{name:'Повторить',exact:true}).waitFor();
 stuck=false;await page.getByRole('button',{name:'Повторить',exact:true}).click();
 await page.getByRole('heading',{name:'Recovered event'}).waitFor();
 }else{
 await page.waitForFunction(()=>document.getElementById('app'));
 await page.clock.runFor(16000);
 await page.getByRole('button',{name:'Повторить загрузку',exact:true}).waitFor();
 assert.match(await page.locator('#app').textContent(),/Не удалось запустить/);
 }
 await page.close();
 }
 await browser.close();
 }
 console.log('PASS startup: stalled data retry and unavailable script fallback in Chromium/WebKit');
})().catch(e=>{console.error(e);process.exit(1)});
