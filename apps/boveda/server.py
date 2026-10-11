#!/usr/bin/env python3
"""Boveda Bryan - backend de conocimiento cero.

El navegador cifra todo (AES-256-GCM) antes de enviarlo. Este servidor solo guarda
bloques opacos y comprueba un token derivado de la contrasena (guarda su SHA-256).
"""
import hashlib
import hmac
import json
import os
import re
import shutil
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

DATA = os.environ.get("DATA_DIR", "/data")
PORT = int(os.environ.get("PORT", "8080"))
STATIC = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")
BLOBS = os.path.join(DATA, "blobs")
VAULT = os.path.join(DATA, "vault.json")
INDEX = os.path.join(DATA, "index.bin")
INDEX_META = os.path.join(DATA, "index.meta.json")
MAX_BLOB = int(os.environ.get("MAX_BLOB_MB", "200")) * 1024 * 1024
MAX_SMALL = 32 * 1024 * 1024
ID_RE = re.compile(r"[a-f0-9]{32}")
HEX64 = re.compile(r"[a-f0-9]{64}")
B64 = re.compile(r"[A-Za-z0-9+/=]{8,512}")
SLOTS = ("password", "recovery")
STATIC_FILES = {
    "/": ("index.html", "text/html; charset=utf-8"),
    "/app.js": ("app.js", "text/javascript; charset=utf-8"),
    "/style.css": ("style.css", "text/css; charset=utf-8"),
    "/icon.svg": ("icon.svg", "image/svg+xml"),
}
CSP = ("default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob: data:; "
       "media-src blob:; frame-src blob:; object-src 'none'; base-uri 'none'; form-action 'none'; "
       "frame-ancestors 'none'; connect-src 'self'")

INBOX = os.path.join(DATA, "inbox")
INBOX_KEY = os.path.join(DATA, "inbox_pub.json")
INBOX_TOKEN = os.environ.get("INBOX_TOKEN", "")
MAX_INBOX = 50 * 1024 * 1024
INBOX_INFO = b"boveda-inbox-v1"

os.makedirs(BLOBS, exist_ok=True)
os.makedirs(INBOX, exist_ok=True)
lock = threading.Lock()
throttle = {"fails": 0, "until": 0.0}
MAX_FAILS, LOCK_SECONDS = 5, 300


def read_json(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def atomic_write(path, data: bytes):
    tmp = path + ".tmp"
    with open(tmp, "wb") as f:
        f.write(data)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, path)


def index_version():
    try:
        return int(read_json(INDEX_META)["version"])
    except FileNotFoundError:
        return 0


def valid_slot(s):
    return (isinstance(s, dict)
            and isinstance(s.get("iter"), int) and 100_000 <= s["iter"] <= 10_000_000
            and all(isinstance(s.get(k), str) and B64.fullmatch(s[k]) for k in ("salt", "iv", "wrapped"))
            and isinstance(s.get("authHash"), str) and HEX64.fullmatch(s["authHash"]))


def seal_for_inbox(data: bytes, meta: dict) -> bytes:
    """Cifra para la bandeja con la clave PUBLICA de la boveda (ECDH P-256 + HKDF-SHA256 + AES-256-GCM).

    Solo el navegador de Bryan, con la clave privada guardada (cifrada) dentro de la boveda, puede abrirlo.
    El contenido en claro solo existe en memoria mientras dura esta funcion.
    """
    import base64
    raw = base64.b64decode(read_json(INBOX_KEY)["pub"])
    pub = ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), raw)
    eph = ec.generate_private_key(ec.SECP256R1())
    key = HKDF(algorithm=hashes.SHA256(), length=32, salt=bytes(32), info=INBOX_INFO).derive(eph.exchange(ec.ECDH(), pub))
    eph_raw = eph.public_key().public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
    m = json.dumps(meta, ensure_ascii=False).encode()
    iv = os.urandom(12)
    ct = AESGCM(key).encrypt(iv, len(m).to_bytes(4, "big") + m + data, None)
    return b"BVI1" + eph_raw + iv + ct


class Handler(BaseHTTPRequestHandler):
    server_version = "Boveda"
    sys_version = ""
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):  # sin rutas ni IPs: solo errores de servidor
        pass

    # ---------- respuestas ----------
    def headers_common(self, code, ctype, length, extra=None):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(length))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Content-Security-Policy", CSP)
        self.send_header("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()

    def send(self, code, body=b"", ctype="application/json", extra=None):
        self.headers_common(code, ctype, len(body), extra)
        if self.command != "HEAD" and body:
            self.wfile.write(body)

    def js(self, code, obj, extra=None):
        self.send(code, json.dumps(obj).encode(), "application/json", extra)

    def read_body(self, limit):
        n = int(self.headers.get("Content-Length") or 0)
        if n > limit:
            self.close_connection = True
            raise OverflowError
        return self.rfile.read(n)

    # ---------- autenticacion ----------
    def authed(self):
        now = time.time()
        if now < throttle["until"]:
            self.js(429, {"error": "locked", "retry": int(throttle["until"] - now) + 1})
            return False
        tok = self.headers.get("X-Vault-Auth", "")
        ok = False
        if HEX64.fullmatch(tok) and os.path.exists(VAULT):
            h = hashlib.sha256(bytes.fromhex(tok)).hexdigest()
            for slot in read_json(VAULT)["slots"].values():
                if hmac.compare_digest(h, slot["authHash"]):
                    ok = True
        with lock:
            if ok:
                throttle["fails"] = 0
            else:
                throttle["fails"] += 1
                if throttle["fails"] >= MAX_FAILS:
                    throttle["fails"], throttle["until"] = 0, now + LOCK_SECONDS
        if not ok:
            self.js(401, {"error": "auth"})
        return ok

    # ---------- rutas ----------
    def route(self):
        return self.path.split("?", 1)[0]

    def do_GET(self):
        p = self.route()
        if p in STATIC_FILES:
            name, ctype = STATIC_FILES[p]
            with open(os.path.join(STATIC, name), "rb") as f:
                return self.send(200, f.read(), ctype)
        if p == "/api/vault":
            if not os.path.exists(VAULT):
                return self.js(404, {"error": "none"})
            slots = read_json(VAULT)["slots"]
            pub = {k: {kk: vv for kk, vv in s.items() if kk != "authHash"} for k, s in slots.items()}
            return self.js(200, {"slots": pub})
        if p == "/api/inbox/key":
            if not os.path.exists(INBOX_KEY):
                return self.js(404, {"error": "none"})
            return self.js(200, read_json(INBOX_KEY))
        if p == "/api/inbox":
            if not self.authed():
                return
            items = [{"id": f, "size": os.path.getsize(os.path.join(INBOX, f)), "created": int(os.path.getmtime(os.path.join(INBOX, f)))}
                     for f in sorted(os.listdir(INBOX)) if ID_RE.fullmatch(f)]
            return self.js(200, items)
        m = re.fullmatch(r"/api/inbox/([a-f0-9]{32})", p)
        if m:
            if not self.authed():
                return
            path = os.path.join(INBOX, m.group(1))
            if not os.path.exists(path):
                return self.js(404, {"error": "not found"})
            with open(path, "rb") as f:
                return self.send(200, f.read(), "application/octet-stream")
        if p == "/api/index":
            if not self.authed():
                return
            with lock:
                ver = index_version()
                data = open(INDEX, "rb").read() if os.path.exists(INDEX) else b""
            return self.send(200, data, "application/octet-stream", {"X-Version": str(ver)})
        m = re.fullmatch(r"/api/blob/([a-f0-9]{32})", p)
        if m:
            if not self.authed():
                return
            path = os.path.join(BLOBS, m.group(1))
            if not os.path.exists(path):
                return self.js(404, {"error": "not found"})
            self.headers_common(200, "application/octet-stream", os.path.getsize(path))
            with open(path, "rb") as f:
                shutil.copyfileobj(f, self.wfile, 1024 * 1024)
            return
        self.js(404, {"error": "not found"})

    def do_POST(self):
        p = self.route()
        try:
            if p == "/api/auth":
                if self.authed():
                    self.js(200, {"ok": True})
                return
            if p == "/api/inbox/upload":
                if not INBOX_TOKEN or not hmac.compare_digest(self.headers.get("X-Inbox-Token", ""), INBOX_TOKEN):
                    return self.js(401, {"error": "auth"})
                if not os.path.exists(INBOX_KEY):
                    return self.js(409, {"error": "nokey", "reply": "🔐 Abre la Bóveda Bryan una vez en el navegador para activar la bandeja de entrada y vuelve a enviármelo."})
                if len(os.listdir(INBOX)) >= 200:
                    return self.js(507, {"error": "full", "reply": "📥 La bandeja de la Bóveda está llena: ábrela para vaciarla."})
                data = self.read_body(MAX_INBOX)
                meta = {"name": unquote(self.headers.get("X-Filename", "archivo"))[:200],
                        "mime": self.headers.get("X-Mime", "application/octet-stream")[:100],
                        "caption": unquote(self.headers.get("X-Caption", ""))[:500],
                        "size": len(data), "received": int(time.time()), "source": "whatsapp"}
                blob = seal_for_inbox(data, meta)
                del data
                atomic_write(os.path.join(INBOX, os.urandom(16).hex()), blob)
                return self.js(201, {"ok": True, "reply": f"🔐 *{meta['name']}* guardado cifrado en tu Bóveda.\nAl abrirla lo verás en «Recibido por WhatsApp»."})
            if p == "/api/vault/init":
                body = json.loads(self.read_body(MAX_SMALL) or b"{}")
                slots = body.get("slots", {})
                if set(slots) != set(SLOTS) or not all(valid_slot(s) for s in slots.values()):
                    return self.js(400, {"error": "invalid"})
                with lock:
                    if os.path.exists(VAULT):
                        return self.js(409, {"error": "exists"})
                    atomic_write(VAULT, json.dumps({"v": 1, "created": int(time.time()), "slots": slots}).encode())
                return self.js(201, {"ok": True})
            self.js(404, {"error": "not found"})
        except OverflowError:
            self.js(413, {"error": "too large"})
        except (ValueError, KeyError):
            self.js(400, {"error": "bad request"})

    def do_PUT(self):
        p = self.route()
        try:
            if p == "/api/index":
                if not self.authed():
                    return
                base = int(self.headers.get("X-Base-Version", "-1"))
                data = self.read_body(MAX_SMALL)
                with lock:
                    cur = index_version()
                    if base != cur:
                        return self.js(409, {"error": "conflict", "version": cur})
                    if os.path.exists(INDEX):  # 5 copias anteriores por seguridad
                        for i in range(4, 0, -1):
                            if os.path.exists(f"{INDEX}.{i}"):
                                os.replace(f"{INDEX}.{i}", f"{INDEX}.{i + 1}")
                        shutil.copy2(INDEX, f"{INDEX}.1")
                    atomic_write(INDEX, data)
                    atomic_write(INDEX_META, json.dumps({"version": cur + 1}).encode())
                return self.js(200, {"version": cur + 1})
            m = re.fullmatch(r"/api/blob/([a-f0-9]{32})", p)
            if m:
                if not self.authed():
                    return
                n = int(self.headers.get("Content-Length") or 0)
                if n > MAX_BLOB:
                    self.close_connection = True
                    return self.js(413, {"error": "too large"})
                path = os.path.join(BLOBS, m.group(1))
                if os.path.exists(path):
                    return self.js(409, {"error": "exists"})
                tmp, left = path + ".part", n
                with open(tmp, "wb") as f:
                    while left > 0:
                        chunk = self.rfile.read(min(left, 1024 * 1024))
                        if not chunk:
                            break
                        f.write(chunk)
                        left -= len(chunk)
                if left:
                    os.remove(tmp)
                    return self.js(400, {"error": "incomplete"})
                os.replace(tmp, path)
                return self.js(201, {"ok": True})
            if p == "/api/inbox/key":
                if not self.authed():
                    return
                k = json.loads(self.read_body(4096) or b"{}").get("pub", "")
                if not (isinstance(k, str) and B64.fullmatch(k)):
                    return self.js(400, {"error": "invalid"})
                import base64
                ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), base64.b64decode(k))  # valida la clave
                atomic_write(INBOX_KEY, json.dumps({"pub": k}).encode())
                return self.js(200, {"ok": True})
            m = re.fullmatch(r"/api/vault/slot/(password|recovery)", p)
            if m:
                if not self.authed():
                    return
                slot = json.loads(self.read_body(MAX_SMALL) or b"{}")
                if not valid_slot(slot):
                    return self.js(400, {"error": "invalid"})
                with lock:
                    v = read_json(VAULT)
                    v["slots"][m.group(1)] = slot
                    atomic_write(VAULT, json.dumps(v).encode())
                return self.js(200, {"ok": True})
            self.js(404, {"error": "not found"})
        except OverflowError:
            self.js(413, {"error": "too large"})
        except (ValueError, KeyError):
            self.js(400, {"error": "bad request"})

    def do_DELETE(self):
        mi = re.fullmatch(r"/api/inbox/([a-f0-9]{32})", self.route())
        if mi:
            if not self.authed():
                return
            path = os.path.join(INBOX, mi.group(1))
            if os.path.exists(path):
                os.remove(path)
            return self.send(204)
        m = re.fullmatch(r"/api/blob/([a-f0-9]{32})", self.route())
        if not m:
            return self.js(404, {"error": "not found"})
        if not self.authed():
            return
        path = os.path.join(BLOBS, m.group(1))
        if os.path.exists(path):
            os.remove(path)
        self.send(204)


if __name__ == "__main__":
    ThreadingHTTPServer.daemon_threads = True
    print(f"Boveda escuchando en :{PORT}, datos en {DATA}", flush=True)
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
