/* SiteWalk Takeoff — geometry, surface and quantity math.
   Units: feet, square feet, cubic yards. Local coordinates are x = east (ft), y = north (ft)
   from an origin lat/lon (equirectangular — accurate to well under 0.1% across a site). */
(function (root) {
  'use strict';
  const M2FT = 3.280839895;
  const FT_PER_DEG_LAT = 364000;           // ~110,947 m
  const SF_PER_ACRE = 43560;

  function ftPerDegLon(lat0) { return FT_PER_DEG_LAT * Math.cos(lat0 * Math.PI / 180) * 1.0033; }
  function toXY(lat, lon, o) {
    return [(lon - o.lon0) * ftPerDegLon(o.lat0), (lat - o.lat0) * FT_PER_DEG_LAT];
  }
  function toLL(x, y, o) {
    return [o.lat0 + y / FT_PER_DEG_LAT, o.lon0 + x / ftPerDegLon(o.lat0)];
  }

  // ---------- polygon helpers ----------
  function polyArea(xy) {                  // shoelace, absolute, sq ft
    let a = 0;
    for (let i = 0, j = xy.length - 1; i < xy.length; j = i++) a += (xy[j][0] + xy[i][0]) * (xy[j][1] - xy[i][1]);
    return Math.abs(a / 2);
  }
  function polyCentroid(xy) {
    let a = 0, cx = 0, cy = 0;
    for (let i = 0, j = xy.length - 1; i < xy.length; j = i++) {
      const f = xy[j][0] * xy[i][1] - xy[i][0] * xy[j][1];
      a += f; cx += (xy[j][0] + xy[i][0]) * f; cy += (xy[j][1] + xy[i][1]) * f;
    }
    if (Math.abs(a) < 1e-9) {               // degenerate — average
      const n = xy.length; return [xy.reduce((s, p) => s + p[0], 0) / n, xy.reduce((s, p) => s + p[1], 0) / n];
    }
    return [cx / (3 * a), cy / (3 * a)];
  }
  function inPoly(x, y, xy) {
    let c = false;
    for (let i = 0, j = xy.length - 1; i < xy.length; j = i++) {
      const xi = xy[i][0], yi = xy[i][1], xj = xy[j][0], yj = xy[j][1];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c;
    }
    return c;
  }
  function lineLength(xy) {
    let L = 0;
    for (let i = 1; i < xy.length; i++) L += Math.hypot(xy[i][0] - xy[i - 1][0], xy[i][1] - xy[i - 1][1]);
    return L;
  }
  // Rectangles around each segment of a centerline (for display of line-type areas)
  function lineBufferRects(xy, width) {
    const h = width / 2, out = [];
    for (let i = 1; i < xy.length; i++) {
      const [x1, y1] = xy[i - 1], [x2, y2] = xy[i];
      const L = Math.hypot(x2 - x1, y2 - y1); if (L < 1e-6) continue;
      const nx = -(y2 - y1) / L * h, ny = (x2 - x1) / L * h;
      out.push([[x1 + nx, y1 + ny], [x2 + nx, y2 + ny], [x2 - nx, y2 - ny], [x1 - nx, y1 - ny]]);
    }
    return out;
  }
  function convexHull(pts) {
    const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    if (p.length < 3) return p;
    const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lo = [], up = [];
    for (const q of p) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
    for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
    up.pop(); lo.pop(); return lo.concat(up);
  }
  // Douglas–Peucker simplification (ft tolerance)
  function simplify(xy, tol) {
    if (xy.length < 3) return xy.slice();
    const keep = new Uint8Array(xy.length); keep[0] = keep[xy.length - 1] = 1;
    const stack = [[0, xy.length - 1]];
    while (stack.length) {
      const [a, b] = stack.pop(); let dmax = 0, idx = -1;
      const [ax, ay] = xy[a], [bx, by] = xy[b], L2 = (bx - ax) ** 2 + (by - ay) ** 2;
      for (let i = a + 1; i < b; i++) {
        // distance to the segment (not the infinite line) so closed loops simplify correctly
        const t = L2 > 1e-12 ? Math.max(0, Math.min(1, ((xy[i][0] - ax) * (bx - ax) + (xy[i][1] - ay) * (by - ay)) / L2)) : 0;
        const d = Math.hypot(xy[i][0] - (ax + t * (bx - ax)), xy[i][1] - (ay + t * (by - ay)));
        if (d > dmax) { dmax = d; idx = i; }
      }
      if (dmax > tol) { keep[idx] = 1; stack.push([a, idx], [idx, b]); }
    }
    return xy.filter((_, i) => keep[i]);
  }

  // ---------- surface (regular grid) ----------
  // surface = {lat0, lon0, x0, y0, spacing, nx, ny, z: Array (ft or null)}
  function makeGridSpec(xyPts, pad, maxPts) {
    let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
    for (const [x, y] of xyPts) { minx = Math.min(minx, x); maxx = Math.max(maxx, x); miny = Math.min(miny, y); maxy = Math.max(maxy, y); }
    minx -= pad; miny -= pad; maxx += pad; maxy += pad;
    const w = maxx - minx, h = maxy - miny;
    const nice = [3, 5, 10, 15, 20, 25, 30, 40, 50, 75, 100, 150, 200];
    let s = nice[nice.length - 1];
    for (const c of nice) { if ((Math.floor(w / c) + 2) * (Math.floor(h / c) + 2) <= maxPts) { s = c; break; } }
    const nx = Math.floor(w / s) + 2, ny = Math.floor(h / s) + 2;
    return { x0: minx, y0: miny, spacing: s, nx, ny };
  }
  function gridNodeXY(g, i, j) { return [g.x0 + i * g.spacing, g.y0 + j * g.spacing]; }

  function zAt(s, x, y) {
    const fx = (x - s.x0) / s.spacing, fy = (y - s.y0) / s.spacing;
    if (fx < 0 || fy < 0 || fx > s.nx - 1 || fy > s.ny - 1) return null;
    const i = Math.min(Math.floor(fx), s.nx - 2), j = Math.min(Math.floor(fy), s.ny - 2);
    const tx = fx - i, ty = fy - j;
    const z00 = s.z[j * s.nx + i], z10 = s.z[j * s.nx + i + 1], z01 = s.z[(j + 1) * s.nx + i], z11 = s.z[(j + 1) * s.nx + i + 1];
    if (z00 == null || z10 == null || z01 == null || z11 == null) {
      // fall back to nearest valid corner
      const c = [[z00, (1 - tx) * (1 - ty)], [z10, tx * (1 - ty)], [z01, (1 - tx) * ty], [z11, tx * ty]].filter(v => v[0] != null);
      if (!c.length) return null;
      c.sort((a, b) => b[1] - a[1]); return c[0][0];
    }
    return z00 * (1 - tx) * (1 - ty) + z10 * tx * (1 - ty) + z01 * (1 - tx) * ty + z11 * tx * ty;
  }
  function covers(s, xy) {           // does surface cover all points?
    return xy.every(([x, y]) => zAt(s, x, y) != null);
  }

  // Inverse-distance weighting from scattered points [{x,y,z}]
  function idw(pts, x, y, k, power) {
    k = k || 12; power = power || 2;
    const d = pts.map(p => [Math.hypot(p.x - x, p.y - y), p.z]).sort((a, b) => a[0] - b[0]).slice(0, k);
    if (d[0][0] < 0.01) return d[0][1];
    let sw = 0, sz = 0;
    for (const [dist, z] of d) { const w = 1 / Math.pow(dist, power); sw += w; sz += w * z; }
    return sz / sw;
  }
  function median(a) {
    if (!a.length) return null; const b = a.slice().sort((p, q) => p - q), m = b.length >> 1;
    return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2;
  }

  // ---------- quantity takeoff ----------
  // Rasterize a polygon into cells of size r; returns {cells:[[x,y]], r, gridArea, exactArea}
  function rasterize(xy, maxCells) {
    maxCells = maxCells || 40000;
    const A = polyArea(xy);
    let r = Math.max(0.5, Math.sqrt(A / maxCells));
    let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
    for (const [x, y] of xy) { minx = Math.min(minx, x); maxx = Math.max(maxx, x); miny = Math.min(miny, y); maxy = Math.max(maxy, y); }
    const cells = [];
    for (let y = miny + r / 2; y < maxy; y += r)
      for (let x = minx + r / 2; x < maxx; x += r)
        if (inPoly(x, y, xy)) cells.push([x, y]);
    return { cells, r, gridArea: cells.length * r * r, exactArea: A, bbox: [minx, miny, maxx, maxy] };
  }

  // Design surface function for a cut/fill area
  function designFn(p, xy, offset) {
    const c = polyCentroid(xy);
    const base = (p.elev || 0) + (offset || 0) - (p.sectionIn || 0) / 12;   // subgrade = finish − section
    if (p.design === 'slope') {
      const az = (p.slopeDir || 0) * Math.PI / 180, g = (p.slopePct || 0) / 100;
      return (x, y) => base - g * ((x - c[0]) * Math.sin(az) + (y - c[1]) * Math.cos(az));
    }
    return () => base;
  }

  // Cut/fill volumes. Returns CY figures + per-cell dz for heat map.
  function cutFill(surface, xy, p, offset, ras) {
    ras = ras || rasterize(xy);
    const design = designFn(p, xy, offset);
    const strip = (p.stripIn || 0) / 12;
    const scale = ras.gridArea > 0 ? ras.exactArea / ras.gridArea : 1;
    const ca = ras.r * ras.r * scale;
    let cut = 0, fill = 0, cutA = 0, fillA = 0, maxCut = 0, maxFill = 0, missing = 0, sumE = 0, nE = 0;
    let minE = Infinity, maxE = -Infinity;
    const dz = new Float32Array(ras.cells.length);
    for (let k = 0; k < ras.cells.length; k++) {
      const [x, y] = ras.cells[k];
      let e = zAt(surface, x, y);
      if (e == null) { missing++; dz[k] = NaN; continue; }
      sumE += e; nE++; minE = Math.min(minE, e); maxE = Math.max(maxE, e);
      e -= strip;
      const d = e - design(x, y);     // + = cut, − = fill
      dz[k] = d;
      if (d > 0) { cut += d * ca; cutA += ca; maxCut = Math.max(maxCut, d); }
      else if (d < 0) { fill += -d * ca; fillA += ca; maxFill = Math.max(maxFill, -d); }
    }
    return {
      cutCY: cut / 27, fillCY: fill / 27, cutArea: cutA, fillArea: fillA, maxCut, maxFill,
      avgExisting: nE ? sumE / nE : null, minExisting: minE, maxExisting: maxE,
      missingFrac: ras.cells.length ? missing / ras.cells.length : 1, dz, ras
    };
  }

  // Solve offset so that cut (bank) = fill / (1 − shrink)
  function balanceOffset(surface, xy, p, ras) {
    ras = ras || rasterize(xy);
    const shrink = (p.shrinkPct || 0) / 100;
    const f = off => { const r = cutFill(surface, xy, p, off, ras); return r.cutCY - r.fillCY / (1 - shrink); };
    const r0 = cutFill(surface, xy, p, 0, ras);
    if (!isFinite(r0.minExisting)) return 0;
    const span = (r0.maxExisting - r0.minExisting) + 20;
    let lo = r0.minExisting - (p.elev || 0) - span, hi = r0.maxExisting - (p.elev || 0) + span;
    // f decreases as offset increases
    for (let it = 0; it < 50; it++) {
      const mid = (lo + hi) / 2;
      if (f(mid) > 0) lo = mid; else hi = mid;
      if (hi - lo < 0.001) break;
    }
    return (lo + hi) / 2;
  }

  // ---------- building pad with side slopes ----------
  // Offset a simple polygon outward by d (mitered corners, capped for very sharp angles)
  function offsetPolygon(xy, d) {
    let a2 = 0; for (let i = 0; i < xy.length; i++) { const p = xy[i], q = xy[(i + 1) % xy.length]; a2 += p[0] * q[1] - q[0] * p[1]; }
    const s = a2 > 0 ? 1 : -1, n = xy.length, lines = [];
    for (let i = 0; i < n; i++) {
      const a = xy[i], b = xy[(i + 1) % n], L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1e-9;
      const nx = s * (b[1] - a[1]) / L, ny = -s * (b[0] - a[0]) / L;      // outward normal
      lines.push([[a[0] + nx * d, a[1] + ny * d], [b[0] + nx * d, b[1] + ny * d], nx, ny]);
    }
    const out = [];
    for (let i = 0; i < n; i++) {
      const L1 = lines[(i + n - 1) % n], L2 = lines[i];
      const [p1, p2] = L1, [p3, p4] = L2;
      const d1x = p2[0] - p1[0], d1y = p2[1] - p1[1], d2x = p4[0] - p3[0], d2y = p4[1] - p3[1];
      const den = d1x * d2y - d1y * d2x;
      if (Math.abs(den) < 1e-9) { out.push(p3); continue; }
      const t = ((p3[0] - p1[0]) * d2y - (p3[1] - p1[1]) * d2x) / den;
      const ix = p1[0] + t * d1x, iy = p1[1] + t * d1y;
      const c = xy[i];
      if (Math.hypot(ix - c[0], iy - c[1]) > 4 * Math.abs(d)) out.push([L1[1][0], L1[1][1]], [p3[0], p3[1]]);   // bevel very sharp corners
      else out.push([ix, iy]);
    }
    return out;
  }
  function distToPoly(x, y, xy) {
    let best = Infinity;
    for (let i = 0, j = xy.length - 1; i < xy.length; j = i++) {
      const ax = xy[j][0], ay = xy[j][1], bx = xy[i][0], by = xy[i][1], L2 = (bx - ax) ** 2 + (by - ay) ** 2;
      const t = L2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / L2)) : 0;
      best = Math.min(best, Math.hypot(x - ax - t * (bx - ax), y - ay - t * (by - ay)));
    }
    return best;
  }
  // Building pad earthwork. footprint = house corners (local ft). p = {slabElev, offsetFt, slope (H per 1 V),
  // slabIn, stoneIn, stripIn}. Pad top = footprint offset by offsetFt at slabElev − (slab+stone).
  // Outside the pad top the ground is cut or filled on a slope:1 batter until it meets existing grade.
  function padEarthwork(surface, footprint, p, maxCells) {
    maxCells = maxCells || 60000;
    const top = offsetPolygon(footprint, p.offsetFt == null ? 6 : p.offsetFt);
    const padElev = p.slabElev - ((p.slabIn == null ? 4 : p.slabIn) + (p.stoneIn == null ? 6 : p.stoneIn)) / 12;
    const m = p.slope || 3, strip = (p.stripIn || 0) / 12;
    let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
    top.forEach(([x, y]) => { minx = Math.min(minx, x); maxx = Math.max(maxx, x); miny = Math.min(miny, y); maxy = Math.max(maxy, y); });
    // How far can the side slopes reach? Grow the search band until it stops growing.
    let E = 15;
    for (let it = 0; it < 6; it++) {
      let mx = 0; const st = Math.max(2, (maxx - minx + 2 * E) / 40);
      for (let y = miny - E; y <= maxy + E; y += st) for (let x = minx - E; x <= maxx + E; x += st) {
        const e = zAt(surface, x, y); if (e != null) mx = Math.max(mx, Math.abs(e - strip - padElev));
      }
      const need = m * mx + 5; if (need <= E) break; E = Math.min(need, 400);
    }
    const bx0 = minx - E, by0 = miny - E, bx1 = maxx + E, by1 = maxy + E;
    const r = Math.max(0.5, Math.sqrt((bx1 - bx0) * (by1 - by0) / maxCells));
    const cells = [], dz = [];
    let cut = 0, fill = 0, cutA = 0, fillA = 0, maxCut = 0, maxFill = 0, missing = 0, padCells = 0, padMissing = 0, disturbed = 0, edge = false;
    const ca = r * r;
    for (let y = by0 + r / 2; y < by1; y += r) for (let x = bx0 + r / 2; x < bx1; x += r) {
      const inside = inPoly(x, y, top);
      let e = zAt(surface, x, y);
      if (inside) padCells++;
      if (e == null) { missing++; if (inside) padMissing++; continue; }
      e -= strip;
      let d;
      if (inside) d = e - padElev;
      else {
        const h = distToPoly(x, y, top) / m;
        d = e > padElev + h ? e - (padElev + h) : e < padElev - h ? e - (padElev - h) : 0;
        if (d === 0) continue;
      }
      cells.push([x, y]); dz.push(d); disturbed += ca;
      if (!inside && (x - bx0 < 2 * r || bx1 - x < 2 * r || y - by0 < 2 * r || by1 - y < 2 * r)) edge = true;
      if (d > 0) { cut += d * ca; cutA += ca; maxCut = Math.max(maxCut, d); }
      else if (d < 0) { fill += -d * ca; fillA += ca; maxFill = Math.max(maxFill, -d); }
    }
    return {
      top, padElev, cutCY: cut / 27, fillCY: fill / 27, cutArea: cutA, fillArea: fillA, maxCut, maxFill,
      padArea: polyArea(top), footprintArea: polyArea(footprint), disturbedArea: disturbed, reach: E, clipped: edge || E >= 400,
      missingFrac: padCells ? padMissing / padCells : 1, outsideMissing: missing - padMissing,
      ras: { cells, r, bbox: [bx0, by0, bx1, by1] }, dz: Float32Array.from(dz)
    };
  }
  // Slab elevation that balances the pad: cut = fill × (1 + extra)
  function padBalanceSlab(surface, footprint, p) {
    const f = s => { const r = padEarthwork(surface, footprint, Object.assign({}, p, { slabElev: s }), 15000); return r.cutCY - r.fillCY * (1 + (p.extraPct || 0) / 100); };
    let lo = p.slabElev - 30, hi = p.slabElev + 30;
    for (let i = 0; i < 40 && hi - lo > 0.01; i++) { const mid = (lo + hi) / 2; if (f(mid) > 0) lo = mid; else hi = mid; }
    return (lo + hi) / 2;
  }

  const api = {
    M2FT, SF_PER_ACRE, toXY, toLL, polyArea, polyCentroid, inPoly, lineLength, lineBufferRects,
    convexHull, simplify, makeGridSpec, gridNodeXY, zAt, covers, idw, median, rasterize, designFn,
    cutFill, balanceOffset, offsetPolygon, distToPoly, padEarthwork, padBalanceSlab
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Geo = api;
})(typeof window !== 'undefined' ? window : this);
