// Tarea en segundo plano de la APK (Capacitor Background Runner).
// Cada cierto tiempo descarga data/news.json y avisa de las carreras nuevas que encajen con las alertas.
// Cada evento se ejecuta en un contexto nuevo: el estado vive en CapacitorKV.

function kvGet(k, def) {
  try { const v = CapacitorKV.get(k); const s = v && v.value; return s ? JSON.parse(s) : def; } catch (e) { return def; }
}
function kvSet(k, v) { CapacitorKV.set(k, JSON.stringify(v)); }

function fold(s) {
  s = String(s || "").toLowerCase();
  try { s = s.normalize("NFD").replace(/[̀-ͯ]/g, ""); } catch (e) { /* sin normalize */ }
  return s;
}
function haversine(a, b, c, d) {
  const R = 6371, r = Math.PI / 180, x = (c - a) * r, y = (d - b) * r;
  const h = Math.sin(x / 2) ** 2 + Math.cos(a * r) * Math.cos(c * r) * Math.sin(y / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
// misma lógica que matchAlert() de la app
function matchAlert(r, a) {
  if (a.surf && a.surf.length && a.surf.indexOf(r.surface || "road") < 0) return false;
  if (a.cats && a.cats.length) {
    const cs = (r.cats || []).filter(c => c !== "trail");
    if (!a.cats.some(c => (c === "other" ? !cs.length : cs.indexOf(c) >= 0))) return false;
  }
  if (a.ccaa && r.ccaa !== a.ccaa) return false;
  if (a.prov && r.province !== a.prov) return false;
  if (a.near && (!r.lat || haversine(a.near.lat, a.near.lon, r.lat, r.lon) > a.nearKm)) return false;
  if (a.q) {
    const s = fold(r.name + " " + (r.city || "") + " " + (r.province || ""));
    if (!fold(a.q).split(/\s+/).filter(Boolean).every(w => s.indexOf(w) >= 0)) return false;
  }
  return true;
}
function fmtDate(d) {
  const m = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
  const p = String(d || "").split("-");
  return p.length === 3 ? +p[2] + " " + m[+p[1] - 1] : "";
}

// La app manda aquí el modo (alerts | all | off), las alertas y la última novedad que ya ha visto
addEventListener("setPrefs", (resolve, reject, args) => {
  try {
    const p = args || {};
    kvSet("prefs", { mode: p.mode || "all", alerts: p.alerts || [], newsUrl: p.newsUrl });
    const last = kvGet("lastNotified", "");
    if (p.since && p.since > last) kvSet("lastNotified", p.since);
    resolve();
  } catch (e) { reject(e); }
});

addEventListener("checkNew", async (resolve, reject) => {
  try {
    const prefs = kvGet("prefs", null);
    if (!prefs || !prefs.newsUrl || prefs.mode === "off") return resolve();
    const res = await fetch(prefs.newsUrl + "?t=" + Date.now());
    if (!res.ok) return resolve();
    const data = await res.json();
    const last = kvGet("lastNotified", "");
    const fresh = (data.races || []).filter(r => r.added && r.added > last);
    if (!fresh.length) return resolve();
    kvSet("lastNotified", fresh.reduce((m, r) => (r.added > m ? r.added : m), last));
    const hits = prefs.mode === "alerts" ? fresh.filter(r => (prefs.alerts || []).some(a => matchAlert(r, a))) : fresh;
    if (!hits.length) return resolve();
    hits.sort((a, b) => (a.date < b.date ? -1 : 1));
    const line = r => r.name + " · " + fmtDate(r.date) + (r.city ? " · " + r.city : "");
    const title = hits.length === 1 ? "Nueva carrera: " + hits[0].name
      : hits.length + " carreras nuevas" + (prefs.mode === "alerts" ? " para tus alertas" : "");
    const body = hits.length === 1 ? fmtDate(hits[0].date) + (hits[0].city ? " · " + hits[0].city : "") + ". Mira si ya hay inscripciones."
      : hits.slice(0, 3).map(r => r.name).join(", ") + (hits.length > 3 ? "…" : "");
    CapacitorNotifications.schedule([{
      id: Math.floor(Date.now() / 1000) % 2000000000,
      title: title,
      body: body,
      largeBody: hits.slice(0, 8).map(line).join("\n") + (hits.length > 8 ? "\n… y " + (hits.length - 8) + " más" : ""),
      scheduleAt: new Date(Date.now() + 1000),
      autoCancel: true,
    }]);
    resolve();
  } catch (e) { reject(e); }
});
