(function(){
"use strict";
var CFG=window.TZ_CONFIG||{};
var STATUSES=[{id:"draft",name:"Черновик"},{id:"prep",name:"В подготовке"},{id:"ready",name:"Утверждено"},{id:"done",name:"Проведено"}];
var CATS=[{id:"sound",name:"Звук",en:"Audio"},{id:"light",name:"Свет",en:"Light"},{id:"video",name:"Видео",en:"Video"}];
var SUGGEST={
 sound:["Радиомикрофон ручной","Радиосистема головная","Радиосистема петличная","Микрофон на стойке","Пульт FOH","Мониторы сценические","In-ear мониторинг","Линейный массив","Сабвуфер","DI-бокс","Воспроизведение с ноутбука","Звукорежиссёр"],
 light:["Заливка сцены","Wash-прибор","Beam-прибор","Spot-прибор","Профильный прожектор","Следящий прожектор","Генератор хейза","Генератор дыма","Лазерная установка","Пульт света","Художник по свету"],
 video:["LED-экран","Проектор","Проекционный экран","Медиасервер","Видеомикшер","Камера на трансляцию","Суфлёр-монитор","ТВ-панель","Кликер для презентаций","Видеоинженер"]
};

var sb=window.supabase.createClient(CFG.url,CFG.key,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true,flowType:"implicit"}});
var state={halls:[],events:[]}, versions={}, loaded=false, loadError="";
var session=null, isAdmin=false, admins=[], authReady=false, techMsg="", auth={tab:"in",email:"",msg:"",err:"",busy:false}, rtChannel=null;
var editing=null, editingVersion=null, dirty=false, query="", pickerOpen=false, modal=null, exitArmed=false, delArmed=false, conflict=null, busy=false;
var app=document.getElementById("app");

/* ---------- helpers ---------- */
function esc(s){return String(s==null?"":s).replace(/[&<>"']/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]})}
function uid(){return Math.random().toString(36).slice(2,10)}
function clone(o){return JSON.parse(JSON.stringify(o))}
var ls={get:function(k){try{var v=localStorage.getItem(k);return v?JSON.parse(v):null}catch(e){return null}},set:function(k,v){try{localStorage.setItem(k,JSON.stringify(v))}catch(e){}}};
/* ---------- theme ---------- */
var mq=window.matchMedia?window.matchMedia("(prefers-color-scheme: dark)"):null;
function curTheme(){var t=document.documentElement.getAttribute("data-theme");if(t==="dark"||t==="light")return t;return mq&&mq.matches?"dark":"light"}
function applyTheme(t){document.documentElement.setAttribute("data-theme",t);var m=document.querySelector('meta[name="theme-color"]');if(m)m.setAttribute("content",t==="dark"?"#151C26":"#FFFFFF")}
(function(){var s=ls.get("tz-theme");if(s==="dark"||s==="light")applyTheme(s)})();
if(mq){var onMq=function(){if(!ls.get("tz-theme"))render()};if(mq.addEventListener)mq.addEventListener("change",onMq);else if(mq.addListener)mq.addListener(onMq)}
function themeBtn(){var d=curTheme()==="dark";return '<button class="btn ghost sm theme-btn" data-act="theme" aria-label="'+(d?"Включить светлую тему":"Включить тёмную тему")+'" title="'+(d?"Светлая тема":"Тёмная тема")+'"><span class="ic" aria-hidden="true">'+(d?"☀":"☾")+'</span><span class="lbl">'+(d?"Светлая":"Тёмная")+'</span></button>'}

function hallById(id){for(var i=0;i<state.halls.length;i++)if(state.halls[i].id===id)return state.halls[i];return null}
function evById(id){for(var i=0;i<state.events.length;i++)if(state.events[i].id===id)return state.events[i];return null}
function stName(id){for(var i=0;i<STATUSES.length;i++)if(STATUSES[i].id===id)return STATUSES[i].name;return id}
function evHalls(ev){return (ev.halls||[]).map(hallById).filter(Boolean)}
function emptyBlocks(){var b={};CATS.forEach(function(c){b[c.id]={items:[],note:""}});return b}
function ensureBlocks(ev){ev.blocks=ev.blocks||{};(ev.halls||[]).forEach(function(h){if(!ev.blocks[h])ev.blocks[h]=emptyBlocks();CATS.forEach(function(c){if(!ev.blocks[h][c.id])ev.blocks[h][c.id]={items:[],note:""}})});return ev}
function catCount(ev,cid){var n=0;(ev.halls||[]).forEach(function(h){var b=ev.blocks&&ev.blocks[h]&&ev.blocks[h][cid];if(b)n+=b.items.filter(function(i){return (i.name||"").trim()}).length});return n}
function fmtDate(d,opt){if(!d)return "";var dt=new Date(d+"T00:00:00");if(isNaN(dt))return d;return dt.toLocaleDateString("ru-RU",opt||{day:"numeric",month:"long"})}
function isPast(d){if(!d)return false;var t=new Date();t.setHours(0,0,0,0);return new Date(d+"T00:00:00")<t}
function route(){var h=location.hash.slice(1);return h.indexOf("ev-")===0?h.slice(3):null}
function go(id){if(id){location.hash="ev-"+id}else{if(location.hash){history.pushState(null,"",location.pathname+location.search)}render()}}
function linkFor(id){return location.origin+location.pathname+"#ev-"+id}
function homeLink(){return location.origin+location.pathname}
function myEmail(){return session&&session.user&&session.user.email||""}

/* ---------- data ---------- */
function loadAll(){
 return Promise.all([
  sb.from("settings").select("data").eq("id",1).maybeSingle(),
  sb.from("events").select("id,data,version,updated_at,updated_by")
 ]).then(function(r){
  if(r[0].error)throw r[0].error; if(r[1].error)throw r[1].error;
  state.halls=(r[0].data&&r[0].data.data&&r[0].data.data.halls)||[];
  versions={};
  state.events=(r[1].data||[]).map(function(row){var e=row.data||{};e.id=row.id;e.updatedAt=Date.parse(row.updated_at)||0;e.updatedBy=row.updated_by||"";versions[row.id]=row.version;return e});
  loaded=true;loadError="";render();
 }).catch(function(e){loadError=(e&&e.message)||"Нет связи с базой";loaded=true;render()});
}
function loadTech(id){
 if(!id){render();return Promise.resolve()}
 return Promise.all([
  sb.from("settings").select("data").eq("id",1).maybeSingle(),
  sb.rpc("get_event",{p_id:id})
 ]).then(function(r){
  if(r[1].error)throw r[1].error;
  state.halls=(r[0].data&&r[0].data.data&&r[0].data.data.halls)||[];
  var row=(r[1].data||[])[0];versions={};
  state.events=row?[(function(){var e=row.data||{};e.id=row.id;e.updatedAt=Date.parse(row.updated_at)||0;versions[row.id]=row.version;return e})()]:[];
  loaded=true;loadError="";render();
 }).catch(function(e){loadError=(e&&e.message)||"Нет связи с базой";loaded=true;render()});
}
var reloadT;
function scheduleReload(){clearTimeout(reloadT);reloadT=setTimeout(function(){if(isAdmin)loadAll();else if(route())loadTech(route())},400)}
function subscribe(){
 if(rtChannel)return;
 try{rtChannel=sb.channel("tz").on("postgres_changes",{event:"*",schema:"public",table:"events"},scheduleReload)
  .on("postgres_changes",{event:"*",schema:"public",table:"settings"},scheduleReload).subscribe()}catch(_){}
}
function unsubscribe(){if(rtChannel){try{sb.removeChannel(rtChannel)}catch(_){}rtChannel=null}}
function checkAdmin(){
 var p=session?sb.rpc("is_admin").then(function(r){isAdmin=!!r.data}):Promise.resolve(isAdmin=false);
 return p.then(function(){
  authReady=true;loaded=false;
  if(isAdmin){subscribe();return Promise.all([loadAll(),loadAdmins()]).then(render)}
  unsubscribe();admins=[];state.events=[];versions={};editing=null;
  if(route())return loadTech(route());
  loaded=true;render();
 });
}
function loadAdmins(){return sb.from("admins").select("email").order("email").then(function(r){admins=(r.data||[]).map(function(x){return x.email})})}
function cleanEvent(ev){var e=clone(ev);delete e._new;delete e.updatedAt;delete e.updatedBy;return e}
function fail(e,prefix){busy=false;showSaving(false);toast((prefix||"Не удалось сохранить")+": "+((e&&e.message)||"ошибка сети"));return false}

function saveEvent(ev,isNew,force){
 if(!isAdmin){toast("Сохранение доступно только администраторам");return Promise.resolve(false)}
 var data=cleanEvent(ev);busy=true;showSaving(true);
 var q=(isNew)?sb.from("events").insert({id:ev.id,data:data}).select("id,version")
  :(force?sb.from("events").update({data:data}).eq("id",ev.id).select("id,version")
   :sb.from("events").update({data:data}).eq("id",ev.id).eq("version",editingVersion).select("id,version"));
 return q.then(function(r){
  busy=false;showSaving(false);
  if(r.error)return fail(r.error);
  if(!r.data||!r.data.length){
   if(!isNew&&!force){conflict={ev:ev};render();return false}
   return fail({message:"нет прав на запись"});
  }
  editing=null;dirty=false;exitArmed=false;conflict=null;toast("Сохранено");
  return loadAll().then(function(){if(route()!==ev.id)location.hash="ev-"+ev.id;else render();return true});
 },function(e){return fail(e)});
}
function setStatus(id,status){
 var ev=evById(id);if(!ev||!isAdmin)return;
 var e=cleanEvent(ev);e.status=status;ev.status=status;render();
 sb.from("events").update({data:e}).eq("id",id).select("id").then(function(r){if(r.error||!r.data||!r.data.length){toast("Не удалось изменить статус");}loadAll()});
}
function deleteEvent(id){
 busy=true;showSaving(true);
 sb.from("events").delete().eq("id",id).select("id").then(function(r){busy=false;showSaving(false);
  if(r.error||!r.data||!r.data.length)return fail(r.error||{message:"нет прав на удаление"},"Не удалось удалить");
  toast("ТЗ удалено");go(null);loadAll()});
}
function saveHalls(halls){
 busy=true;showSaving(true);
 return sb.from("settings").upsert({id:1,data:{halls:halls}}).select("id").then(function(r){busy=false;showSaving(false);
  if(r.error||!r.data||!r.data.length)return fail(r.error||{message:"нет прав"});
  state.halls=halls;toast("Настройки сохранены");render();return true});
}

/* ---------- UI bits ---------- */
var toastT;
function toast(msg){var t=document.getElementById("toast");if(!t){t=document.createElement("div");t.id="toast";t.className="toast";t.setAttribute("role","status");document.body.appendChild(t)}t.textContent=msg;t.hidden=false;clearTimeout(toastT);toastT=setTimeout(function(){t.hidden=true},3200)}
function showSaving(on){var s=document.getElementById("saving");if(on){if(!s){s=document.createElement("div");s.id="saving";s.className="saving";s.innerHTML="<div>Сохраняем…</div>";document.body.appendChild(s)}s.hidden=false}else if(s)s.hidden=true}
function copyText(text){
 if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(text).then(function(){toast("Ссылка скопирована")},function(){modal={t:"copy",text:text};render()})}
 else{modal={t:"copy",text:text};render()}
}

function topBar(){
 var mode=isAdmin?'<span class="mode admin">Администратор</span>':'';
 var onBoard=!route()&&isAdmin;
 var auth=isAdmin?'<button class="btn ghost sm" data-act="account" title="'+esc(myEmail())+'">'+esc(myEmail().split("@")[0])+' · Выйти</button>':'';
 return '<header class="top"><div class="top-in gut">'+
  '<div class="brand"><h1>ТЗ на мероприятия</h1>'+mode+'</div>'+
  (onBoard?'<input id="q" class="search" type="search" placeholder="Поиск по названию или залу" value="'+esc(query)+'" aria-label="Поиск">':'')+
  (isAdmin?'<button class="btn" data-act="settings">Настройки</button>':'')+
  (isAdmin&&onBoard?'<button class="btn primary" data-act="new" data-st="draft">+ Новое ТЗ</button>':'')+
  themeBtn()+auth+
 '</div></header>'+conflictBanner();
}
function conflictBanner(){
 if(!conflict)return "";
 return '<div class="banner"><div class="banner-in gut"><p>Пока вы редактировали, другой администратор сохранил это ТЗ. Можно записать вашу версию поверх или взять его версию.</p>'+
 '<button class="btn primary sm" data-act="force">Сохранить мою версию</button><button class="btn sm" data-act="take-theirs">Взять его версию</button></div></div>';
}

/* ---------- board ---------- */
function boardView(){
 if(!loaded)return topBar()+'<div class="sheet gut"><div class="no-halls">Загрузка…</div></div>';
 if(loadError)return topBar()+'<div class="sheet gut"><div class="no-halls">Не удалось загрузить ТЗ: '+esc(loadError)+'<br><br><button class="btn" data-act="retry">Повторить</button></div></div>';
 var q=query.trim().toLowerCase();
 var list=state.events.filter(function(e){if(!q)return true;var hay=(e.title+" "+evHalls(e).map(function(h){return h.name}).join(" ")+" "+fmtDate(e.date)).toLowerCase();return hay.indexOf(q)>=0});
 var cols=STATUSES.map(function(st){
  var items=list.filter(function(e){return (e.status||"draft")===st.id}).sort(function(a,b){var r=(a.date||"9").localeCompare(b.date||"9");return st.id==="done"?-r:r});
  return '<section class="col st-'+st.id+'" data-col="'+st.id+'"><div class="col-h"><span class="dot"></span><h2>'+st.name+'</h2><span class="n">'+items.length+'</span></div>'+
   (items.length?items.map(cardView).join(""):'<div class="empty-col">'+(q?"Ничего не найдено":"Пока пусто")+'</div>')+
   (isAdmin?'<button class="add-col" data-act="new" data-st="'+st.id+'">+ Добавить ТЗ</button>':'')+
  '</section>';
 }).join("");
 return topBar()+'<div class="board-wrap gut"><div class="board">'+cols+'</div></div>'+
'';
}
function cardView(e){
 var halls=evHalls(e);
 var time=[e.rehearsal?"Прогоны с "+e.rehearsal:"",e.end?"до "+e.end:""].filter(Boolean).join(" · ");
 return '<a class="card" href="#ev-'+esc(e.id)+'" data-card="'+esc(e.id)+'"'+(isAdmin?' draggable="true"':'')+'>'+
  '<div class="card-date"><span class="d">'+(e.date?esc(fmtDate(e.date,{day:"2-digit",month:"2-digit",year:"numeric"})):"Дата не указана")+'</span><span class="w">'+esc(e.date?fmtDate(e.date,{weekday:"short"}):"")+'</span>'+(isPast(e.date)&&e.status!=="done"?'<span class="past">прошло</span>':'')+'</div>'+
  '<h3>'+esc(e.title||"Без названия")+'</h3>'+
  (time?'<div class="time mono">'+esc(time)+'</div>':'')+
  (halls.length?'<div class="chips">'+halls.map(function(h){return '<span class="chip">'+esc(h.name)+'</span>'}).join("")+'</div>':'')+
  '<div class="counts">'+CATS.map(function(c){return '<span class="c-'+c.id+'" title="'+c.name+'">'+c.name+' '+catCount(e,c.id)+'</span>'}).join("")+'</div>'+
 '</a>';
}

/* ---------- event sheet ---------- */
function sheetView(id){
 var isEdit=editing&&editing.id===id;
 var ev=isEdit?editing:evById(id);
 if(!ev)return topBar()+'<div class="sheet gut">'+(isAdmin?'<div class="bar"><button class="btn" data-act="back">← Все ТЗ</button></div>':'')+'<div class="no-halls">'+(!loaded?"Загрузка…":loadError?"Не удалось загрузить ТЗ: "+esc(loadError)+'<br><br><button class="btn" data-act="retry">Повторить</button>':"ТЗ не найдено. Проверьте ссылку или попросите администратора прислать новую.")+'</div></div>';
 return topBar()+'<div class="sheet gut">'+sheetBar(ev,isEdit)+headView(ev,isEdit)+hallsView(ev,isEdit)+'</div>'+(isEdit?editBar():'');
}
function sheetBar(ev,isEdit){
 if(!isAdmin)return '';
 var h='<div class="bar"><button class="btn" data-act="back">← Все ТЗ</button><span class="sp"></span>';
 if(isEdit){h+='<label class="eyebrow" for="f-status">Статус</label><select id="f-status" data-f="status">'+STATUSES.map(function(s){return '<option value="'+s.id+'"'+(ev.status===s.id?" selected":"")+'>'+s.name+'</option>'}).join("")+'</select>'}
 else{
  h+='<button class="btn" data-act="copy" data-id="'+esc(ev.id)+'">Ссылка для техников</button>';
  if(isAdmin){h+='<button class="btn" data-act="dup" data-id="'+esc(ev.id)+'">Дублировать</button><button class="btn danger'+(delArmed?" armed":"")+'" data-act="del" data-id="'+esc(ev.id)+'">'+(delArmed?"Точно удалить?":"Удалить")+'</button><button class="btn primary" data-act="edit" data-id="'+esc(ev.id)+'">Редактировать</button>'}
 }
 return h+'</div>';
}
function factCell(label,key,val,type,isEdit,extra){
 if(isEdit)return '<label class="fact"><span class="eyebrow">'+label+'</span><input id="f-'+key+'" type="'+type+'" data-f="'+key+'" value="'+esc(val||"")+'"></label>';
 return '<div class="fact"><span class="eyebrow">'+label+'</span><span class="v'+(extra||"")+(val?"":" dim")+'">'+(val?esc(type==="date"?fmtDate(val,{day:"numeric",month:"long",year:"numeric"}):val):"—")+'</span>'+(type==="date"&&val?'<span class="eyebrow">'+esc(fmtDate(val,{weekday:"long"}))+'</span>':'')+'</div>';
}
function headView(ev,isEdit){
 var halls=evHalls(ev);
 var h='<header class="head">';
 if(isEdit){h+='<input id="f-title" class="title-in" data-f="title" value="'+esc(ev.title)+'" placeholder="Название мероприятия">'}
 else{h+='<span class="pill st-'+esc(ev.status)+'">'+esc(stName(ev.status))+'</span><h2>'+esc(ev.title||"Без названия")+'</h2>'}
 var showMount=isEdit||ev.mount, showStart=isEdit||ev.start;
 h+='<div class="facts">'+factCell("Дата мероприятия","date",ev.date,"date",isEdit," txt")+
  (showMount?factCell("Монтаж с","mount",ev.mount,"time",isEdit):"")+
  factCell("Прогоны / репетиции с","rehearsal",ev.rehearsal,"time",isEdit)+
  (showStart?factCell("Начало мероприятия","start",ev.start,"time",isEdit):"")+
  factCell("Завершение","end",ev.end,"time",isEdit)+'</div>';
 h+='<div class="halls-row"><span class="eyebrow">'+(halls.length>1?"Залы":"Зал")+'</span><div class="chips">';
 if(isEdit){
  h+=halls.map(function(x){return '<span class="hall-chip">'+esc(x.name)+'<button class="btn ghost sm" style="padding:0 2px" data-act="unhall" data-h="'+x.id+'" aria-label="Убрать зал '+esc(x.name)+'"><span class="x">×</span></button></span>'}).join("");
  h+='<div class="picker"><button class="btn sm" data-act="picker" aria-expanded="'+pickerOpen+'">Выбрать залы ▾</button>'+(pickerOpen?pickerPop(ev):"")+'</div>';
 }else{
  h+=halls.length?halls.map(function(x){return '<button class="hall-chip" data-act="jump" data-h="'+x.id+'">'+esc(x.name)+'</button>'}).join(""):'<span class="none">Не выбран</span>';
 }
 h+='</div></div>';
 if(isEdit)h+='<label class="halls-row"><span class="eyebrow">Общие примечания</span><textarea id="f-notes" data-f="notes" placeholder="Контакты, доступ на площадку, особые условия">'+esc(ev.notes)+'</textarea></label>';
 else if((ev.notes||"").trim())h+='<div class="halls-row"><span class="eyebrow">Примечания</span><p class="notes">'+esc(ev.notes)+'</p></div>';
 if(!isEdit&&ev.updatedAt)h+='<p class="hint">Обновлено '+esc(new Date(ev.updatedAt).toLocaleString("ru-RU",{day:"numeric",month:"long",hour:"2-digit",minute:"2-digit"}))+(isAdmin&&ev.updatedBy?" · "+esc(ev.updatedBy):"")+'</p>';
 return h+'</header>';
}
function pickerPop(ev){
 var sel=ev.halls||[];
 return '<div class="pop" role="dialog" aria-label="Выбор залов">'+(state.halls.length?state.halls.map(function(h){return '<label><input type="checkbox" data-hallpick="'+h.id+'"'+(sel.indexOf(h.id)>=0?" checked":"")+'>'+esc(h.name)+'</label>'}).join(""):'<p class="hint" style="padding:8px">Список залов пуст</p>')+
  '<hr><button class="btn ghost sm" data-act="settings">Изменить список залов</button><button class="btn sm primary" data-act="picker">Готово</button></div>';
}
function hallsView(ev,isEdit){
 var halls=evHalls(ev);
 if(!halls.length)return '<div class="no-halls">'+(isEdit?"Выберите зал или несколько залов в шапке — для каждого появятся блоки «Звук», «Свет» и «Видео».":"Залы для этого мероприятия пока не выбраны.")+'</div>';
 ensureBlocks(ev);
 var done=isEdit?null:(ls.get("tz-done-"+ev.id)||{});
 return halls.map(function(h){
  var tot=CATS.reduce(function(n,c){return n+ev.blocks[h.id][c.id].items.filter(function(i){return (i.name||"").trim()}).length},0);
  return '<section class="hall" id="hall-'+h.id+'"><div class="hall-h"><h3>'+esc(h.name)+'</h3><span class="eyebrow">'+tot+' поз.</span></div><div class="cats">'+
   CATS.map(function(c){return isEdit?catEdit(ev,h.id,c):catRead(ev,h.id,c,done)}).join("")+'</div></section>';
 }).join("")+(isEdit?'':'<p class="hint">Галочки у позиций — личные отметки техника, видны только на этом устройстве.</p>');
}
function catRead(ev,hid,c,done){
 var b=ev.blocks[hid][c.id];var items=b.items.filter(function(i){return (i.name||"").trim()});
 var head='<div class="cat-h"><b>'+c.name+'</b><span class="eyebrow">'+c.en+'</span><span class="n">'+(items.length?items.length+" поз.":"")+'</span></div>';
 if(!items.length&&!(b.note||"").trim())return '<div class="cat cat-'+c.id+' empty">'+head+'<p class="none">Не требуется</p></div>';
 return '<div class="cat cat-'+c.id+'">'+head+'<div class="rows">'+items.map(function(it){var d=!!done[it.id];
  return '<label class="row'+(d?" done":"")+'"><input type="checkbox" data-done="'+esc(ev.id)+'|'+esc(it.id)+'"'+(d?" checked":"")+'><span class="nm">'+esc(it.name)+'</span><span class="q">'+(it.qty?"× "+esc(it.qty):"")+'</span>'+((it.note||"").trim()?'<span class="cm">'+esc(it.note)+'</span>':'')+'</label>'}).join("")+'</div>'+
  ((b.note||"").trim()?'<p class="cat-note">'+esc(b.note)+'</p>':'')+'</div>';
}
function catEdit(ev,hid,c){
 var b=ev.blocks[hid][c.id];
 return '<div class="cat cat-'+c.id+'"><div class="cat-h"><b>'+c.name+'</b><span class="eyebrow">'+c.en+'</span></div><div class="rows">'+
  b.items.map(function(it,i){var k=hid+"-"+c.id+"-"+it.id;
   var last=b.items.length-1,at=' data-h="'+hid+'" data-c="'+c.id+'" data-i="'+i+'"';
   return '<div class="erow" data-erow="'+hid+'|'+c.id+'|'+i+'"><span class="grip" draggable="true" title="Перетащите, чтобы переместить" aria-hidden="true">⋮⋮</span><input id="n-'+k+'" data-f="item" data-h="'+hid+'" data-c="'+c.id+'" data-i="'+i+'" data-k="name" list="dl-'+c.id+'" value="'+esc(it.name)+'" placeholder="Оборудование / задача" aria-label="Позиция">'+
   '<input id="q-'+k+'" data-f="item" data-h="'+hid+'" data-c="'+c.id+'" data-i="'+i+'" data-k="qty" value="'+esc(it.qty)+'" placeholder="Кол-во" aria-label="Количество">'+
   '<button class="rm" data-act="rm-item" data-h="'+hid+'" data-c="'+c.id+'" data-i="'+i+'" aria-label="Удалить позицию">×</button>'+
   '<input id="c-'+k+'" class="cm-in" data-f="item" data-h="'+hid+'" data-c="'+c.id+'" data-i="'+i+'" data-k="note" value="'+esc(it.note)+'" placeholder="Комментарий (необязательно)" aria-label="Комментарий">'+
   '<span class="mv"><button data-act="mv-up"'+at+(i===0?" disabled":"")+' aria-label="Переместить выше" title="Выше">↑</button><button data-act="mv-down"'+at+(i===last?" disabled":"")+' aria-label="Переместить ниже" title="Ниже">↓</button></span></div>'}).join("")+
  '</div><button class="add-item" data-act="add-item" data-h="'+hid+'" data-c="'+c.id+'">+ Позиция</button>'+
  '<textarea id="cn-'+hid+'-'+c.id+'" data-f="cnote" data-h="'+hid+'" data-c="'+c.id+'" placeholder="Примечание для отдела «'+c.name+'»">'+esc(b.note)+'</textarea></div>';
}
function editBar(){
 return '<div class="editbar gut"><div class="editbar-in"><span class="msg">'+(dirty?"Есть несохранённые изменения":"Режим редактирования")+'</span>'+
  (exitArmed?'<button class="btn danger" data-act="discard">Выйти без сохранения</button>':'<button class="btn" data-act="cancel">Отмена</button>')+
  '<button class="btn primary" data-act="save">Сохранить</button></div></div>';
}
function datalists(){return CATS.map(function(c){return '<datalist id="dl-'+c.id+'">'+SUGGEST[c.id].map(function(s){return '<option value="'+esc(s)+'">'}).join("")+'</datalist>'}).join("")}

/* ---------- modals ---------- */
function modalView(){
 if(!modal)return "";
 var wrap=function(inner,label){return '<div class="modal gut" data-act="close-bg"><div class="dlg" role="dialog" aria-label="'+label+'">'+inner+'</div></div>'};
 if(modal.t==="copy")return wrap('<h2>Ссылка на ТЗ</h2><p class="hint">Скопируйте и отправьте техникам.</p><div class="copybox"><input id="copy-in" readonly value="'+esc(modal.text)+'"></div><div class="bar"><span class="sp"></span><button class="btn primary" data-act="close">Готово</button></div>',"Ссылка");
 if(modal.t==="newpass")return wrap('<h2>Новый пароль</h2><form id="newpass-form" class="halls-row"><input id="np-1" class="full" type="password" minlength="8" required autocomplete="new-password" placeholder="Новый пароль, от 8 символов"><input id="np-2" class="full" type="password" minlength="8" required autocomplete="new-password" placeholder="Повторите пароль">'+(modal.err?'<p class="hint" style="color:var(--danger)">'+esc(modal.err)+'</p>':'')+'<div class="bar"><span class="sp"></span><button type="submit" class="btn primary">Сохранить пароль</button></div></form>',"Новый пароль");
 if(modal.t==="account")return wrap('<h2>Аккаунт</h2><p>Вы вошли как <b>'+esc(myEmail())+'</b>.</p>'+'<p class="hint">Адрес для входа администраторов: <b class="mono" style="overflow-wrap:anywhere">'+esc(homeLink())+'</b></p>'+
  '<div class="bar"><span class="sp"></span><button class="btn" data-act="close">Закрыть</button><button class="btn danger" data-act="logout">Выйти</button></div>',"Аккаунт");
 if(modal.t==="settings"){
  var hs=modal.halls;
  return wrap('<h2>Настройки</h2>'+
   '<h4>Залы</h4><div style="display:flex;flex-direction:column;gap:6px">'+hs.map(function(h,i){var used=state.events.filter(function(e){return (e.halls||[]).indexOf(h.id)>=0}).length;
    return '<div class="hl"><input id="hall-'+h.id+'" data-hallname="'+i+'" value="'+esc(h.name)+'" aria-label="Название зала"><span class="use">'+(used?"в "+used+" ТЗ":"")+'</span><button class="btn ghost sm danger" data-act="rm-hall" data-i="'+i+'" aria-label="Удалить зал">×</button></div>'}).join("")+
   '</div><button class="btn sm" data-act="add-hall" style="align-self:flex-start">+ Добавить зал</button>'+
   '<p class="hint">Переименование зала обновит его во всех ТЗ. Если удалить зал, его блоки скроются из ТЗ.</p>'+
   '<div class="bar"><span class="sp"></span><button class="btn primary" data-act="save-settings">Сохранить залы</button></div>'+
   '<h4>Администраторы</h4><div style="display:flex;flex-direction:column;gap:6px">'+admins.map(function(a){var me=a.toLowerCase()===myEmail().toLowerCase();
    return '<div class="hl"><span style="flex:1;min-width:0;overflow-wrap:anywhere">'+esc(a)+'</span>'+(me?'<span class="use">это вы</span>':'<button class="btn ghost sm danger" data-act="rm-admin" data-email="'+esc(a)+'" aria-label="Убрать администратора">×</button>')+'</div>'}).join("")+'</div>'+
   '<form id="admin-form" class="hl"><input id="admin-email" type="email" required placeholder="email нового администратора"><button type="submit" class="btn sm">Добавить</button></form>'+
   '<p class="hint">Порядок такой: коллега регистрируется на <b class="mono" style="overflow-wrap:anywhere">'+esc(homeLink())+'</b> (почта и пароль или Google), а вы добавляете его email сюда. Без этого он увидит только экран ожидания.</p>'+
   '<div class="bar"><span class="sp"></span><button class="btn" data-act="close">Закрыть</button></div>',"Настройки");
 }
 return "";
}

/* ---------- auth screen ---------- */
var AUTH_ERR={"Invalid login credentials":"Неверная почта или пароль.","Email not confirmed":"Почта ещё не подтверждена. Откройте письмо от Supabase и нажмите ссылку подтверждения.","User already registered":"Этот адрес уже зарегистрирован. Войдите или восстановите пароль.","Password should be at least 6 characters.":"Пароль слишком короткий."};
function authErr(e){var m=(e&&e.message)||"Ошибка сети";if(AUTH_ERR[m])return AUTH_ERR[m];if(/email rate limit/i.test(m))return "Лимит писем исчерпан: бесплатная почта сервиса отправляет не больше 2 писем в час на весь сайт. Попробуйте через час или попросите администратора.";if(/rate|limit|seconds/i.test(m))return "Слишком много попыток. Подождите минуту и попробуйте снова.";return m}
function authView(){
 var h='<div class="auth gut"><div class="auth-top">'+themeBtn()+'</div><div class="auth-card"><div class="auth-brand"><span class="eyebrow">Техническое обеспечение мероприятий</span><h1>ТЗ на мероприятия</h1></div>';
 if(session&&!isAdmin){
  h+='<p>Вы вошли как <b>'+esc(myEmail())+'</b>.</p><p class="hint">Этого адреса пока нет в списке администраторов. Попросите администратора добавить его: «Настройки» → «Администраторы», затем нажмите «Проверить снова».</p>'+
   '<div class="bar"><button class="btn danger" data-act="logout">Выйти</button><span class="sp"></span><button class="btn primary" data-act="recheck">Проверить снова</button></div>';
 }else{
  var t=auth.tab;
  h+=(t==="reset"?'<h2 class="auth-h">Восстановление пароля</h2>':'<div class="auth-tabs" role="tablist"><button role="tab" aria-selected="'+(t==="in")+'" class="'+(t==="in"?"on":"")+'" data-act="auth-tab" data-tab="in">Войти</button><button role="tab" aria-selected="'+(t==="up")+'" class="'+(t==="up"?"on":"")+'" data-act="auth-tab" data-tab="up">Зарегистрироваться</button></div>');
  if(auth.msg)h+='<p class="auth-msg">'+esc(auth.msg)+'</p>';
  h+='<form id="auth-form" class="auth-form" novalidate>'+
   '<label class="fld"><span class="eyebrow">Почта</span><input id="auth-email" type="email" required autocomplete="email" value="'+esc(auth.email)+'" placeholder="you@example.com"></label>'+
   (t!=="reset"?'<label class="fld"><span class="eyebrow">Пароль</span><input id="auth-pass" type="password" required minlength="'+(t==="up"?8:1)+'" autocomplete="'+(t==="up"?"new-password":"current-password")+'" placeholder="'+(t==="up"?"Не короче 8 символов":"")+'"></label>':'')+
   (t==="up"?'<label class="fld"><span class="eyebrow">Повторите пароль</span><input id="auth-pass2" type="password" required minlength="8" autocomplete="new-password"></label>':'')+
   (auth.err?'<p class="auth-err" role="alert">'+esc(auth.err)+'</p>':'')+
   '<button type="submit" class="btn primary auth-submit"'+(auth.busy?" disabled":"")+'>'+(auth.busy?"Подождите…":t==="in"?"Войти":t==="up"?"Создать аккаунт":"Отправить ссылку для сброса")+'</button>'+
   (t==="in"?'<button type="button" class="linkish" data-act="auth-tab" data-tab="reset">Забыли пароль?</button>':'')+
   (t==="reset"?'<button type="button" class="linkish" data-act="auth-tab" data-tab="in">← Вернуться ко входу</button>':'')+
   '</form>';
  if(CFG.google&&t!=="reset")h+='<div class="auth-or"><span>или</span></div><button class="btn auth-google" data-act="google"><svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>Продолжить с Google</button>';
  h+='<p class="hint auth-note">Вход нужен только администраторам. Техники открывают ТЗ по ссылке, которую присылает администратор.</p>';
 }
 return h+'</div></div>';
}
function setTab(t){auth.tab=t;auth.err="";auth.msg="";render();var f=document.getElementById(auth.email?"auth-pass":"auth-email")||document.getElementById("auth-email");if(f)f.focus()}

/* ---------- render ---------- */
function render(){
 var id=route();
 var y=window.scrollY;
 var active=document.activeElement, aid=active&&active.id, sel=null;
 try{if(aid&&active.selectionStart!=null)sel=[active.selectionStart,active.selectionEnd]}catch(_){}
 var body;
 if(!authReady)body='<div class="sheet gut"><div class="no-halls">Загрузка…</div></div>';
 else if(isAdmin)body=id?sheetView(id):boardView();
 else if(id)body=sheetView(id);
 else body=authView();
 app.innerHTML=body+(isAdmin?datalists():'')+modalView();
 window.scrollTo(0,y);
 if(aid){var el=document.getElementById(aid);if(el&&el!==document.activeElement){el.focus();if(sel)try{el.setSelectionRange(sel[0],sel[1])}catch(_){}}}
}

/* ---------- events ---------- */
function newEvent(status){return {id:uid(),title:"",date:"",mount:"",rehearsal:"",start:"",end:"",status:status||"draft",halls:[],notes:"",blocks:{},_new:true}}
function startEdit(ev){editing=clone(ev);editingVersion=versions[ev.id]||null;dirty=false;exitArmed=false;pickerOpen=false;delArmed=false;conflict=null;ensureBlocks(editing)}
function leaveEdit(){var wasNew=editing&&editing._new;editing=null;dirty=false;exitArmed=false;pickerOpen=false;conflict=null;if(wasNew)go(null);else render()}
function moveItem(h,c,from,to){
 var arr=editing&&editing.blocks[h]&&editing.blocks[h][c]&&editing.blocks[h][c].items;if(!arr)return;
 if(to<0||to>=arr.length||from===to)return;
 var it=arr.splice(from,1)[0];arr.splice(to,0,it);dirty=true;exitArmed=false;render();
}
function saveEditing(){
 if(busy)return;
 var ev=clone(editing);var isNew=!!ev._new;
 if(!(ev.title||"").trim())ev.title="Без названия";
 saveEvent(ev,isNew,false);
}

app.addEventListener("click",function(e){
 var t=e.target.closest("[data-act]");if(!t)return;
 var a=t.getAttribute("data-act");
 if(a==="close-bg"&&e.target!==t)return;
 if(t.tagName==="BUTTON")e.preventDefault();
 var d=t.dataset;
 switch(a){
  case "back":
   if(editing&&dirty&&!exitArmed){exitArmed=true;render();return}
   editing=null;dirty=false;exitArmed=false;delArmed=false;conflict=null;go(null);break;
  case "retry":loaded=false;render();if(isAdmin)loadAll();else loadTech(route());break;
  case "auth-tab":setTab(d.tab);break;
  case "google":auth.err="";sb.auth.signInWithOAuth({provider:"google",options:{redirectTo:homeLink()}}).then(function(r){if(r.error){auth.err=authErr(r.error);render()}});break;
  case "recheck":checkAdmin();break;
  case "account":modal={t:"account"};render();break;
  case "logout":sb.auth.signOut().then(function(){modal=null;editing=null;auth.tab="in";if(route()&&isAdmin){history.replaceState(null,"",location.pathname)}toast("Вы вышли")});break;
  case "new":var ev=newEvent(d.st);startEdit(ev);editing._new=true;location.hash="ev-"+ev.id;break;
  case "edit":var x=evById(d.id);if(x){startEdit(x);render()}break;
  case "cancel":if(dirty){exitArmed=true;render()}else leaveEdit();break;
  case "discard":leaveEdit();break;
  case "save":saveEditing();break;
  case "force":if(conflict)saveEvent(conflict.ev,false,true);break;
  case "take-theirs":conflict=null;editing=null;dirty=false;loadAll();break;
  case "dup":var src=evById(d.id);if(!src)return;var cp=cleanEvent(src);cp.id=uid();cp.title=(cp.title||"")+" (копия)";cp.status="draft";
   Object.keys(cp.blocks||{}).forEach(function(h){CATS.forEach(function(c){var b=cp.blocks[h][c.id];if(b)b.items.forEach(function(i){i.id=uid()})})});
   startEdit(cp);editing._new=true;dirty=true;location.hash="ev-"+cp.id;break;
  case "del":if(!delArmed){delArmed=true;render();setTimeout(function(){if(delArmed){delArmed=false;render()}},4000);return}
   delArmed=false;deleteEvent(d.id);break;
  case "copy":copyText(linkFor(d.id));break;
  case "jump":var el=document.getElementById("hall-"+d.h);if(el)el.scrollIntoView({behavior:"smooth",block:"start"});break;
  case "picker":pickerOpen=!pickerOpen;render();break;
  case "unhall":editing.halls=editing.halls.filter(function(h){return h!==d.h});dirty=true;render();break;
  case "add-item":ensureBlocks(editing);editing.blocks[d.h][d.c].items.push({id:uid(),name:"",qty:"",note:""});dirty=true;render();
   var rows=document.querySelectorAll('[data-f="item"][data-h="'+d.h+'"][data-c="'+d.c+'"][data-k="name"]');if(rows.length)rows[rows.length-1].focus();break;
  case "rm-item":editing.blocks[d.h][d.c].items.splice(+d.i,1);dirty=true;render();break;
  case "mv-up":case "mv-down":var to=+d.i+(a==="mv-up"?-1:1);moveItem(d.h,d.c,+d.i,to);
   var bt=document.querySelector('[data-act="'+a+'"][data-h="'+d.h+'"][data-c="'+d.c+'"][data-i="'+to+'"]');if(bt&&!bt.disabled)bt.focus();break;
  case "settings":pickerOpen=false;modal={t:"settings",halls:clone(state.halls)};render();loadAdmins().then(render);break;
  case "add-hall":modal.halls.push({id:"h"+uid(),name:"Новый зал"});render();var ins=document.querySelectorAll("[data-hallname]");if(ins.length){ins[ins.length-1].focus();ins[ins.length-1].select()}break;
  case "rm-hall":modal.halls.splice(+d.i,1);render();break;
  case "save-settings":var halls=modal.halls.filter(function(h){return h.name.trim()}).map(function(h){return {id:h.id,name:h.name.trim()}});
   saveHalls(halls).then(function(ok){if(ok&&modal)modal.halls=clone(state.halls);render()});break;
  case "rm-admin":sb.from("admins").delete().eq("email",d.email).then(function(r){if(r.error)toast("Не удалось: "+r.error.message);loadAdmins().then(render)});break;
  case "theme":var nt=curTheme()==="dark"?"light":"dark";applyTheme(nt);ls.set("tz-theme",nt);render();break;
  case "close":case "close-bg":modal=null;render();break;
 }
});
app.addEventListener("submit",function(e){
 e.preventDefault();
 if(e.target.id==="auth-form"){
  var em=(document.getElementById("auth-email").value||"").trim(),pw=document.getElementById("auth-pass"),pw2=document.getElementById("auth-pass2");
  auth.email=em;auth.err="";auth.msg="";
  if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)){auth.err="Введите почту полностью, например name@mail.ru.";render();return}
  if(auth.tab==="up"){
   if(pw.value.length<8){auth.err="Пароль должен быть не короче 8 символов.";render();return}
   if(pw.value!==pw2.value){auth.err="Пароли не совпадают.";render();return}
  }
  if(auth.tab==="in"&&!pw.value){auth.err="Введите пароль.";render();return}
  auth.busy=true;render();ls.set("tz-email",em);
  var pr=auth.tab==="in"?sb.auth.signInWithPassword({email:em,password:pw.value})
   :auth.tab==="up"?sb.auth.signUp({email:em,password:pw.value,options:{emailRedirectTo:homeLink()}})
   :sb.auth.resetPasswordForEmail(em,{redirectTo:homeLink()});
  var tab=auth.tab;
  pr.then(function(r){auth.busy=false;
   if(r.error){auth.err=authErr(r.error);render();return}
   if(tab==="up"){
    if(r.data&&r.data.user&&r.data.user.identities&&r.data.user.identities.length===0){auth.err=AUTH_ERR["User already registered"];render();return}
    if(!r.data.session){auth.tab="in";auth.msg="Аккаунт создан. Мы отправили письмо на "+em+": откройте его и подтвердите почту, затем войдите. Если письма нет, проверьте «Спам».";render();return}
   }
   if(tab==="reset"){auth.tab="in";auth.msg="Если такой адрес зарегистрирован, на него пришло письмо со ссылкой для нового пароля.";render();return}
   render();
  },function(err){auth.busy=false;auth.err=authErr(err);render()});
 }
 if(e.target.id==="newpass-form"){
  var a=document.getElementById("np-1").value,b=document.getElementById("np-2").value;
  if(a.length<8){modal.err="Пароль должен быть не короче 8 символов.";render();return}
  if(a!==b){modal.err="Пароли не совпадают.";render();return}
  sb.auth.updateUser({password:a}).then(function(r){if(r.error){modal.err=authErr(r.error);render()}else{modal=null;toast("Пароль обновлён");render()}});
 }
 if(e.target.id==="admin-form"){
  var ae=document.getElementById("admin-email").value.trim().toLowerCase();if(!ae)return;
  sb.from("admins").insert({email:ae}).then(function(r){if(r.error)toast(/duplicate/i.test(r.error.message)?"Этот адрес уже в списке":"Не удалось: "+r.error.message);else toast("Администратор добавлен");loadAdmins().then(render)});
 }
});
app.addEventListener("input",function(e){
 var t=e.target,d=t.dataset;
 if(d.f&&editing){
  if(d.f==="item"){editing.blocks[d.h][d.c].items[+d.i][d.k]=t.value}
  else if(d.f==="cnote"){editing.blocks[d.h][d.c].note=t.value}
  else editing[d.f]=t.value;
  if(!dirty||exitArmed){dirty=true;exitArmed=false;var m=document.querySelector(".editbar .msg");if(m)m.textContent="Есть несохранённые изменения"}
 }
 if(t.id==="q"){query=t.value;render()}
 if(d.hallname!=null&&modal)modal.halls[+d.hallname].name=t.value;
});
app.addEventListener("change",function(e){
 var t=e.target,d=t.dataset;
 if(d.hallpick&&editing){var id=d.hallpick;if(t.checked){if(editing.halls.indexOf(id)<0){var order=state.halls.map(function(h){return h.id});editing.halls.push(id);editing.halls.sort(function(a,b){return order.indexOf(a)-order.indexOf(b)})}}else editing.halls=editing.halls.filter(function(h){return h!==id});dirty=true;render()}
 if(d.done){var p=d.done.split("|"),k="tz-done-"+p[0],m=ls.get(k)||{};if(t.checked)m[p[1]]=1;else delete m[p[1]];ls.set(k,m);t.closest(".row").classList.toggle("done",t.checked)}
 if(t.id==="f-status"&&editing){editing.status=t.value;dirty=true}
});
document.addEventListener("click",function(e){if(pickerOpen&&!e.target.closest(".picker")){pickerOpen=false;render()}});
document.addEventListener("keydown",function(e){if(e.key==="Escape"){if(modal){modal=null;render()}else if(pickerOpen){pickerOpen=false;render()}}});
window.addEventListener("beforeunload",function(e){if(editing&&dirty){e.preventDefault();e.returnValue=""}});

/* drag & drop cards between columns */
var dragId=null;
app.addEventListener("dragstart",function(e){var c=e.target.closest&&e.target.closest("[data-card]");if(!c||!isAdmin)return;dragId=c.dataset.card;c.classList.add("dragging");try{e.dataTransfer.setData("text/plain",dragId);e.dataTransfer.effectAllowed="move"}catch(_){}});
app.addEventListener("dragend",function(e){var c=e.target.closest&&e.target.closest("[data-card]");if(c)c.classList.remove("dragging");document.querySelectorAll(".col.over").forEach(function(x){x.classList.remove("over")})});
app.addEventListener("dragover",function(e){var col=e.target.closest(".col");if(!col||!dragId)return;e.preventDefault();document.querySelectorAll(".col.over").forEach(function(x){if(x!==col)x.classList.remove("over")});col.classList.add("over")});
app.addEventListener("drop",function(e){var col=e.target.closest(".col");if(!col||!dragId)return;e.preventDefault();var id=dragId;dragId=null;col.classList.remove("over");var ev=evById(id);var st=col.dataset.col;if(ev&&ev.status!==st)setStatus(id,st)});

/* drag to reorder items inside one block */
var itemDrag=null;
function clearDropMarks(){document.querySelectorAll(".erow.drop-before,.erow.drop-after").forEach(function(x){x.classList.remove("drop-before","drop-after")})}
app.addEventListener("dragstart",function(e){var g=e.target.closest&&e.target.closest(".grip");if(!g)return;var row=g.closest(".erow");var p=row.dataset.erow.split("|");itemDrag={h:p[0],c:p[1],i:+p[2]};row.classList.add("dragging");
 try{e.dataTransfer.effectAllowed="move";e.dataTransfer.setData("text/plain","item");e.dataTransfer.setDragImage(row,20,20)}catch(_){}});
app.addEventListener("dragover",function(e){if(!itemDrag)return;var row=e.target.closest(".erow");if(!row)return;var p=row.dataset.erow.split("|");if(p[0]!==itemDrag.h||p[1]!==itemDrag.c)return;
 e.preventDefault();var r=row.getBoundingClientRect(),after=e.clientY>r.top+r.height/2;clearDropMarks();row.classList.add(after?"drop-after":"drop-before")});
app.addEventListener("drop",function(e){if(!itemDrag)return;var row=e.target.closest(".erow");var src=itemDrag;itemDrag=null;clearDropMarks();if(!row)return;var p=row.dataset.erow.split("|");if(p[0]!==src.h||p[1]!==src.c)return;
 e.preventDefault();var r=row.getBoundingClientRect(),after=e.clientY>r.top+r.height/2,tgt=+p[2]+(after?1:0);if(tgt>src.i)tgt--;moveItem(src.h,src.c,src.i,tgt)});
app.addEventListener("dragend",function(){itemDrag=null;clearDropMarks();document.querySelectorAll(".erow.dragging").forEach(function(x){x.classList.remove("dragging")})});

window.addEventListener("hashchange",function(){
 var id=route();delArmed=false;
 if(editing&&editing.id!==id){if(!dirty)editing=null}
 pickerOpen=false;
 if(authReady&&!isAdmin&&id&&!evById(id)){loaded=false;loadTech(id)}
 render();window.scrollTo(0,0);
});

/* ---------- boot ---------- */
function cleanAuthHash(){if(/access_token=|error_description=|type=recovery/.test(location.hash))history.replaceState(null,"",location.pathname+location.search)}
var urlErr=(location.hash.match(/error_description=([^&]+)/)||[])[1];
if(urlErr){auth.err=decodeURIComponent(urlErr.replace(/\+/g," "));if(/expired|invalid/i.test(auth.err))auth.err="Ссылка из письма устарела или уже использована. Запросите новую.";}
render();
sb.auth.getSession().then(function(r){session=r.data&&r.data.session||null;cleanAuthHash();return checkAdmin()});
sb.auth.onAuthStateChange(function(ev,s){
 var prev=session&&session.user&&session.user.id;session=s||null;
 if(ev==="PASSWORD_RECOVERY"){modal={t:"newpass"};}
 cleanAuthHash();
 if(ev==="SIGNED_IN"&&s&&s.user&&s.user.id!==prev){auth.msg="";auth.err="";setTimeout(checkAdmin,0)}
 if(ev==="SIGNED_OUT"){setTimeout(checkAdmin,0)}
 render();
});
document.addEventListener("visibilitychange",function(){if(!document.hidden&&!editing&&authReady)scheduleReload()});
})();
