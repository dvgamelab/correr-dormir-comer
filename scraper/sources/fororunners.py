"""Foro Runners (fororunners.es) — calendario de The Events Calendar vía su API REST pública.
Muy completo en Madrid y alrededores; trae hora de salida, precio y web oficial."""
import datetime as dt
import html as htmlmod
import re

from common import Race, Polite, session, parse_distances, guess_surface, log

API = "https://www.fororunners.es/wp-json/tribe/events/v1/events"
TAG_KM = {"5k": 5, "10k": 10, "2k": 2, "3k": 3, "15k": 15, "media maraton": 21.0975, "maraton": 42.195,
          "legua": 5.573, "milla": 1.609}


def fetch(cache: dict):
    s, p = session(), Polite(0.5)
    races, page = [], 1
    start = dt.date.today().isoformat()
    while page < 60:
        p.wait()
        r = s.get(API, params={"per_page": 50, "page": page, "start_date": start, "status": "publish"}, timeout=30)
        if r.status_code != 200:
            break
        d = r.json()
        for e in d.get("events", []):
            title = htmlmod.unescape(e.get("title", "")).strip()
            desc = re.sub(r"<[^>]+>", " ", htmlmod.unescape(e.get("description", "") or ""))
            desc = re.sub(r"\s+", " ", desc).strip()
            tags = [t["name"].lower() for t in e.get("tags", [])]
            venue = e.get("venue") if isinstance(e.get("venue"), dict) else {}
            vname = venue.get("venue", "") or ""
            m = re.match(r"(.*?)\s*\(([^)]+)\)", vname)
            city, prov = (m.group(1), m.group(2)) if m else (venue.get("city") or vname, venue.get("province") or venue.get("state") or "")
            dists = parse_distances(f"{title} {desc}")
            for t in tags:
                km = TAG_KM.get(t) or (float(t[:-1]) if re.fullmatch(r"\d+(\.\d+)?k", t) else None)
                if km and all(abs(km - x) > 0.1 for x in dists):
                    dists.append(km)
            start_d = e.get("start_date", "")
            hhmm = start_d[11:16] if e.get("all_day") in (False, "False") else ""
            img = re.search(r'<img[^>]+src="([^"]+)"', e.get("description", "") or "")
            lat = venue.get("geo_lat")
            lon = venue.get("geo_lng")
            races.append(Race(
                source="fororunners", source_url=e.get("url", ""), name=title, date=start_d[:10],
                city=city.strip(), province=prov.strip(), time=hhmm if hhmm != "00:00" else "",
                lat=float(lat) if lat else None, lon=float(lon) if lon else None,
                distances=sorted(dists),
                surface="trail" if ({"trail", "carrera vertical", "montaña"} & set(tags)) else (guess_surface(title, desc) or "road"),
                kind=", ".join(tags[:4]), website=e.get("website", "") or "",
                image=img.group(1) if img else "",
                description=(f"Precio: {e['cost']}. " if e.get("cost") else "") + desc[:250],
            ))
        if page >= int(d.get("total_pages") or 1):
            break
        page += 1
    log.info("fororunners → %d", len(races))
    return races
