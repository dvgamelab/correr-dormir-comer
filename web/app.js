/* Correr · Dormir · Comer — app estática, sin build.
   Datos: data/races.json (generado semanalmente por scraper/run.py). */
(() => {
"use strict";

// ------------------------------------------------------------------ utils
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fold = s => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const store = {
  get(k, d) { try { const v = localStorage.getItem("cdc:" + k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem("cdc:" + k, JSON.stringify(v)); } catch { /* sin almacenamiento */ } },
};
const DAYS = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
const DAYS_L = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const MONTHS_L = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const pd = s => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const addDays = (s, n) => { const d = pd(s); d.setDate(d.getDate() + n); return iso(d); };
const fmtDate = s => { const d = pd(s); return `${DAYS_L[d.getDay()]} ${d.getDate()} de ${MONTHS_L[d.getMonth()]} ${d.getFullYear()}`; };
const fmtShort = s => { const d = pd(s); return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`; };
const today = iso(new Date());
function haversine(a, b, c, d) {
  const R = 6371, r = Math.PI / 180, x = Math.sin((c - a) * r / 2) ** 2 + Math.cos(a * r) * Math.cos(c * r) * Math.sin((d - b) * r / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}
const fmtKm = d => d == null ? "" : d < 1 ? `${Math.round(d * 1000)} m` : `${d < 10 ? d.toFixed(1) : Math.round(d)} km`;
const fmtDist = d => {
  if (Math.abs(d - 42.195) < 0.3) return "42K";
  if (Math.abs(d - 21.0975) < 0.2) return "21K";
  return (Number.isInteger(d) ? d : +d.toFixed(1)) + "K";
};
function toast(msg) {
  const t = $("#toast"); t.textContent = msg; t.hidden = false;
  clearTimeout(toast._t); toast._t = setTimeout(() => (t.hidden = true), 2600);
}
async function copy(text, okMsg = "Copiado") {
  try { await navigator.clipboard.writeText(text); toast(okMsg); return true; }
  catch { toast("No se pudo copiar: selecciona el texto y cópialo a mano"); return false; }
}

// ------------------------------------------------------------------ estado
let RACES = [], META = {}, BYID = new Map(), TOWNS = new Map();
const F = { q: "", surf: new Set(), cats: new Set(), when: "all", from: "", to: "", ccaa: "", prov: "", near: null, nearKm: 50, fav: false, mapOnly: false, ...store.get("filters", {}) };
F.surf = new Set(F.surf || []); F.cats = new Set(F.cats || []);
let favs = new Set(store.get("favs", []));
let plans = store.get("plans", {});
let filtered = [], shown = 0, selId = null, SEARCH = null;
const PLACES = new Map(); // nombre plegado → [{name, lat, lon, prov}]
const MUNI = new Set();   // nombres plegados que son municipios (no barrios)
function addPlace(name, lat, lon, prov, muni = false) {
  const k = fold(name).replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
  if (!k || lat == null) return;
  const arr = PLACES.get(k) || [];
  const i = arr.findIndex(x => haversine(x.lat, x.lon, lat, lon) < 8);
  const it = { name, lat, lon, prov, key: k, muni };
  if (i < 0) arr.push(it);
  else if (muni && !arr[i].muni) arr[i] = it; // el centro oficial del municipio manda sobre el punto de una carrera
  PLACES.set(k, arr);
}
async function loadPlaces() {
  try {
    const m = await (await fetch("data/municipios.json")).json();
    for (const [n, la, lo, pr] of m) {
      const variants = new Set([n, ...n.split("/")]);
      for (const v of [...variants]) { const mm = v.match(/^(.*), (el|la|los|las|l'|lo|o|a|os|as|es|sa|ses)$/i); if (mm) variants.add(`${mm[2]} ${mm[1]}`); }
      for (const v of variants) { addPlace(v.trim(), la, lo, pr, true); MUNI.add(fold(v.trim()).replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim()); }
    }
    $("#towns").innerHTML = m.map(x => `<option value="${esc(x[0].split("/")[0])}">`).join("");
    // carreras situadas en el centro de la provincia → centro de su municipio si lo encontramos
    for (const r of RACES) {
      if (!r.approx || !r.city) continue;
      const k = fold(r.city).replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
      const c = (PLACES.get(k) || []).filter(x => x.muni && (!r.province || !x.prov || x.prov === r.province));
      if (c.length === 1) { r.lat = c[0].lat; r.lon = c[0].lon; r.approx = false; }
    }
    apply();
  } catch { /* sin municipios: se usan los pueblos de las carreras */ }
}
function findPlace(q) {
  const k = fold(q).replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
  if (k.length < 3) return null;
  const c = PLACES.get(k);
  if (!c?.length) return null;
  if (c.length === 1) return { ...c[0], alts: [] };
  // mismo nombre en varias provincias: se elige la del filtro de provincia/comunidad o la que tiene más carreras cerca
  const score = x => (F.prov && x.prov === F.prov ? 1e6 : 0) + RACES.filter(r => r.lat && haversine(x.lat, x.lon, r.lat, r.lon) < 15).length;
  const sorted = [...c].sort((a, b) => score(b) - score(a));
  const pick = sorted.find(x => x.prov === SEARCH_PROV) || sorted[0];
  return { ...pick, alts: sorted.filter(x => x !== pick) };
}
let SEARCH_PROV = "";
const PAGE = 120;

function saveFilters() { store.set("filters", { ...F, surf: [...F.surf], cats: [...F.cats], near: null }); }

// ------------------------------------------------------------------ carga
// En la app Android los datos vienen incluidos; si hay internet se intenta la versión semanal publicada.
async function fetchRaces() {
  const remote = window.CDC_DATA_URL;
  if (remote) {
    try {
      const ctl = new AbortController(), to = setTimeout(() => ctl.abort(), 6000);
      const r = await fetch(remote, { cache: "no-cache", signal: ctl.signal }).finally(() => clearTimeout(to));
      if (r.ok) { const d = await r.json(); if (d.races?.length) return d; }
    } catch { /* sin conexión: datos incluidos */ }
  }
  const r = await fetch("data/races.json", { cache: "no-cache" });
  return r.json();
}
async function load() {
  try {
    const d = await fetchRaces();
    META = d.meta || {}; RACES = (d.races || []).filter(x => x.date >= today);
  } catch (e) {
    $("#count").textContent = "No se pudieron cargar las carreras.";
    console.error(e); return;
  }
  const unamp = u => u && u.replace(/&amp;/g, "&");
  for (const r of RACES) {
    BYID.set(r.id, r);
    r.img = unamp(r.img); r.web = unamp(r.web); r.reg = unamp(r.reg);
    r._s = fold(`${r.name} ${r.city || ""} ${r.province || ""} ${r.ccaa || ""}`);
    r._nc = fold(`${r.name} ${r.city || ""}`).replace(/[^a-z0-9 ]+/g, " ");
    if (r.city && r.lat && !r.approx) { const k = fold(r.city); if (!TOWNS.has(k)) TOWNS.set(k, { name: r.city, lat: r.lat, lon: r.lon }); }
  }
  // capitales de provincia como sitios "cerca de"
  for (const [n, la, lo] of CAPITALS) if (!TOWNS.has(fold(n))) TOWNS.set(fold(n), { name: n, lat: la, lon: lo });
  for (const t of TOWNS.values()) addPlace(t.name, t.lat, t.lon, "");
  $("#towns").innerHTML = [...TOWNS.values()].sort((a, b) => a.name.localeCompare(b.name, "es")).map(t => `<option value="${esc(t.name)}">`).join("");
  const cc = [...new Set(RACES.map(r => r.ccaa).filter(Boolean))].sort((a, b) => a.localeCompare(b, "es"));
  $("#ccaa").insertAdjacentHTML("beforeend", cc.map(c => `<option>${esc(c)}</option>`).join(""));
  fillProvinces();
  renderFoot();
  syncFilterUI();
  initMap();
  apply();
  handleIncomingPlan();
  loadPlaces();
}

const CAPITALS = [["Madrid", 40.4168, -3.7038], ["Barcelona", 41.3874, 2.1686], ["Valencia", 39.4699, -0.3763], ["Sevilla", 37.3891, -5.9845], ["Zaragoza", 41.6488, -0.8891], ["Málaga", 36.7213, -4.4214], ["Murcia", 37.9922, -1.1307], ["Palma", 39.5696, 2.6502], ["Bilbao", 43.263, -2.935], ["Alicante", 38.3452, -0.481], ["Córdoba", 37.8882, -4.7794], ["Valladolid", 41.6523, -4.7245], ["Vigo", 42.2406, -8.7207], ["Gijón", 43.5322, -5.6611], ["A Coruña", 43.3623, -8.4115], ["Granada", 37.1773, -3.5986], ["Vitoria-Gasteiz", 42.8467, -2.6716], ["Oviedo", 43.3614, -5.8593], ["Pamplona", 42.8125, -1.6458], ["Santander", 43.4623, -3.81], ["San Sebastián", 43.3183, -1.9812], ["Logroño", 42.4627, -2.445], ["Salamanca", 40.9701, -5.6635], ["Burgos", 42.3439, -3.6969], ["León", 42.5987, -5.5671], ["Cáceres", 39.4753, -6.3724], ["Badajoz", 38.8794, -6.9707], ["Toledo", 39.8628, -4.0273], ["Albacete", 38.9943, -1.8585], ["Almería", 36.834, -2.4637], ["Huelva", 37.2614, -6.9447], ["Cádiz", 36.527, -6.2886], ["Jaén", 37.7796, -3.7849], ["Girona", 41.9794, 2.8214], ["Lleida", 41.6176, 0.62], ["Tarragona", 41.1189, 1.2445], ["Castellón de la Plana", 39.9864, -0.0513], ["Huesca", 42.1401, -0.4089], ["Teruel", 40.3456, -1.1065], ["Soria", 41.7636, -2.4649], ["Segovia", 40.9429, -4.1088], ["Ávila", 40.6565, -4.6818], ["Zamora", 41.5033, -5.7446], ["Palencia", 42.0095, -4.5288], ["Cuenca", 40.0704, -2.1374], ["Guadalajara", 40.6333, -3.1667], ["Ciudad Real", 38.9848, -3.9274], ["Lugo", 43.0097, -7.556], ["Ourense", 42.3358, -7.8639], ["Pontevedra", 42.431, -8.6444], ["Santa Cruz de Tenerife", 28.4636, -16.2518], ["Las Palmas de Gran Canaria", 28.1235, -15.4363]];

function fillProvinces() {
  const ps = [...new Set(RACES.filter(r => !F.ccaa || r.ccaa === F.ccaa).map(r => r.province).filter(Boolean))].sort((a, b) => a.localeCompare(b, "es"));
  if (F.prov && !ps.includes(F.prov)) F.prov = "";
  $("#prov").innerHTML = `<option value="">Todas</option>` + ps.map(p => `<option ${p === F.prov ? "selected" : ""}>${esc(p)}</option>`).join("");
}

// ------------------------------------------------------------------ filtros
function weekendRange(offset) {
  const d = new Date(); const dow = d.getDay(); // 0 dom
  const toSat = dow === 0 ? -1 : 6 - dow;
  const sat = new Date(d); sat.setDate(d.getDate() + toSat + offset * 7);
  const fri = new Date(sat); fri.setDate(sat.getDate() - 1);
  const sun = new Date(sat); sun.setDate(sat.getDate() + 1);
  return [iso(fri) < today ? today : iso(fri), iso(sun)];
}
function dateWindow() {
  switch (F.when) {
    case "thisw": return weekendRange(0);
    case "nextw": return weekendRange(1);
    case "30": return [today, addDays(today, 30)];
    case "90": return [today, addDays(today, 90)];
    case "custom": return [F.from || today, F.to || "9999"];
    default: return [today, "9999"];
  }
}
function catOf(r) {
  const c = r.cats || [];
  return c.filter(x => x !== "trail");
}
function apply() {
  const [a, b] = dateWindow();
  let q = fold(F.q).trim().split(/\s+/).filter(Boolean);
  const bounds = F.mapOnly && map ? map.getBounds() : null;
  const place = F.q ? findPlace(F.q) : null;
  SEARCH = place ? { place, R: F.searchKm || 30 } : null;
  if (SEARCH) q = [];
  filtered = RACES.filter(r => {
    if (r.date < a || r.date > b) return false;
    if (F.surf.size && !F.surf.has(r.surface || "road")) return false;
    if (F.cats.size) {
      const cs = catOf(r);
      const ok = [...F.cats].some(c => c === "other" ? cs.length === 0 : cs.includes(c));
      if (!ok) return false;
    }
    if (F.ccaa && r.ccaa !== F.ccaa) return false;
    if (F.prov && r.province !== F.prov) return false;
    if (F.fav && !favs.has(r.id)) return false;
    if (q.length && !q.every(w => r._s.includes(w))) return false;
    if (SEARCH) {
      const pl = SEARCH.place;
      r._d = r.lat ? haversine(pl.lat, pl.lon, r.lat, r.lon) : null;
      const ck = fold(r.city || "").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
      const otherMuni = ck && ck !== pl.key && MUNI.has(ck); // es de otro municipio (aunque esté al lado)
      const inTown = ck === pl.key || new RegExp(`\\b${pl.key}\\b`).test(r._nc) ||
        (!otherMuni && r._d != null && r._d <= 6 && !r.approx); // barrios o sin pueblo: por cercanía
      if (inTown) r._grp = "in";
      else if (r._d != null && r._d <= SEARCH.R && !r.approx) r._grp = "near";
      else return false;
    } else if (F.near) {
      r._grp = null;
      if (!r.lat) return false;
      r._d = haversine(F.near.lat, F.near.lon, r.lat, r.lon);
      if (r._d > F.nearKm) return false;
    } else { r._d = null; r._grp = null; }
    if (bounds && (!r.lat || !bounds.contains([r.lat, r.lon]))) return false;
    return true;
  });
  if (SEARCH) filtered.sort((a, b) => (a._grp === b._grp ? 0 : a._grp === "in" ? -1 : 1) ||
    (a._grp === "near" ? a._d - b._d : 0) || a.date.localeCompare(b.date)); // primero el municipio, luego lo cercano por distancia
  shown = 0;
  $("#list").innerHTML = SEARCH ? searchBanner() : "";
  renderMore();
  const n = filtered.length;
  $("#count").innerHTML = `<span class="num">${n.toLocaleString("es-ES")}</span><span class="lbl">${n === 1 ? "carrera" : "carreras"}${F.fav ? " favoritas" : ""}</span>`;
  $("#applyFilters").textContent = `Ver ${n.toLocaleString("es-ES")} ${n === 1 ? "carrera" : "carreras"}`;
  $("#filtersBadge").hidden = !(F.when !== "all" || F.ccaa || F.prov || F.near || F.mapOnly);
  $$(".chip[data-when]").forEach(b => b.classList.toggle("on", F.when === b.dataset.when));
  drawMarkers();
  if (map && !$("#viewMap").hidden && !F.mapOnly) { mapTouched = false; fitToResults(); }
  saveFilters();
}

function syncFilterUI() {
  $("#q").value = F.q;
  $$(".chip[data-surface]").forEach(b => b.classList.toggle("on", F.surf.has(b.dataset.surface)));
  $$(".chip[data-cat]").forEach(b => b.classList.toggle("on", F.cats.has(b.dataset.cat)));
  $("#when").value = F.when; $("#dateRange").hidden = F.when !== "custom";
  $("#dFrom").value = F.from; $("#dTo").value = F.to;
  $("#ccaa").value = F.ccaa; $("#nearKm").value = String(F.nearKm);
  fillProvinces();
  $("#mapFilter").checked = F.mapOnly;
}

function bindFilters() {
  let t;
  $("#q").addEventListener("input", e => { clearTimeout(t); t = setTimeout(() => { F.q = e.target.value; apply(); }, 180); });
  $$(".chip[data-surface]").forEach(b => b.addEventListener("click", () => { toggleSet(F.surf, b.dataset.surface); b.classList.toggle("on"); apply(); }));
  $$(".chip[data-cat]").forEach(b => b.addEventListener("click", () => { toggleSet(F.cats, b.dataset.cat); b.classList.toggle("on"); apply(); }));
  $("#when").addEventListener("change", e => { F.when = e.target.value; $("#dateRange").hidden = F.when !== "custom"; apply(); });
  $("#dFrom").addEventListener("change", e => { F.from = e.target.value; apply(); });
  $("#dTo").addEventListener("change", e => { F.to = e.target.value; apply(); });
  $("#ccaa").addEventListener("change", e => { F.ccaa = e.target.value; fillProvinces(); apply(); });
  $("#prov").addEventListener("change", e => { F.prov = e.target.value; apply(); });
  $$(".chip[data-when]").forEach(b => b.addEventListener("click", () => { F.when = F.when === b.dataset.when ? "all" : b.dataset.when; syncFilterUI(); apply(); }));
  $("#openFilters").addEventListener("click", () => openFilterSheet(true));
  $("#scrim").addEventListener("click", () => openFilterSheet(false));
  $("#applyFilters").addEventListener("click", () => { openFilterSheet(false); $("#viewList").scrollTop = 0; });
  $("#useGps").addEventListener("click", () => {
    if (!navigator.geolocation) return toast("Este navegador no da la ubicación; escribe tu pueblo");
    $("#useGps").textContent = "Buscando tu ubicación…";
    navigator.geolocation.getCurrentPosition(pos => {
      F.near = { name: "Mi ubicación", lat: pos.coords.latitude, lon: pos.coords.longitude };
      $("#nearTown").value = "Mi ubicación"; $("#useGps").textContent = "Usar mi ubicación"; apply();
    }, () => { $("#useGps").textContent = "Usar mi ubicación"; toast("No se pudo obtener la ubicación; escribe tu pueblo"); }, { timeout: 10000, maximumAge: 600000 });
  });
  $("#nearTown").addEventListener("change", e => {
    const v = fold(e.target.value.trim());
    const pl = v ? findPlace(v) : null;
    F.near = pl ? { name: pl.name, lat: pl.lat, lon: pl.lon } : v ? (TOWNS.get(v) || [...TOWNS.values()].find(x => fold(x.name).startsWith(v)) || null) : null;
    if (v && !F.near) toast("No encuentro ese lugar; prueba con una capital de provincia");
    if (F.near) { e.target.value = F.near.name; map && map.setView([F.near.lat, F.near.lon], F.nearKm > 100 ? 7 : 9); }
    apply();
  });
  $("#nearKm").addEventListener("change", e => { F.nearKm = +e.target.value; apply(); });
  $("#mapFilter").addEventListener("change", e => { F.mapOnly = e.target.checked; apply(); });
  $("#clearFilters").addEventListener("click", () => {
    Object.assign(F, { q: "", when: "all", from: "", to: "", ccaa: "", prov: "", near: null, mapOnly: false });
    F.surf.clear(); F.cats.clear(); $("#nearTown").value = ""; syncFilterUI(); apply();
  });
  $("#more").addEventListener("click", renderMore);
  new IntersectionObserver(es => { if (es[0].isIntersecting && shown < filtered.length) renderMore(); }, { root: $("#viewList"), rootMargin: "600px" }).observe($("#more"));
}
const toggleSet = (s, v) => (s.has(v) ? s.delete(v) : s.add(v));
function openFilterSheet(on) { $("#filterSheet").hidden = !on; $("#scrim").hidden = !on; }

// ------------------------------------------------------------------ lista
function weekKey(s) { // lunes de esa semana
  const d = pd(s); const dow = (d.getDay() + 6) % 7; d.setDate(d.getDate() - dow); return iso(d);
}
function weekLabel(mon) {
  const sat = pd(addDays(mon, 5)), sun = pd(addDays(mon, 6));
  const tw = weekendRange(0)[1], nw = weekendRange(1)[1];
  const tag = iso(sun) === tw ? "Este finde" : iso(sun) === nw ? "Próximo finde" : "Finde";
  const rng = sat.getMonth() === sun.getMonth() ? `${sat.getDate()}–${sun.getDate()} ${MONTHS[sun.getMonth()]}` : `${sat.getDate()} ${MONTHS[sat.getMonth()]} – ${sun.getDate()} ${MONTHS[sun.getMonth()]}`;
  return `${tag} <b>${rng}</b>${sun.getFullYear() !== new Date().getFullYear() ? " " + sun.getFullYear() : ""}`;
}
function cardHTML(r) {
  const d = pd(r.date);
  const surf = r.surface === "trail" ? "trail" : "road";
  const dists = (r.dist || []).slice(0, 6).map(x => {
    const hl = (F.cats.has("5k") && x >= 4.5 && x <= 5.5) || (F.cats.has("10k") && x >= 9.5 && x <= 10.5) || (F.cats.has("21k") && x > 20.5 && x < 21.6) || (F.cats.has("42k") && x > 41.5 && x < 42.7) || (F.cats.has("ultra") && x > 43);
    return `<span class="km${hl ? " hl" : ""}">${fmtDist(x)}</span>`;
  }).join("") + ((r.dist || []).length > 6 ? `<span class="km">+${r.dist.length - 6}</span>` : "");
  const where = [r.city, r.province && r.province !== r.city ? r.province : ""].filter(Boolean).join(", ");
  const grp = r._grp ? " " + r._grp : "";
  return `<article class="card${grp}${r.id === selId ? " sel" : ""}" data-id="${r.id}" tabindex="0">
    <div class="bib ${surf}"><span class="d">${d.getDate()}</span><span class="m">${DAYS[d.getDay()]}<br>${MONTHS[d.getMonth()]}</span></div>
    <div>
      <h3>${esc(r.name)}</h3>
      <div class="where"><span class="pill ${surf}">${surf === "trail" ? "Trail" : "Asfalto"}</span><span>${esc(where || "Ubicación por confirmar")}</span>${r._d != null && r._grp !== "in" ? `<span class="away">a ${fmtKm(r._d)}</span>` : ""}</div>
      ${dists ? `<div class="dists">${dists}</div>` : ""}
    </div>
    <button class="fav${favs.has(r.id) ? " on" : ""}" data-fav="${r.id}" type="button" aria-label="Favorita" aria-pressed="${favs.has(r.id)}">${favs.has(r.id) ? "♥" : "♡"}</button>
  </article>`;
}
function searchBanner() {
  const { place, R } = SEARCH;
  const nIn = filtered.filter(r => r._grp === "in").length;
  return `<div class="search-banner">
    <div><b>${esc(place.name)}</b>${place.prov ? ` <span class="muted">· ${esc(place.prov)}</span>` : ""}</div>
    ${place.alts.length ? `<div class="alts">¿Otro ${esc(place.name)}? ${place.alts.slice(0, 4).map(a => `<button class="chip small" type="button" data-alt-prov="${esc(a.prov)}">${esc(a.prov || "otro")}</button>`).join("")}</div>` : ""}
    <div class="radius">Cercanas hasta ${[10, 20, 30, 50, 100].map(k => `<button class="chip small${k === R ? " on" : ""}" type="button" data-radius="${k}">${k} km</button>`).join("")}</div>
    ${nIn ? "" : `<p class="small muted" style="margin:6px 0 0">No hay carreras en ${esc(place.name)} con estos filtros; te enseño las cercanas.</p>`}
  </div>`;
}
function groupOf(r) { return SEARCH ? r._grp : weekKey(r.date); }
function groupHeader(g) {
  const n = filtered.filter(x => groupOf(x) === g).length;
  if (!SEARCH) return `<h2 class="wk-h">${weekLabel(g)}<span class="n">${n}</span></h2>`;
  const pl = SEARCH.place.name;
  return g === "in"
    ? `<h2 class="sec-h in"><span class="sec-dot"></span>En ${esc(pl)}<span class="n">${n}</span></h2>`
    : `<h2 class="sec-h near"><span class="sec-dot"></span>Cerca de ${esc(pl)} · por distancia<span class="n">${n}</span></h2>`;
}
function renderMore() {
  const list = $("#list");
  if (!filtered.length) { list.insertAdjacentHTML("beforeend", `<p class="empty">Ninguna carrera con esos filtros. Prueba a ampliar fechas o radio.</p>`); $("#more").hidden = true; return; }
  const slice = filtered.slice(shown, shown + PAGE);
  const lastEl = [...list.children].reverse().find(x => x.classList.contains("wk"));
  let html = "", lastG = lastEl?.dataset.wk, group = null;
  for (const r of slice) {
    const g = groupOf(r);
    if (g !== lastG) {
      if (group) html += "</div>";
      html += `<div class="wk${SEARCH ? " sec " + g : ""}" data-wk="${g}">${groupHeader(g)}`;
      group = g; lastG = g;
    } else if (!group) { lastEl.insertAdjacentHTML("beforeend", cardHTML(r)); continue; }
    html += cardHTML(r);
  }
  if (group) html += "</div>";
  list.insertAdjacentHTML("beforeend", html);
  shown += slice.length;
  $("#more").hidden = shown >= filtered.length;
}
function bindList() {
  $("#list").addEventListener("click", e => {
    const rad = e.target.closest("[data-radius]");
    if (rad) { F.searchKm = +rad.dataset.radius; apply(); return; }
    const alt = e.target.closest("[data-alt-prov]");
    if (alt) { SEARCH_PROV = alt.dataset.altProv; apply(); return; }
    const f = e.target.closest("[data-fav]");
    if (f) { e.stopPropagation(); toggleFav(f.dataset.fav); return; }
    const c = e.target.closest(".card"); if (c) openRace(c.dataset.id, true);
  });
  $("#list").addEventListener("keydown", e => { if (e.key === "Enter") { const c = e.target.closest(".card"); if (c) openRace(c.dataset.id, true); } });
}
function toggleFav(id) {
  toggleSet(favs, id); store.set("favs", [...favs]);
  $$(`[data-fav="${id}"]`).forEach(b => { const on = favs.has(id); b.classList.toggle("on", on); b.textContent = on ? "♥" : "♡"; b.setAttribute("aria-pressed", on); });
  if (F.fav) apply();
}
function renderFoot() {
  const g = META.generated ? new Date(META.generated) : null;
  const src = Object.entries(META.sources || {}).map(([k, v]) => `${esc(v.label)} (${v.count ?? "?"}${v.ok === false ? ", fallo en la última lectura" : ""})`).join(" · ");
  $("#dataFoot").innerHTML = `Datos actualizados ${g ? g.toLocaleDateString("es-ES", { day: "numeric", month: "long", year: "numeric" }) : "—"}. ${(META.count || RACES.length).toLocaleString("es-ES")} carreras únicas tras unir fuentes: ${src}. Verifica siempre fecha y horario en la web oficial.`;
}

// ------------------------------------------------------------------ mapa
let map, markerLayer, canvasR, tilesOK = true;
function baseLayers(m) {
  // Silueta de provincias bajo todo: si las teselas de OSM no cargan (sin red, CSP), el mapa sigue siendo legible.
  m.createPane("land"); m.getPane("land").style.zIndex = 150; m.getPane("land").style.pointerEvents = "none";
  let geoLayer = null, failed = false;
  const paint = () => geoLayer && geoLayer.setStyle({ fillOpacity: failed ? 1 : 0, opacity: failed ? 1 : 0.5 });
  fetch("data/spain.geo.json").then(r => r.json()).then(g => {
    geoLayer = L.geoJSON(g, { pane: "land", interactive: false, style: () => ({ color: getCss("--line"), weight: 1, fillColor: getCss("--map-land"), fillOpacity: 0 }) }).addTo(m);
    paint();
  }).catch(() => {});
  const tiles = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 18, attribution: "© OpenStreetMap" });
  let errs = 0, oks = 0;
  tiles.on("tileload", () => oks++);
  tiles.on("tileerror", () => { if (++errs >= 3 && oks === 0 && !failed) { failed = true; tilesOK = false; m.removeLayer(tiles); paint(); } });
  if (tilesOK) tiles.addTo(m); else { failed = true; }
  return tiles;
}
const getCss = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
function initMap() {
  if (!window.L) { $("#map").innerHTML = `<p class="empty">No se pudo cargar el mapa.</p>`; return; }
  canvasR = L.canvas({ padding: 0.3 });
  const HOVER = matchMedia("(hover: hover)").matches;
  map = L.map("map", { preferCanvas: true, zoomControl: true, worldCopyJump: false }).setView([40.2, -3.6], 6);
  baseLayers(map);
  markerLayer = L.layerGroup().addTo(map);
  map.on("moveend", () => { if (F.mapOnly) apply(); });
  map.on("click", e => pickAt(e.containerPoint)); // toque: carreras bajo el dedo
  if (HOVER) map.on("mousemove", e => { map.getContainer().style.cursor = hitsAt(e.containerPoint, 10).length ? "pointer" : ""; });
  map.on("dragstart zoomstart", e => { if (e.originalEvent || map._userAction) mapTouched = true; });
  map.getContainer().addEventListener("pointerdown", () => { mapTouched = true; });
}
let mapTouched = false;
function fitToResults() { // encuadra lo filtrado (o la península si hay muchos puntos dispersos)
  const pts = filtered.filter(r => r.lat).map(r => [r.lat, r.lon]);
  if (F.near) map.setView([F.near.lat, F.near.lon], F.nearKm > 100 ? 7 : F.nearKm > 40 ? 8 : 9);
  else if (pts.length && pts.length < 400) map.fitBounds(pts, { padding: [30, 30], maxZoom: 11 });
  else map.fitBounds([[36.0, -9.3], [43.8, 3.3]]);
}
function drawMarkers() {
  if (!map) return;
  markerLayer.clearLayers();
  const road = getCss("--road"), trail = getCss("--trail"), approx = getCss("--approx");
  for (const r of filtered) {
    if (!r.lat) continue;
    const col = r.surface === "trail" ? trail : road;
    const m = L.circleMarker([r.lat, r.lon], {
      renderer: canvasR, radius: r.id === selId ? 9 : 5.5, weight: r.id === selId ? 3 : 1.2,
      color: r.approx ? approx : "#fff", fillColor: r.approx ? approx : col, fillOpacity: r.approx ? 0.55 : 0.9,
      dashArray: r.approx ? "2 2" : null,
    });
    m.addTo(markerLayer);
  }
  if (SEARCH) { // municipio buscado y radio de "cercanas"
    const pl = SEARCH.place, acc = getCss("--accent");
    L.circle([pl.lat, pl.lon], { radius: SEARCH.R * 1000, color: acc, weight: 1.5, dashArray: "6 6", fillOpacity: 0.04, interactive: false }).addTo(markerLayer);
    L.marker([pl.lat, pl.lon], { interactive: false, icon: L.divIcon({ className: "", html: `<div class="pin run">${ICON_RUN}</div>`, iconSize: [30, 30], iconAnchor: [15, 30] }) }).addTo(markerLayer);
  }
}
function hitsAt(pt, px) {
  const out = [];
  for (const r of filtered) {
    if (!r.lat) continue;
    const q = map.latLngToContainerPoint([r.lat, r.lon]);
    const d = Math.hypot(q.x - pt.x, q.y - pt.y);
    if (d <= px) out.push([d, r]);
  }
  return out.sort((a, b) => a[0] - b[0] || a[1].date.localeCompare(b[1].date)).map(x => x[1]);
}
function pickAt(pt) {
  let hits = hitsAt(pt, 22);
  if (!hits.length) { if ($("#mapCard")) $("#mapCard").hidden = true; selId = null; drawMarkers(); return; }
  // todas las carreras en ese mismo punto (mismo pueblo) aunque el dedo caiga en una
  const f = hits[0];
  hits = [...new Set([...hits, ...filtered.filter(r => r.lat === f.lat && r.lon === f.lon)])].sort((a, b) => a.date.localeCompare(b.date));
  showMapCard(hits);
}

function showMapCard(list) {
  selId = list[0].id; drawMarkers();
  let box = $("#mapCard");
  if (!box) {
    box = document.createElement("div"); box.id = "mapCard"; box.className = "map-card"; $("#viewMap").appendChild(box);
    box.addEventListener("click", e => {
      if (e.target.closest("[data-close]")) { box.hidden = true; selId = null; drawMarkers(); return; }
      const fv = e.target.closest("[data-fav]"); if (fv) { e.stopPropagation(); toggleFav(fv.dataset.fav); return; }
      const c = e.target.closest(".card"); if (c) openRace(c.dataset.id);
    });
  }
  const place = list[0].city || list[0].province || "";
  box.innerHTML = `<div class="map-card-h"><b>${list.length === 1 ? "1 carrera" : `${list.length} carreras`}${place ? ` · ${esc(place)}` : ""}</b><button class="x small-x" type="button" data-close aria-label="Cerrar">✕</button></div>
    <div class="map-card-list">${list.map(cardHTML).join("")}</div>`;
  box.hidden = false;
}

// ------------------------------------------------------------------ pantallas y botón "atrás"
// Pantallas apiladas (ficha, plan, visor). El botón "atrás" del móvil cierra lo último abierto;
// después vuelve a la pestaña Carreras, limpia la búsqueda y solo sale de la app con una segunda pulsación.
const STACK = [];
function pushScreen(name, close) { STACK.push({ name, close }); }
function popScreen(name) {
  const i = STACK.map(x => x.name).lastIndexOf(name);
  if (i >= 0) STACK.splice(i, 1)[0].close();
}
let lastBack = 0;
function handleBack() {
  if (!$("#viewer")?.hidden && $("#viewer")) { closeViewer(); return true; }
  if (!$("#filterSheet").hidden) { openFilterSheet(false); return true; }
  if (STACK.length) { STACK.pop().close(); return true; }
  if ($("#mapCard") && !$("#mapCard").hidden) { $("#mapCard").hidden = true; selId = null; drawMarkers(); return true; }
  const tab = $(".tabbar button.on")?.dataset.view;
  if (tab && tab !== "list") { setTab("list"); return true; }
  if (F.q) { F.q = ""; $("#q").value = ""; apply(); return true; }
  if (Date.now() - lastBack < 2000) return false;
  lastBack = Date.now(); toast("Pulsa atrás otra vez para salir"); return true;
}
async function initDeepLinks() { // la app se abre desde un enlace de plan (correrdormircomer://plan?c=… o la web)
  const cap = window.Capacitor?.Plugins?.App;
  if (!window.CDC_APP || !cap) return;
  const open = async u => { if (!u || !/[?&](c|plan)=/.test(u)) return; try { openSharedPlan(await decodePlan(u)); } catch { toast("El enlace del plan está incompleto o dañado"); } };
  cap.addListener("appUrlOpen", e => open(e.url));
  try { const l = await cap.getLaunchUrl(); if (l?.url) setTimeout(() => open(l.url), 800); } catch { /* sin enlace */ }
}
function initBack() {
  const cap = window.Capacitor?.Plugins?.App;
  if (window.CDC_APP && cap) { // Android nativo
    cap.addListener("backButton", () => { if (!handleBack()) cap.exitApp(); });
    return;
  }
  // navegador / PWA instalada: una entrada "guardia" en el historial que se repone mientras haya algo que cerrar
  history.pushState({ cdc: 1 }, "");
  addEventListener("popstate", () => { if (handleBack()) history.pushState({ cdc: 1 }, ""); else history.back(); });
}

// ------------------------------------------------------------------ ficha
let rmap = null;
function openRace(id) {
  const r = BYID.get(id); if (!r) return;
  selId = id;
  $$(".card.sel").forEach(c => c.classList.remove("sel"));
  $(`.card[data-id="${id}"]`)?.classList.add("sel");
  const surf = r.surface === "trail" ? "Trail / montaña" : "Asfalto";
  const where = [r.city, r.province, r.ccaa].filter(Boolean).filter((x, i, a) => a.indexOf(x) === i).join(", ");
  const off = r.web || r.reg;
  const gmaps = r.lat ? `https://www.google.com/maps/search/?api=1&query=${r.lat},${r.lon}` : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(where)}`;
  const sheet = $("#sheet");
  sheet.innerHTML = `
    <div class="bar"><button class="x" id="closeSheet" type="button" aria-label="Volver">←</button><h2>${fmtShort(r.date)}</h2>
      <button class="fav${favs.has(r.id) ? " on" : ""}" data-fav="${r.id}" type="button" aria-label="Favorita">${favs.has(r.id) ? "♥" : "♡"}</button></div>
    <div class="screen-body">
      ${r.img ? `<button class="poster" id="posterBtn" type="button" aria-label="Ver el cartel a pantalla completa"><img class="hero-img" src="${esc(r.img)}" alt="Cartel de la carrera" onerror="this.closest('.poster').remove()"><span class="zoom-hint"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4M11 8v6M8 11h6"/></svg>Ampliar</span></button>` : ""}
      <span class="pill ${r.surface === "trail" ? "trail" : "road"}">${surf}</span>
      <h1 class="race-title">${esc(r.name)}</h1>
      <dl class="facts">
        <dt>Fecha</dt><dd>${fmtDate(r.date)}${r.time ? ` · ${esc(r.time)} h` : ""}</dd>
        <dt>Lugar</dt><dd>${esc(where || "Por confirmar")}${r.approx ? ' <span class="muted small">(aprox.)</span>' : ""}</dd>
        <dt>Distancias</dt><dd>${(r.dist || []).length ? r.dist.map(d => `<span class="km">${fmtDist(d)}</span>`).join(" ") : '<span class="muted">Consultar</span>'}</dd>
        ${r.elev ? `<dt>Desnivel</dt><dd>+${r.elev} m</dd>` : ""}
        ${r.kind && !/^\d/.test(r.kind) ? `<dt>Tipo</dt><dd>${esc(r.kind)}</dd>` : ""}
      </dl>
      <button class="btn primary block" id="planIt" type="button">Planificar finde: correr · dormir · comer</button>
      ${r.lat ? `<div id="raceMap"></div>` : ""}
      ${r.desc ? `<p class="note">${esc(r.desc)}</p>` : ""}
      <div class="actions">
        ${off ? `<a class="btn ghost small" href="${esc(off)}" target="_blank" rel="noopener">Web oficial ↗</a>` : ""}
        ${r.reg && r.reg !== off ? `<a class="btn ghost small" href="${esc(r.reg)}" target="_blank" rel="noopener">Inscripción ↗</a>` : ""}
        <a class="btn ghost small" href="${gmaps}" target="_blank" rel="noopener">Cómo llegar ↗</a>
        <a class="btn ghost small" href="https://www.google.com/search?q=${encodeURIComponent(r.name + " " + pd(r.date).getFullYear())}" target="_blank" rel="noopener">Buscar en Google ↗</a>
      </div>
      <p class="src-list">Aparece en: ${(r.src || []).filter((s, i, a) => a.findIndex(x => x.n === s.n) === i).map(s => `<a href="${esc(s.u)}" target="_blank" rel="noopener">${esc(s.n)}</a>`).join(" · ")}</p>
    </div>`;
  sheet.hidden = false; sheet.scrollTop = 0;
  if (!STACK.some(x => x.name === "race")) pushScreen("race", hideRace);
  $("#closeSheet").onclick = closeSheet;
  if ($("#posterBtn")) $("#posterBtn").onclick = () => openViewer(bigImage(r.img), r.name, r.img);
  $("#planIt").onclick = () => openPlan(newPlan(r));
  sheet.querySelector("[data-fav]").onclick = e => { toggleFav(r.id); };
  if (r.lat && window.L) {
    if (rmap) { rmap.remove(); rmap = null; }
    rmap = L.map("raceMap", { preferCanvas: true, zoomControl: false, attributionControl: false, dragging: false, scrollWheelZoom: false, doubleClickZoom: false, touchZoom: false }).setView([r.lat, r.lon], r.approx ? 8 : 12);
    baseLayers(rmap);
    L.marker([r.lat, r.lon], { icon: L.divIcon({ className: "", html: `<div class="pin run">${ICON_RUN}</div>`, iconSize: [30, 30], iconAnchor: [15, 30] }) }).addTo(rmap);
  }
}
// ------------------------------------------------------------------ visor de cartel (pellizcar, doble toque, arrastrar)
const bigImage = u => (u || "").replace(/-\d+x\d+x\d+(\.\w+)(\?.*)?$/, "$1"); // runnea: miniatura → original
function openViewer(src, title, fallback) {
  let v = $("#viewer");
  if (!v) {
    v = document.createElement("div"); v.id = "viewer"; v.className = "viewer";
    v.innerHTML = `<div class="viewer-bar"><span id="viewerTitle"></span><button class="x" type="button" id="viewerClose" aria-label="Cerrar">✕</button></div><div class="viewer-stage"><img id="viewerImg" alt=""></div><p class="viewer-hint">Pellizca para ampliar · doble toque para zoom</p>`;
    $("#app").appendChild(v);
    $("#viewerClose").onclick = closeViewer;
    bindPinch(v.querySelector(".viewer-stage"), $("#viewerImg"));
  }
  const img = $("#viewerImg");
  img.onerror = () => { if (fallback && img.src !== fallback) img.src = fallback; }; // si no hay versión grande, la miniatura
  img.src = src; $("#viewerTitle").textContent = title || ""; img._reset?.();
  v.hidden = false;
}
function closeViewer() { const v = $("#viewer"); if (v) v.hidden = true; }
function bindPinch(stage, img) {
  let sc = 1, tx = 0, ty = 0, pts = new Map(), start = null, lastTap = 0;
  const apply = () => { img.style.transform = `translate(${tx}px, ${ty}px) scale(${sc})`; };
  const clamp = () => { if (sc <= 1) { sc = 1; tx = 0; ty = 0; } apply(); };
  img._reset = () => { sc = 1; tx = 0; ty = 0; apply(); };
  stage.addEventListener("pointerdown", e => {
    stage.setPointerCapture(e.pointerId); pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 1) {
      const now = Date.now();
      if (now - lastTap < 300) { // doble toque: acerca al punto tocado o vuelve
        if (sc > 1) { sc = 1; tx = 0; ty = 0; } else { const r = stage.getBoundingClientRect(); sc = 2.6; tx = (r.width / 2 - (e.clientX - r.left)) * 1.6; ty = (r.height / 2 - (e.clientY - r.top)) * 1.6; }
        apply(); lastTap = 0; return;
      }
      lastTap = now;
    }
    const [a, b] = [...pts.values()];
    start = { sc, tx, ty, a: { ...a }, d: b ? Math.hypot(a.x - b.x, a.y - b.y) : 0, m: b ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } : a };
  });
  stage.addEventListener("pointermove", e => {
    if (!pts.has(e.pointerId) || !start) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const [a, b] = [...pts.values()];
    if (b && start.d) {
      const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      sc = Math.min(6, Math.max(1, start.sc * Math.hypot(a.x - b.x, a.y - b.y) / start.d));
      tx = start.tx + (m.x - start.m.x); ty = start.ty + (m.y - start.m.y);
    } else if (sc > 1) { tx = start.tx + (a.x - start.a.x); ty = start.ty + (a.y - start.a.y); }
    apply();
  });
  const up = e => { pts.delete(e.pointerId); clamp(); const [a, b] = [...pts.values()]; start = a ? { sc, tx, ty, a: { ...a }, d: 0, m: a } : null; };
  stage.addEventListener("pointerup", up); stage.addEventListener("pointercancel", up);
  stage.addEventListener("wheel", e => { e.preventDefault(); sc = Math.min(6, Math.max(1, sc * (e.deltaY < 0 ? 1.15 : 0.87))); clamp(); }, { passive: false });
}
function hideRace() { $("#sheet").hidden = true; if (rmap) { rmap.remove(); rmap = null; } }
function closeSheet() { popScreen("race"); }

// ------------------------------------------------------------------ planes
const uid = () => Math.random().toString(36).slice(2, 10);
const DEFAULT_CHECK = ["Dorsal / confirmación de inscripción", "DNI y licencia federativa", "Chip (si no va en el dorsal)", "Zapatillas de carrera", "Ropa de carrera + cortavientos", "Geles / barritas / sales", "Reloj y cargador", "Imperdibles o portadorsal", "Ropa de cambio y chanclas", "Toalla y neceser", "Crema solar / vaselina anti-rozaduras"];
const TRAIL_CHECK = ["Mochila / chaleco de hidratación", "Material obligatorio (manta térmica, silbato, frontal)", "Bastones", "Chaqueta impermeable"];

function newPlan(r) {
  const race = { id: r.id, name: r.name, date: r.date, time: r.time || "", city: r.city || "", province: r.province || "", lat: r.lat, lon: r.lon, surface: r.surface, dist: r.dist || [], web: r.web || r.reg || (r.src?.[0]?.u || "") };
  const long = r.surface === "trail" || (r.dist || []).some(d => d >= 21);
  const arrive = addDays(r.date, long ? -1 : 0);
  const p = {
    v: 1, id: uid(), title: `Finde en ${r.city || r.province || "carrera"}`, race, chosen: (r.dist || [])[0] ?? null,
    people: 2, origin: store.get("origin", ""), arrive, leave: r.date,
    stay: null, meals: [
      { slot: "Cena víspera", day: addDays(r.date, -1), time: "21:00", pref: "pasta", place: null },
      { slot: "Desayuno", day: r.date, time: "07:00", pref: "desayuno", place: null },
      { slot: "Comida post-carrera", day: r.date, time: "14:30", pref: "local", place: null },
    ],
    events: [], check: [...DEFAULT_CHECK, ...(r.surface === "trail" ? TRAIL_CHECK : [])].map(t => ({ t, d: false })),
    notes: "", cost: { stay: "", food: "", travel: "", fee: "" }, created: Date.now(),
  };
  if (arrive === r.date) p.meals.shift();
  p.events = [
    { day: arrive, time: arrive === r.date ? "06:30" : "18:00", text: arrive === r.date ? "Salida hacia la carrera" : "Llegada", k: "go", role: "arrive" },
    { day: arrive === r.date ? r.date : arrive, time: arrive === r.date ? "08:00" : "19:00", text: "Recogida del dorsal", k: "run" },
    { day: r.date, time: r.time || "09:00", text: "¡Salida de la carrera!", k: "run" },
    { day: r.date, time: "18:00", text: "Vuelta a casa", k: "go", role: "leave" },
  ];
  return p;
}
function savePlan(p) { plans[p.id] = p; store.set("plans", plans); $("#plansCount").textContent = Object.keys(plans).length; }
function deletePlan(id) { delete plans[id]; store.set("plans", plans); $("#plansCount").textContent = Object.keys(plans).length; }

let P = null, pmap = null, pLayers = {};
function openPlan(p, readonly = false) {
  P = p;
  const v = $("#planView");
  v.hidden = false; v.scrollTop = 0;
  if (!STACK.some(x => x.name === "plan")) pushScreen("plan", hidePlan);
  renderPlan();
  if (!readonly && !plans[p.id]) savePlan(p);
}
function closePlan() { popScreen("plan"); }
function hidePlan() { $("#planView").hidden = true; if (pmap) { pmap.remove(); pmap = null; } P = null; if (!$("#plansView").hidden) openPlans(); }

function nightsOf(p) { return Math.max(0, Math.round((pd(p.leave) - pd(p.arrive)) / 864e5)); }

function renderPlan() {
  const p = P, r = p.race;
  const v = $("#planView");
  const nights = nightsOf(p);
  const originT = p.origin ? TOWNS.get(fold(p.origin)) : null;
  const travelKm = originT && r.lat ? haversine(originT.lat, originT.lon, r.lat, r.lon) * 1.25 : null;
  v.innerHTML = `
  <div class="bar">
    <button class="x" id="pvClose" type="button" aria-label="Volver">←</button>
    <input class="title-in" id="pTitle" value="${esc(p.title)}" aria-label="Nombre del plan">
    <button class="icon-btn" id="pvShare" type="button" aria-label="Compartir"><svg viewBox="0 0 24 24"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4"/></svg></button>
  </div>
  <nav class="seg" id="seg">
    <a href="#secRun" class="on"><i style="background:var(--accent)"></i>Correr</a>
    <a href="#secSleep"><i style="background:var(--stay)"></i>Dormir</a>
    <a href="#secEat"><i style="background:var(--eat)"></i>Comer</a>
    <a href="#secPlan"><i style="background:var(--muted)"></i>Itinerario</a>
    <a href="#secBag"><i style="background:var(--muted)"></i>Mochila</a>
    <a href="#secMoney"><i style="background:var(--muted)"></i>Gastos</a>
    <a href="#shareBox"><i style="background:var(--accent)"></i>Compartir</a>
  </nav>
  <div class="screen-body">
      <div id="planMap"></div>
      <section class="panel" id="secRun">
        <div class="panel-h"><span class="tag run"></span><h2>Correr</h2><span class="sub">${fmtDate(r.date)}</span></div>
        <div class="pick set"><span class="ico run">${ICON_RUN}</span>
          <span class="t"><b>${esc(r.name)}</b><small>${esc([r.city, r.province].filter(Boolean).join(", "))}${r.time ? ` · salida ${esc(r.time)}` : ""}</small></span>
          ${r.web ? `<a class="btn ghost small" href="${esc(r.web)}" target="_blank" rel="noopener">Web ↗</a>` : ""}</div>
        <div class="grid2" style="margin-top:12px">
          <label class="field">Distancia que corro
            <select id="pDist">${(r.dist.length ? r.dist : [null]).map(d => `<option value="${d ?? ""}" ${d === p.chosen ? "selected" : ""}>${d ? fmtDist(d) + (d !== Math.round(d) ? ` (${d} km)` : "") : "Por decidir"}</option>`).join("")}</select></label>
          <label class="field">Personas<input id="pPeople" type="number" min="1" max="30" value="${p.people}"></label>
          <label class="field">Salgo desde<input id="pOrigin" list="towns" value="${esc(p.origin)}" placeholder="Tu ciudad"></label>
          <label class="field">Llegada<input id="pArrive" type="date" value="${p.arrive}"></label>
          <label class="field">Vuelta<input id="pLeave" type="date" value="${p.leave}"></label>
        </div>
        <p class="small muted" style="margin:10px 0 0">${nights ? `${nights} noche${nights > 1 ? "s" : ""} fuera` : "Ida y vuelta en el día"}${travelKm ? ` · ≈${Math.round(travelKm)} km por carretera (≈${fmtHours(travelKm / 85)})` : ""}
          ${originT && r.lat ? ` · <a href="https://www.google.com/maps/dir/?api=1&origin=${originT.lat},${originT.lon}&destination=${r.lat},${r.lon}" target="_blank" rel="noopener">Ruta en Google Maps ↗</a>` : ""}</p>
      </section>

      <section class="panel" id="secSleep">
        <div class="panel-h"><span class="tag sleep"></span><h2>Dormir</h2><span class="sub">${nights ? `${fmtShort(p.arrive)} → ${fmtShort(p.leave)}` : "No hace falta: vuelta en el día"}</span></div>
        ${placeCard(p.stay, "sleep", "Sin alojamiento elegido todavía")}
        <div class="toolbar">
          <select id="stayType" aria-label="Tipo de alojamiento">
            <option value="hotel|motel">Hoteles</option><option value="hostel|guest_house">Hostales y pensiones</option>
            <option value="apartment|chalet">Apartamentos y casas rurales</option><option value="camp_site|caravan_site">Campings</option>
            <option value="alpine_hut|wilderness_hut">Refugios</option><option value="hotel|motel|hostel|guest_house|apartment|chalet|camp_site|alpine_hut" selected>Todo</option>
          </select>
          <select id="stayR" aria-label="Radio"><option value="3000">3 km</option><option value="8000" selected>8 km</option><option value="20000">20 km</option></select>
          <button class="btn ghost small" id="staySearch" type="button">Buscar cerca de la salida</button>
        </div>
        <div class="results" id="stayRes"></div>
        <div class="toolbar">${stayLinks(p)}</div>
        <details style="margin-top:10px"><summary class="small muted">Añadir a mano (Airbnb, casa de un amigo…)</summary>${manualForm("stay")}</details>
      </section>

      <section class="panel" id="secEat">
        <div class="panel-h"><span class="tag eat"></span><h2>Comer</h2><span class="sub">cerca de ${p.stay ? "tu alojamiento" : "la salida"}</span></div>
        ${p.meals.map((m, i) => `
          <div class="slot" data-i="${i}">
            <div class="slot-h"><h3>${esc(m.slot)}</h3><span class="muted small">${fmtShort(m.day)}</span><input type="time" value="${m.time}" data-mt="${i}" aria-label="Hora">
              <button class="link-btn small" data-mdel="${i}" type="button">quitar</button></div>
            ${placeCard(m.place, "eat", prefHint(m.pref), i)}
            <div class="toolbar">
              <select data-mpref="${i}" aria-label="Qué te apetece">${Object.entries(PREFS).map(([k, x]) => `<option value="${k}" ${k === m.pref ? "selected" : ""}>${x.label}</option>`).join("")}</select>
              <button class="btn ghost small" data-msearch="${i}" type="button">Sugerencias</button>
              <a class="btn ghost small" target="_blank" rel="noopener" href="${eatLink(p, m)}">Google Maps ↗</a>
            </div>
            <div class="results" data-mres="${i}"></div>
          </div>`).join("")}
        <div class="toolbar" style="margin-top:12px">
          <input id="newMeal" placeholder="Otra comida (p. ej. Merienda)" style="flex:1;background:var(--surface-2);border:1px solid var(--line);border-radius:8px;padding:6px 10px">
          <button class="btn ghost small" id="addMeal" type="button">Añadir</button>
        </div>
      </section>

      <section class="panel" id="secPlan">
        <div class="panel-h"><span class="tag todo"></span><h2>Itinerario</h2></div>
        ${timelineHTML(p)}
        <div class="tl-add">
          <input type="time" id="evTime" value="10:00" aria-label="Hora">
          <input id="evText" placeholder="Añadir momento: visitar el casco antiguo…" aria-label="Qué">
          <button class="btn ghost small" id="evAdd" type="button">Añadir</button>
        </div>
        <label class="field" style="margin-top:6px">Día<select id="evDay">${daysOf(p).map(d => `<option value="${d}">${fmtShort(d)}</option>`).join("")}</select></label>
      </section>

      <section class="panel" id="secBag">
        <div class="panel-h"><span class="tag todo"></span><h2>Mochila</h2><span class="sub">${p.check.filter(c => c.d).length}/${p.check.length}</span></div>
        <ul class="check">${p.check.map((c, i) => `<li class="${c.d ? "done" : ""}"><label><input type="checkbox" data-ck="${i}" ${c.d ? "checked" : ""}><span>${esc(c.t)}</span></label></li>`).join("")}</ul>
        <div class="toolbar"><input id="newCk" placeholder="Añadir a la lista" style="flex:1;background:var(--surface-2);border:1px solid var(--line);border-radius:8px;padding:6px 10px"><button class="btn ghost small" id="addCk" type="button">Añadir</button></div>
      </section>

      <section class="panel" id="secMoney">
        <div class="panel-h"><span class="tag todo"></span><h2>Presupuesto y notas</h2></div>
        <div class="grid2">
          ${[["fee", "Inscripción (total €)"], ["travel", "Viaje (€)"], ["stay", "Alojamiento (€)"], ["food", "Comidas (€)"]].map(([k, l]) => `<label class="field">${l}<input type="number" min="0" step="1" data-cost="${k}" value="${esc(p.cost[k])}"></label>`).join("")}
        </div>
        ${budgetHTML(p)}
        <label class="field" style="margin-top:12px">Notas<textarea id="pNotes" placeholder="Parking, recogida de dorsal, quién lleva el coche…">${esc(p.notes)}</textarea></label>
      </section>
      <section class="panel share-box" id="shareBox">
        <div class="panel-h"><span class="tag run"></span><h2>Compartir</h2></div>
        <p class="small muted" style="margin:0 0 10px">Se comparte una ficha en imagen con lo importante y un enlace que lleva el plan entero (carrera, alojamiento, comidas, itinerario, mochila y notas) para guardarlo en la app.</p>
        <button class="card-preview-btn" id="cardPreviewBtn" type="button" aria-label="Ver ficha a pantalla completa"><img id="cardPreview" class="card-preview" alt="Ficha resumen del plan"></button>
        <div class="share-row" style="margin-top:10px">
          <button class="btn primary wide" id="shCard" type="button">Compartir ficha (imagen + enlace)</button>
          <button class="btn ghost small" id="shSend" type="button">Enviar solo texto</button>
          <button class="btn ghost small" id="shSaveImg" type="button">Guardar imagen</button>
          <button class="btn ghost small" id="shLink" type="button">Copiar enlace</button>
          <button class="btn ghost small" id="shText" type="button">Copiar resumen</button>
          <button class="btn ghost small" id="shIcs" type="button">Calendario (.ics)</button>
          <button class="btn ghost small" id="shJson" type="button">Exportar archivo</button>
        </div>
        <div class="qr" id="qr"></div>
        <details><summary class="small muted">Código del plan (para pegar en «Importar»)</summary><div class="code" id="planCode">…</div></details>
        <button class="link-btn small" id="pDelete" type="button">Borrar este plan</button>
      </section>
  </div>`;
  bindPlan();
  drawPlanMap();
  refreshShare();
}
const fmtHours = h => { const m = Math.round(h * 60); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} min`; };
function daysOf(p) {
  const out = []; let d = p.arrive < p.race.date ? p.arrive : p.race.date;
  const end = p.leave > p.race.date ? p.leave : p.race.date;
  while (d <= end && out.length < 10) { out.push(d); d = addDays(d, 1); }
  return out;
}
function placeCard(pl, kind, empty, i) {
  if (!pl) return `<div class="pick"><span class="ico ${kind}">${kind === "sleep" ? ICON_BED : ICON_FORK}</span><span class="t"><b class="muted" style="font-weight:600">${esc(empty)}</b></span></div>`;
  const dd = P.race.lat && pl.lat ? haversine(P.race.lat, P.race.lon, pl.lat, pl.lon) : null;
  return `<div class="pick set"><span class="ico ${kind}">${kind === "sleep" ? ICON_BED : ICON_FORK}</span>
    <span class="t"><b>${esc(pl.name)}</b><small>${esc([pl.type, pl.addr, dd != null ? `a ${fmtKm(dd)} de la salida` : "", pl.price ? pl.price + " €" : ""].filter(Boolean).join(" · "))}</small></span>
    ${pl.url ? `<a class="btn ghost small" href="${esc(pl.url)}" target="_blank" rel="noopener">Ver ↗</a>` : ""}
    <button class="link-btn small" data-unset="${kind}" ${i != null ? `data-i="${i}"` : ""} type="button">cambiar</button></div>`;
}
const ICON_RUN = `<svg viewBox="0 0 24 24"><path d="M13 4a2 2 0 1 0 0-.01M7 21l3-6 3 2v4M6 12l3-3 4 1 3 3 3 1"/></svg>`;
const ICON_BED = `<svg viewBox="0 0 24 24"><path d="M3 18V7M3 14h18v4M21 14v-2a3 3 0 0 0-3-3h-7v5M7 11.5a1.5 1.5 0 1 0 0-.01"/></svg>`;
const ICON_FORK = `<svg viewBox="0 0 24 24"><path d="M7 3v8M5 3v5a2 2 0 0 0 4 0V3M7 11v10M17 3c-2 2-2 6 0 8v10"/></svg>`;
const PREFS = {
  pasta: { label: "Pasta / italiano (carga de hidratos)", re: /italian|pizza|pasta/i },
  local: { label: "Cocina local / tapas", re: /regional|spanish|tapas|local|mediterranean|basque|catalan|galician|asturian|andalusian/i },
  desayuno: { label: "Desayuno / cafetería", amen: "cafe|bakery", re: /coffee|cafe|breakfast|bakery|pastry/i },
  burger: { label: "Hamburguesa / rápido", amen: "fast_food|restaurant", re: /burger|sandwich|kebab/i },
  veg: { label: "Vegetariano / vegano", re: /vegetarian|vegan/i, diet: true },
  asian: { label: "Asiático / sushi", re: /asian|japanese|sushi|chinese|thai|vietnamese|indian|ramen/i },
  any: { label: "Cualquier sitio", re: /./ },
};
const prefHint = k => `Sin sitio elegido · ${PREFS[k]?.label || ""}`;
function stayLinks(p) {
  const r = p.race, ci = p.arrive, co = p.leave > p.arrive ? p.leave : addDays(p.arrive, 1);
  const where = encodeURIComponent([r.city, r.province].filter(Boolean).join(", ") || r.name);
  const ll = r.lat ? `&latitude=${r.lat}&longitude=${r.lon}` : "";
  return [
    ["Booking", `https://www.booking.com/searchresults.es.html?ss=${where}${ll}&checkin=${ci}&checkout=${co}&group_adults=${p.people}&no_rooms=1&order=distance_from_search`],
    ["Airbnb", `https://www.airbnb.es/s/${where}/homes?checkin=${ci}&checkout=${co}&adults=${p.people}`],
    ["Google Hoteles", `https://www.google.com/travel/hotels/${where}?q=hoteles%20cerca%20de%20${where}&dates=${ci}_${co}`],
    ["Campings", `https://www.google.com/maps/search/camping/@${r.lat || 40},${r.lon || -3},12z`],
  ].map(([n, u]) => `<a class="btn ghost small" href="${u}" target="_blank" rel="noopener">${n} ↗</a>`).join("");
}
function eatLink(p, m) {
  const c = p.stay?.lat ? p.stay : p.race;
  const q = { pasta: "restaurante italiano", local: "restaurante tapas", desayuno: "cafetería desayunos", burger: "hamburguesería", veg: "restaurante vegetariano", asian: "restaurante asiático", any: "restaurantes" }[m.pref] || "restaurantes";
  return `https://www.google.com/maps/search/${encodeURIComponent(q)}/@${c.lat || 40},${c.lon || -3},15z`;
}
function manualForm(kind, i) {
  return `<div class="grid2" style="margin-top:8px" data-manual="${kind}" ${i != null ? `data-i="${i}"` : ""}>
    <label class="field">Nombre<input data-mf="name" placeholder="Hotel / casa / restaurante"></label>
    <label class="field">Enlace<input data-mf="url" placeholder="https://…"></label>
    <label class="field">Precio (€)<input data-mf="price" type="number" min="0"></label>
    <div style="display:flex;align-items:end"><button class="btn ghost small" data-mfsave="${kind}" type="button">Guardar</button></div></div>`;
}
function timelineHTML(p) {
  const items = [...p.events.map((e, i) => ({ ...e, i })),
    ...(p.stay && nightsOf(p) ? [{ day: p.arrive, time: p.stay.checkin || "15:00", text: `Check-in · ${p.stay.name}`, k: "sleep", auto: 1 }, { day: p.leave, time: "11:00", text: `Check-out · ${p.stay.name}`, k: "sleep", auto: 1 }] : []),
    ...p.meals.filter(m => m.place).map(m => ({ day: m.day, time: m.time, text: `${m.slot} · ${m.place.name}`, k: "eat", auto: 1 }))]
    .sort((a, b) => (a.day + a.time).localeCompare(b.day + b.time));
  let html = "", last = "";
  for (const e of items) {
    if (e.day !== last) { html += `${last ? "</ul>" : ""}<p class="tl-day">${fmtDate(e.day)}</p><ul class="tl">`; last = e.day; }
    html += `<li class="ev"><span class="tm">${esc(e.time)}</span><span class="mk ${e.k || ""}"></span><span class="tx">${esc(e.text)}</span>${e.auto ? "<span></span>" : `<button class="rm" data-evdel="${e.i}" type="button" aria-label="Quitar">✕</button>`}</li>`;
  }
  return html + (last ? "</ul>" : `<p class="muted">Sin momentos todavía.</p>`);
}
function budgetHTML(p) {
  const c = p.cost, n = Math.max(1, +p.people || 1);
  const tot = ["fee", "travel", "stay", "food"].reduce((s, k) => s + (+c[k] || 0), 0);
  if (!tot) return "";
  return `<div class="budget" style="margin-top:12px"><span>Total</span><b class="num">${tot.toLocaleString("es-ES")} €</b><span class="muted">Por persona (${n})</span><span class="num">${(tot / n).toLocaleString("es-ES", { maximumFractionDigits: 0 })} €</span></div>`;
}

function bindPlan() {
  const p = P, v = $("#planView");
  const commit = (rerender = true) => { savePlan(p); if (rerender) { const y = v.scrollTop; renderPlan(); v.scrollTop = y; } else refreshShare(); };
  $("#pvClose").onclick = closePlan;
  $("#pvShare").onclick = () => $("#shareBox").scrollIntoView({ behavior: "smooth" });
  $$("#seg a").forEach(a => a.onclick = e => { e.preventDefault(); $(a.getAttribute("href")).scrollIntoView({ behavior: "smooth", block: "start" }); });
  const secs = $$("#seg a").map(a => $(a.getAttribute("href")));
  v.onscroll = () => { // resalta la pestaña de la sección visible
    const y = v.scrollTop + 140; let cur = secs[0];
    for (const s of secs) if (s.offsetTop <= y) cur = s;
    $$("#seg a").forEach(a => a.classList.toggle("on", a.getAttribute("href") === "#" + cur.id));
  };
  $("#shSend").onclick = async () => {
    const url = await planURL(p);
    if (APP && CAP.Share) { try { await CAP.Share.share({ title: p.title, text: `${planText(p)}\n\n${url}`, dialogTitle: "Enviar plan" }); return; } catch { return; } }
    if (navigator.share && !EMBED) { try { await navigator.share({ title: p.title, text: planText(p), url: url.startsWith("http") ? url : undefined }); return; } catch { /* cancelado */ } }
    copy(`${planText(p)}\n\n${url}`, "Plan copiado: pégalo en WhatsApp o Telegram");
  };
  $("#pTitle").oninput = e => { p.title = e.target.value; commit(false); };
  $("#pDist").onchange = e => { p.chosen = e.target.value ? +e.target.value : null; commit(false); };
  $("#pPeople").onchange = e => { p.people = Math.max(1, +e.target.value || 1); commit(); };
  $("#pOrigin").onchange = e => { p.origin = e.target.value; store.set("origin", p.origin); commit(); };
  $("#pArrive").onchange = e => { p.arrive = e.target.value || p.arrive; if (p.leave < p.arrive) p.leave = p.arrive; syncMealDays(p); syncRoles(p); commit(); };
  $("#pLeave").onchange = e => { p.leave = e.target.value || p.leave; if (p.leave < p.arrive) p.arrive = p.leave; syncRoles(p); commit(); };
  $("#pNotes").oninput = e => { p.notes = e.target.value; commit(false); };
  $$("[data-cost]", v).forEach(i => i.onchange = () => { p.cost[i.dataset.cost] = i.value; commit(); });
  $$("[data-ck]", v).forEach(i => i.onchange = () => { p.check[+i.dataset.ck].d = i.checked; i.closest("li").classList.toggle("done", i.checked); commit(false); });
  $("#addCk").onclick = () => { const t = $("#newCk").value.trim(); if (t) { p.check.push({ t, d: false }); commit(); } };
  $("#addMeal").onclick = () => { const t = $("#newMeal").value.trim(); if (t) { p.meals.push({ slot: t, day: p.race.date, time: "17:00", pref: "any", place: null }); commit(); } };
  $$("[data-mdel]", v).forEach(b => b.onclick = () => { p.meals.splice(+b.dataset.mdel, 1); commit(); });
  $$("[data-mt]", v).forEach(i => i.onchange = () => { p.meals[+i.dataset.mt].time = i.value; commit(); });
  $$("[data-mpref]", v).forEach(s => s.onchange = () => { p.meals[+s.dataset.mpref].pref = s.value; commit(); });
  $$("[data-msearch]", v).forEach(b => b.onclick = () => searchEat(+b.dataset.msearch));
  $$("[data-unset]", v).forEach(b => b.onclick = () => { if (b.dataset.unset === "sleep") p.stay = null; else p.meals[+b.dataset.i].place = null; commit(); });
  $("#staySearch").onclick = searchStay;
  $$("[data-mfsave]", v).forEach(b => b.onclick = () => {
    const box = b.closest("[data-manual]"); const g = k => $(`[data-mf="${k}"]`, box).value.trim();
    if (!g("name")) return toast("Ponle al menos un nombre");
    const pl = { name: g("name"), url: g("url"), price: g("price"), type: "Manual" };
    if (box.dataset.manual === "stay") { p.stay = pl; if (pl.price) p.cost.stay = pl.price; } else p.meals[+box.dataset.i].place = pl;
    commit();
  });
  $("#evAdd").onclick = () => { const t = $("#evText").value.trim(); if (!t) return; p.events.push({ day: $("#evDay").value, time: $("#evTime").value || "10:00", text: t, k: "" }); commit(); };
  $$("[data-evdel]", v).forEach(b => b.onclick = () => { p.events.splice(+b.dataset.evdel, 1); commit(); });
  $("#shLink").onclick = async () => { const u = await planURL(p); copy(u, "Enlace copiado: pégalo en WhatsApp, Telegram o email"); };
  $("#shText").onclick = () => copy(planText(p), "Resumen copiado");
  $("#shCard").onclick = () => shareCard(p);
  $("#shSaveImg").onclick = async () => { const blob = await cardBlob(p); saveBlob(blob, `${slug(p.title)}.png`); };
  $("#cardPreviewBtn").onclick = () => { const u = $("#cardPreview").src; if (u) openViewer(u, p.title); };
  $("#shIcs").onclick = () => downloadOrCopy(planICS(p), `${slug(p.title)}.ics`, "text/calendar");
  $("#shJson").onclick = () => downloadOrCopy(JSON.stringify(p, null, 2), `${slug(p.title)}.json`, "application/json");
  $("#pDelete").onclick = e => {
    if (e.target.dataset.sure) { deletePlan(p.id); closePlan(); toast("Plan borrado"); }
    else { e.target.dataset.sure = 1; e.target.textContent = "Pulsa otra vez para borrarlo"; }
  };
  // clic en resultados (delegado)
  v.onclick = e => {
    const b = e.target.closest("[data-choose]"); if (!b) return;
    const pl = JSON.parse(b.dataset.choose);
    if (b.dataset.kind === "sleep") p.stay = pl; else p.meals[+b.dataset.i].place = pl;
    commit();
  };
}
function syncRoles(p) { p.events.forEach(e => { if (e.role === "arrive") e.day = p.arrive; if (e.role === "leave") e.day = p.leave; }); }
function syncMealDays(p) { const m = p.meals.find(x => x.slot === "Cena víspera"); if (m) m.day = addDays(p.race.date, -1); }
const slug = s => fold(s).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "plan";

function drawPlanMap() {
  if (!window.L) return;
  if (pmap) { pmap.remove(); pmap = null; }
  const r = P.race;
  pmap = L.map("planMap", { preferCanvas: true, zoomControl: true, attributionControl: true }).setView([r.lat || 40.2, r.lon || -3.6], r.lat ? 13 : 6);
  baseLayers(pmap);
  pLayers.cand = L.layerGroup().addTo(pmap);
  const pts = [];
  const pin = (lat, lon, cls, label, tip) => { const m = L.marker([lat, lon], { icon: L.divIcon({ className: "", html: `<div class="pin ${cls}">${label}</div>`, iconSize: [30, 30], iconAnchor: [15, 30] }) }).bindTooltip(tip).addTo(pmap); pts.push([lat, lon]); return m; };
  if (r.lat) pin(r.lat, r.lon, "run", ICON_RUN, `Salida: ${esc(r.name)}`);
  if (P.stay?.lat) pin(P.stay.lat, P.stay.lon, "sleep", ICON_BED, esc(P.stay.name));
  P.meals.forEach(m => { if (m.place?.lat) pin(m.place.lat, m.place.lon, "eat", ICON_FORK, `${esc(m.slot)}: ${esc(m.place.name)}`); });
  if (pts.length > 1) pmap.fitBounds(pts, { padding: [30, 30], maxZoom: 15 });
  setTimeout(() => pmap && pmap.invalidateSize(), 50);
}

// -------- Overpass (OpenStreetMap): alojamientos y restaurantes cercanos
// Sitios cercanos (OpenStreetMap). Los servidores públicos de Overpass a veces van saturados:
// se consultan todos a la vez y gana el primero; si ninguno responde, se usa Nominatim.
const OVERPASS = ["https://overpass-api.de/api/interpreter", "https://overpass.private.coffee/api/interpreter", "https://overpass.kumi.systems/api/interpreter"];
function overpassOnce(u, q, signal) {
  return fetch(`${u}?data=${encodeURIComponent(q)}`, { signal }).then(r => { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(j => { if (!j.elements) throw new Error("vacío"); return j.elements; });
}
async function overpass(q, ms = 9000) {
  const ctl = new AbortController(), to = setTimeout(() => ctl.abort(), ms);
  try { return await Promise.any(OVERPASS.map(u => overpassOnce(u, q, ctl.signal))); }
  finally { clearTimeout(to); ctl.abort(); }
}
const NOMI_PHRASE = { hotel: "hotel", motel: "motel", hostel: "hostel", guest_house: "guest house", apartment: "apartment", chalet: "chalet",
  camp_site: "camp site", caravan_site: "caravan site", alpine_hut: "alpine hut", wilderness_hut: "wilderness hut",
  restaurant: "restaurant", cafe: "cafe", bakery: "bakery", fast_food: "fast food", bar: "bar" };
let nomiLast = 0;
async function nominatim(types, lat, lon, radiusM) {
  const dLat = radiusM / 111000, dLon = radiusM / (111000 * Math.cos(lat * Math.PI / 180));
  const vb = [lon - dLon, lat + dLat, lon + dLon, lat - dLat].map(x => x.toFixed(5)).join(",");
  const out = [], seen = new Set();
  for (const t of types.slice(0, 5)) {
    const ph = NOMI_PHRASE[t]; if (!ph) continue;
    const wait = 1100 - (Date.now() - nomiLast); if (wait > 0) await new Promise(r => setTimeout(r, wait)); // 1 petición/s
    nomiLast = Date.now();
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&extratags=1&limit=40&bounded=1&viewbox=${vb}&q=${encodeURIComponent(ph)}`);
      if (!r.ok) continue;
      for (const x of await r.json()) {
        if (seen.has(x.osm_id) || !types.includes(x.type)) continue;
        seen.add(x.osm_id);
        const a = x.address || {}, ex = x.extratags || {};
        out.push({ lat: +x.lat, lon: +x.lon, tags: { name: x.name, [x.category]: x.type, "addr:street": a.road, "addr:housenumber": a.house_number,
          "addr:city": a.city || a.town || a.village, website: ex.website || ex["contact:website"], cuisine: ex.cuisine, stars: ex.stars, phone: ex.phone } });
      }
    } catch { /* siguiente tipo */ }
  }
  return out;
}
async function nearby(key, types, c, radiusM, max) {
  const q = `[out:json][timeout:15];nwr["${key}"~"^(${types.join("|")})$"](around:${radiusM},${c.lat},${c.lon});out center tags ${max};`;
  try { return { els: await overpass(q), src: "OpenStreetMap" }; }
  catch { return { els: await nominatim(types, c.lat, c.lon, radiusM), src: "OpenStreetMap (Nominatim)" }; }
}
const TYPE_ES = { hotel: "Hotel", motel: "Motel", hostel: "Albergue", guest_house: "Hostal / pensión", apartment: "Apartamento", chalet: "Casa rural", camp_site: "Camping", caravan_site: "Área autocaravanas", alpine_hut: "Refugio", wilderness_hut: "Refugio libre", restaurant: "Restaurante", cafe: "Cafetería", fast_food: "Comida rápida", bar: "Bar", bakery: "Panadería" };
function osmPlace(e, center) {
  const t = e.tags || {}, lat = e.lat ?? e.center?.lat, lon = e.lon ?? e.center?.lon;
  const addr = [t["addr:street"] && `${t["addr:street"]} ${t["addr:housenumber"] || ""}`.trim(), t["addr:city"]].filter(Boolean).join(", ");
  return {
    name: t.name || TYPE_ES[t.tourism || t.amenity || t.shop] || "Sin nombre", lat, lon,
    type: [TYPE_ES[t.tourism || t.amenity || t.shop] || "", t.stars ? "★".repeat(Math.min(5, +t.stars || 0)) : "", t.cuisine ? t.cuisine.replace(/_/g, " ").split(";").slice(0, 2).join(", ") : ""].filter(Boolean).join(" · "),
    addr, url: t.website || t["contact:website"] || t.url || (t.name ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(t.name + " " + (t["addr:city"] || P.race.city || ""))}` : ""),
    phone: t.phone || t["contact:phone"] || "", _d: center && lat ? haversine(center.lat, center.lon, lat, lon) : null, _t: t,
  };
}
function resultsHTML(list, kind, i) {
  if (!list.length) return `<p class="small muted">Nada en OpenStreetMap con ese filtro. Amplía el radio o usa los enlaces.</p>`;
  return list.map(pl => { const { _t, _d, ...keep } = pl; return `<div class="res"><span class="t"><b>${esc(pl.name)}</b><small>${esc([pl.type, pl.addr].filter(Boolean).join(" · "))}</small></span><span class="d">${fmtKm(_d)}</span><button class="btn ghost small" type="button" data-kind="${kind}" ${i != null ? `data-i="${i}"` : ""} data-choose='${esc(JSON.stringify(keep))}'>Elegir</button></div>`; }).join("");
}
function showCandidates(list, cls) {
  if (!pmap) return;
  pLayers.cand.clearLayers();
  list.forEach(pl => pl.lat && L.marker([pl.lat, pl.lon], { icon: L.divIcon({ className: "", html: `<div class="pin cand ${cls}"></div>`, iconSize: [22, 22], iconAnchor: [11, 22] }) }).bindTooltip(esc(pl.name)).addTo(pLayers.cand));
  const pts = list.filter(x => x.lat).map(x => [x.lat, x.lon]); if (P.race.lat) pts.push([P.race.lat, P.race.lon]);
  if (pts.length > 1) pmap.fitBounds(pts, { padding: [20, 20], maxZoom: 15 });
}
function coordsNote(c) {
  return c.approx ? `<p class="small muted">Ojo: la ubicación de esta carrera es aproximada (centro de ${esc(c.city || c.province || "la zona")}).</p>` : "";
}
async function searchStay() {
  const r = P.race, box = $("#stayRes");
  if (!r.lat) { box.innerHTML = `<p class="small muted">Esta carrera no tiene coordenadas; usa los enlaces de Booking/Airbnb.</p>`; return; }
  box.innerHTML = `<p class="small muted">Buscando alojamiento cerca de la salida…</p>`;
  const types = $("#stayType").value.split("|"), R = +$("#stayR").value;
  const { els, src } = await nearby("tourism", types, r, R, 80);
  const list = els.map(e => osmPlace(e, r)).filter(x => x.lat)
    .sort((a, b) => (!a._t.name - !b._t.name) || a._d - b._d).slice(0, 40); // primero los que tienen nombre
  box.innerHTML = coordsNote(r) + (list.length ? `<p class="small muted">${list.length} resultados · ${src}</p>` : "") +
    (list.length ? resultsHTML(list, "sleep") : `<p class="small muted">No encuentro alojamientos a ${R / 1000} km en OpenStreetMap. Prueba con 20 km o usa Booking, Airbnb o Google.</p>`);
  showCandidates(list, "sleep");
}
async function searchEat(i) {
  const m = P.meals[i], c = P.stay?.lat ? P.stay : P.race, box = $(`[data-mres="${i}"]`);
  if (!c.lat) { box.innerHTML = `<p class="small muted">Sin coordenadas: usa el enlace de Google Maps.</p>`; return; }
  box.innerHTML = `<p class="small muted">Buscando sitios para comer cerca de ${P.stay?.lat ? "tu alojamiento" : "la salida"}…</p>`;
  const pref = PREFS[m.pref] || PREFS.any, types = (pref.amen || "restaurant").split("|");
  let { els, src } = await nearby("amenity", types, c, 2500, 150);
  if (els.filter(e => e.tags?.name).length < 4) ({ els, src } = await nearby("amenity", types, c, 8000, 150)); // pueblo pequeño: amplía
  let list = els.map(e => osmPlace(e, c)).filter(x => x.lat && x._t.name);
  const match = list.filter(x => pref.diet ? /yes|only/.test(x._t["diet:vegetarian"] || x._t["diet:vegan"] || "") || pref.re.test(x._t.cuisine || "") : pref.re.test(`${x._t.cuisine || ""} ${x._t.amenity} ${x._t.name}`));
  list = (match.length >= 3 ? match : [...match, ...list.filter(x => !match.includes(x))]).sort((a, b) => a._d - b._d).slice(0, 30);
  box.innerHTML = coordsNote(c) + (list.length ? `<p class="small muted">${match.length < 3 ? "Pocos sitios etiquetados así; te enseño también otros cercanos. · " : ""}${src}</p>` + resultsHTML(list, "eat", i)
    : `<p class="small muted">No encuentro sitios en OpenStreetMap aquí. Usa el enlace de Google Maps.</p>`);
  showCandidates(list, "eat");
}

// ------------------------------------------------------------------ compartir
const b64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64u = s => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0));
function defaultCheck(p) { return [...DEFAULT_CHECK, ...(p.race?.surface === "trail" ? TRAIL_CHECK : [])]; }
async function encodePlan(p) {
  const { created, ...rest } = p;
  const dc = defaultCheck(p);
  if (rest.check?.length === dc.length && rest.check.every((c, i) => c.t === dc[i] && !c.d)) delete rest.check; // mochila por defecto: no viaja
  rest.meals = rest.meals?.map(m => m.place?.url?.startsWith("https://www.google.com/maps/search/") ? { ...m, place: { ...m.place, url: "" } } : m);
  if (rest.stay?.url?.startsWith("https://www.google.com/maps/search/")) rest.stay = { ...rest.stay, url: "" };
  const json = JSON.stringify(rest);
  if (window.CompressionStream) {
    const s = new Blob([json]).stream().pipeThrough(new CompressionStream("deflate-raw"));
    return "z" + b64u(await new Response(s).arrayBuffer());
  }
  return "j" + b64u(new TextEncoder().encode(json));
}
async function decodePlan(code) {
  code = decodeURIComponent(code.trim()).replace(/^.*[?&#](plan|c)=/, "").replace(/&.*$/, "");
  const kind = code[0], bytes = unb64u(code.slice(1));
  let json;
  if (kind === "z") { const s = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw")); json = await new Response(s).text(); }
  else json = new TextDecoder().decode(bytes);
  const p = JSON.parse(json);
  if (!p.race || !p.v) throw new Error("no es un plan");
  if (!p.check) p.check = defaultCheck(p).map(t => ({ t, d: false }));
  return p;
}
// En la vista previa embebida (artifact) no hay URL propia que reciba ?plan=; se usa la pública si existe.
const EMBED = !!window.CDC_EMBED, PUBLIC_URL = window.CDC_PUBLIC_URL || "";
const APP = !!window.CDC_APP, CAP = window.Capacitor?.Plugins || {};
function baseURL() {
  if (EMBED || APP) return PUBLIC_URL;
  const u = new URL(location.href); u.search = ""; u.hash = ""; return u.toString();
}
async function planURL(p) {
  const code = await encodePlan(p);
  if ((EMBED || APP) && !PUBLIC_URL) return `Plan «${p.title}» de Correr·Dormir·Comer.\nÁbrelo en Mis planes → Importar y pega este código:\n${code}`;
  return `${baseURL()}?plan=${code}`;
}
let cardTimer;
async function refreshShare() {
  if (!P) return;
  clearTimeout(cardTimer);
  cardTimer = setTimeout(async () => { // la ficha se regenera al cambiar el plan
    if (!P || !$("#cardPreview")) return;
    const blob = await cardBlob(P); const old = $("#cardPreview").src;
    $("#cardPreview").src = URL.createObjectURL(blob); if (old.startsWith("blob:")) URL.revokeObjectURL(old);
  }, 250);
  const code = await encodePlan(P), url = (EMBED || APP) && !PUBLIC_URL ? code : `${baseURL()}?plan=${code}`;
  const c = $("#planCode"); if (c) c.textContent = code;
  const q = $("#qr");
  if (q && window.qrcode) {
    try { const qr = qrcode(0, "L"); qr.addData(url); qr.make(); q.innerHTML = qr.createSvgTag({ cellSize: 3, margin: 2, scalable: true }); }
    catch { q.innerHTML = `<p class="small" style="color:#333">Plan demasiado grande para QR; usa el enlace.</p>`; }
  }
}
// ------------------------------------------------------------------ ficha resumen en imagen
const CARD = { bg: "#EEF1EF", ink: "#14201A", muted: "#5B6961", line: "#D8DFDB", white: "#FFFFFF", run: "#E8491F", sleep: "#5A55D2", eat: "#C9800F", road: "#2A67D6", trail: "#2C8752" };
function wrap(ctx, text, maxW, maxLines = 3) {
  const words = String(text || "").split(/\s+/), lines = [];
  let cur = "";
  for (const w of words) {
    const t = cur ? cur + " " + w : w;
    if (ctx.measureText(t).width <= maxW || !cur) cur = t; else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) { lines.length = maxLines; let l = lines[maxLines - 1]; while (ctx.measureText(l + "…").width > maxW && l.length) l = l.slice(0, -1); lines[maxLines - 1] = l + "…"; }
  return lines;
}
function drawLogo(ctx, x, y, size) { // logo (barras con subida, luna y tenedor) en una caja de size×size
  const k = size / 52; ctx.save(); ctx.translate(x - 6 * k, y - 7 * k); ctx.scale(k, k);
  [["#E8491F", 8], ["#5A55D2", 25], ["#C9800F", 42]].forEach(([c, bx]) => { ctx.fillStyle = c; rrect(ctx, bx, 9, 14, 46, 7); ctx.fill(); });
  ctx.strokeStyle = "#fff"; ctx.fillStyle = "#fff"; ctx.lineCap = "round"; ctx.lineJoin = "round";
  ctx.lineWidth = 2.6; ctx.stroke(new Path2D("M11 23 15 19 19 23M11 29 15 25 19 29"));
  ctx.fill(new Path2D("M34.2 19.2a5 5 0 1 0 1.8 6.6 4 4 0 1 1-1.8-6.6z"));
  ctx.lineWidth = 1.9; ctx.stroke(new Path2D("M46 17v6M49 17v6M52 17v6M46 23c0 2 1.3 3 3 3s3-1 3-3M49 26v7"));
  ctx.restore();
}
function rrect(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); }
async function cardBlob(p) {
  try { await Promise.all(["800 76px 'Barlow Condensed'", "700 40px Figtree", "400 28px Figtree", "800 26px Figtree"].map(f => document.fonts.load(f))); } catch { /* sin fuentes: las del sistema */ }
  const r = p.race, W = 1080, PAD = 64, D = pd(r.date), C = CARD;
  const url = await planURL(p);
  const rows = [];
  rows.push({ c: C.run, k: "SALIDA", v: r.time ? `${r.time} h` : "Hora por confirmar", s: fmtDate(r.date) });
  rows.push({ c: C.run, k: "LUGAR", v: [r.city, r.province].filter(Boolean).join(", ") || "Por confirmar", s: p.chosen ? `Corro ${fmtDist(p.chosen)}${r.dist.length > 1 ? " · distancias: " + r.dist.map(fmtDist).join(", ") : ""}` : r.dist.map(fmtDist).join(", ") });
  const n = nightsOf(p);
  rows.push({ c: C.sleep, k: "DORMIR", v: p.stay ? p.stay.name : n ? "Alojamiento por elegir" : "Ida y vuelta en el día", s: p.stay ? [n ? `${n} noche${n > 1 ? "s" : ""}: ${fmtShort(p.arrive)} → ${fmtShort(p.leave)}` : "", p.stay.addr, p.stay.price ? p.stay.price + " €" : ""].filter(Boolean).join(" · ") : n ? `${fmtShort(p.arrive)} → ${fmtShort(p.leave)}` : "" });
  const meals = p.meals.filter(m => m.place);
  if (meals.length) meals.forEach((m, i) => rows.push({ c: C.eat, k: i ? "" : "COMER", v: m.place.name, s: `${m.slot} · ${fmtShort(m.day)} ${m.time}${m.place.addr ? " · " + m.place.addr : ""}` }));
  else rows.push({ c: C.eat, k: "COMER", v: "Restaurantes por elegir", s: p.meals.map(m => m.slot).join(" · ") });
  if (p.people > 1) rows.push({ c: C.muted, k: "GRUPO", v: `${p.people} personas`, s: p.origin ? `Salimos desde ${p.origin}` : "" });

  // medir alto
  const cv = document.createElement("canvas"), ctx = cv.getContext("2d");
  ctx.font = "800 76px 'Barlow Condensed', 'Arial Narrow', sans-serif";
  const titleLines = wrap(ctx, r.name, W - PAD * 2 - 250, 3);
  const ROW_H = 150, QR_H = 540;
  const H = 150 + 90 + Math.max(300, 40 + titleLines.length * 78 + 70) + 40 + rows.length * ROW_H + 40 + QR_H + 90;
  cv.width = W; cv.height = H;
  // fondo y cabecera
  ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = C.white; ctx.fillRect(0, 0, W, 150);
  ctx.fillStyle = C.line; ctx.fillRect(0, 148, W, 2);
  drawLogo(ctx, PAD, 36, 80);
  ctx.textBaseline = "middle"; ctx.font = "800 50px 'Barlow Condensed', 'Arial Narrow', sans-serif";
  let wx = PAD + 108;
  [["CORRER", C.ink], [" · ", C.run], ["DORMIR", C.ink], [" · ", C.sleep], ["COMER", C.ink]].forEach(([t, c]) => { ctx.fillStyle = c; ctx.fillText(t, wx, 78); wx += ctx.measureText(t).width; });
  // nombre del plan
  ctx.fillStyle = C.muted; ctx.font = "700 30px Figtree, sans-serif"; ctx.fillText(wrap(ctx, p.title.toUpperCase(), W - PAD * 2, 1)[0], PAD, 150 + 48);
  // bloque carrera con dorsal
  let y = 150 + 90;
  const blockH = Math.max(300, 40 + titleLines.length * 78 + 70);
  ctx.fillStyle = C.white; rrect(ctx, PAD, y, W - PAD * 2, blockH, 28); ctx.fill();
  const bx = PAD + 30, by = y + 30, bw = 190, bh = blockH - 60;
  ctx.fillStyle = "#F4F6F5"; rrect(ctx, bx, by, bw, bh, 16); ctx.fill();
  ctx.fillStyle = r.surface === "trail" ? C.trail : C.road; rrect(ctx, bx, by, bw, 16, [16, 16, 0, 0]); ctx.fill();
  ctx.fillStyle = C.bg; [bx + 22, bx + bw - 22].forEach(cx => { ctx.beginPath(); ctx.arc(cx, by + 34, 8, 0, 7); ctx.fill(); });
  const mid = by + 18 + (bh - 18) / 2; // día, mes y año repartidos en el dorsal
  ctx.fillStyle = C.ink; ctx.textAlign = "center"; ctx.font = "800 120px 'Barlow Condensed', sans-serif"; ctx.fillText(String(D.getDate()), bx + bw / 2, mid - 28);
  ctx.font = "700 30px Figtree, sans-serif"; ctx.fillStyle = C.muted;
  ctx.fillText(`${DAYS[D.getDay()].toUpperCase()} · ${MONTHS[D.getMonth()].toUpperCase()}`, bx + bw / 2, mid + 52);
  ctx.fillText(String(D.getFullYear()), bx + bw / 2, mid + 92); ctx.textAlign = "left";
  const tx = bx + bw + 36;
  ctx.fillStyle = r.surface === "trail" ? C.trail : C.road; ctx.font = "800 26px Figtree, sans-serif";
  ctx.fillText(r.surface === "trail" ? "TRAIL / MONTAÑA" : "ASFALTO", tx, y + 54);
  ctx.fillStyle = C.ink; ctx.font = "800 76px 'Barlow Condensed', 'Arial Narrow', sans-serif";
  titleLines.forEach((l, i) => ctx.fillText(l, tx, y + 110 + i * 78));
  y += blockH + 40;
  // filas
  for (const row of rows) {
    ctx.fillStyle = C.white; rrect(ctx, PAD, y, W - PAD * 2, ROW_H - 16, 22); ctx.fill();
    ctx.fillStyle = row.c; rrect(ctx, PAD, y, 14, ROW_H - 16, [22, 0, 0, 22]); ctx.fill();
    const hasK = !!row.k, top = hasK ? 0 : -16;
    if (hasK) { ctx.fillStyle = row.c; ctx.font = "800 26px Figtree, sans-serif"; ctx.fillText(row.k, PAD + 40, y + 36); }
    ctx.fillStyle = C.ink; ctx.font = "700 40px Figtree, sans-serif";
    ctx.fillText(wrap(ctx, row.v, W - PAD * 2 - 80, 1)[0] || "", PAD + 40, y + 80 + top);
    if (row.s) { ctx.fillStyle = C.muted; ctx.font = "400 28px Figtree, sans-serif"; ctx.fillText(wrap(ctx, row.s, W - PAD * 2 - 80, 1)[0], PAD + 40, y + 118 + top); }
    y += ROW_H;
  }
  // QR + enlace
  y += 24;
  ctx.fillStyle = C.white; rrect(ctx, PAD, y, W - PAD * 2, QR_H, 28); ctx.fill();
  ctx.fillStyle = C.run; rrect(ctx, PAD, y, 14, QR_H, [28, 0, 0, 28]); ctx.fill();
  const qs = QR_H - 70, qx = W - PAD - 35 - qs, qy = y + 35;
  ctx.strokeStyle = C.line; ctx.lineWidth = 3; rrect(ctx, qx, qy, qs, qs, 14); ctx.stroke();
  if (window.qrcode && url.startsWith("http")) {
    try {
      const qr = qrcode(0, "L"); qr.addData(url); qr.make();
      const n = qr.getModuleCount(), cell = Math.floor((qs - 24) / n), off = Math.floor((qs - cell * n) / 2); // módulos enteros: nítido
      ctx.fillStyle = "#000";
      for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) if (qr.isDark(a, b)) ctx.fillRect(qx + off + b * cell, qy + off + a * cell, cell, cell);
    } catch { /* plan demasiado grande para QR */ }
  }
  ctx.fillStyle = C.ink; ctx.font = "800 44px 'Barlow Condensed', sans-serif";
  wrap(ctx, "GUARDA ESTE PLAN EN TU APP", qx - PAD - 60, 3).forEach((l, i) => ctx.fillText(l, PAD + 36, y + 80 + i * 48));
  ctx.fillStyle = C.muted; ctx.font = "400 28px Figtree, sans-serif";
  wrap(ctx, "Escanea el código o abre el enlace del mensaje: se abre el plan completo y puedes guardarlo en Correr·Dormir·Comer.", qx - PAD - 70, 7).forEach((l, i) => ctx.fillText(l, PAD + 36, y + 250 + i * 36));
  // pie
  ctx.fillStyle = C.muted; ctx.font = "400 24px Figtree, sans-serif"; ctx.textAlign = "center";
  ctx.fillText(r.web ? `Web oficial: ${r.web.replace(/^https?:\/\//, "").slice(0, 60)}` : "Comprueba horarios en la web oficial de la carrera", W / 2, H - 44);
  return new Promise(res => cv.toBlob(res, "image/png"));
}
function saveBlob(blob, name) {
  if (APP && CAP.Filesystem && CAP.Share) return shareFileBlob(blob, name, "Guardar o enviar la ficha");
  if (EMBED) { toast("Mantén pulsada la ficha para guardarla"); openViewer(URL.createObjectURL(blob), name); return; }
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove();
  toast("Imagen guardada");
}
async function shareFileBlob(blob, name, title, text) {
  const b64 = await new Promise(res => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(",")[1]); fr.readAsDataURL(blob); });
  const f = await CAP.Filesystem.writeFile({ path: name, data: b64, directory: "CACHE" });
  try { await CAP.Share.share({ title, text, files: [f.uri], dialogTitle: title }); } catch { /* cancelado */ }
}
async function shareCard(p) {
  toast("Preparando la ficha…");
  const blob = await cardBlob(p), url = await planURL(p), name = `${slug(p.title)}.png`;
  const text = `${planText(p)}\n\n👉 Guarda el plan en tu app: ${url}`;
  if (APP && CAP.Filesystem && CAP.Share) return shareFileBlob(blob, name, "Compartir plan", text);
  const file = new File([blob], name, { type: "image/png" });
  if (!EMBED && navigator.canShare?.({ files: [file] })) { try { await navigator.share({ files: [file], text, title: p.title }); return; } catch { return; } }
  saveBlob(blob, name); copy(text, "Ficha lista y texto con enlace copiado");
}
function planText(p) {
  const r = p.race, L2 = [];
  L2.push(`🏃 ${p.title}`, `${r.name} — ${fmtDate(r.date)}${r.time ? " a las " + r.time : ""}`, `📍 ${[r.city, r.province].filter(Boolean).join(", ")}${p.chosen ? ` · corro ${fmtDist(p.chosen)}` : ""}`);
  if (r.web) L2.push(r.web);
  if (p.stay) L2.push("", `🛏 Dormir: ${p.stay.name}${nightsOf(p) ? ` (${fmtShort(p.arrive)} → ${fmtShort(p.leave)})` : ""}${p.stay.url ? "\n" + p.stay.url : ""}`);
  const meals = p.meals.filter(m => m.place);
  if (meals.length) { L2.push("", "🍝 Comer:"); meals.forEach(m => L2.push(`• ${m.slot} (${fmtShort(m.day)} ${m.time}): ${m.place.name}`)); }
  if (p.notes) L2.push("", `📝 ${p.notes}`);
  L2.push("", "Hecho con Correr·Dormir·Comer");
  return L2.join("\n");
}
function planICS(p) {
  const r = p.race, stamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z";
  const dt = (d, t) => d.replace(/-/g, "") + (t ? "T" + t.replace(":", "") + "00" : "");
  const escI = s => String(s || "").replace(/[\\,;]/g, m => "\\" + m).replace(/\n/g, "\\n");
  const ev = (id, start, end, sum, loc, desc, allDay) => ["BEGIN:VEVENT", `UID:${p.id}-${id}@correr-dormir-comer`, `DTSTAMP:${stamp}`,
    allDay ? `DTSTART;VALUE=DATE:${start}` : `DTSTART;TZID=Europe/Madrid:${start}`, allDay ? `DTEND;VALUE=DATE:${end}` : `DTEND;TZID=Europe/Madrid:${end}`,
    `SUMMARY:${escI(sum)}`, loc ? `LOCATION:${escI(loc)}` : "", desc ? `DESCRIPTION:${escI(desc)}` : "", "END:VEVENT"].filter(Boolean);
  const out = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//correr-dormir-comer//ES", "CALSCALE:GREGORIAN"];
  const t = r.time || "09:00", [h, mi] = t.split(":").map(Number), endT = `${String(Math.min(23, h + 3)).padStart(2, "0")}:${String(mi).padStart(2, "0")}`;
  out.push(...ev("race", dt(r.date, t), dt(r.date, endT), `🏃 ${r.name}${p.chosen ? " (" + fmtDist(p.chosen) + ")" : ""}`, [r.city, r.province].filter(Boolean).join(", "), r.web));
  if (p.stay && nightsOf(p)) out.push(...ev("stay", dt(p.arrive), dt(p.leave), `🛏 ${p.stay.name}`, p.stay.addr || "", p.stay.url, true));
  p.meals.forEach((m, i) => { if (m.place) { const [a, b] = m.time.split(":").map(Number); out.push(...ev("meal" + i, dt(m.day, m.time), dt(m.day, `${String(Math.min(23, a + 1)).padStart(2, "0")}:${String(b).padStart(2, "0")}`), `🍽 ${m.slot}: ${m.place.name}`, m.place.addr || "", m.place.url)); } });
  p.events.forEach((e, i) => out.push(...ev("ev" + i, dt(e.day, e.time), dt(e.day, e.time), e.text, "", "")));
  out.push("END:VCALENDAR");
  return out.join("\r\n");
}
async function downloadOrCopy(text, name, type) {
  if (EMBED) return copy(text, `${name} copiado al portapapeles`);
  if (APP && CAP.Filesystem && CAP.Share) { // Android: guarda el archivo y abre el menú compartir (Calendario, Drive, WhatsApp…)
    try {
      const f = await CAP.Filesystem.writeFile({ path: name, data: text, directory: "CACHE", encoding: "utf8" });
      await CAP.Share.share({ title: name, files: [f.uri], dialogTitle: "Abrir o enviar" });
      return;
    } catch (e) { if (!/cancel/i.test(e?.message || "")) console.warn(e); return; }
  }
  try {
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    toast(`Descargando ${name}`);
  } catch { copy(text, `${name} copiado al portapapeles`); }
}
async function handleIncomingPlan() {
  const code = new URLSearchParams(location.search).get("plan");
  if (!code) return;
  try {
    const p = await decodePlan(code);
    history.replaceState(null, "", baseURL());
    openSharedPlan(p);
  } catch { toast("El enlace del plan está incompleto o dañado"); }
}
function openSharedPlan(p) {
  const exists = plans[p.id];
  openPlan(p, true);
  const bar = $("#planView .bar");
  const b = document.createElement("button");
  b.className = "btn primary small"; b.type = "button"; b.textContent = exists ? "Actualizar" : "Guardar";
  b.onclick = () => { savePlan(P); b.remove(); toast("Plan guardado en «Mis planes»"); };
  bar.insertBefore(b, $("#pvShare"));
  if (!APP && /Android/i.test(navigator.userAgent)) { // web en Android: pasar el plan a la app instalada
    encodePlan(p).then(code => {
      const a = document.createElement("a"); a.className = "btn ghost small"; a.textContent = "Abrir en la app";
      a.href = `intent://plan?c=${code}#Intent;scheme=correrdormircomer;package=es.correrdormircomer.app;S.browser_fallback_url=${encodeURIComponent(location.href)};end`;
      bar.insertBefore(a, b);
    });
  }
}

// ------------------------------------------------------------------ mis planes
function openPlans() {
  const v = $("#plansView");
  const list = Object.values(plans).sort((a, b) => a.race.date.localeCompare(b.race.date));
  v.innerHTML = `<div class="bar"><h2>Mis planes</h2></div>
    <div class="screen-body"><div class="plans-list">${list.length ? list.map(p => `<article class="plan-card"><span class="muted small">${fmtDate(p.race.date)}${p.race.date < today ? " · pasado" : ""}</span><h3>${esc(p.title)}</h3><span class="small">${esc(p.race.name)}</span>
      <div class="trio"><span class="r">Correr${p.chosen ? " " + fmtDist(p.chosen) : ""}</span><span class="${p.stay ? "s" : "off"}">Dormir</span><span class="${p.meals.some(m => m.place) ? "e" : "off"}">Comer ${p.meals.filter(m => m.place).length}/${p.meals.length}</span></div>
      <div class="share-row"><button class="btn primary small" data-open="${p.id}" type="button">Abrir</button><button class="btn ghost small" data-share="${p.id}" type="button">Copiar enlace</button></div></article>`).join("")
      : `<p class="empty">Aún no tienes planes. Abre una carrera y pulsa «Planificar finde».</p>`}</div>
    <div class="panel" style="margin-top:14px"><div class="panel-h"><span class="tag todo"></span><h2>Importar un plan</h2></div>
      <p class="small muted" style="margin-top:0">Pega aquí un enlace o código de plan que te hayan pasado, o carga un archivo exportado.</p>
      <div class="toolbar"><input id="impCode" placeholder="https://…?plan=z…  o  z…" style="flex:1;min-width:200px;background:var(--surface-2);border:1px solid var(--line);border-radius:8px;padding:8px 10px">
      <button class="btn primary small" id="impGo" type="button">Abrir plan</button>
      <label class="btn ghost small" for="impFile">Cargar archivo</label><input id="impFile" type="file" accept=".json,application/json" hidden></div></div></div>`;
  v.hidden = false;
  $$("[data-open]", v).forEach(b => b.onclick = () => openPlan(plans[b.dataset.open]));
  $$("[data-share]", v).forEach(b => b.onclick = async () => copy(await planURL(plans[b.dataset.share]), "Enlace copiado"));
  $("#impGo").onclick = async () => { try { const p = await decodePlan($("#impCode").value); openSharedPlan(p); } catch { toast("No reconozco ese código de plan"); } };
  $("#impFile").onchange = e => { const f = e.target.files[0]; if (!f) return; f.text().then(t => { const p = JSON.parse(t); if (!p.race) throw 0; openSharedPlan(p); }).catch(() => toast("Ese archivo no es un plan válido")); };
}

// ------------------------------------------------------------------ vistas móvil
function setTab(view) {
  $$(".tabbar button").forEach(b => b.classList.toggle("on", b.dataset.view === view));
  while (STACK.length) STACK.pop().close();
  $("#viewMap").hidden = view !== "map";
  $("#viewList").hidden = view === "map";
  $("#plansView").hidden = view !== "plans";
  if (view === "plans") openPlans();
  const fav = view === "fav";
  if (fav !== F.fav) { F.fav = fav; apply(); }
  if (view === "map" && map) setTimeout(() => { map.invalidateSize(); if (!mapTouched) fitToResults(); }, 30);
  if (view !== "map" && $("#mapCard")) $("#mapCard").hidden = true;
}

window.__cdc = { get map() { return map; }, get filtered() { return filtered; } }; // para pruebas automáticas

// ------------------------------------------------------------------ init
function init() {
  $("#plansCount").textContent = Object.keys(plans).length;
  bindFilters(); bindList();
  $("#brandLink").onclick = e => { e.preventDefault(); setTab("list"); $("#viewList").scrollTop = 0; };
  F.fav = false;
  $$(".tabbar button").forEach(b => b.onclick = () => setTab(b.dataset.view));
  document.addEventListener("keydown", e => { if (e.key === "Escape") handleBack(); });
  initBack(); initDeepLinks();
  if (window.CDC_APP) document.addEventListener("click", e => { // Android: enlaces externos en el navegador del sistema
    const a = e.target.closest("a[href^='http']"); if (!a) return;
    const P = window.Capacitor?.Plugins || {};
    e.preventDefault();
    if (P.Browser) P.Browser.open({ url: a.href }); else window.open(a.href, "_system");
  });
  if ("serviceWorker" in navigator && !window.CDC_APP && location.protocol === "https:" && !/claude|artifact/.test(location.host)) navigator.serviceWorker.register("sw.js").catch(() => {});
  load();
}
init();
})();
