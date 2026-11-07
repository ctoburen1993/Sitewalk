// App-shell cache so the app opens with no signal. Map tiles and USGS data still need a connection.
const CACHE = 'sitewalk11072026-1';
const SHELL = ['./', 'index.html', 'app.css', 'app.js', 'geo.js', 'lib/leaflet.js', 'lib/leaflet.css', 'lib/d3.min.js', 'lib/xlsx.mini.min.js', 'lib/jspdf.umd.min.js', 'lib/jszip.min.js',
  'lib/images/marker-icon.png', 'lib/images/marker-icon-2x.png', 'lib/images/marker-shadow.png', 'manifest.webmanifest', 'icon-192.png', 'icon-180.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL))); self.skipWaiting(); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))); self.clients.claim(); });
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (u.origin !== location.origin || e.request.method !== 'GET') return;     // never cache tiles/USGS
  // network-first so updates arrive; fall back to cache offline
  e.respondWith(fetch(e.request).then(r => { const c = r.clone(); caches.open(CACHE).then(k => k.put(e.request, c)); return r; }).catch(() => caches.match(e.request)));
});
