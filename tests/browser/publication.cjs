const {chromium,webkit}=require('playwright'),fs=require('node:fs'),assert=require('node:assert/strict');
const {boot,tick}=require('../helpers/app-harness.cjs');
(async()=>{
 const x=await boot(true,false,false,[],{getSession:async()=>({data:{session:{access_token:'test',user:{id:'user',email:'admin@example.com'}}}})});
 x.c.AbortSignal=AbortSignal;
 let steps=0;
 x.c.fetch=async(url,init)=>{const body=JSON.parse(init.body);if(body.action==='preview')return Response.json({version:1,published:false,changes:[{key:'head:0',kind:'send',title:'Main Hall — длинное название мероприятия',text:'ТЗ\n'+('Оборудование и примечание '.repeat(60))}]});steps++;return Response.json(steps===1?{done:false,updated:'Звук'}:{done:true})};
 x.c.location.hash='#ev-E';x.hash();await tick();
 const sheet=x.app.innerHTML;
 x.click('tg-preview',{id:'E'});await tick();await tick();assert.match(x.app.innerHTML,/Отправить в тестовую тему/);
 const preview=x.app.innerHTML;
 x.click('tg-send');await tick();await tick();await tick();assert.equal(steps,2);assert.match(x.app.innerHTML,/Все разделы актуальны/);
 for(const engine of [chromium,webkit]){const browser=await engine.launch({headless:true});for(const width of [320,390,430,1440]){
 const page=await browser.newPage({viewport:{width,height:850},isMobile:width<500});
 for(const html of [sheet,preview]){await page.setContent('<meta name="viewport" content="width=device-width,initial-scale=1">'+html);for(const css of ['app.css','light-sheet.css'])await page.addStyleTag({content:fs.readFileSync(css,'utf8')});
 if(html===preview)await page.locator('.dlg details').evaluate(e=>e.open=true);
 for(const theme of ['dark','light']){await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);
 const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);assert.equal(overflow,false,engine.name()+' '+width+' '+theme);
 const controls=await page.locator(html===preview?'.dlg button':'.event-sheet .bar button').all();for(const b of controls){const r=await b.boundingBox();if(r)assert.ok(r.x>=-1&&r.x+r.width<=width+1,'button overflow '+JSON.stringify(r));}}
 }await page.close();}await browser.close();}
 console.log('PASS publication: admin preview/send flow and Chromium/WebKit 320–1440px');
})().catch(e=>{console.error(e);process.exit(1)});
