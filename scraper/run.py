"""Recolector semanal de carreras de España.

    python scraper/run.py                 # todas las fuentes
    python scraper/run.py --only runedia  # una fuente (el resto usa el último volcado)

Escribe web/data/races.json (consumido por la app) y data/raw/<fuente>.json.
"""
import argparse
import datetime as dt
import hashlib
import logging
import os
import re
import sys
import time
import traceback

sys.path.insert(0, os.path.dirname(__file__))

from common import dump, load, is_running, session, guess_surface, parse_distances, log  # noqa: E402
import geo  # noqa: E402
from sources import running_life, runedia, carreraspopulares, runnea, corriendovoy, fororunners  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
RAW = os.path.join(DATA, "raw")
CACHE = os.path.join(DATA, "cache")
OUT = os.path.join(ROOT, "web", "data", "races.json")

SOURCES = {
    "running.life": running_life,
    "runedia": runedia,
    "carreraspopulares": carreraspopulares,
    "runnea": runnea,
    "corriendovoy": corriendovoy,
    "fororunners": fororunners,
}
# prioridad para elegir nombre/datos cuando una carrera aparece en varias fuentes
NAME_PRIORITY = ["runnea", "carreraspopulares", "fororunners", "running.life", "corriendovoy", "runedia"]
SOURCE_LABEL = {
    "running.life": "running.life", "runedia": "Runedia", "carreraspopulares": "CarrerasPopulares",
    "runnea": "Runnea", "corriendovoy": "Corriendo Voy", "fororunners": "Foro Runners",
}


# ------------------------------------------------------------------ geocoding

class Geocoder:
    """Photon (Komoot, datos OSM) con Nominatim de respaldo y caché persistente.
    La provincia se calcula siempre por polígono (geo.province_at)."""

    def __init__(self, path, budget=400):
        self.path, self.budget = path, budget
        self.cache = load(path, {})
        self.s = session()
        self.s.headers["User-Agent"] = "correr-dormir-comer/1.0 (uso personal; calendario de carreras)"
        self.s.mount("https://", __import__("requests").adapters.HTTPAdapter(max_retries=1))
        self.last = 0.0
        self.nominatim_ok = True

    def save(self):
        dump(self.path, self.cache)

    def _wait(self, secs):
        w = secs - (time.time() - self.last)
        if w > 0:
            time.sleep(w)
        self.last = time.time()

    def _photon(self, q):
        self._wait(0.35)
        r = self.s.get("https://photon.komoot.io/api/", timeout=20, params={
            "q": q, "limit": 1, "bbox": "-18.5,27.5,4.6,44.0", "osm_tag": "place"})
        for f in r.json().get("features", []):
            if f["properties"].get("countrycode") == "ES":
                lon, lat = f["geometry"]["coordinates"]
                return lat, lon
        return None

    def _nominatim(self, q):
        if not self.nominatim_ok:
            return None
        self._wait(1.1)
        r = self.s.get("https://nominatim.openstreetmap.org/search", timeout=20, params={
            "q": q, "format": "jsonv2", "limit": 1, "countrycodes": "es"})
        if r.status_code == 429:
            self.nominatim_ok = False
            return None
        res = r.json()
        return (float(res[0]["lat"]), float(res[0]["lon"])) if res else None

    def lookup(self, city, province=None, region=None):
        if not city:
            return None
        key = geo.fold(f"{city}|{province or region or ''}")
        if key in self.cache:
            return self.cache[key]
        if self.budget <= 0:
            return None
        self.budget -= 1
        q = ", ".join(x for x in [city, province or region] if x)
        hit = None
        for fn in (self._photon, self._nominatim):
            try:
                hit = fn(q)
            except Exception as e:  # noqa: BLE001
                log.warning("geocode %s (%s): %s", q, fn.__name__, e)
            if hit:
                break
        if not hit or not geo.in_spain(*hit):
            self.cache[key] = {}
            return {}
        prov = geo.province_at(*hit)
        if province and prov and prov != province:  # el pueblo encontrado está en otra provincia: dudoso
            self.cache[key] = {}
            return {}
        val = {"lat": round(hit[0], 5), "lon": round(hit[1], 5), "province": prov}
        self.cache[key] = val
        if len(self.cache) % 50 == 0:
            self.save()
        return val


def nearest_province(lat, lon, ccaa=None):
    best, bd = None, 1e9
    for name, (c, la, lo, _) in geo.PROVINCES.items():
        if ccaa and c != ccaa:
            continue
        d = (la - lat) ** 2 + ((lo - lon) * 0.8) ** 2
        if d < bd:
            best, bd = name, d
    return best


# --------------------------------------------------------------- normalizing

STOP = set("""de del la las el los y i e a en al por para the of run cursa carrera carreira lasterketa popular
edicion ed edicio memorial trofeo gran premio circuito km k m trail 2026 2027 2028 2025 ciudad villa""".split())
ROMAN = re.compile(r"^(?=[mdclxvi]+$)m{0,3}(cm|cd|d?c{0,3})(xc|xl|l?x{0,3})(ix|iv|v?i{0,3})$")


WEAK = set("""solidaria solidari benefica nocturna urbana media maraton marato mitja milla legua cross night race
running corre correr carreira popular infantil familiar mujer dona women trail sant santa san virgen fiestas
fiesta cursa carrera marxa marcha caminada solidari solidaria solidario benefica internacional nacional
circuito circuit series serie premio trofeo memorial ciudad villa race carrera km absoluta juvenil
nocturno nocturna vertical ultra sky skyrace montana muntanya mendi lasterketa""".split())


# variantes bilingües / ortográficas frecuentes en nombres de carreras
ALIAS = {"castello": "castellon", "alacant": "alicante", "lerida": "lleida", "gerona": "girona", "eivissa": "ibiza",
         "xixona": "jijona", "alcoi": "alcoy", "elx": "elche", "jonquera": "junquera", "zumaia": "zumaya", "platja": "playa",
         "donostia": "sebastian", "gasteiz": "vitoria", "iruna": "pamplona", "bizkaia": "vizcaya", "gipuzkoa": "guipuzcoa",
         "araba": "alava", "ourense": "orense", "coruna": "coruna", "sant": "san", "nadal": "navidad", "mitja": "media",
         "marato": "maraton", "marathon": "maraton", "half": "media", "cursa": "carrera", "muntanya": "montana", "carreira": "carrera", "mendi": "montana"}


def tokens(name):
    t = geo.fold(name)
    t = " ".join(ALIAS.get(w, w) for w in t.split())
    t = re.sub(r"([a-z])(\d)|(\d)([a-z])", r"\1\3 \2\4", t)
    t = re.sub(r"\b\d+\s*(a|o|th|st|nd|rd|ª|º|era|er|na|ena)\b", " ", t)
    out = set()
    for w in t.split():
        if w in STOP or ROMAN.match(w) or w.isdigit() or len(w) < 2:
            continue
        out.add(w)
    return out


def similar(a, b):
    if not a or not b:
        return 0.0
    inter = len(a & b)
    j = inter / len(a | b)
    if inter >= 2 and (a <= b or b <= a):
        j = max(j, 0.75)
    return j


def dist_km(a, b):
    import math
    if None in (a.get("lat"), b.get("lat")):
        return None
    dlat = math.radians(b["lat"] - a["lat"])
    dlon = math.radians(b["lon"] - a["lon"])
    x = math.sin(dlat / 2) ** 2 + math.cos(math.radians(a["lat"])) * math.cos(math.radians(b["lat"])) * math.sin(dlon / 2) ** 2
    return 6371 * 2 * math.asin(math.sqrt(x))


def name_key(name):
    """Nombre plegado sin años, ordinales ni numeración romana, para comparar cadenas."""
    t = geo.fold(name)
    t = " ".join(ALIAS.get(w, w) for w in t.split())
    t = re.sub(r"\b(19|20)\d\d\b", " ", t)
    t = re.sub(r"\b\d+\s*(a|o|th|st|nd|rd|era|er|na|ena|ª|º)?\b(?!\s*k)", " ", t)
    t = " ".join(w for w in t.split() if not ROMAN.match(w) and w not in ("edicion", "ed", "edicio"))
    return t


def pair_score(r, o):
    """0..1+: cuánto se parecen dos fichas para considerarlas la misma carrera."""
    from difflib import SequenceMatcher
    d = dist_km(r, o)
    exact = not (r.get("approx") or o.get("approx"))
    same_town = bool(geo.fold(r.get("city", ""))) and geo.fold(r.get("city", "")) == geo.fold(o.get("city", ""))
    near = (d is not None and d < 12 and exact) or same_town
    far = d is not None and d > 60 and exact
    # palabras distintivas: sin genéricas ("carrera popular", "solidaria"…) ni el nombre del pueblo
    if d is not None and d > 25 and exact:
        return 0  # dos puntos GPS fiables a más de 25 km: no es la misma carrera
    town = set(geo.fold(r.get("city", "")).split()) | set(geo.fold(o.get("city", "")).split())
    a, b = r["_tok"] - WEAK - town - GENERIC, o["_tok"] - WEAK - town - GENERIC
    ka, kb = " ".join(sorted(a)), " ".join(sorted(b))
    dratio = SequenceMatcher(None, ka, kb).ratio() if ka and kb else 0
    shared = {w for w in a & b if len(w) >= 3}
    same_prov = r.get("province") and r.get("province") == o.get("province")
    loose = r.get("approx") or o.get("approx") or not r.get("city") or not o.get("city") or (d is not None and d < 30)
    da, db = r.get("distances") or [], o.get("distances") or []
    dist_ok = not (da and db) or any(abs(x - y) <= max(0.6, 0.12 * max(x, y)) for x in da for y in db)
    if a and b and not shared and (dratio < 0.88 or min(len(ka), len(kb)) < 12):
        return 0  # no comparten nada propio: son carreras distintas aunque sean el mismo día y sitio
    if not (a and b):
        # Nombres genéricos + lugar ("Trail de Jalance", "Maratón Estepona"): el pueblo es lo que identifica.
        if r["date"] != o["date"]:
            return 0
        a2, b2 = r["_tok"] - WEAK, o["_tok"] - WEAK
        small, big = (a2, b2) if len(a2) <= len(b2) else (b2, a2)
        place_ok = near or (same_prov and loose)
        if small and small <= big and place_ok and dist_ok:
            return 0.65
        strip = lambda k: " ".join(w for w in k.split() if w not in town)  # noqa: E731
        full = SequenceMatcher(None, strip(r["_key"]), strip(o["_key"])).ratio()
        if near and full >= 0.97:
            return 0.7  # mismo nombre en el mismo sitio (fichas por distancia de una misma prueba)
        return 0.7 if near and full >= 0.9 and dist_ok else 0
    sim = similar(a, b)
    score = max(sim, dratio - 0.1 if min(len(ka), len(kb)) >= 12 else 0) + (0.25 if near else 0) - (0.4 if far else 0)
    if near and shared:
        score = max(score, 0.6)
    elif shared and (a <= b or b <= a) and same_prov and loose and dist_ok:
        score = max(score, 0.6)  # p. ej. "Tramuntana Trail" (La Jonquera) ~ "Tramuntana Trail Transforter" (La Junquera)
    if r["date"] != o["date"]:  # fechas distintas entre webs: sólo si el parecido es muy alto
        score = score - 0.25 if (dratio >= 0.85 or sim >= 0.75) and not far else 0
    return score


GENERIC = set()


def dedupe(rows):
    """Agrupa las fichas que son la misma carrera (misma fecha o ±1 día, nombre parecido, mismo sitio)."""
    # palabras que aparecen en muchas carreras distintas ("silvestre", "volta", "cancer"…) no identifican nada
    from collections import Counter
    df = Counter(w for key in {name_key(r["name"]) for r in rows} for w in set(tokens(key)))
    GENERIC.clear()
    GENERIC.update(w for w, n in df.items() if n >= 9)
    log.info("palabras genéricas detectadas: %d (p. ej. %s)", len(GENERIC), ", ".join(sorted(GENERIC)[:12]))
    for r in rows:
        r["_key"] = name_key(r["name"])
    rows = sorted(rows, key=lambda x: (x["date"], NAME_PRIORITY.index(x["source"])))
    clusters, by_day = [], {}
    for r in rows:
        cands = []
        for dd in (-1, 0, 1):
            day = (dt.date.fromisoformat(r["date"]) + dt.timedelta(days=dd)).isoformat()
            cands += by_day.get(day, [])
        best, bs, via = None, 0.0, None
        for c in cands:
            for o in c:
                sc = pair_score(r, o)
                if sc > bs:
                    best, bs, via = c, sc, o
        if best is not None and bs >= 0.6:
            r["_why"] = f'{bs:.2f} ~ {via["source"]}: {via["name"]}'
            best.append(r)
        else:
            c = [r]
            clusters.append(c)
            by_day.setdefault(r["date"], []).append(c)
    for c in clusters:  # la fuente de más prioridad manda (nombre, fecha)
        c.sort(key=lambda x: NAME_PRIORITY.index(x["source"]))
    return clusters


def categories(distances, surface):
    cats = set()
    for d in distances:
        if 4.5 <= d <= 5.5:
            cats.add("5k")
        elif 9.5 <= d <= 10.5:
            cats.add("10k")
        elif 20.5 <= d <= 21.6:
            cats.add("21k")
        elif 41.5 <= d <= 42.7:
            cats.add("42k")
        if d > 43:
            cats.add("ultra")
    if surface == "trail":
        cats.add("trail")
    return sorted(cats)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", nargs="*", help="fuentes a refrescar")
    ap.add_argument("--build-only", action="store_true", help="no descargar; reconstruir desde data/raw")
    ap.add_argument("--geocode-budget", type=int, default=int(os.environ.get("GEOCODE_BUDGET", 1500)))
    ap.add_argument("--details", type=int, default=int(os.environ.get("DETAIL_BUDGET", 700)))
    args = ap.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    os.makedirs(RAW, exist_ok=True)
    os.makedirs(CACHE, exist_ok=True)
    os.makedirs(os.path.dirname(OUT), exist_ok=True)

    status = load(os.path.join(DATA, "status.json"), {})
    for name, mod in SOURCES.items():
        if args.build_only or (args.only and name not in args.only):
            continue
        cpath = os.path.join(CACHE, f"{name}.json")
        cache = load(cpath, {})
        t0 = time.time()
        try:
            kw = {"max_details": args.details} if name == "running.life" else {}
            races = [r.to_dict() for r in mod.fetch(cache, **kw)]
            if not races:
                raise RuntimeError("0 carreras: ¿cambió la web?")
            dump(os.path.join(RAW, f"{name}.json"), races)
            status[name] = {"ok": True, "count": len(races), "at": dt.datetime.utcnow().isoformat(timespec="seconds") + "Z",
                            "secs": round(time.time() - t0)}
        except Exception as e:  # noqa: BLE001  — una fuente caída no tumba el resto
            traceback.print_exc()
            prev = status.get(name, {})
            status[name] = {**prev, "ok": False, "error": str(e)[:300],
                            "failed_at": dt.datetime.utcnow().isoformat(timespec="seconds") + "Z"}
        dump(cpath, cache)
    dump(os.path.join(DATA, "status.json"), status)

    build(args.geocode_budget, status)


def build(geocode_budget, status):
    today = dt.date.today().isoformat()
    gc = Geocoder(os.path.join(CACHE, "geocode.json"), budget=geocode_budget)
    rows = []
    for name in SOURCES:
        for r in load(os.path.join(RAW, f"{name}.json"), []):
            m = re.match(r"(\d{4})-(\d{1,2})-(\d{1,2})", r.get("date") or "")
            r["date"] = f"{m.group(1)}-{int(m.group(2)):02d}-{int(m.group(3)):02d}" if m else ""
            if not r.get("surface"):
                r["surface"] = guess_surface(r["name"], r.get("kind", ""))
            ds = list(r.get("distances") or [])
            for x in parse_distances(r["name"]):  # "Palma Marathon", "10K Valencia"… aunque la ficha no lo diga
                if all(abs(x - y) > 0.3 for y in ds):
                    ds.append(x)
            r["distances"] = sorted(ds)
            if not r.get("date") or r["date"] < today or not is_running(r["name"], r.get("kind", "")):
                continue
            rows.append(r)
    log.info("filas brutas: %d", len(rows))

    # índice de pueblos con coordenadas conocidas (running.life trae GPS)
    town = {}
    for r in rows:
        if r.get("lat") and r.get("city"):
            town.setdefault(geo.fold(r["city"]), (r["lat"], r["lon"]))

    for r in rows:
        prov = geo.norm_province(r.get("province", "")) or geo.norm_province(r.get("city", ""))
        ccaa = geo.ccaa_of(prov) or geo.norm_ccaa(r.get("region", ""))
        approx = False
        if not r.get("lat"):
            t = town.get(geo.fold(r.get("city", "")))
            hit = None
            if t and (not prov or geo.province_at(*t) == prov):
                r["lat"], r["lon"] = t
                prov = prov or geo.province_at(*t)
            elif (hit := gc.lookup(r.get("city"), prov, ccaa)) and hit.get("lat"):
                r["lat"], r["lon"] = hit["lat"], hit["lon"]
                prov = prov or hit.get("province")
            elif prov:
                r["lat"], r["lon"] = geo.centroid(prov)
                approx = True
        elif not prov:
            prov = geo.province_at(r["lat"], r["lon"]) or nearest_province(r["lat"], r["lon"], ccaa)
        if r.get("lat") and not geo.in_spain(r["lat"], r["lon"]):
            r["lat"] = r["lon"] = None
        r["province"] = prov or ""
        r["ccaa"] = geo.ccaa_of(prov) or ccaa or ""
        r["approx"] = approx
        r["_tok"] = tokens(r["name"])
    gc.save()

    # ------------------------------------------------------------- dedupe
    clusters = dedupe(rows)
    merged = [merge(c) for c in clusters]
    report = [{"name": m["name"], "date": m["date"], "merged": [f'{x["source"]}: {x["name"]} ({x["date"]}, {x.get("city", "")})' + (f' [{x["_why"]}]' if x.get("_why") else "") for x in c]}
              for m, c in zip(merged, clusters) if len(c) > 1]
    dump(os.path.join(DATA, "dedupe_report.json"), report)
    log.info("fusiones: %d grupos con más de una ficha (ver data/dedupe_report.json)", len(report))
    merged.sort(key=lambda x: (x["date"], x["name"]))
    log.info("carreras únicas: %d", len(merged))

    meta = {
        "generated": dt.datetime.utcnow().isoformat(timespec="seconds") + "Z",
        "count": len(merged),
        "sources": {k: {"label": SOURCE_LABEL[k], **v} for k, v in status.items() if k in SOURCE_LABEL},
    }
    dump(OUT, {"meta": meta, "races": merged})


SMALL = {"de", "del", "la", "las", "el", "los", "y", "i", "e", "a", "en", "al", "per", "por", "d", "l", "o"}


def tidy(s):
    """Pasa a formato título los textos gritados (TODO MAYÚSCULAS)."""
    s = re.sub(r"\s+", " ", s or "").strip()
    letters = [ch for ch in s if ch.isalpha()]
    if not letters or sum(ch.isupper() for ch in letters) / len(letters) < 0.7:
        return s
    out = []
    for i, w in enumerate(s.lower().split(" ")):
        if re.fullmatch(r"[ivxlcdm]+", w) and len(w) <= 5 and w not in ("di", "mil", "dim", "mix"):
            out.append(w.upper())
        elif i and w in SMALL:
            out.append(w)
        elif re.fullmatch(r"\d+k(m)?", w):
            out.append(w.upper() if w.endswith("k") else w)
        else:
            out.append(re.sub(r"(^|[-'’(/])(\w)", lambda m: m.group(1) + m.group(2).upper(), w))
    return " ".join(out)


def merge(c):
    c = sorted(c, key=lambda x: NAME_PRIORITY.index(x["source"]))
    first = lambda k: next((x[k] for x in c if x.get(k)), "")  # noqa: E731
    exact = [x for x in c if x.get("lat") and not x.get("approx")]
    loc = min(exact, key=lambda x: 0 if x["source"] == "running.life" else 1) if exact else next((x for x in c if x.get("lat")), {})
    dists = []
    for x in c:
        for d in x.get("distances", []):
            if all(abs(d - e) > 0.15 for e in dists):
                dists.append(d)
    dists.sort()
    surfaces = [x["surface"] for x in c if x.get("surface")]
    surface = "trail" if "trail" in surfaces else (surfaces[0] if surfaces else "road")
    name = tidy(first("name"))
    name = re.sub(r"\s*[-–]\s*(curta|llarga|corta|larga|\d+\s*k(m)?)$", "", name, flags=re.I)
    rid = hashlib.md5(f"{c[0]['date']}|{' '.join(sorted(c[0]['_tok']))}".encode()).hexdigest()[:10]
    srcs, seen = [], set()
    for x in c:
        if x["source_url"] not in seen:
            seen.add(x["source_url"])
            srcs.append({"n": SOURCE_LABEL[x["source"]], "u": x["source_url"]})
    out = {
        "id": rid, "name": name, "date": c[0]["date"], "time": first("time"),
        "city": tidy(first("city")), "province": first("province"), "ccaa": first("ccaa"),
        "lat": round(loc["lat"], 5) if loc.get("lat") else None,
        "lon": round(loc["lon"], 5) if loc.get("lon") else None,
        "approx": bool(loc.get("approx")) if loc else True,
        "dist": [round(d, 2) for d in dists], "surface": surface,
        "cats": categories(dists, surface),
        "elev": next((x["elevation"] for x in c if x.get("elevation")), None),
        "kind": first("kind"), "web": first("website"), "reg": first("registration"),
        "img": first("image"), "desc": first("description")[:300], "src": srcs,
    }
    return {k: v for k, v in out.items() if v not in ("", None, [], False)}


if __name__ == "__main__":
    main()
