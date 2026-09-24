// Service worker: app offline + datos con "red primero".
const V = "cdc-v4";
const SHELL = ["./", "index.html", "app.css", "vendor-leaflet.css", "app.js", "manifest.webmanifest", "icon.svg", "icon-192.png", "icon-512.png", "data/spain.geo.json", "data/municipios.json", "fonts/fonts.css", "fonts/BarlowCondensed-700.woff2", "fonts/BarlowCondensed-800.woff2", "fonts/Figtree-400.woff2"];
self.addEventListener("install", e => e.waitUntil(caches.open(V).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener("activate", e => e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener("fetch", e => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin) return;
  const netFirst = u.pathname.endsWith("races.json") || u.pathname.endsWith(".js") || u.pathname.endsWith(".css") || e.request.mode === "navigate";
  e.respondWith(netFirst
    ? fetch(e.request).then(r => { const c = r.clone(); caches.open(V).then(x => x.put(e.request, c)); return r; }).catch(() => caches.match(e.request, { ignoreSearch: true }))
    : caches.match(e.request).then(m => m || fetch(e.request)));
});
