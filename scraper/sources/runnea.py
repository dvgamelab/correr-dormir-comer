"""Runnea — grandes carreras verificadas (maratones, medias, trails de referencia)."""
from bs4 import BeautifulSoup

from common import Race, Polite, session, parse_distances, guess_surface, log

BASE = "https://www.runnea.com/carreras-populares/calendario/espana/"


def fetch(cache: dict):
    s, p = session(), Polite(0.5)
    races, seen = [], set()
    for page in range(1, 60):
        p.wait()
        soup = BeautifulSoup(s.get(BASE + (f"{page}/" if page > 1 else ""), timeout=30).text, "lxml")
        cards = soup.select(".card-races")
        new = 0
        for c in cards:
            a = c.select_one("a[href]")
            h2 = c.select_one("h2")
            d = c.select_one(".data.date")
            if not (a and h2 and d):
                continue
            url = "https://www.runnea.com" + a["href"]
            if url in seen:
                continue
            seen.add(url)
            new += 1
            dd, mm, yy = d.get_text(strip=True).split("-")
            loc = c.select_one(".data.location")
            dist = c.select_one(".data.distance")
            name = h2.get_text(strip=True)
            dist_txt = dist.get_text(strip=True) if dist else ""
            img = c.select_one("img.card-image")
            races.append(Race(
                source="runnea", source_url=url, name=name, date=f"{yy}-{mm}-{dd}",
                province=loc.get_text(strip=True) if loc else "",
                distances=parse_distances(dist_txt or name), surface=guess_surface(name) or "road",
                image=img.get("src", "") if img else "",
            ))
        if not cards or new == 0:
            break
    log.info("runnea → %d", len(races))
    return races
