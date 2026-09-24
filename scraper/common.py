import json
import logging
import re
import time
from dataclasses import dataclass, field, asdict

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

log = logging.getLogger("scraper")

UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36"


def session() -> requests.Session:
    s = requests.Session()
    s.headers.update({"User-Agent": UA, "Accept-Language": "es-ES,es;q=0.9,en;q=0.7"})
    retry = Retry(total=4, backoff_factor=1.5, status_forcelist=(429, 500, 502, 503, 504), allowed_methods=None)
    s.mount("https://", HTTPAdapter(max_retries=retry))
    s.mount("http://", HTTPAdapter(max_retries=retry))
    return s


class Polite:
    """Espera mínima entre peticiones al mismo host."""

    def __init__(self, delay=0.4):
        self.delay, self.last = delay, 0.0

    def wait(self):
        dt = time.time() - self.last
        if dt < self.delay:
            time.sleep(self.delay - dt)
        self.last = time.time()


@dataclass
class Race:
    source: str
    source_url: str
    name: str
    date: str  # YYYY-MM-DD
    city: str = ""
    province: str = ""  # tal cual la da la fuente; se normaliza luego
    region: str = ""
    lat: float | None = None
    lon: float | None = None
    distances: list[float] = field(default_factory=list)  # km
    surface: str = ""  # road | trail | ""
    kind: str = ""  # texto libre de la fuente (Asfalto, Montaña, Cross...)
    time: str = ""  # HH:MM
    elevation: int | None = None  # D+ en metros
    website: str = ""
    registration: str = ""
    image: str = ""
    description: str = ""

    def to_dict(self):
        return asdict(self)


# ---------------------------------------------------------------- distancias

_NUM = r"(\d{1,3}(?:[.,]\d{3})+|\d+(?:[.,]\d+)?)"


def _num(s: str, unit_m: bool) -> float:
    if re.fullmatch(r"\d{1,3}(?:\.\d{3})+", s):  # 10.000 → miles
        v = float(s.replace(".", ""))
    elif re.fullmatch(r"\d{1,3}(?:,\d{3})+", s) and unit_m:
        v = float(s.replace(",", ""))
    else:
        v = float(s.replace(",", "."))
    return v / 1000 if unit_m else v


def parse_distances(text: str) -> list[float]:
    """Extrae distancias en km de textos tipo '5.000 y 10.000 m', '11k, 28k',
    '16Km desnivel+670m', 'between 11 and 17 kilometers', 'Media maratón'."""
    if not text:
        return []
    t = text.lower().replace("\xa0", " ")
    t = re.sub(r"(desnivel|d\+|d-|\+)\s*[+]?\s*\d[\d.,]*\s*m\b", " ", t)  # quita desniveles
    out = []
    # listas con unidad final: "5.000 y 10.000 m", "5, 10 y 21 km", "between 11 and 17 kilometers"
    for m in re.finditer(rf"((?:{_NUM}\s*(?:,|y|i|and|-|/|o)\s*)+{_NUM})\s*(km|kms|kilómetros|kilometros|kilometers|k|m|mts|metros)\b", t):
        unit_m = m.group(m.lastindex) in ("m", "mts", "metros")
        for n in re.findall(_NUM, m.group(1)):
            out.append(_num(n, unit_m))
    for m in re.finditer(rf"{_NUM}\s*(km|kms|kilómetros|kilometros|kilometers|k|m|mts|metros)\b", t):
        unit_m = m.group(2) in ("m", "mts", "metros")
        v = _num(m.group(1), unit_m)
        if unit_m and v < 0.8:  # "670 m" suelen ser desniveles/altitudes
            continue
        out.append(v)
    if re.search(r"\b(media|medio|mitja|half)[ -]?(marat|mara)", t):
        out.append(21.0975)
    elif re.search(r"\b(marat[oó]n|marató|maratoi|marathon)\b", t) and not re.search(r"(ultra|trail|mont|mendi|muntanya|relevos|ekiden|cuarto|quarter)", t):
        out.append(42.195)
    if re.search(r"\bmilla\b|\bmile\b", t):
        out.append(1.609)
    res = []
    for v in out:
        if 0.8 <= v <= 400:
            v = round(v, 3)
            if all(abs(v - r) > 0.05 for r in res):
                res.append(v)
    return sorted(res)


def parse_elevation(text: str):
    if not text:
        return None
    m = re.search(r"(?:desnivel|d\+|\+)\s*(?:positivo\s*)?(?:de\s*)?\+?\s*(\d[\d.]*)\s*m", text.lower())
    if m:
        try:
            return int(m.group(1).replace(".", ""))
        except ValueError:
            return None
    return None


TRAIL_WORDS = re.compile(
    r"trail|monta[ñn]a|mountain|muntanya|mendi|sky ?race|skyrunning|ultra|vertical|\bkv\b|\bkm vertical|cresta|cumbre|"
    r"travesía|travesia|cims?\b|cursa de muntanya|mendi lasterketa|\bcxm\b|\bcpm\b|carrera por monta|desnivel",
    re.I,
)
ROAD_WORDS = re.compile(r"asfalto|urbana|\b10k\b|\b5k\b|media marat|san silvestre|night ?run|nocturna|popular|marat[oó]n (?!de monta)|milla", re.I)


def guess_surface(*texts) -> str:
    t = " ".join(x for x in texts if x)
    if TRAIL_WORDS.search(t):
        return "trail"
    if ROAD_WORDS.search(t):
        return "road"
    return ""


HARD_EXCLUDE = re.compile(
    r"\b(btt|mtb|bike|bici|ciclis|cicloturis|gravel|triatl|triathl|duatl|duathl|acuatl|aquathl|nataci|swim|a nado|"
    r"orientaci|rogaine|esqu[ií]|skimo|p[aá]del|virtual|h[ií]pica|patina|ciclocross|carretera btt)",
    re.I,
)
SOFT_EXCLUDE = re.compile(r"marcha|marxa|n[oó]rdic|senderis|caminada|caminata|walk|paseo|andada", re.I)
RUN_WORDS = re.compile(r"cursa|carrera|carreira|trail|run|marat|cross|lasterketa|korrika|km|milla|legua|sky|ultra|vertical|10k|5k", re.I)


def is_running(name: str, kind: str = "") -> bool:
    """Descarta ciclismo, triatlón, orientación y marchas no competitivas."""
    t = f"{name} {kind}"
    if HARD_EXCLUDE.search(t):
        return False
    if SOFT_EXCLUDE.search(t) and not RUN_WORDS.search(name):
        return False
    return True


def dump(path, data):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))


def load(path, default):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return default
