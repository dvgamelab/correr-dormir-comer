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

from common import dump, load, is_running, session, guess_surface, log  # noqa: E402
import geo  # noqa: E402
from sources import running_life, runedia, carreraspopulares, runnea, corriendovoy  # noqa: E402

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
}
# prioridad para elegir nombre/datos cuando una carrera aparece en varias fuentes
NAME_PRIORITY = ["runnea", "carreraspopulares", "running.life", "corriendovoy", "runedia"]
SOURCE_LABEL = {
    "running.life": "running.life", "runedia": "Runedia", "carreraspopulares": "CarrerasPopulares",
    "runnea": "Runnea", "corriendovoy": "Corriendo Voy",
}


# ------------------------------------------------------------------ geocoding

class Geocoder:
    """Nominatim (OSM) con caché persistente. Máx. 1 petición/s según su política."""

    def __init__(self, path, budget=400):
        self.path, self.budget = path, budget
        self.cache = load(path, {})
        self.s = session()
        self.s.headers["User-Agent"] = "correr-dormir-comer/1.0 (uso personal; calendario de carreras)"
        self.last = 0.0

    def save(self):
        dump(self.path, self.cache)

    def lookup(self, city, province=None, region=None):
        if not city:
            return None
        key = geo.fold(f"{city}|{province or region or ''}")
        if key in self.cache:
            return self.cache[key]
        if self.budget <= 0:
            return None
        self.budget -= 1
        q = ", ".join(x for x in [city, province or region, "España"] if x)
        wait = 1.1 - (time.time() - self.last)
        if wait > 0:
            time.sleep(wait)
        self.last = time.time()
        try:
            r = self.s.get("https://nominatim.openstreetmap.org/search", timeout=30, params={
                "q": q, "format": "jsonv2", "limit": 1, "addressdetails": 1, "countrycodes": "es"})
            res = r.json()
        except Exception as e:  # noqa: BLE001
            log.warning("geocode %s: %s", q, e)
            return None
        if not res:
            self.cache[key] = {}
            return {}
        a = res[0].get("address", {})
        prov = geo.norm_province(a.get("province") or a.get("state_district") or a.get("county") or "") \
            or geo.norm_province(a.get("state") or "")
        val = {"lat": round(float(res[0]["lat"]), 5), "lon": round(float(res[0]["lon"]), 5), "province": prov}
        self.cache[key] = val
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


def tokens(name):
    t = geo.fold(name)
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
    ap.add_argument("--geocode-budget", type=int, default=int(os.environ.get("GEOCODE_BUDGET", 1500)))
    ap.add_argument("--details", type=int, default=int(os.environ.get("DETAIL_BUDGET", 700)))
    args = ap.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    os.makedirs(RAW, exist_ok=True)
    os.makedirs(CACHE, exist_ok=True)
    os.makedirs(os.path.dirname(OUT), exist_ok=True)

    status = load(os.path.join(DATA, "status.json"), {})
    for name, mod in SOURCES.items():
        if args.only and name not in args.only:
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
            hit = gc.lookup(r.get("city"), prov, ccaa)
            if hit and hit.get("lat"):
                r["lat"], r["lon"] = hit["lat"], hit["lon"]
                prov = prov or hit.get("province")
            elif geo.fold(r.get("city", "")) in town:
                r["lat"], r["lon"] = town[geo.fold(r["city"])]
            elif prov:
                r["lat"], r["lon"] = geo.centroid(prov)
                approx = True
        elif not prov:
            hit = gc.lookup(r.get("city"), None, ccaa)
            prov = (hit or {}).get("province") or nearest_province(r["lat"], r["lon"], ccaa)
        if r.get("lat") and not geo.in_spain(r["lat"], r["lon"]):
            r["lat"] = r["lon"] = None
        r["province"] = prov or ""
        r["ccaa"] = geo.ccaa_of(prov) or ccaa or ""
        r["approx"] = approx
        r["_tok"] = tokens(r["name"])
    gc.save()

    # ------------------------------------------------------------- dedupe
    by_date = {}
    for r in rows:
        by_date.setdefault(r["date"], []).append(r)
    merged = []
    for date, items in by_date.items():
        clusters = []
        for r in sorted(items, key=lambda x: NAME_PRIORITY.index(x["source"])):
            best, bs = None, 0
            for c in clusters:
                for o in c:
                    sim = similar(r["_tok"], o["_tok"])
                    d = dist_km(r, o)
                    same_town = geo.fold(r.get("city", "")) and geo.fold(r.get("city", "")) == geo.fold(o.get("city", ""))
                    near = (d is not None and d < 12 and not (r.get("approx") or o.get("approx"))) or same_town
                    score = sim + (0.25 if near else 0) - (0.3 if d is not None and d > 60 and not (r.get("approx") or o.get("approx")) else 0)
                    if score > bs:
                        best, bs = c, score
            if best is not None and bs >= 0.6:
                best.append(r)
            else:
                clusters.append([r])
        for c in clusters:
            merged.append(merge(c))
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
