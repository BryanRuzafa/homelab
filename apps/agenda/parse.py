"""Intérprete de mensajes de Agenda Bryan.

Prefijos:  C = calendario · A = agenda/deberes · P = por hacer (P! urgente) · I = ideas
Fechas en español: hoy, mañana, pasado mañana, lunes…domingo, 15, el 15, día 15, 15/10,
15 de octubre, en 3 días. Horas: 12, a las 12, 12:30, 12h, 5pm, 5 de la tarde, 10-12, de 10 a 12.
"""
import calendar
import re
import unicodedata
from datetime import date, timedelta

WEEKDAYS = {"lunes": 0, "martes": 1, "miercoles": 2, "jueves": 3, "viernes": 4, "sabado": 5, "domingo": 6}
MONTHS = {"enero": 1, "febrero": 2, "marzo": 3, "abril": 4, "mayo": 5, "junio": 6, "julio": 7, "agosto": 8,
          "septiembre": 9, "setiembre": 9, "octubre": 10, "noviembre": 11, "diciembre": 12,
          "ene": 1, "feb": 2, "mar": 3, "abr": 4, "may": 5, "jun": 6, "jul": 7, "ago": 8, "sep": 9, "sept": 9,
          "oct": 10, "nov": 11, "dic": 12}
FILLERS = {"el", "la", "las", "los", "a", "al", "de", "del", "dia", "para", "sobre", "este", "esta", "proximo",
           "proxima", "que", "viene", "en", "por", "hasta", "antes"}
PERIODS = {"manana": 0, "tarde": 12, "noche": 12, "mediodia": 0}
DIAS = ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"]
DIAS_LARGOS = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"]
MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"]

NUMWORDS = {"una": 1, "uno": 1, "dos": 2, "tres": 3, "cuatro": 4, "cinco": 5, "seis": 6, "siete": 7, "ocho": 8, "nueve": 9,
            "diez": 10, "once": 11, "doce": 12, "trece": 13, "catorce": 14, "quince": 15, "dieciseis": 16,
            "diecisiete": 17, "dieciocho": 18, "diecinueve": 19, "veinte": 20, "veintiuno": 21, "veintiuna": 21,
            "veintidos": 22, "veintitres": 23, "veinticuatro": 24, "veinticinco": 25, "veintiseis": 26,
            "veintisiete": 27, "veintiocho": 28, "veintinueve": 29, "treinta": 30}
# Prefijos hablados (notas de voz o mensajes sin letra): palabra -> (letra, ¿se conserva la palabra en el título?)
SPOKEN = {"calendario": ("c", False), "evento": ("c", False), "cita": ("c", True), "agenda": ("a", False),
          "deberes": ("a", False), "deber": ("a", False), "entrega": ("a", True), "tarea": ("p", False),
          "tareas": ("p", False), "pendiente": ("p", False), "recuerdame": ("p", False), "recordar": ("p", False),
          "apunta": ("p", False), "idea": ("i", False), "gasto": ("g", False), "gastos": ("g", False),
          "suscripcion": ("s", False), "subscripcion": ("s", False), "fijo": ("s", False)}

TIME_RE = re.compile(r"^(\d{1,2})(?::|\.|h)(\d{2})?h?$|^(\d{1,2})(am|pm)$")
RANGE_RE = re.compile(r"^(\d{1,2})(?:[:.h](\d{2}))?h?-(\d{1,2})(?:[:.h](\d{2}))?h?$")
DATE_RE = re.compile(r"^(\d{1,2})[/.\-](\d{1,2})(?:[/.\-](\d{2,4}))?$")


def norm(s: str) -> str:
    s = unicodedata.normalize("NFKD", s.lower())
    return "".join(c for c in s if not unicodedata.combining(c))


def fmt_date(d: date, long=False) -> str:
    if long:
        return f"{DIAS_LARGOS[d.weekday()]} {d.day} de {MESES[d.month - 1]}"
    return f"{DIAS[d.weekday()]} {d.day} {MESES[d.month - 1]}"


def _hm(h, m=0):
    h, m = int(h), int(m or 0)
    return f"{h:02d}:{m:02d}" if 0 <= h <= 23 and 0 <= m <= 59 else None


def _add_hour(t: str, hours=1) -> str:
    h, m = map(int, t.split(":"))
    return f"{min(h + hours, 23):02d}:{m:02d}"


def _next_day_number(today: date, day: int, weekday=None):
    """Próxima fecha con ese número de día (y ese día de la semana si se indica)."""
    y, m = today.year, today.month
    for _ in range(14):
        if day <= calendar.monthrange(y, m)[1]:
            d = date(y, m, day)
            if d >= today and (weekday is None or d.weekday() == weekday):
                return d
        m += 1
        if m > 12:
            y, m = y + 1, 1
    return None


def parse_when(text: str, today: date, bare_time=True):
    """Devuelve (fecha, hora_inicio, hora_fin, palabras_restantes)."""
    raw = [t for t in text.split() if t]
    toks = [norm(t).strip(",;:¿?¡!().") for t in raw]
    used = [False] * len(toks)
    n = len(toks)
    # "a las doce", "el quince", "quince de octubre" -> cifras
    for i in range(n):
        if toks[i] in NUMWORDS and ((i > 0 and toks[i - 1] in ("las", "la", "el", "dia", "sobre"))
                                    or (i + 2 < n and toks[i + 1] == "de" and toks[i + 2] in MONTHS)):
            toks[i] = str(NUMWORDS[toks[i]])
    d = start = end = None
    weekday = None
    day_num = None

    def use(*idx):
        for i in idx:
            used[i] = True

    # Calificadores "de la tarde", "por la mañana", "de la noche"
    period = None
    for i in range(n - 2):
        if toks[i] in ("de", "por") and toks[i + 1] == "la" and toks[i + 2] in PERIODS:
            period = toks[i + 2]
            use(i, i + 1, i + 2)
    for i in range(n):
        if toks[i] == "mediodia" and not used[i]:
            period = "mediodia"; use(i)

    # Rangos "de 10 a 12" / "10-12" / "10:30-12"
    for i in range(n - 3):
        if any(used[i:i + 4]):
            continue
        if toks[i] == "de" and toks[i + 2] == "a":
            a, b = _time_token(toks[i + 1], True), _time_token(toks[i + 3], True)
            if a and b:
                start, end = a, b; use(i, i + 1, i + 2, i + 3)
                break
    if not start:
        for i in range(n):
            mm = RANGE_RE.match(toks[i])
            if mm and not used[i]:
                a, b = _hm(mm.group(1), mm.group(2)), _hm(mm.group(3), mm.group(4))
                if a and b:
                    start, end = a, b; use(i)
                    break

    # Relativos
    for i in range(n):
        if used[i]:
            continue
        t = toks[i]
        if t == "pasado" and i + 1 < n and toks[i + 1] == "manana":
            d = today + timedelta(days=2); use(i, i + 1); break
        if t == "hoy":
            d = today; use(i); break
        if t == "ayer":
            d = today - timedelta(days=1); use(i); break
        if t == "manana":
            d = today + timedelta(days=1); use(i); break
        if t in ("en", "dentro") and i + 2 < n:
            j = i + 1
            if toks[j] == "de" and j + 2 < n:
                j += 1
            num = {"un": 1, "una": 1, "dos": 2, "tres": 3}.get(toks[j], toks[j])
            if str(num).isdigit() and toks[j + 1] in ("dia", "dias", "semana", "semanas"):
                k = int(num) * (7 if toks[j + 1].startswith("semana") else 1)
                d = today + timedelta(days=k); use(*range(i, j + 2)); break

    # Fecha explícita 15/10, 15-10-2026
    if not d:
        for i in range(n):
            mm = DATE_RE.match(toks[i])
            if mm and not used[i] and 1 <= int(mm.group(2)) <= 12:
                dd, mo = int(mm.group(1)), int(mm.group(2))
                y = int(mm.group(3)) if mm.group(3) else today.year
                y = y + 2000 if y < 100 else y
                try:
                    d = date(y, mo, dd)
                except ValueError:
                    continue
                if not mm.group(3) and d < today:
                    d = date(y + 1, mo, dd)
                use(i); break

    # "15 de octubre" / "15 oct"
    if not d:
        for i in range(n - 1):
            if used[i] or not toks[i].isdigit():
                continue
            j = i + 1
            if toks[j] == "de" and j + 1 < n:
                j += 1
            if toks[j] in MONTHS:
                try:
                    d = date(today.year, MONTHS[toks[j]], int(toks[i]))
                except ValueError:
                    continue
                if d < today:
                    d = date(today.year + 1, d.month, d.day)
                use(*range(i, j + 1)); break

    # Día de la semana
    for i in range(n):
        if not used[i] and toks[i] in WEEKDAYS:
            weekday = WEEKDAYS[toks[i]]; use(i)
            if i + 1 < n and toks[i + 1].isdigit() and not used[i + 1] and int(toks[i + 1]) <= 31:
                day_num = int(toks[i + 1]); use(i + 1)
            break

    # Horas explícitas: 12:30, 12h, 5pm, "a las 12"
    if not start:
        for i in range(n):
            if used[i]:
                continue
            if toks[i] in ("las", "la") and i > 0 and toks[i - 1] in ("a", "sobre", "hacia") and i + 1 < n:
                tt = _time_token(toks[i + 1], True)
                if tt:
                    start = tt; use(i - 1, i, i + 1)
                    if i + 3 < n and toks[i + 2] in ("y", "menos") and toks[i + 3] in ("media", "cuarto"):
                        mins = {"media": 30, "cuarto": 15}[toks[i + 3]]
                        h, m = int(start[:2]), int(start[3:])
                        total = h * 60 + m + (mins if toks[i + 2] == "y" else -mins)
                        start = _hm(total // 60 % 24, total % 60); use(i + 2, i + 3)
                    break
            tt = _time_token(toks[i], False)
            if tt:
                start = tt; use(i); break

    # Número de día suelto: tras "el"/"dia", o como primera palabra
    if not d and day_num is None:
        for i in range(n):
            if used[i] or not toks[i].isdigit() or not 1 <= int(toks[i]) <= 31:
                continue
            if (i > 0 and toks[i - 1] in ("el", "dia")) or i == 0:
                day_num = int(toks[i]); use(i)
                if i > 0 and toks[i - 1] in ("el", "dia"):
                    use(i - 1)
                break

    # Hora como número suelto al final ("dentista 12")
    if bare_time and not start:
        last = max((i for i in range(n) if not used[i]), default=None)
        if last is not None and toks[last].isdigit() and int(toks[last]) <= 23 and last > 0:
            start = _hm(toks[last]); use(last)

    if not d:
        if day_num is not None:
            d = _next_day_number(today, day_num, weekday)
        elif weekday is not None:
            delta = (weekday - today.weekday()) % 7 or 7
            d = today + timedelta(days=delta)

    if start and period:
        h = int(start[:2])
        if period in ("tarde", "noche") and h < 12:
            start = _hm(h + 12, start[3:])
            if end and int(end[:2]) < 12:
                end = _hm(int(end[:2]) + 12, end[3:])
    elif period == "mediodia" and not start:
        start = "14:00"

    rest = _clean([raw[i] for i in range(n) if not used[i]])
    return d, start, end, rest


def _time_token(t, loose):
    mm = TIME_RE.match(t)
    if mm:
        if mm.group(4):
            h = int(mm.group(3)) % 12 + (12 if mm.group(4) == "pm" else 0)
            return _hm(h)
        return _hm(mm.group(1), mm.group(2))
    if loose and t.isdigit() and int(t) <= 23:
        return _hm(t)
    return None


def _clean(words):
    words = [w for w in words if w.strip(",;:")]
    while words and norm(words[0]).strip(",;:") in FILLERS:
        words.pop(0)
    while words and norm(words[-1]).strip(",;:") in FILLERS:
        words.pop()
    return [w.strip(",;") for w in words]


QUERY_WORDS = {"hoy", "manana", "semana", "pendientes", "lista", "ideas", "agenda", "resumen", "gastos", "suscripciones",
               "subscripciones", "fijos", "?", "ayuda"}
ACTION_WORDS = {"hecho", "hecha", "ok", "listo", "borrar", "eliminar", "quitar"}
LETTER_RE = re.compile(r"^[caipgs]!?(?:\s|[:.\-]\s*\S)", re.I)
POR_HACER_RE = re.compile(r"^por hacer[\s,.:;-]+", re.I)


def starts_command(seg: str, voice=False) -> bool:
    """¿Este trozo empieza un comando nuevo?

    Por escrito: letra C/A/P/I/G/S, palabra clave (tarea, idea, gasto…), consulta (HOY…) o HECHO/BORRAR.
    En notas de voz solo cuentan las palabras clave: una "a" o una "i" sueltas son palabras normales.
    """
    s = seg.strip()
    if not s:
        return False
    words = s.split()
    first = norm(words[0]).strip(".,:;")
    if first in SPOKEN or POR_HACER_RE.match(norm(s)):
        return True
    if voice:
        return False
    return (bool(LETTER_RE.match(s)) or (first in QUERY_WORDS and len(words) == 1)
            or (first in ACTION_WORDS and len(words) > 1))


def split_commands(text: str, voice=False):
    """Separa un mensaje con varios comandos, uno por línea (o por frase en notas de voz).

    Un trozo que no empieza por comando se une al anterior, así "P comprar pan, leche" o una
    nota en la línea siguiente no se pierden ni se convierten en un comando aparte.
    """
    sep = r"(\n+|[.;,]\s+)" if voice else r"(\n+)"
    pieces = re.split(sep, text.strip())
    groups = []
    for i in range(0, len(pieces), 2):
        seg = pieces[i].strip()
        if not seg:
            continue
        if groups and not starts_command(seg, voice):
            joiner = pieces[i - 1].strip() if i > 0 and not pieces[i - 1].startswith("\n") else ""
            groups[-1] = f"{groups[-1]}{joiner} {seg}"
        else:
            groups.append(seg)
    return groups or [text.strip()]


def parse_command(text: str, today: date):
    """Clasifica el mensaje. Devuelve dict con 'cmd' y los datos."""
    s = text.strip()
    if not s:
        return {"cmd": "help"}
    first, _, rest = s.partition(" ")
    f = norm(first).strip(".:")

    if f in ("?", "ayuda", "help", "comandos"):
        return {"cmd": "help"}
    if f in ("hoy", "manana", "semana", "pendientes", "lista", "ideas", "agenda", "resumen") and not rest:
        return {"cmd": "summary", "what": {"lista": "pendientes", "resumen": "hoy"}.get(f, f)}
    if f in ("hecho", "hecha", "ok", "✓", "✅", "listo", "lista") and rest:
        return {"cmd": "done", "query": rest.strip()}
    if f in ("borrar", "eliminar", "quitar") and rest:
        return {"cmd": "delete", "query": rest.strip()}

    s = s.rstrip(".")
    if f in ("gastos", "suscripciones", "subscripciones", "fijos") and not rest:
        return {"cmd": "summary", "what": "gastos" if f == "gastos" else "suscripciones"}
    if f.strip(",.:") in SPOKEN and rest.strip():
        letter, keep = SPOKEN[f.strip(",.:")]
        body = s if keep else rest.strip(" ,.:")
        if letter == "p" and norm(body).startswith("urgente"):
            letter, body = "p!", body[7:].strip(" ,.:")
        s = f"{letter} {body}"
    elif POR_HACER_RE.match(norm(s)) and len(s) > 10:
        s = "p " + s[POR_HACER_RE.match(norm(s)).end():]
    fm = re.match(r"^([gs])\s*[:.\-]?\s+(.+)$", s, re.I | re.S)
    if fm:
        return parse_finance(fm.group(1).lower(), fm.group(2).strip(), today)
    m = re.match(r"^([caip])(!?)\s*[:.\-]?\s+(.+)$", s, re.I | re.S) or re.match(r"^([caip])(!)(.+)$", s, re.I | re.S)
    if not m:
        return {"cmd": "unknown"}
    kind = {"c": "event", "a": "agenda", "p": "todo", "i": "idea"}[m.group(1).lower()]
    urgent = bool(m.group(2))
    body = m.group(3).strip()
    tags = [t[1:] for t in re.findall(r"#[\wáéíóúñü\-]+", body, re.I)]
    body = re.sub(r"#[\wáéíóúñü\-]+", "", body, flags=re.I).strip()
    if "!" in body.split()[:1]:
        urgent = True
        body = body.replace("!", "", 1).strip()

    item = {"kind": kind, "urgent": urgent, "tag": tags[0].lower() if tags else None,
            "date": None, "time": None, "end_time": None}
    if kind in ("event", "agenda"):
        d, start, end, words = parse_when(body, today, bare_time=(kind == "event"))
        if kind == "agenda" and len(words) > 1 and norm(words[0]).strip(":") in ("deberes", "deber", "tarea", "tareas", "entrega:"):
            words = words[1:]
        item.update(date=d.isoformat() if d else None, time=start,
                    end_time=end or (_add_hour(start) if (start and kind == "event") else None))
        title = " ".join(words)
    else:
        title = body
    title = re.sub(r"\s+", " ", title).strip(" :-,")
    if not title:
        return {"cmd": "error", "msg": "Falta el texto. Ejemplo: P comprar cables"}
    item["title"] = title[0].upper() + title[1:]
    if kind == "event" and not item["date"]:
        return {"cmd": "error", "msg": "No he entendido la fecha. Ejemplos: C mañana dentista 12 · C martes 15 cena 21:30 · C 20/10 cumple Ana"}
    return {"cmd": "add", "item": item}


# ---------------- finanzas ----------------
PERIODS_FIN = {"mensual": "mensual", "al mes": "mensual", "mes": "mensual", "anual": "anual", "al ano": "anual",
               "ano": "anual", "trimestral": "trimestral", "semanal": "semanal", "a la semana": "semanal"}
CATEGORIES = {
    "Comida y bebida": ["cena", "comida", "almuerzo", "desayuno", "merienda", "restaurante", "bar", "cafe", "menu", "pizza",
                        "burger", "hamburguesa", "kebab", "glovo", "just eat", "uber eats", "cerveza", "copas", "tapas", "sushi"],
    "Supermercado": ["super", "supermercado", "mercadona", "lidl", "carrefour", "aldi", "bonpreu", "bon preu", "consum",
                     "caprabo", "compra", "eroski", "alcampo"],
    "Transporte": ["gasolina", "gasoil", "diesel", "parking", "aparcamiento", "peaje", "tren", "renfe", "rodalies", "bus",
                   "autobus", "metro", "taxi", "uber", "cabify", "bolt", "itv", "taller", "coche", "moto"],
    "Ocio": ["cine", "concierto", "entradas", "fiesta", "discoteca", "juego", "steam", "playstation", "xbox", "nintendo", "viaje"],
    "Compras": ["amazon", "ropa", "zapatillas", "aliexpress", "shein", "zara", "regalo", "ikea", "decathlon"],
    "Salud": ["farmacia", "medico", "dentista", "gimnasio", "gym", "fisio", "optica"],
    "Hogar": ["luz", "agua", "gas", "alquiler", "internet", "fibra", "movil", "factura", "comunidad", "seguro"],
    "Estudios": ["libro", "libros", "universidad", "matricula", "curso", "apuntes", "uni", "fotocopias"],
    "Tecnología": ["cable", "cables", "raton", "teclado", "hdmi", "ssd", "pc", "ordenador", "portatil", "servidor", "hetzner", "dominio"],
}
MONEY_RE = re.compile(r"^(\d{1,6}(?:[.,]\d{1,2})?)(€|e|eur|euros?)?$", re.I)


def _cap(t):
    """Primera letra en mayúscula sin estropear marcas como iCloud o eBay."""
    return t if len(t) > 1 and t[0].islower() and t[1].isupper() else t[0].upper() + t[1:]


def guess_category(text):
    t = " " + norm(text) + " "
    for cat, words in CATEGORIES.items():
        if any(f" {w} " in t for w in words):
            return cat
    return "Otros"


def fmt_eur(cents):
    s = f"{abs(cents) / 100:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
    return ("-" if cents < 0 else "") + s + " €"


def parse_finance(letter, body, today):
    tags = re.findall(r"#([\wáéíóúñü\-]+)", body, re.I)
    body = re.sub(r"#[\wáéíóúñü\-]+", "", body, flags=re.I).strip()
    words = body.split()
    nw = [norm(w).strip(",;:.()") for w in words]
    used = [False] * len(words)
    # importe: preferir el que lleva € o decimales; si no, el primer número
    cand = [i for i, w in enumerate(nw) if MONEY_RE.match(w)]
    marked = [i for i in cand if re.search(r"[.,]\d|€|eur", nw[i]) or (i + 1 < len(nw) and nw[i + 1] in ("€", "e", "eur", "euro", "euros"))]
    if letter == "s":  # en suscripciones, "dia 15" es el dia de cobro, no el precio
        for i in range(len(nw) - 1):
            if nw[i] in ("dia", "el") and nw[i + 1].isdigit() and i + 1 in cand and not (i + 1 in marked):
                cand.remove(i + 1)
    pick = (marked or cand or [None])[0]
    if pick is None:
        return {"cmd": "error", "msg": "Falta el importe. Ejemplos: G 12,50 cena · S Netflix 12,99"}
    cents = round(float(MONEY_RE.match(nw[pick]).group(1).replace(",", ".")) * 100)
    used[pick] = True
    if pick + 1 < len(nw) and nw[pick + 1] in ("€", "e", "eur", "euro", "euros"):
        used[pick + 1] = True
    if letter == "s":
        period, day, month = "mensual", None, None
        for i, w in enumerate(nw):
            if used[i]:
                continue
            two = f"{w} {nw[i + 1]}" if i + 1 < len(nw) else ""
            if two in PERIODS_FIN and not used[i + 1]:
                period = PERIODS_FIN[two]; used[i] = used[i + 1] = True
            elif w in PERIODS_FIN and w not in ("mes", "ano"):
                period = PERIODS_FIN[w]; used[i] = True
            elif w in ("dia", "el") and i + 1 < len(nw) and nw[i + 1].isdigit() and 1 <= int(nw[i + 1]) <= 31:
                day = int(nw[i + 1]); used[i] = used[i + 1] = True
                if i + 3 < len(nw) and nw[i + 2] == "de" and nw[i + 3] in MONTHS:
                    month = MONTHS[nw[i + 3]]; used[i + 2] = used[i + 3] = True
            elif w in ("al", "cada", "se", "cobra", "cobran") and not used[i]:
                used[i] = True
        name = " ".join(_clean([w for i, w in enumerate(words) if not used[i]])).strip(" ,.-")
        if not name:
            return {"cmd": "error", "msg": "Falta el nombre. Ejemplo: S Spotify 10,99"}
        return {"cmd": "sub", "sub": {"name": _cap(name), "amount": cents, "period": period,
                                       "category": tags[0].capitalize() if tags else "Suscripciones",
                                       "billing_day": day, "billing_month": month}}
    rest = " ".join(w for i, w in enumerate(words) if not used[i])
    d, _, _, rw = parse_when(rest, today, bare_time=False)
    if d and d > today:  # un gasto ya ha ocurrido: "el viernes" = el pasado, "5/10" = este año
        d = d - timedelta(days=7) if (d - today).days <= 7 else d.replace(year=d.year - 1)
    concept = " ".join(rw).strip(" ,.-") or "Gasto"
    concept = re.sub(r"^(en|de|por|para)\s+", "", concept, flags=re.I)
    return {"cmd": "expense", "expense": {"amount": cents, "concept": _cap(concept),
                                           "category": tags[0].capitalize() if tags else guess_category(concept),
                                           "date": (d or today).isoformat()}}
