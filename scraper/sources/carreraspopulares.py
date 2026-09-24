"""carreraspopulares.com — el calendario clásico de carreras populares."""
import datetime as dt
import re

from bs4 import BeautifulSoup

from common import Race, Polite, session, parse_distances, parse_elevation, guess_surface, log

MONTHS = {m: i + 1 for i, m in enumerate(
    "enero febrero marzo abril mayo junio julio agosto septiembre octubre noviembre diciembre".split())}


def fetch(cache: dict):
    s, p = session(), Polite(0.5)
    r = s.get("https://carreraspopulares.com/calendario_carreras", timeout=30)
    tok = BeautifulSoup(r.text, "lxml").select_one("input[name=_token]")["value"]
    today = dt.date.today()
    end = today + dt.timedelta(days=500)
    r = s.post("https://carreraspopulares.com/calendario_carreras/guardarBusqueda", timeout=30, data={
        "_token": tok, "fr_palabras_clave": "", "fr_fecha_ini": today.strftime("%d/%m/%Y"),
        "fr_fecha_fin": end.strftime("%d/%m/%Y"),
    })
    base = r.url
    races, seen = [], set()
    for page in range(1, 200):
        p.wait()
        soup = BeautifulSoup(s.get(base, params={"page": page}, timeout=30).text, "lxml")
        new = 0
        for f in soup.select(".fichaEdicion"):
            a = f.select_one("h4 a")
            if not a or a["href"] in seen:
                continue
            seen.add(a["href"])
            new += 1
            txt = f.select_one(".infoPruebaListaKK")
            lines = [x.strip() for x in (txt.get_text("\n") if txt else "").split("\n") if x.strip()]
            date = None
            for ln in lines:
                m = re.search(r"(\d{1,2})\s+([a-záéíóú]+)\s+(\d{4})", ln.lower())
                if m and m.group(2) in MONTHS:
                    date = f"{int(m.group(3)):04d}-{MONTHS[m.group(2)]:02d}-{int(m.group(1)):02d}"
                    break
            if not date:
                continue
            place = next((ln for ln in lines if re.search(r"\(.+\)", ln)), "")
            m = re.match(r"(.*?)\s*\(([^)]+)\)", place)
            city, prov = (m.group(1), m.group(2)) if m else (place, "")
            dist_line = next((ln for ln in lines if re.search(r"\d\s*(m|km|k)\b", ln.lower()) and ln != place), "")
            services = [i.get("title", "") for i in f.select(".feature-icon")]
            name = a.get_text(" ", strip=True)
            reg = next((x["href"] for x in f.select("a[href]") if "ticketrun" in x["href"] or "Inscr" in x.get_text()), "")
            races.append(Race(
                source="carreraspopulares", source_url=a["href"], name=name.title() if name.isupper() else name,
                date=date, city=city.split(" - ")[-1].strip(), province=prov,
                distances=parse_distances(dist_line or name), surface=guess_surface(name, dist_line),
                kind=dist_line[:80], elevation=parse_elevation(dist_line), registration=reg,
                description=("Servicios: " + ", ".join(services)) if services else "",
            ))
        if new == 0:
            break
    log.info("carreraspopulares → %d", len(races))
    return races
