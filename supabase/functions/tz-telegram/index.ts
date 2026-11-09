// @ts-nocheck
// Single-file deployment through the Supabase Dashboard editor.
const env = key => Deno.env.get(key);
const root = env("SUPABASE_URL");
const token = env("TELEGRAM_BOT_TOKEN");
const secret = env("TELEGRAM_JOB_SECRET");
const admins = (env("TELEGRAM_ADMIN_IDS") || "").split(",").map(x => x.trim()).filter(Boolean);
const site = "https://nikitausachev.github.io/tz-board/";
const webhook = root + "/functions/v1/tz-telegram";
const username = "serp_tzbot";

async function rpc(name, params) {
  const key = env("SUPABASE_SERVICE_ROLE_KEY");
  const res = await fetch(root + "/rest/v1/rpc/" + name, {
    method: "POST", headers: {apikey:key, Authorization:"Bearer " + key, "Content-Type":"application/json"},
    body: JSON.stringify(params), signal: AbortSignal.timeout(9000)
  });
  if (!res.ok) throw new Error("Database operation failed: " + name);
  const value = await res.text();
  return value ? JSON.parse(value) : null;
}
async function telegram(method, params) {
  const res = await fetch("https://api.telegram.org/bot" + token + "/" + method, {
    method:"POST", headers:{"Content-Type":"application/json"},body:JSON.stringify(params),
    signal:AbortSignal.timeout(8000)
  });
  return await res.json();
}
async function webhookSecret() {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("webhook:" + secret));
  return Array.from(new Uint8Array(hash), x=>x.toString(16).padStart(2,"0")).join("");
}
async function configure() {
  const bot = await telegram("getMe", {});
  if (!bot.ok || bot.result.username.toLowerCase() !== username) throw new Error("Wrong bot token");
  const result = await telegram("setWebhook", {url:webhook,secret_token:await webhookSecret(),allowed_updates:["message"]});
  if (!result.ok) throw new Error("Webhook registration failed");
}
async function receive(update) {
  const msg=update.message;
  if (msg?.chat?.type !== "private" || !Number.isSafeInteger(msg.chat.id) || !Number.isSafeInteger(update.update_id) || typeof msg.text!=="string") return;
  const commands={"Подписаться на акции":"/shop_on","Посмотреть акции":"/shop","Отписаться от акций":"/shop_off"};
  const [command,arg=""] = (commands[msg.text.trim()] || msg.text.trim()).split(/\s+/,2);
  await rpc("tg_command",{p_update:update.update_id,p_chat:msg.chat.id,p_command:command,p_arg:arg,p_admin:admins.includes(String(msg.chat.id))});
}
async function dispatch() {
  // Check configuration before advertising the bot to technicians.
  const status = await telegram("getWebhookInfo",{});
  if (!status.ok || status.result.url !== webhook) throw new Error("Configure webhook first");
  await rpc("tg_tick",{p_username:username,p_admins:admins});
  await rpc("tg_shop_tick",{});
  const deadline = Date.now()+22000;
  for(let i=0;i<25 && Date.now()<deadline;i++) {
    const job=await rpc("tg_claim",{});
    if (!job) break;
    const params={chat_id:job.chat,text:job.message.slice(0,3800)};
    if (job.event) params.reply_markup={inline_keyboard:[[{text:"Открыть ТЗ",url:site+"#ev-"+encodeURIComponent(job.event)}]]};
    if (!job.event) params.reply_markup={keyboard:[[{text:"Подписаться на акции"},{text:"Посмотреть акции"}],[{text:"Отписаться от акций"}]],resize_keyboard:true};
    const sent=await telegram("sendMessage",params);
    const code=sent.ok?200:sent.error_code;
    if (!sent.ok) console.warn("Telegram delivery status",code);
    await rpc("tg_finish",{p_id:job.id,p_lease:job.lease,p_code:code||500,p_retry:Math.max(sent.parameters?.retry_after||0,Math.min(3600,2**Math.min(job.attempts,12)))});
    if(code===403) await rpc("tg_shop_block",{p_chat:job.chat});
    if(code===429) break;
  }
}
Deno.serve(async request=>{
  if(request.method!=="POST") return new Response(null,{status:405});
  if(!token || !secret || secret.length<32 || admins.some(x=>!/^\d{1,16}$/.test(x))) return new Response("Missing configuration",{status:503});
  try {
    if(request.headers.get("x-job-secret")===secret) {
      const op=(await request.json()).action;
      if(op==="setup") await configure();
      else if(op==="dispatch") await dispatch();
      else return new Response(null,{status:400});
    } else if(request.headers.get("x-telegram-bot-api-secret-token")===await webhookSecret()) {
      await receive(await request.json());
    } else return new Response(null,{status:403});
    return Response.json({ok:true});
  } catch(error) {
    console.error("Telegram handler failed", error instanceof Error && /^(Configure webhook first|Database operation failed: \w+|Wrong bot token|Webhook registration failed)$/.test(error.message)?error.message:"request failed");
    return new Response("Retry later",{status:503});
  }
});
