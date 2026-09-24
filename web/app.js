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
  } catch { /* sin municipios: se usan los pueblos de las carreras */ }
  if (F.q) apply();
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
  for (const r of RACES) {
    BYID.set(r.id, r);
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
// Cada pantalla abierta (ficha, plan, mis planes) añade una entrada al historial: el botón atrás del móvil la cierra.
const STACK = [];
function pushScreen(name, close) { STACK.push({ name, close }); history.pushState({ s: name }, ""); }
function popScreen(name) { // cierre desde un botón de la app
  const i = STACK.map(x => x.name).lastIndexOf(name);
  if (i < 0) return;
  STACK.splice(i, 1)[0].close();
  if (history.state?.s === name) { ignorePop = true; history.back(); }
}
let ignorePop = false;
addEventListener("popstate", () => {
  if (ignorePop) { ignorePop = false; return; }
  const top = STACK.pop(); if (top) top.close();
});

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
      ${r.img ? `<img class="hero-img" src="${esc(r.img)}" alt="" loading="lazy" onerror="this.remove()">` : ""}
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
      <p class="src-list">Aparece en: ${(r.src || []).map(s => `<a href="${esc(s.u)}" target="_blank" rel="noopener">${esc(s.n)}</a>`).join(" · ")}</p>
    </div>`;
  sheet.hidden = false; sheet.scrollTop = 0;
  if (!STACK.some(x => x.name === "race")) pushScreen("race", hideRace);
  $("#closeSheet").onclick = closeSheet;
  $("#planIt").onclick = () => openPlan(newPlan(r));
  sheet.querySelector("[data-fav]").onclick = e => { toggleFav(r.id); };
  if (r.lat && window.L) {
    if (rmap) { rmap.remove(); rmap = null; }
    rmap = L.map("raceMap", { preferCanvas: true, zoomControl: false, attributionControl: false, dragging: false, scrollWheelZoom: false, doubleClickZoom: false, touchZoom: false }).setView([r.lat, r.lon], r.approx ? 8 : 12);
    baseLayers(rmap);
    L.marker([r.lat, r.lon], { icon: L.divIcon({ className: "", html: `<div class="pin run">${ICON_RUN}</div>`, iconSize: [30, 30], iconAnchor: [15, 30] }) }).addTo(rmap);
  }
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
        <p class="small muted" style="margin:0">Todo el plan (carrera, alojamiento, comidas, itinerario, mochila y notas) va dentro del enlace. Quien lo abra puede guardarlo como suyo.</p>
        <div class="share-row">
          <button class="btn primary wide" id="shSend" type="button">Enviar plan (WhatsApp, Telegram…)</button>
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
const OVERPASS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter", "https://overpass.private.coffee/api/interpreter", "https://maps.mail.ru/osm/tools/overpass/api/interpreter"];
async function overpass(q) {
  let lastErr;
  for (const u of OVERPASS) {
    try {
      const ctl = new AbortController(), to = setTimeout(() => ctl.abort(), 20000);
      const r = await fetch(u, { method: "POST", signal: ctl.signal, body: "data=" + encodeURIComponent(q), headers: { "Content-Type": "application/x-www-form-urlencoded" } }).finally(() => clearTimeout(to));
      if (!r.ok) throw new Error(r.status);
      return (await r.json()).elements || [];
    } catch (e) { lastErr = e; }
  }
  throw lastErr;
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
async function searchStay() {
  const r = P.race, box = $("#stayRes");
  if (!r.lat) { box.innerHTML = `<p class="small muted">Esta carrera no tiene coordenadas; usa los enlaces de Booking/Airbnb.</p>`; return; }
  box.innerHTML = `<p class="small muted">Buscando en OpenStreetMap…</p>`;
  const types = $("#stayType").value, R = $("#stayR").value;
  const q = `[out:json][timeout:25];nwr["tourism"~"^(${types})$"](around:${R},${r.lat},${r.lon});out center tags 80;`;
  try {
    const list = (await overpass(q)).map(e => osmPlace(e, r)).filter(x => x.lat)
      .sort((a, b) => (!a._t.name - !b._t.name) || a._d - b._d).slice(0, 40); // primero los que tienen nombre
    box.innerHTML = resultsHTML(list, "sleep"); showCandidates(list, "sleep");
  } catch {
    box.innerHTML = `<p class="small muted">No se pudo consultar OpenStreetMap desde aquí. Usa los botones de Booking, Airbnb o Google.</p>`;
  }
}
async function searchEat(i) {
  const m = P.meals[i], c = P.stay?.lat ? P.stay : P.race, box = $(`[data-mres="${i}"]`);
  if (!c.lat) { box.innerHTML = `<p class="small muted">Sin coordenadas: usa el enlace de Google Maps.</p>`; return; }
  box.innerHTML = `<p class="small muted">Buscando…</p>`;
  const pref = PREFS[m.pref] || PREFS.any, amen = pref.amen || "restaurant";
  const q = `[out:json][timeout:25];nwr["amenity"~"^(${amen})$"](around:2500,${c.lat},${c.lon});out center tags 150;`;
  try {
    let list = (await overpass(q)).map(e => osmPlace(e, c)).filter(x => x.lat && x._t.name);
    const match = list.filter(x => pref.diet ? /yes|only/.test(x._t["diet:vegetarian"] || x._t["diet:vegan"] || "") || pref.re.test(x._t.cuisine || "") : pref.re.test(`${x._t.cuisine || ""} ${x._t.amenity} ${x._t.name}`));
    list = (match.length >= 3 ? match : [...match, ...list.filter(x => !match.includes(x))]).sort((a, b) => a._d - b._d).slice(0, 30);
    box.innerHTML = (match.length < 3 && list.length ? `<p class="small muted">Pocos sitios etiquetados así; te enseño también otros cercanos.</p>` : "") + resultsHTML(list, "eat", i);
    showCandidates(list, "eat");
  } catch {
    box.innerHTML = `<p class="small muted">No se pudo consultar OpenStreetMap desde aquí. Usa el enlace de Google Maps.</p>`;
  }
}

// ------------------------------------------------------------------ compartir
const b64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64u = s => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0));
async function encodePlan(p) {
  const { created, ...rest } = p;
  const json = JSON.stringify(rest);
  if (window.CompressionStream) {
    const s = new Blob([json]).stream().pipeThrough(new CompressionStream("deflate-raw"));
    return "z" + b64u(await new Response(s).arrayBuffer());
  }
  return "j" + b64u(new TextEncoder().encode(json));
}
async function decodePlan(code) {
  code = code.trim().replace(/^.*[?&#]plan=/, "").replace(/&.*$/, "");
  const kind = code[0], bytes = unb64u(code.slice(1));
  let json;
  if (kind === "z") { const s = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw")); json = await new Response(s).text(); }
  else json = new TextDecoder().decode(bytes);
  const p = JSON.parse(json);
  if (!p.race || !p.v) throw new Error("no es un plan");
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
async function refreshShare() {
  if (!P) return;
  const code = await encodePlan(P), url = (EMBED || APP) && !PUBLIC_URL ? code : `${baseURL()}?plan=${code}`;
  const c = $("#planCode"); if (c) c.textContent = code;
  const q = $("#qr");
  if (q && window.qrcode) {
    try { const qr = qrcode(0, "L"); qr.addData(url); qr.make(); q.innerHTML = qr.createSvgTag({ cellSize: 3, margin: 2, scalable: true }); }
    catch { q.innerHTML = `<p class="small" style="color:#333">Plan demasiado grande para QR; usa el enlace.</p>`; }
  }
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
  document.addEventListener("keydown", e => { if (e.key === "Escape") { if (!$("#filterSheet").hidden) openFilterSheet(false); else if (STACK.length) history.back(); } });
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
