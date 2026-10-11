"""El tiempo de hoy para el resumen de la mañana (Open-Meteo: gratis y sin clave)."""
import json
import os
import urllib.parse
import urllib.request

CITY = os.environ.get("WEATHER_CITY", "").strip()

WMO = {0: ("☀️", "despejado"), 1: ("🌤️", "casi despejado"), 2: ("⛅", "parcialmente nuboso"), 3: ("☁️", "nublado"),
       45: ("🌫️", "niebla"), 48: ("🌫️", "niebla"), 51: ("🌦️", "llovizna"), 53: ("🌦️", "llovizna"), 55: ("🌦️", "llovizna"),
       61: ("🌧️", "lluvia débil"), 63: ("🌧️", "lluvia"), 65: ("🌧️", "lluvia fuerte"), 66: ("🌧️", "lluvia helada"),
       67: ("🌧️", "lluvia helada"), 71: ("🌨️", "nieve débil"), 73: ("🌨️", "nieve"), 75: ("❄️", "nieve fuerte"),
       80: ("🌦️", "chubascos"), 81: ("🌧️", "chubascos"), 82: ("⛈️", "chubascos fuertes"), 95: ("⛈️", "tormenta"),
       96: ("⛈️", "tormenta con granizo"), 99: ("⛈️", "tormenta con granizo")}
_coords = None


def _get(url):
    with urllib.request.urlopen(url, timeout=10) as r:
        return json.load(r)


def today_line():
    """Una línea con el tiempo de hoy, o '' si no hay ciudad configurada o falla la red."""
    global _coords
    if not CITY:
        return ""
    try:
        if _coords is None:
            q = urllib.parse.urlencode({"name": CITY, "count": 1, "language": "es"})
            res = _get(f"https://geocoding-api.open-meteo.com/v1/search?{q}").get("results") or []
            if not res:
                return ""
            _coords = (res[0]["latitude"], res[0]["longitude"], res[0]["name"])
        lat, lon, name = _coords
        q = urllib.parse.urlencode({"latitude": lat, "longitude": lon, "timezone": "Europe/Madrid", "forecast_days": 1,
                                    "daily": "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max"})
        d = _get(f"https://api.open-meteo.com/v1/forecast?{q}")["daily"]
        emoji, desc = WMO.get(d["weather_code"][0], ("🌡️", ""))
        rain = d["precipitation_probability_max"][0]
        line = f"{emoji} *{name}*: {round(d['temperature_2m_min'][0])}–{round(d['temperature_2m_max'][0])} °C, {desc}"
        if rain is not None and rain >= 20:
            line += f" · ☔ {rain} % de lluvia"
        return line
    except Exception:
        return ""
