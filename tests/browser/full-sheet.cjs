const {chromium,webkit}=require('playwright'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {boot}=require('../helpers/app-harness.cjs');
(async()=>{
 const ev={id:'E',title:'18.11.2026 - 19.11.2026 LOFT#8 ИМПУЛЬС Т1 Конференция',date:'2026-11-19',mountDate:'2026-11-18',mount:'00:01',start:'09:00',end:'23:00',rehearsal:'15:00',rehearsalDay:'2026-11-18',status:'prep',halls:['h','h2'],hallNames:{h:'Main Hall',h2:'Rosewood Дискуссионный зал №1'},hallRoles:{h:'Зал Пульс',h2:'Регистрация гостей и дополнительная конференция'},soundchecks:[{name:'Научно-Технический рэп',date:'2026-11-18',time:'19:00'},{name:'Градусы',date:'2026-11-19',time:'06:30'}],docs:{scheme:[{id:'f',name:'Общая_схема_размещения_оборудования.pdf',path:'f',size:33000000}]},blocks:{}};
 for(const h of ev.halls){ev.blocks[h]={};for(const c of ['sound','light','video','stage','extra'])ev.blocks[h][c]={items:[{id:h+c,name:'Оборудование — длинное название позиции',qty:'12',note:'Установка и подключение по схеме'}],staff:[{id:'staff'+h+c,name:'Кузнецов-Петров Александр',role:'Художник по свету',phone:'+7 999 123-45-67'}]};ev.blocks[h].stage.spec={id:h+'stage',w:'8',d:'6',h:'0.6',cover:'Чёрный ковролин'};}
 const x=await boot(false,false,false,[],{event:ev});const html=x.app.innerHTML;
 const css=fs.readFileSync(path.join(__dirname,'../../light-sheet.css'),'utf8');
 for(const engine of [chromium,webkit]){
 const browser=await engine.launch({headless:true});
 for(const width of [320,375,402,430]){
 const page=await browser.newPage({viewport:{width,height:874},isMobile:true,deviceScaleFactor:3,hasTouch:true});
 await page.setContent('<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>body{margin:0}</style><div id="app">'+html+'</div>');
 await page.addStyleTag({content:fs.readFileSync(path.join(__dirname,'../../app.css'),'utf8')});
 const style=await page.addStyleTag({content:css.split('/* 28.21:')[0]});
 const measure=()=>page.evaluate(()=>({width:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth,body:document.body.getBoundingClientRect().width,viewport:visualViewport.width,scale:visualViewport.scale,offenders:[...document.querySelectorAll('#app *')].filter(e=>{let r=e.getBoundingClientRect();return r.width>0&&r.right>document.documentElement.clientWidth+1}).map(e=>({tag:e.tagName,cls:e.className,right:Math.round(e.getBoundingClientRect().right)})).slice(0,15)}));
 const before=await measure();console.log(engine.name(),width,'BEFORE',JSON.stringify(before));
 await style.evaluate((s,text)=>s.textContent=text,css);
 for(const theme of ['light','dark']){
 await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);
 const after=await measure();assert.ok(after.scroll<=width+1&&after.body>=width-1&&Math.abs(after.scale-1)<0.02,engine.name()+' '+width+' '+theme+' AFTER '+JSON.stringify(after));
 }
 await page.close();
 }
 await browser.close();
 }
 console.log('PASS filled full sheet: mobile viewport scale 1, full body width, no document overflow in Chromium/WebKit');
})().catch(e=>{console.error(e);process.exit(1)});
