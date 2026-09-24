"""Provincias de España: comunidad autónoma, centroide aproximado y alias.

Se usa para normalizar la provincia que da cada fuente, asignar comunidad
autónoma y como último recurso de geolocalización.
"""
import re
import unicodedata

# provincia canónica: (ccaa, lat, lon, [alias])
PROVINCES = {
    "A Coruña": ("Galicia", 43.16, -8.40, ["la coruna", "coruna", "a coruna", "corunha"]),
    "Álava": ("País Vasco", 42.85, -2.68, ["alava", "araba", "araba alava", "alava araba"]),
    "Albacete": ("Castilla-La Mancha", 38.83, -1.98, []),
    "Alicante": ("Comunidad Valenciana", 38.48, -0.57, ["alacant", "alicante alacant"]),
    "Almería": ("Andalucía", 37.14, -2.35, ["almeria"]),
    "Asturias": ("Asturias", 43.36, -5.85, ["principado de asturias", "oviedo"]),
    "Ávila": ("Castilla y León", 40.58, -4.98, ["avila"]),
    "Badajoz": ("Extremadura", 38.69, -6.12, []),
    "Baleares": ("Illes Balears", 39.57, 2.90, ["islas baleares", "illes balears", "balears", "mallorca", "menorca", "ibiza", "eivissa", "formentera", "palma"]),
    "Barcelona": ("Cataluña", 41.73, 1.98, []),
    "Burgos": ("Castilla y León", 42.34, -3.70, []),
    "Cáceres": ("Extremadura", 39.71, -6.16, ["caceres"]),
    "Cádiz": ("Andalucía", 36.52, -5.76, ["cadiz"]),
    "Cantabria": ("Cantabria", 43.20, -4.03, ["santander"]),
    "Castellón": ("Comunidad Valenciana", 40.15, -0.15, ["castello", "castellon de la plana", "castello de la plana", "castellon castello"]),
    "Ciudad Real": ("Castilla-La Mancha", 38.98, -3.93, []),
    "Córdoba": ("Andalucía", 37.99, -4.78, ["cordoba"]),
    "Cuenca": ("Castilla-La Mancha", 40.03, -2.15, []),
    "Girona": ("Cataluña", 42.03, 2.82, ["gerona"]),
    "Granada": ("Andalucía", 37.31, -3.27, []),
    "Guadalajara": ("Castilla-La Mancha", 40.83, -2.62, []),
    "Gipuzkoa": ("País Vasco", 43.14, -2.17, ["guipuzcoa", "gipuzkoa guipuzcoa", "guipuzkoa", "san sebastian", "donostia"]),
    "Huelva": ("Andalucía", 37.58, -6.83, []),
    "Huesca": ("Aragón", 42.14, -0.41, ["osca"]),
    "Jaén": ("Andalucía", 37.99, -3.46, ["jaen"]),
    "La Rioja": ("La Rioja", 42.27, -2.52, ["rioja", "logrono"]),
    "Las Palmas": ("Canarias", 28.40, -14.99, ["gran canaria", "lanzarote", "fuerteventura", "las palmas de gran canaria"]),
    "León": ("Castilla y León", 42.62, -5.84, ["leon"]),
    "Lleida": ("Cataluña", 42.04, 1.05, ["lerida"]),
    "Lugo": ("Galicia", 43.01, -7.56, []),
    "Madrid": ("Comunidad de Madrid", 40.42, -3.70, ["comunidad de madrid"]),
    "Málaga": ("Andalucía", 36.82, -4.70, ["malaga"]),
    "Murcia": ("Región de Murcia", 38.00, -1.49, ["region de murcia"]),
    "Navarra": ("Navarra", 42.67, -1.65, ["nafarroa", "pamplona"]),
    "Ourense": ("Galicia", 42.20, -7.59, ["orense"]),
    "Palencia": ("Castilla y León", 42.37, -4.53, []),
    "Pontevedra": ("Galicia", 42.43, -8.64, ["vigo"]),
    "Salamanca": ("Castilla y León", 40.80, -6.06, []),
    "Santa Cruz de Tenerife": ("Canarias", 28.29, -16.63, ["tenerife", "s c tenerife", "sc tenerife", "sta cruz de tenerife", "santa cruz tenerife", "la palma", "la gomera", "el hierro"]),
    "Segovia": ("Castilla y León", 41.07, -4.05, []),
    "Sevilla": ("Andalucía", 37.43, -5.68, []),
    "Soria": ("Castilla y León", 41.62, -2.59, []),
    "Tarragona": ("Cataluña", 41.09, 0.83, []),
    "Teruel": ("Aragón", 40.63, -0.86, []),
    "Toledo": ("Castilla-La Mancha", 39.79, -4.15, []),
    "Valencia": ("Comunidad Valenciana", 39.37, -0.77, ["valencia valencia", "valencia/valencia"]),
    "Valladolid": ("Castilla y León", 41.63, -4.84, []),
    "Bizkaia": ("País Vasco", 43.23, -2.85, ["vizcaya", "bizkaia vizcaya", "bilbao"]),
    "Zamora": ("Castilla y León", 41.73, -5.96, []),
    "Zaragoza": ("Aragón", 41.62, -1.06, []),
    "Ceuta": ("Ceuta", 35.89, -5.32, []),
    "Melilla": ("Melilla", 35.29, -2.94, []),
}

CCAA_ALIASES = {
    "andalucia": "Andalucía", "aragon": "Aragón", "asturias": "Asturias",
    "baleares": "Illes Balears", "illes balears": "Illes Balears", "islas baleares": "Illes Balears",
    "canarias": "Canarias", "islas canarias": "Canarias", "cantabria": "Cantabria",
    "castilla la mancha": "Castilla-La Mancha", "castilla y leon": "Castilla y León", "castilla leon": "Castilla y León",
    "cataluna": "Cataluña", "catalunya": "Cataluña", "comunidad valenciana": "Comunidad Valenciana",
    "valencia": "Comunidad Valenciana", "comunitat valenciana": "Comunidad Valenciana",
    "extremadura": "Extremadura", "galicia": "Galicia", "la rioja": "La Rioja", "madrid": "Comunidad de Madrid",
    "comunidad de madrid": "Comunidad de Madrid", "murcia": "Región de Murcia", "region de murcia": "Región de Murcia",
    "navarra": "Navarra", "pais vasco": "País Vasco", "euskadi": "País Vasco", "ceuta": "Ceuta", "melilla": "Melilla",
}


def fold(s: str) -> str:
    """minúsculas, sin acentos, sólo alfanumérico y espacios."""
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", " ", s).strip()


_LOOKUP = {}
for _name, (_ccaa, _la, _lo, _al) in PROVINCES.items():
    for _k in [_name, *_al]:
        _LOOKUP[fold(_k)] = _name


def norm_province(s: str):
    if not s:
        return None
    f = fold(s)
    if f in _LOOKUP:
        return _LOOKUP[f]
    for part in re.split(r"[/,()-]", s):
        p = fold(part)
        if p in _LOOKUP:
            return _LOOKUP[p]
    return None


def norm_ccaa(s: str):
    return CCAA_ALIASES.get(fold(s)) if s else None


def ccaa_of(province):
    return PROVINCES[province][0] if province in PROVINCES else None


def centroid(province):
    if province in PROVINCES:
        _, la, lo, _ = PROVINCES[province]
        return la, lo
    return None


def in_spain(lat, lon):
    """Caja aproximada Península+Baleares+Canarias+Ceuta/Melilla."""
    if lat is None or lon is None:
        return False
    return (35.0 <= lat <= 44.0 and -9.6 <= lon <= 4.6) or (27.4 <= lat <= 29.5 and -18.3 <= lon <= -13.2)


# ------------------------------------------------ provincia por polígono (IGN / es-atlas)
_POLYS = None


def _load_polys():
    import json
    import os
    global _POLYS
    path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "web", "data", "spain.geo.json")
    _POLYS = []
    with open(path, encoding="utf-8") as f:
        for feat in json.load(f)["features"]:
            prov = norm_province(feat["properties"]["n"])
            if not prov:
                continue
            g = feat["geometry"]
            polys = [g["coordinates"]] if g["type"] == "Polygon" else g["coordinates"]
            for rings in polys:
                xs = [p[0] for p in rings[0]]
                ys = [p[1] for p in rings[0]]
                _POLYS.append((prov, (min(xs), min(ys), max(xs), max(ys)), rings))


def _in_ring(x, y, ring):
    inside = False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i]
        xj, yj = ring[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / ((yj - yi) or 1e-12) + xi:
            inside = not inside
        j = i
    return inside


def province_at(lat, lon):
    """Provincia que contiene el punto; si cae fuera (costa, polígono simplificado), la más cercana."""
    if lat is None or lon is None:
        return None
    if _POLYS is None:
        _load_polys()
    for prov, (x0, y0, x1, y1), rings in _POLYS:
        if x0 <= lon <= x1 and y0 <= lat <= y1 and _in_ring(lon, lat, rings[0]) \
                and not any(_in_ring(lon, lat, h) for h in rings[1:]):
            return prov
    best, bd = None, 1e9
    for prov, (x0, y0, x1, y1), rings in _POLYS:
        cx, cy = min(max(lon, x0), x1), min(max(lat, y0), y1)
        d = (cx - lon) ** 2 + (cy - lat) ** 2
        if d < bd:
            best, bd = prov, d
    return best if bd < 0.25 else None
