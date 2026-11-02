"""Telegram delivery worker. Run one instance with the dedicated database login."""
import json
import logging
import os
import re
import time
from urllib.error import HTTPError
from urllib.parse import quote
from urllib.request import Request, urlopen

import psycopg

TOKEN = os.environ["TELEGRAM_BOT_TOKEN"]
ADMINS = {int(x.strip()) for x in os.environ["TELEGRAM_ADMIN_IDS"].split(",") if x.strip()}
SITE = "https://nikitausachev.github.io/tz-board/"
EVENT = re.compile(r"[A-Za-z0-9_-]{1,64}")


class TelegramError(Exception):
    def __init__(self, code, retry=30):
        self.code = code
        self.retry = retry


def api(method, **params):
    req = Request("https://api.telegram.org/bot" + TOKEN + "/" + method,
                  data=json.dumps(params).encode(), headers={"Content-Type": "application/json"})
    try:
        with urlopen(req, timeout=18) as response:
            return json.load(response)["result"]
    except HTTPError as err:
        try:
            delay = json.load(err).get("parameters", {}).get("retry_after", 30)
        except ValueError:
            delay = 30
        raise TelegramError(err.code, delay) from None


def stop(db, chat):
    db.execute("delete from tz_telegram.subs where chat=%s", (chat,))
    db.execute("delete from tz_telegram.admin_chats where chat=%s", (chat,))
    db.execute("delete from tz_telegram.outbox where chat=%s", (chat,))


def command(db, update):
    msg = update.get("message", {})
    chat = msg.get("chat", {})
    if chat.get("type") != "private":
        return
    cid = chat["id"]
    cmd, _, arg = msg.get("text", "").strip().partition(" ")
    if cmd == "/stop":
        stop(db, cid)
        reply = "Уведомления отключены."
    elif cmd == "/id":
        reply = f"Ваш номер чата: {cid}"
    elif cmd == "/start" and arg and EVENT.fullmatch(arg):
        title = db.execute("select tz_telegram.active_title(%s)", (arg,)).fetchone()[0]
        if title:
            db.execute("insert into tz_telegram.subs values(%s,%s) on conflict do nothing", (arg, cid))
            reply = f"Вы подписаны на изменения ТЗ «{title}». Отключить все уведомления — /stop."
        else:
            reply = "ТЗ недоступно. Проверьте ссылку у администратора."
    elif cmd == "/start" and cid in ADMINS:
        db.execute("insert into tz_telegram.admin_chats values(%s) on conflict do nothing", (cid,))
        reply = "Вы будете получать сообщения о готовности залов. Отключить — /stop."
    else:
        reply = "Для подписки откройте нужное ТЗ и нажмите «Получать изменения в Telegram». Ваш номер чата — /id."
    db.execute("insert into tz_telegram.outbox(chat,kind,message) values(%s,'reply',%s)", (cid, reply[:3500]))


def deliver(db):
    with db.transaction():
        row = db.execute("select id,chat,event,message,attempts from tz_telegram.outbox where due<=now() order by id limit 1 for update skip locked").fetchone()
        if not row:
            return False
        mid, chat, event, message, attempts = row
        params = {"chat_id": chat, "text": message[:3500]}
        if event:
            params["reply_markup"] = {"inline_keyboard": [[{"text": "Открыть ТЗ", "url": SITE + "#ev-" + quote(event, safe="")}]]}
        try:
            api("sendMessage", **params)
        except TelegramError as err:
            if err.code == 403:
                stop(db, chat)
                return True
            if err.code != 400:
                retry = max(err.retry, min(3600, 2 ** min(attempts, 12)))
                db.execute("update tz_telegram.outbox set due=now()+%s*interval '1 second', attempts=attempts+1 where id=%s", (retry, mid))
                return True
            logging.warning("Telegram rejected a message (400)")
        db.execute("delete from tz_telegram.outbox where id=%s", (mid,))
    return True


def run():
    username = api("getMe")["username"]
    with psycopg.connect(os.environ["DATABASE_URL"], autocommit=True) as db:
        if not db.execute("select pg_try_advisory_lock(842183,11)").fetchone()[0]:
            raise RuntimeError("worker already running")
        db.execute("delete from tz_telegram.admin_chats where not(chat=any(%s::bigint[]))", (list(ADMINS),))
        db.execute("delete from tz_telegram.outbox where kind='ready' and not(chat=any(%s::bigint[]))", (list(ADMINS),))
        db.execute("insert into tz_telegram.cursor_state values(true,0) on conflict do nothing")
        while True:
            db.execute("insert into tz_telegram.bot values(true,%s,now()) on conflict(id) do update set username=excluded.username, heartbeat=now()", (username,))
            for _ in range(12):
                if not deliver(db):
                    break
            offset = db.execute("select next_update from tz_telegram.cursor_state where id").fetchone()[0]
            for upd in api("getUpdates", offset=offset, timeout=2, allowed_updates=["message"]):
                with db.transaction():
                    command(db, upd)
                    db.execute("update tz_telegram.cursor_state set next_update=%s", (upd["update_id"]+1,))


if __name__ == "__main__":
    while True:
        try:
            run()
        except Exception as error:
            # Exception messages can contain the bot token or the connection string.
            logging.error("Worker interrupted (%s); retrying", type(error).__name__)
            time.sleep(8)
