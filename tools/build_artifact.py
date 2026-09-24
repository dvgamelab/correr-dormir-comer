"""Genera una versión de la app apta para publicarse como Artifact de Claude
(sin <html>/<head>/<body>, CSS en línea, sin service worker ni manifest)."""
import os
import re
import shutil

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WEB = os.path.join(ROOT, "web")
OUT = os.path.join(ROOT, "dist-artifact")
PUBLIC_URL = os.environ.get("CDC_PUBLIC_URL", "")

html = open(os.path.join(WEB, "index.html"), encoding="utf-8").read()
css = "".join(open(os.path.join(WEB, f), encoding="utf-8").read() for f in ("vendor-leaflet.css", "app.css"))
html = re.sub(r"<!doctype html>\s*|</?html[^>]*>|</?head>|</?body>|<meta[^>]*>", "", html, flags=re.I)
html = re.sub(r'<link rel="(manifest|icon|preconnect)"[^>]*>\s*', "", html)
html = html.replace('<link rel="stylesheet" href="vendor-leaflet.css">\n<link rel="stylesheet" href="app.css">', f"<style>{css}</style>")
html = html.replace('<script src="app.js"></script>', f'<script>window.CDC_EMBED=true;window.CDC_PUBLIC_URL={PUBLIC_URL!r};</script>\n<script src="app.js"></script>')
shutil.rmtree(OUT, ignore_errors=True)
os.makedirs(os.path.join(OUT, "data"))
open(os.path.join(OUT, "index.html"), "w", encoding="utf-8").write(html.strip() + "\n")
for f in ("app.js", "data/races.json", "data/spain.geo.json"):
    shutil.copy(os.path.join(WEB, f), os.path.join(OUT, f))
print("OK →", OUT)
