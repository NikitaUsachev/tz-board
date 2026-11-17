const {chromium,webkit}=require('playwright'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {boot}=require('../helpers/app-harness.cjs');
(async()=>{
 const x=await boot(false),t=x.c.__test;
 const files=[{id:'a',name:'Т1_LoftHall_19.11.26_Общая_схема_размещения_оборудования.pdf',path:'a',size:33*1024*1024},{id:'b',name:'Интернет_Электричество_'+'оченьдлинноеимя'.repeat(10)+'.pdf',path:'b',size:2.8*1024*1024}];
 const read=t.filesRead(files,'Схема электропитания').replaceAll('<span class="plot-size">','<span class="chg chg-new">Новое</span><span class="plot-size">');
 const edit=t.filesEdit(files,'Общая схема','d|plan','.pdf','+ Загрузить','');
 for(const engine of [chromium,webkit]){
 const browser=await engine.launch({headless:true});
 for(const width of [320,375,402,430,560,768,1440]){
 const page=await browser.newPage({viewport:{width,height:900}});
 await page.setContent('<meta name="viewport" content="width=device-width,initial-scale=1"><div class="sheet gut event-sheet"><header class="head"><div class="docs">'+read+read+edit+'</div></header></div>');
 for(const f of ['app.css','light-sheet.css'])await page.addStyleTag({content:fs.readFileSync(path.join(__dirname,'../../',f),'utf8')});
 for(const theme of ['light','dark']){
 await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);
 const errors=await page.evaluate(()=>{
 const errors=[];
 for(const card of document.querySelectorAll('.plots')){
 const b=card.getBoundingClientRect();
 if(b.right>innerWidth+1||b.left<0)errors.push('card outside viewport');
 for(const el of card.querySelectorAll('.plot-name,.plot-ext,.plot-size,.chg,.plot-act .btn,.rm')){
 const r=el.getBoundingClientRect();if(r.left<b.left-1||r.right>b.right+1)errors.push(el.className+' outside card');
 if(el.classList.contains('plot-size')&&el.scrollWidth>el.clientWidth+1)errors.push('size clipped');
 if(el.matches('.plot-act .btn')&&r.height<44)errors.push('small touch target');
 }
 }
 if(document.documentElement.scrollWidth>innerWidth+1)errors.push('page overflow');return errors;
 });assert.deepEqual(errors,[],engine.name()+' '+width+' '+theme);
 }
 assert.equal(await page.getByRole('link',{name:'Скачать',exact:true}).count(),4);
 await page.close();
 }
 await browser.close();
 }
 console.log('PASS file cards: long names, New badges, sizes, actions, read/edit, light/dark, Chromium/WebKit 320–1440px');
})().catch(e=>{console.error(e);process.exit(1)});
