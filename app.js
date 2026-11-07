/* SiteWalk Takeoff — sitework estimating from a phone site walk + USGS LiDAR. */
(function () {
'use strict';
const G = window.Geo;
// Optional host hooks (used by the in-app beta to supply demo imagery / simulated GPS)
const EMBED = window.__SITEWALK_EMBED || null;
const CAN_PRINT = !EMBED;
// true while a map tap means "place something" rather than "open what I tapped"
function mapCapturing() { return draw.on || treeMode || pinMode || !!placeCb || !!(EMBED && EMBED.capturing && EMBED.capturing()); }

// ======================================================================
// Config
// ======================================================================
const LIDAR_URL = 'https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/getSamples';
const EPQS_URL = 'https://epqs.nationalmap.gov/v1/json';
const ESRI_GEOCODE = 'https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/findAddressCandidates';
const NOMINATIM = 'https://nominatim.openstreetmap.org/search';

const MATERIALS = {
  '#57 stone':            { density: 1.40, price: 40 },
  'Crusher run / ABC':    { density: 1.50, price: 32 },
  '#2 stone':             { density: 1.40, price: 36 },
  'DGA / Item 4':         { density: 1.50, price: 29 },
  'Recycled concrete':    { density: 1.30, price: 22 },
  'Fill sand':            { density: 1.35, price: 24 },
  'Rip-rap':              { density: 1.50, price: 48 },
  'Custom':               { density: 1.40, price: 30 }
};
const DEFAULT_PRICES = {
  cut: 4.50,        // $/BCY excavate & move on site
  fill: 3.75,       // $/CCY place & compact
  import: 16.00,    // $/LCY borrow fill delivered
  export: 12.00,    // $/LCY haul off
  tsStrip: 3.25,    // $/CY strip & stockpile
  tsRespread: 4.00, // $/CY respread & fine grade
  tsImport: 32.00,  // $/LCY screened topsoil delivered
  fabric: 1.40,     // $/SY geotextile
  treeS: 250,       // $/ea remove tree < 12" DBH
  treeM: 650,       // $/ea remove tree 12–24" DBH
  treeL: 1400,      // $/ea remove tree > 24" DBH
  stump: 150,       // $/ea stump grinding
  treePlant: 350,   // $/ea plant new tree
  clearLight: 3500,  // $/AC clear & grub, light brush / scattered trees
  clearMedium: 7000, // $/AC clear & grub, medium woods
  clearHeavy: 11000, // $/AC clear & grub, heavy woods
  treeProtect: 90,  // $/ea protection fence for trees to remain
  demoSF: 8.00,     // $/SF demolish structure (house, shed, pool)
  demoEA: 1500,     // $/ea demolish small structure marked as a point
  paveSF: 2.50,     // $/SF remove driveway paving
  fenceLF: 4.00,    // $/LF remove fence
  wallLF: 25.00,    // $/LF remove wall
  wellAbandon: 1500,   // $/ea abandon & seal well
  septicAbandon: 2000, // $/ea abandon septic tank
  mobilization: 1500,
  markupPct: 15
};
const DEFAULT_FACTORS = { shrinkPct: 15, swellPct: 25, truckLCY: 12, topsoilLoosePct: 20, maxAccFt: 50, contourFt: 1, detail: 'normal', source: 'lidar' };
const TYPE = {
  pad:     { label: 'Building pad', color: '#ff7043' },
  cutfill: { label: 'Cut / Fill', color: '#e8710a' },
  topsoil: { label: 'Topsoil', color: '#8bc34a' },
  gravel:  { label: 'Driveway / gravel', color: '#b0bec5' },
  trench:  { label: 'Utility trench', color: '#4fc3f7' },
  seed:    { label: 'Seed & straw', color: '#9ccc65' }
};
// Residential building pad defaults: pad 6 ft past the house, 3:1 side slopes,
// 4" slab + 6" stone (pad = slab − 10"), +35% dirt for compaction
const PAD_DEFAULTS = { offsetFt: 6, slope: 3, slabIn: 4, stoneIn: 6, extraPct: 35, stripIn: 0 };

// ======================================================================
// Utilities
// ======================================================================
const $ = s => document.querySelector(s);
const uid = () => Math.random().toString(36).slice(2, 10);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = (n, d = 0) => (n == null || !isFinite(n)) ? '—' : Number(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const money = n => (n == null || !isFinite(n)) ? '—' : '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
const clone = o => JSON.parse(JSON.stringify(o));
const sleep = ms => new Promise(r => setTimeout(r, ms));

let toastT;
function toast(msg, ms = 2600) {
  const t = $('#toast'); t.textContent = msg; t.classList.remove('hidden');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.add('hidden'), ms);
}

// Generic bottom-sheet form. fields: [{key,label,type,value,options,step,help}]
function form(title, fields, okText = 'Save', extraHtml = '') {
  return new Promise(resolve => {
    const card = $('#modalCard');
    card.innerHTML = `<h2 style="margin:0 0 6px">${esc(title)}</h2>` + fields.map(f => {
      const id = 'f_' + f.key;
      let input;
      if (f.type === 'select') input = `<select id="${id}">${f.options.map(o => { const [v, l] = Array.isArray(o) ? o : [o, o]; return `<option value="${esc(v)}" ${String(v) === String(f.value) ? 'selected' : ''}>${esc(l)}</option>`; }).join('')}</select>`;
      else if (f.type === 'textarea') input = `<textarea id="${id}" rows="4">${esc(f.value)}</textarea>`;
      else input = `<input id="${id}" type="${f.type || 'text'}" ${f.type === 'number' ? 'inputmode="decimal" step="' + (f.step || 'any') + '"' : ''} value="${esc(f.value == null ? '' : f.value)}" placeholder="${esc(f.placeholder || '')}">`;
      return `<label for="${id}">${esc(f.label)}</label>${input}${f.help ? `<div class="muted" style="margin-top:4px">${esc(f.help)}</div>` : ''}`;
    }).join('') + extraHtml + `<div class="row mt" style="margin-top:16px"><button class="sec" id="mCancel">Cancel</button><button class="pri" id="mOk">${esc(okText)}</button></div>`;
    $('#modal').classList.remove('hidden');
    const done = v => { $('#modal').classList.add('hidden'); resolve(v); };
    $('#mCancel').onclick = () => done(null);
    $('#mOk').onclick = () => {
      const out = {};
      for (const f of fields) { const v = $('#f_' + f.key).value; out[f.key] = f.type === 'number' ? (v === '' ? null : parseFloat(v)) : v; }
      done(out);
    };
    const first = card.querySelector('input,select'); if (first && fields[0] && fields[0].type !== 'select') setTimeout(() => first.focus(), 50);
    card.querySelectorAll('input').forEach(i => i.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); $('#mOk').click(); } }));
  });
}
function confirmBox(msg, okText = 'OK') {
  return new Promise(resolve => {
    $('#modalCard').innerHTML = `<p style="font-size:16px;line-height:1.4">${esc(msg)}</p><div class="row"><button class="sec" id="mCancel">Cancel</button><button class="pri" id="mOk">${esc(okText)}</button></div>`;
    $('#modal').classList.remove('hidden');
    const done = v => { $('#modal').classList.add('hidden'); resolve(v); };
    $('#mCancel').onclick = () => done(false); $('#mOk').onclick = () => done(true);
  });
}

// ======================================================================
// Storage
// ======================================================================
const LS_KEY = 'sitewalk.v1';
let store = { projects: [], currentId: null, prices: clone(DEFAULT_PRICES), materials: clone(MATERIALS) };
try { const s = JSON.parse(localStorage.getItem(LS_KEY)); if (s && s.projects) store = Object.assign(store, s); } catch (e) { /* fresh */ }

function newProject(name) {
  return {
    id: uid(), name: name || 'New site', address: '', created: Date.now(), origin: null, pin: null, view: null,
    walks: [], shots: [], areas: [], lines: [], linesV: 1, trees: [], features: [], boundary: null, surface: null, factors: clone(DEFAULT_FACTORS),
    prices: clone(store.prices)
  };
}
if (!store.projects.length) { const p = newProject(); store.projects.push(p); store.currentId = p.id; }
let P = store.projects.find(p => p.id === store.currentId) || store.projects[0];
store.currentId = P.id;
P.trees = P.trees || [];
P.features = P.features || [];
store.projects.forEach(p => migrateTrees(p));
P.factors = Object.assign(clone(DEFAULT_FACTORS), P.factors || {});
P.prices = Object.assign(clone(DEFAULT_PRICES), P.prices || {});

let saveT;
function save(now) {
  clearTimeout(saveT);
  const go = () => { try { localStorage.setItem(LS_KEY, JSON.stringify(store)); } catch (e) { toast('Storage full — export & delete old sites'); } };
  if (now) go(); else saveT = setTimeout(go, 400);
}
window.addEventListener('pagehide', () => save(true));

function origin() {
  if (!P.origin) { const c = map.getCenter(); P.origin = { lat0: c.lat, lon0: c.lng }; }
  return P.origin;
}
const xyOf = ll => G.toXY(ll[0], ll[1], origin());
const llOf = (x, y) => G.toLL(x, y, origin());

// ======================================================================
// Map
// ======================================================================
const map = L.map('map', { zoomControl: false, attributionControl: true, maxZoom: 22, tap: true }).setView([39.5, -98.35], 4);
const baseLayers = {
  'Satellite (Esri)': L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxNativeZoom: 19, maxZoom: 22, attribution: 'Imagery © Esri, Maxar, Earthstar Geographics' }),
  'Satellite (USGS)': L.tileLayer('https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}', { maxNativeZoom: 16, maxZoom: 22, attribution: 'USGS The National Map' }),
  'USGS Topo': L.tileLayer('https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}', { maxNativeZoom: 16, maxZoom: 22, attribution: 'USGS The National Map' }),
  'Streets (OSM)': L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxNativeZoom: 19, maxZoom: 22, attribution: '© OpenStreetMap contributors' })
};
// hybrid = satellite + road and place-name labels
const labelsLayer = L.layerGroup([
  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}', { maxNativeZoom: 19, maxZoom: 22, opacity: 0.8 }),
  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', { maxNativeZoom: 19, maxZoom: 22 })
]);
let baseName = 'Satellite (Esri)';
if (EMBED && EMBED.setupMap) {
  for (const k in baseLayers) delete baseLayers[k];
  Object.assign(baseLayers, EMBED.setupMap(map));
  baseName = Object.keys(baseLayers)[0];
} else { baseLayers[baseName].addTo(map); labelsLayer.addTo(map); }

const lyr = {
  contours: L.layerGroup(), heat: L.layerGroup().addTo(map), areas: L.layerGroup().addTo(map),
  walks: L.layerGroup().addTo(map), shots: L.layerGroup().addTo(map), draw: L.layerGroup().addTo(map),
  bnd: L.layerGroup().addTo(map), feats: L.layerGroup().addTo(map), trees: L.layerGroup().addTo(map),
  lines: L.layerGroup().addTo(map), verts: L.layerGroup().addTo(map), pin: L.layerGroup().addTo(map), me: L.layerGroup().addTo(map)
};
map.createPane('heatPane'); map.getPane('heatPane').style.zIndex = 390;

if (P.view) map.setView(P.view.c, P.view.z);
map.on('moveend', () => { const c = map.getCenter(); P.view = { c: [c.lat, c.lng], z: map.getZoom() }; save(); });

// ======================================================================
// GPS
// ======================================================================
let watchId = null, lastFix = null, follow = false, wakeLock = null;
const meIcon = L.divIcon({ className: 'me' });
let meMarker = null, meCircle = null;

function startGPS() {
  if (watchId != null) return true;
  if (!('geolocation' in navigator)) { toast('Location not available on this device'); return false; }
  if (!window.isSecureContext) { toast('GPS needs HTTPS — host the app on an https:// address'); }
  watchId = navigator.geolocation.watchPosition(onFix, err => {
    if (pendingLocate) { const cb = pendingLocate; pendingLocate = null; cb(null); }
    if (err.code === 1) { navigator.geolocation.clearWatch(watchId); watchId = null; }
    toast(err.code === 1 ? 'Location permission denied — enable it in Settings › Safari › Location' : 'GPS: ' + err.message, 4000);
  }, { enableHighAccuracy: true, maximumAge: 0, timeout: 30000 });
  $('#gpsBadge').classList.remove('hidden');
  return true;
}
function onFix(pos) {
  const c = pos.coords;
  lastFix = { lat: c.latitude, lon: c.longitude, acc: c.accuracy * G.M2FT, alt: c.altitude == null ? null : c.altitude * G.M2FT, altAcc: c.altitudeAccuracy == null ? null : c.altitudeAccuracy * G.M2FT, t: pos.timestamp };
  const ll = [lastFix.lat, lastFix.lon];
  if (!meMarker) { meMarker = L.marker(ll, { icon: meIcon, interactive: false, zIndexOffset: 1000 }).addTo(lyr.me); meCircle = L.circle(ll, { radius: c.accuracy, color: '#1a73e8', weight: 1, fillOpacity: 0.1, interactive: false }).addTo(lyr.me); }
  else { meMarker.setLatLng(ll); meCircle.setLatLng(ll).setRadius(c.accuracy); }
  const b = $('#gpsBadge'); b.textContent = `${window.innerWidth > 430 ? 'GPS ' : ''}±${Math.round(lastFix.acc)} ft`;
  b.className = 'badge ' + (lastFix.acc <= 16 ? 'good' : lastFix.acc <= 40 ? 'mid' : 'bad');
  if (follow) map.panTo(ll, { animate: true });
  if (walk.active && !walk.paused) recordFix(lastFix);
  if (ui.tab === 'walk') updateWalkStats();
  if (pendingLocate) { const cb = pendingLocate; pendingLocate = null; cb(lastFix); }
  fixListeners.forEach(fn => { try { fn(lastFix); } catch (e) { /* ignore */ } });
}
let pendingLocate = null;
const fixListeners = new Set();
// One position; resolves null if location is denied or times out
function locateOnce(timeoutMs = 20000) {
  return new Promise(res => {
    if (lastFix && Date.now() - lastFix.t < 5000) return res(lastFix);
    const prev = pendingLocate;
    let t = null;
    const done = f => { clearTimeout(t); if (prev) prev(f); res(f); };
    t = setTimeout(() => { if (pendingLocate === done) pendingLocate = null; res(lastFix || null); }, timeoutMs);
    pendingLocate = done;
    if (!startGPS()) { pendingLocate = null; done(null); }
  });
}
// Average the fixes over a few seconds (weighted by accuracy) for marking a point
function averageFix(ms = 3000) {
  return new Promise(async res => {
    const first = await locateOnce(); if (!first) return res(null);
    const got = [first]; const fn = f => got.push(f); fixListeners.add(fn);
    setTimeout(() => {
      fixListeners.delete(fn);
      let sw = 0, la = 0, lo = 0, best = Infinity;
      got.forEach(f => { const w = 1 / Math.pow(Math.max(1, f.acc), 2); sw += w; la += f.lat * w; lo += f.lon * w; best = Math.min(best, f.acc); });
      res({ lat: la / sw, lon: lo / sw, acc: best / Math.sqrt(got.length), n: got.length, alt: first.alt });
    }, ms);
  });
}
function needFix(f) { if (!f) toast('Can’t get your location. Allow Location for this app, or tap the map instead.', 4500); return !!f; }
async function keepAwake(on) {
  try {
    if (on && 'wakeLock' in navigator && !wakeLock) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => { wakeLock = null; }); }
    if (!on && wakeLock) { await wakeLock.release(); wakeLock = null; }
  } catch (e) { /* not supported */ }
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && walk.active) keepAwake(true); });

// ======================================================================
// Site walk
// ======================================================================
const walk = { active: false, paused: false, cur: null, line: null, startT: 0 };
function recordFix(f) {
  if (f.acc > P.factors.maxAccFt) return;           // reject poor fixes
  const pts = walk.cur.points, last = pts[pts.length - 1];
  if (last) {
    const d = Math.hypot(...G.toXY(f.lat, f.lon, { lat0: last.lat, lon0: last.lon }));
    if (d < 3 && f.t - last.t < 10000) return;       // ignore jitter while standing
  }
  pts.push({ lat: f.lat, lon: f.lon, alt: f.alt, acc: Math.round(f.acc * 10) / 10, altAcc: f.altAcc, t: f.t });
  if (walk.line) walk.line.addLatLng([f.lat, f.lon]);
  if (walk.cur.purpose === 'trace' && !walk.closeNoted && walkDist(walk.cur) > 120 && distToStart(walk.cur) < 20) {
    walk.closeNoted = true; toast('You’re back at the start. Tap Finish trace to close the boundary.', 5000);
  }
  save();
}
function walkDist(w) { let d = 0; for (let i = 1; i < w.points.length; i++) d += Math.hypot(...G.toXY(w.points[i].lat, w.points[i].lon, { lat0: w.points[i - 1].lat, lon0: w.points[i - 1].lon })); return d; }
function startWalk(opts = {}) {
  if (!startGPS()) return;
  origin();
  walk.cur = { id: uid(), started: Date.now(), points: [], purpose: opts.purpose || 'survey' };
  walk.onDone = opts.onDone || null; walk.closeNoted = false;
  P.walks.push(walk.cur);
  walk.active = true; walk.paused = false; walk.startT = Date.now(); follow = true;
  walk.line = L.polyline([], { color: '#ffd60a', weight: 4 }).addTo(lyr.walks);
  keepAwake(true); save();
  if (ui.tab !== 'walk') setTab('walk'); else render();
  toast(walk.cur.purpose === 'trace' ? 'Tracing — walk along the property line and come back to where you started' : 'Walking — keep the screen on and walk the site perimeter & high/low spots', 4000);
}
function startTrace(onDone) { startWalk({ purpose: 'trace', onDone }); }
function traceBoundary() { startTrace(w => { if (boundaryFromWalk(w)) afterBoundary(); }); }
function stopWalk() {
  const w = walk.cur, cb = walk.onDone; walk.onDone = null;
  walk.active = false; follow = false; keepAwake(false);
  if (w && w.points.length < 2) { P.walks = P.walks.filter(x => x !== w); toast('Walk too short — discarded'); }
  walk.cur = null; save(true); drawWalks(); render();
  if (cb) { if (w && P.walks.includes(w)) cb(w); return; }
  if (P.walks.length) setTimeout(() => offerSurface(), 300);
}
function distToStart(w) {
  if (!w || w.points.length < 2) return null;
  const a = w.points[0], b = w.points[w.points.length - 1];
  return Math.hypot(...G.toXY(b.lat, b.lon, { lat0: a.lat, lon0: a.lon }));
}
async function offerSurface() {
  if (await confirmBox('Walk saved. Pull USGS LiDAR ground elevations for the walked area now?', 'Build surface')) { setTab('site'); buildSurface(); }
}
async function dropShot() {
  const f = await locateOnce(); if (!needFix(f)) return;
  const here = P.surface ? G.zAt(P.surface, ...xyOf([f.lat, f.lon])) : null;
  const v = await form('Spot shot', [
    { key: 'label', label: 'Label', value: 'Shot ' + (P.shots.length + 1), placeholder: 'e.g. Manhole rim, BM, corner' },
    { key: 'elev', label: 'Known elevation (ft) — optional', type: 'number', value: '', help: 'Enter only if you have a real elevation here (benchmark, laser level, plan spot). Known elevations tie the LiDAR surface to your datum.' }
  ], 'Save shot', `<div class="muted mt">GPS ±${Math.round(f.acc)} ft · phone alt ${f.alt == null ? '—' : num(f.alt, 1) + ' ft'}${here != null ? ' · LiDAR ' + num(here, 1) + ' ft' : ''}</div>`);
  if (!v) return;
  P.shots.push({ id: uid(), lat: f.lat, lon: f.lon, acc: f.acc, gpsAlt: f.alt, label: v.label, elev: v.elev });
  save(); drawShots(); render();
  if (v.elev != null && P.surface) toast('Known elevation saved — rebuild the surface to apply it');
}

// ======================================================================
// Elevation surface
// ======================================================================
const surfJob = { running: false, done: 0, total: 0, msg: '' };

async function fetchLidarChunk(lls) {
  const body = new URLSearchParams({
    geometry: JSON.stringify({ points: lls.map(([la, lo]) => [lo, la]), spatialReference: { wkid: 4326 } }),
    geometryType: 'esriGeometryMultipoint', returnFirstValueOnly: 'true', interpolation: 'RSP_BilinearInterpolation', f: 'json'
  });
  const r = await fetch(LIDAR_URL, { method: 'POST', body });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const j = await r.json();
  if (j.error) throw new Error(j.error.message || 'service error');
  const out = new Array(lls.length).fill(null), res = [];
  for (const s of j.samples || []) {
    const v = parseFloat(s.value);
    const id = s.locationId != null ? s.locationId : null;
    if (id != null && isFinite(v) && v > -500) out[id] = v * G.M2FT;
    if (s.resolution) res.push(parseFloat(s.resolution));
  }
  return { z: out, res };
}
async function fetchEpqs(lat, lon) {
  const r = await fetch(`${EPQS_URL}?x=${lon}&y=${lat}&wkid=4326&units=Feet&includeDate=false`);
  const j = await r.json(); const v = parseFloat(j.value);
  return isFinite(v) && v > -1000 ? v : null;
}

async function buildSurface() {
  if (surfJob.running) return;
  const o = origin();
  const pts = [];
  P.walks.forEach(w => w.points.forEach(p => pts.push(xyOf([p.lat, p.lon]))));
  P.shots.forEach(s => pts.push(xyOf([s.lat, s.lon])));
  P.areas.forEach(a => { a.pts.forEach(p => pts.push(xyOf(p))); if (a._ext) a._ext.forEach(p => pts.push(xyOf(p))); });
  (P.lines || []).forEach(Ln => { (Ln.shapes || []).forEach(s => s.pts.forEach(p => pts.push(xyOf(p)))); if (Ln._ext) Ln._ext.forEach(p => pts.push(xyOf(p))); });
  if (P.pin) pts.push(xyOf(P.pin));
  (P.boundary || []).forEach(p => pts.push(xyOf(p)));
  P.trees.forEach(t => pts.push(xyOf([t.lat, t.lon])));
  P.features.forEach(f => f.pts.forEach(p => pts.push(xyOf(p))));
  if (pts.length < 2) {   // nothing walked/drawn: use the visible map
    const b = map.getBounds();
    pts.push(xyOf([b.getSouth(), b.getWest()]), xyOf([b.getNorth(), b.getEast()]));
    const sz = Math.hypot(pts[0][0] - pts[1][0], pts[0][1] - pts[1][1]);
    if (sz > 6000) { toast('Zoom in to the site (or walk / draw it) before building the surface', 4000); return; }
  }
  const maxPts = P.factors.detail === 'high' ? 6000 : 2500;
  const g = G.makeGridSpec(pts, 60, maxPts);
  const n = g.nx * g.ny;
  const lls = [];
  for (let j = 0; j < g.ny; j++) for (let i = 0; i < g.nx; i++) lls.push(llOf(...G.gridNodeXY(g, i, j)));

  Object.assign(surfJob, { running: true, done: 0, total: n, msg: 'Requesting USGS 3DEP elevations…' });
  render();
  let z = new Array(n).fill(null), resAll = [], source = P.factors.source;
  try {
    if (source === 'gps') {
      const gp = [];
      P.walks.forEach(w => w.points.forEach(p => { if (p.alt != null) { const [x, y] = xyOf([p.lat, p.lon]); gp.push({ x, y, z: p.alt }); } }));
      if (gp.length < 3) throw new Error('No phone altitude data recorded — use USGS LiDAR');
      for (let k = 0; k < n; k++) { const [x, y] = G.gridNodeXY(g, k % g.nx, Math.floor(k / g.nx)); z[k] = G.idw(gp, x, y); }
      surfJob.done = n;
    } else {
      const CH = 400, chunks = [];
      for (let s = 0; s < n; s += CH) chunks.push(s);
      let failed = 0;
      const worker = async () => {
        while (chunks.length) {
          const s = chunks.shift(); const part = lls.slice(s, s + CH);
          let ok = false;
          for (let attempt = 0; attempt < 3 && !ok; attempt++) {
            try { const r = await fetchLidarChunk(part); r.z.forEach((v, k) => { z[s + k] = v; }); resAll.push(...r.res); ok = true; }
            catch (e) { await sleep(800 * (attempt + 1)); }
          }
          if (!ok) failed++;
          surfJob.done = Math.min(n, surfJob.done + part.length); updateSurfProgress();
        }
      };
      await Promise.all([worker(), worker(), worker()]);
      // Fallback: point query service for anything still missing (slow, so cap)
      const missing = z.map((v, k) => v == null ? k : -1).filter(k => k >= 0);
      if (missing.length && missing.length <= 600) {
        surfJob.msg = `Filling ${missing.length} gaps from USGS point service…`; surfJob.done = 0; surfJob.total = missing.length; updateSurfProgress();
        const q = missing.slice();
        const w2 = async () => { while (q.length) { const k = q.shift(); try { z[k] = await fetchEpqs(...lls[k]); } catch (e) { } surfJob.done++; updateSurfProgress(); } };
        await Promise.all([w2(), w2(), w2(), w2(), w2(), w2()]);
      }
      const valid = z.filter(v => v != null).length;
      if (valid < n * 0.5) throw new Error(failed ? 'USGS elevation service unreachable — check signal and try again' : 'No USGS elevation coverage here');
    }
    // Tie to known elevations (spot shots with an entered elevation): IDW of residuals
    const surf = Object.assign({}, g, { lat0: o.lat0, lon0: o.lon0, z, source, built: Date.now(), resolutionM: G.median(resAll), tie: null });
    const ties = P.shots.filter(s => s.elev != null).map(s => { const [x, y] = xyOf([s.lat, s.lon]); const e = G.zAt(surf, x, y); return e == null ? null : { x, y, z: s.elev - e }; }).filter(Boolean);
    if (ties.length) {
      surf.z = z.map((v, k) => v == null ? null : v + G.idw(ties, ...G.gridNodeXY(g, k % g.nx, Math.floor(k / g.nx)), 8, 2));
      surf.tie = { n: ties.length, avg: ties.reduce((s, t) => s + t.z, 0) / ties.length };
    }
    P.surface = surf;
    // Compare phone altitude to the surface (informational)
    const diffs = [];
    P.walks.forEach(w => w.points.forEach(p => { if (p.alt != null) { const e = G.zAt(surf, ...xyOf([p.lat, p.lon])); if (e != null) diffs.push(p.alt - e); } }));
    if (diffs.length > 5) { const m = G.median(diffs); surf.gpsBias = { median: m, spread: G.median(diffs.map(d => Math.abs(d - m))) * 1.4826, n: diffs.length }; }
    // Default design elevations for new cut/fill areas
    P.areas.forEach(a => { if (a.type === 'cutfill' && a.p.elev == null) seedElev(a); });
    save(true);
    toast('Surface ready: ' + num(n) + ' points @ ' + g.spacing + ' ft');
    if (contoursOn) drawContours(); else toggleContours();   // always show contours once ground data exists
  } catch (e) {
    toast(e.message, 5000);
  } finally {
    surfJob.running = false; render(); redrawAreas();
  }
}
function updateSurfProgress() {
  const bar = $('#surfBar'), m = $('#surfMsg');
  if (bar) bar.style.width = (100 * surfJob.done / Math.max(1, surfJob.total)).toFixed(0) + '%';
  if (m) m.textContent = surfJob.msg + ' ' + num(surfJob.done) + ' / ' + num(surfJob.total);
}
function surfaceCovers(a) {
  if (!P.surface) return false;
  const xy = a.pts.map(xyOf);
  return G.covers(P.surface, xy);
}

// ======================================================================
// Contours + heat map
// ======================================================================
let contoursOn = false;
// Contour lines in local xy (ft): [{value, idx, step, pts:[[x,y]]}]
function contourLines() {
  const s = P.surface; if (!s) return [];
  const vals = s.z.map(v => v == null ? NaN : v);
  const fin = vals.filter(isFinite); if (!fin.length) return [];
  const lo = Math.min(...fin), hi = Math.max(...fin), iv = P.factors.contourFt || 1;
  let step = iv; while ((hi - lo) / step > 80) step *= 2;
  const th = []; for (let t = Math.ceil(lo / step) * step; t <= hi; t += step) th.push(+t.toFixed(3));
  const cs = d3.contours().size([s.nx, s.ny]).smooth(true).thresholds(th)(vals);
  const out = [];
  cs.forEach(c => {
    const idx = Math.abs(Math.round(c.value / (step * 5)) * step * 5 - c.value) < 1e-6;
    c.coordinates.forEach(poly => poly.forEach(ring => {
      // split rings where they run along the grid border
      let cur = [];
      const flush = () => { if (cur.length > 1) out.push({ value: c.value, idx, step, pts: cur }); cur = []; };
      ring.forEach(([x, y]) => {
        if (x > 0.51 && y > 0.51 && x < s.nx - 0.51 && y < s.ny - 0.51) cur.push([s.x0 + (x - 0.5) * s.spacing, s.y0 + (y - 0.5) * s.spacing]);
        else flush();
      });
      flush();
    }));
  });
  return out;
}
function drawContours() {
  lyr.contours.clearLayers();
  const s = P.surface; if (!s) return;
  contourLines().forEach(c => {
    const idx = c.idx, step = c.step;
    {
      const pts = c.pts.map(([x, y]) => G.toLL(x, y, s));
      if (pts.length < 2) return;
      L.polyline(pts, { color: idx ? '#ffb74d' : '#fff', weight: idx ? 2 : 1, opacity: idx ? 0.95 : 0.6, interactive: false, smoothFactor: 1 }).addTo(lyr.contours);
      // elevation label: orange number set along the contour, no box (unlike boundary dimensions)
      if (idx && pts.length > 8) { const m = Math.floor(pts.length / 2); lineLabel(pts[m - 1], pts[m + 1], pts[m], num(c.value, step < 1 ? 1 : 0), 'clabel').addTo(lyr.contours); }
    }
  });
}
// A label rotated to run along a line (kept upright), as a non-interactive marker
function lineLabel(a, b, at, text, cls) {
  const p1 = map.latLngToLayerPoint(a), p2 = map.latLngToLayerPoint(b);
  let deg = Math.atan2(p2.y - p1.y, p2.x - p1.x) * 180 / Math.PI;
  if (deg > 90) deg -= 180; if (deg < -90) deg += 180;
  return L.marker(at, { interactive: false, keyboard: false, icon: L.divIcon({ className: cls, iconSize: [0, 0], html: `<span style="transform:translate(-50%,-50%) rotate(${deg.toFixed(1)}deg)">${esc(text)}</span>` }) });
}
function toggleContours() {
  if (!P.surface) { toast('Build the elevation surface first (Site tab)'); return; }
  contoursOn = !contoursOn; $('#btnContours').classList.toggle('on', contoursOn);
  if (contoursOn) { drawContours(); lyr.contours.addTo(map); } else map.removeLayer(lyr.contours);
}

function drawHeat(a, res) {
  lyr.heat.clearLayers();
  if (!a || !res || !res.dz) return;
  const { ras, dz } = res, [minx, miny, maxx, maxy] = ras.bbox, r = ras.r;
  const w = Math.max(1, Math.ceil((maxx - minx) / r)), h = Math.max(1, Math.ceil((maxy - miny) / r));
  if (w * h > 4e6) return;
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d'), img = ctx.createImageData(w, h);
  const mx = Math.max(0.5, res.maxCut, res.maxFill);
  for (let k = 0; k < ras.cells.length; k++) {
    const d = dz[k]; if (!isFinite(d)) continue;
    const [x, y] = ras.cells[k];
    const ix = Math.min(w - 1, Math.floor((x - minx) / r)), iy = Math.min(h - 1, Math.floor((maxy - y) / r));
    const t = Math.min(1, Math.abs(d) / mx), o = (iy * w + ix) * 4;
    if (Math.abs(d) < 0.05) { img.data.set([255, 255, 255, 120], o); continue; }
    const c = d > 0 ? [217, 48, 37] : [26, 115, 232];
    img.data.set([255 + (c[0] - 255) * (0.25 + 0.75 * t), 255 + (c[1] - 255) * (0.25 + 0.75 * t), 255 + (c[2] - 255) * (0.25 + 0.75 * t), 175], o);
  }
  ctx.putImageData(img, 0, 0);
  const sw = G.toLL(minx, maxy - h * r, origin()), ne = G.toLL(minx + w * r, maxy, origin());
  L.imageOverlay(cv.toDataURL(), [sw, ne], { pane: 'heatPane', interactive: false, className: 'pix' }).addTo(lyr.heat);
}

// ======================================================================
// Quantities
// ======================================================================
const calcCache = new Map();
function seedElev(a) {
  if (!P.surface) return;
  const r = G.cutFill(P.surface, a.pts.map(xyOf), { design: 'flat', elev: 0 }, 0);
  if (r.avgExisting != null) a.p.elev = Math.round(r.avgExisting * 10) / 10;
}
function calcArea(a) {
  const key = JSON.stringify([a.pts, a.p, a.geom, P.surface && P.surface.built, P.factors.shrinkPct, P.factors.swellPct, P.factors.topsoilLoosePct]);
  const c = calcCache.get(a.id); if (c && c.key === key) return c.val;
  const xy = a.pts.map(xyOf), F = P.factors, p = a.p;
  let val = { ok: true };
  if (a.geom === 'line') { val.length = G.lineLength(xy); val.areaSF = val.length * (p.widthFt || 0); }
  else val.areaSF = xy.length >= 3 ? G.polyArea(xy) : 0;
  if (a.type === 'cutfill') {
    if (!P.surface) val = Object.assign(val, { ok: false, why: 'Build the elevation surface (Site tab) to compute cut/fill.' });
    else if (!surfaceCovers(a)) val = Object.assign(val, { ok: false, why: 'This area extends past the elevation surface. Update the surface (Site tab).' });
    else {
      const ras = G.rasterize(xy);
      const pp = Object.assign({}, p, { shrinkPct: F.shrinkPct });
      let off = 0;
      if (p.balance) off = G.balanceOffset(P.surface, xy, pp, ras);
      const r = G.cutFill(P.surface, xy, pp, off, ras);
      const shrink = F.shrinkPct / 100;
      Object.assign(val, r, {
        designElev: (p.elev || 0) + off, fillBankCY: r.fillCY / (1 - shrink),
        netBankCY: r.cutCY - r.fillCY / (1 - shrink)
      });
    }
  } else if (a.type === 'pad') {
    if (!P.surface) val = Object.assign(val, { ok: false, why: 'Build the elevation surface (Site tab) to figure the pad.' });
    else if (p.slabElev == null || !isFinite(p.slabElev)) val = Object.assign(val, { ok: false, why: 'Enter the slab elevation below.' });
    else {
      const r = G.padEarthwork(P.surface, xy, p);
      const extra = (p.extraPct == null ? 35 : p.extraPct) / 100;
      Object.assign(val, r, { dirtCY: r.fillCY * (1 + extra), netCY: r.cutCY - r.fillCY * (1 + extra), designElev: r.padElev });
      const [bx0, by0, bx1, by1] = r.ras.bbox; a._ext = [llOf(bx0, by0), llOf(bx1, by1)];
      val.needSurface = r.clipped || r.missingFrac > 0.02 || (r.outsideMissing > 0 && r.ras.cells.length > 0 && r.outsideMissing * r.ras.r * r.ras.r > 400);
      val.cornerZ = xy.map(([x, y]) => G.zAt(P.surface, x, y)).filter(z => z != null);
    }
  } else if (a.type === 'topsoil') {
    val.cy = val.areaSF * (p.depthIn || 0) / 12 / 27;
    val.lcy = val.cy * (1 + F.topsoilLoosePct / 100);
  } else if (a.type === 'gravel') {
    val.cy = val.areaSF * (p.depthIn || 0) / 12 / 27;
    val.orderCY = val.cy * (1 + (p.compactPct || 0) / 100);
    val.tons = val.orderCY * (p.density || 0);
    val.fabricSY = p.fabric ? val.areaSF / 9 * 1.1 : 0;
  }
  calcCache.set(a.id, { key, val });
  return val;
}
function areaSummary(a) {
  const v = calcArea(a);
  if (a.type === 'cutfill') return v.ok ? `Cut ${num(v.cutCY)} · Fill ${num(v.fillCY)} CY` : 'Needs surface';
  if (a.type === 'pad') return v.ok ? `Cut ${num(v.cutCY)} · Fill ${num(v.fillCY)} (+${a.p.extraPct}% = ${num(v.dirtCY)}) CY · pad ${num(v.padElev, 2)}` : 'Needs slab elev / surface';
  if (a.type === 'topsoil') return `${a.p.action === 'strip' ? 'Strip' : a.p.action === 'import' ? 'Import' : 'Respread'} ${num(v.cy)} CY`;
  if (a.type === 'trench') return `${num(v.length)} LF · ${num(a.p.depthIn)}" deep · ${a.p.purpose || 'utility'}`;
  if (a.type === 'seed') return `${num(v.areaSF)} SF`;
  if (a.type === 'gravel') return `${num(v.tons)} tons ${a.p.material}`;
  return '';
}


// ======================================================================
// Drawing on the map
// ======================================================================
const draw = { on: false, mode: 'poly', pts: [], cb: null, layer: null };
function startDraw(mode, cb, msg, opts = {}) {
  Object.assign(draw, { on: true, mode, pts: [], cb, msg: msg || (mode === 'line' ? 'Tap along the line' : mode === 'points' ? 'Tap each one on the map' : 'Tap the map to add corners'), gps: !!opts.gps, noun: opts.noun || (mode === 'line' ? 'point' : mode === 'points' ? 'one' : 'corner'), marking: false, tracing: false, traced: false });
  $('#dTrace').classList.toggle('hidden', !opts.trace); $('#dTrace').classList.remove('on'); $('#dTrace').textContent = '〰 Trace';
  $('#drawBar').classList.remove('hidden'); document.body.classList.add('drawing');
  map.doubleClickZoom.disable();   // quick taps add corners instead of zooming
  $('#dMark').classList.toggle('hidden', !draw.gps);
  $('#dGps').classList.toggle('hidden', draw.gps);
  $('#dWalk').classList.toggle('hidden', draw.gps || !P.walks.length);
  $('#dExtra').classList.toggle('hidden', draw.gps || !P.walks.length);
  $('#sheet').classList.add('collapsed');
  if (draw.gps) startGPS();
  lyr.verts.clearLayers(); updateDraw();
}
fixListeners.add(f => {
  if (!draw.on) return;
  if (draw.tracing && f && f.acc <= (P.factors.maxAccFt || 50)) {
    const last = draw.pts[draw.pts.length - 1], ll = [f.lat, f.lon];
    if (!last || Math.hypot(...G.toXY(ll[0], ll[1], { lat0: last[0], lon0: last[1] })) >= 5) { draw.pts.push(ll); draw.traced = true; updateDraw(); return; }
  }
  if (draw.gps) updateDrawSub();
});
$('#dTrace').onclick = () => {
  draw.tracing = !draw.tracing; $('#dTrace').classList.toggle('on', draw.tracing);
  $('#dTrace').textContent = draw.tracing ? '■ Stop' : '〰 Trace';
  if (draw.tracing) { startGPS(); toast('Walk the line — the app drops a point every 5 ft'); }
};
function updateDrawSub() {
  const ll = draw.pts, f = lastFix;
  const size = draw.mode === 'poly' ? `${num(ll.length > 2 ? G.polyArea(ll.map(xyOf)) : 0)} sf` : draw.mode === 'points' ? 'count' : `${num(ll.length > 1 ? G.lineLength(ll.map(xyOf)) : 0)} lf`;
  $('#drawSub').textContent = (draw.mode === 'points' ? `${ll.length} marked` : `${ll.length} ${draw.noun}${ll.length === 1 ? '' : 's'} · ${size}`) + (draw.tracing ? ' · tracing' : '') + (draw.gps ? ` · GPS ${f ? '±' + Math.round(f.acc) + ' ft' : 'searching…'} · or tap the map` : '');
}
function updateDraw() {
  lyr.draw.clearLayers();
  const ll = draw.pts;
  if (ll.length > 1 && draw.mode !== 'points') (draw.mode === 'poly' && ll.length > 2 ? L.polygon(ll, { color: '#e8710a', weight: 3, dashArray: '6 4', fillOpacity: 0.15 }) : L.polyline(ll, { color: '#e8710a', weight: 3, dashArray: '6 4' })).addTo(lyr.draw);
  ll.forEach((p, i) => L.marker(p, { icon: draw.mode === 'points' ? L.divIcon({ className: 'cnt-pt', iconSize: [22, 22], html: String(i + 1) }) : L.divIcon({ className: 'vtx' }), interactive: false }).addTo(lyr.draw));
  $('#dDone').disabled = ll.length < (draw.mode === 'poly' ? 3 : draw.mode === 'points' ? 1 : 2);
  $('#drawMsg').textContent = draw.tracing ? 'Tracing — walk the line, then tap ■ Stop.' : draw.gps && ll.length ? (draw.mode === 'points' ? `${ll.length} marked. Walk to the next one, or tap Done.` : `${draw.noun[0].toUpperCase() + draw.noun.slice(1)} ${ll.length} marked. Walk to ${draw.noun} ${ll.length + 1}.`) : draw.msg;
  if (!draw.marking) $('#dMark').textContent = draw.mode === 'points' ? `📍 Mark #${ll.length + 1}` : `📍 Mark ${draw.noun} ${ll.length + 1}`;
  updateDrawSub();
}
$('#dMark').onclick = async () => {
  if (draw.marking) return;
  draw.marking = true; $('#dMark').disabled = true; $('#dMark').textContent = 'Hold still… averaging GPS';
  const f = await averageFix(3000);
  draw.marking = false; $('#dMark').disabled = false;
  if (!draw.on) return;
  if (needFix(f)) {
    draw.pts.push([f.lat, f.lon]);
    toast(`${draw.noun[0].toUpperCase() + draw.noun.slice(1)} ${draw.pts.length} marked (±${Math.round(f.acc)} ft)` + (f.acc > 30 ? ' — weak signal, you can drag it later' : ''));
  }
  updateDraw();
};
function endDraw(ok) {
  $('#drawBar').classList.add('hidden'); document.body.classList.remove('drawing'); map.doubleClickZoom.enable(); lyr.draw.clearLayers();
  let pts = draw.pts.slice(); const cb = draw.cb; draw.on = false; draw.cb = null;
  if (draw.traced && draw.mode !== 'points' && pts.length > 3) {   // straighten the GPS wiggle from tracing
    pts = G.simplify(pts.map(xyOf), 2.5).map(([x, y]) => llOf(x, y));
    if (draw.mode === 'poly' && pts.length > 3) { const a = pts[0], b = pts[pts.length - 1]; if (Math.hypot(...G.toXY(a[0], a[1], { lat0: b[0], lon0: b[1] })) < 10) pts.pop(); }
  }
  draw.tracing = false; draw.traced = false; setTimeout(flowCheck, 0);
  $('#sheet').classList.remove('collapsed');
  if (ok && cb) cb(pts);
}
$('#dUndo').onclick = () => { draw.pts.pop(); updateDraw(); };
$('#dCancel').onclick = () => endDraw(false);
$('#dDone').onclick = () => endDraw(true);
$('#dGps').onclick = async () => { const f = await locateOnce(); if (!needFix(f)) return; if (f.acc > 40) toast(`Weak GPS (±${Math.round(f.acc)} ft) — point added anyway`); draw.pts.push([f.lat, f.lon]); updateDraw(); };
$('#dWalk').onclick = () => {
  const w = P.walks[P.walks.length - 1];
  if (!w || w.points.length < 3) { toast('No walk recorded yet'); return; }
  const xy = w.points.map(p => xyOf([p.lat, p.lon]));
  const s = G.simplify(xy, 2.5);
  draw.pts = s.map(([x, y]) => llOf(x, y));
  if (draw.mode === 'poly' && draw.pts.length > 3) {
    const a = draw.pts[0], b = draw.pts[draw.pts.length - 1];
    if (Math.hypot(...G.toXY(a[0], a[1], { lat0: b[0], lon0: b[1] })) < 10) draw.pts.pop();   // closed loop
  }
  updateDraw();
};

// vertex editing for the selected area
let editVerts = false;
function showVerts(a) {
  lyr.verts.clearLayers();
  if (!a || !editVerts) return;
  a.pts.forEach((p, i) => {
    const m = L.marker(p, { icon: L.divIcon({ className: 'vtx' }), draggable: true, autoPan: true }).addTo(lyr.verts);
    m.on('drag', e => { a.pts[i] = [e.latlng.lat, e.latlng.lng]; redrawAreas(true); drawBoundary(); });
    m.on('dragend', () => { save(); render(); });
    m.on('contextmenu', () => { if (a.pts.length > (a.geom === 'line' ? 2 : 3)) { a.pts.splice(i, 1); save(); showVerts(a); drawBoundary(); redrawAreas(); render(); } });
  });
}

// ======================================================================
// Map rendering of project data
// ======================================================================
function drawWalks() {
  lyr.walks.clearLayers(); walk.line = null;
  P.walks.forEach(w => {
    const pl = L.polyline(w.points.map(p => [p.lat, p.lon]), { color: '#ffd60a', weight: 3, opacity: 0.9 }).addTo(lyr.walks);
    if (walk.cur === w) walk.line = pl;
  });
}
function drawShots() {
  lyr.shots.clearLayers();
  P.shots.forEach(s => {
    const here = P.surface ? G.zAt(P.surface, ...xyOf([s.lat, s.lon])) : null;
    L.marker([s.lat, s.lon], { icon: L.divIcon({ className: 'shot' }) }).addTo(lyr.shots)
      .bindPopup(`<b>${esc(s.label)}</b><br>${s.elev != null ? 'Known elev: ' + num(s.elev, 2) + ' ft<br>' : ''}${here != null ? 'Surface: ' + num(here, 1) + ' ft<br>' : ''}Phone alt: ${s.gpsAlt == null ? '—' : num(s.gpsAlt, 1) + ' ft'}`);
  });
}
function drawPin() {
  lyr.pin.clearLayers();
  if (P.pin) L.marker(P.pin).addTo(lyr.pin).on('click', e => { if (mapCapturing()) map.fire('click', { latlng: e.latlng }); else L.popup().setLatLng(P.pin).setContent(esc(P.address || P.name)).openOn(map); });
}
function redrawAreas(fast) {
  lyr.areas.clearLayers();
  P.areas.forEach(a => {
    const sel = ui.areaId === a.id, col = TYPE[a.type].color;
    const style = { color: sel ? '#fff' : col, weight: sel ? 3 : 2, fillColor: col, fillOpacity: sel ? 0.08 : 0.25 };
    let shape;
    if (a.geom === 'line') {
      const xy = a.pts.map(xyOf);
      const rects = G.lineBufferRects(xy, a.p.widthFt || 1).map(r => r.map(([x, y]) => llOf(x, y)));
      shape = L.featureGroup([L.polygon(rects, Object.assign({}, style, { weight: 0 })), L.polyline(a.pts, { color: sel ? '#fff' : col, weight: 2, dashArray: '4 4' })]);
    } else if (a.type === 'pad') {
      // house footprint (dashed) + pad top 6 ft outside it
      const top = G.offsetPolygon(a.pts.map(xyOf), a.p.offsetFt == null ? 6 : a.p.offsetFt).map(([x, y]) => llOf(x, y));
      shape = L.featureGroup([L.polygon(top, Object.assign({}, style, { fillOpacity: sel ? 0.05 : 0.15 })), L.polygon(a.pts, { color: sel ? '#fff' : col, weight: 2, dashArray: '6 4', fill: false })]);
    } else shape = L.polygon(a.pts, style);
    shape.addTo(lyr.areas);
    shape.on('click', e => { if (mapCapturing()) return; L.DomEvent.stopPropagation(e); openArea(a.id); });
    if (!fast) {
      const c = a.geom === 'line' ? a.pts[Math.floor(a.pts.length / 2)] : llOf(...G.polyCentroid(a.pts.map(xyOf)));
      L.tooltip({ permanent: true, direction: 'center', className: 'alabel', interactive: false }).setLatLng(c).setContent(esc(a.name)).addTo(lyr.areas);
    }
  });
  const a = P.areas.find(x => x.id === ui.areaId);
  if (a && (a.type === 'cutfill' || a.type === 'pad') && !fast) { const v = calcArea(a); drawHeat(a, v.ok ? v : null); }
  else if (!a || (a.type !== 'cutfill' && a.type !== 'pad')) lyr.heat.clearLayers();
  if (!a) drawLines();
}
function fitAll() {
  const b = L.latLngBounds([]);
  P.areas.forEach(a => a.pts.forEach(p => b.extend(p)));
  (P.lines || []).forEach(Ln => (Ln.shapes || []).forEach(s => s.pts.forEach(p => b.extend(p))));
  P.walks.forEach(w => w.points.forEach(p => b.extend([p.lat, p.lon])));
  if (P.pin) b.extend(P.pin);
  (P.boundary || []).forEach(p => b.extend(p));
  P.features.forEach(f => f.pts.forEach(p => b.extend(p)));
  P.trees.forEach(t => b.extend([t.lat, t.lon]));
  if (b.isValid()) map.fitBounds(b.pad(0.2), { maxZoom: 20 });
}

map.on('click', e => {
  if (pinMode) { setPin([e.latlng.lat, e.latlng.lng]); pinMode = false; toast('Site pin set'); render(); return; }
  if (draw.on) { draw.pts.push([e.latlng.lat, e.latlng.lng]); updateDraw(); return; }
  if (treeMode) { treeMode = false; $('#sheet').classList.remove('collapsed'); addTreeAt(e.latlng.lat, e.latlng.lng); return; }
  if (placeCb) { const cb = placeCb; placeCb = null; $('#sheet').classList.remove('collapsed'); cb([e.latlng.lat, e.latlng.lng]); return; }
  if (EMBED && EMBED.mapClick && EMBED.mapClick(e.latlng)) return;
  if (!P.surface) return;
  const [x, y] = xyOf([e.latlng.lat, e.latlng.lng]);
  const z = G.zAt(P.surface, x, y);
  if (z == null) return;
  let html = `<b>Existing: ${num(z, 1)} ft</b>`;
  const a = P.areas.find(a => a.type === 'cutfill' && a.geom !== 'line' && G.inPoly(x, y, a.pts.map(xyOf)));
  if (a) {
    const v = calcArea(a);
    if (v.ok) {
      const d = G.designFn(a.p, a.pts.map(xyOf), v.designElev - (a.p.elev || 0))(x, y);
      const dz = z - (a.p.stripIn || 0) / 12 - d;
      html += `<br>${esc(a.name)} subgrade: ${num(d, 1)} ft<br><b style="color:${dz > 0 ? '#d93025' : '#1a73e8'}">${dz > 0 ? 'Cut' : 'Fill'} ${num(Math.abs(dz), 2)} ft</b>`;
    }
  }
  P.areas.filter(a => a.type === 'pad').forEach(pa => {
    const v = calcArea(pa); if (!v.ok) return;
    const top = v.top; if (!G.inPoly(x, y, top)) return;
    const dz = z - (pa.p.stripIn || 0) / 12 - v.padElev;
    html += `<br>${esc(pa.name)} pad: ${num(v.padElev, 2)} ft<br><b style="color:${dz > 0 ? '#d93025' : '#1a73e8'}">${dz > 0 ? 'Cut' : 'Fill'} ${num(Math.abs(dz), 2)} ft</b>`;
  });
  (P.lines || []).filter(Ln => Ln.calc === 'pad' || Ln.calc === 'grade').forEach(Ln => {
    const q = lineQty(Ln), v = q.pad || q.grade, a = pseudoArea(Ln); if (!v || !a) return;
    const n = `#${lineNo(Ln)} ${esc(Ln.desc)}`;
    if (Ln.calc === 'pad') { if (!G.inPoly(x, y, v.top)) return; const dz = z - (Ln.params.stripIn || 0) / 12 - v.padElev; html += `<br>${n}: pad ${num(v.padElev, 2)} ft<br><b style="color:${dz > 0 ? '#d93025' : '#1a73e8'}">${dz > 0 ? 'Cut' : 'Fill'} ${num(Math.abs(dz), 2)} ft</b>`; }
    else { const xy = a.pts.map(xyOf); if (!G.inPoly(x, y, xy)) return; const d = G.designFn(a.p, xy, v.designElev - (a.p.elev || 0))(x, y), dz = z - (a.p.stripIn || 0) / 12 - d; html += `<br>${n}: subgrade ${num(d, 1)} ft<br><b style="color:${dz > 0 ? '#d93025' : '#1a73e8'}">${dz > 0 ? 'Cut' : 'Fill'} ${num(Math.abs(dz), 2)} ft</b>`; }
  });
  L.popup().setLatLng(e.latlng).setContent(html).openOn(map);
});

// ======================================================================
// Site / search
// ======================================================================
let pinMode = false;
function setPin(ll) {
  P.pin = ll; if (!P.origin || (!P.walks.length && !P.areas.length && !P.surface)) P.origin = { lat0: ll[0], lon0: ll[1] };
  drawPin(); save();
}
async function search(q) {
  q = q.trim(); if (!q) return [];
  const m = q.match(/^\s*(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)\s*$/);
  if (m) return [{ label: `${m[1]}, ${m[2]}`, ll: [parseFloat(m[1]), parseFloat(m[2])] }];
  try {
    const r = await fetch(`${ESRI_GEOCODE}?SingleLine=${encodeURIComponent(q)}&f=json&maxLocations=5&outFields=Match_addr`);
    const j = await r.json();
    const out = (j.candidates || []).filter(c => c.score > 70).map(c => ({ label: c.address, ll: [c.location.y, c.location.x] }));
    if (out.length) return out;
  } catch (e) { /* fall through */ }
  try {
    const r = await fetch(`${NOMINATIM}?format=json&limit=5&q=${encodeURIComponent(q)}`, { headers: { 'Accept-Language': 'en' } });
    const j = await r.json();
    return j.map(c => ({ label: c.display_name, ll: [parseFloat(c.lat), parseFloat(c.lon)] }));
  } catch (e) { return []; }
}

// ======================================================================
// UI shell
// ======================================================================
const ui = { tab: 'site', areaId: null, lineId: null, results: [] };
function setTab(t) {
  ui.tab = t; document.body.dataset.tab = t;
  if (t === 'estimate') $('#sheet').classList.add('full'); else $('#sheet').classList.remove('full');
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === t));
  $('#sheet').classList.remove('collapsed');
  if (t !== 'areas') { ui.areaId = null; editVerts = false; lyr.verts.clearLayers(); }
  if (t !== 'takeoff') ui.lineId = null;
  redrawAreas();
  render();
  if (t === 'features' || t === 'site') { drawTrees(); drawFeatures(); }
}
document.querySelectorAll('#tabs button').forEach(b => b.onclick = () => setTab(b.dataset.tab));

// sheet sizing
(function () {
  const sh = $('#sheet'), g = $('#grab'); let y0 = null;
  const cycle = dir => {
    const st = sh.classList.contains('collapsed') ? 0 : sh.classList.contains('full') ? 2 : 1;
    const n = Math.max(0, Math.min(2, st + dir));
    sh.classList.toggle('collapsed', n === 0); sh.classList.toggle('full', n === 2);
  };
  g.addEventListener('touchstart', e => { y0 = e.touches[0].clientY; }, { passive: true });
  g.addEventListener('touchend', e => { if (y0 == null) return; const dy = e.changedTouches[0].clientY - y0; y0 = null; if (Math.abs(dy) < 10) cycle(sh.classList.contains('full') ? -2 : 1); else cycle(dy < 0 ? 1 : -1); });
  g.addEventListener('click', e => { if (e.pointerType === 'mouse' || !('ontouchstart' in window)) cycle(sh.classList.contains('full') ? -2 : 1); });
})();

$('#btnLocate').onclick = async () => { const f = await locateOnce(); if (!needFix(f)) return; map.setView([f.lat, f.lon], Math.max(map.getZoom(), 19)); };
$('#btnContours').onclick = toggleContours;
$('#btnAddFeat').onclick = () => openAddMenu($('#btnAddFeat'));
$('#btnLayers').onclick = async () => {
  const v = await form('Map layers', [
    { key: 'base', label: 'Base map', type: 'select', value: baseName, options: Object.keys(baseLayers) },
    ...(EMBED ? [] : [{ key: 'labels', label: 'Road & place labels (hybrid)', type: 'select', value: map.hasLayer(labelsLayer) ? 'on' : 'off', options: [['on', 'Show'], ['off', 'Hide']] }]),
    { key: 'ci', label: 'Contour interval (ft)', type: 'select', value: P.factors.contourFt, options: [0.5, 1, 2, 5, 10] }
  ], 'Apply', `<label>Map labels</label><div class="mapkey"><div><span class="kc">415</span>Contour elevation, ft (orange, along the line)</div><div><span class="kd">202.6 ft</span>Boundary length (white tag)</div><div><span class="kf">Well</span>Feature or area name (dark tag)</div></div>`);
  if (!v) return;
  map.removeLayer(baseLayers[baseName]); baseName = v.base; baseLayers[baseName].addTo(map); baseLayers[baseName].bringToBack();
  if (v.labels === 'on') labelsLayer.addTo(map); else map.removeLayer(labelsLayer);
  P.factors.contourFt = parseFloat(v.ci); save(); if (contoursOn) drawContours();
};
$('#projBtn').onclick = projectsDialog;
$('#btnExport').onclick = exportDialog;
$('#btnEquip').onclick = () => openEquipMenu($('#btnEquip'));

function render() {
  $('#projName').textContent = P.name; updateEquipBadge(); flowCheck();
  const el = $('#panel');
  if (ui.tab === 'site') el.innerHTML = siteHtml();
  else if (ui.tab === 'walk') el.innerHTML = walkHtml();
  else if (ui.tab === 'features') el.innerHTML = featuresHtml();
  else if (ui.tab === 'takeoff') el.innerHTML = takeoffHtml();
  else if (ui.tab === 'areas') el.innerHTML = ui.areaId ? areaHtml(P.areas.find(a => a.id === ui.areaId)) : areasHtml();
  else el.innerHTML = estimateHtml();
  bind();
}

// ---------------- Site tab ----------------
function siteHtml() {
  const s = P.surface, F = P.factors;
  let surf;
  if (surfJob.running) surf = `<div id="surfMsg" class="muted">${esc(surfJob.msg)}</div><div class="progress"><i id="surfBar" style="width:${(100 * surfJob.done / Math.max(1, surfJob.total)).toFixed(0)}%"></i></div>`;
  else if (s) {
    const fin = s.z.filter(v => v != null);
    surf = `<div class="stats"><div class="stat"><b>${num(Math.min(...fin), 1)}</b><span>Low ft</span></div><div class="stat"><b>${num(Math.max(...fin), 1)}</b><span>High ft</span></div><div class="stat"><b>${s.spacing} ft</b><span>Grid</span></div></div>
      <div class="muted">${s.source === 'gps' ? 'Phone GPS altitude (low accuracy)' : 'USGS 3DEP' + (s.resolutionM ? ` · source ${s.resolutionM < 2 ? 'LiDAR ' : 'DEM '}${num(s.resolutionM, s.resolutionM < 2 ? 1 : 0)} m` : '')} · ${num(s.nx * s.ny)} pts · ${new Date(s.built).toLocaleDateString()}${s.tie ? ` · tied to ${s.tie.n} known elev (avg shift ${num(s.tie.avg, 2)} ft)` : ''}. Elevations NAVD88 ft.</div>
      ${s.resolutionM && s.resolutionM > 2 ? '<div class="warn">No 1-m LiDAR here — USGS is using coarser ~10 m data. Treat quantities as preliminary or add known spot elevations.</div>' : ''}`;
  } else surf = '<div class="muted">No surface yet. Walk the site (or draw your areas), then build the surface to pull ground elevations.</div>';
  return `<h2>Site</h2>
  <div class="row"><input id="q" placeholder="Address or lat, lon" value="" enterkeyhint="search" autocomplete="street-address"><button class="pri" id="qGo" style="flex:0 0 64px">Go</button></div>
  <div id="qRes" class="list mt">${ui.results.map((r, i) => `<button class="item" data-res="${i}"><div class="t"><b>${esc(r.label)}</b></div></button>`).join('')}</div>
  <div class="row mt"><button class="sec" id="useMe">◎ Use my location</button><button class="sec ${pinMode ? 'on' : ''}" id="pinBtn">${pinMode ? 'Tap the map…' : '📍 Tap to pin'}</button></div>
  ${P.address ? `<div class="muted mt">${esc(P.address)}</div>` : ''}
  <h3>Property line</h3>
  ${bndHtml()}
  <h3>Elevation surface</h3>
  ${surf}
  <div class="grid2">
    <div><label>Source</label><select id="srcSel"><option value="lidar" ${F.source !== 'gps' ? 'selected' : ''}>USGS LiDAR (recommended)</option><option value="gps" ${F.source === 'gps' ? 'selected' : ''}>Phone GPS only</option></select></div>
    <div><label>Detail</label><select id="detSel"><option value="normal" ${F.detail !== 'high' ? 'selected' : ''}>Normal (~2,500 pts)</option><option value="high" ${F.detail === 'high' ? 'selected' : ''}>High (~6,000 pts)</option></select></div>
  </div>
  <button class="pri big mt" id="buildSurf" style="width:100%" ${surfJob.running ? 'disabled' : ''}>${s ? 'Update surface' : 'Build surface'}</button>
  <h3>Factors</h3>
  <div class="grid2">
    <div><label>Shrink (fill compaction) %</label><input type="number" inputmode="decimal" data-f="shrinkPct" value="${F.shrinkPct}"></div>
    <div><label>Swell (bank → loose) %</label><input type="number" inputmode="decimal" data-f="swellPct" value="${F.swellPct}"></div>
    <div><label>Truck size (loose CY)</label><input type="number" inputmode="decimal" data-f="truckLCY" value="${F.truckLCY}"></div>
    <div><label>Topsoil loose factor %</label><input type="number" inputmode="decimal" data-f="topsoilLoosePct" value="${F.topsoilLoosePct}"></div>
    <div><label>Reject GPS fixes worse than (ft)</label><input type="number" inputmode="decimal" data-f="maxAccFt" value="${F.maxAccFt}"></div>
  </div>
  <button class="sec mt" id="fitAll" style="width:100%">Zoom to site</button>`;
}

// ---------------- Walk tab ----------------
function walkHtml() {
  const s = P.surface;
  if (walk.active) {
    const tr = walk.cur && walk.cur.purpose === 'trace';
    return `<h2>${tr ? 'Tracing the boundary' : 'Site walk'} ${walk.paused ? '(paused)' : ''}</h2>
    <div class="stats" id="wStats"></div>
    <div class="row"><button class="sec big" id="wPause">${walk.paused ? 'Resume' : 'Pause'}</button><button class="sec big" id="wShot">◆ Spot shot</button><button class="sec big" id="wTree" aria-haspopup="menu">＋ Feature</button></div>
    <button class="pri big mt" id="wStop" style="width:100%">${tr ? 'Finish trace' : 'Finish walk'}</button>
    <div class="row mt"><button class="sec" id="wFollow">${follow ? 'Following ✓' : 'Follow me'}</button></div>
    <p class="muted">${tr ? 'Walk along the property line all the way around and finish where you started. The app closes the loop and straightens the GPS wiggle.' : 'Walk the perimeter first, then cross the high and low spots, ditches and swales.'} Keep the screen on — iPhone pauses GPS when the screen locks.</p>`;
  }
  const bias = s && s.gpsBias;
  return `<h2>Site walk</h2>
  <button class="pri big" id="wStart" style="width:100%">▶ Start site walk</button>
  <p class="muted">Tracks your path with GPS. Your walked area sets the survey extent; ground elevations come from USGS LiDAR, with your known spot elevations used to tie it in.</p>
  ${bias ? `<div class="${Math.abs(bias.median) > 5 || bias.spread > 5 ? 'warn' : 'muted'}">Phone altitude vs LiDAR: median ${bias.median > 0 ? '+' : ''}${num(bias.median, 1)} ft, scatter ±${num(bias.spread, 1)} ft over ${bias.n} fixes. ${bias.spread > 3 ? 'This is why phone altitude is not used for quantities.' : ''}</div>` : ''}
  <h3>Walks</h3>
  <div class="list">${P.walks.map((w, i) => `<div class="item"><div class="sw" style="background:#ffd60a"></div><div class="t"><b>Walk ${i + 1}</b><small>${new Date(w.started).toLocaleString()} · ${w.points.length} pts · ${num(walkDist(w))} ft</small></div><button class="sec" data-bndwalk="${w.id}" style="padding:6px 10px">Property line</button><button class="dng" data-delwalk="${w.id}" style="padding:6px 10px">✕</button></div>`).join('') || '<div class="muted">None yet.</div>'}</div>
  <h3>Spot shots</h3>
  <button class="sec" id="wShot2" style="width:100%">◆ Add spot shot at my location</button>
  <div class="list mt">${P.shots.map(sh => { const z = s ? G.zAt(s, ...xyOf([sh.lat, sh.lon])) : null; return `<div class="item"><div class="sw" style="background:#ffd60a;transform:rotate(45deg)"></div><div class="t"><b>${esc(sh.label)}</b><small>${sh.elev != null ? 'Known ' + num(sh.elev, 2) + ' ft · ' : ''}${z != null ? 'Surface ' + num(z, 1) + ' ft' : ''}</small></div><button class="sec" data-editshot="${sh.id}" style="padding:6px 10px">Edit</button><button class="dng" data-delshot="${sh.id}" style="padding:6px 10px">✕</button></div>`; }).join('') || '<div class="muted">Drop shots on benchmarks, manhole rims, finished floors or laser-level readings to tie the surface to your datum.</div>'}</div>`;
}
function updateWalkStats() {
  const el = $('#wStats'); if (!el || !walk.cur) return;
  const f = lastFix, t = Math.round((Date.now() - walk.startT) / 1000);
  const here = f && P.surface ? G.zAt(P.surface, ...xyOf([f.lat, f.lon])) : null;
  el.innerHTML = `<div class="stat"><b>${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}</b><span>Time</span></div>
    <div class="stat"><b>${num(walkDist(walk.cur))}</b><span>Feet</span></div>
    <div class="stat"><b>${walk.cur.points.length}</b><span>Points</span></div>
    <div class="stat"><b>${f ? '±' + Math.round(f.acc) : '—'}</b><span>Horiz ft</span></div>
    <div class="stat"><b>${f && f.alt != null ? num(f.alt, 0) : '—'}</b><span>Phone alt</span></div>
    ${walk.cur.purpose === 'trace' ? `<div class="stat"><b>${num(distToStart(walk.cur))}</b><span>To start ft</span></div>` : `<div class="stat"><b>${here != null ? num(here, 1) : '—'}</b><span>LiDAR ft</span></div>`}`;
}
setInterval(() => { if (walk.active && ui.tab === 'walk') updateWalkStats(); }, 1000);

// ---------------- Areas tab ----------------
function areasHtml() {
  return `<h2>Areas</h2>
  <div class="areagrid"><button class="pri" data-new="pad">+ Building pad</button><button class="pri" data-new="trench">+ Utility trench</button><button class="pri" data-new="gravel">+ Driveway gravel</button><button class="pri" data-new="seed">+ Seed &amp; straw</button><button class="sec" data-new="cutfill">+ Cut / Fill</button><button class="sec" data-new="topsoil">+ Topsoil</button></div>
  <div class="list mt">${P.areas.map(a => `<button class="item" data-open="${a.id}"><div class="sw" style="background:${TYPE[a.type].color}"></div><div class="t"><b>${esc(a.name)}</b><small>${TYPE[a.type].label} · ${num(calcArea(a).areaSF)} sf · ${areaSummary(a)}</small></div>›</button>`).join('') || '<div class="muted">Draw areas by tapping corners on the map, walking corners with GPS, or reusing your walked path.</div>'}</div>`;
}
async function newArea(type) {
  let geom = 'poly';
  if (type === 'pad') {
    startDraw('poly', pts => createPad(pts), 'Building pad: mark the house corners (walk to each one, or tap them on the map)', { gps: true, noun: 'corner' });
    return;
  }
  if (type === 'trench' || type === 'seed') {
    const tr = type === 'trench';
    startDraw(tr ? 'line' : 'poly', pts => {
      const n = P.areas.filter(a => a.type === type).length + 1;
      const a = { id: uid(), type, geom: tr ? 'line' : 'poly', pts, name: `${tr ? 'Trench' : 'Seed & straw'} ${n}`, p: tr ? { purpose: 'Water line', depthIn: 24, matPerLF: 0, widthFt: 1 } : {} };
      P.areas.push(a); save(); openArea(a.id);
    }, tr ? 'Utility trench: walk the route tapping Mark point at each bend, or tap it on the map' : 'Seed & straw: walk the edge tapping Mark point, or tap around it on the map', { gps: true, noun: 'point' });
    return;
  }
  if (type !== 'cutfill') {
    const v = await form('Shape', [{ key: 'g', label: 'Draw as', type: 'select', value: type === 'gravel' ? 'line' : 'poly', options: [['line', 'Centerline × width (driveway, path)'], ['poly', 'Area (outline)']] }], 'Start drawing');
    if (!v) return; geom = v.g;
  }
  startDraw(geom, pts => {
    const n = P.areas.filter(a => a.type === type).length + 1;
    const a = { id: uid(), type, geom, pts, name: `${{ cutfill: 'Grading', topsoil: 'Topsoil', gravel: 'Driveway' }[type]} ${n}`, p: {} };
    if (type === 'cutfill') Object.assign(a.p, { design: 'flat', elev: null, balance: true, slopePct: 1, slopeDir: 0, sectionIn: 0, stripIn: 0 });
    if (type === 'topsoil') Object.assign(a.p, { action: 'strip', depthIn: 6, widthFt: 12 });
    if (type === 'gravel') Object.assign(a.p, { material: 'Crusher run / ABC', depthIn: 6, compactPct: 15, density: store.materials['Crusher run / ABC'].density, price: store.materials['Crusher run / ABC'].price, fabric: false, widthFt: 12 });
    if (type === 'cutfill') { if (!P.surface || !surfaceCovers(a)) toast('Area is outside the surface — update it on the Site tab', 4000); else seedElev(a); }
    P.areas.push(a); save(); openArea(a.id);
  });
}
// Building pad from house corners: ask for the slab elevation, then figure the pad
async function createPad(pts, name) {
  const xy = pts.map(xyOf);
  const zs = P.surface ? xy.map(([x, y]) => G.zAt(P.surface, x, y)).filter(z => z != null) : [];
  const hi = zs.length ? Math.max(...zs) : null, lo = zs.length ? Math.min(...zs) : null;
  const v = await form('Building pad', [
    { key: 'slab', label: 'Slab (finished floor) elevation, ft', type: 'number', value: hi != null ? Math.ceil((hi + 0.5) * 2) / 2 : '', placeholder: 'e.g. 421.5',
      help: (zs.length ? `Ground at the house corners: ${num(lo, 1)} – ${num(hi, 1)} ft. ` : 'No elevation surface yet — build it on the Site tab. ') + 'Pad = slab − 10" (4" slab + 6" stone), extends 6 ft past the house, 3:1 side slopes.' }
  ], 'Figure pad');
  const n = P.areas.filter(a => a.type === 'pad').length + 1;
  const a = { id: uid(), type: 'pad', geom: 'poly', pts, name: name || `Building pad${n > 1 ? ' ' + n : ''}`, p: Object.assign({ slabElev: v && v.slab != null ? v.slab : null }, PAD_DEFAULTS) };
  P.areas.push(a); save();
  if (P.surface && !G.covers(P.surface, G.offsetPolygon(xy, 6))) toast('The pad runs past the elevation data — tap Update surface in the pad panel', 4500);
  openArea(a.id);
}
function openArea(id) {
  ui.tab = 'areas'; ui.areaId = id; editVerts = false;
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === 'areas'));
  $('#sheet').classList.remove('collapsed');
  redrawAreas(); lyr.verts.clearLayers(); render();
}
function inp(key, label, val, extra = '') { return `<div><label>${label}</label><input type="number" inputmode="decimal" data-p="${key}" value="${val == null ? '' : val}" ${extra}></div>`; }
function areaHtml(a) {
  if (!a) { ui.areaId = null; return areasHtml(); }
  const v = calcArea(a), p = a.p, F = P.factors;
  let res = '', params = '';
  if (a.type === 'pad') {
    const ex = p.extraPct == null ? 35 : p.extraPct;
    res = v.ok ? `<div class="stats">
        <div class="stat cut"><b>${num(v.cutCY)}</b><span>Cut CY</span></div>
        <div class="stat fill"><b>${num(v.fillCY)}</b><span>Fill CY</span></div>
        <div class="stat fill"><b>${num(v.dirtCY)}</b><span>Dirt needed +${ex}%</span></div>
        <div class="stat"><b>${Math.abs(v.netCY) < 0.5 ? '0' : num(Math.abs(v.netCY))}</b><span>${Math.abs(v.netCY) < 0.5 ? 'Balanced' : v.netCY > 0 ? 'Extra dirt CY' : 'Import CY'}</span></div>
        <div class="stat"><b>${num(v.padElev, 2)}</b><span>Pad elev</span></div>
        <div class="stat"><b>${num(Math.max(v.maxCut, v.maxFill), 1)}</b><span>Max ${v.maxCut >= v.maxFill ? 'cut' : 'fill'} ft</span></div></div>
        <div class="legend">Fill <i></i> Cut</div>
        <div class="muted">House ${num(v.footprintArea)} sf · pad ${num(v.padArea)} sf · slopes reach ${num(v.reach)} ft · disturbed area ${num(v.disturbedArea)} sf (${num(v.disturbedArea / G.SF_PER_ACRE, 2)} ac)${v.cornerZ.length ? ` · ground at corners ${num(Math.min(...v.cornerZ), 1)}–${num(Math.max(...v.cornerZ), 1)} ft` : ''}</div>
        ${v.needSurface ? '<div class="warn">The side slopes run past the elevation data, so the totals are short. <button class="sec" id="aSurf" style="margin-top:6px;width:100%">Update surface</button></div>' : ''}`
      : `<div class="warn">${esc(v.why)}</div>`;
    const padEl = p.slabElev != null ? p.slabElev - ((p.slabIn || 0) + (p.stoneIn || 0)) / 12 : null;
    params = `<h3>Slab &amp; pad</h3>
      <label for="pSlab">Slab (finished floor) elevation, ft</label>
      <div class="row"><input id="pSlab" type="number" inputmode="decimal" step="0.01" data-p="slabElev" value="${p.slabElev == null ? '' : p.slabElev}" placeholder="e.g. 421.5">${P.surface ? '<button class="sec" id="aBal" style="flex:0 0 auto">Balance</button>' : ''}</div>
      <div class="muted" style="margin-top:4px">${padEl != null ? `Pad top = ${num(p.slabElev, 2)} − ${num((p.slabIn || 0) + (p.stoneIn || 0))}" (${p.slabIn}" slab + ${p.stoneIn}" stone) = <b>${num(padEl, 2)} ft</b>. ` : ''}Balance sets the slab so the cut covers the fill plus ${ex}%.</div>
      <div class="grid2">
        ${inp('offsetFt', 'Pad past house (ft)', p.offsetFt)}
        ${inp('slope', 'Side slope (horiz : 1)', p.slope)}
        ${inp('slabIn', 'Slab thickness (in)', p.slabIn)}
        ${inp('stoneIn', 'Stone under slab (in)', p.stoneIn)}
        ${inp('extraPct', 'Extra dirt for compaction %', p.extraPct)}
        ${inp('stripIn', 'Topsoil stripped first (in)', p.stripIn)}
      </div>`;
  } else if (a.type === 'cutfill') {
    res = v.ok ? `<div class="stats">
        <div class="stat cut"><b>${num(v.cutCY)}</b><span>Cut BCY</span></div>
        <div class="stat fill"><b>${num(v.fillCY)}</b><span>Fill CCY</span></div>
        <div class="stat"><b>${Math.abs(v.netBankCY) < 0.5 ? '0' : num(Math.abs(v.netBankCY))}</b><span>${Math.abs(v.netBankCY) < 0.5 ? 'Balanced' : v.netBankCY > 0 ? 'Export BCY' : 'Import BCY'}</span></div>
        <div class="stat"><b>${num(v.designElev, 2)}</b><span>${p.design === 'slope' ? 'Center FG' : 'Finish grade'}</span></div>
        <div class="stat cut"><b>${num(v.maxCut, 1)}</b><span>Max cut ft</span></div>
        <div class="stat fill"><b>${num(v.maxFill, 1)}</b><span>Max fill ft</span></div></div>
        <div class="legend">Fill <i></i> Cut</div>
        <div class="muted">${num(v.areaSF)} sf (${num(v.areaSF / G.SF_PER_ACRE, 2)} ac) · existing ${num(v.minExisting, 1)}–${num(v.maxExisting, 1)} ft · fill needs ${num(v.fillBankCY)} BCY at ${F.shrinkPct}% shrink · ${num(Math.abs(v.netBankCY) * (1 + F.swellPct / 100) / F.truckLCY, 0)} truckloads ${v.netBankCY >= 0 ? 'out' : 'in'}</div>
        ${v.missingFrac > 0.02 ? '<div class="warn">Part of this area has no elevation data.</div>' : ''}`
      : `<div class="warn">${esc(v.why)}</div>`;
    params = `<h3>Design grade</h3>
      <div class="seg"><button data-design="flat" class="${p.design !== 'slope' ? 'on' : ''}">Flat pad</button><button data-design="slope" class="${p.design === 'slope' ? 'on' : ''}">Sloped plane</button></div>
      <div class="grid2">
        ${inp('elev', p.design === 'slope' ? 'Finish elev at center (ft)' : 'Finish grade elev (ft)', p.balance && v.ok ? Math.round(v.designElev * 100) / 100 : p.elev, p.balance ? 'disabled' : '')}
        <div><label>Auto-balance</label><select data-pb="balance"><option value="1" ${p.balance ? 'selected' : ''}>On — solve elev</option><option value="0" ${!p.balance ? 'selected' : ''}>Off — use my elev</option></select></div>
        ${p.design === 'slope' ? inp('slopePct', 'Slope %', p.slopePct) + `<div><label>Drains toward</label><select data-ps="slopeDir">${[['0', 'N'], ['45', 'NE'], ['90', 'E'], ['135', 'SE'], ['180', 'S'], ['225', 'SW'], ['270', 'W'], ['315', 'NW']].map(([d, l]) => `<option value="${d}" ${+p.slopeDir === +d ? 'selected' : ''}>${l}</option>`).join('')}</select></div>` : ''}
        ${inp('sectionIn', 'Section below finish (in)', p.sectionIn)}
        ${inp('stripIn', 'Topsoil stripped first (in)', p.stripIn)}
      </div>
      <div class="muted mt">Section = stone/slab/pavement thickness, so earthwork is figured to subgrade. Topsoil stripped lowers existing grade before cut/fill; price the strip with a Topsoil area.</div>`;
  } else if (a.type === 'trench') {
    res = `<div class="stats"><div class="stat"><b>${num(v.length)}</b><span>Linear ft</span></div><div class="stat"><b>${num(p.depthIn)}"</b><span>Depth</span></div><div class="stat"><b>${num(v.length / (asmOf('trench').prod || 100), 1)}</b><span>Trencher hrs</span></div></div>`;
    params = `<h3>Trench</h3><label for="pPurpose">What it's for</label><input id="pPurpose" data-pt="purpose" value="${esc(p.purpose || '')}" placeholder="Water line, power, sewer, gas…">
      <div class="grid2">${inp('depthIn', 'Depth (in)', p.depthIn)}${inp('matPerLF', 'Pipe / conduit you supply, $/LF', p.matPerLF)}</div>
      <div class="muted mt">Priced as dig and backfill with a ride-on trencher. Leave $/LF at 0 when the plumber or electrician supplies the pipe.</div>`;
  } else if (a.type === 'seed') {
    const per = seedMatPerMSF(normRates(P.rates));
    res = `<div class="stats"><div class="stat"><b>${num(v.areaSF)}</b><span>Sq ft</span></div><div class="stat"><b>${num(v.areaSF / G.SF_PER_ACRE, 2)}</b><span>Acres</span></div><div class="stat"><b>${money(v.areaSF / 1000 * per)}</b><span>Materials</span></div></div>
      <div class="muted">By hand: fescue seed, 10-10-10, pelletized lime and wheat straw at $${num(per, 2)} per 1,000 SF (set on the Estimate tab → Rates).</div>`;
  } else if (a.type === 'topsoil') {
    res = `<div class="stats"><div class="stat"><b>${num(v.areaSF)}</b><span>Sq ft</span></div><div class="stat"><b>${num(v.cy, 1)}</b><span>CY in place</span></div><div class="stat"><b>${num(v.lcy, 1)}</b><span>Loose CY</span></div></div>
      <div class="muted">${num(v.areaSF / 9)} SY · ${num(v.areaSF / G.SF_PER_ACRE, 2)} ac${a.geom === 'line' ? ` · ${num(v.length)} lf × ${p.widthFt} ft` : ''}</div>`;
    params = `<h3>Topsoil</h3>
      <div class="seg">${[['strip', 'Strip'], ['respread', 'Respread'], ['import', 'Import']].map(([k, l]) => `<button data-action="${k}" class="${p.action === k ? 'on' : ''}">${l}</button>`).join('')}</div>
      <div class="grid2">${inp('depthIn', 'Depth (in)', p.depthIn)}${a.geom === 'line' ? inp('widthFt', 'Width (ft)', p.widthFt) : ''}</div>`;
  } else {
    res = `<div class="stats"><div class="stat"><b>${num(v.tons, 1)}</b><span>Tons</span></div><div class="stat"><b>${num(v.orderCY, 1)}</b><span>CY to order</span></div><div class="stat"><b>${num(v.cy, 1)}</b><span>CY in place</span></div></div>
      <div class="muted">${num(v.areaSF)} sf · ${num(v.areaSF / 9)} SY${a.geom === 'line' ? ` · ${num(v.length)} lf × ${p.widthFt} ft` : ''}${p.fabric ? ` · fabric ${num(v.fabricSY)} SY (incl. 10% lap)` : ''} · ≈ ${num(v.tons / 22, 1)} tri-axle loads</div>`;
    params = `<h3>Stone</h3>
      <label>Material</label><select data-mat="1">${Object.keys(store.materials).map(m => `<option ${m === p.material ? 'selected' : ''}>${esc(m)}</option>`).join('')}</select>
      <div class="grid2">${inp('depthIn', 'Compacted depth (in)', p.depthIn)}${a.geom === 'line' ? inp('widthFt', 'Width (ft)', p.widthFt) : ''}${inp('compactPct', 'Compaction allowance %', p.compactPct)}${inp('density', 'Tons per loose CY', p.density)}${inp('price', '$ / ton installed', p.price)}
      <div><label>Geotextile fabric</label><select data-pb="fabric"><option value="0" ${!p.fabric ? 'selected' : ''}>No</option><option value="1" ${p.fabric ? 'selected' : ''}>Yes</option></select></div></div>`;
  }
  return `<div class="row" style="margin-bottom:6px"><button class="sec" id="aBack" style="flex:0 0 auto">‹ Areas</button><h2 style="margin:0;flex:1;text-align:center" id="aName">${esc(a.name)} ✎</h2><button class="dng" id="aDel" style="flex:0 0 auto">Delete</button></div>
    <div class="muted" style="text-align:center">${TYPE[a.type].label}</div>
    ${res}${params}
    <div class="row mt"><button class="sec" id="aVerts">${editVerts ? 'Done editing' : 'Edit corners'}</button><button class="sec" id="aRedraw">Redraw</button><button class="sec" id="aZoom">Zoom</button></div>
    ${editVerts ? '<div class="muted mt">Drag the white dots to adjust. Long-press a dot to remove it.</div>' : ''}`;
}

// ---------------- Estimate tab ----------------
async function shareOrDownload(name, text, mime, opts) {
  opts = opts || {};
  // Inside Claude: hand the file to the viewer through the downloads capability
  if (window.claude && typeof window.claude.use === 'function') {
    let dl = null;
    try { dl = await window.claude.use('downloads'); } catch (e) { dl = null; }
    if (dl) {
      try { await dl.save({ filename: name, data: text }); toast('Saved ' + name); }
      catch (e) { if (e && e.code !== 'declined') toast('Could not save the file here (' + (e.code || 'unavailable') + ')'); }
      return;
    }
  }
  const file = new File([text], name, { type: mime });
  if (!opts.noShare && navigator.canShare && navigator.canShare({ files: [file] })) { try { await navigator.share({ files: [file], title: name }); return; } catch (e) { if (e.name === 'AbortError') return; } }
  const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
function reportBody() {
  const E = estimate(), R = P.rates, plan = planSVG();
  return (plan ? `<div class="plan-page">${plan}</div>` : '') + `<h1 style="margin:0">${esc(P.name)}</h1><div>${esc(P.address || '')}</div><div>Sitework takeoff · ${new Date().toLocaleDateString()}</div>
    <h3>Takeoff</h3><table><tr><th>Item</th><th>Qty</th><th>Unit</th><th>Hours</th><th>Labor</th><th>Equip</th><th>Fuel</th><th>Material</th><th>Total</th></tr>
    ${E.secs.map(sc => `<tr><td colspan="9"><b>${esc(sc.name)}</b></td></tr>` + sc.rows.map(r => `<tr><td>${esc(r.desc)}</td><td>${num(r.qty, r.unit === 'AC' ? 2 : 1)}</td><td>${r.unit}</td><td>${num(r.hrs, 1)}</td><td>${money(r.labor)}</td><td>${money(r.equip)}</td><td>${money(r.fuel)}</td><td>${money(r.matT)}</td><td>${money(r.total)}</td></tr>`).join('')).join('')}
    <tr><td colspan="3"><b>Direct cost</b></td><td>${num(E.hrs, 1)}</td><td>${money(E.labor)}</td><td>${money(E.equip)}</td><td>${money(E.fuel)}</td><td>${money(E.mat)}</td><td><b>${money(E.direct)}</b></td></tr>
    <tr><td colspan="8">Overhead ${R.ohPct}%</td><td>${money(E.oh)}</td></tr><tr><td colspan="8">Profit ${R.profitPct}%</td><td>${money(E.profit)}</td></tr><tr><td colspan="8"><b>Bid total</b></td><td><b>${money(E.total)}</b></td></tr></table>
    <p style="font-size:10px;color:#555">Existing grade from ${P.surface && P.surface.source === 'gps' ? 'phone GPS' : 'USGS 3DEP elevation data (NAVD88)'}${P.surface && P.surface.tie ? `, adjusted to ${P.surface.tie.n} field elevation(s)` : ''}. Labor $${R.operator}/${R.laborer} per hr + ${R.burdenPct}% burden; diesel $${R.fuel}/gal. Quantities are estimates; verify before bidding.</p>`;
}
function printReport() { $('#report').innerHTML = reportBody(); window.print(); }
function saveReport() {
  const doc = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(P.name)} — sitework estimate</title>
<style>body{font-family:Helvetica,Arial,sans-serif;font-size:12px;color:#000;background:#fff;max-width:8.5in;margin:0 auto;padding:16px}table{width:100%;border-collapse:collapse}td,th{border-bottom:1px solid #ccc;padding:4px;text-align:right}td:first-child,th:first-child{text-align:left}.plan-page svg{width:100%;height:auto}@media print{@page{size:letter;margin:.3in}.plan-page{page-break-after:always}}</style></head><body>${reportBody()}</body></html>`;
  shareOrDownload((P.name || 'site').replace(/[^\w-]+/g, '_') + '_report.html', doc, 'text/html');
}

// ---------------- Projects ----------------
async function projectsDialog() {
  const card = $('#modalCard');
  card.innerHTML = `<h2 style="margin:0 0 8px">Sites</h2><div class="list">${store.projects.map(p => `<button class="item ${p.id === P.id ? 'sel' : ''}" data-proj="${p.id}"><div class="t"><b>${esc(p.name)}</b><small>${esc(p.address || '')} ${p.areas.length} areas · ${new Date(p.created).toLocaleDateString()}</small></div></button>`).join('')}</div>
    <div class="row mt"><button class="pri" id="pNew">+ New site</button><button class="sec" id="pRename">Rename</button></div>
    <div class="row mt"><button class="sec" id="pExport">Export</button><button class="sec" id="pImport">Import</button><button class="dng" id="pDelete">Delete</button></div>
    ${isStandalone() ? '' : '<button class="sec mt" id="pInstall" style="width:100%">📲 Install on this phone</button>'}
    <button class="sec mt" id="pClose" style="width:100%">Close</button><input type="file" id="pFile" accept=".json,.txt,application/json,text/plain" class="hidden">`;
  $('#modal').classList.remove('hidden');
  const close = () => $('#modal').classList.add('hidden');
  card.querySelectorAll('[data-proj]').forEach(b => b.onclick = () => { switchProject(b.dataset.proj); close(); });
  $('#pClose').onclick = close;
  if ($('#pInstall')) $('#pInstall').onclick = () => { close(); installApp(); };
  $('#pNew').onclick = async () => { close(); const v = await form('New site', [{ key: 'name', label: 'Site / job name', value: '' }], 'Create'); if (!v) return; const p = newProject(v.name || 'New site'); p.view = P.view; store.projects.unshift(p); switchProject(p.id); setTab('site'); onOpen(); };
  $('#pRename').onclick = async () => { close(); const v = await form('Rename site', [{ key: 'name', label: 'Name', value: P.name }, { key: 'address', label: 'Address', value: P.address }]); if (v) { P.name = v.name || P.name; P.address = v.address; save(); render(); } };
  $('#pExport').onclick = () => shareOrDownload((P.name || 'site').replace(/[^\w-]+/g, '_') + '.sitewalk.json', JSON.stringify(P), 'application/json');
  $('#pImport').onclick = () => $('#pFile').click();
  $('#pFile').onchange = async e => {
    const txt = await e.target.files[0].text(), eq = equipFromFile(txt);
    if (eq && !/"areas"/.test(txt)) { close(); equipEditor(eq); return; }
    try { const p = JSON.parse(txt); if (!p.areas) throw 0; p.id = uid(); store.projects.unshift(p); switchProject(p.id); close(); toast('Imported ' + p.name); }
    catch (err) { toast('Not a SiteWalk file'); }
  };
  $('#pDelete').onclick = async () => {
    close(); if (!(await confirmBox(`Delete "${P.name}" and all its walks and areas?`, 'Delete'))) return;
    store.projects = store.projects.filter(p => p.id !== P.id);
    if (!store.projects.length) store.projects.push(newProject());
    switchProject(store.projects[0].id);
  };
}
function switchProject(id) {
  if (walk.active) stopWalk();
  P = store.projects.find(p => p.id === id); store.currentId = id; P.trees = P.trees || []; P.features = P.features || []; migrateTrees(P);
  P.factors = Object.assign(clone(DEFAULT_FACTORS), P.factors || {}); P.prices = Object.assign(clone(DEFAULT_PRICES), P.prices || {});
  migrateLines(P); P.lines = P.lines || [];
  ui.areaId = null; ui.lineId = null; calcCache.clear(); save(true);
  if (P.view) map.setView(P.view.c, P.view.z);
  refreshMap(); render();
}
function refreshMap() {
  drawWalks(); drawShots(); drawPin(); redrawAreas(); drawBoundary(); drawTrees(); drawFeatures();
  if (contoursOn) { if (P.surface) drawContours(); else toggleContours(); }
  else if (P.surface) toggleContours();
}

// ======================================================================
// Event binding for the current panel
// ======================================================================
function bind() {
  const on = (sel, fn, ev = 'click') => { const e = $(sel); if (e) e.addEventListener(ev, fn); };
  const all = (sel, fn, ev = 'click') => document.querySelectorAll('#panel ' + sel).forEach(e => e.addEventListener(ev, () => fn(e)));
  // Site
  const doSearch = async () => {
    const q = $('#q').value; $('#qGo').textContent = '…';
    ui.results = await search(q); $('#qGo').textContent = 'Go';
    if (!ui.results.length) toast('No match found'); else if (ui.results.length === 1) pickResult(0); else render();
  };
  on('#qGo', doSearch);
  on('#q', e => { if (e.key === 'Enter') { e.preventDefault(); $('#q').blur(); doSearch(); } }, 'keydown');
  all('[data-res]', b => pickResult(+b.dataset.res));
  on('#useMe', async () => { const f = await locateOnce(); if (!needFix(f)) return; map.setView([f.lat, f.lon], 19); setPin([f.lat, f.lon]); render(); });
  on('#pinBtn', () => { pinMode = !pinMode; if (pinMode) { $('#sheet').classList.add('collapsed'); toast('Tap the map to place the site pin'); } render(); });
  on('#buildSurf', buildSurface);
  on('#srcSel', e => { P.factors.source = e.target.value; save(); }, 'change');
  on('#detSel', e => { P.factors.detail = e.target.value; save(); }, 'change');
  all('[data-f]', e => { const v = parseFloat(e.value); if (isFinite(v)) { P.factors[e.dataset.f] = v; calcCache.clear(); save(); } }, 'change');
  on('#fitAll', fitAll);
  on('#bSet', () => setupBoundary());
  on('#bEdit', () => { ui.editBnd = !ui.editBnd; editVerts = ui.editBnd; if (editVerts) { showVerts({ pts: P.boundary, geom: 'poly' }); $('#sheet').classList.add('collapsed'); } else lyr.verts.clearLayers(); render(); });
  on('#bClear', async () => { if (await confirmBox('Remove the property line?', 'Remove')) { P.boundary = null; ui.editBnd = false; lyr.verts.clearLayers(); save(); drawBoundary(); render(); } });
  on('#bPlan', planDialog);
  all('[data-bndwalk]', b => { const w = P.walks.find(x => x.id === b.dataset.bndwalk); if (boundaryFromWalk(w)) afterBoundary(); });
  // Features
  on('#fxAdd', () => openAddMenu($('#fxAdd')));
  all('[data-feat]', b => { const f = P.features.find(x => x.id === b.dataset.feat); if (f) { map.fitBounds(L.latLngBounds(f.pts).pad(0.6), { maxZoom: 20 }); featureDialog(f); } });
  on('#fxBnd', () => setupBoundary());
  on('#fxPlan', planDialog);
  on('#wTree', () => openAddMenu($('#wTree')));
  // Trees
  on('#tGps', () => treeAtGps());
  on('#tTap', () => { treeMode = true; $('#sheet').classList.add('collapsed'); toast('Tap the map where the tree is'); });
  all('[data-tree]', b => { const t = P.trees.find(x => x.id === b.dataset.tree); if (t) { map.setView([t.lat, t.lon], Math.max(map.getZoom(), 20)); editTree(t); } });
  on('#tPlan', planDialog);
  // Walk
  on('#wStart', startWalk); on('#wStop', stopWalk);
  on('#wPause', () => { walk.paused = !walk.paused; render(); });
  on('#wShot', dropShot); on('#wShot2', dropShot);
  on('#wFollow', () => { follow = !follow; render(); });
  if (walk.active) updateWalkStats();
  all('[data-delwalk]', async b => { if (await confirmBox('Delete this walk?', 'Delete')) { P.walks = P.walks.filter(w => w.id !== b.dataset.delwalk); save(); drawWalks(); render(); } });
  all('[data-delshot]', b => { P.shots = P.shots.filter(s => s.id !== b.dataset.delshot); save(); drawShots(); render(); });
  all('[data-editshot]', async b => {
    const s = P.shots.find(x => x.id === b.dataset.editshot);
    const v = await form('Spot shot', [{ key: 'label', label: 'Label', value: s.label }, { key: 'elev', label: 'Known elevation (ft)', type: 'number', value: s.elev }]);
    if (v) { s.label = v.label; s.elev = v.elev; save(); drawShots(); render(); if (P.surface) toast('Rebuild the surface to apply known elevations'); }
  });
  // Takeoff
  if (ui.tab === 'takeoff') bindTakeoff(all, on);
  // Areas
  all('[data-new]', b => newArea(b.dataset.new));
  all('[data-open]', b => openArea(b.dataset.open));
  const a = P.areas.find(x => x.id === ui.areaId);
  if (a) {
    const changed = () => { save(); render(); redrawAreas(); };
    on('#aBack', () => { ui.areaId = null; editVerts = false; lyr.verts.clearLayers(); redrawAreas(); render(); });
    on('#aName', async () => { const v = await form('Area name', [{ key: 'n', label: 'Name', value: a.name }]); if (v && v.n) { a.name = v.n; changed(); } });
    on('#aDel', async () => { if (await confirmBox(`Delete ${a.name}?`, 'Delete')) { P.areas = P.areas.filter(x => x !== a); ui.areaId = null; editVerts = false; lyr.verts.clearLayers(); changed(); } });
    on('#aVerts', () => { editVerts = !editVerts; showVerts(a); render(); if (editVerts) $('#sheet').classList.add('collapsed'); });
    on('#aRedraw', () => startDraw(a.geom, pts => { a.pts = pts; changed(); }));
    on('#aSurf', () => { setTab('site'); buildSurface().then(() => openArea(a.id)); });
    on('#aBal', () => { const v = calcArea(a); if (!P.surface || a.p.slabElev == null) { toast('Enter a slab elevation first'); return; } a.p.slabElev = Math.round(G.padBalanceSlab(P.surface, a.pts.map(xyOf), a.p) * 10) / 10; changed(); toast(`Slab set to ${num(a.p.slabElev, 1)} ft to balance the pad`); void v; });
    on('#aZoom', () => map.fitBounds(L.latLngBounds(a.pts).pad(0.3)));
    all('[data-p]', e => { const v = parseFloat(e.value); a.p[e.dataset.p] = isFinite(v) ? v : 0; changed(); }, 'change');
    all('[data-pt]', e => { a.p[e.dataset.pt] = e.value; changed(); }, 'change');
    all('[data-pb]', e => { a.p[e.dataset.pb] = e.value === '1'; if (e.dataset.pb === 'balance' && !a.p.balance) { const v = calcArea(a); if (v.ok) a.p.elev = Math.round(v.designElev * 100) / 100; } changed(); }, 'change');
    all('[data-ps]', e => { a.p[e.dataset.ps] = parseFloat(e.value); changed(); }, 'change');
    all('[data-design]', b => { a.p.design = b.dataset.design; changed(); });
    all('[data-action]', b => { a.p.action = b.dataset.action; changed(); });
    all('[data-mat]', e => { const m = store.materials[e.value]; a.p.material = e.value; a.p.density = m.density; a.p.price = m.price; changed(); }, 'change');
  }
  // Estimate
  bindEstimate(all, on);
  on('#eCsv', () => shareOrDownload((P.name || 'estimate').replace(/[^\w-]+/g, '_') + '_estimate.csv', estimateCSV(), 'text/csv'));
  on('#ePrint', printReport);
  on('#eReport', saveReport);
  on('#eShare', async () => {
    const E = estimate();
    const txt = `${P.name} — sitework estimate\n` + E.lines.map(l => `${l.desc}: ${num(l.qty, 1)} ${l.unit} = ${money(l.ext)}`).join('\n') + `\nTOTAL ${money(E.total)}`;
    if (navigator.share) { try { await navigator.share({ title: P.name, text: txt }); return; } catch (e) { if (e.name === 'AbortError') return; } }
    try { await navigator.clipboard.writeText(txt); toast('Estimate summary copied'); } catch (e) { toast('Sharing is not available here — use CSV or Report'); }
  });
}
function pickResult(i) {
  const r = ui.results[i]; if (!r) return;
  map.setView(r.ll, 19); setPin(r.ll);
  P.address = r.label; if (P.name === 'New site') P.name = r.label.split(',')[0];
  ui.results = []; save(); render();
}


// ======================================================================
// Property line
// ======================================================================
function bearingText(dx, dy) {
  let az = Math.atan2(dx, dy) * 180 / Math.PI; if (az < 0) az += 360;
  const ns = (az <= 90 || az >= 270) ? 'N' : 'S', ew = az < 180 ? 'E' : 'W';
  const ang = ns === 'N' ? (az <= 90 ? az : 360 - az) : (az < 180 ? 180 - az : az - 180);
  let d = Math.floor(ang), mf = (ang - d) * 60, m = Math.floor(mf), sec = Math.round((mf - m) * 60);
  if (sec === 60) { sec = 0; m++; } if (m === 60) { m = 0; d++; }
  return `${ns} ${String(d).padStart(2, '0')}°${String(m).padStart(2, '0')}'${String(sec).padStart(2, '0')}" ${ew}`;
}
function courses(xy) {
  return xy.map((p, i) => { const q = xy[(i + 1) % xy.length]; return { n: i + 1, from: i + 1, to: (i + 1) % xy.length + 1, dist: Math.hypot(q[0] - p[0], q[1] - p[1]), brg: bearingText(q[0] - p[0], q[1] - p[1]), a: p, b: q }; });
}
function bndHtml() {
  const b = P.boundary;
  if (!b || b.length < 3) return `<div class="muted">Walk the property line, then tap “Property line” next to the walk (Walk tab) — or draw / GPS the corners here.</div>
    <div class="row mt"><button class="sec" id="bSet">Set property line</button><button class="sec" id="bPlan">📐 Site plan</button></div>`;
  const xy = b.map(xyOf), A = G.polyArea(xy), per = courses(xy).reduce((s, c) => s + c.dist, 0);
  return `<div class="stats"><div class="stat"><b>${num(A / G.SF_PER_ACRE, 3)}</b><span>Acres</span></div><div class="stat"><b>${num(per)}</b><span>Perimeter ft</span></div><div class="stat"><b>${b.length}</b><span>Corners</span></div></div>
    <div class="row"><button class="sec" id="bEdit">${ui.editBnd ? 'Done editing' : 'Edit corners'}</button><button class="sec" id="bSet">Redraw</button><button class="dng" id="bClear" style="flex:0 0 auto">✕</button></div>
    <button class="pri big mt" id="bPlan" style="width:100%">📐 Site plan drawing</button>`;
}
function boundaryFromWalk(w) {
  if (!w || w.points.length < 4) { toast('Trace too short for a boundary — try again'); return false; }
  let xy = G.simplify(w.points.map(p => xyOf([p.lat, p.lon])), 4);
  if (xy.length > 3 && Math.hypot(xy[0][0] - xy[xy.length - 1][0], xy[0][1] - xy[xy.length - 1][1]) < 15) xy.pop();
  if (xy.length < 3) { toast('That path does not enclose an area'); return false; }
  P.boundary = xy.map(([x, y]) => llOf(x, y)); save(); drawBoundary();
  return true;
}
function drawBoundary() {
  lyr.bnd.clearLayers();
  const b = P.boundary; if (!b || b.length < 3) return;
  L.polygon(b, { color: '#ffffff', weight: 3, dashArray: '14 5 3 5', fill: false, interactive: false }).addTo(lyr.bnd);
  if (map.getZoom() >= 18) courses(b.map(xyOf)).forEach(c => {
    if (c.dist < 25) return;
    // boundary dimension: white tag with "ft", set parallel to the line
    lineLabel(llOf(...c.a), llOf(...c.b), llOf((c.a[0] + c.b[0]) / 2, (c.a[1] + c.b[1]) / 2), `${num(c.dist, 1)} ft`, 'dlabel').addTo(lyr.bnd);
  });
}
map.on('zoomend', () => drawBoundary());

// ======================================================================
// Trees
// ======================================================================
let treeMode = false;
const treeCanopy = t => t.canopy || Math.max(6, Math.round((t.dbh || 6) * 1.75));
function drawTrees() {
  lyr.trees.clearLayers();
  P.trees.forEach(t => {
    const rm = t.status === 'remove', col = rm ? '#ff5a4f' : '#3ddc84';
    L.circle([t.lat, t.lon], { radius: treeCanopy(t) / 2 / G.M2FT, color: col, weight: 2, dashArray: rm ? '5 4' : null, fillColor: col, fillOpacity: 0.15 })
      .addTo(lyr.trees).on('click', e => { if (mapCapturing()) return; L.DomEvent.stopPropagation(e); editTree(t); });
    L.marker([t.lat, t.lon], { icon: L.divIcon({ className: 'treeic ' + (rm ? 'rm' : 'keep'), html: rm ? '✕' : '' }) })
      .addTo(lyr.trees).on('click', () => { if (!mapCapturing()) editTree(t); });
  });
}
async function treeAtGps() {
  const f = await averageFix(2000); if (!needFix(f)) return;
  if (f.acc > 30) toast(`GPS ±${Math.round(f.acc)} ft — you can drag-adjust by re-placing on the map`, 3500);
  addTreeAt(f.lat, f.lon);
}
async function addTreeAt(lat, lon) {
  const last = P.trees[P.trees.length - 1];
  const t = { id: uid(), lat, lon, dbh: last ? last.dbh : 12, canopy: null, species: last ? last.species : '', status: last ? last.status : 'remove', note: '' };
  if (await editTree(t, true)) { P.trees.push(t); save(); drawTrees(); render(); }
}
async function editTree(t, isNew) {
  const v = await form(isNew ? 'Mark tree' : 'Tree', [
    { key: 'status', label: 'Status', type: 'select', value: t.status, options: [['remove', 'Remove'], ['keep', 'Stays (protect)']].concat(isNew ? [] : [['move', '— Move to my GPS spot —'], ['delete', '— Delete this tree —']]) },
    { key: 'dbh', label: 'Trunk diameter at chest height, DBH (in)', type: 'number', value: t.dbh, help: 'Tip: circumference ÷ 3.14. A 38" around trunk ≈ 12" DBH.' },
    { key: 'canopy', label: 'Canopy spread (ft) — blank to estimate', type: 'number', value: t.canopy },
    { key: 'species', label: 'Species', value: t.species, placeholder: 'Oak, maple, pine…' },
    { key: 'note', label: 'Note', value: t.note, placeholder: 'Multi-trunk, dead, near line…' }
  ], isNew ? 'Add tree' : 'Save');
  if (!v) return false;
  if (v.status === 'delete') { P.trees = P.trees.filter(x => x !== t); save(); drawTrees(); render(); return false; }
  if (v.status === 'move') { const f = await averageFix(2000); if (!needFix(f)) return false; t.lat = f.lat; t.lon = f.lon; v.status = t.status; }
  Object.assign(t, { status: v.status, dbh: v.dbh || 0, canopy: v.canopy || null, species: v.species, note: v.note });
  if (!isNew) { save(); drawTrees(); render(); }
  return true;
}
function treesHtml() {
  const rm = P.trees.filter(t => t.status === 'remove'), keep = P.trees.filter(t => t.status !== 'remove');
  return `<h3>Trees (${P.trees.length})</h3>
  <div class="row"><button class="sec" id="tGps">🌳 Tree where I’m standing</button><button class="sec" id="tTap">Tap map</button></div>
  <div class="stats"><div class="stat"><b>${P.trees.length}</b><span>Trees</span></div><div class="stat cut"><b>${rm.length}</b><span>Remove</span></div><div class="stat" style="color:var(--ok)"><b>${keep.length}</b><span>Stay</span></div></div>
  ${rm.length ? `<div class="muted">Remove: ${rm.filter(t => t.dbh < 12).length} under 12" · ${rm.filter(t => t.dbh >= 12 && t.dbh <= 24).length} at 12–24" · ${rm.filter(t => t.dbh > 24).length} over 24" DBH · ${num(rm.reduce((s, t) => s + (t.dbh || 0), 0))} total DBH inches</div>` : ''}
  <div class="list mt">${P.trees.map((t, i) => `<button class="item" data-tree="${t.id}"><div class="sw" style="background:${t.status === 'remove' ? '#d93025' : '#188038'};border-radius:50%"></div><div class="t"><b>T${i + 1} · ${num(t.dbh)}" ${esc(t.species || 'tree')}</b><small>${t.status === 'remove' ? 'Remove' : 'Stays'} · ${treeCanopy(t)} ft canopy${t.note ? ' · ' + esc(t.note) : ''}</small></div>›</button>`).join('') || '<div class="muted">Stand at each trunk and tap “At my location”, or tap “Tap map to place” for trees you can see on the satellite image.</div>'}</div>
`;
}

// ======================================================================
// Site plan drawing (SVG, letter portrait)
// ======================================================================
const planOpt = { contours: true, areas: true, features: true, trees: true, walk: false };
function planSVG(opt) {
  opt = Object.assign({}, planOpt, opt || {});
  const bxy = (P.boundary || []).length >= 3 ? P.boundary.map(xyOf) : null;
  const ext = [];
  if (bxy) ext.push(...bxy);
  if (opt.trees) P.trees.forEach(t => { const [x, y] = xyOf([t.lat, t.lon]), r = treeCanopy(t) / 2; ext.push([x - r, y - r], [x + r, y + r]); });
  if (opt.areas) P.lines.forEach(Ln => { (Ln.shapes || []).forEach(sh => sh.pts.forEach(p => ext.push(xyOf(p)))); if (Ln._ext) Ln._ext.forEach(p => ext.push(xyOf(p))); });
  if (opt.features) P.features.forEach(f => f.pts.forEach(p => ext.push(xyOf(p))));
  if (opt.walk || !ext.length) P.walks.forEach(w => w.points.forEach(p => ext.push(xyOf([p.lat, p.lon]))));
  if (!ext.length) return null;
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
  ext.forEach(([x, y]) => { minx = Math.min(minx, x); maxx = Math.max(maxx, x); miny = Math.min(miny, y); maxy = Math.max(maxy, y); });
  const padf = Math.max(15, 0.08 * Math.max(maxx - minx, maxy - miny));
  minx -= padf; maxx += padf; miny -= padf; maxy += padf;
  // Sheet layout: Letter portrait (title block along the bottom) or 11×17 landscape (panel + title block on the right)
  const TAB = opt.page === 'tabloid';
  const W = TAB ? 1632 : 816, H = 1056, DX = 36, DY = TAB ? 36 : 84, DW = TAB ? 1200 : 744, DH = TAB ? 984 : 646;
  const scales = [10, 20, 30, 40, 50, 60, 80, 100, 150, 200, 300, 400, 500, 1000, 2000];
  const sc = scales.find(s => (maxx - minx) / s * 96 <= DW && (maxy - miny) / s * 96 <= DH) || 5000;
  const k = 96 / sc, cx = (minx + maxx) / 2, cy = (miny + maxy) / 2;
  const X = x => DX + DW / 2 + (x - cx) * k, Y = y => DY + DH / 2 - (y - cy) * k;
  const f1 = v => v.toFixed(1);
  const path = (xy, close) => xy.map((p, i) => (i ? 'L' : 'M') + f1(X(p[0])) + ' ' + f1(Y(p[1]))).join(' ') + (close ? ' Z' : '');
  const placed = [];
  const slot = (x, y, w, h) => { let yy = y; for (let n = 0; n < 12; n++) { if (!placed.some(p => Math.abs(p[0] - x) < (p[2] + w) / 2 && Math.abs(p[1] - yy) < (p[3] + h) / 2)) break; yy += h + 2; } placed.push([x, yy, w, h]); return yy; };
  const T = (x, y, txt, o = {}) => `<text x="${f1(x)}" y="${f1(y)}" font-size="${o.size || 9}" ${o.bold ? 'font-weight="700"' : ''} ${o.italic ? 'font-style="italic"' : ''} ${o.anchor ? `text-anchor="${o.anchor}"` : ''} fill="${o.fill || '#000'}" ${o.rot != null ? `transform="rotate(${f1(o.rot)} ${f1(x)} ${f1(y)})"` : ''} ${o.halo ? 'stroke="#fff" stroke-width="3" paint-order="stroke"' : ''}>${esc(txt)}</text>`;
  let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${TAB ? 17 : 8.5}in" height="11in" font-family="Helvetica, Arial, sans-serif">
  <rect width="${W}" height="${H}" fill="#fff"/><rect x="18" y="18" width="${W - 36}" height="${H - 36}" fill="none" stroke="#000" stroke-width="0.6"/><rect x="24" y="24" width="${W - 48}" height="${H - 48}" fill="none" stroke="#000" stroke-width="2"/>
  <defs><clipPath id="da"><rect x="${DX}" y="${DY}" width="${DW}" height="${DH}"/></clipPath>
  <pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="6" stroke="#999" stroke-width="0.6"/></pattern>
  ${['existing', 'remove', 'proposed'].map(k => `<pattern id="woods-${k}" width="16" height="14" patternUnits="userSpaceOnUse"><circle cx="4" cy="4" r="2.6" fill="none" stroke="${PLAN_COLOR[k]}" stroke-width="0.6"/><circle cx="12" cy="11" r="2.6" fill="none" stroke="${PLAN_COLOR[k]}" stroke-width="0.6"/></pattern>`).join('')}</defs>
  ${TAB ? `${T(1262, 62, P.name, { size: 17, bold: true })}${T(1262, 80, P.address || '', { size: 10 })}${T(1262, 112, 'SITE PLAN', { size: 20, bold: true })}${T(1262, 128, 'EXISTING CONDITIONS & SITE WORK', { size: 9 })}<line x1="1248" y1="142" x2="${W - 24}" y2="142" stroke="#000"/><line x1="1248" y1="24" x2="1248" y2="${H - 24}" stroke="#000" stroke-width="1.2"/>`
    : `${T(40, 52, P.name, { size: 18, bold: true })}${T(40, 68, P.address || '', { size: 10 })}${T(W - 40, 52, 'SITE PLAN', { size: 14, bold: true, anchor: 'end' })}${T(W - 40, 68, 'EXISTING CONDITIONS & SITE WORK', { size: 9, anchor: 'end' })}<line x1="24" y1="76" x2="${W - 24}" y2="76" stroke="#000"/>`}
  <g clip-path="url(#da)">`;
  // contours
  if (opt.contours && P.surface) {
    contourLines().forEach(c => {
      s += `<path d="${path(c.pts)}" fill="none" stroke="${c.idx ? '#8a7a6a' : '#c8beb4'}" stroke-width="${c.idx ? 0.9 : 0.5}"/>`;
      if (c.idx && c.pts.length > 6) { const p = c.pts[Math.floor(c.pts.length / 2)]; s += T(X(p[0]), Y(p[1]) + 3, num(c.value, c.step < 1 ? 1 : 0), { size: 7, anchor: 'middle', fill: '#8a6d50', halo: true, italic: true }); }
    });
  }
  // walk track
  if (opt.walk) P.walks.forEach(w => { s += `<path d="${path(w.points.map(p => xyOf([p.lat, p.lon])))}" fill="none" stroke="#e0a800" stroke-width="0.8" stroke-dasharray="2 2"/>`; });
  let bLabelY = null;
  if (opt.trees) P.trees.forEach(t => { const [x, y] = xyOf([t.lat, t.lon]); const r = Math.max(6, treeCanopy(t) / 2 * k); placed.push([X(x), Y(y), r * 2, r * 2]); });
  if (bxy) { const c = G.polyCentroid(bxy); bLabelY = slot(X(c[0]), Y(c[1]), 130, 26); }
  // takeoff items, numbered to match the takeoff
  if (opt.areas) P.lines.forEach((Ln, i) => {
    const col = lineColor(Ln), n = i + 1, q = lineQty(Ln), tags = [];
    (Ln.shapes || []).forEach(sh => {
      const xy = sh.pts.map(xyOf);
      if (sh.geom === 'points') xy.forEach(([x, y]) => { s += `<circle cx="${X(x)}" cy="${Y(y)}" r="3.2" fill="${col}" stroke="#fff" stroke-width="0.8"/>`; });
      else if (sh.geom === 'line') {
        if (Ln.calc === 'stone') G.lineBufferRects(xy, Ln.params.widthFt || 12).forEach(r => { s += `<path d="${path(r, true)}" fill="${col}" fill-opacity="0.22" stroke="none"/>`; });
        s += `<path d="${path(xy, false)}" fill="none" stroke="${col}" stroke-width="2" stroke-dasharray="8 3"/>`;
      } else if (Ln.calc === 'pad') { const top = G.offsetPolygon(xy, Ln.params.offsetFt == null ? 6 : Ln.params.offsetFt); s += `<path d="${path(top, true)}" fill="url(#hatch)" stroke="${col}" stroke-width="1.2"/><path d="${path(xy, true)}" fill="#fff" fill-opacity="0.7" stroke="#333" stroke-width="1.2" stroke-dasharray="5 3"/>`; }
      else s += `<path d="${path(xy, true)}" fill="${Ln.calc === 'grade' ? 'url(#hatch)' : col}" fill-opacity="${Ln.calc === 'grade' ? 1 : 0.18}" stroke="${col}" stroke-width="1.2"/>`;
      tags.push(sh.geom === 'points' ? xy[0] : sh.geom === 'line' ? xy[Math.floor(xy.length / 2)] : G.polyCentroid(xy));
    });
    if (!tags.length) return;
    const c = tags[0], sub = Ln.calc === 'pad' && q.pad ? `SLAB ${num(Ln.params.slabElev, 2)} · PAD ${num(q.pad.padElev, 2)}` : Ln.calc === 'grade' && q.grade ? `FG ${num(q.grade.designElev, 2)}` : q.why ? '' : `${num(q.qty, q.unit === 'AC' || q.unit === 'MSF' ? 2 : 0)} ${q.unit}`;
    const t1 = (Ln.desc.length > 30 ? Ln.desc.slice(0, 29) + '…' : Ln.desc).toUpperCase();
    const ly2 = slot(X(c[0]), Y(c[1]) - 16, Math.max(70, t1.length * 4.6 + 22), 22);
    s += `<circle cx="${X(c[0])}" cy="${Y(c[1])}" r="7" fill="${col}" stroke="#fff" stroke-width="1"/>` + T(X(c[0]), Y(c[1]) + 3, String(n), { size: 8, bold: true, anchor: 'middle', fill: '#fff' });
    s += T(X(c[0]), ly2 - 2, t1, { size: 7.5, bold: true, anchor: 'middle', halo: true }) + T(X(c[0]), ly2 + 8, sub, { size: 7, anchor: 'middle', halo: true });
    tags.slice(1).forEach(([x, y]) => { s += `<circle cx="${X(x)}" cy="${Y(y)}" r="6" fill="${col}" stroke="#fff" stroke-width="1"/>` + T(X(x), Y(y) + 3, String(n), { size: 7, bold: true, anchor: 'middle', fill: '#fff' }); });
  });
  // property line
  const lineTable = [];
  if (bxy) {
    s += `<path d="${path(bxy, true)}" fill="none" stroke="#000" stroke-width="2.2" stroke-dasharray="22 4 4 4"/>`;
    const ccw = (() => { let a = 0; for (let i = 0, j = bxy.length - 1; i < bxy.length; j = i++) a += (bxy[j][0] - bxy[i][0]) * (bxy[j][1] + bxy[i][1]); return a < 0; })();
    courses(bxy).forEach(c => {
      const x1 = X(c.a[0]), y1 = Y(c.a[1]), x2 = X(c.b[0]), y2 = Y(c.b[1]), L = Math.hypot(x2 - x1, y2 - y1);
      let ang = Math.atan2(y2 - y1, x2 - x1) * 180 / Math.PI; if (ang > 90) ang -= 180; if (ang < -90) ang += 180;
      // outward normal in screen space (y down)
      let nx = (y2 - y1) / L, ny = -(x2 - x1) / L; if (!ccw) { nx = -nx; ny = -ny; }
      const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
      if (L >= 120) {
        s += T(mx + nx * 9, my + ny * 9 + 3, c.brg, { size: 8, anchor: 'middle', rot: ang, halo: true });
        s += T(mx - nx * 9, my - ny * 9 + 3, num(c.dist, 2) + "'", { size: 8, anchor: 'middle', rot: ang, halo: true });
      } else if (L >= 12) { lineTable.push(c); s += T(mx + nx * 10, my + ny * 10 + 3, 'L' + c.n, { size: 8, bold: true, anchor: 'middle', halo: true }); }
      else lineTable.push(c);
    });
    bxy.forEach((p, i) => { s += `<circle cx="${f1(X(p[0]))}" cy="${f1(Y(p[1]))}" r="2.6" fill="#fff" stroke="#000" stroke-width="1.2"/>`; });
    const A = G.polyArea(bxy), c = G.polyCentroid(bxy);
    s += T(X(c[0]), bLabelY - 3, `AREA = ${num(A / G.SF_PER_ACRE, 3)} AC`, { size: 10, bold: true, anchor: 'middle', halo: true }) + T(X(c[0]), bLabelY + 10, `(${num(A)} SF)`, { size: 8, anchor: 'middle', halo: true });
  }
  // trees
  if (opt.features) P.features.forEach(f => {
    const F = FEAT[f.type] || FEAT.other, rm = f.status === 'remove', prop = f.status === 'proposed';
    const col = PLAN_COLOR[f.status] || PLAN_COLOR.existing, dash = prop ? 'stroke-dasharray="6 3"' : rm ? 'stroke-dasharray="3 2"' : '';
    const xy = f.pts.map(xyOf); let c, rpx = 6;
    if (f.type === 'woods') {
      const ring = cloudRing(xy, 12 / k);   // ~12 px scallops at any scale
      s += `<path d="${path(ring, true)}" fill="${col}" fill-opacity="0.08" stroke="none"/><path d="${path(ring, true)}" fill="url(#woods-${f.status})" stroke="${col}" stroke-width="1.3"/>`;
      c = G.polyCentroid(xy);
      const ac = G.polyArea(xy) / G.SF_PER_ACRE, t1 = (f.label || 'WOODED AREA').toUpperCase(), t2 = rm ? `CLEAR & GRUB ${num(ac, 2)} AC` : prop ? `NEW PLANTING ${num(ac, 2)} AC` : `EX. TREES TO REMAIN ${num(ac, 2)} AC`;
      const yy = slot(X(c[0]), Y(c[1]), Math.max(t1.length, t2.length) * 4.6, 22);
      s += T(X(c[0]), yy - 2, t1, { size: 7.5, bold: true, anchor: 'middle', fill: col, halo: true }) + T(X(c[0]), yy + 8, t2, { size: 7, anchor: 'middle', fill: col, halo: true });
      return;
    }
    if (f.geom === 'poly') { s += `<path d="${path(xy, true)}" fill="${col}" fill-opacity="0.12" stroke="${col}" stroke-width="1.4" ${dash}/>`; c = G.polyCentroid(xy); }
    else if (f.geom === 'line') {
      if (f.widthFt) G.lineBufferRects(xy, f.widthFt).forEach(r => { s += `<path d="${path(r, true)}" fill="${col}" fill-opacity="0.12" stroke="none"/>`; });
      s += `<path d="${path(xy)}" fill="none" stroke="${col}" stroke-width="${f.type === 'wall' ? 2.6 : 1.4}" ${dash}/>`;
      if (f.type === 'fence') for (let i = 1; i < xy.length; i++) {
        const x1 = X(xy[i - 1][0]), y1 = Y(xy[i - 1][1]), x2 = X(xy[i][0]), y2 = Y(xy[i][1]), Ls = Math.hypot(x2 - x1, y2 - y1);
        for (let d = 12; d < Ls; d += 26) { const px = x1 + (x2 - x1) * d / Ls, py = y1 + (y2 - y1) * d / Ls; s += `<path d="M${f1(px - 3)} ${f1(py - 3)}L${f1(px + 3)} ${f1(py + 3)}M${f1(px - 3)} ${f1(py + 3)}L${f1(px + 3)} ${f1(py - 3)}" stroke="${col}" stroke-width="1"/>`; }
      }
      c = xy[Math.floor(xy.length / 2)];
    } else {
      c = xy[0]; const sx = X(c[0]), sy = Y(c[1]);
      if (f.type === 'tree') {
        rpx = Math.max(4, featCanopy(f) / 2 * k);
        s += `<circle cx="${f1(sx)}" cy="${f1(sy)}" r="${f1(rpx)}" fill="${col}" fill-opacity="0.1" stroke="${col}" stroke-width="1" ${dash}/><circle cx="${f1(sx)}" cy="${f1(sy)}" r="1.8" fill="${col}"/>`;
        if (rm) { const d = Math.min(rpx, 6); s += `<path d="M${f1(sx - d)} ${f1(sy - d)}L${f1(sx + d)} ${f1(sy + d)}M${f1(sx - d)} ${f1(sy + d)}L${f1(sx + d)} ${f1(sy - d)}" stroke="${col}" stroke-width="1.4"/>`; }
      } else s += `<circle cx="${f1(sx)}" cy="${f1(sy)}" r="6" fill="#fff" stroke="${col}" stroke-width="1.3" ${dash}/>` + T(sx, sy + 2.6, F.sym, { size: 7.5, bold: true, anchor: 'middle', fill: col });
    }
    const txt = ((rm ? '' : prop ? 'NEW ' : 'EX. ') + featName(f)).toUpperCase() + (rm ? ' (REMOVE)' : '');
    const pt = f.geom === 'point', lx = X(c[0]) + (pt ? Math.max(rpx * 0.7, 9) : 0);
    const yy = slot(pt ? lx + txt.length * 2.2 : lx, Y(c[1]) + (pt ? 3 - (f.type === 'tree' ? Math.max(rpx * 0.7, 0) : 0) : 0), txt.length * 4.6, 10);
    s += T(lx, yy, txt, { size: 7, bold: true, anchor: pt ? 'start' : 'middle', fill: col, halo: true });
  });
  if (opt.trees) P.trees.forEach((t, i) => {
    const [x, y] = xyOf([t.lat, t.lon]), r = Math.max(3, treeCanopy(t) / 2 * k), sx = X(x), sy = Y(y), rm = t.status === 'remove';
    const col = rm ? '#c62828' : '#1b5e20';
    s += `<circle cx="${f1(sx)}" cy="${f1(sy)}" r="${f1(r)}" fill="${rm ? 'none' : '#e8f5e9'}" fill-opacity="0.6" stroke="${col}" stroke-width="1" ${rm ? 'stroke-dasharray="3 2"' : ''}/>`;
    s += `<circle cx="${f1(sx)}" cy="${f1(sy)}" r="1.8" fill="${col}"/>`;
    if (rm) { const d = Math.min(r, 6); s += `<path d="M${f1(sx - d)} ${f1(sy - d)}L${f1(sx + d)} ${f1(sy + d)}M${f1(sx - d)} ${f1(sy + d)}L${f1(sx + d)} ${f1(sy - d)}" stroke="${col}" stroke-width="1.4"/>`; }
    s += T(sx + Math.max(r * 0.7, 5), sy - Math.max(r * 0.7, 5), `T${i + 1} ${num(t.dbh)}"${t.species ? ' ' + t.species.toUpperCase() : ''}`, { size: 7, fill: col, halo: true });
  });
  s += `</g><rect x="${DX}" y="${DY}" width="${DW}" height="${DH}" fill="none" stroke="#000" stroke-width="0.5"/>`;
  // north arrow + scale bar
  const nax = DX + DW - 34, nay = DY + 20;
  s += `<path d="M${nax} ${nay}L${nax + 10} ${nay + 34}L${nax} ${nay + 27}L${nax - 10} ${nay + 34}Z" fill="#000"/>` + T(nax, nay + 50, 'N', { size: 14, bold: true, anchor: 'middle' });
  const sbx = DX + 14, sby = DY + DH - 22;
  s += `<rect x="${sbx}" y="${sby}" width="48" height="6" fill="#000"/><rect x="${sbx + 48}" y="${sby}" width="48" height="6" fill="#fff" stroke="#000"/><rect x="${sbx + 96}" y="${sby}" width="96" height="6" fill="#000"/>`;
  s += T(sbx, sby - 4, '0', { size: 8, anchor: 'middle' }) + T(sbx + 96, sby - 4, String(sc), { size: 8, anchor: 'middle' }) + T(sbx + 192, sby - 4, String(sc * 2) + ' FT', { size: 8, anchor: 'middle' });
  s += T(sbx, sby + 17, `SCALE: 1" = ${sc}'`, { size: 9, bold: true });
  // legend + notes + line table
  const LX = TAB ? 1262 : 40;
  let ly = TAB ? 166 : DY + DH + 22;
  s += T(LX, ly, 'LEGEND', { size: 10, bold: true });
  const ly0 = ly;
  // legend rows: [draw(x, y) → svg for a 40px swatch centred on y, label]
  const leg = [[(x, y) => `<line x1="${x}" y1="${y}" x2="${x + 40}" y2="${y}" stroke="#000" stroke-width="2.2" stroke-dasharray="12 3 3 3"/>`, 'PROPERTY LINE (APPROX.)']];
  if (P.trees.some(t => t.status !== 'remove')) leg.push([(x, y) => `<circle cx="${x + 20}" cy="${y}" r="6" fill="#e8f5e9" stroke="#1b5e20"/><circle cx="${x + 20}" cy="${y}" r="1.8" fill="#1b5e20"/>`, `TREE TO REMAIN (${P.trees.filter(t => t.status !== 'remove').length})`]);
  if (P.trees.some(t => t.status === 'remove')) leg.push([(x, y) => `<circle cx="${x + 20}" cy="${y}" r="6" fill="none" stroke="#c62828" stroke-dasharray="3 2"/><path d="M${x + 15} ${y - 5}L${x + 25} ${y + 5}M${x + 15} ${y + 5}L${x + 25} ${y - 5}" stroke="#c62828" stroke-width="1.4"/>`, `TREE TO BE REMOVED (${P.trees.filter(t => t.status === 'remove').length})`]);
  if (P.surface) leg.push([(x, y) => `<line x1="${x}" y1="${y}" x2="${x + 40}" y2="${y}" stroke="#8a7a6a" stroke-width="0.9"/>`, `EXISTING CONTOUR (${P.factors.contourFt || 1}' INT.)`]);
  const stUsed = ['existing', 'remove', 'proposed'].filter(k => P.features.some(f => f.status === k));
  const stLabel = { existing: 'EXISTING FEATURE (GREEN)', remove: 'TO BE REMOVED (RED)', proposed: 'NEW / PROPOSED (BLUE)' };
  stUsed.forEach(k => leg.push([(x, y) => `<rect x="${x + 8}" y="${y - 6}" width="24" height="12" fill="${PLAN_COLOR[k]}" fill-opacity="0.12" stroke="${PLAN_COLOR[k]}" stroke-width="1.4" ${k === 'remove' ? 'stroke-dasharray="3 2"' : k === 'proposed' ? 'stroke-dasharray="6 3"' : ''}/>`, stLabel[k]]));
  if (P.features.some(f => f.type === 'woods')) leg.push([(x, y) => `<path d="M${x + 4} ${y + 4}a4 4 0 0 1 8 0a4 4 0 0 1 8 0a4 4 0 0 1 8 0a4 4 0 0 1 8 0" fill="none" stroke="#333" stroke-width="1.1"/><path d="M${x + 4} ${y + 4}l32 0" stroke="#333" stroke-width="0.6"/>`, 'TREE CLOUD (WOODED AREA)']);
  if (P.features.some(f => f.type === 'tree')) leg.push([(x, y) => `<circle cx="${x + 20}" cy="${y}" r="6" fill="#1b7a3a" fill-opacity="0.1" stroke="#1b7a3a"/><circle cx="${x + 20}" cy="${y}" r="1.6" fill="#1b7a3a"/>`, 'TREE (CANOPY SPREAD)']);
  const mLines = opt.areas ? P.lines.filter(Ln => (Ln.shapes || []).length) : [];
  if (mLines.length) leg.push([(x, y) => `<circle cx="${x + 20}" cy="${y}" r="6" fill="#e8710a" stroke="#fff"/><text x="${x + 20}" y="${y + 2.6}" font-size="7" font-weight="700" fill="#fff" text-anchor="middle">1</text>`, TAB ? 'TAKEOFF ITEM NUMBER — SEE LIST BELOW' : 'TAKEOFF ITEM NUMBER (SEE ESTIMATE)']);
  if (opt.areas && P.lines.some(Ln => Ln.calc === 'pad' && Ln.shapes.length)) leg.push([(x, y) => `<rect x="${x + 6}" y="${y - 6}" width="28" height="12" fill="url(#hatch)" stroke="${TYPE.pad.color}"/><rect x="${x + 12}" y="${y - 3}" width="16" height="6" fill="#fff" stroke="#333" stroke-dasharray="3 2" stroke-width="0.8"/>`, 'BUILDING PAD / HOUSE']);
  const syms = [...new Set(P.features.filter(f => f.geom === 'point' && f.type !== 'tree').map(f => f.type))];
  if (syms.length) leg.push([(x, y) => `<circle cx="${x + 20}" cy="${y}" r="6" fill="#fff" stroke="#333" stroke-width="1.2"/><text x="${x + 20}" y="${y + 2.6}" font-size="7.5" font-weight="700" text-anchor="middle">${esc(FEAT[syms[0]].sym)}</text>`, syms.map(t => `${FEAT[t].sym} = ${FEAT[t].short.toUpperCase()}`).join(', ')]);
  const perCol = TAB ? leg.length : (leg.length > 5 ? Math.ceil(leg.length / 2) : leg.length), colW = 190;
  leg.forEach(([g, l], i) => { const cx = LX + Math.floor(i / perCol) * colW, cy = ly + 15 + (i % perCol) * 14; s += g(cx, cy) + T(cx + 48, cy + 3, l, { size: 7.5 }); });
  ly += 15 + perCol * 14 + 10;
  // notes (wrapped to the space available)
  const wrap = (txt, max) => { const out = []; let line = ''; txt.split(' ').forEach(w => { if ((line + ' ' + w).trim().length > max) { out.push(line); line = w; } else line = (line + ' ' + w).trim(); }); if (line) out.push(line); return out; };
  const notes = [
    'Bearings & distances derived from a phone GPS site walk (typ. ±10–30 ft) referenced to true north.',
    'NOT A BOUNDARY SURVEY — for estimating and planning only.',
    P.surface ? `Contours from ${P.surface.source === 'gps' ? 'phone GPS' : 'USGS 3DEP elevation data'}, NAVD88 ft${P.surface.tie ? ', adjusted to field elevations' : ''}.` : '',
    'Tree sizes are trunk diameter (DBH, in). Canopy circles show approximate drip line.'
  ].filter(Boolean);
  const noteMax = TAB ? 78 : (lineTable.length ? 88 : 170);
  s += T(LX, ly, 'NOTES', { size: 9, bold: true }); ly += 12;
  notes.forEach((n, i) => wrap(`${i + 1}. ${n}`, noteMax).forEach((ln, j) => { s += T(LX + (j ? 9 : 0), ly, ln, { size: 7.5 }); ly += 10.5; }));
  if (lineTable.length) {
    const tx = TAB ? LX : 430, ty = TAB ? ly + 12 : ly0, maxRows = TAB ? 22 : 10;
    s += T(tx, ty, 'LINE TABLE', { size: 9, bold: true });
    const rows = lineTable.slice(0, maxRows * 2), half = Math.ceil(rows.length / 2);
    rows.forEach((c, i) => { const col = i < half ? 0 : 1, r = i % half; s += T(tx + col * (TAB ? 168 : 175), ty + 14 + r * 11, `L${c.n}  ${c.brg}  ${num(c.dist, 2)}'`, { size: 7.5 }); });
    if (lineTable.length > rows.length) s += T(tx, ty + 14 + half * 11 + 4, `+${lineTable.length - rows.length} more short courses`, { size: 7 });
    if (TAB) ly = ty + 14 + Math.min(half, maxRows) * 11 + 16;
  }
  if (TAB && mLines.length && ly < 800) {
    s += T(LX, ly + 6, 'TAKEOFF ITEMS', { size: 9, bold: true }); ly += 20;
    P.lines.forEach((Ln, i) => { if (ly > 830) return; const q = lineQty(Ln); s += `<circle cx="${LX + 6}" cy="${ly - 3}" r="5.5" fill="${lineColor(Ln)}"/>` + T(LX + 6, ly - 0.5, String(i + 1), { size: 6.5, bold: true, anchor: 'middle', fill: '#fff' }) + T(LX + 16, ly, `${(Ln.desc.length > 46 ? Ln.desc.slice(0, 45) + '…' : Ln.desc)}${q.why ? '' : ` — ${num(q.qty, q.unit === 'AC' || q.unit === 'MSF' ? 2 : 0)} ${q.unit}`}`, { size: 7.5 }); ly += 12; });
  }
  // title block
  s += titleBlockSVG(TAB ? { x: 1248, y: 846, w: W - 24 - 1248, h: H - 24 - 846, stacked: true } : { x: 24, y: 944, w: W - 48, h: H - 24 - 944 }, sc, T);
  return s + '</svg>';
}
// Drawing title block: contractor, project, drawing title, scale / date / sheet
function titleBlockSVG(b, sc, T) {
  const co = store.company || {}, pr = P.proposal || {}, today = new Date().toLocaleDateString();
  const client = [pr.clientName, pr.clientCo].filter(Boolean).join(' · ');
  const cell = (x, y, w, h, label, lines) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#fff" stroke="#000" stroke-width="1"/>` + T(x + 6, y + 11, label, { size: 6.5, fill: '#555', bold: true }) +
    lines.filter(l => l && l.t).map((l, i) => T(x + 6, y + 25 + i * (l.gap || 12), l.t, { size: l.size || 8.5, bold: l.bold })).join('');
  const C = [{ t: co.name || 'Contractor name', size: 10.5, bold: true }, { t: co.phone || '' }, { t: [co.email, co.license ? 'Lic. ' + co.license : ''].filter(Boolean).join(' · '), size: 7.5 }];
  const Pj = [{ t: P.name, size: 9.5, bold: true }, { t: P.address || '' , size: 8 }, { t: client ? 'For: ' + client : '', size: 8 }];
  const D = [{ t: 'SITE PLAN', size: 13, bold: true, gap: 14 }, { t: 'Existing conditions & site work', size: 7.5 }];
  if (b.stacked) {
    const h1 = 56, h2 = 56, h3 = 40, h4 = b.h - h1 - h2 - h3, w3 = b.w / 3;
    return cell(b.x, b.y, b.w, h1, 'CONTRACTOR', C) + cell(b.x, b.y + h1, b.w, h2, 'PROJECT', Pj) + cell(b.x, b.y + h1 + h2, b.w, h3, 'DRAWING', D) +
      cell(b.x, b.y + h1 + h2 + h3, w3, h4, 'SCALE', [{ t: `1" = ${sc}'` }]) + cell(b.x + w3, b.y + h1 + h2 + h3, w3, h4, 'DATE', [{ t: today }]) +
      cell(b.x + 2 * w3, b.y + h1 + h2 + h3, b.w - 2 * w3, h4, 'SHEET', [{ t: '1 OF 1' + (pr.number ? ' · ' + pr.number : ''), size: 8 }]);
  }
  const w1 = b.w * 0.3, w2 = b.w * 0.33, w3 = b.w * 0.19, w4 = b.w - w1 - w2 - w3, hh = b.h / 3;
  return cell(b.x, b.y, w1, b.h, 'CONTRACTOR', C) + cell(b.x + w1, b.y, w2, b.h, 'PROJECT', Pj) + cell(b.x + w1 + w2, b.y, w3, b.h, 'DRAWING', D) +
    cell(b.x + w1 + w2 + w3, b.y, w4, hh, 'SCALE', [{ t: `1" = ${sc}'`, size: 8 }].map(l => Object.assign(l, { gap: 0 }))).replace(/y="(\d+(?:\.\d+)?)" font-size="8"/, (m, y) => `y="${+y - 4}" font-size="8"`) +
    cell(b.x + w1 + w2 + w3, b.y + hh, w4, hh, 'DATE', [{ t: today, size: 8 }]).replace(/y="(\d+(?:\.\d+)?)" font-size="8"/, (m, y) => `y="${+y - 4}" font-size="8"`) +
    cell(b.x + w1 + w2 + w3, b.y + 2 * hh, w4, b.h - 2 * hh, 'SHEET', [{ t: '1 OF 1' + (pr.number ? ' · ' + pr.number : ''), size: 8 }]).replace(/y="(\d+(?:\.\d+)?)" font-size="8"/, (m, y) => `y="${+y - 4}" font-size="8"`);
}
function planDialog() {  return s + '</svg>';
}
function planDialog() {
  const svg = planSVG({ page: planOpt.page });
  if (!svg) { toast('Walk the site, set a property line or mark trees first'); return; }
  const card = $('#modalCard');
  card.classList.add('wide');
  const chk = (k, l) => `<label style="display:flex;gap:6px;align-items:center;margin:0;font-size:14px;color:var(--ink)"><input type="checkbox" data-po="${k}" ${planOpt[k] ? 'checked' : ''} style="width:auto">${l}</label>`;
  card.innerHTML = `<div class="row" style="margin-bottom:8px"><h2 style="margin:0">Site plan</h2><button class="sec" id="plClose" style="flex:0 0 auto">Close</button></div>
    <div class="row" style="flex-wrap:wrap;gap:12px">${chk('contours', 'Contours')}${chk('areas', 'Takeoff items')}${chk('features', 'Features')}${chk('trees', 'Trees')}${chk('walk', 'Walk track')}</div>
    <div id="plSvg" style="background:#fff;border-radius:8px;margin-top:10px;overflow:auto">${svg}</div>
    <div class="row mt" style="align-items:end"><div><label for="plPage">Sheet size</label><select id="plPage"><option value="letter" ${planOpt.page !== 'tabloid' ? 'selected' : ''}>Letter 8½ × 11</option><option value="tabloid" ${planOpt.page === 'tabloid' ? 'selected' : ''}>Tabloid 11 × 17</option></select></div><button class="pri" id="plPdf">Save PDF</button></div>
    <div class="row mt"><button class="sec" id="plExport">Export / email…</button><button class="sec" id="plSave">SVG</button>${CAN_PRINT ? '<button class="sec" id="plPrint">Print</button>' : ''}</div>`;
  card.querySelector('svg').setAttribute('width', '100%'); card.querySelector('svg').removeAttribute('height');
  $('#modal').classList.remove('hidden');
  const close = () => { $('#modal').classList.add('hidden'); card.classList.remove('wide'); };
  $('#plClose').onclick = close;
  card.querySelectorAll('[data-po]').forEach(c => c.onchange = () => { planOpt[c.dataset.po] = c.checked; planDialog(); });
  $('#plPage').onchange = e => { planOpt.page = e.target.value; planDialog(); };
  $('#plSave').onclick = () => shareOrDownload(safeName(P.name) + '_site_plan.svg', planSVG({ page: planOpt.page }), 'image/svg+xml');
  $('#plPdf').onclick = async () => { if (!needPdfLib()) return; const b = $('#plPdf'); b.disabled = true; b.textContent = 'Building…'; try { await shareOrDownload(`${safeName(P.name)}_site_plan_${planOpt.page === 'tabloid' ? '11x17' : 'letter'}.pdf`, await planPDF(planOpt.page), 'application/pdf'); } catch (e) { toast(e.message); } b.disabled = false; b.textContent = 'Save PDF'; };
  $('#plExport').onclick = () => { close(); exportDialog(); };
  if ($('#plPrint')) $('#plPrint').onclick = () => { close(); $('#report').innerHTML = `<div class="plan-page ${planOpt.page === 'tabloid' ? 'tab' : ''}">${planSVG({ page: planOpt.page })}</div>`; window.print(); };
}


// ======================================================================
// Site features (house, driveway, well, fence, shed, pool…)
// ======================================================================
const FEAT = {
  house:    { label: 'House / house site', short: 'House', geoms: ['poly'], sym: 'H', color: '#ff8a65' },
  driveway: { label: 'Driveway', short: 'Driveway', geoms: ['line', 'poly'], sym: 'D', color: '#cfd8dc', width: 12 },
  shed:     { label: 'Shed / garage / barn', short: 'Shed', geoms: ['poly', 'point'], sym: 'B', color: '#ffb74d' },
  pool:     { label: 'Pool', short: 'Pool', geoms: ['poly'], sym: 'P', color: '#4fc3f7' },
  well:     { label: 'Water well', short: 'Well', geoms: ['point'], sym: 'W', color: '#29b6f6' },
  septic:   { label: 'Septic tank / field', short: 'Septic', geoms: ['point', 'poly'], sym: 'S', color: '#bcaaa4' },
  fence:    { label: 'Fence', short: 'Fence', geoms: ['line'], sym: 'F', color: '#fff176' },
  wall:     { label: 'Wall / retaining wall', short: 'Wall', geoms: ['line'], sym: 'R', color: '#e0e0e0' },
  utility:  { label: 'Utility pole / box', short: 'Utility', geoms: ['point'], sym: 'U', color: '#ffd54f' },
  drain:    { label: 'Culvert / drain / swale', short: 'Drain', geoms: ['point', 'line'], sym: 'C', color: '#81d4fa' },
  other:    { label: 'Other feature', short: 'Feature', geoms: ['point', 'line', 'poly'], sym: '•', color: '#e1bee7' }
};
FEAT.tree = { label: 'Tree', short: 'Tree', geoms: ['point'], sym: 'T', color: '#3ddc84' };
FEAT.woods = { label: 'Tree cloud / wooded area', short: 'Wooded area', geoms: ['poly'], sym: '♣', color: '#3ddc84' };
const DENSITY = { light: 'Light brush / scattered trees', medium: 'Medium woods', heavy: 'Heavy woods' };
// Revision-cloud outline: scallops bulging outward along each edge (local ft)
function cloudRing(xy, size) {
  let a2 = 0; for (let i = 0; i < xy.length; i++) { const p = xy[i], q = xy[(i + 1) % xy.length]; a2 += p[0] * q[1] - q[0] * p[1]; }
  const ccw = a2 > 0, out = [];
  for (let i = 0; i < xy.length; i++) {
    const a = xy[i], b = xy[(i + 1) % xy.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L < 1e-6) continue;
    const n = Math.max(1, Math.round(L / size)), ux = (b[0] - a[0]) / L, uy = (b[1] - a[1]) / L;
    const nx = ccw ? uy : -uy, ny = ccw ? -ux : ux, r = L / n / 2;
    for (let k = 0; k < n; k++) {
      const cx = a[0] + ux * r * (2 * k + 1), cy = a[1] + uy * r * (2 * k + 1);
      for (let j = 0; j < 9; j++) { const t = Math.PI * j / 8; out.push([cx - ux * r * Math.cos(t) + nx * r * Math.sin(t), cy - uy * r * Math.cos(t) + ny * r * Math.sin(t)]); }
    }
  }
  return out;
}
const cloudSize = xy => Math.min(40, Math.max(8, courses(xy).reduce((t, c) => t + c.dist, 0) / 32));
const STATUS = { existing: 'Existing', remove: 'Remove', proposed: 'New / add' };
const STATUS_COLOR = { existing: '#2e9e4f', remove: '#e53935', proposed: '#1e6fe0' };   // green / red / blue on the map
const PLAN_COLOR = { existing: '#1b7a3a', remove: '#c62828', proposed: '#1558c0' };
let placeCb = null;
// The description decides the symbol and default pricing (e.g. 12" tree → tree, DBH 12)
const TYPE_WORDS = [
  ['tree', /\b(trees?|oak|maple|pine|cedar|ash|birch|cherry|walnut|poplar|spruce|hickory|sycamore|elm|willow|stump)\b/i],
  ['septic', /\b(septic|leach|drain ?field|tank)\b/i],
  ['driveway', /\b(drive|driveway|paving|asphalt|parking|patio|sidewalk|walkway|concrete pad)\b/i],
  ['house', /\b(house|home|dwelling|residence|cabin|building|addition)\b/i],
  ['shed', /\b(shed|garage|barn|outbuilding|coop|carport|gazebo|deck|playset)\b/i],
  ['pool', /\b(pool|spa|hot ?tub|pond)\b/i],
  ['well', /\bwell\b/i],
  ['fence', /\bfence\b/i],
  ['wall', /\bwalls?\b/i],
  ['utility', /\b(pole|utility|transformer|meter|pedestal|power|light)\b/i],
  ['drain', /\b(culvert|drain|inlet|pipe|swale|ditch|catch ?basin|manhole)\b/i]];
function inferType(desc) { for (const [k, re] of TYPE_WORDS) if (re.test(desc || '')) return k; return 'other'; }
function parseDbh(desc) { const m = String(desc || '').match(/(\d+(?:\.\d+)?)\s*(?:"|”|''|in\b|inch)/i); return m ? parseFloat(m[1]) : null; }
const featName = f => f.label || (f.type === 'woods' ? 'Wooded area' : null) || (f.type === 'tree' && f.dbh ? `${f.dbh}" tree` : (FEAT[f.type] || FEAT.other).short);
const featCanopy = f => f.canopy || (f.dbh ? Math.max(6, Math.round(f.dbh * 1.75)) : 14);
function featUnit(f) { return f.unit || (f.type === 'woods' ? 'AC' : null) || (f.geom === 'point' ? 'EA' : f.geom === 'line' ? (f.type === 'driveway' ? 'SF' : 'LF') : (f.type === 'fence' || f.type === 'wall' ? 'LF' : 'SF')); }
function featQty(f, unit) {
  const xy = f.pts.map(xyOf);
  if (unit === 'EA' || f.geom === 'point') return 1;
  if (unit === 'AC') return G.polyArea(xy) / G.SF_PER_ACRE;
  if (f.geom === 'poly') return unit === 'LF' ? courses(xy).reduce((t, c) => t + c.dist, 0) : G.polyArea(xy);
  return unit === 'SF' ? G.lineLength(xy) * (f.widthFt || 1) : G.lineLength(xy);
}
function defaultFeatPrice(f, unit, demo, $p) {
  if (!demo) return f.type === 'tree' ? $p.treePlant : 0;
  const t = f.type;
  if (t === 'woods') { const per = { light: $p.clearLight, medium: $p.clearMedium, heavy: $p.clearHeavy }[f.density || 'medium'] || 0; return unit === 'AC' ? per : unit === 'SF' ? per / G.SF_PER_ACRE : 0; }
  if (t === 'tree') { const d = f.dbh || 12; return (d < 12 ? $p.treeS : d <= 24 ? $p.treeM : $p.treeL) + ($p.stump || 0); }
  if (['house', 'shed', 'pool'].includes(t)) return unit === 'SF' ? $p.demoSF : unit === 'EA' ? $p.demoEA : 0;
  if (t === 'driveway') return unit === 'SF' ? $p.paveSF : 0;
  if (t === 'fence') return unit === 'LF' ? $p.fenceLF : 0;
  if (t === 'wall') return unit === 'LF' ? $p.wallLF : 0;
  if (t === 'well') return $p.wellAbandon;
  if (t === 'septic') return $p.septicAbandon;
  return 0;
}
function migrateTrees(p) {      // older jobs kept trees separately; they are features now
  if (!p || !p.trees || !p.trees.length) return;
  p.features = p.features || [];
  p.trees.forEach(t => p.features.push({ id: t.id || uid(), type: 'tree', geom: 'point', pts: [[t.lat, t.lon]], label: `${t.dbh ? t.dbh + '" ' : ''}${t.species ? t.species.toLowerCase() + ' ' : ''}tree`, status: t.status === 'remove' ? 'remove' : 'existing', dbh: t.dbh || null, canopy: t.canopy || null, note: t.note || '', price: null, unit: null }));
  p.trees = [];
}
function featSize(f) {
  const xy = f.pts.map(xyOf);
  if (f.type === 'woods') return `${num(G.polyArea(xy) / G.SF_PER_ACRE, 2)} ac · ${(DENSITY[f.density || 'medium'] || '').toLowerCase()}`;
  if (f.geom === 'poly') return num(G.polyArea(xy)) + ' sf';
  if (f.geom === 'line') return num(G.lineLength(xy)) + ' lf' + (f.widthFt ? ` × ${f.widthFt} ft` : '');
  return 'point';
}
function drawFeatures() {
  lyr.feats.clearLayers();
  P.features.forEach(f => {
    const F = FEAT[f.type] || FEAT.other, col = STATUS_COLOR[f.status] || STATUS_COLOR.existing, rm = f.status === 'remove';
    const st = { color: col, weight: 3, dashArray: rm ? '5 4' : null, fillColor: col, fillOpacity: 0.22 };
    const click = e => { if (mapCapturing()) return; if (e && e.originalEvent) L.DomEvent.stopPropagation(e); featureDialog(f); };
    if (f.geom === 'point') {
      if (f.type === 'tree') L.circle(f.pts[0], { radius: featCanopy(f) / 2 / G.M2FT, color: col, weight: 2, dashArray: st.dashArray, fillColor: col, fillOpacity: 0.15 }).addTo(lyr.feats).on('click', click);
      // markers swallow taps, so while placing points pass the tap through to the map
      L.marker(f.pts[0], { icon: L.divIcon({ className: 'featic st-' + f.status, html: rm ? '✕' : esc(F.sym) }) }).addTo(lyr.feats)
        .on('click', e => { if (mapCapturing()) map.fire('click', { latlng: e.latlng }); else click(e); });
    } else if (f.geom === 'line') {
      const parts = [L.polyline(f.pts, st)];
      if (f.widthFt) parts.unshift(L.polygon(G.lineBufferRects(f.pts.map(xyOf), f.widthFt).map(r => r.map(([x, y]) => llOf(x, y))), Object.assign({}, st, { weight: 0 })));
      L.featureGroup(parts).addTo(lyr.feats).on('click', click);
    } else if (f.type === 'woods') {
      const xy = f.pts.map(xyOf), ring = cloudRing(xy, cloudSize(xy)).map(([x, y]) => llOf(x, y));
      L.polygon(ring, Object.assign({}, st, { weight: 2.5, dashArray: null, fillOpacity: 0.2 })).addTo(lyr.feats).on('click', click);
    } else L.polygon(f.pts, st).addTo(lyr.feats).on('click', click);
    const c = f.geom === 'poly' ? llOf(...G.polyCentroid(f.pts.map(xyOf))) : f.pts[Math.floor(f.pts.length / 2)];
    L.tooltip({ permanent: true, direction: f.geom === 'point' ? 'right' : 'center', offset: f.geom === 'point' ? [12, 0] : [0, 0], className: 'alabel', interactive: false })
      .setLatLng(c).setContent(f.type === 'woods' ? `♣ ${esc(featName(f))} · ${num(G.polyArea(f.pts.map(xyOf)) / G.SF_PER_ACRE, 2)} ac${f.status === 'remove' ? ' · clear' : ''}` : esc(featName(f))).addTo(lyr.feats);
  });
}
function choiceBox(title, text, choices) {
  return new Promise(resolve => {
    $('#modalCard').innerHTML = `<h2 style="margin:0 0 6px">${esc(title)}</h2>${text ? `<p class="muted" style="font-size:15px;margin:0 0 12px">${esc(text)}</p>` : ''}<div class="list">` +
      choices.map(([k, l, sub], i) => `<button class="${i === 0 ? 'pri' : 'sec'} choice" data-k="${esc(k)}"><span>${esc(l)}</span>${sub ? `<small>${esc(sub)}</small>` : ''}</button>`).join('') + '</div>';
    $('#modal').classList.remove('hidden');
    $('#modalCard').querySelectorAll('[data-k]').forEach(b => b.onclick = () => { $('#modal').classList.add('hidden'); resolve(b.dataset.k); });
  });
}
// "+ Add feature" drop-down: Single point or Outline
function closeAddMenu() { const m = document.getElementById('addMenu'); if (m) m.remove(); document.removeEventListener('pointerdown', addMenuOutside, true); }
function addMenuOutside(e) { const m = document.getElementById('addMenu'); if (m && !m.contains(e.target)) closeAddMenu(); }
function openAddMenu(anchor) {
  if (document.getElementById('addMenu')) { closeAddMenu(); return; }
  const r = anchor.getBoundingClientRect(), w = 270;
  const m = document.createElement('div'); m.id = 'addMenu'; m.setAttribute('role', 'menu');
  m.innerHTML = `<button role="menuitem" data-g="point"><i>●</i><span><b>Single</b><small>One spot: tree, well, pole, stump…</small></span></button>
    <button role="menuitem" data-g="poly"><i>▱</i><span><b>Outline</b><small>Corners: house, shed, pool, drive, patio…</small></span></button>
    <button role="menuitem" data-g="cloud"><i>☁</i><span><b>Tree cloud</b><small>Outline a stand of trees to clear or keep</small></span></button>`;
  document.body.appendChild(m);
  const left = Math.min(Math.max(8, r.right - w), window.innerWidth - w - 8);
  let top = r.bottom + 6; if (top + 210 > window.innerHeight) top = Math.max(8, r.top - 216);
  Object.assign(m.style, { left: left + 'px', top: top + 'px', width: w + 'px' });
  m.querySelectorAll('[data-g]').forEach(b => b.onclick = () => { closeAddMenu(); addFeatureFlow(b.dataset.g); });
  setTimeout(() => document.addEventListener('pointerdown', addMenuOutside, true), 0);
  m.querySelector('button').focus();
}
async function addFeatureFlow(geom) {
  const cloud = geom === 'cloud'; if (cloud) geom = 'poly';
  const finish = async pts => {
    const f = { id: uid(), type: cloud ? 'woods' : 'other', geom, pts, label: '', status: cloud ? 'remove' : 'existing', note: '', price: null, unit: null };
    if (cloud) { f.cloud = true; f.density = 'medium'; }
    if (await featureDialog(f, true)) { P.features.push(f); save(); drawFeatures(); render(); toast(`${featName(f)} added (${STATUS[f.status]})`); }
  };
  if (geom === 'point') {
    const k = await choiceBox('Locate the feature', 'Stand at it, or find it on the map.', [['gps', '📍 Where I’m standing', 'Uses your GPS position'], ['tap', 'Tap it on the map', ''], ['cancel', 'Cancel', '']]);
    if (k === 'gps') { toast('Hold still… averaging GPS', 2200); const fx = await averageFix(2000); if (needFix(fx)) finish([[fx.lat, fx.lon]]); }
    else if (k === 'tap') { placeCb = ll => finish([ll]); $('#sheet').classList.add('collapsed'); toast('Tap the map where it is'); }
  } else if (cloud) startDraw('poly', finish, 'Tree cloud: tap around the edge of the trees, or walk the edge tapping Mark point', { gps: true, noun: 'point' });
  else startDraw('poly', finish, 'Outline: walk to each corner and tap Mark corner, or tap the corners on the map', { gps: true, noun: 'corner' });
}
// Description + Existing / Remove / New popup
function featureDialog(f, isNew) {
  return new Promise(resolve => {
    let status = f.status || 'existing';
    const card = $('#modalCard'), oldLabel = f.label || '';
    const canEst = !isNew;

    const cl = f.type === 'woods'; let density = f.density || 'medium';
    card.innerHTML = `<h2 style="margin:0 0 2px">${cl ? 'Tree cloud' : isNew ? 'Describe the feature' : 'Edit feature'}</h2>
      <div class="muted">${f.geom === 'point' ? 'Single point' : cl ? featSize(f).split(' · ')[0] : 'Outline · ' + featSize(f)}</div>
      <label for="fdDesc">Description</label>
      <input id="fdDesc" value="${esc(oldLabel)}" placeholder='${cl ? 'e.g. Wooded area, pines along north line' : 'e.g. 12" tree, shed, well, chain-link fence'}' enterkeyhint="done" autocomplete="off">
      ${cl ? `<label id="fdDnLbl">How dense?</label><div class="seg" role="radiogroup" aria-labelledby="fdDnLbl">${Object.entries({ light: 'Light', medium: 'Medium', heavy: 'Heavy' }).map(([k, l]) => `<button type="button" role="radio" data-dn="${k}" class="${k === density ? 'on' : ''}" aria-checked="${k === density}">${l}</button>`).join('')}</div><div class="muted" style="margin-top:4px">Light = brush &amp; scattered trees · Heavy = dense mature woods. Sets the clearing price per acre.</div>` : ''}
      <label id="fdStLbl">Status</label>
      <div class="stsel" role="radiogroup" aria-labelledby="fdStLbl">${['existing', 'remove', 'proposed'].map(k => `<button type="button" role="radio" data-st="${k}" class="st-${k}${k === status ? ' on' : ''}" aria-checked="${k === status}"><i></i>${STATUS[k]}</button>`).join('')}</div>
      <div class="muted" id="fdHint" style="margin-top:6px"></div>
      ${isNew ? '' : `<div class="row mt"><button class="sec" id="fdMove" type="button">${f.geom === 'point' ? 'Move' : 'Redraw'}</button>${canEst ? `<button class="sec" id="fdEst" type="button">＋ Takeoff</button>` : ''}<button class="dng" id="fdDel" type="button">Delete</button></div>`}
      <div class="row" style="margin-top:16px"><button class="sec" id="fdCancel" type="button">Cancel</button><button class="pri" id="fdOk" type="button">${isNew ? 'Add to site' : 'Save'}</button></div>`;
    $('#modal').classList.remove('hidden');
    card.querySelectorAll('[data-dn]').forEach(b => b.onclick = () => { density = b.dataset.dn; card.querySelectorAll('[data-dn]').forEach(x => { x.classList.toggle('on', x === b); x.setAttribute('aria-checked', String(x === b)); }); });
    const hint = () => { if (cl) { $('#fdHint').textContent = status === 'remove' ? 'Red cloud, to be cleared. Price it with a Clear & grub line on the Takeoff tab (＋ Takeoff).' : status === 'proposed' ? 'Blue cloud, new planting.' : 'Green cloud. Trees to remain, shown on the map and drawing.'; return; } $('#fdHint').textContent = status === 'remove' ? 'Red on the map and drawing. Features are reference marks — price the work on the Takeoff tab.' : status === 'proposed' ? 'Blue on the map and drawing. Price the work on the Takeoff tab.' : 'Green on the map. Shown on the drawing only.'; };
    hint();
    card.querySelectorAll('[data-st]').forEach(b => b.onclick = () => { status = b.dataset.st; card.querySelectorAll('[data-st]').forEach(x => { x.classList.toggle('on', x === b); x.setAttribute('aria-checked', String(x === b)); }); hint(); });
    const close = v => { $('#modal').classList.add('hidden'); resolve(v); };
    $('#fdCancel').onclick = () => close(false);
    $('#fdOk').onclick = () => {
      const d = $('#fdDesc').value.trim();
      if (!cl && (d !== oldLabel || isNew)) { f.type = inferType(d); if (f.type === 'tree') f.dbh = parseDbh(d); f.price = null; }
      if (f.status !== status || (cl && f.density !== density)) f.price = null;
      if (cl) f.density = density;
      f.label = d; f.status = status;
      if (!isNew) { save(); drawFeatures(); render(); }
      close(true);
    };
    $('#fdDesc').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); $('#fdDesc').blur(); } });
    if (!isNew) {
      $('#fdDel').onclick = () => { P.features = P.features.filter(x => x !== f); save(); drawFeatures(); render(); close(false); toast('Feature deleted'); };
      $('#fdMove').onclick = () => {
        close(false);
        if (f.geom === 'point') { placeCb = ll => { f.pts = [ll]; save(); drawFeatures(); render(); }; $('#sheet').classList.add('collapsed'); toast('Tap the new spot on the map'); }
        else startDraw(f.geom === 'line' ? 'line' : 'poly', pts => { f.pts = pts; save(); drawFeatures(); render(); }, `Redraw ${featName(f)}`, { gps: true, noun: f.geom === 'line' ? 'point' : 'corner' });
      };
      if (canEst) $('#fdEst').onclick = () => { close(false); featureToLine(f); };
    } else setTimeout(() => $('#fdDesc').focus(), 60);
  });
}
function featureToArea(f) {
  let a;
  if (f.type === 'house') { createPad(f.pts.slice(), featName(f) + ' pad'); return; }
  if (f.type === 'driveway') { const m = store.materials['Crusher run / ABC']; a = { id: uid(), type: 'gravel', geom: f.geom, pts: f.pts.slice(), name: featName(f), p: { material: 'Crusher run / ABC', depthIn: 6, compactPct: 15, density: m.density, price: m.price, fabric: false, widthFt: f.widthFt || 12 } }; }
  else a = { id: uid(), type: 'cutfill', geom: 'poly', pts: f.pts.slice(), name: featName(f) + ' pad', p: { design: 'flat', elev: null, balance: true, slopePct: 1, slopeDir: 0, sectionIn: 4, stripIn: 6 } };
  P.areas.push(a); save(); openArea(a.id); toast('Grading area added to the estimate');
}
function featuresHtml() {
  const row = f => `<button class="item" data-feat="${f.id}"><div class="sw" style="background:${STATUS_COLOR[f.status]};border-radius:${f.geom === 'point' ? '50%' : '4px'}"></div><div class="t"><b>${esc(featName(f))}</b><small>${f.geom === 'point' ? 'Single' : f.type === 'woods' ? 'Tree cloud · ' + featSize(f) : 'Outline · ' + featSize(f)}</small></div>›</button>`;
  const sec = (k, title) => { const fs = P.features.filter(f => f.status === k); return fs.length ? `<h3>${title} (${fs.length})</h3><div class="list">${fs.map(row).join('')}</div>` : ''; };
  return `<h2>Site features</h2>
  ${!P.boundary ? `<div class="warn">Set the property boundary first, then mark what’s on the property.<button class="sec" id="fxBnd" style="margin-top:8px;width:100%">Set boundary</button></div>` : ''}
  <button class="pri big" id="fxAdd" style="width:100%" aria-haspopup="menu">＋ Add feature ▾</button>
  <div class="stkey"><span><i class="st-existing"></i>Existing</span><span><i class="st-remove"></i>Remove</span><span><i class="st-proposed"></i>New</span></div>
  ${sec('proposed', 'New / add')}${sec('remove', 'Remove')}${sec('existing', 'Existing')}
  ${P.features.length ? '<button class="sec mt" id="fxPlan" style="width:100%">📐 View site plan</button>' : '<p class="muted">Nothing marked yet. Tap Add feature, choose Single or Outline, then locate it on the map.</p>'}`;
}

// ======================================================================
// Opening flow: start where the user is standing, then lay out the boundary
// ======================================================================
async function setupBoundary() {
  const k = await choiceBox('Lay out the property', 'Start with the working boundary. How do you want to capture it?', [
    ['corners', '📍 Walk to the corners', 'Stand on each corner and tap Mark corner. Best for straight lines.'],
    ['trace', '〰 Trace the boundary', 'Walk the line and the app follows your phone. Best for curved or irregular edges.'],
    ['map', '✎ Draw it on the map', 'Tap the corners on the satellite image. No walking.'],
    ['skip', 'Not now', '']]);
  if (k === 'corners') startDraw('poly', pts => { P.boundary = pts; afterBoundary(); }, 'Walk to a property corner, stand on it, then tap Mark corner', { gps: true, noun: 'corner' });
  else if (k === 'trace') traceBoundary();
  else if (k === 'map') startDraw('poly', pts => { P.boundary = pts; afterBoundary(); }, 'Tap each property corner on the map');
}
async function afterBoundary() {
  ui.editBnd = false; drawBoundary(); save();
  const xy = P.boundary.map(xyOf), A = G.polyArea(xy), per = courses(xy).reduce((t, c) => t + c.dist, 0);
  map.fitBounds(L.latLngBounds(P.boundary).pad(0.25), { maxZoom: 20 });
  render();
  if (!P.surface || !G.covers(P.surface, xy)) { setTab('site'); await buildSurface(); }
  if (P.surface && !contoursOn) toggleContours();
  ui.flow = false; flowCheck();
  toast(`Boundary set · ${num(A / G.SF_PER_ACRE, 2)} ac · ${num(per)} ft around${P.surface ? ' · contours on' : ''}`, 4000);
  openTakeoffEntry();
}
// ======================================================================
// Start screen → boundary → takeoff items, the way it's used in the field
// ======================================================================
function showSplash() {
  $('#spOpen').hidden = !store.projects.some(p => !projectEmpty(p));
  $('#splash').classList.remove('hidden');
}
$('#spStart').onclick = async () => {
  let name = '';
  for (;;) {
    const v = await form('New takeoff', [{ key: 'name', label: 'Project name', value: name, placeholder: 'e.g. Smith residence, Lot 4', help: 'Shows on the takeoff, drawing, proposal and emails. You can change it later.' }], 'Start');
    if (!v) return;
    name = (v.name || '').trim();
    if (name) break;
    toast('Type a project name to start', 3000);
  }
  $('#splash').classList.add('hidden');
  startTakeoffFlow(name);
};
$('#spOpen').onclick = () => { $('#splash').classList.add('hidden'); if (!P.boundary) onOpen(); else fitAll(); projectsDialog(); };
function startTakeoffFlow(name) {
  name = name || 'Takeoff ' + new Date().toLocaleDateString();
  if (!projectEmpty()) { const p = newProject(name); p.view = P.view; store.projects.unshift(p); switchProject(p.id); }
  else { P.name = name; save(true); render(); }
  if (!EMBED) { const sat = Object.keys(baseLayers)[0]; if (baseName !== sat) { map.removeLayer(baseLayers[baseName]); baseName = sat; baseLayers[sat].addTo(map); baseLayers[sat].bringToBack(); } labelsLayer.addTo(map); }
  setTab('site'); $('#sheet').classList.add('collapsed');
  ui.flow = true; flowCheck();
  onOpen();
}
function flowCheck() {
  const on = !!ui.flow && !P.boundary && !draw.on && !walk.active && $('#splash').classList.contains('hidden');
  document.body.classList.toggle('flow', on);
}
$('#flowGo').onclick = async () => {
  const k = await choiceBox('Mark the area / property boundary', 'How do you want to mark it?', [
    ['corners', '📍 Click corners', 'Walk to each corner and tap Mark corner, or tap the corners on the map.'],
    ['trace', '👣 Have the app trace my steps', 'Walk the line and the app follows your phone, then straightens it out.'],
    ['cancel', 'Cancel', '']]);
  if (k === 'corners') startDraw('poly', pts => { P.boundary = pts; afterBoundary(); }, 'Walk to a corner and tap Mark corner, or tap the corners on the map', { gps: true, noun: 'corner' });
  else if (k === 'trace') traceBoundary();
  flowCheck();
};
$('#flowSkip').onclick = () => { ui.flow = false; flowCheck(); openTakeoffEntry(); };
function openTakeoffEntry() {
  ui.lineId = null; ui.ni = null;
  setTab('takeoff'); $('#sheet').classList.add('full');
}

function projectEmpty(p = P) { return !(p.boundary && p.boundary.length) && !p.walks.length && !(p.areas || []).length && !(p.lines || []).length && !(p.trees || []).length && !(p.features || []).length; }
async function onOpen() {
  const empty = projectEmpty();
  if (empty) toast('Finding your location…', 3000);
  const f = await locateOnce(15000);
  if (f) {
    const site = (P.boundary && P.boundary[0]) || P.pin;
    const near = !site || Math.hypot(...G.toXY(f.lat, f.lon, { lat0: site[0], lon0: site[1] })) < 2640;
    if (empty) { map.setView([f.lat, f.lon], 19); if (!P.origin) P.origin = { lat0: f.lat, lon0: f.lon }; save(); }
    else if (near) map.setView([f.lat, f.lon], Math.max(map.getZoom(), 19));
  } else if (empty) toast('Location is off. Search an address on the Site tab, or allow Location to start where you’re standing.', 5000);
  if (!P.boundary) { ui.flow = true; flowCheck(); }
}


// ======================================================================
// Cost build-up — one-man crew, rented equipment. Starting rates researched for
// Dahlonega, GA (Lumpkin County), Nov 2026; every number is editable.
// Line = quantity ÷ production rate → operator hours → labor $ and fuel;
// rented machines are priced by the day / week / 4-week for the days on rent,
// then spread back over the lines that use them.
// ======================================================================
const RATES_V = 3;
const DEFAULT_RATES = {
  v: RATES_V, region: 'Dahlonega, GA (Lumpkin County)',
  operator: 30, burdenPct: 20, hrsPerDay: 8,      // owner-operator; burden = self-employment tax, comp, liability
  fuel: 6.00,                                    // $/gal off-road diesel
  ohPct: 15, profitPct: 12,
  waiverPct: 12, rentTaxPct: 8,                  // rental damage waiver; Lumpkin County sales tax 8%
  truckCycleHr: 1.25, dumpFee: 150, dirtDumpFee: 0,
  debris: 'haul',                                // haul | pile | burn
  seedSlopes: true, laborBasis: 'higher',        // higher | items | schedule
  seedPrice: 1.80, seedRate: 7,                  // KY-31 fescue $/lb (≈$90 / 50 lb), lb per 1,000 SF
  fertBag: 27, fertRate: 20,                     // 10-10-10 $/50-lb bag, lb per 1,000 SF
  limeBag: 8, limeRate: 50,                      // pelletized lime $/40-lb bag, lb per 1,000 SF
  strawBale: 16.49, strawRate: 2,                // wheat straw $/bale, bales per 1,000 SF
  haulRate: 110                                  // hired dump truck with driver, $/hr
};
// Equipment list — saved on the phone and reused on every takeoff. roles: dig / grade / trench / support.
// speed = production vs. the main machine for that kind of work (100 = full speed).
const DEFAULT_EQUIP = [
  { id: 'truck',    name: 'Silverado 2500 Truck',          hour: 25,  day: 150, week: 600,  burn: 1.5, deliver: 0,   rented: false, on: true,  roles: ['support'], speed: 100 },
  { id: 'trailerS', name: 'Small trailer',  hour: 12,  day: 60,  week: 250,  burn: 0,   deliver: 0,   rented: false, on: false, roles: ['support'], speed: 100 },
  { id: 'trailerL', name: 'Large Gooseneck trailer',  hour: 20,  day: 110, week: 450,  burn: 0,   deliver: 0,   rented: false, on: true,  roles: ['support'], speed: 100 },
  { id: 'tractor',  name: 'Kubota Tractor',        hour: 40,  day: 250, week: 900,  burn: 1.5, deliver: 0, rented: false,  on: false, roles: ['grade'], speed: 40 },
  { id: 'mini',     name: 'Kubota KX-040 Mini excavator', hour: 70,  day: 450, week: 1500, burn: 2.0, deliver: 0, rented: false,  on: true,  roles: ['dig', 'grade', 'trench'], speed: 45 },
  { id: 'exc',      name: 'Kubota KX80 Excavator',      hour: 135, day: 850, week: 2400, burn: 3.5, deliver: 0, rented: false,  on: true,  roles: ['dig'], speed: 100 },
  { id: 'dozer',    name: 'Case Bulldozer',      hour: 100, day: 650, week: 1500, burn: 4.0, deliver: 250, rented: true,  on: true,  roles: ['grade'], speed: 100 },
  { id: 'trencher', name: 'Trencher',       hour: 45,  day: 280, week: 980,  burn: 1.5, deliver: 0, rented: false,  on: true,  roles: ['trench'], speed: 100 },
  { id: 'bobcat',   name: 'Bobcat T76',         hour: 60,  day: 375, week: 1150, burn: 2.5, deliver: 150, rented: true,  on: false, roles: ['grade'], speed: 60 },
  { id: 'skid',     name: 'Kubota SCL1000 Skid Steer',     hour: 50,  day: 300, week: 950,  burn: 2.0, deliver: 0, rented: false,  on: false, roles: ['grade'], speed: 50 }
];
const ROLE_LABEL = { dig: 'Digging & clearing', grade: 'Grading & spreading', trench: 'Trenching', support: 'Truck / trailer / support' };
// v2 names the actual machines. Saved lists that still use the old generic names get the new names; prices and edits are kept.
const EQUIP_V = 4, EQUIP_OLD_NAMES = { truck: 'Truck', trailerL: 'Large trailer', tractor: 'Tractor', mini: 'Mini excavator', exc: 'Excavator', dozer: 'Bulldozer', skid: 'Skid steer', bobcat: 'Bobcat' };
function equipList() {
  if (!Array.isArray(store.equipList) || !store.equipList.length) { store.equipList = clone(DEFAULT_EQUIP); store.equipV = EQUIP_V; }
  if (store.equipV !== EQUIP_V) {
    store.equipList.forEach(e => { const d = DEFAULT_EQUIP.find(x => x.id === e.id); if (d && EQUIP_OLD_NAMES[e.id] && e.name === EQUIP_OLD_NAMES[e.id]) e.name = d.name; });
    // v3: everything is owned except the bulldozer and Bobcat; owned machines are hauled on your own trailer (no delivery charge)
    const OLD_DELIVER = { tractor: 150, mini: 200, exc: 350, trencher: 150, skid: 150 };
    if ((store.equipV || 1) < 3) store.equipList.forEach(e => { if (OLD_DELIVER[e.id] != null && e.rented) { e.rented = false; if (+e.deliver === OLD_DELIVER[e.id]) e.deliver = 0; } });
    store.equipV = EQUIP_V;
  }
  return store.equipList;
}
const eqById = id => equipList().find(e => e.id === id) || null;
function equipOn(e) { return P.equipOn && Object.prototype.hasOwnProperty.call(P.equipOn, e.id) ? !!P.equipOn[e.id] : !!e.on; }
// Best checked machine for a kind of work (fastest, then cheapest); falls back to the full list and flags it
function pickMachine(role) {
  const all = equipList().filter(e => (e.roles || []).includes(role));
  const on = all.filter(equipOn), pool = on.length ? on : all;
  const best = pool.slice().sort((a, b) => (b.speed || 100) - (a.speed || 100) || (a.day || 0) - (b.day || 0))[0] || null;
  return { e: best, missing: !on.length };
}
const SEC = { mob: 'Mobilization', clear: 'Clearing & demolition', earth: 'Earthwork', util: 'Utilities', top: 'Topsoil', stone: 'Driveway & stone', grass: 'Grassing', other: 'Other / allowances', sched: 'Schedule' };
const SEC_ORDER = [SEC.mob, SEC.clear, SEC.earth, SEC.util, SEC.top, SEC.stone, SEC.grass, SEC.other, SEC.sched];
// prod = units per operator-hour (0 = material only); equip = machine key; crew 0 = no operator time (hired truck)
const ASM = {
  deliver:     { name: 'Equipment delivery & pickup', unit: 'TRIP', prod: 0, crew: 0, mat: 0, lockProd: true },
  support:     { name: 'Support equipment', unit: 'LS', prod: 0, crew: 0, mat: 0, lockProd: true },
  treeS:       { name: 'Remove trees under 12" DBH — push over & dig out', unit: 'EA', prod: 4, role: 'dig', loads: 0.15 },
  treeM:       { name: 'Remove trees 12–24" DBH — push over & dig out', unit: 'EA', prod: 2, role: 'dig', loads: 0.4 },
  treeL:       { name: 'Remove trees over 24" DBH — push over & dig out', unit: 'EA', prod: 0.8, role: 'dig', loads: 1 },
  clearLight:  { name: 'Clear & grub, light brush / scattered trees', unit: 'AC', prod: 0.125, role: 'dig', loads: 4 },
  clearMedium: { name: 'Clear & grub, medium woods', unit: 'AC', prod: 0.06, role: 'dig', loads: 10 },
  clearHeavy:  { name: 'Clear & grub, heavy woods', unit: 'AC', prod: 0.035, role: 'dig', loads: 18 },
  demoSF:      { name: 'Demolish structure', unit: 'SF', prod: 300, role: 'dig', loads: 0.004 },
  demoEA:      { name: 'Demolish small structure', unit: 'EA', prod: 0.5, role: 'dig', loads: 2 },
  pave:        { name: 'Remove paving', unit: 'SF', prod: 600, role: 'dig', loads: 0.0025 },
  fence:       { name: 'Remove fence', unit: 'LF', prod: 100, role: 'dig', loads: 0.004 },
  wall:        { name: 'Remove wall', unit: 'LF', prod: 20, role: 'dig', loads: 0.05 },
  loadOut:     { name: 'Load trucks', unit: 'LOAD', prod: 4, role: 'dig' },
  debris:      { name: 'Haul off debris (hired truck + dump fee)', unit: 'LOAD', prod: 0.8, hire: true, crew: 0, mat: 150, lockProd: true },
  cut:         { name: 'Excavate (cut) & place on site', unit: 'CY', prod: 30, role: 'grade' },
  fill:        { name: 'Place & track-compact fill in lifts', unit: 'CY', prod: 25, role: 'grade' },
  finePad:     { name: 'Fine grade building pad', unit: 'SF', prod: 2000, role: 'grade' },
  import:      { name: 'Fill dirt, delivered', unit: 'CY', prod: 0, crew: 0, mat: 25 },
  export:      { name: 'Haul off excess dirt (hired truck)', unit: 'LOAD', prod: 0.8, hire: true, crew: 0, mat: 0, lockProd: true },
  trench:      { name: 'Trench & backfill', unit: 'LF', prod: 100, role: 'trench' },
  strip:       { name: 'Strip & stockpile topsoil', unit: 'CY', prod: 40, role: 'grade' },
  respread:    { name: 'Respread topsoil & fine grade', unit: 'CY', prod: 30, role: 'grade' },
  tsImport:    { name: 'Topsoil, delivered', unit: 'CY', prod: 0, crew: 0, mat: 40 },
  stone:       { name: 'Stone, delivered', unit: 'TON', prod: 0, crew: 0, mat: 32 },
  spreadStone: { name: 'Spread & compact stone', unit: 'TON', prod: 25, role: 'grade' },
  fabric:      { name: 'Geotextile fabric, by hand', unit: 'SY', prod: 400, mat: 0.85 },
  seed:        { name: 'Seed, fertilize, lime & straw — by hand', unit: 'MSF', prod: 2, mat: null },
  plant:       { name: 'Plant tree', unit: 'EA', prod: 1, role: 'dig', mat: 250 },
  allow:       { name: 'Allowance', unit: 'LS', prod: 0, crew: 0, mat: 0, lockProd: true },
  adjust:      { name: 'Labor adjustment to your schedule', unit: 'LS', prod: 0, crew: 0, mat: 0, lockProd: true }
};
function normRates(r) {
  const base = clone(DEFAULT_RATES);
  const st = store.rates && store.rates.v === RATES_V ? clone(store.rates) : null;
  const pr = r && r.v === RATES_V ? r : null;
  const out = Object.assign(base, st || {}, pr || {});
  delete out.equip;
  out.v = RATES_V;
  return out;
}
const seedMatPerMSF = R => R.seedPrice * R.seedRate + R.fertBag / 50 * R.fertRate + R.limeBag / 40 * R.limeRate + R.strawBale * R.strawRate;
function asmOf(id) {
  const A = Object.assign({}, ASM[id], (P.asm && P.asm[id]) || {}), R = P.rates;
  if (A.role) {
    const pk = pickMachine(A.role);
    A.equip = pk.e ? pk.e.id : null; A.missing = pk.missing;
    if (pk.e && (pk.e.speed || 100) !== 100 && !(P.asm && P.asm[id] && P.asm[id].prod)) A.prod = A.prod * (pk.e.speed || 100) / 100;
  }
  if (id === 'seed' && A.mat == null) A.mat = seedMatPerMSF(R);
  const MK = { import: 'fill', tsImport: 'topsoil', stone: 'stone', fabric: 'fabric' }[id];
  if (MK && !(P.asm && P.asm[id] && P.asm[id].mat != null)) A.mat = matPrice(MK);
  if (A.crew == null) A.crew = 1;
  return A;
}
function costRow(sec, id, desc, qty, extra) {
  extra = extra || {};
  const A = asmOf(id), R = P.rates;
  const prod = extra.prod != null ? extra.prod : A.prod, mat = extra.mat != null ? extra.mat : (A.mat || 0);
  const hrs = prod > 0 ? qty / prod : 0;
  const crewRate = A.crew * R.operator * (1 + R.burdenPct / 100);
  const eq = A.equip ? eqById(A.equip) : null, hire = !!A.hire;
  const labor = hrs * crewRate, gal = eq ? hrs * (+eq.burn || 0) : 0, fuel = gal * R.fuel, matT = qty * mat;
  const equip = hire ? hrs * (+R.haulRate || 0) : 0;   // machine costs are added once hours and days are known
  return { sec, asm: id, desc, qty, unit: extra.unit || A.unit, prod, hrs, opHrs: A.crew ? hrs : 0, crewRate, labor, equip, gal, fuel, mat, matT, total: labor + equip + fuel + matT,
    machine: A.equip || null, hire, matRef: extra.matRef || { asm: id }, lockProd: !!(A.lockProd || extra.lockProd), lockMat: !!extra.lockMat,
    crewTxt: A.crew ? 'operator' : '', eqTxt: hire ? 'Hired dump truck' : eq ? eq.name + (A.missing ? ' — not checked for this job' : '') : (A.crew ? 'by hand' : ''), missing: !!(eq && A.missing), group: sec, scope: extra.scope || null };
}
// Delivery & pickup for one job: what you typed for this job, else the machine's charge (one-time, or each way × 2)
function delivOf(e) {
  const o = P.sched && P.sched.deliv && P.sched.deliv[e.id];
  return o != null ? +o : e.delivOnce ? (+e.deliver || 0) : (+e.deliver || 0) * 2;
}
// Machine cost by the hour, the day, or the week (5-day weeks); 'auto' takes the cheapest
function billCost(e, hrs, days, basis) {
  const H = Math.max(0, hrs || 0), D = Math.max(0, Math.ceil((days || 0) - 1e-9));
  const w = Math.floor(D / 5), d = D - w * 5, capped = d && d * e.day >= e.week;
  const opts = { hour: e.hour > 0 ? H * e.hour : Infinity, day: e.day > 0 ? D * e.day : Infinity, week: e.week > 0 ? w * e.week + (d ? Math.min(d * (e.day || Infinity), e.week) : 0) : Infinity };
  // rental yards bill rented machines by the day at minimum, so 'cheapest' only uses hourly for owned equipment
  const pool = e.rented ? ['day', 'week'] : ['hour', 'day', 'week'];
  let b = basis && basis !== 'auto' && isFinite(opts[basis]) ? basis : pool.reduce((a, k) => opts[k] < opts[a] ? k : a, 'day');
  if (!isFinite(opts[b])) return { cost: 0, how: '—', basis: b };
  const how = b === 'hour' ? `${num(H, 1)} hr × $${num(e.hour)}` : b === 'day' ? `${D} day${D === 1 ? '' : 's'} × $${num(e.day)}`
    : [w + (capped ? 1 : 0) ? `${w + (capped ? 1 : 0)} wk` : '', d && !capped ? `${d} day${d > 1 ? 's' : ''}` : ''].filter(Boolean).join(' + ');
  return { cost: opts[b], how, basis: b };
}
function estimate() {
  P.rates = normRates(P.rates);
  if (P.asmV !== RATES_V) { P.asm = {}; P.asmV = RATES_V; }
  P.sched = P.sched || { days: null, rent: {} }; P.sched.rent = P.sched.rent || {}; P.sched.basis = P.sched.basis || {}; P.sched.deliv = P.sched.deliv || {};
  const R = P.rates, F = P.factors, rows = [], notes = [];
  const push = r => { if (r.qty > 1e-6 || r.asm === 'allow' || r.asm === 'adjust') rows.push(r); return r; };
  // --- the takeoff lines: each one measured on the map (or typed), priced with its own machine and rate
  let loads = 0, cut = 0, need = 0, slopesSF = 0;
  const crew = R.operator * (1 + R.burdenPct / 100), unmeasured = [];
  const lineRow = (Ln, desc, qty, unit, prod, mat, x) => {
    x = x || {};
    const eq = x.noEquip || !Ln.equip ? null : eqById(Ln.equip), n = lineNo(Ln);
    const hrs = prod > 0 ? qty / prod : 0, labor = hrs * crew, gal = eq ? hrs * (+eq.burn || 0) : 0, fuel = gal * R.fuel, matT = qty * (mat || 0);
    return { sec: SECKEY[Ln.sec] || SEC.other, asm: x.asm || 'line', desc: `#${n} ${desc}`, qty, unit, prod, hrs, opHrs: hrs, crewRate: crew, labor, equip: 0, gal, fuel, mat: mat || 0, matT, total: labor + fuel + matT,
      machine: eq ? eq.id : null, hire: false, matRef: x.matRef || (Ln.matKey && matDef(Ln.matKey) ? { mk: Ln.matKey } : { line: Ln.id }), prodRef: x.prodRef === null ? null : (x.prodRef || { line: Ln.id, key: 'prod' }), lockProd: x.prodRef === null, lockMat: !!x.lockMat,
      crewTxt: prod > 0 ? 'operator' : '', eqTxt: eq ? eq.name + (equipOn(eq) ? '' : ' — not checked for this job') : (prod > 0 ? 'by hand' : ''), missing: !!(eq && !equipOn(eq)), lineId: Ln.id, lineNo: n };
  };
  (P.lines || []).forEach(Ln => {
    const q = lineQty(Ln), p = Ln.params || {}, mat = Ln.matKey && matDef(Ln.matKey) ? matPrice(Ln.matKey) : Ln.mat, C = CALC[Ln.calc] || CALC.ls;
    if (C.geom && !q.measured && Ln.typed == null) { unmeasured.push(Ln); return; }
    if (Ln.loads && Ln.calc !== 'pad' && Ln.calc !== 'grade') loads += q.qty * Ln.loads;
    if (Ln.calc === 'pad') {
      const v = q.pad; if (!v) { unmeasured.push(Ln); return; }
      push(lineRow(Ln, `${Ln.desc} — excavate (cut) & place`, v.cutCY, 'CY', Ln.prod, 0, { lockMat: true }));
      push(lineRow(Ln, `${Ln.desc} — place & compact fill (${num(v.fillCY)} CY + ${p.extraPct}%)`, v.dirtCY, 'CY', Ln.prod, 0, { lockMat: true }));
      if (p.fineGrade !== false) push(lineRow(Ln, `${Ln.desc} — fine grade pad`, v.padArea, 'SF', p.fineProd || 2000, 0, { lockMat: true, prodRef: { line: Ln.id, key: 'fineProd', param: true } }));
      cut += v.cutCY; need += v.dirtCY; slopesSF += Math.max(0, v.disturbedArea - v.padArea);
    } else if (Ln.calc === 'grade') {
      const v = q.grade; if (!v) { unmeasured.push(Ln); return; }
      push(lineRow(Ln, `${Ln.desc} — excavate (cut) & place`, v.cutCY, 'CY', Ln.prod, 0, { lockMat: true }));
      push(lineRow(Ln, `${Ln.desc} — place & compact fill`, v.fillBankCY, 'CY', Ln.prod, 0, { lockMat: true }));
      cut += v.cutCY; need += v.fillBankCY;
    } else if (Ln.calc === 'stone') {
      push(lineRow(Ln, `${Ln.desc} ${num(p.depthIn)}", delivered`, q.qty, 'TON', 0, mat, { noEquip: true, prodRef: null }));
      push(lineRow(Ln, `${Ln.desc} — spread & compact`, q.qty, 'TON', Ln.prod, 0, { lockMat: true }));
      if (q.fabricSY) push(lineRow(Ln, `${Ln.desc} — geotextile fabric, by hand`, q.fabricSY, 'SY', 400, matPrice('fabric'), { noEquip: true, prodRef: null, matRef: { mk: 'fabric' } }));
    } else if (Ln.calc === 'ls') push(lineRow(Ln, Ln.desc, 1, 'LS', 0, mat || 0, { asm: 'allow', noEquip: true, prodRef: null }));
    else if (Ln.calc === 'hrs') push(lineRow(Ln, Ln.desc, q.qty, 'HR', 1, mat || 0, { prodRef: null }));
    else {
      let desc = Ln.desc;
      if (Ln.calc === 'lf' && p.purpose != null && !desc.toLowerCase().includes(String(p.purpose).toLowerCase())) desc += ` — ${String(p.purpose || 'utility').toLowerCase()}`;
      if (Ln.calc === 'lf' && p.depthIn) desc += `, ${num(p.depthIn)}" deep`;
      if (Ln.calc === 'cyDepth') desc += `, ${num(p.depthIn)}" deep`;
      push(lineRow(Ln, desc, q.qty, q.unit, Ln.prod, mat == null ? (Ln.calc === 'msf' ? seedMatPerMSF(R) : 0) : mat));
    }
  });
  if (loads > 0.01) {
    const n = Math.ceil(loads);
    if (R.debris === 'haul') {
      push(costRow(SEC.clear, 'loadOut', `Load debris trucks (${n} load${n > 1 ? 's' : ''})`, n));
      push(costRow(SEC.clear, 'debris', `Haul off tree & demo debris — hired truck, dump fee per load`, n, { prod: 1 / (R.truckCycleHr || 1), mat: R.dumpFee, matRef: { rate: 'dumpFee' } }));
    } else notes.push(R.debris === 'pile' ? 'Debris piled on site' : 'Debris burned on site (Oct–Apr only, with permit)');
  }
  // --- dirt balance across pads and grading: import or haul off the difference
  const net = cut - need;
  if (net < -0.5) push(costRow(SEC.earth, 'import', `Fill dirt delivered (${num(-net)} CY short + ${F.swellPct}% loose)${matInfo('fill').vendor ? ' — ' + matInfo('fill').vendor : ''}`, -net * (1 + F.swellPct / 100), { matRef: { mk: 'fill' } }));
  else if (net > 0.5) {
    const lcy = net * (1 + F.swellPct / 100), n = Math.ceil(lcy / F.truckLCY);
    push(costRow(SEC.earth, 'loadOut', `Load excess dirt (${n} loads)`, n));
    push(costRow(SEC.earth, 'export', `Haul off excess dirt (${num(lcy)} loose CY) — hired truck`, n, { prod: 1 / (R.truckCycleHr || 1), mat: R.dirtDumpFee, matRef: { rate: 'dirtDumpFee' } }));
  }
  if (R.seedSlopes && slopesSF > 50) push(costRow(SEC.grass, 'seed', 'Pad side slopes — seed, fertilize, lime & straw', slopesSF / 1000, { scope: { kind: 'seed', sf: slopesSF, slopes: true }, matRef: { rate: 'seedMix' }, lockMat: true }));
  // --- your edits to the sheet (P.ovr, by row key): name, quantity, removed rows, lump sums — before machine hours are figured
  P.ovr = P.ovr || {};
  const keyed = {}, hidden = [];
  const rekey = () => rows.forEach(r => { if (r.key) return; const b = r.lineId ? 'L:' + r.lineId : r.asm + '|' + r.sec; keyed[b] = (keyed[b] || 0) + 1; r.key = b + ':' + keyed[b]; });
  const recalc = r => { r.hrs = r.prod > 0 ? r.qty / r.prod : 0; r.opHrs = r.crewTxt ? r.hrs : 0; r.labor = r.hrs * r.crewRate; const eq = r.machine ? eqById(r.machine) : null; r.gal = eq ? r.hrs * (+eq.burn || 0) : 0; r.fuel = r.gal * R.fuel; r.matT = r.qty * (r.mat || 0); r.equip = r.hire ? r.hrs * (+R.haulRate || 0) : 0; r.total = r.labor + r.equip + r.fuel + r.matT; };
  const editRows = late => { rekey(); for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i], o = P.ovr[r.key]; if (!o) continue;
    if (o.off) { if (!hidden.includes(r)) hidden.push(r); rows.splice(i, 1); continue; }
    if (o.desc) r.desc = o.desc;
    if (!late) {
      if (o.qty != null && r.asm !== 'adjust') { r.qty = o.qty; recalc(r); }
      if (o.ls != null) { r.hrs = r.opHrs = 0; r.machine = null; }   // a lump sum carries no machine hours
    } else {
      if (o.ls != null) { r.labor = r.equip = r.fuel = r.gal = 0; r.matT = o.ls; r.mat = r.qty ? o.ls / r.qty : o.ls; r.ls = o.ls; r.total = o.ls; r.edited = true; continue; }
      ['labor', 'equip', 'fuel', 'matT'].forEach(k => { if (o[k] != null) { r[k] = o[k]; (r.ovk = r.ovk || {})[k] = true; } });
      r.total = r.labor + r.equip + r.fuel + r.matT;
    }
    if (o.desc || o.qty != null || r.ovk) r.edited = true;
  } };
  editRows(false);
  // --- machines: hours from the line items, days on the job, billed by hour / day / week
  const itemHrs0 = rows.reduce((t, r) => t + (r.opHrs || 0), 0);
  const jobDays = P.sched.days > 0 ? P.sched.days : Math.max(1, Math.ceil(itemHrs0 / R.hrsPerDay - 1e-9));
  const mHrs = {}; rows.forEach(r => { if (r.machine) mHrs[r.machine] = (mHrs[r.machine] || 0) + r.hrs; });
  const support = equipList().filter(e => equipOn(e) && (e.roles || []).includes('support') && !mHrs[e.id]);
  const rentals = Object.keys(mHrs).map(id => ({ e: eqById(id), hrs: mHrs[id], sup: false })).concat(support.map(e => ({ e, hrs: jobDays * R.hrsPerDay, sup: true }))).filter(x => x.e).map(x => {
    const e = x.e, auto = x.sup ? Math.ceil(jobDays) : Math.max(1, Math.ceil(x.hrs / R.hrsPerDay - 1e-9));
    const days = P.sched.rent[e.id] != null ? P.sched.rent[e.id] : auto;
    const bc = billCost(e, x.hrs, days, P.sched.basis[e.id] || 'auto');
    const extra = e.rented ? bc.cost * (R.waiverPct + R.rentTaxPct) / 100 : 0;
    const supGal = x.sup ? (+e.burn || 0) * days : 0;
    const dv = delivOf(e);
    return { k: e.id, name: e.name, hrs: x.hrs, auto, days, how: bc.how, basis: P.sched.basis[e.id] || 'auto', billedBy: bc.basis, rent: bc.cost, extra, deliver: dv, delivSet: P.sched.deliv[e.id] != null, rented: !!e.rented,
      support: x.sup, gal: supGal, fuel: supGal * R.fuel, total: bc.cost + extra + dv + supGal * R.fuel };
  });
  rentals.filter(x => !x.support).forEach(x => rows.forEach(r => { if (r.machine === x.k && x.hrs > 0) { const a = (x.rent + x.extra) * r.hrs / x.hrs; r.equip += a; r.total += a; } }));
  const sup = rentals.filter(x => x.support);
  if (sup.length) { const r = costRow(SEC.mob, 'support', `${sup.map(x => x.name).join(' & ')} on the job (${num(jobDays, 1)} days)`, 1); r.equip = sup.reduce((t, x) => t + x.rent + x.extra, 0); r.gal = sup.reduce((t, x) => t + x.gal, 0); r.fuel = sup.reduce((t, x) => t + x.fuel, 0); r.total = r.equip + r.fuel; r.eqTxt = 'support equipment'; rows.unshift(r); }
  const delv = rentals.filter(x => x.deliver > 0);
  if (delv.length) rows.unshift(costRow(SEC.mob, 'deliver', `Delivery & pickup — ${delv.map(x => x.name).join(', ')}`, delv.length, { unit: 'EA', mat: delv.reduce((t, x) => t + x.deliver, 0) / delv.length, lockMat: true, matRef: { rate: 'deliver' } }));
  editRows(true);
  const byLine = {};
  rows.forEach(r => { if (!r.lineId) return; const t = byLine[r.lineId] = byLine[r.lineId] || { hrs: 0, labor: 0, equip: 0, fuel: 0, matT: 0, total: 0 }; ['hrs', 'labor', 'equip', 'fuel', 'matT', 'total'].forEach(k => { t[k] += r[k] || 0; }); });
  // --- schedule check: itemized operator hours vs the operator's own estimate
  const itemHrs = rows.reduce((t, r) => t + (r.opHrs || 0), 0), itemDays = itemHrs / R.hrsPerDay;
  const laborItems = rows.reduce((t, r) => t + r.labor, 0);
  const schedDays = P.sched.days > 0 ? P.sched.days : null;
  const laborSched = schedDays ? schedDays * R.hrsPerDay * R.operator * (1 + R.burdenPct / 100) : null;
  let adj = 0;
  if (schedDays) adj = R.laborBasis === 'items' ? 0 : R.laborBasis === 'schedule' ? laborSched - laborItems : Math.max(0, laborSched - laborItems);
  if (Math.abs(adj) > 0.5) { const r = costRow(SEC.sched, 'adjust', `Labor to match your schedule (${num(schedDays, 1)} days vs ${num(itemDays, 1)} itemized)`, 1); r.labor = adj; r.total = adj; rows.push(r); editRows(true); }
  // --- totals
  const sum = k => rows.reduce((t, r) => t + (r[k] || 0), 0);
  const mat = sum('matT'), labor = sum('labor'), equip = sum('equip'), fuel = sum('fuel'), direct = mat + labor + equip + fuel;
  const MK = P.markup = P.markup || {};   // overhead / profit as a fixed $ amount for this job (blank = use the %)
  const oh = MK.oh != null ? MK.oh : direct * R.ohPct / 100, profit = MK.profit != null ? MK.profit : (direct + oh) * R.profitPct / 100, total = direct + oh + profit;
  const secs = SEC_ORDER.map(s => ({ name: s, rows: rows.filter(r => r.sec === s) })).filter(s => s.rows.length).map(s => Object.assign(s, { total: s.rows.reduce((t, r) => t + r.total, 0) }));
  rows.forEach(r => { r.ext = r.total; r.price = r.qty ? r.total / r.qty : 0; });
  return { rows, lines: rows, secs, mat, labor, equip, fuel, direct, oh, profit, total, sub: direct, markup: oh + profit,
    hrs: itemHrs, gal: sum('gal'), loads, cut, need, net, notes, rentals,
    sched: { itemHrs, itemDays, schedDays, laborItems, laborSched, adj, basis: R.laborBasis },
    jobDays, missing: [...new Set(rows.filter(r => r.missing).map(r => r.eqTxt.split(' — ')[0]))],
    unpriced: rows.filter(r => r.asm === 'allow' && !r.mat && !r.ls).length, byLine, unmeasured, hidden, edited: rows.filter(r => r.edited).length,
    ohTxt: MK.oh != null ? 'Overhead (set $)' : `Overhead ${R.ohPct}%`, profitTxt: MK.profit != null ? 'Profit (set $)' : `Profit ${R.profitPct}%` };
}

// ---------------- takeoff sheet (Estimate tab) ----------------
function estimateHtml() {
  const E = estimate(), R = P.rates, S = E.sched;
  const m = n => money(n), cellIn = (attrs, v, cls) => `<input class="cin${cls ? ' ' + cls : ''}" type="number" inputmode="decimal" step="any" ${attrs} value="${v}">`;
  const matAttr = r => r.matRef.mk ? `data-matk="${r.matRef.mk}"` : r.matRef.line ? `data-lmat="${r.matRef.line}"` : r.matRef.feat ? `data-mfeat="${r.matRef.feat}"` : r.matRef.area ? `data-marea="${r.matRef.area}" data-mkey="${r.matRef.key || 'price'}"` : r.matRef.rate ? `data-mrate="${r.matRef.rate}"` : `data-masm="${r.matRef.asm}"`;
  const fmtQ = r => num(r.qty, r.unit === 'AC' || r.unit === 'MSF' ? 2 : r.unit === 'TON' ? 1 : 0);
  const fmtP = r => r.prod >= 10 ? num(r.prod) : r.prod >= 1 ? num(r.prod, 1) : num(r.prod, 3);
  const MAT_ROWS = new Set(['import', 'tsImport', 'stone', 'fabric', 'plant', 'allow', 'debris', 'export', 'trench']);
  const body = E.secs.map(s => `<tr class="sech"><th colspan="11"><span>${esc(s.name)}</span></th></tr>` + s.rows.map(r => `<tr${r.edited ? ' class="edited"' : ''}>
      <th scope="row"><button class="rowed" data-row="${esc(r.key)}" aria-label="Edit ${esc(r.desc)}">${esc(r.desc)} <i>✎</i></button><small>${r.ls != null ? 'lump sum' : esc([r.crewTxt, r.eqTxt].filter(Boolean).join(' · '))}${r.edited ? ' · <b>edited</b>' : ''}</small></th>
      <td>${r.asm === 'adjust' ? '' : fmtQ(r)}</td><td>${r.asm === 'adjust' ? '' : r.unit}</td>
      <td>${r.lockProd || r.prod === 0 ? (r.prod ? fmtP(r) : '—') : cellIn(r.prodRef ? `data-lprod="${r.prodRef.line}" data-lkey="${r.prodRef.key}"${r.prodRef.param ? ' data-lparam="1"' : ''} aria-label="Production per hour, ${esc(r.desc)}"` : `data-prod="${r.asm}" aria-label="Production per hour, ${esc(r.desc)}"`, +r.prod.toFixed(3))}</td>
      <td>${r.hrs ? num(r.hrs, 1) : '—'}</td><td>${r.labor ? m(r.labor) : '—'}</td><td>${r.equip ? m(r.equip) : '—'}</td><td>${r.fuel ? m(r.fuel) : '—'}</td>
      <td>${r.ls != null ? 'LS' : r.lockMat ? (r.mat ? '$' + num(r.mat, 2) : '—') : MAT_ROWS.has(r.asm) || r.mat || r.lineId ? cellIn(`${matAttr(r)} aria-label="Material dollars per unit, ${esc(r.desc)}"`, r.mat ? +(+r.mat).toFixed(2) : '', r.asm === 'allow' && !r.mat ? 'need' : '') : '—'}</td>
      <td>${r.matT ? m(r.matT) : '—'}</td><td><b>${m(r.total)}</b></td></tr>`).join('') +
    `<tr class="secsub"><th colspan="10" class="sl"><span>${esc(s.name)} subtotal</span></th><td>${m(s.total)}</td></tr>`).join('');
  const rentRows = E.rentals.map(x => `<tr><th scope="row">${esc(x.name)}<small>${x.support ? 'support · on the job every day' : `${num(x.hrs, 1)} run hrs → ${x.auto} day${x.auto > 1 ? 's' : ''}`}${x.rented ? '' : ' · owned'}</small></th>
      <td><select class="cin" data-basis="${x.k}" aria-label="Bill ${esc(x.name)} by">${[['auto', 'Cheapest'], ['hour', 'Hour'], ['day', 'Day'], ['week', 'Week']].map(([v, t]) => `<option value="${v}" ${x.basis === v ? 'selected' : ''}>${t}</option>`).join('')}</select></td>
      <td>${cellIn(`data-rent="${x.k}" aria-label="Days on the job, ${esc(x.name)}"`, x.days)}</td><td>${esc(x.how)}</td><td>${m(x.rent)}</td><td>${x.extra ? m(x.extra) : '—'}</td><td>${cellIn(`data-deliv="${x.k}" aria-label="Delivery and pickup for this job, ${esc(x.name)}"`, x.deliver ? +x.deliver.toFixed(2) : '', x.delivSet ? 'set' : '')}</td><td>${x.fuel ? m(x.fuel) : '—'}</td><td><b>${m(x.total)}</b></td></tr>`).join('');
  const rin = (k, l, step) => `<div><label for="r_${k}">${l}</label><input id="r_${k}" type="number" inputmode="decimal" step="${step || 'any'}" data-rate="${k}" value="${R[k]}"></div>`;
  const rsel = (k, l, opts) => `<div><label for="r_${k}">${l}</label><select id="r_${k}" data-rate="${k}">${opts.map(([v, t]) => `<option value="${v}" ${String(R[k]) === String(v) ? 'selected' : ''}>${t}</option>`).join('')}</select></div>`;
  const diff = S.schedDays ? S.laborSched - S.laborItems : null;
  return `<h2>Takeoff &amp; estimate</h2>
  <div class="muted" style="margin:-4px 0 8px">One-man crew · ${esc(R.region)} starting rates</div>
  ${E.rows.length ? `
  <div class="costcards">
    <div><span>Material</span><b>${m(E.mat)}</b></div><div><span>Labor</span><b>${m(E.labor)}</b></div>
    <div><span>Equip. rental</span><b>${m(E.equip)}</b></div><div><span>Fuel</span><b>${m(E.fuel)}</b></div>
    <div><span>Direct cost</span><b>${m(E.direct)}</b></div><div><span>${E.ohTxt}</span><b>${m(E.oh)}</b></div>
    <div><span>${E.profitTxt}</span><b>${m(E.profit)}</b></div><div class="tot"><span>Bid total</span><b>${m(E.total)}</b></div>
  </div>
  ${E.unmeasured.length ? `<div class="warn">Not measured yet, so not priced: ${E.unmeasured.map(Ln => `#${lineNo(Ln)} ${esc(Ln.desc)}`).join(', ')}. Measure ${E.unmeasured.length > 1 ? 'them' : 'it'} on the Takeoff tab.</div>` : ''}
  ${E.unpriced ? `<div class="warn">${E.unpriced} allowance${E.unpriced > 1 ? 's need' : ' needs'} a dollar amount — type it in the highlighted Mat $ box.</div>` : ''}
  <button class="pri big office" id="eOffice" style="width:100%;margin-top:10px">📤 Send to office</button>
  <div class="row mt"><button class="pri" id="eProp">📝 Proposal</button><button class="pri" id="eExport">⇪ Export / email</button></div>
  <div class="row mt"><button class="sec" id="eXlsx">Excel</button><button class="sec" id="eCsv">CSV</button><button class="sec" id="ePlan">Drawing</button></div>

  <section class="schedbox" aria-labelledby="schedH">
    <h3 id="schedH">Schedule check</h3>
    <div class="schedgrid">
      <div class="stat"><b>${num(S.itemDays, 1)} days</b><span>From the line items · ${num(S.itemHrs, 1)} hrs at ${R.hrsPerDay} hrs/day · ${num(S.itemDays / 5, 1)} wk</span></div>
      <div><label for="sDays">Your estimate, working days</label><input id="sDays" type="number" inputmode="decimal" step="0.5" min="0" data-sched="days" value="${S.schedDays || ''}" placeholder="e.g. ${Math.ceil(S.itemDays)}">
        <div class="muted" style="margin-top:3px">${S.schedDays ? `= ${num(S.schedDays / 5, 1)} weeks` : 'How long you think the whole job takes'}</div></div>
    </div>
    <table class="cmp"><tbody>
      <tr><th scope="row">Labor from line items</th><td>${m(S.laborItems)}</td></tr>
      <tr><th scope="row">Labor for your schedule</th><td>${S.schedDays ? m(S.laborSched) : '—'}</td></tr>
      <tr><th scope="row">Difference</th><td>${diff == null ? '—' : `<b class="${diff > 0 ? 'cutc' : 'fillc'}">${diff > 0 ? '+' : '−'}${m(Math.abs(diff))}</b> ${diff > 0 ? '(your schedule is longer)' : '(items take longer)'}`}</td></tr>
    </tbody></table>
    ${rsel('laborBasis', 'Bid labor on', [['higher', 'The higher of the two'], ['items', 'Line items only'], ['schedule', 'My schedule']])}
    ${S.schedDays && Math.abs(S.schedDays - S.itemDays) / Math.max(S.itemDays, 0.5) > 0.25 ? `<div class="warn">Your schedule and the line items differ by more than 25%. Check the production rates (orange boxes) or your day count.</div>` : ''}
  </section>

  <div class="row" style="align-items:end;justify-content:space-between"><h3 style="margin-bottom:6px">Equipment</h3><button class="sec" id="eEquip" style="flex:0 0 auto;padding:8px 12px">🚜 Choose equipment</button></div>
  <button class="sec" id="eMat" style="width:100%;margin:0 0 10px">📋 Material prices &amp; quotes</button>
  ${E.missing.length ? `<div class="warn">Not checked for this job but needed: ${esc(E.missing.join(', '))}. Check it in Equipment, or check a machine that can do that work.</div>` : ''}
  <div class="sheetwrap" role="region" aria-label="Equipment cost" tabindex="0"><table class="sheet rent">
    <thead><tr><th scope="col">Machine</th><th scope="col">Bill by</th><th scope="col">Days</th><th scope="col">Billed as</th><th scope="col">Cost</th><th scope="col">Waiver + tax</th><th scope="col">Delivery &amp; pickup $</th><th scope="col">Fuel</th><th scope="col">Total</th></tr></thead>
    <tbody>${rentRows || '<tr><td colspan="9" style="text-align:left">No equipment on this job.</td></tr>'}</tbody></table></div>
  ${E.rentals.length ? `<div class="row mt"><button class="sec" id="eRentAuto">Days from line items</button>${S.schedDays ? `<button class="sec" id="eRentSched">Keep every machine ${num(S.schedDays, 1)} days</button>` : ''}</div>` : ''}

  <h3>Line items</h3>
  <div class="sheetwrap" role="region" aria-label="Takeoff sheet" tabindex="0"><table class="sheet">
    <thead><tr><th scope="col">Item</th><th scope="col">Qty</th><th scope="col">Unit</th><th scope="col">Rate /hr</th><th scope="col">Hours</th><th scope="col">Labor</th><th scope="col">Equip</th><th scope="col">Fuel</th><th scope="col">Mat $/unit</th><th scope="col">Material</th><th scope="col">Total</th></tr></thead>
    <tbody>${body}</tbody>
    <tfoot>
      <tr><th colspan="4" class="sl"><span>Direct cost</span></th><td>${num(E.hrs, 1)}</td><td>${m(E.labor)}</td><td>${m(E.equip)}</td><td>${m(E.fuel)}</td><td></td><td>${m(E.mat)}</td><td>${m(E.direct)}</td></tr>
      <tr><th colspan="10" class="sl"><span>${E.ohTxt}</span></th><td>${m(E.oh)}</td></tr>
      <tr><th colspan="10" class="sl"><span>${E.profitTxt}</span></th><td>${m(E.profit)}</td></tr>
      <tr class="grand"><th colspan="10" class="sl"><span>Bid total</span></th><td>${m(E.total)}</td></tr>
    </tfoot></table></div>
  <div class="row mt"><button class="pri" id="eLump">＋ Add lump sum</button>${E.hidden.length ? `<button class="sec" id="eUnhide">Restore ${E.hidden.length} removed row${E.hidden.length > 1 ? 's' : ''}</button>` : ''}${E.edited ? `<button class="sec" id="eUnedit">Undo all ${E.edited} edit${E.edited > 1 ? 's' : ''}</button>` : ''}</div>
  <section class="schedbox mt" aria-labelledby="mkH">
    <h3 id="mkH">Overhead &amp; profit</h3>
    <div class="mkgrid">
      <label for="mkOhPct">Overhead</label><div class="mkin"><input id="mkOhPct" type="number" inputmode="decimal" step="any" data-rate="ohPct" value="${R.ohPct}" ${P.markup.oh != null ? 'disabled' : ''}><span>%</span><span class="or">or</span><span>$</span><input id="mkOh" type="number" inputmode="decimal" step="any" data-mk="oh" value="${P.markup.oh != null ? P.markup.oh : ''}" placeholder="${Math.round(E.oh)}"></div>
      <label for="mkPrPct">Profit</label><div class="mkin"><input id="mkPrPct" type="number" inputmode="decimal" step="any" data-rate="profitPct" value="${R.profitPct}" ${P.markup.profit != null ? 'disabled' : ''}><span>%</span><span class="or">or</span><span>$</span><input id="mkPr" type="number" inputmode="decimal" step="any" data-mk="profit" value="${P.markup.profit != null ? P.markup.profit : ''}" placeholder="${Math.round(E.profit)}"></div>
    </div>
    <div class="muted" style="margin-top:4px">Type a percent, or a dollar amount to use instead (clear the $ box to go back to the percent).</div>
  </section>
  <div class="muted mt">Tap any line's name (✎) to edit it: name, quantity, rate, any dollar amount, bill it as a lump sum, or remove it. Rate /hr = units you finish per hour. Equip = the machine's cost spread over the lines that use it. Fuel = run hours × gal/hr × $${num(R.fuel, 2)}. Orange boxes are editable. Trees are pushed over and dug out — no stump grinding.</div>`
  : '<div class="muted">Add work items on the Takeoff tab and lay them out on the map, or add a lump sum.</div><button class="pri mt" id="eLump" style="width:100%">＋ Add lump sum</button>'}
  <details ${E.rows.length ? '' : 'open'}><summary>Rates — labor, rental, fuel, materials &amp; markup</summary>
    <div class="grid2">${rin('operator', 'Operator (you) $/hr')}${rin('burdenPct', 'Labor burden % (SE tax, comp, ins.)')}${rin('hrsPerDay', 'Hours per working day', 0.5)}${rin('fuel', 'Diesel $/gal')}${rin('ohPct', 'Overhead %')}${rin('profitPct', 'Profit %')}${rin('waiverPct', 'Rental damage waiver %')}${rin('rentTaxPct', 'Rental sales tax %')}${rin('haulRate', 'Hired dump truck $/hr (with driver)')}${rin('truckCycleHr', 'Hired truck round trip (hr/load)')}${rin('dumpFee', 'Debris dump fee $/load')}${rin('dirtDumpFee', 'Dirt dump fee $/load')}
      ${rsel('debris', 'Tree & demo debris', [['haul', 'Haul off'], ['pile', 'Pile on site'], ['burn', 'Burn on site (Oct–Apr)']])}
      ${rsel('seedSlopes', 'Seed & straw pad side slopes', [['true', 'Yes'], ['false', 'No']])}</div>
    <div class="row mt"><button class="sec" id="eEquipEdit">Edit equipment list &amp; rates…</button></div>
    <h3>Seed &amp; straw materials (per 1,000 SF = $${num(seedMatPerMSF(R), 2)})</h3>
    <div class="grid2">${rin('seedPrice', 'Fescue seed $/lb')}${rin('seedRate', 'Seed lb per 1,000 SF')}${rin('fertBag', '10-10-10 $/50-lb bag')}${rin('fertRate', 'Fertilizer lb per 1,000 SF')}${rin('limeBag', 'Pelletized lime $/40-lb bag')}${rin('limeRate', 'Lime lb per 1,000 SF')}${rin('strawBale', 'Wheat straw $/bale')}${rin('strawRate', 'Bales per 1,000 SF')}</div>
    <div class="row mt"><button class="sec" id="eRateDef">Save rates as my defaults</button><button class="sec" id="eRateReset">Reset to ${esc(DEFAULT_RATES.region.split(' (')[0])} defaults</button></div>
    <div class="muted mt">Starting rates come from Nov 2026 research for north Georgia: rental-house day and week rates for Gainesville / Atlanta, BLS wages for the Gainesville metro, Tractor Supply seed & straw prices, and Lumpkin County's 8% sales tax. Hourly equipment rates are starting estimates. Get quotes from your rental yard and quarry and enter them here.</div>
  </details>`;
}
function bindEstimate(all, on) {
  const reRender = () => { calcCache.clear(); save(); render(); };
  const numv = e => parseFloat(e.value);
  all('[data-prod]', e => { const v = numv(e); if (!(v > 0)) { toast('Rate must be more than 0'); render(); return; } P.asm = P.asm || {}; P.asm[e.dataset.prod] = Object.assign(P.asm[e.dataset.prod] || {}, { prod: v }); reRender(); }, 'change');
  all('[data-lprod]', e => { const Ln = P.lines.find(x => x.id === e.dataset.lprod), v = numv(e); if (!Ln) return; if (!(v > 0)) { toast('Rate must be more than 0'); render(); return; } if (e.dataset.lparam) Ln.params[e.dataset.lkey] = v; else Ln[e.dataset.lkey] = v; reRender(); }, 'change');
  all('[data-matk]', e => { const v = numv(e); if (isFinite(v)) { const m = matInfo(e.dataset.matk); setMatPrice(e.dataset.matk, Object.assign({}, m, { price: v, date: new Date().toISOString().slice(0, 10) }), false); render(); toast('Price set for this job — Material prices to save it for new jobs', 3500); } }, 'change');
  all('[data-lmat]', e => { const Ln = P.lines.find(x => x.id === e.dataset.lmat), v = numv(e); if (Ln) { Ln.mat = isFinite(v) ? v : 0; reRender(); } }, 'change');
  all('[data-masm]', e => { P.asm = P.asm || {}; P.asm[e.dataset.masm] = Object.assign(P.asm[e.dataset.masm] || {}, { mat: numv(e) || 0 }); reRender(); }, 'change');
  all('[data-marea]', e => { const a = P.areas.find(x => x.id === e.dataset.marea); if (a) { a.p[e.dataset.mkey || 'price'] = numv(e) || 0; reRender(); } }, 'change');
  all('[data-mfeat]', e => { const f = P.features.find(x => x.id === e.dataset.mfeat); if (f) { f.allow = numv(e) || 0; reRender(); } }, 'change');
  all('[data-mrate]', e => { P.rates[e.dataset.mrate] = numv(e) || 0; reRender(); }, 'change');
  all('[data-rate]', e => { const k = e.dataset.rate; P.rates[k] = ['debris', 'laborBasis'].includes(k) ? e.value : k === 'seedSlopes' ? e.value === 'true' : (numv(e) || 0); if (k === 'hrsPerDay' && !(P.rates[k] > 0)) P.rates[k] = 8; reRender(); }, 'change');
  all('[data-basis]', e => { P.sched.basis[e.dataset.basis] = e.value; reRender(); }, 'change');
  on('#eEquip', () => openEquipMenu($('#eEquip')));
  on('#eOffice', sendToOffice);
  on('#eMat', () => openMatBook());
  on('#eEquipEdit', equipEditor);
  all('[data-sched]', e => { const v = numv(e); P.sched.days = v > 0 ? v : null; reRender(); }, 'change');
  all('[data-deliv]', e => { const v = numv(e); if (e.value === '' || !isFinite(v)) delete P.sched.deliv[e.dataset.deliv]; else P.sched.deliv[e.dataset.deliv] = Math.max(0, v); reRender(); }, 'change');
  all('[data-rent]', e => { const v = numv(e); if (v > 0) P.sched.rent[e.dataset.rent] = v; else delete P.sched.rent[e.dataset.rent]; reRender(); }, 'change');
  on('#eRentAuto', () => { P.sched.rent = {}; reRender(); });
  on('#eRentSched', () => { const E = estimate(); E.rentals.forEach(x => { P.sched.rent[x.k] = Math.ceil(P.sched.days); }); reRender(); });
  on('#eRateDef', () => { store.rates = clone(P.rates); save(true); toast('Rates saved as defaults for new jobs'); });
  on('#eRateReset', () => { P.rates = clone(DEFAULT_RATES); P.asm = {}; reRender(); toast('Rates reset to the researched defaults (equipment list unchanged)'); });
  on('#eProp', proposalDialog);
  on('#eXlsx', exportXlsx);
  all('[data-row]', b => rowEditor(b.dataset.row));
  on('#eLump', addLumpSum);
  on('#eUnhide', () => { Object.keys(P.ovr || {}).forEach(k => { if (P.ovr[k].off) { delete P.ovr[k].off; if (!Object.keys(P.ovr[k]).length) delete P.ovr[k]; } }); reRender(); toast('Removed rows are back'); });
  on('#eUnedit', async () => { if (await confirmBox('Undo every edit on the sheet (names, quantities, dollar amounts and lump sums)? Removed rows stay removed.', 'Undo edits')) { Object.keys(P.ovr || {}).forEach(k => { P.ovr[k] = P.ovr[k].off ? { off: true } : null; if (!P.ovr[k]) delete P.ovr[k]; }); } reRender(); });
  all('[data-mk]', e => { const v = numv(e); P.markup = P.markup || {}; P.markup[e.dataset.mk] = isFinite(v) && e.value !== '' ? v : null; reRender(); }, 'change');
}
// ---- edit one line of the sheet
function rowEditor(key) {
  const strip = P.ovr[key]; delete P.ovr[key];
  const base = estimate().rows.find(r => r.key === key);
  if (strip) P.ovr[key] = strip;
  const E = estimate(), r = E.rows.find(x => x.key === key) || base; if (!r) { toast('That line is no longer on the sheet'); return; }
  const o = Object.assign({}, P.ovr[key] || {}), b = base || r, card = $('#modalCard'); card.classList.remove('wide');
  const Ln = r.lineId ? P.lines.find(x => x.id === r.lineId) : null;
  const canProd = !r.lockProd && r.prod > 0 && r.asm !== 'adjust', canMat = !r.lockMat && r.asm !== 'adjust' && !(r.matRef && (r.matRef.feat || r.matRef.area));
  const nin = (id, label, val, ph, help) => `<div><label for="${id}">${label}</label><input id="${id}" type="number" inputmode="decimal" step="any" value="${val == null ? '' : val}" placeholder="${ph == null ? '' : ph}">${help ? `<div class="muted" style="font-size:12px;margin-top:3px">${help}</div>` : ''}</div>`;
  const r2 = v => Math.round(v * 100) / 100;
  card.innerHTML = `<h2 style="margin:0 0 2px">Edit line</h2><div class="muted">${esc(r.sec)}${Ln ? ` · takeoff item #${lineNo(Ln)}` : ' · added by the app'}</div>
    <label for="reDesc">Description</label><input id="reDesc" value="${esc(o.desc || b.desc)}">
    <div class="grid2">
      ${r.asm === 'adjust' ? '' : nin('reQty', `Quantity (${esc(r.unit)})`, o.qty != null ? o.qty : '', r2(b.qty), o.qty != null ? `Measured: ${num(b.qty, 2)}` : 'Blank = measured amount')}
      ${canProd ? nin('reProd', `Rate (${esc(r.unit)} per hour)`, +(+r.prod).toFixed(3), '', 'Changes this item’s production') : ''}
      ${canMat ? nin('reMat', `Material $ per ${esc(r.unit)}`, o.ls != null ? '' : +(+r.mat || 0).toFixed(2), '0') : ''}
    </div>
    <h3>Dollar amounts</h3>
    <div class="muted" style="margin:-4px 0 6px">Leave a box blank to use the calculated amount (shown in grey).</div>
    <div class="grid2">
      ${nin('reLabor', 'Labor $', o.labor, r2(b.labor))}${nin('reEquip', 'Equipment $', o.equip, r2(b.equip))}
      ${nin('reFuel', 'Fuel $', o.fuel, r2(b.fuel))}${nin('reMatT', 'Material $', o.matT, r2(b.matT))}
    </div>
    <h3>Lump sum</h3>
    ${nin('reLs', 'Bill this line as one amount, $', o.ls, '', 'Replaces labor, equipment, fuel and material for this line.')}
    <div class="row" style="margin-top:16px"><button class="dng" id="reOff" type="button" style="flex:0 0 auto">Remove</button><button class="sec" id="reReset" type="button">Reset</button></div>
    <div class="row mt"><button class="sec" id="reCancel" type="button">Cancel</button><button class="pri" id="reSave" type="button">Save</button></div>`;
  $('#modal').classList.remove('hidden');
  const close = () => $('#modal').classList.add('hidden');
  const done = () => { calcCache.clear(); save(); close(); render(); };
  const val = id => { const e = $('#' + id); if (!e || e.value === '') return null; const v = parseFloat(e.value); return isFinite(v) ? v : null; };
  $('#reCancel').onclick = close;
  $('#reOff').onclick = () => { P.ovr[key] = Object.assign(P.ovr[key] || {}, { off: true }); done(); toast('Line removed — Restore brings it back'); };
  $('#reReset').onclick = () => { delete P.ovr[key]; done(); toast('Line back to the calculated amounts'); };
  $('#reSave').onclick = () => {
    const n = {}, d = $('#reDesc').value.trim();
    if (d && d !== b.desc) n.desc = d;
    ['qty:reQty', 'labor:reLabor', 'equip:reEquip', 'fuel:reFuel', 'matT:reMatT', 'ls:reLs'].forEach(s => { const [k, id] = s.split(':'), v = val(id); if (v != null) n[k] = Math.max(0, v); });
    if (o.off) n.off = true;
    if (Object.keys(n).length) P.ovr[key] = n; else delete P.ovr[key];
    const pv = val('reProd');
    if (canProd && pv != null && Math.abs(pv - r.prod) > 1e-9) {
      if (!(pv > 0)) { toast('Rate must be more than 0'); return; }
      if (r.prodRef) { const L2 = P.lines.find(x => x.id === r.prodRef.line); if (L2) { if (r.prodRef.param) L2.params[r.prodRef.key] = pv; else L2[r.prodRef.key] = pv; } }
      else { P.asm = P.asm || {}; P.asm[r.asm] = Object.assign(P.asm[r.asm] || {}, { prod: pv }); }
    }
    const mv = val('reMat');
    if (canMat && mv != null && Math.abs(mv - (+r.mat || 0)) > 1e-9 && n.ls == null) {
      if (r.matRef && r.matRef.line) { const L2 = P.lines.find(x => x.id === r.matRef.line); if (L2) L2.mat = mv; }
      else if (r.matRef && r.matRef.mk) setMatPrice(r.matRef.mk, Object.assign({}, matInfo(r.matRef.mk), { price: mv }), false);
      else if (r.matRef && r.matRef.rate) P.rates[r.matRef.rate] = mv;
      else { P.asm = P.asm || {}; P.asm[r.asm] = Object.assign(P.asm[r.asm] || {}, { mat: mv }); }
    }
    done();
  };
}
// ---- a lump sum: just a description and an amount (also shows on the Takeoff tab)
async function addLumpSum() {
  const v = await form('Add lump sum', [
    { key: 'desc', label: 'Description', value: '', placeholder: 'e.g. Rock hammer allowance, permit fee, culvert pipe' },
    { key: 'amt', label: 'Amount $', type: 'number', value: '' },
    { key: 'sec', label: 'Section', type: 'select', value: 'other', options: Object.entries(SECKEY) }
  ], 'Add');
  if (!v) return;
  if (!v.desc || !(v.amt > 0)) { toast('Type a description and an amount'); return; }
  const Ln = newLine(libById('allow')); Object.assign(Ln, { desc: v.desc, mat: v.amt, sec: v.sec });
  P.lines.push(Ln); calcCache.clear(); save(); render(); toast(`Added ${v.desc} — ${money(v.amt)}`);
}
function estimateCSV() {
  const E = estimate(), q = s => '"' + String(s == null ? '' : s).replace(/"/g, '""') + '"', R = P.rates, S = E.sched;
  const rows = [['Project', P.name], ['Address', P.address || ''], ['Date', new Date().toLocaleDateString()], ['Basis', `One-man crew, rented equipment, ${R.region} rates`], [],
    ['Section', 'Item', 'Qty', 'Unit', 'Rate/hr', 'Hours', 'Machine', 'Labor $', 'Equip $', 'Fuel gal', 'Fuel $', 'Mat $/unit', 'Material $', 'Total $']];
  E.rows.forEach(r => rows.push([r.sec, r.desc, r.qty.toFixed(2), r.unit, r.prod ? r.prod.toFixed(3) : '', r.hrs.toFixed(2), r.eqTxt, r.labor.toFixed(2), r.equip.toFixed(2), r.gal.toFixed(1), r.fuel.toFixed(2), (+r.mat || 0).toFixed(2), r.matT.toFixed(2), r.total.toFixed(2)]));
  rows.push([], ['', 'Direct cost', '', '', '', E.hrs.toFixed(1), '', E.labor.toFixed(2), E.equip.toFixed(2), E.gal.toFixed(1), E.fuel.toFixed(2), '', E.mat.toFixed(2), E.direct.toFixed(2)],
    ['', E.ohTxt, '', '', '', '', '', '', '', '', '', '', '', E.oh.toFixed(2)], ['', E.profitTxt, '', '', '', '', '', '', '', '', '', '', '', E.profit.toFixed(2)], ['', 'BID TOTAL', '', '', '', '', '', '', '', '', '', '', '', E.total.toFixed(2)],
    [], ['Schedule check'], ['Days from line items', S.itemDays.toFixed(1)], ['Your estimate (days)', S.schedDays || ''], ['Labor from items', S.laborItems.toFixed(2)], ['Labor for your schedule', S.laborSched == null ? '' : S.laborSched.toFixed(2)],
    [], ['Machine', 'Hours', 'Days', 'Billed as', 'Cost $', 'Waiver + tax $', 'Delivery $', 'Fuel $', 'Total $']);
  E.rentals.forEach(x => rows.push([x.name, x.hrs.toFixed(1), x.days, x.how, x.rent.toFixed(2), x.extra.toFixed(2), x.deliver.toFixed(2), x.fuel.toFixed(2), x.total.toFixed(2)]));
  return rows.map(r => r.map(q).join(',')).join('\n');
}
function exportXlsx() {
  if (!window.XLSX) { toast('Excel export is not available — use CSV'); return; }
  shareOrDownload(safeName(P.name) + '_takeoff.xlsx', buildXlsx(), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
}
// Excel workbook: Takeoff (live formulas), Schedule & rental, Rates
function buildXlsx() {
  const E = estimate(), R = P.rates, X = window.XLSX, S = E.sched;
  const rates = [['Rates', R.region], ['Operator $/hr', R.operator], ['Labor burden %', R.burdenPct], ['Hours per day', R.hrsPerDay], ['Diesel $/gal', R.fuel], ['Overhead %', R.ohPct], ['Profit %', R.profitPct], ['Rental damage waiver %', R.waiverPct], ['Rental sales tax %', R.rentTaxPct], ['Hired dump truck $/hr', R.haulRate], [],
    ['Equipment', 'On this job', '$/hour', '$/day', '$/week', 'Gal/hr', 'Delivery each way', 'Rented']];
  equipList().forEach(e => rates.push([e.name, equipOn(e) ? 'Yes' : '', e.hour, e.day, e.week, e.burn, e.deliver, e.rented ? 'Yes' : 'Owned']));
  rates.push([], ['Seed & straw per 1,000 SF', +seedMatPerMSF(R).toFixed(2)], [], ['Material prices', 'Unit', '$/unit', 'Supplier', 'Phone', 'Quote date', 'Notes']);
  matDefs().forEach(d => { const m = matInfo(d.key); rates.push([d.name, d.unit, +m.price.toFixed(2), m.vendor, m.phone, m.date, m.note]); });
  const wsR = X.utils.aoa_to_sheet(rates); wsR['!cols'] = [{ wch: 30 }, { wch: 12 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 8 }, { wch: 16 }, { wch: 8 }];
  const ws = X.utils.aoa_to_sheet([[`${P.name} — sitework takeoff`], [P.address || ''], [`Prepared ${new Date().toLocaleDateString()} · one-man crew, rented equipment`], [],
    ['Section', 'Item', 'Qty', 'Unit', 'Rate/hr', 'Hours', 'Labor $/hr', 'Labor $', 'Equip $/hr', 'Equip $', 'Fuel gal/hr', 'Fuel gal', 'Fuel $', 'Mat $/unit', 'Material $', 'Total $']]);
  const r0 = 6;
  E.rows.forEach((r, i) => {
    const n = r0 + i;
    X.utils.sheet_add_aoa(ws, [[r.sec, r.desc, +r.qty.toFixed(3), r.unit, r.prod ? +r.prod.toFixed(4) : 0]], { origin: `A${n}` });
    const f = (c, formula, v) => { ws[`${c}${n}`] = { t: 'n', f: formula, v }; };
    f('F', `IF(E${n}>0,C${n}/E${n},0)`, r.hrs);
    const ov = r.ovk || {}, fixed = (c, v) => { ws[`${c}${n}`] = { t: 'n', v: +(+v).toFixed(2) }; };
    if (r.asm === 'adjust' || r.ls != null || ov.labor) { ws[`G${n}`] = { t: 'n', v: 0 }; fixed('H', r.labor); }
    else { ws[`G${n}`] = { t: 'n', v: +r.crewRate.toFixed(2) }; f('H', `F${n}*G${n}`, r.labor); }
    ws[`I${n}`] = { t: 'n', v: r.hrs ? +(r.equip / r.hrs).toFixed(2) : 0 }; if (ov.equip || r.ls != null) fixed('J', r.equip); else f('J', `F${n}*I${n}`, r.equip);
    ws[`K${n}`] = { t: 'n', v: r.hrs ? +(r.gal / r.hrs).toFixed(2) : 0 }; f('L', `F${n}*K${n}`, r.gal); if (ov.fuel || r.ls != null) fixed('M', r.fuel); else f('M', `L${n}*Rates!$B$5`, r.fuel);
    if (ov.matT) { ws[`N${n}`] = { t: 'n', v: r.qty ? +(r.matT / r.qty).toFixed(2) : 0 }; fixed('O', r.matT); f('P', `H${n}+J${n}+M${n}+O${n}`, r.total); return; }
    ws[`N${n}`] = { t: 'n', v: +(+r.mat || 0).toFixed(2) }; f('O', `C${n}*N${n}`, r.matT); f('P', `H${n}+J${n}+M${n}+O${n}`, r.total);
  });
  const last = r0 + E.rows.length - 1, t = last + 2;
  const put = (addr, v, formula) => { ws[addr] = formula ? { t: 'n', f: formula, v } : (typeof v === 'number' ? { t: 'n', v } : { t: 's', v }); };
  put(`B${t}`, 'Direct cost'); ['F', 'H', 'J', 'L', 'M', 'O', 'P'].forEach(c => put(`${c}${t}`, 0, `SUM(${c}${r0}:${c}${last})`));
  put(`B${t + 1}`, E.ohTxt); if (P.markup && P.markup.oh != null) put(`P${t + 1}`, +E.oh.toFixed(2)); else put(`P${t + 1}`, E.oh, `P${t}*Rates!$B$6/100`);
  put(`B${t + 2}`, E.profitTxt); if (P.markup && P.markup.profit != null) put(`P${t + 2}`, +E.profit.toFixed(2)); else put(`P${t + 2}`, E.profit, `(P${t}+P${t + 1})*Rates!$B$7/100`);
  put(`B${t + 3}`, 'BID TOTAL'); put(`P${t + 3}`, E.total, `P${t}+P${t + 1}+P${t + 2}`);
  ws['!ref'] = `A1:P${t + 3}`;
  ws['!cols'] = [{ wch: 20 }, { wch: 56 }, { wch: 9 }, { wch: 6 }, { wch: 8 }, { wch: 8 }, { wch: 9 }, { wch: 10 }, { wch: 9 }, { wch: 10 }, { wch: 8 }, { wch: 8 }, { wch: 9 }, { wch: 10 }, { wch: 11 }, { wch: 12 }];
  for (let n = r0; n <= t + 3; n++) ['G', 'H', 'I', 'J', 'M', 'N', 'O', 'P'].forEach(c => { if (ws[`${c}${n}`]) ws[`${c}${n}`].z = '$#,##0.00'; });
  const sched = [['Schedule check', ''], ['Hours from line items', +S.itemHrs.toFixed(1)], ['Days from line items', +S.itemDays.toFixed(1)], ['Your estimate (days)', S.schedDays || ''], ['Labor from line items', +S.laborItems.toFixed(2)], ['Labor for your schedule', S.laborSched == null ? '' : +S.laborSched.toFixed(2)], ['Bid labor on', S.basis], [],
    ['Machine', 'Hours', 'Days', 'Billed as', 'Cost $', 'Waiver + tax $', 'Delivery $', 'Fuel $', 'Total $']].concat(E.rentals.map(x => [x.name, +x.hrs.toFixed(1), x.days, x.how, +x.rent.toFixed(2), +x.extra.toFixed(2), +x.deliver.toFixed(2), +x.fuel.toFixed(2), +x.total.toFixed(2)]));
  const wsS = X.utils.aoa_to_sheet(sched); wsS['!cols'] = [{ wch: 34 }, { wch: 10 }, { wch: 12 }, { wch: 16 }, { wch: 11 }, { wch: 13 }, { wch: 11 }, { wch: 11 }];
  const wb = X.utils.book_new(); X.utils.book_append_sheet(wb, ws, 'Takeoff'); X.utils.book_append_sheet(wb, wsS, 'Schedule & rental'); X.utils.book_append_sheet(wb, wsR, 'Rates');
  const buf = X.write(wb, { type: 'array', bookType: 'xlsx' });
  return new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}


// ======================================================================
// Material prices — enter quotes as you get them (fill dirt, stone, topsoil, trucking …)
// Job price (P.mat) → your saved price (store.matBook) → starting price. Seed, straw, trucking
// and dump fees live in the job's Rates so the rest of the estimate keeps using them.
// ======================================================================
const MAT_BUILTIN = [
  { key: 'fill', name: 'Fill dirt, delivered', unit: 'CY', price: 25, hint: 'Used when pads and grading need more dirt than the cut' },
  { key: 'topsoil', name: 'Topsoil, delivered', unit: 'CY', price: 40 },
  { key: 'stone', name: 'Crusher run / GAB, delivered', unit: 'TON', price: 32, hint: 'Driveway stone lines' },
  { key: 'fabric', name: 'Geotextile fabric', unit: 'SY', price: 0.85 },
  { key: 'silt', name: 'Silt fence', unit: 'LF', price: 1.10 },
  { key: 'seed', name: 'Grass seed (KY-31 fescue)', unit: 'LB', rate: 'seedPrice' },
  { key: 'fert', name: 'Fertilizer 10-10-10, 50 lb bag', unit: 'BAG', rate: 'fertBag' },
  { key: 'lime', name: 'Pelletized lime, 40 lb bag', unit: 'BAG', rate: 'limeBag' },
  { key: 'straw', name: 'Wheat straw', unit: 'BALE', rate: 'strawBale' },
  { key: 'haul', name: 'Hired dump truck with driver', unit: 'HR', rate: 'haulRate', hint: 'Hauling off debris and extra dirt' },
  { key: 'dumpDebris', name: 'Debris dump fee', unit: 'LOAD', rate: 'dumpFee' },
  { key: 'dumpDirt', name: 'Dirt dump fee', unit: 'LOAD', rate: 'dirtDumpFee' }
];
function matDefs() {
  const out = MAT_BUILTIN.slice(), seen = new Set(out.map(d => d.key));
  (store.matDefs || []).concat(P.matDefs || []).forEach(d => { if (d && d.key && !seen.has(d.key)) { seen.add(d.key); out.push(d); } });
  return out;
}
const matDef = key => matDefs().find(d => d.key === key) || null;
function matInfo(key) {
  const d = matDef(key); if (!d) return null;
  const job = (P.mat || {})[key], mine = (store.matBook || {})[key];
  const meta = job || mine || {};
  const price = d.rate ? +(P.rates || normRates(P.rates))[d.rate] : job && job.price != null ? +job.price : mine && mine.price != null ? +mine.price : +d.price || 0;
  return { def: d, price, vendor: meta.vendor || '', phone: meta.phone || '', date: meta.date || '', note: meta.note || '', src: job ? 'job' : mine ? 'mine' : 'start' };
}
const matPrice = key => { const m = matInfo(key); return m ? m.price : 0; };
function setMatPrice(key, data, forNewJobs) {
  const d = matDef(key); if (!d) return;
  const rec = { price: Math.max(0, +data.price || 0), vendor: data.vendor || '', phone: data.phone || '', date: data.date || '', note: data.note || '' };
  P.mat = P.mat || {}; P.mat[key] = rec; P.rates = normRates(P.rates);
  if (d.rate) P.rates[d.rate] = rec.price;
  if (!MAT_BUILTIN.some(b => b.key === key)) { P.matDefs = (P.matDefs || []).filter(x => x.key !== key).concat([{ key, name: d.name, unit: d.unit }]); }
  if (forNewJobs) {
    store.matBook = store.matBook || {}; store.matBook[key] = Object.assign({}, rec);
    if (d.rate) { store.rates = store.rates && store.rates.v === RATES_V ? store.rates : { v: RATES_V }; store.rates[d.rate] = rec.price; }
    if (!MAT_BUILTIN.some(b => b.key === key)) store.matDefs = (store.matDefs || []).filter(x => x.key !== key).concat([{ key, name: d.name, unit: d.unit }]);
  }
  calcCache.clear(); save(true);
}
const matTxt = (m, d) => `$${num(m.price, m.price < 10 ? 2 : 2)} / ${d.unit}`;
function matUsedOn(key) {
  const E = estimate(), out = [];
  E.rows.forEach(r => { if (r.matRef && r.matRef.mk === key && r.qty > 0) out.push(`${r.desc} (${num(r.qty, r.unit === 'TON' ? 1 : 0)} ${r.unit})`); });
  return out;
}
function openMatBook(after) {
  const card = $('#modalCard'); card.classList.remove('wide');
  const defs = matDefs();
  const row = d => { const m = matInfo(d.key), used = matUsedOn(d.key); return `<button class="item" data-mat="${esc(d.key)}"><div class="t"><b>${esc(d.name)}</b><small>${m.vendor ? esc(m.vendor) + (m.date ? ' · quoted ' + esc(m.date) : '') : m.src === 'start' ? 'starting price — tap to enter your quote' : m.src === 'mine' ? 'your saved price' : 'price for this job'}${used.length ? ' · on this job' : ''}</small></div><span class="mprice">${matTxt(m, d)}</span>›</button>`; };
  card.innerHTML = `<div class="row" style="margin-bottom:6px;align-items:center"><h2 style="margin:0">Material prices</h2><button class="sec" id="mbDone" style="flex:0 0 auto">Done</button></div>
    <p class="muted" style="margin:0 0 10px">Enter quotes as you get them — supplier or trucking company, price, date. The estimate updates right away.</p>
    <button class="pri big" id="mbAdd" style="width:100%">＋ Add material</button>
    <div class="list mt">${defs.map(row).join('')}</div>`;
  $('#modal').classList.remove('hidden'); card.scrollTop = 0; $('#modal').scrollTop = 0;
  $('#mbDone').onclick = () => { $('#modal').classList.add('hidden'); render(); if (after) after(); };
  $('#mbAdd').onclick = () => matEditor(null, after);
  card.querySelectorAll('[data-mat]').forEach(b => b.onclick = () => matEditor(b.dataset.mat, after));
}
function matEditor(key, after, backToList = true) {
  const isNew = !key, d = isNew ? { key: 'm' + uid(), name: '', unit: 'CY', price: 0 } : matDef(key);
  const m = isNew ? { price: '', vendor: '', phone: '', date: '', note: '' } : matInfo(key);
  const used = isNew ? [] : matUsedOn(key);
  const today = new Date().toISOString().slice(0, 10);
  const card = $('#modalCard'); card.classList.remove('wide');
  card.innerHTML = `<h2 style="margin:0 0 4px">${isNew ? 'Add material' : esc(d.name)}</h2>
    ${d.hint ? `<div class="muted">${esc(d.hint)}</div>` : ''}
    ${isNew ? `<label for="mtName">Material</label><input id="mtName" placeholder="e.g. 4&quot; perforated drain pipe" autocomplete="off">
      <label for="mtUnit">Priced per</label><select id="mtUnit">${['CY', 'TON', 'LF', 'SF', 'SY', 'EA', 'LOAD', 'HR', 'LS', 'BAG', 'GAL'].map(u => `<option ${u === 'CY' ? 'selected' : ''}>${u}</option>`).join('')}</select>` : ''}
    <label for="mtPrice">Price $ per ${isNew ? '<span id="mtU">CY</span>' : esc(d.unit)}</label>
    <input id="mtPrice" type="number" inputmode="decimal" step="any" min="0" value="${m.price === '' ? '' : +(+m.price).toFixed(2)}">
    <label for="mtVendor">Supplier / trucking company</label><input id="mtVendor" value="${esc(m.vendor)}" placeholder="e.g. Smith Trucking" autocomplete="organization">
    <div class="grid2"><div><label for="mtPhone">Phone</label><input id="mtPhone" type="tel" value="${esc(m.phone)}"></div><div><label for="mtDate">Quote date</label><input id="mtDate" type="date" value="${esc(m.date || today)}"></div></div>
    <label for="mtNote">Notes</label><input id="mtNote" value="${esc(m.note)}" placeholder="e.g. 18 CY tri-axle, $450 a load">
    <label class="xrow" style="margin-top:12px"><input type="checkbox" id="mtAll" checked><span><b>Use this price on new jobs too</b><small>Unchecked = this job only</small></span></label>
    ${used.length ? `<div class="muted mt">On this job: ${esc(used.join('; '))}</div>` : ''}
    <div class="row" style="margin-top:16px"><button class="sec" id="mtCancel" type="button">Cancel</button><button class="pri" id="mtSave" type="button">Save price</button></div>`;
  $('#modal').classList.remove('hidden'); card.scrollTop = 0; $('#modal').scrollTop = 0;
  if (isNew) { $('#mtUnit').onchange = e => { $('#mtU').textContent = e.target.value; }; setTimeout(() => { const x = $('#mtName'); if (x) x.focus(); }, 60); } else setTimeout(() => { const x = $('#mtPrice'); if (x) x.select(); }, 60);
  const back = () => { if (backToList) openMatBook(after); else { $('#modal').classList.add('hidden'); render(); if (after) after(); } };
  $('#mtCancel').onclick = back;
  $('#mtSave').onclick = () => {
    const price = parseFloat($('#mtPrice').value);
    if (!isFinite(price) || price < 0) { toast('Type the price'); $('#mtPrice').focus(); return; }
    if (isNew) {
      const name = $('#mtName').value.trim(); if (!name) { toast('Name the material'); $('#mtName').focus(); return; }
      d.name = name; d.unit = $('#mtUnit').value;
      P.matDefs = (P.matDefs || []).concat([{ key: d.key, name: d.name, unit: d.unit }]);
    }
    setMatPrice(d.key, { price, vendor: $('#mtVendor').value.trim(), phone: $('#mtPhone').value.trim(), date: $('#mtDate').value, note: $('#mtNote').value.trim() }, $('#mtAll').checked);
    toast(`${d.name}: $${num(price, 2)} / ${d.unit} saved`);
    back();
  };
}

// ======================================================================
// Equipment: pick what's on this job (check boxes) and edit the saved list
// ======================================================================
function closeEquipMenu() { const x = document.getElementById('equipMenu'); if (x) x.remove(); document.removeEventListener('pointerdown', equipMenuOutside, true); }
function equipMenuOutside(e) { const x = document.getElementById('equipMenu'); if (x && !x.contains(e.target) && !(e.target.closest && e.target.closest('#btnEquip,#eEquip'))) closeEquipMenu(); }
function openEquipMenu(anchor) {
  if (document.getElementById('equipMenu')) { closeEquipMenu(); return; }
  const list = equipList(), r = anchor.getBoundingClientRect(), w = Math.min(340, window.innerWidth - 16);
  const box = document.createElement('div'); box.id = 'equipMenu'; box.setAttribute('role', 'dialog'); box.setAttribute('aria-label', 'Equipment for this job');
  const rateTxt = e => `$${num(e.hour)}/hr · $${num(e.day)}/day · $${num(e.week)}/wk`;
  box.innerHTML = `<div class="eqhead"><b>Equipment for this job</b><small>Checked machines are used and priced on this takeoff.</small></div>
    <div class="eqlist">${list.map(e => `<label class="eqrow"><input type="checkbox" data-eon="${esc(e.id)}" ${equipOn(e) ? 'checked' : ''}><span><b>${esc(e.name)}</b><small>${rateTxt(e)}${e.rented ? '' : ' · owned'}</small></span></label>`).join('')}</div>
    <div class="row" style="padding:8px"><button class="sec" id="eqEdit">Edit / add equipment</button><button class="pri" id="eqDone">Done</button></div>`;
  document.body.appendChild(box);
  const left = Math.min(Math.max(8, r.left), window.innerWidth - w - 8);
  let top = r.bottom + 6; const maxH = window.innerHeight - top - 12;
  Object.assign(box.style, { left: left + 'px', top: top + 'px', width: w + 'px', maxHeight: Math.max(240, maxH) + 'px' });
  box.querySelectorAll('[data-eon]').forEach(c => c.onchange = () => {
    P.equipOn = P.equipOn || {}; P.equipOn[c.dataset.eon] = c.checked;
    if (!c.checked) (P.lines || []).filter(Ln => Ln.equip === c.dataset.eon && Ln.role).forEach(Ln => {   // move the work to the best checked machine
      const pk = pickMachine(Ln.role), old = eqById(Ln.equip); if (!pk.e || pk.missing) return;
      Ln.prod = Ln.prod * (pk.e.speed || 100) / ((old && old.speed) || 100); Ln.equip = pk.e.id;
    });
    calcCache.clear(); save(); if (ui.tab === 'estimate' || ui.tab === 'takeoff') render(); updateEquipBadge();
  });
  box.querySelector('#eqDone').onclick = closeEquipMenu;
  box.querySelector('#eqEdit').onclick = () => { closeEquipMenu(); equipEditor(); };
  setTimeout(() => document.addEventListener('pointerdown', equipMenuOutside, true), 0);
}
function updateEquipBadge() { const b = document.getElementById('eqCount'); if (b) b.textContent = equipList().filter(equipOn).length; }
// Equipment list as a small file you can text or email to anyone using SiteWalk
function equipFromFile(text) {
  let o; try { o = JSON.parse(text); } catch (e) { return null; }
  const list = Array.isArray(o) ? o : o && o.sitewalk === 'equipment' && Array.isArray(o.list) ? o.list : null;
  if (!list || !list.length) return null;
  const n = v => { const x = parseFloat(v); return isFinite(x) && x >= 0 ? x : 0; };
  const out = list.filter(e => e && String(e.name || '').trim()).map(e => ({
    id: String(e.id || 'eq' + uid()).slice(0, 40), name: String(e.name).trim().slice(0, 80),
    hour: n(e.hour), day: n(e.day), week: n(e.week), burn: n(e.burn), deliver: n(e.deliver), speed: n(e.speed) || 100,
    rented: !!e.rented, delivOnce: !!e.delivOnce, on: !!e.on, roles: (Array.isArray(e.roles) ? e.roles : []).filter(r => ['dig', 'grade', 'trench', 'support'].includes(r))
  }));
  return out.length ? { list: out, by: o && o.by ? String(o.by).slice(0, 80) : '', saved: o && o.saved ? String(o.saved).slice(0, 40) : '' } : null;
}
// Equipment editor: a list of your machines — tap one to edit it, or add a new one.
// Changes save as you go. A list loaded from a file is shown first and only used after "Use this list".
const ROLE_SHORT = { dig: 'Dig & clear', grade: 'Grade & spread', trench: 'Trench', support: 'Truck / trailer' };
function equipEditor(preload) {
  const pending = !!preload, work = clone(preload ? preload.list : equipList());
  const card = $('#modalCard'); card.classList.remove('wide');
  const close = () => { $('#modal').classList.add('hidden'); updateEquipBadge(); render(); };
  const commit = () => { if (pending) return; store.equipList = work; store.equipV = EQUIP_V; calcCache.clear(); save(true); };
  const rateTxt = e => `$${num(e.hour)}/hr · $${num(e.day)}/day · $${num(e.week)}/wk · ${e.rented ? 'rented' : 'owned'}${+e.deliver ? ` · delivery $${num(e.deliver)}${e.delivOnce ? ' round trip' : ' each way'}` : ''}`;
  const showList = () => {
    card.innerHTML = `<div class="row" style="margin-bottom:6px;align-items:center"><h2 style="margin:0">${pending ? 'Loaded equipment list' : 'Edit equipment'}</h2>${pending ? '' : '<button class="sec" id="qeDone" style="flex:0 0 auto">Done</button>'}</div>
      ${pending ? `<div class="warn">${work.length} machines${preload.by ? ' from ' + esc(preload.by) : ''}${preload.saved ? ' (' + esc(preload.saved) + ')' : ''}. Look them over, then tap <b>Use this list</b>. It replaces your current list.</div>`
        : '<p class="muted" style="margin:0 0 10px">Tap a machine to change its name, rates or what it’s used for. Changes are saved on this phone for every takeoff.</p>'}
      ${pending ? '' : '<button class="pri big" id="qeAdd" style="width:100%">＋ Add new equipment</button>'}
      <div class="list mt">${work.map((e, i) => `<button class="item" data-eq="${i}"><div class="sw" style="background:${e.rented ? '#1a73e8' : '#188038'};border-radius:50%"></div><div class="t"><b>${esc(e.name)}</b><small>${rateTxt(e)}${(e.roles || []).length ? ' · ' + e.roles.map(r => ROLE_SHORT[r]).join(', ') : ''}</small></div>${pending ? '' : '›'}</button>`).join('') || '<div class="muted">No equipment yet. Tap Add new equipment.</div>'}</div>
      ${pending ? `<div class="row mt"><button class="sec" id="qeCancel">Cancel</button><button class="pri" id="qeUse">Use this list</button></div>`
        : `<div class="row mt"><button class="sec" id="qeShare">📤 Share list</button><button class="sec" id="qeLoad">📥 Load list…</button></div>
           <button class="sec mt" id="qeReset" style="width:100%">Reset to starting list</button>
           <input type="file" id="qeFile" accept=".txt,.json,text/plain,application/json" class="hidden">`}`;
    $('#modal').classList.remove('hidden');
    if (pending) {
      $('#qeCancel').onclick = close;
      $('#qeUse').onclick = () => { store.equipList = work; store.equipV = EQUIP_V; calcCache.clear(); save(true); close(); toast(`Equipment list loaded — ${work.length} machines`); };
      return;
    }
    $('#qeDone').onclick = close;
    $('#qeAdd').onclick = () => editMachine(-1);
    card.querySelectorAll('[data-eq]').forEach(b => b.onclick = () => editMachine(+b.dataset.eq));
    $('#qeReset').onclick = async () => {
      if (!(await confirmBox('Reset to the starting equipment list? Your changes and added machines will be replaced.', 'Reset'))) { showList(); return; }
      work.splice(0, work.length, ...clone(DEFAULT_EQUIP)); commit(); showList(); toast('Equipment list reset');
    };
    $('#qeShare').onclick = async () => {
      const by = (store.company && store.company.name) || '';
      const blob = new Blob([JSON.stringify({ sitewalk: 'equipment', v: EQUIP_V, by, saved: new Date().toISOString().slice(0, 10), list: work }, null, 1)], { type: 'text/plain' });
      const r = await deliverFiles([{ name: 'SiteWalk_equipment_list.txt', blob }], 'share', { email: '', subject: 'SiteWalk equipment list',
        body: `Equipment list for SiteWalk (${work.length} machines${by ? ', from ' + by : ''}).\n\nTo load it: save this file, then in SiteWalk tap Equipment → Edit equipment → Load list… and pick the file, then tap Use this list.` });
      toast(r === 'shared' ? 'Equipment list shared' : r === 'cancel' ? 'Cancelled' : 'Saved SiteWalk_equipment_list.txt — send it to anyone using SiteWalk', 3500);
    };
    $('#qeLoad').onclick = () => $('#qeFile').click();
    $('#qeFile').onchange = async e => {
      const f = e.target.files[0]; if (!f) return;
      const got = equipFromFile(await f.text());
      if (!got) { toast('That file isn’t a SiteWalk equipment list', 3500); return; }
      equipEditor(got);
    };
  };
  const editMachine = i => {
    const isNew = i < 0;
    const e = isNew ? { id: 'eq' + uid(), name: '', hour: 0, day: 0, week: 0, burn: 0, deliver: 0, rented: false, on: true, roles: ['dig'], speed: 100 } : clone(work[i]);
    let rented = !!e.rented, roles = new Set(e.roles || []), armDel = false, once = !!e.delivOnce;
    const nf = (k, l, step, help) => `<div><label for="m_${k}">${l}</label><input id="m_${k}" type="number" inputmode="decimal" step="${step || 'any'}" min="0" value="${e[k] == null ? '' : e[k]}">${help ? `<div class="muted" style="margin-top:3px;font-size:12px">${help}</div>` : ''}</div>`;
    card.innerHTML = `<h2 style="margin:0 0 4px">${isNew ? 'Add new equipment' : 'Edit equipment'}</h2>
      <label for="m_name">Name</label><input id="m_name" value="${esc(e.name)}" placeholder="e.g. Kubota KX-040 Mini excavator" autocomplete="off">
      <div class="grid3">${nf('hour', '$ per hour')}${nf('day', '$ per day')}${nf('week', '$ per week')}</div>
      <label id="m_ownL">Owned or rented</label>
      <div class="seg" role="radiogroup" aria-labelledby="m_ownL"><button type="button" role="radio" data-own="0">Owned</button><button type="button" role="radio" data-own="1">Rented</button></div>
      <div class="muted" id="m_ownH" style="margin-top:4px;font-size:12px"></div>
      <div class="grid2">${nf('deliver', 'Delivery & pickup $', 'any')}${nf('burn', 'Fuel, gal per hour', '0.1')}</div>
      <div class="seg" role="radiogroup" aria-label="How the delivery charge is counted" style="margin-top:6px"><button type="button" role="radio" data-dm="0">Each way (× 2)</button><button type="button" role="radio" data-dm="1">One time, round trip</button></div>
      <label id="m_roleL">Used for</label>
      <div class="rolechips" role="group" aria-labelledby="m_roleL">${Object.entries(ROLE_SHORT).map(([r, l]) => `<label class="rchip"><input type="checkbox" data-r="${r}" ${roles.has(r) ? 'checked' : ''}><span>${l}</span></label>`).join('')}</div>
      <div class="grid2">${nf('speed', 'Speed %', '5', '100 = your main machine for that work. A mini on grading might be 45.')}</div>
      <label class="xrow" style="margin-top:10px"><input type="checkbox" id="m_on" ${e.on ? 'checked' : ''}><span><b>Check it on new jobs</b><small>Starts checked in the Equipment list</small></span></label>
      ${isNew ? `<label class="xrow" style="margin-top:6px"><input type="checkbox" id="m_job" checked><span><b>Use it on this job</b><small>${esc(P.name)}</small></span></label>` : ''}
      <div class="row" style="margin-top:16px">${isNew ? '' : '<button class="dng" id="m_del" type="button" style="flex:0 0 auto">Delete</button>'}<button class="sec" id="m_cancel" type="button">Cancel</button><button class="pri" id="m_save" type="button">${isNew ? 'Add' : 'Save'}</button></div>`;
    const own = () => { card.querySelectorAll('[data-own]').forEach(b => { const on = (b.dataset.own === '1') === rented; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); });
      $('#m_ownH').textContent = rented ? 'Rented: day/week rates with a 1-day minimum, plus rental waiver & tax and delivery.' : 'Owned: can be billed by the hour; no waiver or tax. Delivery is optional — use it for a mobilization charge.'; };
    own();
    card.querySelectorAll('[data-own]').forEach(b => b.onclick = () => { rented = b.dataset.own === '1'; own(); });
    const dm = () => card.querySelectorAll('[data-dm]').forEach(b => { const on = (b.dataset.dm === '1') === once; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); });
    dm(); card.querySelectorAll('[data-dm]').forEach(b => b.onclick = () => { once = b.dataset.dm === '1'; dm(); });
    card.querySelectorAll('[data-r]').forEach(c => c.onchange = () => { if (c.checked) roles.add(c.dataset.r); else roles.delete(c.dataset.r); });
    if (isNew) setTimeout(() => $('#m_name').focus(), 60);
    $('#m_cancel').onclick = showList;
    $('#m_save').onclick = () => {
      const name = $('#m_name').value.trim();
      if (!name) { toast('Give the machine a name'); $('#m_name').focus(); return; }
      if (!roles.size) { toast('Pick at least one thing it’s used for'); return; }
      const v = k => { const x = parseFloat($('#m_' + k).value); return isFinite(x) && x >= 0 ? x : 0; };
      Object.assign(e, { name, hour: v('hour'), day: v('day'), week: v('week'), deliver: v('deliver'), burn: v('burn'), speed: v('speed') || 100, rented, delivOnce: once, roles: [...roles], on: $('#m_on').checked });
      if (isNew) { work.push(e); if ($('#m_job').checked) { P.equipOn = P.equipOn || {}; P.equipOn[e.id] = true; } }
      else work[i] = e;
      commit(); showList(); toast(isNew ? `${name} added` : `${name} saved`);
    };
    if (!isNew) $('#m_del').onclick = () => {
      if (!armDel) { armDel = true; $('#m_del').textContent = 'Tap again to delete'; return; }
      const gone = work.splice(i, 1)[0]; commit();
      (P.lines || []).filter(Ln => Ln.equip === gone.id).forEach(Ln => { const pk = Ln.role ? pickMachine(Ln.role) : null; Ln.equip = pk && pk.e ? pk.e.id : ''; });
      save(); showList(); toast(`${gone.name} deleted`);
    };
  };
  showList();
}

// ======================================================================

// ======================================================================
// Takeoff lines: list the work first, then measure each line in the field
// on the live map (walk it with GPS or tap it). Lines drive the estimate.
// ======================================================================
const CALC = {
  count:   { label: 'Count — mark each one', geom: 'points', unit: 'EA' },
  lf:      { label: 'Length — here to there', geom: 'line', unit: 'LF' },
  sf:      { label: 'Area — outline it', geom: 'poly', unit: 'SF' },
  ac:      { label: 'Area in acres — outline it', geom: 'poly', unit: 'AC' },
  msf:     { label: 'Area per 1,000 SF — outline it', geom: 'poly', unit: 'MSF' },
  cyDepth: { label: 'Volume — outline × depth', geom: 'poly', unit: 'CY' },
  stone:   { label: 'Stone — length × width or outline, × depth', geom: 'line|poly', unit: 'TON' },
  pad:     { label: 'Building pad — house corners + slab elevation', geom: 'poly', unit: 'CY' },
  grade:   { label: 'Grade to an elevation — outline (cut / fill)', geom: 'poly', unit: 'CY' },
  hrs:     { label: 'Hours — type them', geom: null, unit: 'HR' },
  ls:      { label: 'Lump sum — type a price', geom: null, unit: 'LS' }
};
const SECKEY = { clear: 'Clearing & demolition', earth: 'Earthwork', util: 'Utilities', top: 'Topsoil', stone: 'Driveway & stone', grass: 'Grassing', other: 'Other / allowances' };
const LINE_COLORS = ['#e8710a', '#1e88e5', '#43a047', '#8e24aa', '#f4511e', '#00897b', '#c0a000', '#6d4c41', '#3949ab', '#d81b60'];
const PAD_PARAMS = { offsetFt: 6, slope: 3, slabIn: 4, stoneIn: 6, extraPct: 35, stripIn: 0, fineGrade: true, fineProd: 2000, slabElev: null };
const DEFAULT_ITEMS = [
  { id: 'treeS', name: 'Remove trees under 12" — push over & dig out', calc: 'count', sec: 'clear', role: 'dig', equip: 'exc', prod: 4, mat: 0, loads: 0.15 },
  { id: 'treeM', name: 'Remove trees 12–24" — push over & dig out', calc: 'count', sec: 'clear', role: 'dig', equip: 'exc', prod: 2, mat: 0, loads: 0.4 },
  { id: 'treeL', name: 'Remove trees over 24" — push over & dig out', calc: 'count', sec: 'clear', role: 'dig', equip: 'exc', prod: 0.8, mat: 0, loads: 1 },
  { id: 'clearL', name: 'Clear & grub — light brush / scattered trees', calc: 'ac', sec: 'clear', role: 'dig', equip: 'exc', prod: 0.125, mat: 0, loads: 4 },
  { id: 'clearM', name: 'Clear & grub — medium woods', calc: 'ac', sec: 'clear', role: 'dig', equip: 'exc', prod: 0.06, mat: 0, loads: 10 },
  { id: 'clearH', name: 'Clear & grub — heavy woods', calc: 'ac', sec: 'clear', role: 'dig', equip: 'exc', prod: 0.035, mat: 0, loads: 18 },
  { id: 'demo', name: 'Demolish structure', calc: 'sf', sec: 'clear', role: 'dig', equip: 'exc', prod: 300, mat: 0, loads: 0.004 },
  { id: 'pave', name: 'Remove paving', calc: 'sf', sec: 'clear', role: 'dig', equip: 'exc', prod: 600, mat: 0, loads: 0.0025 },
  { id: 'fenceRm', name: 'Remove fence', calc: 'lf', sec: 'clear', role: 'dig', equip: 'exc', prod: 100, mat: 0, loads: 0.004 },
  { id: 'pad', name: 'Building pad', calc: 'pad', sec: 'earth', role: 'grade', equip: 'dozer', prod: 25, mat: 0, loads: 0, params: PAD_PARAMS },
  { id: 'grade', name: 'Grade area to elevation', calc: 'grade', sec: 'earth', role: 'grade', equip: 'dozer', prod: 25, mat: 0, loads: 0, params: { elev: null, balance: true, design: 'flat', sectionIn: 0, stripIn: 0, slopePct: 1, slopeDir: 0 } },
  { id: 'trench', name: 'Dig utility trench & backfill', calc: 'lf', sec: 'util', role: 'trench', equip: 'trencher', prod: 100, mat: 0, loads: 0, params: { purpose: 'Water line', depthIn: 24 } },
  { id: 'stone', name: 'Driveway stone — crusher run', calc: 'stone', sec: 'stone', role: 'grade', equip: 'dozer', prod: 25, mat: 32, matKey: 'stone', loads: 0, params: { widthFt: 12, depthIn: 6, density: 1.5, compactPct: 15, fabric: false } },
  { id: 'strip', name: 'Strip & stockpile topsoil', calc: 'cyDepth', sec: 'top', role: 'grade', equip: 'dozer', prod: 40, mat: 0, loads: 0, params: { depthIn: 6 } },
  { id: 'respread', name: 'Respread topsoil & fine grade', calc: 'cyDepth', sec: 'top', role: 'grade', equip: 'dozer', prod: 30, mat: 0, loads: 0, params: { depthIn: 4 } },
  { id: 'seed', name: 'Seed, fertilize, lime & straw — by hand', calc: 'msf', sec: 'grass', role: null, equip: '', prod: 2, mat: null, loads: 0 },
  { id: 'silt', name: 'Silt fence', calc: 'lf', sec: 'grass', role: null, equip: '', prod: 60, mat: 1.10, matKey: 'silt', loads: 0 },
  { id: 'plant', name: 'Plant tree', calc: 'count', sec: 'other', role: 'dig', equip: 'mini', prod: 1, mat: 250, loads: 0 },
  { id: 'hours', name: 'Extra work — by the hour', calc: 'hrs', sec: 'other', role: 'dig', equip: 'mini', prod: 1, mat: 0, loads: 0 },
  { id: 'allow', name: 'Allowance / lump sum', calc: 'ls', sec: 'other', role: null, equip: '', prod: 0, mat: 0, loads: 0 }
];
function itemLib() {
  if (!Array.isArray(store.items) || !store.items.length) store.items = clone(DEFAULT_ITEMS);
  store.items.forEach(i => { if (i.matKey === undefined) { const d = DEFAULT_ITEMS.find(x => x.id === i.id); i.matKey = d && d.matKey && i.mat === d.mat ? d.matKey : null; } });
  return store.items;
}
const libById = id => itemLib().find(i => i.id === id) || DEFAULT_ITEMS.find(i => i.id === id) || null;
const lineNo = L => P.lines.indexOf(L) + 1;
const lineColor = L => LINE_COLORS[(P.lines.indexOf(L) + LINE_COLORS.length) % LINE_COLORS.length];
function newLine(item) {
  let equip = item.equip || '', prod = item.prod;
  if (item.role) {               // the library's machine isn't checked for this job → best checked one that can do the work
    const pref = equip ? eqById(equip) : null;
    if (!pref || !equipOn(pref)) { const pk = pickMachine(item.role); if (pk.e && !pk.missing) { prod = prod * (pk.e.speed || 100) / ((pref && pref.speed) || 100); equip = pk.e.id; } }
  }
  return { id: uid(), item: item.id, desc: item.name, calc: item.calc, sec: item.sec || 'other', role: item.role || null, equip, prod, mat: item.mat, matKey: item.matKey || null, loads: item.loads || 0, params: clone(item.params || {}), shapes: [], typed: null };
}
function pseudoArea(L) {
  const poly = (L.shapes || []).find(s => s.geom === 'poly'); if (!poly) return null;
  const p = L.params || {};
  return L.calc === 'pad'
    ? { id: 'L' + L.id, type: 'pad', geom: 'poly', pts: poly.pts, p: { slabElev: p.slabElev, offsetFt: p.offsetFt, slope: p.slope, slabIn: p.slabIn, stoneIn: p.stoneIn, extraPct: p.extraPct, stripIn: p.stripIn } }
    : { id: 'L' + L.id, type: 'cutfill', geom: 'poly', pts: poly.pts, p: { design: p.design || 'flat', elev: p.elev, balance: !!p.balance, slopePct: p.slopePct, slopeDir: p.slopeDir, sectionIn: p.sectionIn || 0, stripIn: p.stripIn || 0 } };
}
function lineQty(L) {
  const sh = L.shapes || [], p = L.params || {};
  const lenLF = sh.filter(s => s.geom === 'line').reduce((t, s) => t + G.lineLength(s.pts.map(xyOf)), 0);
  const polys = sh.filter(s => s.geom === 'poly');
  const areaSF = polys.reduce((t, s) => t + G.polyArea(s.pts.map(xyOf)), 0);
  const perim = polys.reduce((t, s) => t + courses(s.pts.map(xyOf)).reduce((u, c) => u + c.dist, 0), 0);
  const count = sh.filter(s => s.geom === 'points').reduce((t, s) => t + s.pts.length, 0);
  const o = { measured: sh.length > 0, lenLF, areaSF, count, unit: CALC[L.calc] ? CALC[L.calc].unit : 'EA', qty: 0 };
  switch (L.calc) {
    case 'count': o.qty = count; break;
    case 'lf': o.qty = lenLF + perim; break;
    case 'sf': o.qty = areaSF; break;
    case 'ac': o.qty = areaSF / G.SF_PER_ACRE; break;
    case 'msf': o.qty = areaSF / 1000; break;
    case 'cyDepth': o.qty = areaSF * (p.depthIn || 0) / 12 / 27; break;
    case 'stone': { o.sf = areaSF + lenLF * (p.widthFt || 12); o.cy = o.sf * (p.depthIn || 0) / 12 / 27; o.qty = o.cy * (1 + (p.compactPct || 0) / 100) * (p.density || 1.5); o.fabricSY = p.fabric ? o.sf / 9 * 1.1 : 0; break; }
    case 'pad': case 'grade': {
      const a = pseudoArea(L);
      if (!a) { o.why = 'Measure it on the map'; break; }
      if (L.calc === 'pad' && p.slabElev == null) { o.why = 'Enter the slab elevation'; break; }
      const v = calcArea(a); if (a._ext) L._ext = a._ext;
      if (!v.ok) { o.why = v.why; break; }
      if (L.calc === 'pad') { o.pad = v; o.qty = v.cutCY + v.dirtCY; }
      else { o.grade = v; o.qty = v.cutCY + v.fillBankCY; }
      break;
    }
    case 'hrs': o.qty = L.typed || 0; o.measured = true; break;
    case 'ls': o.qty = 1; o.measured = true; break;
  }
  if (L.typed != null && !['pad', 'grade', 'hrs', 'ls'].includes(L.calc)) { o.qty = +L.typed || 0; o.typed = true; }
  return o;
}
// ---- migrate jobs built the old way (areas + priced features) into lines, once
function migrateLines(p) {
  if (!p || p.linesV === 1) return;
  const keepP = P; P = p;
  try {
    p.lines = p.lines || [];
    const add = (itemId, shapes, patch) => { const L = newLine(libById(itemId)); L.shapes = shapes; Object.assign(L, patch || {}); if (patch && patch.params) L.params = Object.assign(clone(libById(itemId).params || {}), patch.params); p.lines.push(L); return L; };
    (p.areas || []).forEach(a => {
      const shp = [{ id: uid(), geom: a.geom === 'line' ? 'line' : 'poly', pts: a.pts }];
      if (a.type === 'pad') add('pad', shp, { desc: a.name, params: Object.assign({}, PAD_PARAMS, a.p) });
      else if (a.type === 'cutfill') add('grade', shp, { desc: a.name, params: a.p });
      else if (a.type === 'gravel') add('stone', shp, { desc: `${a.name} — ${a.p.material}`, mat: a.p.price, params: { widthFt: a.p.widthFt, depthIn: a.p.depthIn, density: a.p.density, compactPct: a.p.compactPct, fabric: a.p.fabric } });
      else if (a.type === 'topsoil') add(a.p.action === 'strip' ? 'strip' : 'respread', shp, { desc: `${a.name}${a.p.action === 'import' ? ' — import & spread' : ''}`, mat: a.p.action === 'import' ? 40 * (1 + (p.factors && p.factors.topsoilLoosePct || 20) / 100) : 0, params: { depthIn: a.p.depthIn } });
      else if (a.type === 'trench') add('trench', shp, { desc: a.name, mat: a.p.matPerLF || 0, params: { purpose: a.p.purpose, depthIn: a.p.depthIn } });
      else if (a.type === 'seed') add('seed', shp, { desc: a.name });
    });
    const trees = (p.features || []).filter(f => f.type === 'tree' && f.status === 'remove'), d = t => t.dbh || 12;
    [['treeS', t => d(t) < 12], ['treeM', t => d(t) >= 12 && d(t) <= 24], ['treeL', t => d(t) > 24]].forEach(([id, fn]) => { const ts = trees.filter(fn); if (ts.length) add(id, [{ id: uid(), geom: 'points', pts: ts.map(t => t.pts[0]) }]); });
    (p.features || []).filter(f => f.status === 'remove' && f.type !== 'tree').forEach(f => {
      const shp = [{ id: uid(), geom: f.geom === 'point' ? 'points' : f.geom, pts: f.pts }];
      if (f.type === 'woods') add({ light: 'clearL', medium: 'clearM', heavy: 'clearH' }[f.density || 'medium'], shp, { desc: `Clear & grub — ${featName(f)}` });
      else if (['house', 'shed', 'pool'].includes(f.type) && f.geom === 'poly') add('demo', shp, { desc: `Demolish ${featName(f)}` });
      else if (f.type === 'driveway') add('pave', f.geom === 'poly' ? shp : [], { desc: `Remove ${featName(f)} paving`, typed: f.geom === 'line' ? G.lineLength(f.pts.map(xyOf)) * (f.widthFt || 12) : null });
      else if (f.type === 'fence' || f.type === 'wall') add('fenceRm', shp, { desc: `Remove ${featName(f)}` });
      else add('allow', [], { desc: `${f.type === 'well' ? 'Abandon & seal' : 'Remove'} ${featName(f)}`, mat: f.allow || 0 });
    });
    (p.features || []).filter(f => f.status === 'proposed').forEach(f => {
      if (f.type === 'tree') add('plant', [{ id: uid(), geom: 'points', pts: f.pts }], { desc: `Plant ${featName(f)}` });
      else if (!['house', 'driveway', 'woods'].includes(f.type)) add('allow', [], { desc: featName(f), mat: f.allow || 0 });
    });
    p.areas = [];
    p.linesV = 1;
  } finally { P = keepP; }
}

// ---- map: every measured line in its own color with its number
function drawLines() {
  lyr.lines.clearLayers();
  (P.lines || []).forEach((Ln, i) => {
    const col = lineColor(Ln), sel = ui.lineId === Ln.id, n = i + 1;
    const click = e => { if (mapCapturing()) { if (e && e.latlng && !e.target.getLatLngs) map.fire('click', { latlng: e.latlng }); return; } if (e && e.originalEvent) L.DomEvent.stopPropagation(e); openLine(Ln.id); };
    const tag = (ll, text) => L.marker(ll, { interactive: false, keyboard: false, icon: L.divIcon({ className: 'ltag', iconSize: [0, 0], html: `<span style="background:${col}">${esc(text)}</span>` }) }).addTo(lyr.lines);
    (Ln.shapes || []).forEach(s => {
      if (s.geom === 'points') s.pts.forEach(p => { L.circleMarker(p, { radius: sel ? 9 : 7, color: '#fff', weight: 2, fillColor: col, fillOpacity: 1 }).addTo(lyr.lines).on('click', click); tag(p, String(n)); });
      else if (s.geom === 'line') {
        const w = Ln.calc === 'stone' ? (Ln.params.widthFt || 12) : 0;
        if (w) L.polygon(G.lineBufferRects(s.pts.map(xyOf), w).map(r => r.map(([x, y]) => llOf(x, y))), { color: col, weight: 0, fillColor: col, fillOpacity: 0.3 }).addTo(lyr.lines).on('click', click);
        L.polyline(s.pts, { color: col, weight: sel ? 6 : 4, opacity: 0.95 }).addTo(lyr.lines).on('click', click);
        tag(s.pts[Math.floor(s.pts.length / 2)], `${n}`);
      } else {
        if (Ln.calc === 'pad') { const top = G.offsetPolygon(s.pts.map(xyOf), Ln.params.offsetFt == null ? 6 : Ln.params.offsetFt).map(([x, y]) => llOf(x, y)); L.polygon(top, { color: col, weight: sel ? 3 : 2, fillColor: col, fillOpacity: sel ? 0.05 : 0.15 }).addTo(lyr.lines).on('click', click); L.polygon(s.pts, { color: col, weight: 2, dashArray: '6 4', fill: false, interactive: false }).addTo(lyr.lines); }
        else L.polygon(s.pts, { color: col, weight: sel ? 4 : 2.5, fillColor: col, fillOpacity: sel ? 0.12 : 0.22 }).addTo(lyr.lines).on('click', click);
        tag(llOf(...G.polyCentroid(s.pts.map(xyOf))), `${n}`);
      }
    });
  });
  const Ln = (P.lines || []).find(x => x.id === ui.lineId);
  if (Ln && (Ln.calc === 'pad' || Ln.calc === 'grade')) { const q = lineQty(Ln); drawHeat(null, q.pad || q.grade || null); } else lyr.heat.clearLayers();
}

// ---- Takeoff tab
function openLine(id) {
  ui.tab = 'takeoff'; ui.lineId = id; document.body.dataset.tab = 'takeoff';
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === 'takeoff'));
  $('#sheet').classList.remove('collapsed', 'full');
  drawLines(); render();
}
// ---- typed work item → library item, unit and machine
const EXAMPLES = ['Dig utility trench', 'Clear trees', 'Clear for building site', 'Grade building pad', 'Driveway stone', 'Seed & straw'];
const GUESS = [
  [/trench|water ?line|sewer|electric|conduit|gas ?line|pipe|drain ?line|fiber/i, { lf: 'trench' }, 'lf'],
  [/silt/i, { lf: 'silt' }, 'lf'],
  [/fence/i, { lf: 'fenceRm' }, 'lf'],
  [/plant/i, { count: 'plant' }, 'count'],
  [/\bpad\b|slab|footprint/i, { area: 'pad' }, 'area'],
  [/drive|gravel|stone|crusher|\brock\b|parking|\bgab\b/i, { lf: 'stone', area: 'stone' }, 'lf'],
  [/stump|tree/i, { area: 'clearM', count: 'treeM' }, 'area'],
  [/clear|grub|woods|brush/i, { area: 'clearM', count: 'treeM' }, 'area'],
  [/seed|straw|grass|\bhay\b/i, { area: 'seed' }, 'area'],
  [/respread|spread topsoil/i, { area: 'respread' }, 'area'],
  [/topsoil|strip/i, { area: 'strip' }, 'area'],
  [/demo|tear|shed|structure|barn|mobile home|trailer|house/i, { area: 'demo' }, 'area'],
  [/pav|asphalt|concrete/i, { area: 'pave' }, 'area'],
  [/grade|level|\bcut\b|\bfill\b|swale|ditch|berm/i, { area: 'grade' }, 'area']
];
function guessItem(desc) {
  const d = (desc || '').trim(), lib = itemLib();
  const own = lib.find(i => i.name.toLowerCase() === d.toLowerCase());
  if (own) { const m = own.calc === 'count' ? 'count' : own.calc === 'lf' ? 'lf' : CALC[own.calc] && CALC[own.calc].geom ? (own.calc === 'stone' ? 'lf' : 'area') : 'lf'; return { by: { [m]: own.id }, meas: m }; }
  const g = GUESS.find(([re]) => re.test(d));
  return g ? { by: g[1], meas: g[2] } : { by: {}, meas: 'lf' };
}
const NEW_PROD = { lf: 50, area: 400, count: 2 };
function resolveItem(desc, meas) {
  const g = guessItem(desc), id = g.by[meas];
  const it = id ? libById(id) : null;
  if (it) return it;
  return { id: null, name: desc, calc: meas === 'lf' ? 'lf' : meas === 'area' ? 'sf' : 'count', sec: 'other', role: null, equip: '', prod: NEW_PROD[meas], mat: 0, loads: 0, params: {}, custom: true };
}
function defaultEquip(it) {
  const e = it.equip ? eqById(it.equip) : null;
  if (e && equipOn(e)) return e.id;
  if (it.role) { const pk = pickMachine(it.role); if (pk.e) return pk.e.id; }
  return it.equip || '';
}
function takeoffHtml() {
  if (ui.lineId) { const Ln = P.lines.find(x => x.id === ui.lineId); if (Ln) return lineHtml(Ln); ui.lineId = null; }
  const E = estimate(), ni = ui.ni || (ui.ni = { desc: '' });
  const list = P.lines.map((Ln, i) => {
    const q = lineQty(Ln), r = E.byLine[Ln.id], eq = Ln.equip ? eqById(Ln.equip) : null;
    const need = !q.measured && Ln.typed == null && CALC[Ln.calc].geom;
    const qtyTxt = need ? 'Not laid out yet' : q.why ? q.why : `${num(q.qty, q.unit === 'AC' || q.unit === 'MSF' ? 2 : q.unit === 'TON' ? 1 : 0)} ${q.unit}`;
    const price = r ? r.total * (E.direct ? E.total / E.direct : 1) : 0;
    return `<div class="tline${need || q.why ? ' need' : ''}">
      <button class="tl-main" data-line="${Ln.id}"><span class="tnum" style="background:${lineColor(Ln)}">${i + 1}</span><span class="t"><b>${esc(Ln.desc)}</b><small>${esc(qtyTxt)} · ${esc(eq ? eq.name : (Ln.prod ? 'by hand' : 'material'))}${r ? ' · ' + money(price) : ''}</small></span></button>
      ${CALC[Ln.calc].geom ? `<button class="sec tl-meas" data-meas="${Ln.id}" aria-label="Lay out line ${i + 1} on the map">📏</button>` : ''}</div>`;
  }).join('');
  const used = new Set(P.lines.map(l => l.desc.toLowerCase())), ex = EXAMPLES.filter(x => !used.has(x.toLowerCase()));
  const ac = P.boundary && P.boundary.length > 2 ? G.polyArea(P.boundary.map(xyOf)) / G.SF_PER_ACRE : null;
  const eqOpts = `<option value="">By hand / no machine</option>` + equipList().filter(e => !(e.roles || []).includes('support')).map(e => `<option value="${esc(e.id)}">${esc(e.name)}${equipOn(e) ? ' ✓' : ''}</option>`).join('');
  return `<h2>Takeoff</h2>
  <div class="muted" style="margin:-4px 0 10px">${esc(P.name)}${ac ? ` · ${num(ac, 2)} ac boundary` : ''}</div>
  <div class="list">${list || ex.slice(0, 4).map((x, i) => `<button class="exrow" data-ex="${esc(x)}"><span class="tnum">${i + 1}</span><span class="t">${esc(x)}</span><small>example</small></button>`).join('')}</div>
  <section class="ni" aria-labelledby="niH">
    <h3 id="niH">${P.lines.length ? 'Add the next work item' : 'What work needs to be priced?'}</h3>
    <input id="niDesc" value="${esc(ni.desc)}" placeholder="Type a work item, e.g. Dig utility trench" autocomplete="off" enterkeyhint="next" aria-label="Work item description">
    ${P.lines.length && ex.length ? `<div class="exchips">${ex.map(x => `<button class="exchip" data-ex="${esc(x)}">${esc(x)}</button>`).join('')}</div>` : ''}
    <div id="niStep" ${ni.desc.trim() ? '' : 'hidden'}>
      <label id="niMl">How is it measured?</label>
      <div class="seg" role="radiogroup" aria-labelledby="niMl">${[['lf', 'LF — length'], ['area', 'Area'], ['count', 'Count']].map(([k, l]) => `<button type="button" role="radio" data-nm="${k}">${l}</button>`).join('')}</div>
      <label for="niEq">Equipment</label><select id="niEq">${eqOpts}</select>
      <div class="muted" id="niHint" style="margin-top:6px"></div>
      <button class="pri big mt" id="niGo" style="width:100%">📏 Lay it out on the map</button>
    </div>
  </section>
  ${P.lines.length ? '<button class="pri big mt office" id="tkOffice" style="width:100%">📤 Send to office</button>' : ''}
  <div class="row mt"><button class="sec" id="tkAdd">Pick from my list</button>${P.lines.length ? `<button class="sec" id="tkEst">Estimate · ${money(E.total)}</button>` : ''}</div>
  <div class="row mt">${P.lines.length ? '<button class="sec" id="tkPlan">📐 Drawing</button>' : ''}<button class="sec" id="tkMat">📋 Material prices</button></div>`;
}
function bindNewItem(all, on) {
  if (!$('#niDesc')) return;
  const ni = ui.ni;
  const state = () => {
    const desc = ni.desc.trim(), g = guessItem(desc), meas = ni.meas || g.meas, it = resolveItem(desc, meas);
    const equip = ni.equip != null ? ni.equip : defaultEquip(it);
    return { desc, meas, it, equip };
  };
  const upd = () => {
    const s = state();
    $('#niStep').hidden = !s.desc;
    document.querySelectorAll('[data-nm]').forEach(b => { const onb = b.dataset.nm === s.meas; b.classList.toggle('on', onb); b.setAttribute('aria-checked', String(onb)); });
    $('#niEq').value = s.equip;
    const u = s.meas === 'lf' ? 'LF' : s.meas === 'count' ? 'EA' : (CALC[s.it.calc] || CALC.sf).unit;
    $('#niHint').textContent = s.it.custom ? `New item. Starts at ${NEW_PROD[s.meas]} ${u} per hour and no material; you can change both after it's laid out.`
      : `Priced like “${s.it.name}”: ${num(s.it.prod, s.it.prod < 1 ? 3 : s.it.prod < 10 ? 1 : 0)} ${s.it.calc === 'pad' || s.it.calc === 'grade' ? 'CY' : s.it.calc === 'stone' ? 'TON' : u} per hour${s.it.mat ? `, material $${num(s.it.mat, 2)} per unit` : ''}.${s.it.calc === 'pad' ? ' Walk or tap the house corners.' : ''}`;
  };
  upd();
  on('#niDesc', e => { ni.desc = e.target.value; if (!ni.touchedM) ni.meas = null; if (!ni.touchedE) ni.equip = null; upd(); }, 'input');
  on('#niDesc', e => { if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); } }, 'keydown');
  all('[data-ex]', b => { Object.assign(ni, { desc: b.dataset.ex, meas: null, equip: null, touchedM: false, touchedE: false }); $('#niDesc').value = ni.desc; upd(); $('#niStep').scrollIntoView({ block: 'nearest', behavior: 'smooth' }); });
  all('[data-nm]', b => { ni.meas = b.dataset.nm; ni.touchedM = true; if (!ni.touchedE) ni.equip = null; upd(); });
  on('#niEq', e => { ni.equip = e.target.value; ni.touchedE = true; upd(); }, 'change');
  on('#niGo', () => {
    const s = state(); if (!s.desc) { $('#niDesc').focus(); return; }
    const Ln = newLine(s.it); Ln.desc = s.desc;
    if (s.it.custom) { Ln.item = null; Ln.sec = s.equip && eqById(s.equip) && (eqById(s.equip).roles || []).includes('trench') ? 'util' : 'other'; }
    if (s.equip !== Ln.equip) {
      const a = Ln.equip ? eqById(Ln.equip) : null, b = s.equip ? eqById(s.equip) : null;
      if (a && b && !s.it.custom) Ln.prod = Ln.prod * (b.speed || 100) / (a.speed || 100);
      Ln.equip = s.equip;
    }
    if (Ln.equip) { P.equipOn = P.equipOn || {}; P.equipOn[Ln.equip] = true; }
    P.lines.push(Ln); ui.ni = null; save(); drawLines();
    measureLine(Ln, { geom: s.meas === 'lf' ? 'line' : s.meas === 'count' ? 'points' : 'poly', after: showItemResult });
  });
}
// ---- after an item is laid out: what it costs
function showItemResult(Ln) {
  ui.lineId = null; setTab('takeoff');
  const E = estimate(), b = E.byLine[Ln.id] || { hrs: 0, labor: 0, equip: 0, fuel: 0, matT: 0, total: 0 }, q = lineQty(Ln), R = P.rates;
  const share = E.direct ? b.total / E.direct : 0, oh = E.oh * share, pr = E.profit * share, eq = Ln.equip ? eqById(Ln.equip) : null;
  const rent = eq ? E.rentals.find(x => x.k === eq.id) : null;
  const unitTxt = q.unit === 'MSF' ? '1,000 SF' : q.unit;
  const card = $('#modalCard'); card.classList.remove('wide');
  card.innerHTML = `<div class="resh"><span class="tnum big" style="background:${lineColor(Ln)}">${lineNo(Ln)}</span><div><h2 style="margin:0">${esc(Ln.desc)}</h2><div class="muted">Laid out on the map and added to the takeoff</div></div></div>
    ${q.why ? `<div class="warn mt">${esc(q.why)}. Open Edit details to finish it.</div>` : `<div class="qtybig"><b>${num(q.qty, q.unit === 'AC' || q.unit === 'MSF' ? 2 : q.unit === 'TON' ? 1 : 0)}</b> ${esc(unitTxt)}</div>`}
    ${Ln.calc === 'pad' ? `<div class="slabrow"><div><span>Finish slab</span><b>${Ln.params.slabElev != null ? num(Ln.params.slabElev, 2) + ' ft' : 'not set'}</b>${q.pad ? `<small>pad ${num(q.pad.padElev, 2)} ft · cut ${num(q.pad.cutCY)} CY · fill ${num(q.pad.fillCY)} CY (+${Ln.params.extraPct}% = ${num(q.pad.dirtCY)})</small>` : ''}</div><button class="sec" id="irSlab" type="button">Change</button></div>` : ''}
    ${Ln.calc === 'pad' && q.pad && q.pad.netCY < -0.5 ? (() => { const mf = matInfo('fill'); return `<div class="slabrow"><div><span>Fill dirt to bring in</span><b>${num(-q.pad.netCY * (1 + P.factors.swellPct / 100))} CY × $${num(mf.price, 2)}</b><small>${mf.vendor ? esc(mf.vendor) + (mf.date ? ' · ' + esc(mf.date) : '') : 'starting price — enter your trucking quote'} · priced on the estimate under Earthwork</small></div><button class="sec" id="irFill" type="button">Enter quote</button></div>`; })() : ''}
    <table class="itemcost"><tbody>
      <tr><th scope="row">Material</th><td>${money(b.matT)}</td></tr>
      <tr><th scope="row">Labor<small>${num(b.hrs, 1)} hrs × $${num(R.operator * (1 + R.burdenPct / 100), 2)}/hr</small></th><td>${money(b.labor)}</td></tr>
      <tr><th scope="row">Equipment<small>${eq ? `${esc(eq.name)}${rent ? ` · ${esc(rent.how)}${rent.rented ? ' + waiver & tax' : ''}` : ''}` : 'by hand'}</small></th><td>${money(b.equip)}</td></tr>
      <tr><th scope="row">Fuel<small>diesel $${num(R.fuel, 2)}/gal</small></th><td>${money(b.fuel)}</td></tr>
      <tr class="sub"><th scope="row">Direct cost</th><td>${money(b.total)}</td></tr>
      <tr><th scope="row">${E.ohTxt}</th><td>${money(oh)}</td></tr>
      <tr><th scope="row">${E.profitTxt}</th><td>${money(pr)}</td></tr>
      <tr class="tot"><th scope="row">Item price</th><td>${money(b.total + oh + pr)}</td></tr>
    </tbody></table>
    <div class="muted" style="margin-top:6px">Equipment is the rental for the days this item needs, shared with other items on the same machine. Delivery and the truck &amp; trailer are on the estimate under Mobilization.</div>
    <button class="pri big mt" id="irNext" style="width:100%">＋ Next work item</button>
    <div class="row mt"><button class="sec" id="irEdit">Edit details</button><button class="sec" id="irEst">See estimate</button></div>
    <button class="sec mt" id="irOffice" style="width:100%">📤 Send to office</button>`;
  $('#modal').classList.remove('hidden');
  const close = () => $('#modal').classList.add('hidden');
  $('#irNext').onclick = () => { close(); openTakeoffEntry(); setTimeout(() => { const d = $('#niDesc'); if (d) d.scrollIntoView({ block: 'center' }); }, 50); };
  $('#irEdit').onclick = () => { close(); openLine(Ln.id); };
  $('#irEst').onclick = () => { close(); setTab('estimate'); };
  $('#irOffice').onclick = () => { close(); sendToOffice(); };
  if ($('#irFill')) $('#irFill').onclick = () => matEditor('fill', () => showItemResult(Ln), false);
  if ($('#irSlab')) $('#irSlab').onclick = async () => { close(); await askSlab(Ln); showItemResult(Ln); };
}
function lineHtml(Ln) {
  const n = lineNo(Ln), q = lineQty(Ln), C = CALC[Ln.calc] || CALC.ls, p = Ln.params || {};
  const E = estimate(), r = E.byLine[Ln.id];
  const unitTxt = q.unit === 'MSF' ? '1,000 SF' : q.unit;
  const eqOpts = `<option value="" ${!Ln.equip ? 'selected' : ''}>By hand / no machine</option>` + equipList().filter(e => !(e.roles || []).includes('support') || Ln.calc === 'hrs').map(e => `<option value="${esc(e.id)}" ${Ln.equip === e.id ? 'selected' : ''}>${esc(e.name)}${equipOn(e) ? ' ✓' : ''}</option>`).join('');
  const shapes = (Ln.shapes || []).map((s, i) => { const xy = s.pts.map(xyOf); const t = s.geom === 'points' ? `${s.pts.length} marked` : s.geom === 'line' ? `${num(G.lineLength(xy))} LF` : `${num(G.polyArea(xy))} SF`; return `<div class="shp"><span>${s.geom === 'points' ? 'Points' : s.geom === 'line' ? 'Run' : 'Outline'} ${i + 1} · ${t}</span><button class="dng" data-shdel="${i}" aria-label="Remove measurement ${i + 1}">✕</button></div>`; }).join('');
  const fin = (k, l, v, extra) => `<div><label for="lp_${k}">${l}</label><input id="lp_${k}" type="number" inputmode="decimal" step="any" data-lp="${k}" value="${v == null ? '' : v}" ${extra || ''}></div>`;
  let special = '';
  if (Ln.calc === 'pad') {
    const v = q.pad, padEl = p.slabElev != null ? p.slabElev - ((p.slabIn || 0) + (p.stoneIn || 0)) / 12 : null;
    special = `      <section class="slabbox"><label for="lp_slabElev">Finish slab elevation, ft</label>
      <div class="row"><input id="lp_slabElev" type="number" inputmode="decimal" step="0.01" data-lp="slabElev" value="${p.slabElev == null ? '' : p.slabElev}" placeholder="e.g. 421.5">${P.surface && (Ln.shapes || []).length ? '<button class="sec" id="lnBal" style="flex:0 0 auto">Balance</button>' : ''}</div>
      <div class="muted" style="margin-top:4px">${padEl != null ? `Pad top = slab − ${num((p.slabIn || 0) + (p.stoneIn || 0))}" = <b>${num(padEl, 2)} ft</b>. ` : ''}${p.slabElev == null ? 'Type the finished floor elevation so the app can figure the cut and fill.' : 'Change it any time — cut and fill update right away.'}</div>
      <button class="sec" id="lnSlab" style="width:100%;margin-top:8px">Ground elevations &amp; suggestions…</button></section>
${v ? `<div class="stats"><div class="stat cut"><b>${num(v.cutCY)}</b><span>Cut CY</span></div><div class="stat fill"><b>${num(v.fillCY)}</b><span>Fill CY</span></div><div class="stat fill"><b>${num(v.dirtCY)}</b><span>Dirt +${p.extraPct}%</span></div>
      <div class="stat"><b>${Math.abs(v.netCY) < 0.5 ? '0' : num(Math.abs(v.netCY))}</b><span>${Math.abs(v.netCY) < 0.5 ? 'Balanced' : v.netCY > 0 ? 'Extra dirt' : 'Import CY'}</span></div><div class="stat"><b>${num(v.padElev, 2)}</b><span>Pad elev</span></div><div class="stat"><b>${num(v.reach)}</b><span>Slopes reach ft</span></div></div>
      <div class="legend">Fill <i></i> Cut</div><div class="muted">House ${num(v.footprintArea)} sf · pad ${num(v.padArea)} sf · disturbed ${num(v.disturbedArea)} sf${v.cornerZ.length ? ` · ground at corners ${num(Math.min(...v.cornerZ), 1)}–${num(Math.max(...v.cornerZ), 1)} ft` : ''}</div>
      ${v.needSurface ? '<div class="warn">The side slopes run past the elevation data. <button class="sec" id="lnSurf" style="margin-top:6px;width:100%">Update surface</button></div>' : ''}` : ''}
      <h3>Pad settings</h3>
      <div class="grid2">${fin('offsetFt', 'Pad past house (ft)', p.offsetFt)}${fin('slope', 'Side slope (horiz : 1)', p.slope)}${fin('slabIn', 'Slab (in)', p.slabIn)}${fin('stoneIn', 'Stone under slab (in)', p.stoneIn)}${fin('extraPct', 'Extra dirt for compaction %', p.extraPct)}${fin('stripIn', 'Topsoil stripped first (in)', p.stripIn)}</div>`;
  } else if (Ln.calc === 'grade') {
    const v = q.grade;
    special = `${v ? `<div class="stats"><div class="stat cut"><b>${num(v.cutCY)}</b><span>Cut CY</span></div><div class="stat fill"><b>${num(v.fillCY)}</b><span>Fill CY</span></div><div class="stat"><b>${num(v.designElev, 2)}</b><span>Finish grade</span></div></div>` : ''}
      <h3>Finish grade</h3><div class="grid2">${fin('elev', 'Finish elevation (ft)', p.balance && v ? Math.round(v.designElev * 100) / 100 : p.elev, p.balance ? 'disabled' : '')}<div><label for="lp_balance">Auto-balance</label><select id="lp_balance" data-lpb="balance"><option value="1" ${p.balance ? 'selected' : ''}>On — solve elev</option><option value="0" ${!p.balance ? 'selected' : ''}>Off — use my elev</option></select></div>${fin('sectionIn', 'Section below finish (in)', p.sectionIn)}${fin('stripIn', 'Topsoil stripped first (in)', p.stripIn)}</div>`;
  } else if (Ln.calc === 'stone') {
    special = `<h3>Stone</h3><div class="grid2">${fin('widthFt', 'Width for runs (ft)', p.widthFt)}${fin('depthIn', 'Depth (in)', p.depthIn)}${fin('density', 'Tons per CY', p.density)}${fin('compactPct', 'Compaction allowance %', p.compactPct)}
      <div><label for="lp_fabric">Geotextile fabric</label><select id="lp_fabric" data-lpb="fabric"><option value="0" ${!p.fabric ? 'selected' : ''}>No</option><option value="1" ${p.fabric ? 'selected' : ''}>Yes</option></select></div></div>
      <div class="muted mt">${num(q.sf || 0)} SF · ${num(q.cy || 0, 1)} CY in place${q.fabricSY ? ` · fabric ${num(q.fabricSY)} SY` : ''}</div>`;
  } else if (Ln.calc === 'cyDepth') special = `<div class="grid2">${fin('depthIn', 'Depth (in)', p.depthIn)}</div><div class="muted mt">${num(q.areaSF)} SF outlined</div>`;
  else if (Ln.calc === 'lf' && p.purpose != null) special = `<div class="grid2"><div><label for="lp_purpose">What it's for</label><input id="lp_purpose" data-lpt="purpose" value="${esc(p.purpose || '')}"></div>${fin('depthIn', 'Depth (in)', p.depthIn)}</div>`;
  const qtyBig = q.why ? `<div class="warn">${esc(q.why)}</div>` : `<div class="qtybig"><b>${num(q.qty, q.unit === 'AC' || q.unit === 'MSF' ? 2 : q.unit === 'TON' ? 1 : 0)}</b> ${esc(unitTxt)}${q.typed ? ' <small>typed</small>' : ''}</div>`;
  return `<div class="row" style="margin-bottom:6px"><button class="sec" id="lnBack" style="flex:0 0 auto">‹ Takeoff</button><span class="tnum big" style="background:${lineColor(Ln)}">${n}</span><button class="dng" id="lnDel" style="flex:0 0 auto">Delete</button></div>
    <label for="lnDesc">Work item</label><input id="lnDesc" data-lf="desc" value="${esc(Ln.desc)}">
    <div class="muted" style="margin-top:4px">${esc(C.label)}</div>
    ${Ln.calc === 'ls' ? '' : qtyBig}
    ${C.geom ? `<div class="row mt"><button class="pri big" id="lnMeasure">📏 Measure on the map</button></div>
      ${shapes ? `<div class="shps">${shapes}</div>` : ''}
      ${Ln.calc === 'pad' || Ln.calc === 'grade' ? '' : `<label for="lnTyped">Or type the quantity (${esc(unitTxt)})</label><div class="row"><input id="lnTyped" type="number" inputmode="decimal" step="any" data-lf="typed" value="${Ln.typed == null ? '' : Ln.typed}" placeholder="Leave blank to use the map">${Ln.typed != null ? '<button class="sec" id="lnUntype" style="flex:0 0 auto">Use map</button>' : ''}</div>`}` : ''}
    ${Ln.calc === 'hrs' ? `<label for="lnTyped">Hours</label><input id="lnTyped" type="number" inputmode="decimal" step="0.5" data-lf="typed" value="${Ln.typed == null ? '' : Ln.typed}">` : ''}
    ${special}
    <h3>Pricing</h3>
    <div class="grid2">
      ${Ln.calc === 'ls' ? '' : `<div><label for="lnEq">Equipment</label><select id="lnEq" data-lf="equip">${eqOpts}</select></div>`}
      ${['ls', 'hrs'].includes(Ln.calc) ? '' : `<div><label for="lnProd">${Ln.calc === 'pad' || Ln.calc === 'grade' ? 'CY moved per hour' : `${esc(unitTxt)} per hour`}</label><input id="lnProd" type="number" inputmode="decimal" step="any" data-lf="prod" value="${Ln.prod}"></div>`}
      ${Ln.calc === 'ls' ? '' : `<div class="full"><label for="lnMatK">Material</label><select id="lnMatK" data-lf="matKey"><option value="">${Ln.calc === 'msf' ? 'Seed mix / my own price' : 'None or my own price'}</option>${matDefs().map(d => { const mm = matInfo(d.key); return `<option value="${esc(d.key)}" ${Ln.matKey === d.key ? 'selected' : ''}>${esc(d.name)} — $${num(mm.price, 2)}/${esc(d.unit)}</option>`; }).join('')}</select></div>`}
      ${Ln.matKey && matDef(Ln.matKey) ? (() => { const mm = matInfo(Ln.matKey), dd = mm.def; return `<div class="full matnote">$${num(mm.price, 2)} per ${esc(dd.unit)}${mm.vendor ? ' · ' + esc(mm.vendor) : ''}${mm.date ? ' · ' + esc(mm.date) : ''}${dd.unit !== q.unit && !(Ln.calc === 'pad' || Ln.calc === 'grade') ? `<br><b>Check:</b> priced per ${esc(dd.unit)} but this item is measured in ${esc(unitTxt)}.` : ''} <button class="sec" id="lnMatEdit" type="button">Enter quote</button></div>`; })()
        : `<div><label for="lnMat">${Ln.calc === 'ls' ? 'Price $' : `Material $ per ${esc(unitTxt)}`}</label><input id="lnMat" type="number" inputmode="decimal" step="any" data-lf="mat" value="${Ln.mat == null ? '' : Ln.mat}" placeholder="${Ln.calc === 'msf' ? 'seed mix from Rates' : '0'}"></div>`}
      ${Ln.sec === 'clear' ? `<div><label for="lnLoads">Debris truckloads per ${esc(unitTxt)}</label><input id="lnLoads" type="number" inputmode="decimal" step="any" data-lf="loads" value="${Ln.loads || 0}"></div>` : ''}
    </div>
    ${r ? `<div class="stats mt"><div class="stat"><b>${num(r.hrs, 1)}</b><span>Hours</span></div><div class="stat"><b>${money(r.labor + r.fuel)}</b><span>Labor + fuel</span></div><div class="stat"><b>${money(r.equip)}</b><span>Equipment</span></div><div class="stat"><b>${money(r.matT)}</b><span>Material</span></div><div class="stat"><b>${money(r.total)}</b><span>Line cost</span></div><div class="stat"><b>${money(r.total * (E.direct ? E.total / E.direct : 1))}</b><span>With OH &amp; profit</span></div></div>` : ''}
    <div class="row mt"><button class="sec" id="lnLib">Save as my default for “${esc((libById(Ln.item) || {}).name || 'this item')}”</button></div>`;
}
function measureLine(Ln, o = {}) {
  const C = CALC[Ln.calc]; if (!C || !C.geom) return;
  const go = geom => {
    const n = lineNo(Ln), noun = geom === 'points' ? 'one' : geom === 'line' ? 'point' : 'corner';
    const msg = geom === 'points' ? `#${n} ${Ln.desc}: stand at each one and tap Mark, or tap them on the map` : geom === 'line' ? `#${n} ${Ln.desc}: walk the run — tap Mark at each bend, use Trace, or tap the map` : `#${n} ${Ln.desc}: walk the edge — Mark each corner, use Trace, or tap the map`;
    startDraw(geom, async pts => {
      if (Ln.calc === 'pad' || Ln.calc === 'grade') Ln.shapes = [];
      Ln.shapes.push({ id: uid(), geom, pts }); Ln.typed = null;
      calcCache.clear(); save();
      if (Ln.calc === 'pad') await askSlab(Ln);
      if (Ln.calc === 'grade') { await ensureSurfaceFor(Ln); if (Ln.params.elev == null) { const a = pseudoArea(Ln); if (a) { seedElev(a); Ln.params.elev = a.p.elev; } } }
      calcCache.clear(); save(); if (o.after) o.after(Ln); else openLine(Ln.id);
    }, msg, { gps: true, noun, trace: geom !== 'points' });
  };
  if (o.geom) go(o.geom);
  else if (C.geom === 'line|poly') choiceBox('Measure stone', '', [['line', 'Run — centerline × width', 'Driveways and paths'], ['poly', 'Outline', 'Parking pads and odd shapes'], ['cancel', 'Cancel', '']]).then(k => { if (k !== 'cancel') go(k); });
  else go(C.geom);
}
// ---- building pad: ask for the finish slab elevation so the cut & fill can be figured
async function ensureSurfaceFor(Ln) {
  const a = pseudoArea(Ln); if (!a) return;
  const xy = a.pts.map(xyOf), ext = (Ln._ext || []).map(xyOf);
  if (!P.surface || !G.covers(P.surface, xy.concat(ext))) { toast('Getting ground elevations for the pad…', 3000); await buildSurface(); calcCache.clear(); }
}
function askSlab(Ln) {
  return new Promise(async resolve => {
    await ensureSurfaceFor(Ln);
    const a = pseudoArea(Ln); if (!a) return resolve(false);
    const p = Ln.params, xy = a.pts.map(xyOf);
    const zs = P.surface ? xy.map(([x, y]) => G.zAt(P.surface, x, y)).filter(z => z != null) : [];
    const lo = zs.length ? Math.min(...zs) : null, hi = zs.length ? Math.max(...zs) : null, avg = zs.length ? zs.reduce((t, z) => t + z, 0) / zs.length : null;
    const step = ((p.slabIn || 0) + (p.stoneIn || 0)) / 12;
    let bal = null;
    if (zs.length) { try { bal = Math.round(G.padBalanceSlab(P.surface, xy, Object.assign({}, a.p, { slabElev: p.slabElev != null ? p.slabElev : avg + step })) * 10) / 10; } catch (e) { bal = null; } }
    const hiSug = hi != null ? Math.ceil((hi + 0.5) * 2) / 2 : null;
    const card = $('#modalCard'); card.classList.remove('wide');
    card.innerHTML = `<h2 style="margin:0 0 4px">Finish slab elevation</h2>
      <div class="muted">#${lineNo(Ln)} ${esc(Ln.desc)} · ${num(G.polyArea(xy))} sf house</div>
      ${zs.length ? `<div class="stats"><div class="stat"><b>${num(lo, 1)}</b><span>Ground low</span></div><div class="stat"><b>${num(avg, 1)}</b><span>Average</span></div><div class="stat"><b>${num(hi, 1)}</b><span>Ground high</span></div></div>
        <div class="muted" style="margin-top:-2px">Ground at the house corners, from USGS elevation data (ft).</div>` : '<div class="warn">No ground elevations here yet, so cut and fill can’t be figured until the elevation data loads (Site tab → Build surface).</div>'}
      <label for="slabV">Finish slab (finished floor) elevation, ft</label>
      <input id="slabV" type="number" inputmode="decimal" step="0.01" value="${p.slabElev != null ? p.slabElev : hiSug != null ? hiSug : ''}" placeholder="e.g. 421.5">
      <div class="muted" id="slabPad" style="margin-top:4px"></div>
      ${zs.length ? `<div class="row mt"><button class="sec" type="button" data-sv="${hiSug}">High corner + 6": ${num(hiSug, 1)}</button>${bal != null ? `<button class="sec" type="button" data-sv="${bal}">Balance cut &amp; fill: ${num(bal, 1)}</button>` : ''}</div>` : ''}
      <div class="row" style="margin-top:16px"><button class="sec" id="slabSkip" type="button">Later</button><button class="pri" id="slabOk" type="button">Figure cut &amp; fill</button></div>`;
    $('#modal').classList.remove('hidden');
    const inp = $('#slabV'), upd = () => { const v = parseFloat(inp.value); $('#slabPad').innerHTML = isFinite(v) ? `Pad top = slab − ${num((p.slabIn || 0) + (p.stoneIn || 0))}" (${num(p.slabIn)}" slab + ${num(p.stoneIn)}" stone) = <b>${num(v - step, 2)} ft</b>. Pad runs ${num(p.offsetFt)} ft past the house with ${num(p.slope)}:1 slopes.` : ''; };
    upd(); inp.oninput = upd;
    card.querySelectorAll('[data-sv]').forEach(b => b.onclick = () => { inp.value = b.dataset.sv; upd(); });
    inp.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); $('#slabOk').click(); } };
    $('#slabSkip').onclick = () => { $('#modal').classList.add('hidden'); resolve(false); };
    $('#slabOk').onclick = async () => {
      const v = parseFloat(inp.value);
      if (!isFinite(v)) { toast('Type the slab elevation, e.g. 421.5'); inp.focus(); return; }
      if (lo != null && (v < lo - 40 || v > hi + 40)) { toast(`${num(v, 1)} is far from the ground here (${num(lo, 0)}–${num(hi, 0)} ft) — check it`, 4000); return; }
      p.slabElev = Math.round(v * 100) / 100; calcCache.clear(); save();
      $('#modal').classList.add('hidden');
      const q = lineQty(Ln); if (q.pad && q.pad.needSurface) { await buildSurface(); calcCache.clear(); }
      resolve(true);
    };
    setTimeout(() => { if (document.body.contains(inp)) inp.select(); }, 80);
  });
}
function bindTakeoff(all, on) {
  on('#lnSlab', async () => { const Ln = P.lines.find(x => x.id === ui.lineId); if (Ln && (Ln.shapes || []).length) { await askSlab(Ln); openLine(Ln.id); } else toast('Lay out the house corners first'); });
  on('#tkAdd', addLineDialog);
  on('#tkOffice', sendToOffice);
  on('#tkMat', () => openMatBook());
  bindNewItem(all, on);
  on('#tkEst', () => setTab('estimate'));
  on('#tkPlan', planDialog);
  all('[data-line]', b => openLine(b.dataset.line));
  all('[data-meas]', b => { const Ln = P.lines.find(x => x.id === b.dataset.meas); if (Ln) measureLine(Ln); });
  const Ln = P.lines.find(x => x.id === ui.lineId); if (!Ln) return;
  const done = () => { calcCache.clear(); save(); drawLines(); render(); };
  on('#lnMatEdit', () => matEditor(Ln.matKey, () => openLine(Ln.id), false));
  on('#lnBack', () => { ui.lineId = null; drawLines(); render(); });
  on('#lnDel', async () => { if (await confirmBox(`Delete line ${lineNo(Ln)}: ${Ln.desc}?`, 'Delete')) { P.lines = P.lines.filter(x => x !== Ln); ui.lineId = null; done(); } });
  on('#lnMeasure', () => measureLine(Ln));
  on('#lnUntype', () => { Ln.typed = null; done(); });
  on('#lnSurf', () => { setTab('site'); buildSurface().then(() => openLine(Ln.id)); });
  on('#lnBal', () => { const a = pseudoArea(Ln); if (!a || Ln.params.slabElev == null) { toast('Enter a slab elevation first'); return; } Ln.params.slabElev = Math.round(G.padBalanceSlab(P.surface, a.pts.map(xyOf), a.p) * 10) / 10; done(); toast(`Slab set to ${num(Ln.params.slabElev, 1)} ft to balance the pad`); });
  on('#lnLib', () => {
    const it = itemLib().find(i => i.id === Ln.item);
    if (!it) { itemLib().push({ id: 'it' + uid(), name: Ln.desc, calc: Ln.calc, sec: Ln.sec, role: Ln.role, equip: Ln.equip, prod: Ln.prod, mat: Ln.mat, loads: Ln.loads, params: clone(Ln.params) }); }
    else Object.assign(it, { equip: Ln.equip, prod: Ln.prod, mat: Ln.mat, loads: Ln.loads, params: Object.assign(clone(Ln.params), it.calc === 'pad' ? { slabElev: null } : {}) });
    save(true); toast('Saved to your item library for future takeoffs');
  });
  all('[data-lf]', e => {
    const k = e.dataset.lf;
    if (k === 'desc') Ln.desc = e.value;
    else if (k === 'equip') {   // a slower machine does less per hour: scale the rate by the machines' speeds
      const old = Ln.equip ? eqById(Ln.equip) : null, nw = e.value ? eqById(e.value) : null;
      if (old && nw && Ln.prod > 0) { Ln.prod = Math.round(Ln.prod * (nw.speed || 100) / (old.speed || 100) * 1000) / 1000; toast(`Rate set to ${num(Ln.prod, Ln.prod < 10 ? 2 : 0)} per hour for the ${nw.name} — change it if you know better`); }
      Ln.equip = e.value; if (e.value) { P.equipOn = P.equipOn || {}; P.equipOn[e.value] = true; }
    }
    else if (k === 'typed') { const v = parseFloat(e.value); Ln.typed = isFinite(v) ? v : null; }
    else if (k === 'matKey') { if (!e.value && Ln.matKey) Ln.mat = matPrice(Ln.matKey); Ln.matKey = e.value || null; }
    else if (k === 'mat') { const v = parseFloat(e.value); Ln.mat = isFinite(v) ? v : (Ln.calc === 'msf' ? null : 0); }
    else { const v = parseFloat(e.value); Ln[k] = isFinite(v) ? v : 0; }
    done();
  }, 'change');
  all('[data-lp]', e => { const v = parseFloat(e.value); Ln.params[e.dataset.lp] = isFinite(v) ? v : (e.dataset.lp === 'slabElev' || e.dataset.lp === 'elev' ? null : 0); done(); }, 'change');
  all('[data-lpb]', e => { Ln.params[e.dataset.lpb] = e.value === '1'; if (e.dataset.lpb === 'balance' && !Ln.params.balance) { const q = lineQty(Ln); if (q.grade) Ln.params.elev = Math.round(q.grade.designElev * 100) / 100; } done(); }, 'change');
  all('[data-lpt]', e => { Ln.params[e.dataset.lpt] = e.value; done(); }, 'change');
  all('[data-shdel]', e => { Ln.shapes.splice(+e.dataset.shdel, 1); done(); });
}
// ---- pick a work item from your library
function addLineDialog() {
  const lib = itemLib(), card = $('#modalCard'); card.classList.remove('wide');
  const groups = Object.keys(SECKEY).map(k => ({ k, items: lib.filter(i => (i.sec || 'other') === k) })).filter(g => g.items.length);
  card.innerHTML = `<div class="row" style="margin-bottom:6px"><h2 style="margin:0">Add a line</h2><button class="sec" id="alClose" style="flex:0 0 auto">Close</button></div>
    <input id="alFind" type="search" placeholder="Search work items…" aria-label="Search work items" autocomplete="off">
    <div id="alList" class="liblist">${groups.map(g => `<div class="libgrp"><h3>${esc(SECKEY[g.k])}</h3>${g.items.map(i => `<button class="item" data-pick="${esc(i.id)}"><div class="t"><b>${esc(i.name)}</b><small>${esc(CALC[i.calc] ? CALC[i.calc].label : '')}${i.equip && eqById(i.equip) ? ' · ' + esc(eqById(i.equip).name) : ''}</small></div>＋</button>`).join('')}</div>`).join('')}</div>
    <div class="row mt"><button class="sec" id="alCustom">Custom line…</button><button class="sec" id="alEdit">Edit library…</button></div>`;
  $('#modal').classList.remove('hidden');
  const close = () => $('#modal').classList.add('hidden');
  $('#alClose').onclick = close;
  $('#alFind').oninput = e => { const q = e.target.value.toLowerCase(); card.querySelectorAll('[data-pick]').forEach(b => { b.hidden = !b.textContent.toLowerCase().includes(q); }); card.querySelectorAll('.libgrp').forEach(g => { g.hidden = ![...g.querySelectorAll('[data-pick]')].some(b => !b.hidden); }); };
  card.querySelectorAll('[data-pick]').forEach(b => b.onclick = () => { close(); const L = newLine(libById(b.dataset.pick)); P.lines.push(L); save(); openLine(L.id); });
  $('#alEdit').onclick = () => { close(); libraryEditor(); };
  $('#alCustom').onclick = async () => {
    close();
    const v = await form('Custom line', [
      { key: 'name', label: 'Work item', value: '', placeholder: 'e.g. Dig footing for retaining wall' },
      { key: 'calc', label: 'Measure as', type: 'select', value: 'lf', options: Object.entries(CALC).map(([k, c]) => [k, c.label]) },
      { key: 'sec', label: 'Section', type: 'select', value: 'other', options: Object.entries(SECKEY) },
      { key: 'equip', label: 'Equipment', type: 'select', value: '', options: [['', 'By hand / no machine']].concat(equipList().map(e => [e.id, e.name])) },
      { key: 'prod', label: 'Units per hour (0 = material only)', type: 'number', value: 50 },
      { key: 'mat', label: 'Material $ per unit (or price for lump sum)', type: 'number', value: 0 }
    ], 'Add line');
    if (!v || !v.name) return;
    const it = { id: 'it' + uid(), name: v.name, calc: v.calc, sec: v.sec, role: null, equip: v.equip, prod: v.prod || 0, mat: v.mat || 0, loads: 0, params: v.calc === 'pad' ? clone(PAD_PARAMS) : v.calc === 'stone' ? { widthFt: 12, depthIn: 6, density: 1.5, compactPct: 15, fabric: false } : v.calc === 'cyDepth' ? { depthIn: 6 } : v.calc === 'grade' ? clone(libById('grade').params) : {} };
    itemLib().push(it); save(true);
    const L = newLine(it); P.lines.push(L); save(); openLine(L.id); toast('Added — also saved to your item library');
  };
}
// ---- edit the saved item library (reused on every takeoff)
function libraryEditor() {
  const work = clone(itemLib()), card = $('#modalCard'); card.classList.add('wide');
  const draw = () => {
    const eqSel = (i, v) => `<select class="cin" data-ik="equip" data-i="${i}" aria-label="Default equipment"><option value="">By hand</option>${equipList().map(e => `<option value="${esc(e.id)}" ${v === e.id ? 'selected' : ''}>${esc(e.name)}</option>`).join('')}</select>`;
    card.innerHTML = `<div class="row" style="margin-bottom:6px"><h2 style="margin:0">Work item library</h2><button class="sec" id="liClose" style="flex:0 0 auto">Cancel</button></div>
      <p class="muted" style="margin:0 0 8px">The list you pick from when you add a takeoff line. Saved on this phone for every job.</p>
      <div class="sheetwrap" role="region" aria-label="Item library" tabindex="0"><table class="sheet eqedit libedit"><thead><tr><th scope="col">Work item</th><th scope="col">Measure as</th><th scope="col">Section</th><th scope="col">Equipment</th><th scope="col">Units / hr</th><th scope="col">Material $ / unit</th><th scope="col">Debris loads / unit</th><th scope="col"><span class="sr">Remove</span></th></tr></thead>
      <tbody>${work.map((it, i) => `<tr><th scope="row"><input class="cin nm" data-ik="name" data-i="${i}" value="${esc(it.name)}" aria-label="Work item name"></th>
        <td><select class="cin" data-ik="calc" data-i="${i}" aria-label="Measure as">${Object.entries(CALC).map(([k, c]) => `<option value="${k}" ${it.calc === k ? 'selected' : ''}>${esc(c.label.split(' — ')[0])} (${c.unit})</option>`).join('')}</select></td>
        <td><select class="cin" data-ik="sec" data-i="${i}" aria-label="Section">${Object.entries(SECKEY).map(([k, l]) => `<option value="${k}" ${it.sec === k ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></td>
        <td>${eqSel(i, it.equip)}</td>
        ${['prod', 'mat', 'loads'].map(k => `<td><input class="cin" type="number" inputmode="decimal" step="any" data-ik="${k}" data-i="${i}" value="${it[k] == null ? '' : it[k]}" aria-label="${esc(it.name)} ${k}"></td>`).join('')}
        <td><button class="dng" data-idel="${i}" style="padding:4px 8px" aria-label="Remove ${esc(it.name)}">✕</button></td></tr>`).join('')}</tbody></table></div>
      <div class="row mt"><button class="sec" id="liReset">Reset to starting list</button><button class="pri" id="liSave">Save library</button></div>
      <div class="muted mt">Units / hr is your production, e.g. 100 LF of trench per hour. Debris loads feed the haul-off line automatically.</div>`;
    card.querySelectorAll('[data-ik]').forEach(el => el.onchange = () => { const it = work[+el.dataset.i], k = el.dataset.ik; it[k] = ['name', 'calc', 'sec', 'equip'].includes(k) ? el.value : (el.value === '' && k === 'mat' ? null : (parseFloat(el.value) || 0)); });
    card.querySelectorAll('[data-idel]').forEach(b => b.onclick = () => { work.splice(+b.dataset.idel, 1); draw(); });
    $('#liReset').onclick = () => { work.splice(0, work.length, ...clone(DEFAULT_ITEMS)); draw(); };
    $('#liClose').onclick = () => { $('#modal').classList.add('hidden'); card.classList.remove('wide'); };
    $('#liSave').onclick = () => { store.items = work; save(true); $('#modal').classList.add('hidden'); card.classList.remove('wide'); toast('Item library saved for future takeoffs'); };
  };
  draw(); $('#modal').classList.remove('hidden');
}
// ---- a marked feature can go straight onto the takeoff with its shape
function featureToLine(f) {
  let itemId = 'allow', shapes = [], patch = {};
  const shp = [{ id: uid(), geom: f.geom === 'point' ? 'points' : f.geom, pts: f.pts }];
  if (f.type === 'tree') { const d = f.dbh || 12; itemId = f.status === 'proposed' ? 'plant' : d < 12 ? 'treeS' : d <= 24 ? 'treeM' : 'treeL'; const ex = P.lines.find(x => x.item === itemId); if (ex) { const ps = ex.shapes.find(s => s.geom === 'points'); if (ps) ps.pts.push(f.pts[0]); else ex.shapes.push(shp[0]); save(); openLine(ex.id); toast(`Added to line ${lineNo(ex)}`); return; } shapes = shp; }
  else if (f.type === 'woods') { itemId = { light: 'clearL', medium: 'clearM', heavy: 'clearH' }[f.density || 'medium']; shapes = shp; patch.desc = `Clear & grub — ${featName(f)}`; }
  else if (f.type === 'house' && f.geom === 'poly' && f.status !== 'remove') { itemId = 'pad'; shapes = shp; patch.desc = `Building pad — ${featName(f)}`; }
  else if (['house', 'shed', 'pool'].includes(f.type) && f.geom === 'poly') { itemId = 'demo'; shapes = shp; patch.desc = `Demolish ${featName(f)}`; }
  else if (f.type === 'driveway') { itemId = f.status === 'remove' ? 'pave' : 'stone'; shapes = itemId === 'pave' && f.geom === 'line' ? [] : shp; patch.desc = f.status === 'remove' ? `Remove ${featName(f)} paving` : `Driveway stone — ${featName(f)}`; if (itemId === 'pave' && f.geom === 'line') patch.typed = G.lineLength(f.pts.map(xyOf)) * (f.widthFt || 12); }
  else if (f.type === 'fence' || f.type === 'wall') { itemId = f.status === 'remove' ? 'fenceRm' : 'allow'; shapes = itemId === 'fenceRm' ? shp : []; patch.desc = `${f.status === 'remove' ? 'Remove' : 'Install'} ${featName(f)}`; }
  else patch.desc = `${f.status === 'remove' ? 'Remove' : f.status === 'proposed' ? 'Install' : ''} ${featName(f)}`.trim();
  const L = newLine(libById(itemId)); L.shapes = shapes; Object.assign(L, patch);
  P.lines.push(L); calcCache.clear(); save(); openLine(L.id); toast(`Added as line ${lineNo(L)}`);
}

store.projects.forEach(p => { migrateLines(p); p.lines = p.lines || []; });

// ======================================================================
// Proposal for owners / general contractors
// ======================================================================
const DEFAULT_EXCLUSIONS = [
  'Rock excavation, or removal of buried debris or trash (priced separately if found)',
  'Permits, fees, surveying and stakeout',
  'Stone under slab, footings, foundation and concrete work',
  'Pipe, conduit, wire and utility connections (trenching and backfill only unless listed); utility relocation; damage to unmarked private utilities',
  'Erosion control, seed and straw unless listed above',
  'Undercut or replacement of unsuitable soils',
  'Stump grinding (stumps are dug out)'
];
const DEFAULT_TERMS = [
  'Price is based on site conditions observed at the time of the walk. Changes in scope or hidden conditions will be billed as extra work at agreed rates.',
  'Payment: 50% deposit on acceptance, balance due on completion.',
  'Owner / GC to provide clear access to the site and mark property lines.',
  'Quantities are estimates from a GPS site walk and USGS elevation data, not a survey.'
];
function scopeLines(E) {
  const out = [], R = P.rates, has = id => E.rows.some(r => r.asm === id), priced = new Set(E.rows.map(r => r.lineId).filter(Boolean));
  if (has('deliver')) out.push('Bring equipment to the site and remove it when the work is complete.');
  P.lines.filter(Ln => priced.has(Ln.id)).forEach(Ln => {
    const q = lineQty(Ln), p = Ln.params || {}, d = Ln.desc.replace(/\.$/, ''), qt = (n, u, dd) => `about ${num(n, dd || 0)} ${u}`;
    switch (Ln.calc) {
      case 'count': out.push(Ln.sec === 'clear' ? `${d}: ${num(q.qty)} ${q.qty === 1 ? 'tree' : 'trees'}. Trees are pushed over and the stumps and root balls dug out (no stump grinding).` : `${d}: ${num(q.qty)} EA.`); break;
      case 'ac': out.push(`${d}: ${qt(q.qty, 'acre', 2)}.${Ln.sec === 'clear' ? ' Trees pushed over, stumps and roots dug out.' : ''}`); break;
      case 'pad': { const v = q.pad; out.push(`${d}: pad extends ${num(p.offsetFt)} ft past the house (about ${num(v.padArea)} SF), top of pad at elevation ${num(v.padElev, 2)} (slab ${num(p.slabElev, 2)} less ${num(p.slabIn)}" slab and ${num(p.stoneIn)}" stone), with ${num(p.slope)}:1 side slopes to existing grade. About ${num(v.cutCY)} CY cut and ${num(v.dirtCY)} CY of fill placed and compacted in lifts.`); break; }
      case 'grade': { const v = q.grade; out.push(`${d}: grade to finish elevation ${num(v.designElev, 2)} (about ${num(v.cutCY)} CY cut, ${num(v.fillCY)} CY fill).`); break; }
      case 'stone': out.push(`${d}: furnish and install ${num(p.depthIn)}" of stone, ${qt(q.sf, 'SF')} (${num(q.qty)} tons)${p.fabric ? ' over geotextile fabric' : ''}.`); break;
      case 'lf': out.push(p.purpose != null ? `${d}: dig and backfill ${qt(q.qty, 'LF')} of ${String(p.purpose || 'utility').toLowerCase()} trench, about ${num(p.depthIn)}" deep${Ln.mat ? ' (pipe or conduit included)' : ' (pipe, conduit and wire by others)'}.` : `${d}: ${qt(q.qty, 'LF')}.`); break;
      case 'cyDepth': out.push(`${d}: ${num(p.depthIn)}" over ${qt(q.areaSF, 'SF')} (${num(q.qty)} CY).`); break;
      case 'msf': out.push(`${d}: ${qt(q.qty * 1000, 'SF')}.`); break;
      case 'sf': out.push(`${d}: ${qt(q.qty, 'SF')}.`); break;
      case 'hrs': out.push(`${d}: ${num(q.qty, 1)} hours.`); break;
      case 'ls': out.push(`${d}: allowance of ${money(Ln.mat || 0)}.`); break;
    }
  });
  if (E.loads > 0.01) out.push(R.debris === 'haul' ? 'Load and haul tree and demolition debris off site.' : R.debris === 'pile' ? 'Pile tree and demolition debris on site where the owner directs.' : 'Pile and burn debris on site where permitted (burn permit by owner).');
  if (has('import')) out.push(`Furnish and place about ${num(E.rows.find(r => r.asm === 'import').qty)} CY of fill dirt.`);
  if (has('export')) out.push('Load and haul excess dirt off site.');
  E.rows.filter(r => r.scope && r.scope.slopes).forEach(r => out.push(`Seed, fertilize, lime and straw about ${num(r.scope.sf)} SF of pad side slopes by hand.`));
  return out;
}
function proposalData() {
  P.proposal = P.proposal || {};
  const pr = P.proposal, co = store.company = store.company || {};
  if (!pr.number) pr.number = new Date().toISOString().slice(2, 10).replace(/-/g, '') + '-' + String(store.projects.indexOf(P) + 1).padStart(2, '0');
  if (!pr.date) pr.date = new Date().toISOString().slice(0, 10);
  if (pr.validDays == null) pr.validDays = 30;
  if (pr.includePlan == null) pr.includePlan = true;
  if (pr.breakdown == null) pr.breakdown = false;
  return { pr, co };
}
function proposalHTML() {
  const E = estimate(), { pr, co } = proposalData();
  const price = pr.price != null ? pr.price : Math.ceil(E.total / 50) * 50;
  const scope = (pr.scope != null ? pr.scope.split('\n') : scopeLines(E)).map(s => s.trim()).filter(Boolean);
  const excl = (pr.exclusions != null ? pr.exclusions : DEFAULT_EXCLUSIONS.join('\n')).split('\n').map(s => s.trim()).filter(Boolean);
  const terms = (pr.terms != null ? pr.terms : DEFAULT_TERMS.join('\n')).split('\n').map(s => s.trim()).filter(Boolean);
  const dt = pr.date ? new Date(pr.date + 'T12:00:00').toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : '';
  const lines = t => esc(t || '').replace(/\n/g, '<br>');
  const plan = pr.includePlan ? planSVG() : null;
  const brk = pr.breakdown ? `<table class="brk"><tbody>${E.secs.map(s => `<tr><td>${esc(s.name)}</td><td>${money(s.total / (E.direct || 1) * price)}</td></tr>`).join('')}</tbody></table>` : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Proposal ${esc(pr.number)} — ${esc(P.name)}</title>
<style>
body{font-family:Georgia,"Times New Roman",serif;color:#1d1d1d;background:#fff;max-width:7.5in;margin:0 auto;padding:28px 20px;font-size:12.5px;line-height:1.45}
h1{font:700 26px/1.1 Helvetica,Arial,sans-serif;letter-spacing:.08em;margin:0;color:#1d1d1d}
.hd{display:flex;justify-content:space-between;gap:20px;border-bottom:3px solid #1d1d1d;padding-bottom:12px;margin-bottom:16px;flex-wrap:wrap}
.co b{font:700 17px Helvetica,Arial,sans-serif;display:block}.co{font-family:Helvetica,Arial,sans-serif;font-size:11.5px;color:#333}
.meta{text-align:right;font-family:Helvetica,Arial,sans-serif;font-size:11.5px}
.two{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin:12px 0 4px}
.lbl{font:700 10px Helvetica,Arial,sans-serif;letter-spacing:.12em;text-transform:uppercase;color:#6b5a3e;margin:16px 0 4px}
ol,ul{margin:4px 0 0 18px;padding:0}li{margin:3px 0}
.price{border:2px solid #1d1d1d;padding:12px 16px;display:flex;justify-content:space-between;align-items:center;margin:14px 0;font-family:Helvetica,Arial,sans-serif}
.price b{font-size:22px}.brk{width:100%;border-collapse:collapse;font-family:Helvetica,Arial,sans-serif;font-size:11.5px;margin-top:-6px}.brk td{border-bottom:1px solid #ddd;padding:4px 2px}.brk td:last-child{text-align:right}
.sig{display:grid;grid-template-columns:1fr 1fr;gap:28px;margin-top:22px}.sig div{border-top:1px solid #1d1d1d;padding-top:4px;font:11px Helvetica,Arial,sans-serif;margin-top:38px}
.plan{page-break-before:always;margin-top:24px}.plan svg{width:100%;height:auto}
.fine{font-size:10.5px;color:#555}
@media print{@page{size:letter;margin:.5in}body{padding:0}}
</style></head><body>
<div class="hd"><div class="co"><b>${esc(co.name || 'Your company name')}</b>${lines(co.address)}${co.phone ? '<br>' + esc(co.phone) : ''}${co.email ? ' · ' + esc(co.email) : ''}${co.license ? '<br>License ' + esc(co.license) : ''}</div>
<div class="meta"><h1>PROPOSAL</h1>No. ${esc(pr.number)}<br>${esc(dt)}</div></div>
<div class="two"><div><div class="lbl">Prepared for</div>${esc(pr.clientName || '')}${pr.clientCo ? '<br>' + esc(pr.clientCo) : ''}${pr.clientAddr ? '<br>' + lines(pr.clientAddr) : ''}${pr.clientPhone ? '<br>' + esc(pr.clientPhone) : ''}${pr.clientEmail ? '<br>' + esc(pr.clientEmail) : ''}</div>
<div><div class="lbl">Project</div>${esc(P.name)}${(pr.siteAddr || P.address) ? '<br>' + esc(pr.siteAddr || P.address) : ''}</div></div>
<div class="lbl">Scope of work</div><ol>${scope.map(s => `<li>${esc(s)}</li>`).join('')}</ol>
<div class="price"><span>Lump sum price for the work above</span><b>${money(price)}</b></div>${brk}
<div class="lbl">Not included</div><ul>${excl.map(s => `<li>${esc(s)}</li>`).join('')}</ul>
<div class="lbl">Terms</div><ul>${terms.map(s => `<li>${esc(s)}</li>`).join('')}<li>This proposal is valid for ${num(pr.validDays)} days from the date above.</li></ul>
<div class="lbl">Acceptance</div><p>The above price, scope and terms are accepted. ${esc(co.name || 'Contractor')} is authorized to do the work as described.</p>
<div class="sig"><div>Accepted by (Owner / GC) &nbsp;·&nbsp; Date</div><div>${esc(co.name || 'Contractor')} &nbsp;·&nbsp; Date</div></div>
${plan ? `<div class="plan">${plan}</div>` : ''}
</body></html>`;
}
function proposalDialog() {
  const E = estimate(), { pr, co } = proposalData();
  const card = $('#modalCard'); card.classList.add('wide');
  const auto = Math.ceil(E.total / 50) * 50;
  const f = (id, label, v, type, ph) => `<div><label for="${id}">${label}</label><input id="${id}" type="${type || 'text'}" value="${esc(v == null ? '' : v)}" placeholder="${esc(ph || '')}" ${type === 'number' ? 'inputmode="decimal" step="any"' : ''}></div>`;
  card.innerHTML = `<div class="row" style="margin-bottom:6px"><h2 style="margin:0">Proposal</h2><button class="sec" id="prClose" style="flex:0 0 auto">Close</button></div>
    <details ${co.name ? '' : 'open'}><summary>Your company (saved for every proposal)</summary><div class="grid2">
      ${f('coName', 'Company name', co.name)}${f('coPhone', 'Phone', co.phone, 'tel')}${f('coEmail', 'Email', co.email, 'email')}${f('coLic', 'License no.', co.license)}</div>
      <label for="coAddr">Address</label><textarea id="coAddr" rows="2">${esc(co.address || '')}</textarea></details>
    <h3>Owner / GC</h3><div class="grid2">${f('prName', 'Name', pr.clientName)}${f('prCo', 'Company', pr.clientCo)}${f('prPhone', 'Phone', pr.clientPhone, 'tel')}${f('prEmail', 'Email', pr.clientEmail, 'email')}</div>
    <label for="prAddr">Mailing address</label><textarea id="prAddr" rows="2">${esc(pr.clientAddr || '')}</textarea>
    <h3>Job</h3><div class="grid2">${f('prSite', 'Job address', pr.siteAddr || P.address)}${f('prNo', 'Proposal no.', pr.number)}${f('prDate', 'Date', pr.date, 'date')}${f('prValid', 'Valid for (days)', pr.validDays, 'number')}</div>
    <h3>Price</h3><div class="grid2">${f('prPrice', `Lump sum (estimate ${money(E.total)})`, pr.price != null ? pr.price : auto, 'number')}
      <div><label for="prBrk">Show price by section</label><select id="prBrk"><option value="0" ${pr.breakdown ? '' : 'selected'}>No — lump sum only</option><option value="1" ${pr.breakdown ? 'selected' : ''}>Yes</option></select></div></div>
    <div class="row" style="justify-content:space-between;align-items:end"><h3 style="margin-bottom:0">Scope of work</h3><button class="sec" id="prRescope" type="button" style="flex:0 0 auto;padding:6px 10px">Rebuild from takeoff</button></div>
    <textarea id="prScope" rows="8" aria-label="Scope of work, one item per line">${esc(pr.scope != null ? pr.scope : scopeLines(E).join('\n'))}</textarea>
    <label for="prExcl">Not included (one per line)</label><textarea id="prExcl" rows="5">${esc(pr.exclusions != null ? pr.exclusions : DEFAULT_EXCLUSIONS.join('\n'))}</textarea>
    <label for="prTerms">Terms (one per line)</label><textarea id="prTerms" rows="4">${esc(pr.terms != null ? pr.terms : DEFAULT_TERMS.join('\n'))}</textarea>
    <label style="display:flex;gap:8px;align-items:center;color:var(--ink);font-size:14px"><input type="checkbox" id="prPlan" ${pr.includePlan ? 'checked' : ''} style="width:auto"> Attach the site plan</label>
    <div class="row mt"><button class="sec" id="prPreview">Preview</button><button class="pri" id="prSave">Save PDF</button><button class="pri" id="prExport">Export / email</button></div>
    <div class="row mt"><button class="sec" id="prHtml">Save as web page</button>${CAN_PRINT ? '<button class="sec" id="prPrint">Print</button>' : ''}<button class="sec" id="prCopy">Copy email text</button></div>
    <div id="prOut" class="propview" hidden></div>`;
  $('#modal').classList.remove('hidden');
  const read = () => {
    Object.assign(co, { name: $('#coName').value.trim(), phone: $('#coPhone').value.trim(), email: $('#coEmail').value.trim(), license: $('#coLic').value.trim(), address: $('#coAddr').value.trim() });
    const pv = parseFloat($('#prPrice').value);
    Object.assign(pr, { clientName: $('#prName').value.trim(), clientCo: $('#prCo').value.trim(), clientPhone: $('#prPhone').value.trim(), clientEmail: $('#prEmail').value.trim(), clientAddr: $('#prAddr').value.trim(),
      siteAddr: $('#prSite').value.trim(), number: $('#prNo').value.trim(), date: $('#prDate').value, validDays: parseFloat($('#prValid').value) || 30,
      price: isFinite(pv) && pv !== auto ? pv : null, breakdown: $('#prBrk').value === '1', scope: $('#prScope').value, exclusions: $('#prExcl').value, terms: $('#prTerms').value, includePlan: $('#prPlan').checked });
    save(true);
  };
  const close = () => { read(); $('#modal').classList.add('hidden'); card.classList.remove('wide'); };
  $('#prClose').onclick = close;
  $('#prRescope').onclick = () => { $('#prScope').value = scopeLines(estimate()).join('\n'); };
  $('#prPreview').onclick = () => {
    read(); const out = $('#prOut'); out.hidden = false;
    const fr = document.createElement('iframe'); fr.title = 'Proposal preview'; fr.setAttribute('sandbox', ''); fr.srcdoc = proposalHTML();
    out.innerHTML = ''; out.appendChild(fr); out.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const fname = () => `Proposal_${(pr.number || '').replace(/[^\w-]+/g, '')}_${(P.name || 'site').replace(/[^\w-]+/g, '_')}.html`;
  $('#prHtml').onclick = () => { read(); shareOrDownload(fname(), proposalHTML(), 'text/html'); };
  $('#prSave').onclick = async () => { read(); if (!needPdfLib()) return; const b = $('#prSave'); b.disabled = true; b.textContent = 'Building…'; try { await shareOrDownload(fname().replace(/\.html$/, '.pdf'), await proposalPDF(), 'application/pdf'); } catch (e) { toast(e.message); } b.disabled = false; b.textContent = 'Save PDF'; };
  $('#prExport').onclick = () => { close(); exportDialog(); };
  if ($('#prPrint')) $('#prPrint').onclick = () => { read(); const w = window.open('', '_blank'); if (w) { w.document.write(proposalHTML()); w.document.close(); setTimeout(() => w.print(), 400); } else toast('Allow pop-ups to print'); };
  $('#prCopy').onclick = async () => {
    read();
    const price = pr.price != null ? pr.price : auto;
    const txt = `${pr.clientName ? 'Hi ' + pr.clientName.split(' ')[0] + ',' : 'Hello,'}\n\nHere is our proposal for ${P.name}${(pr.siteAddr || P.address) ? ' at ' + (pr.siteAddr || P.address) : ''}.\n\nScope:\n${$('#prScope').value.split('\n').filter(Boolean).map(s => '- ' + s).join('\n')}\n\nLump sum price: ${money(price)}\n\nThe full proposal with terms and a signature block is attached. It is valid for ${pr.validDays} days.\n\nThank you,\n${co.name || ''}${co.phone ? '\n' + co.phone : ''}`;
    try { await navigator.clipboard.writeText(txt); toast('Email text copied — attach the saved proposal'); } catch (e) { toast('Copy is not available here'); }
  };
}


// ======================================================================
// PDFs (drawing + proposal) and Export (email to yourself)
// ======================================================================
const safeName = s => (s || 'site').replace(/[^\w-]+/g, '_').replace(/^_+|_+$/g, '') || 'site';
// PDF base fonts only cover Western characters — swap the few typographic ones we use
const pdfText = t => String(t == null ? '' : t).replace(/[–—]/g, '-').replace(/[‘’]/g, "'").replace(/[“”″]/g, '"').replace(/×/g, 'x').replace(/≈/g, '~').replace(/±/g, '+/-').replace(/[✕♣☁]/g, '').replace(/·/g, '-');
async function svgToJpeg(svg, scale) {
  const m = svg.match(/viewBox="0 0 (\d+) (\d+)"/), w = +m[1], h = +m[2];
  const sized = svg.replace(/width="[\d.]+in" height="11in"/, `width="${w}" height="${h}"`);
  const url = URL.createObjectURL(new Blob([sized], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('Could not draw the site plan')); img.src = url; });
    const c = document.createElement('canvas'); c.width = Math.round(w * scale); c.height = Math.round(h * scale);
    const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); ctx.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.92);
  } finally { URL.revokeObjectURL(url); }
}
function needPdfLib() { if (!window.jspdf || !window.jspdf.jsPDF) { toast('PDF export is not available here'); return false; } return true; }
// Site drawing as a print-ready PDF: Letter portrait or 11×17 (tabloid) landscape
async function planPDF(page, opt) {
  const svg = planSVG(Object.assign({}, opt || {}, { page }));
  if (!svg) throw new Error('Nothing to draw yet — set a boundary or mark features first');
  const tab = page === 'tabloid';
  const jpg = await svgToJpeg(svg, tab ? 2.4 : 3);
  const doc = new window.jspdf.jsPDF({ orientation: tab ? 'landscape' : 'portrait', unit: 'in', format: tab ? 'tabloid' : 'letter' });
  doc.addImage(jpg, 'JPEG', 0, 0, tab ? 17 : 8.5, 11);
  doc.setProperties({ title: `${P.name} — site plan`, creator: 'SiteWalk Takeoff' });
  return doc.output('blob');
}
// Proposal as a real (text) PDF, with the Letter drawing as page 2 when attached
async function proposalPDF() {
  const E = estimate(), { pr, co } = proposalData(), J = window.jspdf.jsPDF;
  const doc = new J({ unit: 'pt', format: 'letter' }), W = 612, H = 792, M = 54, CW = W - 2 * M;
  const price = pr.price != null ? pr.price : Math.ceil(E.total / 50) * 50;
  const scope = (pr.scope != null ? pr.scope.split('\n') : scopeLines(E)).map(s => s.trim()).filter(Boolean);
  const excl = (pr.exclusions != null ? pr.exclusions : DEFAULT_EXCLUSIONS.join('\n')).split('\n').map(s => s.trim()).filter(Boolean);
  const terms = (pr.terms != null ? pr.terms : DEFAULT_TERMS.join('\n')).split('\n').map(s => s.trim()).filter(Boolean).concat([`This proposal is valid for ${num(pr.validDays)} days from the date above.`]);
  const dt = pr.date ? new Date(pr.date + 'T12:00:00').toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : '';
  let y = M;
  const ensure = h => { if (y + h > H - M) { doc.addPage(); y = M; } };
  const txt = (t, x, yy, o = {}) => { doc.setFont(o.font || 'helvetica', o.bold ? 'bold' : 'normal'); doc.setFontSize(o.size || 10); doc.setTextColor(o.color || '#1d1d1d'); doc.text(pdfText(t), x, yy, o.align ? { align: o.align } : undefined); };
  // header
  txt(co.name || 'Your company name', M, y + 4, { size: 15, bold: true });
  let hy = y + 20; (co.address || '').split('\n').filter(Boolean).concat([co.phone, co.email, co.license ? 'License ' + co.license : ''].filter(Boolean)).forEach(l => { txt(l, M, hy, { size: 9.5, color: '#333' }); hy += 12; });
  txt('PROPOSAL', W - M, y + 8, { size: 24, bold: true, align: 'right' });
  txt('No. ' + (pr.number || ''), W - M, y + 26, { size: 9.5, align: 'right' }); txt(dt, W - M, y + 39, { size: 9.5, align: 'right' });
  y = Math.max(hy, y + 48) + 4; doc.setDrawColor('#1d1d1d'); doc.setLineWidth(2.2); doc.line(M, y, W - M, y); y += 22;
  const label = (t, x, yy) => txt(t.toUpperCase(), x, yy, { size: 7.5, bold: true, color: '#6b5a3e' });
  label('Prepared for', M, y); label('Project', M + CW / 2, y); y += 13;
  const left = [pr.clientName, pr.clientCo].concat((pr.clientAddr || '').split('\n')).concat([pr.clientPhone, pr.clientEmail]).filter(Boolean);
  const right = [P.name, pr.siteAddr || P.address].filter(Boolean);
  const rows = Math.max(left.length, right.length, 1);
  for (let i = 0; i < rows; i++) { if (left[i]) txt(left[i], M, y + i * 13, { font: 'times', size: 11 }); if (right[i]) txt(right[i], M + CW / 2, y + i * 13, { font: 'times', size: 11 }); }
  y += rows * 13 + 14;
  // scope
  ensure(30); label('Scope of work', M, y); y += 14;
  doc.setFont('times', 'normal'); doc.setFontSize(11);
  scope.forEach((s, i) => { const lines = doc.splitTextToSize(pdfText(s), CW - 20); ensure(lines.length * 13.5 + 3); txt(`${i + 1}.`, M, y, { font: 'times', size: 11 }); doc.setFont('times', 'normal'); doc.text(lines, M + 18, y); y += lines.length * 13.5 + 3; });
  // price
  y += 8; ensure(52); doc.setLineWidth(1.6); doc.rect(M, y, CW, 40);
  txt('Lump sum price for the work above', M + 14, y + 25, { size: 11 }); txt(money(price), W - M - 14, y + 27, { size: 18, bold: true, align: 'right' }); y += 54;
  if (pr.breakdown) E.secs.forEach(sec => { ensure(16); txt(sec.name, M + 4, y, { size: 9.5 }); txt(money(sec.total / (E.direct || 1) * price), W - M - 4, y, { size: 9.5, align: 'right' }); doc.setLineWidth(0.4); doc.setDrawColor('#cccccc'); doc.line(M, y + 4, W - M, y + 4); doc.setDrawColor('#1d1d1d'); y += 16; });
  const bullets = (title, list) => {
    y += 6; ensure(28); label(title, M, y); y += 14;
    list.forEach(s => { doc.setFont('times', 'normal'); doc.setFontSize(10.5); const lines = doc.splitTextToSize(pdfText(s), CW - 16); ensure(lines.length * 13 + 2); txt('•', M + 2, y, { size: 10.5 }); doc.setFont('times', 'normal'); doc.setFontSize(10.5); doc.text(lines, M + 14, y); y += lines.length * 13 + 2; });
  };
  bullets('Not included', excl); bullets('Terms', terms);
  y += 6; ensure(92); label('Acceptance', M, y); y += 15;
  doc.setFont('times', 'normal'); doc.setFontSize(10.5);
  const acc = doc.splitTextToSize(pdfText(`The above price, scope and terms are accepted. ${co.name || 'The contractor'} is authorized to do the work as described.`), CW); doc.text(acc, M, y); y += acc.length * 13 + 34;
  doc.setLineWidth(0.8); doc.line(M, y, M + CW / 2 - 18, y); doc.line(M + CW / 2 + 18, y, W - M, y);
  txt('Accepted by (Owner / GC)   Date', M, y + 12, { size: 8.5 }); txt(`${co.name || 'Contractor'}   Date`, M + CW / 2 + 18, y + 12, { size: 8.5 });
  if (pr.includePlan) {
    const svg = planSVG({ page: 'letter' });
    if (svg) { const jpg = await svgToJpeg(svg, 3); doc.addPage('letter', 'portrait'); doc.addImage(jpg, 'JPEG', 0, 0, 612, 792); }
  }
  doc.setProperties({ title: `Proposal ${pr.number || ''} — ${P.name}`, creator: 'SiteWalk Takeoff' });
  return doc.output('blob');
}

// ---------- export / email ----------
function xlsxBlob() {
  if (!window.XLSX) return null;
  return buildXlsx();
}
async function deliverFiles(files, mode, meta) {
  const inClaude = !!(window.claude && typeof window.claude.use === 'function');
  const asFile = f => new File([f.blob], f.name, { type: f.blob.type || 'application/octet-stream' });
  if (mode === 'share' && !inClaude && navigator.canShare) {
    const fl = files.map(asFile);
    if (navigator.canShare({ files: fl })) {
      try { await navigator.share({ files: fl, title: meta.subject, text: meta.body }); return 'shared'; }
      catch (e) { if (e.name === 'AbortError') return 'cancel'; }
    }
  }
  let one = files.length === 1 ? files[0] : null;
  if (!one) {
    if (!window.JSZip) { for (const f of files) await shareOrDownload(f.name, f.blob, f.blob.type, { noShare: true }); return 'downloaded'; }
    const z = new window.JSZip(); files.forEach(f => z.file(f.name, f.blob));
    one = { name: `${safeName(P.name)}_export.zip`, blob: await z.generateAsync({ type: 'blob', mimeType: 'application/zip' }) };
  }
  if (mode === 'share' && !inClaude && navigator.canShare && navigator.canShare({ files: [asFile(one)] })) {
    try { await navigator.share({ files: [asFile(one)], title: meta.subject, text: meta.body }); return 'shared'; }
    catch (e) { if (e.name === 'AbortError') return 'cancel'; }
  }
  await shareOrDownload(one.name, one.blob, one.blob.type, { noShare: true });
  if (mode === 'share' && !inClaude && meta.email) {
    setTimeout(() => { location.href = `mailto:${encodeURIComponent(meta.email)}?subject=${encodeURIComponent(meta.subject)}&body=${encodeURIComponent(meta.body + '\n\n(Attach ' + one.name + ' from your Downloads.)')}`; }, 600);
  }
  return 'downloaded';
}
function exportDialog() {
  const E = estimate(), x = store.exportPrefs = Object.assign({ xlsx: true, proposal: true, plan: true, csv: false, job: false, page: 'letter', email: (store.company && store.company.email) || '' }, store.exportPrefs || {});
  const inClaude = !!(window.claude && typeof window.claude.use === 'function');
  const card = $('#modalCard'); card.classList.remove('wide');
  const ck = (k, title, sub) => `<label class="xrow"><input type="checkbox" data-x="${k}" ${x[k] ? 'checked' : ''}><span><b>${title}</b><small>${sub}</small></span></label>`;
  const off = officePrefs();
  card.innerHTML = `<button class="pri big office" id="xOffice" style="width:100%">📤 Send to office${off.email ? `<small style="display:block;font-weight:400;font-size:12px;opacity:.85">${esc(off.email)}</small>` : ''}</button>
    <div class="row" style="justify-content:flex-end;margin:4px 0 8px"><button class="sec" id="xOffEmail" style="flex:0 0 auto;padding:6px 10px;font-size:13px">${off.email ? 'Change office email' : 'Set office email'}</button></div>
    <h2 style="margin:0 0 4px">Export job</h2>
    <p class="muted" style="margin:0 0 10px">Send the files to yourself and finish the spreadsheet and proposal on a computer.</p>
    <div class="list">
      ${ck('xlsx', 'Takeoff spreadsheet', 'Excel (.xlsx) with live formulas and a Rates tab')}
      ${ck('proposal', 'Proposal', 'PDF, with the site plan as page 2 if attached')}
      ${ck('plan', 'Site drawing', 'PDF with drawing border and title block')}
      <div class="xsub"><label for="xPage">Drawing size</label><select id="xPage"><option value="letter" ${x.page === 'letter' ? 'selected' : ''}>Letter 8½ × 11 (goes with the proposal)</option><option value="tabloid" ${x.page === 'tabloid' ? 'selected' : ''}>Tabloid 11 × 17 landscape</option><option value="both" ${x.page === 'both' ? 'selected' : ''}>Both sizes</option></select></div>
      ${ck('csv', 'Takeoff as CSV', 'Plain spreadsheet text, opens anywhere')}
      ${ck('job', 'Job file', 'Reopen this job in the app on another phone or computer')}
    </div>
    <label for="xEmail">Your email</label><input id="xEmail" type="email" autocomplete="email" value="${esc(x.email)}" placeholder="you@company.com">
    <div class="muted" style="margin-top:4px">${inClaude ? 'In this preview the files are saved as one .zip. On the phone, Email / Share opens the share sheet — pick Mail and send it to yourself.' : 'Email / Share opens your phone’s share sheet — pick Mail (or Gmail) and send it to yourself. If your phone can’t share these files, they download as one .zip and an email opens for you to attach it.'}</div>
    <div id="xStatus" class="muted" role="status" aria-live="polite" style="margin-top:6px"></div>
    <div class="row" style="margin-top:14px"><button class="sec" id="xCancel">Close</button><button class="sec" id="xDl">Download</button><button class="pri" id="xGo">Email / Share</button></div>`;
  $('#modal').classList.remove('hidden');
  const close = () => $('#modal').classList.add('hidden');
  $('#xCancel').onclick = close;
  $('#xOffice').onclick = () => { close(); sendToOffice(); };
  $('#xOffEmail').onclick = async () => { close(); await officeEmailForm(!officePrefs().email); exportDialog(); };
  const run = async mode => {
    card.querySelectorAll('[data-x]').forEach(c => { x[c.dataset.x] = c.checked; });
    x.page = $('#xPage').value; x.email = $('#xEmail').value.trim(); save(true);
    const st = $('#xStatus'), btns = [$('#xGo'), $('#xDl')];
    btns.forEach(b => b.disabled = true);
    try {
      const files = [], base = safeName(P.name);
      st.textContent = 'Building files…';
      if (x.xlsx) { const b = xlsxBlob(); if (b) files.push({ name: `${base}_takeoff.xlsx`, blob: b }); }
      if ((x.proposal || x.plan) && !needPdfLib()) throw new Error('PDF library missing');
      if (x.proposal) { st.textContent = 'Building the proposal PDF…'; files.push({ name: `${base}_proposal.pdf`, blob: await proposalPDF() }); }
      if (x.plan) for (const pg of x.page === 'both' ? ['letter', 'tabloid'] : [x.page]) { st.textContent = 'Drawing the site plan…'; files.push({ name: `${base}_site_plan_${pg === 'tabloid' ? '11x17' : 'letter'}.pdf`, blob: await planPDF(pg) }); }
      if (x.csv) files.push({ name: `${base}_takeoff.csv`, blob: new Blob([estimateCSV()], { type: 'text/csv' }) });
      if (x.job) files.push({ name: `${base}.sitewalk.json`, blob: new Blob([JSON.stringify(P)], { type: 'application/json' }) });
      if (!files.length) { st.textContent = 'Pick at least one file.'; return; }
      const meta = { email: x.email, subject: `${P.name} — sitework takeoff & proposal`,
        body: `${P.name}${P.address ? ' — ' + P.address : ''}\nBid total: ${money(E.total)} (${num(E.hrs, 1)} crew-hours)\n\nAttached: ${files.map(f => f.name).join(', ')}\n\nSent from SiteWalk Takeoff.` };
      st.textContent = 'Sending…';
      const r = await deliverFiles(files, mode, meta);
      st.textContent = r === 'shared' ? 'Shared.' : r === 'cancel' ? 'Cancelled.' : `Saved ${files.length > 1 ? 'a .zip with ' + files.length + ' files' : files[0].name}.`;
    } catch (e) { st.textContent = e.message || 'Export failed'; }
    finally { btns.forEach(b => b.disabled = false); }
  };
  $('#xGo').onclick = () => run('share');
  $('#xDl').onclick = () => run('download');
}


// ---------- Send to office: one tap from the field to your office email ----------
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
function officePrefs() { const o = store.office = store.office || {}; const d = { email: '', job: true, plan: true, xlsx: false, proposal: false }; for (const k in d) if (o[k] == null) o[k] = d[k]; return o; }
async function officeEmailForm(first) {
  const o = officePrefs();
  for (;;) {
    const v = await form(first ? 'Set up Send to office' : 'Office email', [
      { key: 'email', label: 'Office email address', type: 'email', value: o.email || (store.company && store.company.email) || '', placeholder: 'office@yourcompany.com', help: 'Send to office always sends the job here. You can change it any time.' }
    ], first ? 'Save & continue' : 'Save');
    if (!v) return false;
    const em = (v.email || '').trim();
    if (EMAIL_RE.test(em)) { o.email = em; save(true); return true; }
    toast('That email address doesn’t look right — check it and try again', 3500);
  }
}
async function sendToOffice() {
  const o = officePrefs();
  if (!o.email && !(await officeEmailForm(true))) return;
  const card = $('#modalCard'); card.classList.remove('wide');
  const ck = (k, title, sub, dis) => `<label class="xrow"><input type="checkbox" data-o="${k}" ${o[k] ? 'checked' : ''} ${dis ? 'disabled' : ''}><span><b>${title}</b><small>${sub}</small></span></label>`;
  const measured = P.lines.filter(Ln => lineQty(Ln).measured).length;
  card.innerHTML = `<h2 style="margin:0 0 4px">📤 Send to office</h2>
    <div class="offto"><span>To</span><b>${esc(o.email)}</b><button class="sec" id="oChange" type="button">Change</button></div>
    <div class="muted" style="margin:6px 0 10px">${esc(P.name)} · ${P.lines.length} takeoff item${P.lines.length === 1 ? '' : 's'}${P.lines.length ? ` (${measured} measured)` : ''}</div>
    <div class="list">
      ${ck('job', 'Job file', 'Opens the whole job in SiteWalk on your computer (Import), ready to adjust, print and email')}
      ${ck('plan', 'Site drawing', 'Letter PDF with border and title block')}
      ${ck('xlsx', 'Takeoff spreadsheet', 'Excel (.xlsx). On some Android phones this sends the files as a .zip instead')}
      ${ck('proposal', 'Proposal', 'PDF draft at today’s prices')}
    </div>
    <div id="oStatus" class="muted" role="status" aria-live="polite" style="margin-top:10px"></div>
    <div class="row" style="margin-top:14px"><button class="sec" id="oClose" type="button">Close</button><button class="pri" id="oSend" type="button">Send</button></div>`;
  $('#modal').classList.remove('hidden');
  const close = () => $('#modal').classList.add('hidden');
  $('#oClose').onclick = close;
  $('#oChange').onclick = async () => { if (await officeEmailForm(false)) sendToOffice(); else sendToOffice(); };
  let ready = null;
  const st = $('#oStatus'), btn = $('#oSend');
  const meta = () => ({ email: o.email, subject: `SiteWalk job: ${P.name}`,
    body: `${P.name}${P.address ? ' — ' + P.address : ''}\n${P.lines.length} takeoff items · current bid ${money(estimate().total)}\n\nOn the computer: open SiteWalk, click the job name at the top left, choose Import, and pick the attached .sitewalk file.\n\nSent from the field with SiteWalk.` });
  const copyTo = () => { try { if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(o.email).catch(() => { }); } catch (e) { } };
  const deliver = async () => {
    const inClaude = !!(window.claude && typeof window.claude.use === 'function');
    const fl = ready.map(f => new File([f.blob], f.name, { type: f.blob.type }));
    if (!inClaude && navigator.canShare && navigator.canShare({ files: fl })) {
      copyTo();
      try {
        await navigator.share({ files: fl, title: meta().subject, text: meta().body });
        st.innerHTML = `Sent to the share sheet. <b>In the email, tap To and paste</b> — ${esc(o.email)} is copied.`;
        btn.textContent = 'Send again'; ready = null; return;
      } catch (e) {
        if (e.name === 'AbortError') { st.textContent = 'Cancelled. Tap Open email to try again.'; btn.textContent = 'Open email'; return; }
        if (e.name === 'NotAllowedError') { st.textContent = 'Files are ready. Tap Open email.'; btn.textContent = 'Open email'; return; }
      }
    }
    // can't hand these files to the share sheet: download them and open an email already addressed to the office
    const r = await deliverFiles(ready, 'share', meta());
    st.textContent = r === 'downloaded' ? (inClaude ? 'Saved the files (in this preview the email step is skipped).' : `Saved to Downloads. An email to ${o.email} is opening — attach the file from Downloads.`) : r === 'shared' ? 'Sent to the share sheet.' : 'Cancelled.';
    btn.textContent = 'Send again'; ready = null;
  };
  btn.onclick = async () => {
    if (ready) { await deliver(); return; }   // second tap: hand the built files to email
    copyTo();
    card.querySelectorAll('[data-o]').forEach(c => { o[c.dataset.o] = c.checked; }); save(true);
    if (!o.job && !o.plan && !o.xlsx && !o.proposal) { st.textContent = 'Pick at least one file.'; return; }
    btn.disabled = true;
    try {
      const files = [], base = safeName(P.name);
      if (o.job) files.push({ name: `${base}.sitewalk.txt`, blob: new Blob([JSON.stringify(P)], { type: 'text/plain' }) });
      if ((o.plan || o.proposal) && !needPdfLib()) throw new Error('PDF library missing');
      if (o.plan) { st.textContent = 'Drawing the site plan…'; files.push({ name: `${base}_site_plan.pdf`, blob: await planPDF('letter') }); }
      if (o.proposal) { st.textContent = 'Building the proposal…'; files.push({ name: `${base}_proposal.pdf`, blob: await proposalPDF() }); }
      if (o.xlsx) { const b = xlsxBlob(); if (b) files.push({ name: `${base}_takeoff.xlsx`, blob: b }); }
      ready = files; st.textContent = 'Opening email…';
      await deliver();
    } catch (e) { st.textContent = e.message || 'Could not build the files'; ready = null; }
    finally { btn.disabled = false; }
  };
}

// ---------- install (Android prompt / iPhone instructions) ----------
let installEvt = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; });
const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
async function installApp() {
  if (installEvt) { installEvt.prompt(); try { await installEvt.userChoice; } catch (e) { } installEvt = null; return; }
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  await choiceBox('Install on this phone', ios
    ? 'In Safari, tap the Share button (square with an arrow), then “Add to Home Screen”. SiteWalk then opens full-screen like an app.'
    : 'In Chrome, open the ⋮ menu and tap “Install app” or “Add to Home screen”. SiteWalk then opens full-screen like an app.', [['ok', 'OK', '']]);
}

// ---------- Android back button closes the open popup ----------
(function () {
  if (EMBED) return;   // phone build only
  const m = document.getElementById('modal'); let pushed = false, selfBack = 0;
  try {
    new MutationObserver(() => {
      const open = !m.classList.contains('hidden');
      if (open && !pushed) { try { history.pushState({ swModal: 1 }, ''); pushed = true; } catch (e) { } }
      else if (!open && pushed) { pushed = false; try { if (history.state && history.state.swModal) { selfBack++; history.back(); } } catch (e) { } }
    }).observe(m, { attributes: true, attributeFilter: ['class'] });
    window.addEventListener('popstate', () => { if (selfBack) { selfBack--; return; } if (!m.classList.contains('hidden')) { pushed = false; m.classList.add('hidden'); const c = document.getElementById('modalCard'); if (c) c.classList.remove('wide'); } });
  } catch (e) { /* older browsers */ }
})();

// ======================================================================
// Boot
// ======================================================================
refreshMap(); render();
showSplash();
if ('serviceWorker' in navigator && window.isSecureContext && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => { });
window.__app = { get P() { return P; }, sendToOffice, showSplash, startTakeoffFlow, openTakeoffEntry, guessItem, map, traceBoundary, setupBoundary, isWalking: () => walk.active, drawFeatures, onOpen, switchProject, newProject, toast, refreshMap, render, planSVG, bearingText, buildSurface, calcArea, estimate, startDraw, endDraw, draw, setTab, openArea, openLine, lineQty, migrateLines, store };
})();
