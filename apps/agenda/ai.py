"""Traduce frases libres a comandos de la Agenda con Claude.

Solo se usa cuando el intérprete propio (parse.py) no entiende el mensaje, y solo si hay
ANTHROPIC_API_KEY. Claude devuelve un comando normal ("C 15/10 12:00 Dentista") que después
interpreta parse.py, así las fechas siempre se calculan igual.
"""
import json
import os
from datetime import date

import anthropic

from parse import DIAS_LARGOS

MODEL = os.environ.get("ASSISTANT_MODEL", "claude-opus-5-5")

SYSTEM = """Eres el intérprete del asistente personal de Bryan, un estudiante en España. Recibes un mensaje suyo en español (escrito, o transcrito de una nota de voz, con posibles errores de transcripción) y lo conviertes en los comandos para su agenda, uno por cada cosa que quiera guardar (un mensaje puede traer varias: "tengo que comprar cables y el martes cena a las 9" son dos), con este formato exacto:

C dd/mm/aaaa [HH:MM[-HH:MM]] Título   → evento de calendario: citas, reuniones, quedadas, cumpleaños, viajes
A [dd/mm/aaaa] [HH:MM] Título [#asignatura]   → entrega, examen, deberes o trabajo de clase (sin fecha si no la menciona)
P Título   o   P! Título   → tarea por hacer (P! si dice que es urgente o importante)
I Texto   → idea o algo que se le ha ocurrido
G importe concepto [dd/mm/aaaa] [#categoría]   → un gasto que ha hecho ("me he gastado 12 € en la cena" → G 12 cena); importe con coma decimal
S nombre importe [mensual|anual|trimestral|semanal] [día N]   → gasto fijo o suscripción (Netflix, gimnasio, alquiler, móvil…)

Calcula las fechas a partir de la fecha de hoy que se te indica ("el martes" es el próximo martes; pero en un gasto, que ya ha ocurrido, es el martes pasado). Horas en formato 24 h ("las 5 de la tarde" → 17:00). El título va breve y en español, sin repetir la fecha ni la hora. No inventes ni juntes cosas: cada comando es una de las que ha dicho, en el mismo orden. Si el mensaje no es una petición para guardar algo (un saludo, una pregunta, algo sin sentido), devuelve la lista vacía."""

SCHEMA = {
    "type": "object",
    "properties": {"commands": {"type": "array", "items": {"type": "string"},
                                "description": "Un comando por cada cosa a guardar, o lista vacía si no aplica"}},
    "required": ["commands"],
    "additionalProperties": False,
}

_client = None


def enabled() -> bool:
    return bool(os.environ.get("ANTHROPIC_API_KEY"))


def to_commands(text: str, today: date) -> list[str]:
    """Devuelve los comandos propuestos por Claude, o [] si no hay IA, falla o no aplica."""
    global _client
    if not enabled():
        return []
    if _client is None:
        _client = anthropic.Anthropic(timeout=60.0, max_retries=2)
    hoy = f"{DIAS_LARGOS[today.weekday()]} {today.strftime('%d/%m/%Y')}"
    try:
        response = _client.beta.messages.create(
            model=MODEL,
            max_tokens=4000,
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
            output_config={"effort": "low", "format": {"type": "json_schema", "schema": SCHEMA}},
            system=SYSTEM,
            messages=[{"role": "user", "content": f"Hoy es {hoy}.\nMensaje de Bryan: {text}"}],
        )
    except anthropic.AuthenticationError:
        print("IA: la ANTHROPIC_API_KEY no es válida", flush=True)
        return []
    except anthropic.RateLimitError:
        print("IA: límite de uso alcanzado", flush=True)
        return []
    except anthropic.APIStatusError as e:
        print(f"IA: error de la API ({e.status_code}): {e.message}", flush=True)
        return []
    except anthropic.APIConnectionError:
        print("IA: sin conexión con la API", flush=True)
        return []
    if response.stop_reason in ("refusal", "max_tokens"):
        print(f"IA: respuesta descartada ({response.stop_reason})", flush=True)
        return []
    raw = next((b.text for b in response.content if b.type == "text"), "")
    try:
        commands = json.loads(raw).get("commands", [])
    except ValueError:
        return []
    return [c.strip() for c in commands if isinstance(c, str) and c.strip()][:20]
