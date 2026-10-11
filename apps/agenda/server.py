#!/usr/bin/env python3
"""Agenda Bryan: calendario, agenda/deberes, por hacer e ideas.

Lo alimentan la web (tailnet) y n8n (mensajes de WhatsApp vía WAHA). La lógica de comandos vive aquí
para que la web y WhatsApp se comporten igual. n8n autentica con X-Api-Key; la web llega por
`tailscale serve`, que añade la cabecera Tailscale-User-Login.
"""
import hmac
import json
import os
import re
import sqlite3
import urllib.request
from datetime import date, datetime, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from zoneinfo import ZoneInfo

import ai
import weather
import calendar
from parse import CATEGORIES, DIAS_LARGOS, MESES, fmt_date, fmt_eur, norm, parse_command, split_commands

TZ = ZoneInfo("Europe/Madrid")
DB = os.path.join(os.environ.get("DATA_DIR", "/data"), "agenda.db")
API_KEY = os.environ["API_KEY"]
OWNER = re.sub(r"\D", "", os.environ.get("OWNER_PHONE", ""))
WAHA_URL = os.environ.get("WAHA_URL", "http://waha:3000")
WAHA_KEY = os.environ.get("WAHA_API_KEY", "")
STATIC = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")
STATIC_FILES = {"/": ("index.html", "text/html; charset=utf-8"), "/app.js": ("app.js", "text/javascript; charset=utf-8"),
                "/style.css": ("style.css", "text/css; charset=utf-8"), "/icon.svg": ("icon.svg", "image/svg+xml")}
CSP = ("default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; object-src 'none'; "
       "base-uri 'none'; form-action 'none'; frame-ancestors 'none'")
KINDS = ("event", "agenda", "todo", "idea")
FIELDS = ("kind", "title", "notes", "date", "time", "end_time", "tag", "urgent", "done")


def today():
    return datetime.now(TZ).date()


def now_iso():
    return datetime.now(TZ).strftime("%Y-%m-%d %H:%M:%S")


def db():
    c = sqlite3.connect(DB, timeout=15)
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA foreign_keys=ON")
    return c


def init_db():
    with db() as c:
        c.execute("PRAGMA journal_mode=WAL")
        c.executescript("""
        CREATE TABLE IF NOT EXISTS items(
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          kind TEXT NOT NULL CHECK(kind IN ('event','agenda','todo','idea')),
          title TEXT NOT NULL, notes TEXT NOT NULL DEFAULT '',
          date TEXT, time TEXT, end_time TEXT, tag TEXT,
          urgent INTEGER NOT NULL DEFAULT 0, done INTEGER NOT NULL DEFAULT 0, done_at TEXT,
          source TEXT NOT NULL DEFAULT 'web', gcal_id TEXT UNIQUE, synced INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS items_kind_date ON items(kind, date);
        CREATE TABLE IF NOT EXISTS log(id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL,
          direction TEXT NOT NULL, source TEXT NOT NULL, text TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS gcal_deleted(gcal_id TEXT PRIMARY KEY);
        CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT);
        CREATE TABLE IF NOT EXISTS subs(
          id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, amount INTEGER NOT NULL CHECK(amount >= 0),
          period TEXT NOT NULL DEFAULT 'mensual' CHECK(period IN ('semanal','mensual','trimestral','anual')),
          category TEXT NOT NULL DEFAULT 'Suscripciones', billing_day INTEGER, billing_month INTEGER,
          active INTEGER NOT NULL DEFAULT 1, notes TEXT NOT NULL DEFAULT '', source TEXT NOT NULL DEFAULT 'web',
          created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS expenses(
          id INTEGER PRIMARY KEY AUTOINCREMENT, amount INTEGER NOT NULL, concept TEXT NOT NULL,
          category TEXT NOT NULL DEFAULT 'Otros', date TEXT NOT NULL, notes TEXT NOT NULL DEFAULT '',
          source TEXT NOT NULL DEFAULT 'web', created_at TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS expenses_date ON expenses(date);
        """)
        if "lease_at" not in [r["name"] for r in c.execute("PRAGMA table_info(items)")]:
            c.execute("ALTER TABLE items ADD COLUMN lease_at TEXT")


def setting(key, value=None):
    with db() as c:
        if value is None:
            r = c.execute("SELECT value FROM settings WHERE key=?", (key,)).fetchone()
            return r["value"] if r else None
        c.execute("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", (key, value))


def log(direction, source, text):
    with db() as c:
        c.execute("INSERT INTO log(at,direction,source,text) VALUES(?,?,?,?)", (now_iso(), direction, source, text))
        c.execute("DELETE FROM log WHERE id NOT IN (SELECT id FROM log ORDER BY id DESC LIMIT 2000)")


def row(r):
    return {k: r[k] for k in r.keys()} if r else None


# ---------------- textos ----------------
def rel(d: date):
    n = (d - today()).days
    if n == 0:
        return "hoy"
    if n == 1:
        return "mañana"
    if n == -1:
        return "ayer"
    return f"en {n} días" if n > 0 else f"hace {-n} días"


def when(it):
    if not it["date"]:
        return "sin fecha"
    s = fmt_date(date.fromisoformat(it["date"]))
    if it["time"]:
        s += f" · {it['time']}" + (f"–{it['end_time']}" if it["end_time"] else "")
    return s


def add_reply(it):
    t, n = it["title"], it["id"]
    tag = f" · #{it['tag']}" if it.get("tag") else ""
    if it["kind"] == "event":
        d = date.fromisoformat(it["date"])
        hora = f"{it['time']}–{it['end_time']}" if it["time"] else "todo el día"
        return f"📅 *{t}*\n🗓️ {DIAS_LARGOS[d.weekday()]} {d.day} {MESES[d.month - 1]} · {hora} ({rel(d)}){tag}\n✅ Añadido al calendario"
    if it["kind"] == "agenda":
        fecha = f"{fmt_date(date.fromisoformat(it['date']), True)} ({rel(date.fromisoformat(it['date']))})" if it["date"] else "sin fecha"
        if it["time"]:
            fecha += f" · {it['time']}"
        return f"📚 *{t}*\n📆 Entrega: {fecha}{tag}\n✅ Añadido a la agenda · nº {n}"
    if it["kind"] == "todo":
        return f"{'🔥' if it['urgent'] else '☑️'} *{t}*\n✅ Añadido a Por hacer{' (urgente)' if it['urgent'] else ''} · nº {n}"
    return f"💡 *{t}*\n✅ Idea guardada{tag}"


HELP = """🤖 *Asistente de Bryan*

*C* → calendario
  C mañana dentista 12
  C martes 15 cena 21:30
  C 20/10 cumple Ana
*A* → agenda / deberes
  A 15 entrega análisis forense #forense
*P* → por hacer  (*P!* = urgente)
  P comprar cables
*I* → ideas
  I app para controlar gastos

*G* → gasto
  G 12,50 cena · G 45 gasolina ayer
*S* → gasto fijo / suscripción
  S Netflix 12,99 · S Spotify 10,99 día 15

*HOY* · *MAÑANA* · *SEMANA* · *PENDIENTES* · *AGENDA* · *IDEAS*
*GASTOS* · *FIJOS*
*HECHO 12* o *HECHO cables* → marcar como hecho
*BORRAR 12* → eliminar"""


def bullet_event(it, show_day=False):
    pre = (fmt_date(date.fromisoformat(it["date"])) + " ") if show_day else ""
    return f"• {pre}{it['time'] or 'Todo el día'} · {it['title']}"


def bullet_agenda(it):
    d = date.fromisoformat(it["date"]) if it["date"] else None
    if not d:
        return f"• {it['title']} (nº {it['id']})"
    mark = "⚠️ " if d < today() else ("❗ " if d == today() else "")
    tag = f" #{it['tag']}" if it["tag"] else ""
    return f"• {mark}{fmt_date(d)} ({rel(d)}) · {it['title']}{tag} (nº {it['id']})"


def summary(what, morning=False):
    t = today()
    with db() as c:
        ev = lambda a, b: [row(r) for r in c.execute(
            "SELECT * FROM items WHERE kind='event' AND date BETWEEN ? AND ? ORDER BY date, time IS NOT NULL, time", (a.isoformat(), b.isoformat()))]
        ag = lambda b: [row(r) for r in c.execute(
            "SELECT * FROM items WHERE kind='agenda' AND done=0 AND date IS NOT NULL AND date<=? ORDER BY date, time", (b.isoformat(),))]
        todos = [row(r) for r in c.execute("SELECT * FROM items WHERE kind='todo' AND done=0 ORDER BY urgent DESC, created_at")]
        if what in ("hoy", "manana"):
            day = t if what == "hoy" else t + timedelta(days=1)
            head = ("Buenos días, Bryan ☀️\n" if morning else "") + f"*{'Hoy' if what == 'hoy' else 'Mañana'}, {DIAS_LARGOS[day.weekday()]} {day.day} {MESES[day.month - 1]}*"
            tiempo = weather.today_line() if what == "hoy" else ""
            if tiempo:
                head += "\n" + tiempo
            if morning and day.day == 1:  # día 1: resumen del mes anterior
                prev = (day - timedelta(days=1)).strftime("%Y-%m")
                head += "\n\n" + finance_text("gastos", prev)
            events = ev(day, day)
            entregas = ag(t + timedelta(days=7)) if what == "hoy" else [a for a in ag(day) if a["date"] == day.isoformat()]
            parts = [head, "📅 *Calendario*\n" + ("\n".join(bullet_event(e) for e in events) or "Nada programado 🎉")]
            if entregas or what == "hoy":
                parts.append("📚 *Entregas*\n" + ("\n".join(bullet_agenda(a) for a in entregas) or "Ninguna esta semana 🎉"))
            if what == "hoy":
                top = todos[:8]
                parts.append(f"☑️ *Por hacer* ({len(todos)})\n" + ("\n".join(
                    f"• {'🔥 ' if x['urgent'] else ''}{x['title']} (nº {x['id']})" for x in top) or "Todo hecho 💪")
                    + ("\n…" if len(todos) > 8 else ""))
            return "\n\n".join(parts)
        if what == "semana":
            events = ev(t, t + timedelta(days=6))
            parts = ["*Próximos 7 días*", "📅 *Calendario*\n" + ("\n".join(bullet_event(e, True) for e in events) or "Nada programado 🎉"),
                     "📚 *Entregas*\n" + ("\n".join(bullet_agenda(a) for a in ag(t + timedelta(days=6))) or "Ninguna 🎉")]
            return "\n\n".join(parts)
        if what == "pendientes":
            return f"☑️ *Por hacer* ({len(todos)})\n" + ("\n".join(f"• {'🔥 ' if x['urgent'] else ''}{x['title']} (nº {x['id']})" for x in todos) or "Nada pendiente 💪")
        if what == "agenda":
            rows = [row(r) for r in c.execute("SELECT * FROM items WHERE kind='agenda' AND done=0 ORDER BY date IS NULL, date, time")]
            return "📚 *Agenda*\n" + ("\n".join(bullet_agenda(a) for a in rows) or "Nada pendiente 🎉")
        if what == "ideas":
            rows = [row(r) for r in c.execute("SELECT * FROM items WHERE kind='idea' AND done=0 ORDER BY id DESC LIMIT 10")]
            return "💡 *Últimas ideas*\n" + ("\n".join(f"• {x['title']}" for x in rows) or "Aún no hay ideas")
    return HELP


def reminders():
    """Aviso de la tarde: lo que vence o pasa mañana. Vacío si no hay nada."""
    m = (today() + timedelta(days=1)).isoformat()
    with db() as c:
        ag = [row(r) for r in c.execute("SELECT * FROM items WHERE kind='agenda' AND done=0 AND date=?", (m,))]
        ev = [row(r) for r in c.execute("SELECT * FROM items WHERE kind='event' AND date=? ORDER BY time IS NOT NULL, time", (m,))]
    with db() as c:
        cobros = [s for s in (sub_row(r) for r in c.execute("SELECT * FROM subs WHERE active=1")) if s["next_charge"] == m]
    if not ag and not ev and not cobros:
        return ""
    parts = ["⏰ *Recordatorio para mañana*"]
    if cobros:
        parts.append("💳 " + "\n💳 ".join(f"Se cobra {s['name']} ({fmt_eur(s['amount'])})" for s in cobros))
    if ev:
        parts.append("📅 " + "\n📅 ".join(f"{e['time'] or 'Todo el día'} · {e['title']}" for e in ev))
    if ag:
        parts.append("📚 Entrega: " + "\n📚 Entrega: ".join(a["title"] + (f" #{a['tag']}" if a["tag"] else "") for a in ag))
    return "\n".join(parts)


# ---------------- finanzas ----------------
PER_MONTH = {"semanal": 52 / 12, "mensual": 1, "trimestral": 1 / 3, "anual": 1 / 12}
SUB_FIELDS = ("name", "amount", "period", "category", "billing_day", "billing_month", "active", "notes")
EXP_FIELDS = ("amount", "concept", "category", "date", "notes")


def to_cents(v):
    if isinstance(v, int):
        return v
    c = round(float(str(v).replace("€", "").replace(",", ".").strip()) * 100)
    if c < 0 or c > 10_000_000:
        raise ValueError("importe")
    return c


def next_charge(sub):
    """Próxima fecha de cobro (mensual/trimestral/anual con día de cobro)."""
    d, t = sub["billing_day"], today()
    if not d:
        return None
    def clamp(y, m):
        return date(y, m, min(d, calendar.monthrange(y, m)[1]))
    if sub["period"] == "anual" and sub["billing_month"]:
        x = clamp(t.year, sub["billing_month"])
        return x if x >= t else clamp(t.year + 1, sub["billing_month"])
    if sub["period"] in ("mensual", "trimestral"):
        x = clamp(t.year, t.month)
        if x < t:
            x = clamp(t.year + (t.month == 12), t.month % 12 + 1)
        return x
    return None


def sub_row(r):
    s = row(r)
    s["monthly"] = round(s["amount"] * PER_MONTH[s["period"]])
    nc = next_charge(s)
    s["next_charge"] = nc.isoformat() if nc else None
    return s


def finance(month=None):
    month = month or today().strftime("%Y-%m")
    with db() as c:
        subs = [sub_row(r) for r in c.execute("SELECT * FROM subs ORDER BY active DESC, amount DESC")]
        exps = [row(r) for r in c.execute("SELECT * FROM expenses WHERE substr(date,1,7)=? ORDER BY date DESC, id DESC", (month,))]
        months = [r[0] for r in c.execute("SELECT DISTINCT substr(date,1,7) FROM expenses ORDER BY 1 DESC LIMIT 36")]
    fixed = sum(s["monthly"] for s in subs if s["active"])
    spent = sum(e["amount"] for e in exps)
    by_cat = {}
    for e in exps:
        by_cat[e["category"]] = by_cat.get(e["category"], 0) + e["amount"]
    return {"month": month, "subs": subs, "expenses": exps, "months": months,
            "categories": list(CATEGORIES) + ["Otros"],
            "totals": {"fixed_month": fixed, "fixed_year": fixed * 12, "spent_month": spent, "total_month": fixed + spent,
                       "by_category": dict(sorted(by_cat.items(), key=lambda kv: -kv[1])),
                       "active_subs": sum(1 for s in subs if s["active"])}}


def create_sub(d, source="web"):
    ts = now_iso()
    vals = (str(d["name"]).strip()[:120], to_cents(d["amount"]), d.get("period") or "mensual",
            (d.get("category") or "Suscripciones")[:60], d.get("billing_day") or None, d.get("billing_month") or None,
            int(d.get("active", True)), (d.get("notes") or "")[:1000], source, ts, ts)
    if not vals[0] or vals[2] not in PER_MONTH:
        raise ValueError("nombre/periodo")
    with db() as c:
        cur = c.execute("INSERT INTO subs(name,amount,period,category,billing_day,billing_month,active,notes,source,created_at,updated_at) "
                        "VALUES(?,?,?,?,?,?,?,?,?,?,?)", vals)
        return sub_row(c.execute("SELECT * FROM subs WHERE id=?", (cur.lastrowid,)).fetchone())


def create_expense(d, source="web"):
    vals = (to_cents(d["amount"]), str(d.get("concept") or "Gasto").strip()[:200], (d.get("category") or "Otros")[:60],
            d.get("date") or today().isoformat(), (d.get("notes") or "")[:1000], source, now_iso())
    date.fromisoformat(vals[3])
    with db() as c:
        cur = c.execute("INSERT INTO expenses(amount,concept,category,date,notes,source,created_at) VALUES(?,?,?,?,?,?,?)", vals)
        return row(c.execute("SELECT * FROM expenses WHERE id=?", (cur.lastrowid,)).fetchone())


def update_fin(table, item_id, fields):
    allowed = SUB_FIELDS if table == "subs" else EXP_FIELDS
    sets, vals = [], []
    for k in allowed:
        if k in fields:
            v = fields[k]
            if k == "amount":
                v = to_cents(v)
            elif k == "active":
                v = int(bool(v))
            elif k == "period" and v not in PER_MONTH:
                raise ValueError("periodo")
            elif k == "date":
                date.fromisoformat(v)
            elif k in ("billing_day", "billing_month"):
                v = int(v) if v not in (None, "") else None
            elif k in ("name", "concept"):
                v = str(v).strip()[:200]
                if not v:
                    raise ValueError(k)
            sets.append(f"{k}=?"); vals.append(v)
    if not sets:
        return None
    if table == "subs":
        sets.append("updated_at=?"); vals.append(now_iso())
    with db() as c:
        c.execute(f"UPDATE {table} SET {', '.join(sets)} WHERE id=?", (*vals, item_id))
        r = c.execute(f"SELECT * FROM {table} WHERE id=?", (item_id,)).fetchone()
        return (sub_row(r) if table == "subs" else row(r)) if r else None


def delete_fin(table, item_id):
    with db() as c:
        r = c.execute(f"SELECT * FROM {table} WHERE id=?", (item_id,)).fetchone()
        if r:
            c.execute(f"DELETE FROM {table} WHERE id=?", (item_id,))
        return row(r)


def month_name(ym):
    y, m = map(int, ym.split("-"))
    return f"{['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'][m - 1]} {y}"


def finance_text(what, month=None):
    f = finance(month)
    t = f["totals"]
    if what == "suscripciones":
        subs = [s for s in f["subs"] if s["active"]]
        lines = [f"• {s['name']} — {fmt_eur(s['amount'])}{'' if s['period'] == 'mensual' else ' (' + s['period'] + ')'}"
                 + (f" · día {s['billing_day']}" if s["billing_day"] else "") for s in subs]
        return (f"🔁 *Gastos fijos* ({len(subs)})\n" + ("\n".join(lines) or "Aún no hay ninguno. Añade uno: S Netflix 12,99")
                + f"\n\n💳 *{fmt_eur(t['fixed_month'])} al mes* · {fmt_eur(t['fixed_year'])} al año")
    cats = "\n".join(f"• {k}: {fmt_eur(v)}" for k, v in t["by_category"].items()) or "Sin gastos apuntados"
    last = "\n".join(f"• {e['date'][8:]}/{e['date'][5:7]} {e['concept']} — {fmt_eur(e['amount'])}" for e in f["expenses"][:5])
    return (f"📊 *Gastos de {month_name(f['month'])}*\n{cats}\n\n💸 Variables: *{fmt_eur(t['spent_month'])}*\n"
            f"🔁 Fijos: *{fmt_eur(t['fixed_month'])}*\n🧾 Total: *{fmt_eur(t['total_month'])}*" + (f"\n\n*Últimos*\n{last}" if last else ""))


# ---------------- operaciones ----------------
def create(it, source):
    ts = now_iso()
    with db() as c:
        cur = c.execute(
            "INSERT INTO items(kind,title,notes,date,time,end_time,tag,urgent,source,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
            (it["kind"], it["title"].strip()[:300], (it.get("notes") or "")[:5000], it.get("date"), it.get("time"),
             it.get("end_time"), it.get("tag"), int(bool(it.get("urgent"))), source, ts, ts))
        return row(c.execute("SELECT * FROM items WHERE id=?", (cur.lastrowid,)).fetchone())


def find_open(query):
    with db() as c:
        if query.lstrip("nº#").strip().isdigit():
            r = c.execute("SELECT * FROM items WHERE id=?", (int(query.lstrip("nº#").strip()),)).fetchone()
            return [row(r)] if r else []
        q = norm(query)
        rows = [row(r) for r in c.execute("SELECT * FROM items WHERE done=0 AND kind IN ('todo','agenda','idea') ORDER BY id DESC")]
        return [r for r in rows if q in norm(r["title"])]


def update(item_id, fields):
    sets, vals = [], []
    for k in FIELDS:
        if k in fields:
            v = fields[k]
            if k == "kind" and v not in KINDS:
                raise ValueError("kind")
            if k in ("urgent", "done"):
                v = int(bool(v))
            if k == "title":
                v = str(v).strip()[:300]
                if not v:
                    raise ValueError("title")
            sets.append(f"{k}=?"); vals.append(v)
    if "done" in fields:
        sets.append("done_at=?"); vals.append(now_iso() if fields["done"] else None)
    if any(k in fields for k in ("title", "date", "time", "end_time", "notes")):
        sets.append("synced=0"); sets.append("lease_at=NULL")
    if not sets:
        return None
    sets.append("updated_at=?"); vals.append(now_iso())
    with db() as c:
        c.execute(f"UPDATE items SET {', '.join(sets)} WHERE id=?", (*vals, item_id))
        return row(c.execute("SELECT * FROM items WHERE id=?", (item_id,)).fetchone())


def delete(item_id):
    with db() as c:
        r = c.execute("SELECT * FROM items WHERE id=?", (item_id,)).fetchone()
        if not r:
            return None
        if r["gcal_id"]:
            c.execute("INSERT OR IGNORE INTO gcal_deleted(gcal_id) VALUES(?)", (r["gcal_id"],))
        c.execute("DELETE FROM items WHERE id=?", (item_id,))
        return row(r)


def short_reply(it):
    """Una línea por elemento, para cuando un mensaje trae varios."""
    t, n = it["title"], it["id"]
    if it["kind"] == "event":
        d = date.fromisoformat(it["date"])
        return f"📅 {t} — {fmt_date(d)}{' · ' + it['time'] if it['time'] else ''} ({rel(d)})"
    if it["kind"] == "agenda":
        return f"📚 {t} — {fmt_date(date.fromisoformat(it['date'])) if it['date'] else 'sin fecha'} · nº {n}"
    if it["kind"] == "todo":
        return f"{'🔥' if it['urgent'] else '☑️'} {t} · nº {n}"
    return f"💡 {t}"


def run_command(p, source):
    """Ejecuta un comando ya interpretado. Devuelve (ok, respuesta, elemento creado o None)."""
    cmd = p["cmd"]
    if cmd == "add":
        it = create(p["item"], source)
        return True, add_reply(it), it
    if cmd == "expense":
        e = create_expense(p["expense"], source)
        t = finance()["totals"]
        d = date.fromisoformat(e["date"])
        return True, (f"💸 *{e['concept']}* — {fmt_eur(e['amount'])}\n🏷️ {e['category']} · {rel(d) if abs((d - today()).days) <= 1 else fmt_date(d)}\n"
                      f"📊 Este mes: {fmt_eur(t['spent_month'])} en gastos + {fmt_eur(t['fixed_month'])} fijos\n✅ Apuntado"), None
    if cmd == "sub":
        sb = create_sub(p["sub"], source)
        t = finance()["totals"]
        per = "/mes" if sb["period"] == "mensual" else f" ({sb['period']}, {fmt_eur(sb['monthly'])}/mes)"
        cobro = f" · se cobra el día {sb['billing_day']}" if sb["billing_day"] else ""
        return True, (f"🔁 *{sb['name']}* — {fmt_eur(sb['amount'])}{per}{cobro}\n"
                      f"💳 Fijos: {fmt_eur(t['fixed_month'])} al mes · {fmt_eur(t['fixed_year'])} al año ({t['active_subs']})\n✅ Gasto fijo añadido"), None
    if cmd == "summary" and p["what"] in ("gastos", "suscripciones"):
        return True, finance_text(p["what"]), None
    if cmd == "summary":
        return True, summary(p["what"]), None
    if cmd in ("done", "delete"):
        found = find_open(p["query"])
        if not found:
            return False, f"🤔 No encuentro nada pendiente con «{p['query']}».", None
        if len(found) > 1:
            return False, "Hay varias coincidencias, dime el número:\n" + "\n".join(f"• nº {f['id']} · {f['title']}" for f in found[:8]), None
        if cmd == "done":
            update(found[0]["id"], {"done": True})
            return True, f"✅ Hecho: *{found[0]['title']}* 💪", None
        delete(found[0]["id"])
        return True, f"🗑️ Eliminado: *{found[0]['title']}*", None
    if cmd == "help":
        return True, HELP, None
    if cmd == "error":
        return False, "⚠️ " + p["msg"], None
    return False, "🤔 No te he entendido. Empieza con *C*, *A*, *P* o *I*, o escribe *?* para ver ejemplos.", None


def execute(text, source, voice=False):
    log("in", source, ("🎙️ " if voice else "") + text)
    out = {"ok": True, "item": None, "calendar": None}
    if voice and not text.strip():
        out["ok"] = False
        out["reply"] = "🎙️ No he podido sacar texto de la nota de voz (ha llegado vacía o sin voz). Prueba a grabarla otra vez o escríbemelo."
        log("out", source, out["reply"])
        return out

    note = f"🎙️ «{text}»\n\n" if voice else ""
    # Un mensaje puede traer varios comandos: uno por línea (o por frase si es una nota de voz).
    parsed, guessed = [], []
    for seg in split_commands(text, voice):
        p = parse_command(seg, today())
        if p["cmd"] in ("unknown", "error") and ai.enabled():
            cmds = [(c, parse_command(c, today())) for c in ai.to_commands(seg, today())]
            cmds = [(c, q) for c, q in cmds if q["cmd"] not in ("unknown", "error", "help")]
            if cmds:
                guessed += [c for c, _ in cmds]
                parsed += [q for _, q in cmds]
                continue
        parsed.append(p)
    if guessed:
        note += "".join(f"🤖 Entendido como: {c}\n" for c in guessed) + "\n"

    results = [run_command(p, source) for p in parsed]
    items = [it for _, _, it in results if it]
    events = [it for it in items if it["kind"] == "event"]
    out["ok"] = all(ok for ok, _, _ in results)
    out["item"] = items[0] if items else None
    if events:  # n8n solo mira si hay algo para lanzar la sincronización con Google Calendar
        it = events[0]
        out["calendar"] = {"id": it["id"], "title": it["title"], "date": it["date"], "time": it["time"], "end_time": it["end_time"]}

    if len(results) == 1:
        reply = results[0][1]
    else:
        # Una línea por resultado; los errores se dejan enteros para saber qué corregir.
        lines = [short_reply(it) if it else (msg.split("\n")[0] if ok else msg) for ok, msg, it in results]
        done = sum(ok for ok, _, _ in results)
        head = f"✅ *{done} apuntados*" if done == len(results) else f"⚠️ *{done} de {len(results)} apuntados* (revisa los marcados)"
        reply = head + "\n\n" + "\n".join(lines)
    out["reply"] = note + reply
    log("out", source, out["reply"])
    return out


def waha_phone(chat_id, payload):
    """Número de teléfono del remitente (WhatsApp puede usar identificadores @lid)."""
    if chat_id.endswith("@c.us") or chat_id.endswith("@s.whatsapp.net"):
        return re.sub(r"\D", "", chat_id.split("@")[0])
    key = ((payload.get("_data") or {}).get("key") or {})
    for v in key.values():
        if isinstance(v, str) and ("@s.whatsapp.net" in v or "@c.us" in v):
            return re.sub(r"\D", "", v.split("@")[0])
    if chat_id.endswith("@lid") and WAHA_KEY:
        try:
            req = urllib.request.Request(f"{WAHA_URL}/api/default/lids/{urllib.parse.quote(chat_id)}", headers={"X-Api-Key": WAHA_KEY})
            with urllib.request.urlopen(req, timeout=10) as r:
                pn = json.load(r).get("pn") or ""
            return re.sub(r"\D", "", pn.split("@")[0])
        except Exception:
            return ""
    return ""


def whatsapp_inbound(d):
    p = d.get("payload") or {}
    if d.get("event") not in ("message", "message.any") or p.get("fromMe"):
        return {"allowed": False, "why": "ignorado"}
    chat = p.get("from") or ""
    if chat.endswith("@g.us") or chat.startswith("status@") or chat.endswith("@newsletter"):
        return {"allowed": False, "why": "grupo/estado"}
    phone = waha_phone(chat, p)
    if not OWNER or phone != OWNER:
        log("blocked", "whatsapp", f"Mensaje ignorado de {phone or chat}")
        return {"allowed": False, "why": "remitente no autorizado"}
    setting("owner_chat", chat)
    text = (p.get("body") or "").strip()
    if not text:
        msg = "📎 De momento solo entiendo mensajes de texto."
        log("out", "whatsapp", msg)
        return {"allowed": True, "chatId": chat, "reply": msg, "calendar": None}
    res = execute(text, "whatsapp")
    return {"allowed": True, "chatId": chat, "reply": res["reply"], "calendar": res["calendar"]}


def whatsapp_classify(d):
    """Comprueba que el mensaje es de Bryan y dice a n8n qué ha llegado."""
    p = d.get("payload") or {}
    if d.get("event") not in ("message", "message.any") or p.get("fromMe"):
        return {"allowed": False, "why": "ignorado"}
    chat = p.get("from") or ""
    if chat.endswith("@g.us") or chat.startswith("status@") or chat.endswith("@newsletter"):
        return {"allowed": False, "why": "grupo/estado"}
    phone = waha_phone(chat, p)
    if not OWNER or phone != OWNER:
        log("blocked", "whatsapp", f"Mensaje ignorado de {phone or chat}")
        return {"allowed": False, "why": "remitente no autorizado"}
    setting("owner_chat", chat)
    setting("whatsapp_last", now_iso())
    text = (p.get("body") or "").strip()
    out = {"allowed": True, "chatId": chat, "kind": "text", "text": text}
    if p.get("hasMedia"):
        media = p.get("media") or {}
        mime = (media.get("mimetype") or "").split(";")[0].strip()
        url = media.get("url") or ""
        if url:  # que n8n descargue siempre desde la red interna
            parts = urllib.parse.urlsplit(url)
            url = WAHA_URL + parts.path + (f"?{parts.query}" if parts.query else "")
        kind = "audio" if mime.startswith("audio/") else "image" if mime.startswith("image/") else "document"
        caption = re.sub(r"^[bB]\b[\s:.\-]*", "", text).strip()
        ext = (mime.split("/")[-1] or "bin").replace("jpeg", "jpg").replace("ogg; codecs=opus", "ogg")
        name = media.get("filename") or (re.sub(r"[\\/:*?\"<>|]", "", caption)[:80] or f"WhatsApp {now_iso()[:16].replace(':', '.')}") + ("" if media.get("filename") else f".{ext}")
        out.update(kind=kind if url and not media.get("error") else "media_error", mediaUrl=url, mimetype=mime,
                   filename=name, caption=caption)
        log("in", "whatsapp", {"audio": "🎙️ Nota de voz", "image": "📷 Foto", "document": "📄 Documento"}[kind]
            + (f": {caption}" if caption and kind != "audio" else ""))
    elif not text:
        out["kind"] = "other"
    return out


def google_sync(d):
    """n8n envía los eventos de Google en una ventana de fechas; se reflejan aquí."""
    start, end = d["from"], d["to"]
    seen = set()
    ts = now_iso()
    with db() as c:
        deleted = {r["gcal_id"] for r in c.execute("SELECT gcal_id FROM gcal_deleted")}
        for e in d.get("events", []):
            gid = e.get("gcal_id")
            if not gid or gid in deleted or not e.get("date"):
                continue
            seen.add(gid)
            vals = ((e.get("title") or "(sin título)")[:300], e["date"], e.get("time"), e.get("end_time"))
            r = c.execute("SELECT id FROM items WHERE gcal_id=?", (gid,)).fetchone()
            if r:
                c.execute("UPDATE items SET title=?, date=?, time=?, end_time=?, synced=1, updated_at=? WHERE id=?", (*vals, ts, r["id"]))
            else:
                c.execute("INSERT INTO items(kind,title,date,time,end_time,source,gcal_id,synced,created_at,updated_at) "
                          "VALUES('event',?,?,?,?,'google',?,1,?,?)", (*vals, gid, ts, ts))
        gone = [r["id"] for r in c.execute("SELECT id, gcal_id FROM items WHERE gcal_id IS NOT NULL AND date BETWEEN ? AND ?", (start, end))
                if r["gcal_id"] not in seen]
        for i in gone:
            c.execute("DELETE FROM items WHERE id=?", (i,))
    setting("google_last_sync", now_iso())
    return {"ok": True, "upserted": len(seen), "removed": len(gone)}


# ---------------- HTTP ----------------
class H(BaseHTTPRequestHandler):
    server_version = "Agenda"
    sys_version = ""
    protocol_version = "HTTP/1.1"

    def log_message(self, *a):
        pass

    def send(self, code, body=b"", ctype="application/json"):
        self.send_response(code)
        for k, v in (("Content-Type", ctype), ("Content-Length", str(len(body))), ("Cache-Control", "no-store"),
                     ("X-Content-Type-Options", "nosniff"), ("Referrer-Policy", "no-referrer"),
                     ("X-Frame-Options", "DENY"), ("Content-Security-Policy", CSP)):
            self.send_header(k, v)
        self.end_headers()
        if body and self.command != "HEAD":
            self.wfile.write(body)

    def js(self, code, obj):
        self.send(code, json.dumps(obj, ensure_ascii=False).encode())

    def body(self):
        n = int(self.headers.get("Content-Length") or 0)
        if n > 2_000_000:
            raise ValueError("too large")
        return json.loads(self.rfile.read(n) or b"{}")

    def authed(self):
        ok = hmac.compare_digest(self.headers.get("X-Api-Key", ""), API_KEY) or bool(self.headers.get("Tailscale-User-Login"))
        if not ok:
            self.js(401, {"error": "auth"})
        return ok

    def route(self):
        p, _, q = self.path.partition("?")
        return p, dict(urllib.parse.parse_qsl(q))

    def do_GET(self):
        p, q = self.route()
        if p in STATIC_FILES:
            name, ctype = STATIC_FILES[p]
            with open(os.path.join(STATIC, name), "rb") as f:
                return self.send(200, f.read(), ctype)
        fm = re.fullmatch(r"/fonts/([a-z0-9-]+\.woff2)", p)
        if fm and os.path.exists(os.path.join(STATIC, "fonts", fm.group(1))):
            with open(os.path.join(STATIC, "fonts", fm.group(1)), "rb") as f:
                body = f.read()
            self.send_response(200)
            for k, v in (("Content-Type", "font/woff2"), ("Content-Length", str(len(body))), ("Cache-Control", "public, max-age=2592000"),
                         ("Access-Control-Allow-Origin", "https://servidor.tailnet-ejemplo.ts.net")):
                self.send_header(k, v)
            self.end_headers()
            return self.wfile.write(body)
        if p == "/health":
            return self.js(200, {"ok": True})
        if not self.authed():
            return
        with db() as c:
            if p == "/api/items":
                sql, args = "SELECT * FROM items WHERE 1=1", []
                if q.get("kind") in KINDS:
                    sql += " AND kind=?"; args.append(q["kind"])
                if q.get("done") in ("0", "1"):
                    sql += " AND done=?"; args.append(int(q["done"]))
                if q.get("from"):
                    sql += " AND date>=?"; args.append(q["from"])
                if q.get("to"):
                    sql += " AND date<=?"; args.append(q["to"])
                sql += " ORDER BY date IS NULL, date, time IS NOT NULL, time, urgent DESC, id DESC LIMIT 2000"
                return self.js(200, [row(r) for r in c.execute(sql, args)])
            if p == "/api/log":
                lim = min(int(q.get("limit", 150)), 500)
                return self.js(200, [row(r) for r in c.execute("SELECT * FROM log ORDER BY id DESC LIMIT ?", (lim,))][::-1])
            if p == "/api/summary":
                return self.js(200, {"text": summary(q.get("what", "hoy"), q.get("morning") == "1")})
            if p == "/api/reminders":
                return self.js(200, {"text": reminders()})
            if p == "/api/status":
                return self.js(200, {"today": today().isoformat(), "owner": bool(OWNER),
                                     "whatsapp_last": setting("whatsapp_last"), "google_last_sync": setting("google_last_sync"),
                                     "ai": ai.enabled(), "weather": weather.CITY,
                                     "user": self.headers.get("Tailscale-User-Name") or ""})
            if p == "/api/finance":
                return self.js(200, finance(q.get("month") if re.fullmatch(r"\d{4}-\d{2}", q.get("month", "")) else None))
            if p == "/api/sync/pending":
                # Reserva los eventos 5 min para que dos sincronizaciones simultaneas no los creen dos veces
                ts = now_iso()
                old_lease = (datetime.now(TZ) - timedelta(minutes=5)).strftime("%Y-%m-%d %H:%M:%S")
                rows = [row(r) for r in c.execute(
                    "SELECT id,title,notes,date,time,end_time,gcal_id FROM items WHERE kind='event' AND synced=0 AND date>=? "
                    "AND (lease_at IS NULL OR lease_at<?)", ((today() - timedelta(days=1)).isoformat(), old_lease))]
                c.executemany("UPDATE items SET lease_at=? WHERE id=?", [(ts, r["id"]) for r in rows])
                return self.js(200, rows)
            if p == "/api/sync/deleted":
                return self.js(200, [{"gcal_id": r["gcal_id"]} for r in c.execute("SELECT gcal_id FROM gcal_deleted")])
        self.js(404, {"error": "not found"})

    def do_POST(self):
        p, _ = self.route()
        if not self.authed():
            return
        try:
            d = self.body()
            if p == "/api/command":
                return self.js(200, execute(str(d.get("text", ""))[:2000], d.get("source", "web"), bool(d.get("voice"))))
            if p == "/api/whatsapp/auth":
                return self.js(200, whatsapp_classify(d))
            if p == "/api/parse":
                return self.js(200, parse_command(str(d.get("text", "")), today()))
            if p == "/api/subs":
                return self.js(201, create_sub(d))
            if p == "/api/expenses":
                return self.js(201, create_expense(d))
            if p == "/api/items":
                if d.get("kind") not in KINDS or not str(d.get("title", "")).strip():
                    return self.js(400, {"error": "kind/title"})
                return self.js(201, create(d, "web"))
            if p == "/api/whatsapp":
                res = whatsapp_inbound(d)
                if res.get("allowed"):
                    setting("whatsapp_last", now_iso())
                return self.js(200, res)
            if p == "/api/whatsapp/out":  # n8n registra mensajes que envía por su cuenta (resúmenes)
                log("out", "whatsapp", str(d.get("text", ""))[:4000])
                return self.js(200, {"ok": True})
            if p == "/api/sync/mark":
                with db() as c:
                    gid = d.get("gcal_id") or None
                    c.execute("UPDATE items SET gcal_id=?, synced=?, lease_at=NULL WHERE id=?", (gid, 1 if gid else 0, int(d["id"])))
                return self.js(200, {"ok": True})
            if p == "/api/sync/deleted/ack":
                with db() as c:
                    c.execute("DELETE FROM gcal_deleted WHERE gcal_id=?", (d["gcal_id"],))
                return self.js(200, {"ok": True})
            if p == "/api/sync/google":
                return self.js(200, google_sync(d))
            self.js(404, {"error": "not found"})
        except (ValueError, KeyError, TypeError) as e:
            self.js(400, {"error": str(e)})

    def do_PATCH(self):
        f = re.fullmatch(r"/api/(subs|expenses)/(\d+)", self.route()[0])
        if f:
            if not self.authed():
                return
            try:
                r = update_fin(f.group(1), int(f.group(2)), self.body())
                return self.js(200, r) if r else self.js(404, {"error": "not found"})
            except (ValueError, TypeError) as e:
                return self.js(400, {"error": str(e)})
        m = re.fullmatch(r"/api/items/(\d+)", self.route()[0])
        if not m:
            return self.js(404, {"error": "not found"})
        if not self.authed():
            return
        try:
            r = update(int(m.group(1)), self.body())
            return self.js(200, r) if r else self.js(404, {"error": "not found"})
        except (ValueError, TypeError) as e:
            self.js(400, {"error": str(e)})

    def do_DELETE(self):
        f = re.fullmatch(r"/api/(subs|expenses)/(\d+)", self.route()[0])
        if f:
            if not self.authed():
                return
            r = delete_fin(f.group(1), int(f.group(2)))
            return self.js(200 if r else 404, r or {"error": "not found"})
        m = re.fullmatch(r"/api/items/(\d+)", self.route()[0])
        if not m:
            return self.js(404, {"error": "not found"})
        if not self.authed():
            return
        r = delete(int(m.group(1)))
        self.js(200 if r else 404, r or {"error": "not found"})


import urllib.parse  # noqa: E402  (usado en route y waha_phone)

if __name__ == "__main__":
    init_db()
    ThreadingHTTPServer.daemon_threads = True
    print("Agenda escuchando en :8080", flush=True)
    ThreadingHTTPServer(("0.0.0.0", 8080), H).serve_forever()
