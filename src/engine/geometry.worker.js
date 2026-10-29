// Builds all heavy geometry off the main thread: building shells with roofs,
// road ribbons, street lamps, traffic paths, rail chains and tree placement.
// Everything is returned as typed arrays (transferred, not copied).
import earcut from 'earcut';
import { terrainSampler, hash2 } from './geo.js';

const post = (msg, transfer) => self.postMessage(msg, transfer || []);
const progress = (stage, value) => post({ type: 'progress', stage, value });

/* ------------------------------------------------------------------ utils */
class Buf {
  constructor(Type, size = 1 << 14) { this.T = Type; this.a = new Type(size); this.n = 0; }
  grow(k) { if (this.n + k > this.a.length) { let s = this.a.length * 2; while (s < this.n + k) s *= 2; const b = new this.T(s); b.set(this.a.subarray(0, this.n)); this.a = b; } }
  push1(a) { this.grow(1); this.a[this.n++] = a; }
  push2(a, b) { this.grow(2); const t = this.a, n = this.n; t[n] = a; t[n + 1] = b; this.n += 2; }
  push3(a, b, c) { this.grow(3); const t = this.a, n = this.n; t[n] = a; t[n + 1] = b; t[n + 2] = c; this.n += 3; }
  push4(a, b, c, d) { this.grow(4); const t = this.a, n = this.n; t[n] = a; t[n + 1] = b; t[n + 2] = c; t[n + 3] = d; this.n += 4; }
  out() { return this.a.slice(0, this.n); }
}

function signedArea(r) { let s = 0; for (let i = 0, n = r.length; i < n; i += 2) { const j = (i + 2) % n; s += r[i] * r[j + 1] - r[j] * r[i + 1]; } return s / 2; }
function pointInRing(x, z, r) {
  let inside = false;
  for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
    const xi = r[i], zi = r[i + 1], xj = r[j], zj = r[j + 1];
    if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
function isConvex(r) {
  let sign = 0; const n = r.length / 2;
  for (let i = 0; i < n; i++) {
    const a = i * 2, b = ((i + 1) % n) * 2, c = ((i + 2) % n) * 2;
    const cr = (r[b] - r[a]) * (r[c + 1] - r[b + 1]) - (r[b + 1] - r[a + 1]) * (r[c] - r[b]);
    if (Math.abs(cr) < 1e-12) continue;
    const s = cr > 0 ? 1 : -1; if (!sign) sign = s; else if (s !== sign) return false;
  }
  return true;
}
function cleanRing(src) {
  const out = [];
  for (let i = 0; i < src.length; i += 2) {
    const x = src[i], z = src[i + 1], n = out.length;
    if (n && Math.abs(out[n - 2] - x) < 1e-5 && Math.abs(out[n - 1] - z) < 1e-5) continue;
    out.push(x, z);
  }
  while (out.length > 4 && Math.abs(out[0] - out[out.length - 2]) < 1e-5 && Math.abs(out[1] - out[out.length - 1]) < 1e-5) out.length -= 2;
  return out;
}

/** Scanline polygon fill on a byte raster. */
function fillRing(r, grid, W, H, x0, z0, cell, value, onlyEmpty = false) {
  let minz = Infinity, maxz = -Infinity;
  for (let i = 1; i < r.length; i += 2) { if (r[i] < minz) minz = r[i]; if (r[i] > maxz) maxz = r[i]; }
  const j0 = Math.max(0, Math.floor((minz - z0) / cell)), j1 = Math.min(H - 1, Math.ceil((maxz - z0) / cell));
  const xs = [];
  for (let j = j0; j <= j1; j++) {
    const z = z0 + (j + .5) * cell; xs.length = 0;
    for (let i = 0, k = r.length - 2; i < r.length; k = i, i += 2) {
      const zi = r[i + 1], zk = r[k + 1];
      if ((zi > z) !== (zk > z)) xs.push(r[i] + (z - zi) / (zk - zi) * (r[k] - r[i]));
    }
    xs.sort((a, b) => a - b);
    for (let q = 0; q + 1 < xs.length; q += 2) {
      const a = Math.max(0, Math.floor((xs[q] - x0) / cell)), b = Math.min(W - 1, Math.floor((xs[q + 1] - x0) / cell));
      const row = j * W;
      for (let i = a; i <= b; i++) if (!onlyEmpty || !grid[row + i]) grid[row + i] = value;
    }
  }
}

/* ---------------------------------------------------------------- palette */
const hex = h => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];
const WALLS = ['#d9ccb2', '#e0d3ba', '#cdbfa6', '#dcc4a0', '#e4dccd', '#c9b89b', '#d8bea6', '#cfc9bd', '#dcc7ad', '#beb4a2', '#dbb995', '#c6ccc6', '#e3cfa6', '#c4ad8b', '#d6b4a4', '#b9c2b8', '#e0d8c8'].map(hex);
const HOUSE_WALLS = ['#e2cfae', '#d9bf98', '#e4d6c0', '#ceb08b', '#d6c7ae', '#c9a481'].map(hex);
const INDUSTRIAL_WALLS = ['#c9ccc8', '#bfc4c4', '#d4d3cc', '#b6bdbf', '#c7c2b8', '#a9b4b8'].map(hex);
const GLASS_WALLS = ['#c8ced0', '#d8dad5', '#b9c3c7', '#e1e0da'].map(hex);
const TILES = ['#a0533c', '#b0603f', '#94493a', '#a95f48', '#8f5443', '#b66d4d', '#9b5a46'].map(hex);
const FLAT = ['#9e9a91', '#a8a49a', '#8f8d88', '#b1ada3', '#97928a'].map(hex);
const METAL = ['#c4c8c6', '#b5bbbb', '#d1d1cb', '#a2adb0', '#8fa0aa'].map(hex);
const NAMED = { red: '#9c4a3a', white: '#eeeeea', grey: '#9a9a96', gray: '#9a9a96', blue: '#6d8aa0', brown: '#8a5d44', green: '#6c8a67', yellow: '#e3cf8d', beige: '#ddd0b5', orange: '#c47a4a', black: '#3a3a3a' };
function tagColour(t) {
  if (!t) return null; t = t.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(t)) return hex(t);
  if (/^#[0-9a-f]{3}$/.test(t)) return hex('#' + t[1] + t[1] + t[2] + t[2] + t[3] + t[3]);
  return NAMED[t] ? hex(NAMED[t]) : null;
}
const pick = (arr, r) => arr[Math.floor(r * arr.length) % arr.length];
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/* --------------------------------------------------------- land classes */
// 1 industrial, 2 residential, 3 green (park, garden, grass), 4 forest, 5 water, 6 farmland, 7 pitch, 8 cemetery
const LAND_CLASS = { industrial: 1, residential: 2, park: 3, garden: 3, grass: 3, playground: 3, recreation_ground: 3, meadow: 3, grassland: 3, village_green: 3, wood: 4, forest: 4, scrub: 4, nature_reserve: 4, water: 5, wetland: 5, farmland: 6, orchard: 6, vineyard: 6, pitch: 7, cemetery: 8 };

self.onmessage = async ({ data }) => {
  if (data.type !== 'build') return;
  try { build(data); } catch (err) { post({ type: 'error', message: String(err && err.stack || err) }); }
};

function build({ osm, terrain, ground, options }) {
  const elev = terrainSampler(terrain);
  const [bx0, bz0, bx1, bz1] = terrain.bounds;

  /* land class raster (25 m) */
  const LC = .025, LW = Math.ceil((bx1 - bx0) / LC), LH = Math.ceil((bz1 - bz0) / LC);
  const land = new Uint8Array(LW * LH);
  const landSorted = osm.land.map(([k, r]) => [k, r, Math.abs(signedArea(r))]).sort((a, b) => b[2] - a[2]);
  for (const [k, r] of landSorted) { const c = LAND_CLASS[k]; if (c && r.length >= 6) fillRing(r, land, LW, LH, bx0, bz0, LC, c); }
  const landAt = (x, z) => { const i = Math.floor((x - bx0) / LC), j = Math.floor((z - bz0) / LC); return i < 0 || j < 0 || i >= LW || j >= LH ? 0 : land[j * LW + i]; };

  /* occupancy raster for tree placement (5 m) */
  const OC = .005, OW = Math.ceil((bx1 - bx0) / OC), OH = Math.ceil((bz1 - bz0) / OC);
  const occ = new Uint8Array(OW * OH);

  /* ground colour sampler (styled satellite, covers terrain bounds) */
  const sat = (x, z) => {
    if (!ground) return null;
    const { width: w, height: h, data: px } = ground;
    const u = Math.floor((x - bx0) / (bx1 - bx0) * w), v = Math.floor((z - bz0) / (bz1 - bz0) * h);
    let r = 0, g = 0, b = 0, n = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const uu = u + dx, vv = v + dy; if (uu < 0 || vv < 0 || uu >= w || vv >= h) continue;
      const o = (vv * w + uu) * 4; r += px[o]; g += px[o + 1]; b += px[o + 2]; n++;
    }
    if (!n) return null;
    // Boost the dim mosaic towards a plausible roof albedo.
    const k = 1 / (n * 255);
    return [Math.min(1, Math.pow(r * k, .8) * 1.12), Math.min(1, Math.pow(g * k, .8) * 1.12), Math.min(1, Math.pow(b * k, .8) * 1.12)];
  };

  /* named buildings */
  const named = [];
  for (const p of osm.pois) if (p[3] === 'building' && p.wx !== undefined) named.push(p);

  /* ---------------------------------------------------------- buildings */
  const CH = options.chunkSize || 1.6;
  const chunks = new Map();
  const getChunk = (x, z) => {
    const key = Math.floor((x - bx0) / CH) + ',' + Math.floor((z - bz0) / CH);
    let c = chunks.get(key);
    if (!c) { c = { key, pos: new Buf(Float32Array), nor: new Buf(Int8Array), uv: new Buf(Float32Array), col: new Buf(Uint8Array), info: new Buf(Float32Array), idx: new Buf(Uint32Array), v: 0 }; chunks.set(key, c); }
    return c;
  };
  const meta = new Float32Array(osm.buildings.length * 12);
  // grid of building ids for naming (100 m)
  const BG = .1, bgrid = new Map();
  const tmpN = [0, 0, 0];

  function vert(c, x, y, z, nx, ny, nz, u, v, colr, bid, style, rel, seed) {
    c.pos.push3(x, y, z);
    c.nor.push3(Math.round(nx * 127), Math.round(ny * 127), Math.round(nz * 127));
    c.uv.push2(u, v);
    c.col.push3(colr[0] * 255 | 0, colr[1] * 255 | 0, colr[2] * 255 | 0);
    c.info.push4(bid, style, rel, seed);
    return c.v++;
  }
  function faceNormal(ax, ay, az, bx, by, bz, cx, cy, cz) {
    const ux = bx - ax, uy = by - ay, uz = bz - az, vx = cx - ax, vy = cy - ay, vz = cz - az;
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const l = Math.hypot(nx, ny, nz) || 1;
    tmpN[0] = nx / l; tmpN[1] = ny / l; tmpN[2] = nz / l; return tmpN;
  }
  /** Triangle with automatic up-facing winding; uv per vertex in metres. */
  function roofTri(c, p, colr, bid, style, seed, eave) {
    // p: [x,y,z,rel] * 3 ; eave: [ex, ez, dx, dz] eave line point and unit direction
    let n = faceNormal(p[0], p[1], p[2], p[4], p[5], p[6], p[8], p[9], p[10]);
    let order = [0, 4, 8];
    if (n[1] < 0) { order = [0, 8, 4]; n = [-n[0], -n[1], -n[2]]; } else n = [n[0], n[1], n[2]];
    const slopeCos = Math.max(.35, n[1]);
    for (const o of order) {
      const x = p[o], y = p[o + 1], z = p[o + 2], rel = p[o + 3];
      let u = 0, v = 0;
      if (eave) { const rx = x - eave[0], rz = z - eave[1]; u = (rx * eave[2] + rz * eave[3]) * 1000; v = Math.abs(rx * eave[3] - rz * eave[2]) * 1000 / slopeCos; }
      else { u = x * 1000; v = z * 1000; }
      c.idx.push1(vert(c, x, y, z, n[0], n[1], n[2], u, v, colr, bid, style, rel, seed));
    }
  }

  const total = osm.buildings.length;
  const stats = { pitched: 0, flat: 0, named: 0 };
  for (let bid = 0; bid < total; bid++) {
    if (bid % 2000 === 0) progress('buildings', bid / total);
    const b = osm.buildings[bid];
    const ring = cleanRing(b[0]);
    if (ring.length < 6) continue;
    let sa = signedArea(ring);
    const area = Math.abs(sa) * 1e6;
    if (area < 6) continue;
    const n = ring.length / 2;
    let cx = 0, cz = 0; for (let i = 0; i < ring.length; i += 2) { cx += ring[i]; cz += ring[i + 1]; } cx /= n; cz /= n;
    const r1 = hash2(cx * 13.1, cz * 7.7), r2 = hash2(cx + 3.3, cz - 9.1), r3 = hash2(cz * 5.3, cx * 2.9);
    const lc = landAt(cx, cz);
    const industrial = b[3] === 2 || (lc === 1 && area > 250) || area > 3200;

    // heights in metres: OSM tags first, otherwise an estimate quantised to floors
    let floorH = industrial ? 5 : 3.05, floors, heightM, known = 0;
    if (b[1]) { heightM = b[1]; floors = Math.max(1, Math.round(heightM / floorH)); known = 1; }
    else if (b[2]) { floors = Math.max(1, Math.round(b[2])); heightM = floors * floorH + .6; known = 2; }
    else {
      if (industrial) floors = area > 6000 ? 3 : area > 1500 ? 2 + (r1 > .6) : 1 + (r1 > .5) + (r1 > .85);
      else if (b[3] === 0) floors = area < 200 ? 1 + Math.round(r1 * 2) : 2 + Math.round(r1 * 3);
      else if (area < 60) floors = 1 + (r1 > .55);
      else if (area < 130) floors = 2 + Math.round(r1 * 1.4);
      else if (area < 260) floors = 3 + Math.round(r1 * 2.2);
      else if (area < 650) floors = 4 + Math.round(r1 * 3.2);
      else if (area < 1600) floors = 5 + Math.round(r1 * 5);
      else floors = 4 + Math.round(r1 * 4);
      heightM = floors * floorH + (industrial ? 0 : .6);
    }
    let style = industrial ? 2 : (floors >= 9 || (b[3] === 0 && area > 1400 && r2 > .4)) ? 1 : (floors <= 2 && area < 200) ? 3 : 0;

    // roof type: 0 flat, 1 hipped (rectangles), 2 pyramid
    const convex = isConvex(ring);
    let roofType = 0;
    if (!industrial && style !== 1 && convex && n <= 10 && area < 1300 && r3 < (style === 3 ? .92 : .78)) roofType = n === 4 ? 1 : 2;

    // colours
    let wallC = tagColour(b[5]) || (style === 2 ? pick(INDUSTRIAL_WALLS, r2) : style === 1 ? pick(GLASS_WALLS, r2) : style === 3 ? pick(HOUSE_WALLS, r2) : pick(WALLS, r2));
    let roofC = tagColour(b[4]);
    if (!roofC) {
      const s = sat(cx, cz);
      if (roofType) roofC = pick(TILES, r3);
      else if (industrial) roofC = s ? mix(pick(METAL, r3), s, area > 2500 ? .75 : .45) : pick(METAL, r3);
      else roofC = s ? mix(pick(FLAT, r3), s, .3) : pick(FLAT, r3);
    }

    // ground and top
    let gMin = Infinity, gMax = -Infinity;
    const gy = new Float32Array(n);
    for (let i = 0; i < n; i++) { const g = elev(ring[i * 2], ring[i * 2 + 1]); gy[i] = g; if (g < gMin) gMin = g; if (g > gMax) gMax = g; }
    const hKm = heightM / 1000, base = gMin + (gMax - gMin) * .5, top = base + hKm;
    const sink = .0015;
    const seed = r1;
    const c = getChunk(cx, cz);
    const positive = sa >= 0;

    // walls (each edge spans a whole number of window bays)
    const bay = style === 2 ? 6 : style === 1 ? 2.6 : style === 3 ? 3.4 : 3.1;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n, ax = ring[i * 2], az = ring[i * 2 + 1], bx = ring[j * 2], bz = ring[j * 2 + 1];
      const dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz); if (len < 2e-4) continue;
      const nx = (positive ? dz : -dz) / len, nz = (positive ? -dx : dx) / len;
      const bays = Math.max(1, Math.round(len * 1000 / bay));
      const ya = gy[i] - sink, yb = gy[j] - sink;
      const va = (ya - base) * 1000 / floorH, vb = (yb - base) * 1000 / floorH, vt = hKm * 1000 / floorH;
      const i0 = vert(c, ax, ya, az, nx, 0, nz, 0, va, wallC, bid, style, 0, seed);
      const i1 = vert(c, bx, yb, bz, nx, 0, nz, bays, vb, wallC, bid, style, 0, seed);
      const i2 = vert(c, bx, top, bz, nx, 0, nz, bays, vt, wallC, bid, style, hKm, seed);
      const i3 = vert(c, ax, top, az, nx, 0, nz, 0, vt, wallC, bid, style, hKm, seed);
      // outward winding: (A,C,B)(A,D,C) when the right-hand perpendicular is outward
      if (-dz * nx + dx * nz > 0) c.idx.push3(i0, i1, i2), c.idx.push3(i0, i2, i3);
      else c.idx.push3(i0, i2, i1), c.idx.push3(i0, i3, i2);
    }

    // roof
    const roofStyle = 10 + roofType; // > 9 tells the shader this is a roof
    let built = false;
    if (roofType === 1) {
      // hipped roof over a quadrilateral: ridge along the longer axis
      const P = [0, 1, 2, 3].map(k => [ring[k * 2], ring[k * 2 + 1]]);
      const e0 = Math.hypot(P[1][0] - P[0][0], P[1][1] - P[0][1]), e1 = Math.hypot(P[2][0] - P[1][0], P[2][1] - P[1][1]);
      let Q = e0 >= e1 ? P : [P[1], P[2], P[3], P[0]];
      const L = Math.max(e0, e1), Wd = Math.min(e0, e1);
      if (Wd > 0.003) {
        const ux = ((Q[1][0] - Q[0][0]) + (Q[2][0] - Q[3][0])) / 2, uz = ((Q[1][1] - Q[0][1]) + (Q[2][1] - Q[3][1])) / 2, ul = Math.hypot(ux, uz);
        const dxu = ux / ul, dzu = uz / ul, half = Math.max(0, (L - Wd) / 2);
        const rh = Math.min(3.6, Math.max(1.3, Wd * 1000 * .26)) / 1000;
        const ry = top + rh, rrel = hKm + rh;
        const R1 = [cx - dxu * half, ry, cz - dzu * half, rrel], R2 = [cx + dxu * half, ry, cz + dzu * half, rrel];
        const T = q => [q[0], top, q[1], hKm];
        const eaveOf = (a, b) => { const ex = b[0] - a[0], ez = b[1] - a[1], l = Math.hypot(ex, ez) || 1; return [a[0], a[1], ex / l, ez / l]; };
        const quad = (a, bq, r2, r1) => { const ev = eaveOf(a, bq); roofTri(c, [...T(a), ...T(bq), ...r2], roofC, bid, roofStyle, seed, ev); roofTri(c, [...T(a), ...r2, ...r1], roofC, bid, roofStyle, seed, ev); };
        quad(Q[0], Q[1], R2, R1);
        quad(Q[2], Q[3], R1, R2);
        roofTri(c, [...T(Q[1]), ...T(Q[2]), ...R2], roofC, bid, roofStyle, seed, eaveOf(Q[1], Q[2]));
        roofTri(c, [...T(Q[3]), ...T(Q[0]), ...R1], roofC, bid, roofStyle, seed, eaveOf(Q[3], Q[0]));
        built = true; stats.pitched++;
      }
    } else if (roofType === 2) {
      const rh = Math.min(3.4, Math.max(1.2, Math.sqrt(area) * .22)) / 1000;
      const apex = [cx, top + rh, cz, hKm + rh];
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n, a = [ring[i * 2], ring[i * 2 + 1]], bq = [ring[j * 2], ring[j * 2 + 1]];
        const ex = bq[0] - a[0], ez = bq[1] - a[1], l = Math.hypot(ex, ez); if (l < 1e-5) continue;
        roofTri(c, [a[0], top, a[1], hKm, bq[0], top, bq[1], hKm, ...apex], roofC, bid, roofStyle, seed, [a[0], a[1], ex / l, ez / l]);
      }
      built = true; stats.pitched++;
    }
    if (!built) {
      roofType = 0;
      const tri = earcut(ring);
      for (let t = 0; t < tri.length; t += 3) {
        const a = tri[t] * 2, bq = tri[t + 1] * 2, cc = tri[t + 2] * 2;
        roofTri(c, [ring[a], top, ring[a + 1], hKm, ring[bq], top, ring[bq + 1], hKm, ring[cc], top, ring[cc + 1], hKm], roofC, bid, industrial ? 13 : 10, seed, null);
      }
      stats.flat++;
    }

    // occupancy for tree placement
    fillRing(ring, occ, OW, OH, bx0, bz0, OC, 1);

    const m = bid * 12;
    meta[m] = cx; meta[m + 1] = cz; meta[m + 2] = heightM; meta[m + 3] = known; meta[m + 4] = floors; meta[m + 5] = area;
    meta[m + 6] = gMin; meta[m + 7] = style; meta[m + 8] = roofType; meta[m + 9] = b[3]; meta[m + 10] = industrial ? 1 : 0; meta[m + 11] = top;
    const gk = Math.floor(cx / BG) + ',' + Math.floor(cz / BG);
    (bgrid.get(gk) || bgrid.set(gk, []).get(gk)).push(bid);
    osm.buildings[bid] = ring; // keep the cleaned ring for naming
  }

  // attach names of named building POIs
  const names = {};
  for (const p of named) {
    const i0 = Math.floor(p.wx / BG), j0 = Math.floor(p.wz / BG);
    search: for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
      const list = bgrid.get((i0 + di) + ',' + (j0 + dj)); if (!list) continue;
      for (const id of list) if (Array.isArray(osm.buildings[id]) && pointInRing(p.wx, p.wz, osm.buildings[id])) { names[id] = p[0]; stats.named++; break search; }
    }
  }
  // mosques: a lead dome and a minaret, the most recognisable silhouette of an İstanbul street
  const LEAD = [.56, .6, .63], STONE = [.92, .9, .85];
  for (const id in names) {
    if (!names[id].toLocaleLowerCase('tr').includes('cami')) continue;
    const m = id * 12, cx = meta[m], cz = meta[m + 1], area = meta[m + 5], top = meta[m + 11], hKm = meta[m + 2] / 1000, ring = osm.buildings[id];
    const c = getChunk(cx, cz), bid = +id;
    const rd = Math.min(14, Math.max(3.5, Math.sqrt(area) * .3)) / 1000;
    const SEG = 14, RINGS = 6;
    const base = c.v;
    for (let r = 0; r <= RINGS; r++) {
      const ph = r / RINGS * Math.PI / 2, y = Math.sin(ph), rr = Math.cos(ph);
      for (let s = 0; s <= SEG; s++) {
        const th = s / SEG * Math.PI * 2, nx = Math.cos(th) * rr, nz = Math.sin(th) * rr;
        vert(c, cx + nx * rd, top + y * rd, cz + nz * rd, nx, y, nz, s, r, LEAD, bid, 14, hKm + y * rd, .5);
      }
    }
    for (let r = 0; r < RINGS; r++) for (let s = 0; s < SEG; s++) {
      const a = base + r * (SEG + 1) + s, b = a + SEG + 1;
      c.idx.push3(a, b, a + 1); c.idx.push3(a + 1, b, b + 1);
    }
    // minaret at the first corner
    const mx = ring[0] + (cx - ring[0]) * .08, mz = ring[1] + (cz - ring[1]) * .08, g = elev(mx, mz) - .001;
    const mh = Math.max(hKm + .02, .026), mr = .0014, SIDES = 8;
    const cyl = (r0, r1, y0, y1, rel0, rel1) => {
      const b0 = c.v;
      for (let s = 0; s <= SIDES; s++) {
        const th = s / SIDES * Math.PI * 2, nx = Math.cos(th), nz = Math.sin(th), slope = (r0 - r1) / (y1 - y0 || 1) * .001;
        const nl = Math.hypot(1, slope);
        vert(c, mx + nx * r0, y0, mz + nz * r0, nx / nl, slope / nl, nz / nl, s, 0, STONE, bid, 15, rel0, .5);
        vert(c, mx + nx * r1, y1, mz + nz * r1, nx / nl, slope / nl, nz / nl, s, 1, STONE, bid, 15, rel1, .5);
      }
      for (let s = 0; s < SIDES; s++) { const a = b0 + s * 2; c.idx.push3(a, a + 2, a + 1); c.idx.push3(a + 1, a + 2, a + 3); }
    };
    const baseRel = 0;
    cyl(mr, mr, g, g + mh * .78, 0, mh * .78 + baseRel);
    cyl(mr * 1.7, mr * 1.7, g + mh * .78, g + mh * .8, mh * .78 + baseRel, mh * .8 + baseRel);
    cyl(mr * .9, mr * .9, g + mh * .8, g + mh, mh * .8 + baseRel, mh + baseRel);
    cyl(mr * .95, 0.00005, g + mh, g + mh + .006, mh + baseRel, mh + .006 + baseRel);
    stats.mosques = (stats.mosques || 0) + 1;
  }
  progress('buildings', 1);

  const chunkOut = [], transfer = [];
  for (const c of chunks.values()) {
    const o = { key: c.key, position: c.pos.out(), normal: c.nor.out(), uv: c.uv.out(), color: c.col.out(), info: c.info.out(), index: c.idx.out() };
    chunkOut.push(o); transfer.push(o.position.buffer, o.normal.buffer, o.uv.buffer, o.color.buffer, o.info.buffer, o.index.buffer);
  }
  transfer.push(meta.buffer);

  /* --------------------------------------------------------------- roads */
  progress('roads', 0);
  const WIDTH = [3.2, 6.5, 9.5, 13, 22, 6, 0, 5, 13]; // metres per road kind
  const ORDER = { 7: 0, 0: 1, 1: 2, 5: 3, 2: 4, 3: 5, 4: 6, 8: 7 };
  const roads = osm.roads.filter(([k, a]) => ORDER[k] !== undefined && a.length >= 4).sort((a, b) => ORDER[a[0]] - ORDER[b[0]]);
  const rp = new Buf(Float32Array), racr = new Buf(Float32Array), ruv = new Buf(Float32Array), rk = new Buf(Float32Array), ri = new Buf(Uint32Array);
  const lamps = new Buf(Float32Array);
  const paths = new Buf(Float32Array), pathOffsets = [0], pathKinds = [];
  let rv = 0;
  const STEP = .02; // resample every 20 m so ribbons follow the terrain
  for (let q = 0; q < roads.length; q++) {
    const [kind, a] = roads[q];
    const hw = WIDTH[kind] / 2000;
    // resample
    const pts = [];
    for (let i = 0; i < a.length - 2; i += 2) {
      const ax = a[i], az = a[i + 1], bx = a[i + 2], bz = a[i + 3], l = Math.hypot(bx - ax, bz - az);
      if (l < 1e-6) continue;
      const s = Math.max(1, Math.ceil(l / STEP));
      for (let k = 0; k < s; k++) pts.push(ax + (bx - ax) * k / s, az + (bz - az) * k / s);
    }
    pts.push(a[a.length - 2], a[a.length - 1]);
    const m = pts.length / 2; if (m < 2) continue;
    let dist = 0, lampNext = kind === 1 ? .045 * hash2(q, 1) : .015;
    const lampGap = kind === 4 ? .032 : kind === 3 ? .03 : kind === 2 ? .034 : .048;
    const lift = kind === 7 ? .00015 : .0004;
    for (let i = 0; i < m; i++) {
      const x = pts[i * 2], z = pts[i * 2 + 1];
      const px = pts[Math.max(0, i - 1) * 2], pz = pts[Math.max(0, i - 1) * 2 + 1];
      const nx2 = pts[Math.min(m - 1, i + 1) * 2], nz2 = pts[Math.min(m - 1, i + 1) * 2 + 1];
      let t1x = x - px, t1z = z - pz, t2x = nx2 - x, t2z = nz2 - z;
      let l1 = Math.hypot(t1x, t1z), l2 = Math.hypot(t2x, t2z);
      if (l1 < 1e-9) { t1x = t2x; t1z = t2z; l1 = l2; } if (l2 < 1e-9) { t2x = t1x; t2z = t1z; l2 = l1; }
      t1x /= l1; t1z /= l1; t2x /= l2; t2z /= l2;
      let mx = -(t1z + t2z), mz = t1x + t2x; const ml = Math.hypot(mx, mz) || 1; mx /= ml; mz /= ml;
      const dot = mx * -t1z + mz * t1x; const scale = Math.min(2, 1 / Math.max(.5, dot));
      if (i > 0) dist += Math.hypot(x - px, z - pz);
      const y = elev(x, z) + lift;
      rp.push3(x, y, z); rp.push3(x, y, z);
      racr.push2(mx * hw * scale, mz * hw * scale); racr.push2(mx * hw * scale, mz * hw * scale);
      ruv.push2(-1, dist * 1000); ruv.push2(1, dist * 1000);
      rk.push2(kind, kind);
      if (i > 0) { const b0 = rv - 2; ri.push3(b0, b0 + 1, rv); ri.push3(b0 + 1, rv + 1, rv); }
      rv += 2;
      // street lamps on driveable roads
      if (kind >= 1 && kind <= 4 && dist >= lampNext) {
        lampNext = dist + lampGap;
        const off = hw + .0012, side = kind === 1 ? (hash2(q, i) > .5 ? 1 : -1) : 1;
        lamps.push3(x + mx * off * side, y + .0075, z + mz * off * side);
        if (kind >= 2) lamps.push3(x - mx * off, y + .0075, z - mz * off);
      }
    }
    // traffic paths
    if ((kind >= 1 && kind <= 4) || kind === 8) {
      for (let i = 0; i < m; i++) { const x = pts[i * 2], z = pts[i * 2 + 1]; paths.push3(x, elev(x, z) + lift, z); }
      pathOffsets.push(paths.n / 3); pathKinds.push(kind);
    }
    // occupancy: stamp the road so trees keep off it
    if (kind !== 7) {
      const rad = Math.ceil((hw + .0015) / OC);
      for (let i = 0; i < m; i++) {
        const gi = Math.floor((pts[i * 2] - bx0) / OC), gj = Math.floor((pts[i * 2 + 1] - bz0) / OC);
        for (let dj = -rad; dj <= rad; dj++) for (let di = -rad; di <= rad; di++) {
          const ii = gi + di, jj = gj + dj; if (ii >= 0 && jj >= 0 && ii < OW && jj < OH) occ[jj * OW + ii] = 1;
        }
      }
    }
    if (q % 1500 === 0) progress('roads', q / roads.length);
  }
  const roadOut = { position: rp.out(), across: racr.out(), uv: ruv.out(), kind: rk.out(), index: ri.out() };
  transfer.push(roadOut.across.buffer, roadOut.position.buffer, roadOut.uv.buffer, roadOut.kind.buffer, roadOut.index.buffer);
  const lampOut = lamps.out(); transfer.push(lampOut.buffer);
  const pathOut = { points: paths.out(), offsets: new Uint32Array(pathOffsets), kinds: new Uint8Array(pathKinds) };
  transfer.push(pathOut.points.buffer, pathOut.offsets.buffer, pathOut.kinds.buffer);

  /* --------------------------------------------------------- rail chains */
  const segs = osm.roads.filter(([k, a]) => k === 5 && a.length >= 4).map(([, a]) => a.slice());
  const chains = [];
  const close = (ax, az, bx, bz) => Math.abs(ax - bx) < .004 && Math.abs(az - bz) < .004;
  while (segs.length) {
    let chain = segs.pop(), grown = true;
    while (grown) {
      grown = false;
      for (let i = 0; i < segs.length; i++) {
        const s = segs[i], cl = chain.length, sl = s.length;
        if (close(chain[cl - 2], chain[cl - 1], s[0], s[1])) chain = chain.concat(s.slice(2));
        else if (close(chain[cl - 2], chain[cl - 1], s[sl - 2], s[sl - 1])) chain = chain.concat(rev(s).slice(2));
        else if (close(chain[0], chain[1], s[sl - 2], s[sl - 1])) chain = s.concat(chain.slice(2));
        else if (close(chain[0], chain[1], s[0], s[1])) chain = rev(s).concat(chain.slice(2));
        else continue;
        segs.splice(i, 1); grown = true; break;
      }
    }
    let len = 0; for (let i = 2; i < chain.length; i += 2) len += Math.hypot(chain[i] - chain[i - 2], chain[i + 1] - chain[i - 1]);
    if (len > 1.5) {
      const out = [];
      for (let i = 0; i < chain.length; i += 2) out.push(chain[i], elev(chain[i], chain[i + 1]) + .0006, chain[i + 1]);
      chains.push({ length: len, points: new Float32Array(out) });
    }
  }
  chains.sort((a, b) => b.length - a.length);
  const railOut = chains.slice(0, 4).map(c => c.points); railOut.forEach(p => transfer.push(p.buffer));

  /* --------------------------------------------------------------- trees */
  progress('trees', 0);
  const trees = new Buf(Float32Array);
  const occAt = (x, z) => { const i = Math.floor((x - bx0) / OC), j = Math.floor((z - bz0) / OC); return i < 0 || j < 0 || i >= OW || j >= OH ? 1 : occ[j * OW + i]; };
  // mapped trees always appear
  for (const [x, z] of osm.trees) {
    const r = hash2(x * 91.3, z * 17.1);
    trees.push4(x, elev(x, z), z, .75 + r * .5); trees.push2(r < .25 ? 1 : 0, r);
  }
  const DENSITY = { wood: 1 / 70, forest: 1 / 70, nature_reserve: 1 / 160, scrub: 1 / 260, park: 1 / 260, garden: 1 / 320, cemetery: 1 / 110, orchard: 1 / 45, recreation_ground: 1 / 600, playground: 1 / 500, grass: 1 / 1600, village_green: 1 / 800, meadow: 1 / 4000, grassland: 1 / 3000 };
  let expected = 0; const candidates = [];
  for (const [k, r] of osm.land) { const d = DENSITY[k]; if (!d || r.length < 6) continue; const a = Math.abs(signedArea(r)) * 1e6; expected += a * d; candidates.push([k, r, a, d]); }
  const budget = Math.max(0, (options.treeBudget || 60000) - osm.trees.length);
  const factor = expected > budget ? budget / expected : 1;
  let placed = 0;
  for (let ci = 0; ci < candidates.length; ci++) {
    const [k, r, a, d] = candidates[ci];
    let want = a * d * factor; want = Math.floor(want) + (hash2(ci, 7) < want % 1 ? 1 : 0);
    if (!want) continue;
    let minx = Infinity, minz = Infinity, maxx = -Infinity, maxz = -Infinity;
    for (let i = 0; i < r.length; i += 2) { minx = Math.min(minx, r[i]); maxx = Math.max(maxx, r[i]); minz = Math.min(minz, r[i + 1]); maxz = Math.max(maxz, r[i + 1]); }
    let tries = 0, got = 0;
    while (got < want && tries < want * 6) {
      tries++;
      const h1 = hash2(ci * 1.37 + tries * .713, tries * 3.17 + ci * .19), h2 = hash2(ci * 2.11 + tries * 1.93, tries * .57 - ci * 1.3);
      const x = minx + (maxx - minx) * h1, z = minz + (maxz - minz) * h2;
      if (!pointInRing(x, z, r) || occAt(x, z) || landAt(x, z) === 5) continue;
      const rr = hash2(x * 51.7, z * 33.3);
      let type = 0, s = .8 + rr * .6;
      if (k === 'wood' || k === 'forest' || k === 'nature_reserve') type = rr < .62 ? 1 : 0;
      else if (k === 'cemetery') type = rr < .7 ? 2 : 0;
      else if (k === 'scrub') { type = 3; s = .6 + rr * .6; }
      else if (k === 'orchard') { s = .55 + rr * .25; }
      else type = rr < .15 ? 1 : rr < .22 ? 2 : 0;
      trees.push4(x, elev(x, z), z, s); trees.push2(type, rr);
      got++; placed++;
    }
    if (ci % 400 === 0) progress('trees', ci / candidates.length);
  }
  // yard trees: gardens between apartment blocks in residential areas
  {
    const step = .022; let k = 0;
    for (let z = bz0; z < bz1; z += step) for (let x = bx0; x < bx1; x += step) {
      k++;
      const jx = x + hash2(k, 1.3) * step, jz = z + hash2(k, 7.9) * step;
      const c = landAt(jx, jz); if (c !== 2 && c !== 3) continue;
      if (hash2(k, 4.4) > (c === 2 ? .55 : .25) || occAt(jx, jz)) continue;
      // keep a little distance from walls
      if (occAt(jx + .004, jz) || occAt(jx - .004, jz) || occAt(jx, jz + .004) || occAt(jx, jz - .004)) continue;
      const rr = hash2(jx * 51.7, jz * 33.3);
      trees.push4(jx, elev(jx, jz), jz, .65 + rr * .5); trees.push2(rr < .12 ? 2 : rr < .2 ? 1 : 0, rr);
      placed++;
    }
  }
  const treeOut = trees.out(); transfer.push(treeOut.buffer);
  progress('trees', 1);

  post({
    type: 'done', chunks: chunkOut, meta, names, stats: { ...stats, trees: treeOut.length / 6, lamps: lampOut.length / 3, proceduralTrees: placed },
    roads: roadOut, lamps: lampOut, paths: pathOut, rails: railOut, trees: treeOut, chunkSize: CH
  }, transfer);
}

function rev(a) { const o = []; for (let i = a.length - 2; i >= 0; i -= 2) o.push(a[i], a[i + 1]); return o; }
