// Optional browser integration test: requires Playwright + Chromium.
const {chromium}=require('playwright'),fs=require('node:fs'),assert=require('node:assert/strict'),path=require('node:path');
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
 const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('https://tz.test/**',r=>r.fulfill({contentType:'text/html',body:'<html><head></head><body><div id="app"></div></body></html>'}));
 await page.goto('https://tz.test/#ev-E');
 await page.evaluate(()=>{
 let authChanged;
 const checks=new Map();window.calls=[];window.failNext=false;
 const ev={id:'E',title:'Проверка этапов монтажа',date:'2026-11-17',status:'prep',halls:['h'],hallNames:{h:'Большой зал'},blocks:{h:{}}};
 for(const c of ['sound','light','video','stage'])ev.blocks.h[c]={items:[{id:c+'-one',name:c==='sound'?'Радиомикрофон':'Оборудование',qty:'4'}]};
 window.TZ_CONFIG={url:'test',key:'test'};
 window.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session:{user:{id:'technician',email:'tech@example.com',user_metadata:{technician_name:'Иванов Иван'}}}}}),onAuthStateChange(fn){authChanged=fn},async signOut(){authChanged('SIGNED_OUT',null);return {error:null}}},rpc:async(name,p)=>{
 window.calls.push({name,p});
 if(name==='is_admin')return {data:false};
 if(name==='get_event_v2'||name==='get_event')return {data:[{id:'E',data:ev,version:1}]};
 if(name==='get_checks')return {data:[...checks.values()]};
 if(name==='set_item_arrival'||name==='set_check'){
 if(window.failNext){window.failNext=false;return {error:{message:'Тестовая ошибка'}}}
 const id=(name==='set_item_arrival'?'arrival:':'')+p.p_item;if(p.p_done)checks.set(id,{item_id:id,by_name:p.p_by,at:new Date().toISOString()});else checks.delete(id);return {data:null};
 }
 return {data:false};},from(){return {select(){return this},eq(){return this},maybeSingle(){return this},then(resolve){resolve({data:{data:{halls:[{id:'h',name:'Большой зал'}]}}})}}},channel(){return {on(){return this},subscribe(){return this}}},removeChannel(){}})};
 });
 for(const f of ['app.css','light-sheet.css'])await page.addStyleTag({content:fs.readFileSync(path.join(__dirname,'../../',f),'utf8')});
 await page.addScriptTag({content:fs.readFileSync(path.join(__dirname,'../../app.js'),'utf8')});
 await page.locator('.item-phases').first().waitFor();
 const present=page.getByRole('checkbox',{name:'Радиомикрофон: В зале',exact:true});
 const mounted=page.getByRole('checkbox',{name:'Радиомикрофон: Смонтировано',exact:true});
 await present.check();await page.waitForFunction(()=>!document.querySelector('.item-phase input').disabled);
 assert.equal(await present.isChecked(),true);assert.equal(await mounted.isChecked(),false);
 assert.match(await present.locator('..').textContent(),/Иванов Иван/);
 await mounted.check();await page.waitForFunction(()=>document.querySelectorAll('.item-phase input:disabled').length===0);
 await present.uncheck();await page.waitForFunction(()=>document.querySelectorAll('.item-phase input:disabled').length===0);
 assert.equal(await mounted.isChecked(),true);
 await page.evaluate(()=>window.failNext=true);await present.click();await page.waitForFunction(()=>document.querySelectorAll('.item-phase input:disabled').length===0);assert.equal(await present.isChecked(),false);
 for(const width of [375,768,1440]){
 await page.setViewportSize({width,height:900});
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Horizontal overflow '+width);
 const boxes=await page.locator('.cat-sound .item-phase').evaluateAll(els=>els.map(e=>({x:e.getBoundingClientRect().x,y:e.getBoundingClientRect().y,h:e.getBoundingClientRect().height})));
 assert.ok(boxes.every(b=>b.h>=44));if(width===375)assert.ok(boxes[1].y>boxes[0].y);
 if(width===375)await page.screenshot({path:'/tmp/block-checks-mobile.png',fullPage:true});
 }
 await page.getByRole('button',{name:'Выйти',exact:true}).click();
 await page.locator('#tech-auth-form').waitFor({state:'visible'});
 assert.equal(new URL(page.url()).hash,'#ev-E');
 assert.equal(await page.locator('.event-sheet').count(),1);
 assert.equal(await page.getByRole('button',{name:'Выйти',exact:true}).count(),0);
 await page.locator('#tech-auth-form').getByRole('button',{name:'Закрыть',exact:true}).click();
 await page.getByRole('button',{name:'Войти как техник',exact:true}).waitFor();
 assert.deepEqual(errors,[]);console.log('PASS browser: independent phases, attribution, undo, server error rollback, responsive 375/768/1440, technician logout, no overflow or JS errors');await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
