const {chromium,webkit}=require('playwright'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {boot}=require('../helpers/app-harness.cjs');
(async()=>{
 const long='Rosewood Дискуссионный зал №1 — дополнительная площадка для конференции';
 const tech=await boot(false,false,false,[],{event:{id:'E',title:'Мероприятие',date:'2026-11-17',halls:['h'],hallNames:{h:long},blocks:{h:{sound:{items:[{id:'i',name:'Mic'}]}}}}});
 const admin=await boot(true);
 const layouts=[['tech',tech.app.innerHTML],['admin',admin.app.innerHTML]];
 for(const engine of [chromium,webkit]){
 const browser=await engine.launch({headless:true});
 for(const width of [320,375,390,402,430,560,768,1440]){
 const page=await browser.newPage({viewport:{width,height:850}});
 for(const [role,html] of layouts){
 await page.setContent('<meta name="viewport" content="width=device-width,initial-scale=1">'+html);
 for(const f of ['app.css','light-sheet.css'])await page.addStyleTag({content:fs.readFileSync(path.join(__dirname,'../../',f),'utf8')});
 for(const theme of ['light','dark']){
 await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);
 const result=await page.evaluate(()=>{const root=document.querySelector('.top-in');const rb=root.getBoundingClientRect();return [...root.querySelectorAll('select,input,button')].map(e=>{const b=e.getBoundingClientRect();return {name:e.id||e.className,left:b.left,right:b.right,width:b.width,containerRight:rb.right}})});
 for(const r of result)assert.ok(r.left>=-1&&r.right<=width+1&&r.width>0,`${engine.name()} ${role} ${theme} ${width}: ${JSON.stringify(r)}`);
 if(role==='tech'){
 const bounds=await page.locator('.sheet-navigation').evaluate(e=>({scroll:e.scrollWidth,client:e.clientWidth}));assert.ok(bounds.scroll<=bounds.client+1,`${engine.name()} ${role} ${theme} ${width}: ${JSON.stringify(bounds)}`);
 await page.selectOption('#hall-navigation','h');
 }
 }
 }
 await page.close();
 }
 await browser.close();
 }
 console.log('PASS: Chromium/WebKit, tech/admin headers, long hall names, 320–1440px, light/dark');
})().catch(e=>{console.error(e);process.exit(1)});
