#!/usr/bin/env python3
"""Avisos por WhatsApp para Uptime Kuma y scripts del servidor.

Envia desde el asistente (WAHA, numero 600000001) a Bryan; si WAHA falla, usa CallMeBot como respaldo.

POST /kuma  <- webhook JSON de Uptime Kuma
POST /send  <- {"text": "..."}  (o usar /usr/local/bin/notify "texto")
Solo escucha en 127.0.0.1. Los mensajes se envian en cola para respetar el limite de CallMeBot.
"""
import json, os, queue, threading, time, urllib.parse, urllib.request
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from zoneinfo import ZoneInfo

PHONE, KEY = os.environ["CALLMEBOT_PHONE"], os.environ["CALLMEBOT_APIKEY"]
WAHA_URL, WAHA_KEY, OWNER_CHAT = os.environ.get("WAHA_URL"), os.environ.get("WAHA_API_KEY"), os.environ.get("OWNER_CHAT")
TZ = ZoneInfo("Europe/Madrid")
Q: "queue.Queue[str]" = queue.Queue()


def send_waha(text):
    if not (WAHA_URL and WAHA_KEY and OWNER_CHAT):
        return False
    data = json.dumps({"session": "default", "chatId": OWNER_CHAT, "text": text}).encode()
    req = urllib.request.Request(f"{WAHA_URL}/api/sendText", data=data, method="POST",
                                 headers={"Content-Type": "application/json", "X-Api-Key": WAHA_KEY})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return 200 <= r.status < 300
    except Exception as e:
        print("WAHA fallo, uso CallMeBot:", e, flush=True)
        return False


def sender():
    while True:
        text = Q.get()
        if send_waha(text):
            print("enviado (WAHA):", text.splitlines()[0][:80], flush=True)
            time.sleep(2)
            continue
        url = "https://api.callmebot.com/whatsapp.php?" + urllib.parse.urlencode({"phone": PHONE, "text": text, "apikey": KEY})
        for attempt in range(3):
            try:
                with urllib.request.urlopen(url, timeout=30) as r:
                    body = r.read().decode(errors="replace")
                if r.status == 200 and "ERROR" not in body.upper():
                    print("enviado:", text.splitlines()[0][:80], flush=True)
                    break
                print("respuesta CallMeBot:", body[:200], flush=True)
            except Exception as e:  # red caida o limite: reintentar
                print("error enviando:", e, flush=True)
            time.sleep(20 * (attempt + 1))
        time.sleep(4)


def kuma_text(d):
    hb, mon = d.get("heartbeat") or {}, d.get("monitor") or {}
    name = mon.get("name") or "Uptime Kuma"
    hora = datetime.now(TZ).strftime("%d/%m %H:%M")
    if not hb:  # notificacion de prueba
        return f"🔔 *Uptime Kuma*\n{d.get('msg', 'Prueba')}\n🕒 {hora}"
    detalle = (hb.get("msg") or "").strip()[:200]
    if hb.get("status") == 0:
        return f"🔴 *{name}* está caído\n{detalle}\n🕒 {hora}".strip()
    if hb.get("status") == 1:
        return f"🟢 *{name}* vuelve a funcionar\n🕒 {hora}"
    return f"🟡 *{name}*: {detalle}\n🕒 {hora}"


class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_POST(self):
        try:
            d = json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0)) or b"{}")
            if self.path == "/kuma":
                Q.put(kuma_text(d))
            elif self.path == "/send" and d.get("text"):
                Q.put(str(d["text"])[:1500])
            else:
                return self.reply(404)
            self.reply(200)
        except ValueError:
            self.reply(400)

    def reply(self, code):
        self.send_response(code); self.send_header("Content-Length", "0"); self.end_headers()


if __name__ == "__main__":
    threading.Thread(target=sender, daemon=True).start()
    ThreadingHTTPServer(("127.0.0.1", 3006), H).serve_forever()
