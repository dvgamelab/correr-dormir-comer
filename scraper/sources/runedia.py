"""Runedia (Mundo Deportivo) — calendario con tipo de prueba y distancia exacta."""
import re

from bs4 import BeautifulSoup

from common import Race, Polite, session, log

BASE = "https://runedia.mundodeportivo.com/calendario-carreras/espana/comunidad/provincia/tipo/distancia/fecha/0/0/{}/"
MONTHS = {m: i + 1 for i, m in enumerate(
    "enero febrero marzo abril mayo junio julio agosto septiembre octubre noviembre diciembre".split())}
TRAIL_KINDS = {"montaña", "travesía de montaña", "travesía", "obstáculos", "trail", "cross", "canicross", "carrera de obstáculos", "tierra"}


def fetch(cache: dict):
    s, p = session(), Polite(0.5)
    races, seen = [], set()
    for page in range(0, 150):
        p.wait()
        try:
            html = s.get(BASE.format(page), timeout=30).text
        except Exception as e:  # noqa: BLE001
            log.warning("runedia p%s: %s", page, e)
            break
        soup = BeautifulSoup(html, "lxml")
        month = year = None
        new = 0
        for el in soup.select(".cal-container-llistat-barra-mes, .item-cursa"):
            if "cal-container-llistat-barra-mes" in el.get("class", []):
                parts = el.get_text(" ", strip=True).lower().split()
                if len(parts) >= 2 and parts[0] in MONTHS:
                    month, year = MONTHS[parts[0]], int(parts[1])
                continue
            a = el.select_one("a.nom-cursa")
            dia = el.select_one(".dia")
            if not a or not month:
                continue
            url = a["href"]
            if url in seen:
                continue
            seen.add(url)
            new += 1
            m = re.search(r"(\d{1,2})", dia.get_text() if dia else "")
            if not m:
                continue
            lloc = el.select_one(".lloc")
            lloc = lloc.get_text(strip=True) if lloc else ""
            prov, _, city = lloc.partition(",")
            spans = [x.get_text(strip=True) for x in el.select("span") if not x.get("class")]
            kind = next((x for x in spans if x and not re.search(r"\d+\s*m$", x) and x.lower() not in MONTHS
                         and not re.match(r"^[LMXJVSD]-\d+$", x)), "")
            dist = next((x for x in spans if re.search(r"^\d+\s*m$", x)), "")
            dkm = [round(int(re.sub(r"\D", "", dist)) / 1000, 3)] if dist else []
            k = kind.lower()
            surface = "trail" if k in TRAIL_KINDS else ("road" if k in {"asfalto", "running", "pista"} else "")
            races.append(Race(
                source="runedia", source_url=url, name=a.get_text(strip=True),
                date=f"{year:04d}-{month:02d}-{int(m.group(1)):02d}", city=city.strip(), province=prov.strip(),
                distances=dkm, surface=surface, kind=kind,
            ))
        if not soup.select(".fila-next-page") or new == 0:
            break
    log.info("runedia → %d filas", len(races))
    return races
