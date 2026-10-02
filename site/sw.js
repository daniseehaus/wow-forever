// Service Worker: hält 3D-Modelldateien und 2D-Renders dauerhaft im Browser.
//
// GitHub Pages erlaubt nur 10 Minuten Cache (max-age=600). Danach fragt der Browser jede der rund 900 Modelldateien neu an,
// in privaten Fenstern lädt er sie ganz neu (bis 95 MB). Die Dateien tragen aber feste IDs (Modelle, Texturen)
// oder einen Hash im Namen (Renders) und ändern sich nie. Darum gilt: erst Cache, dann Netz.
// Viewer-Skript und Meta-Daten können sich beim Spiegeln ändern. Sie kommen sofort aus dem Cache und werden im Hintergrund erneuert.
// Daten (data.json usw.) und alles andere laufen unverändert über das Netz.

const MODELS = 'wf-models-';        // je Modell-Umgebung ein Cache, z. B. wf-models-live
const RENDERS = 'wf-renders';
const LIMIT = { models: 3000, renders: 40 };   // Einträge je Cache, danach fallen die ältesten weg

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  const path = url.pathname.slice(new URL(self.registration.scope).pathname.length);

  const model = path.match(/^modelviewer\/([^/]+)\/([^/]+)\//);
  if (model) {
    const cache = `${MODELS}${model[1]}`;
    e.respondWith(model[2] === 'viewer' || model[2] === 'meta' ? refresh(e, cache, req) : cacheFirst(e, cache, req, LIMIT.models));
    e.waitUntil(dropOtherEnvs(cache));
    return;
  }
  if (path.startsWith('renders/')) e.respondWith(cacheFirst(e, RENDERS, req, LIMIT.renders));
});

async function cacheFirst(e, name, req, limit) {
  const cache = await caches.open(name);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) e.waitUntil(cache.put(req, res.clone()).then(() => { if (++puts % 50 === 0) return trim(cache, limit); }));
  return res;
}

// Aus dem Cache antworten und im Hintergrund erneuern. Ohne Cache-Eintrag direkt vom Netz.
async function refresh(e, name, req) {
  const cache = await caches.open(name);
  const hit = await cache.match(req);
  const fresh = fetch(req).then((res) => {
    if (res.ok) e.waitUntil(cache.put(req, res.clone()));
    return res;
  });
  if (hit) {
    e.waitUntil(fresh.catch(() => {}));
    return hit;
  }
  return fresh;
}

// Cache-Schlüssel stehen in Einfügereihenfolge. Über dem Limit fallen die ältesten weg (alte Ausrüstung, altes Aussehen).
// Geprüft wird nach jeweils 50 neuen Dateien, nicht nach jeder.
let puts = 0;
async function trim(cache, limit) {
  const keys = await cache.keys();
  for (const key of keys.slice(0, Math.max(0, keys.length - limit))) await cache.delete(key);
}

// Wechselt die Seite die Modell-Umgebung (Vorschau mit Retail-Modellen, dann Forever mit Classic), fällt der alte Cache weg.
let checked = null;
function dropOtherEnvs(current) {
  checked ??= caches.keys().then((names) => Promise.all(names.filter((n) => n.startsWith(MODELS) && n !== current).map((n) => caches.delete(n))));
  return checked;
}
