"""running.life + gotrail.run — calendario más amplio (≈1.900 pruebas en España)
con coordenadas GPS en el JSON-LD de cada listado."""
import json
import re

from bs4 import BeautifulSoup

from common import Race, Polite, session, parse_distances, guess_surface, log

LISTS = [
    ("https://running.life/running-calendar/spain", None),
    ("https://running.life/trail-running-calendar/spain", "trail"),
    ("https://gotrail.run/trail-running-calendar/spain", "trail"),
]


def _items(html):
    out = []
    for m in re.finditer(r"<script[^>]*application/ld\+json[^>]*>(.*?)</script>", html, re.S):
        try:
            d = json.loads(m.group(1))
        except json.JSONDecodeError:
            continue
        if d.get("@type") == "ItemList":
            out += [i["item"] for i in d.get("itemListElement", []) if "item" in i]
    return out


def _slug(url):
    return url.rstrip("/").rsplit("/", 1)[-1]


def fetch(cache: dict, max_details=700):
    s, p = session(), Polite(0.35)
    events, trail_slugs = {}, set()
    for base, tag in LISTS:
        page, empty = 1, 0
        while page < 400:
            p.wait()
            try:
                r = s.get(f"{base}?page={page}", timeout=30)
            except Exception as e:  # noqa: BLE001
                log.warning("running.life %s p%s: %s", base, page, e)
                break
            items = _items(r.text)
            new = 0
            for it in items:
                slug = _slug(it.get("url", ""))
                if not slug:
                    continue
                if tag == "trail":
                    trail_slugs.add(slug)
                if slug not in events:
                    events[slug] = it
                    new += 1
            if not items or (new == 0 and tag is None):
                empty += 1
                if empty >= 2 or not items:
                    break
            page += 1
        log.info("running.life %s → %d páginas, %d eventos acumulados", base, page, len(events))

    # Fichas de detalle (web oficial, imagen). Cacheadas entre ejecuciones.
    details = cache.setdefault("details", {})
    todo = [slug for slug in events if slug not in details][:max_details]
    for i, slug in enumerate(todo):
        it = events[slug]
        p.wait()
        try:
            h = s.get(it["url"], timeout=30).text
        except Exception:  # noqa: BLE001
            continue
        soup = BeautifulSoup(h, "lxml")
        ext = [a["href"] for a in soup.select("a[href]") if a["href"].startswith("http")
               and not re.search(r"running\.life|gotrail\.run|walking\.life|facebook\.com/sharer|twitter|x\.com/intent|whatsapp|mediavine|google", a["href"])]
        img = ""
        for m in re.finditer(r"<script[^>]*application/ld\+json[^>]*>(.*?)</script>", h, re.S):
            try:
                img = json.loads(m.group(1)).get("image", "") or img
            except (json.JSONDecodeError, AttributeError):
                pass
        cats = re.findall(r"\b(Trail Run|Road Race|Obstacle Run|Backyard Ultra|Urban Trail)\b", soup.get_text(" "))
        details[slug] = {"website": ext[0] if ext else "", "image": img if isinstance(img, str) else "", "cats": sorted(set(cats))[:3]}
        if i % 100 == 0:
            log.info("running.life detalles %d/%d", i, len(todo))

    races = []
    for slug, it in events.items():
        loc = it.get("location", {}) or {}
        addr = loc.get("address", {}) or {}
        geo = loc.get("geo", {}) or {}
        if (addr.get("addressCountry") or "Spain") not in ("Spain", "España", "ES"):
            continue
        det = details.get(slug, {})
        desc = it.get("description", "")
        dists = parse_distances(re.sub(r"will take place.*?\d{4}\.", "", desc))
        cats = det.get("cats", [])
        if slug in trail_slugs or "Trail Run" in cats or "Urban Trail" in cats:
            surface = "trail"
        elif "Road Race" in cats:
            surface = "road"
        else:
            surface = guess_surface(it.get("name", "")) or "road"
        kind = ", ".join(cats)
        if "Obstacle Run" in cats:
            kind = "Obstáculos"
        races.append(Race(
            source="running.life", source_url=it.get("url", ""), name=it.get("name", "").strip(),
            date=(it.get("startDate") or "")[:10], city=addr.get("addressLocality", ""),
            region=addr.get("addressRegion", ""), lat=geo.get("latitude"), lon=geo.get("longitude"),
            distances=dists, surface=surface, kind=kind, website=det.get("website", ""),
            image=det.get("image", ""),
        ))
    return races
