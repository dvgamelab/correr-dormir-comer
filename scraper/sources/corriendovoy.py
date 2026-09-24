"""corriendovoy.com — calendario WordPress/EventON (API REST + JSON-LD de cada ficha)."""
import datetime as dt
import html as htmlmod
import re

from common import Race, Polite, session, guess_surface, parse_distances, log

API = "https://corriendovoy.com/wp-json/wp/v2/ajde_events"
SKIP_TYPES = {"ciclismo", "triatlon", "duatlon"}


def fetch(cache: dict):
    s, p = session(), Polite(0.3)
    since = (dt.date.today() - dt.timedelta(days=420)).isoformat()
    posts = []
    for page in range(1, 30):
        r = s.get(API, params={"per_page": 100, "page": page, "modified_after": since + "T00:00:00",
                               "_fields": "id,modified,link,title,content,class_list"}, timeout=30)
        if r.status_code != 200:
            break
        batch = r.json()
        posts += batch
        if len(batch) < 100:
            break
    ev_cache = cache.setdefault("events", {})
    today = dt.date.today().isoformat()
    races = []
    for post in posts:
        classes = post.get("class_list", [])
        types = {c.split("event_type-", 1)[1] for c in classes if c.startswith("event_type-")}
        if types & SKIP_TYPES:
            continue
        key = f"{post['id']}:{post['modified']}"
        if key not in ev_cache:
            p.wait()
            try:
                h = s.get(post["link"], timeout=30).text
            except Exception:  # noqa: BLE001
                continue
            m = re.search(r'"startDate":\s*"([^"]+)"', h)
            ev_cache[key] = m.group(1) if m else ""
        start = ev_cache[key]
        if not start or start[:10] < today:
            continue
        locs = [c.split("event_location-", 1)[1] for c in classes if c.startswith("event_location-")]
        loc = locs[0].replace("-", " ") if locs else ""
        title = htmlmod.unescape(post["title"]["rendered"])
        content = re.sub(r"<[^>]+>", " ", post.get("content", {}).get("rendered", ""))
        tm = re.search(r"T(\d{2}:\d{2})", start)
        races.append(Race(
            source="corriendovoy", source_url=post["link"], name=title, date=start[:10],
            city=loc.title(), province=loc, time=tm.group(1) if tm and tm.group(1) != "00:00" else "",
            distances=parse_distances(f"{title} {content}"),
            surface="trail" if "trail" in types else (guess_surface(title, content) or ("road" if "atletismo" in types else "")),
            kind=", ".join(sorted(types)), description=htmlmod.unescape(content.strip())[:300],
        ))
    log.info("corriendovoy → %d (de %d fichas)", len(races), len(posts))
    return races
