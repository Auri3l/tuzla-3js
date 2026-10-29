// Builds all heavy geometry off the main thread: building shells with roofs,
// road ribbons, street lamps, traffic paths, rail chains and tree placement.
// Everything is returned as typed arrays (transferred, not copied).
import earcut from 'earcut';
import { terrainSampler, hash2, toWorld } from './geo.js';
import { buildLandmarks } from './landmarks.js';

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

/** Splits an orthogonal 6-corner L plan into two overlapping rectangles (each [[x,z]×4]), or null. */
function lShapeWings(r) {
  const n = r.length / 2; if (n !== 6) return null;
  let best = 0, ux = 1, uz = 0;
  for (let i = 0; i < n; i++) { const j = (i + 1) % n, ex = r[j * 2] - r[i * 2], ez = r[j * 2 + 1] - r[i * 2 + 1], l = Math.hypot(ex, ez); if (l > best) { best = l; ux = ex / l; uz = ez / l; } }
  const vx = -uz, vz = ux, ox = r[0], oz = r[1], U = [], V = [];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n, ex = r[j * 2] - r[i * 2], ez = r[j * 2 + 1] - r[i * 2 + 1], l = Math.hypot(ex, ez) || 1, cs = Math.abs((ex * ux + ez * uz) / l);
    if (cs > .2 && cs < .97) return null;                       // not orthogonal
    U.push((r[i * 2] - ox) * ux + (r[i * 2 + 1] - oz) * uz); V.push((r[i * 2] - ox) * vx + (r[i * 2 + 1] - oz) * vz);
  }
  const u0 = Math.min(...U), u1 = Math.max(...U), v0 = Math.min(...V), v1 = Math.max(...V), tol = .0006;
  let k = -1;
  for (let i = 0; i < n; i++) if (U[i] > u0 + tol && U[i] < u1 - tol && V[i] > v0 + tol && V[i] < v1 - tol) { if (k >= 0) return null; k = i; }
  if (k < 0) return null;
  const ru = U[k], rv = V[k], cu = ru - u0 < u1 - ru ? u0 : u1, cv = rv - v0 < v1 - rv ? v0 : v1;
  const A = [u0, u1, cv === v0 ? rv : v0, cv === v0 ? v1 : rv], B = [cu === u0 ? ru : u0, cu === u0 ? u1 : ru, v0, v1];
  if (A[3] - A[2] < .003 || B[1] - B[0] < .003) return null;
  const W = R => [[R[0], R[2]], [R[1], R[2]], [R[1], R[3]], [R[0], R[3]]].map(([a, b]) => [ox + ux * a + vx * b, oz + uz * a + vz * b]);
  return [W(A), W(B)];
}

/** Mitred offset of a closed polygon given as [[x,z],...]: d > 0 grows it outward. */
function offsetPoly(P, d) {
  const n = P.length; let a = 0;
  for (let i = 0; i < n; i++) { const j = (i + 1) % n; a += P[i][0] * P[j][1] - P[j][0] * P[i][1]; }
  const s = a >= 0 ? 1 : -1, out = [];
  for (let i = 0; i < n; i++) {
    const p = P[(i + n - 1) % n], q = P[i], r = P[(i + 1) % n];
    let e1x = q[0] - p[0], e1z = q[1] - p[1], e2x = r[0] - q[0], e2z = r[1] - q[1];
    const l1 = Math.hypot(e1x, e1z) || 1, l2 = Math.hypot(e2x, e2z) || 1; e1x /= l1; e1z /= l1; e2x /= l2; e2z /= l2;
    const n1x = s * e1z, n1z = -s * e1x, n2x = s * e2z, n2z = -s * e2x;
    let mx = n1x + n2x, mz = n1z + n2z; const ml = Math.hypot(mx, mz);
    if (ml < 1e-6) { mx = n1x; mz = n1z; } else { mx /= ml; mz /= ml; }
    const k = Math.min(2.5, 1 / Math.max(.4, mx * n1x + mz * n1z));
    out.push([q[0] + mx * d * k, q[1] + mz * d * k]);
  }
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
const BRICK_WALLS = ['#b5654a', '#a85d45', '#c07a5c', '#d9c4a8', '#9e5a48', '#cdb79a', '#b98a6c'].map(hex);
const PUBLIC_WALLS = ['#e6d9bf', '#d8b48f', '#c98e6e', '#e9e2d2', '#d3c3a3', '#cfa98a'].map(hex);
const RETAIL_WALLS = ['#e4e6e4', '#d5d9da', '#eeeae2', '#c9d0d3', '#dfe1dc'].map(hex);
const HANGAR_WALLS = ['#8fa3b0', '#a7b4b8', '#7f97a6', '#b9bfbc', '#9aa8a2', '#c2c4bd'].map(hex);
// per style: wall palette and window-bay width (m)
const STYLE_WALLS = [WALLS, GLASS_WALLS, INDUSTRIAL_WALLS, HOUSE_WALLS, BRICK_WALLS, PUBLIC_WALLS, RETAIL_WALLS, HANGAR_WALLS];
const BAY = [3.1, 2.6, 6, 3.4, 3.0, 3.6, 4.5, 8];
// Phase 4 mahalle groups and palettes
const COASTAL_MAH = new Set(['Postane', 'Cami', 'İstasyon', 'Evliya Çelebi', 'Tuzla']);
const COASTAL_WALLS = ['#efe2c4', '#e8cf9e', '#f3ece0', '#e2b98f', '#ead9bd', '#d9a888', '#f1e6cf', '#dcc29a'].map(hex);
// northern villa estates: white stucco / warm render above a stone ground floor, low clay or slate roofs
const VILLA_MAH = new Set(['Tepeören', 'Akfırat', 'Orhanlı', 'Fatih', 'Anadolu', 'Mescit']);
const VILLA_WALLS = ['#f3efe6', '#efe6d2', '#e9dcc3', '#f6f3ec', '#e4d3b8', '#ead8bd'].map(hex);
const VILLA_TILES = ['#9c4e38', '#844232', '#5a5652'].map(hex);
// mosques: cut limestone (küfeki)
const KUFEKI = ['#e6dfd1', '#ded5c3', '#d6cbb8'].map(hex);
const DENSE_MAH = new Set(['Aydıntepe', 'İçmeler', 'Yayla', 'Şifa', 'Mimar Sinan', 'Orta', 'Aydınlı', 'Evliya Çelebi']);
// TOKİ / Kiptaş estates: warm sand and dual-tone beige plaster, one colour per estate
const ESTATE_WALLS = ['#e8d5b0', '#e6c9a8', '#efe0c6', '#dcc0a0', '#e9dccb', '#e3cdb4'].map(hex);
// yeni nesil site: white and light grey composite panels (anthracite trim comes from the shader)
const SITE_WALLS = ['#f2f2ef', '#e9eaea', '#dcdedd', '#f4f1ea', '#d2d4d4', '#e6e4df'].map(hex);
// Tersaneler (shipyard bay): 40.822..40.840 N, 29.275..29.298 E
const [SYX0, SYZ1] = toWorld(40.822, 29.275), [SYX1, SYZ0] = toWorld(40.840, 29.298);
const inShipyard = (x, z) => x > SYX0 && x < SYX1 && z > SYZ0 && z < SYZ1;
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

  // info = [bid, iy, rel, iw]; iy packs style + wallRole * 16 for walls or
  // 100 + roofStyle for roofs, iw packs floors (integer part) + seed (fraction).
  function vert(c, x, y, z, nx, ny, nz, u, v, colr, bid, iy, rel, iw) {
    c.pos.push3(x, y, z);
    c.nor.push3(Math.round(nx * 127), Math.round(ny * 127), Math.round(nz * 127));
    c.uv.push2(u, v);
    c.col.push3(colr[0] * 255 | 0, colr[1] * 255 | 0, colr[2] * 255 | 0);
    c.info.push4(bid, iy, rel, iw);
    return c.v++;
  }
  // info.w = floors + (archetype + seed) / 8: archetype 0 generic, 1 coastal/historic, 2 dense 1980s-90s,
  // 3 TOKİ/Kiptaş estate, 4 yeni nesil site, 5 suburban villa, 6 OSB industrial (style 5: mosque), 7 OSB with loading docks
  const packW = (floors, seed, arche = 0) => Math.floor(floors) + (arche + Math.min(.998, Math.max(.002, seed))) / 8;

  // mahalle of a point: the nearest suburb/town label
  const SUBURBS = osm.pois.filter(p => (p[3] === 'suburb' || p[3] === 'town') && p.wx !== undefined).map(p => [p[0], p.wx, p.wz]);
  const mahalleOf = (x, z) => { let best = '', bd = Infinity; for (const [nm, sx, sz] of SUBURBS) { const d = (sx - x) ** 2 + (sz - z) ** 2; if (d < bd) { bd = d; best = nm; } } return best; };
  function faceNormal(ax, ay, az, bx, by, bz, cx, cy, cz) {
    const ux = bx - ax, uy = by - ay, uz = bz - az, vx = cx - ax, vy = cy - ay, vz = cz - az;
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const l = Math.hypot(nx, ny, nz) || 1;
    tmpN[0] = nx / l; tmpN[1] = ny / l; tmpN[2] = nz / l; return tmpN;
  }
  /** Triangle with automatic up-facing winding; uv per vertex in metres. `style` is the packed info.y. */
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

  /** Planar quad P[0..3] (each [x,y,z]) facing along n, with uv per corner. rel = height above `base`. */
  function quadN(c, P, n, UV, colr, bid, iy, base, iw) {
    const ids = P.map((p, k) => vert(c, p[0], p[1], p[2], n[0], n[1], n[2], UV[k * 2], UV[k * 2 + 1], colr, bid, iy, Math.max(0, p[1] - base), iw));
    const f = faceNormal(P[0][0], P[0][1], P[0][2], P[1][0], P[1][1], P[1][2], P[2][0], P[2][1], P[2][2]);
    if (f[0] * n[0] + f[1] * n[1] + f[2] * n[2] >= 0) c.idx.push3(ids[0], ids[1], ids[2]), c.idx.push3(ids[0], ids[2], ids[3]);
    else c.idx.push3(ids[0], ids[2], ids[1]), c.idx.push3(ids[0], ids[3], ids[2]);
  }
  /** Box on an axis (ux, uz): half length hl along u, half depth hd across, from y0 to y1; top and four sides. */
  function box(c, x, z, ux, uz, hl, hd, y0, y1, colr, bid, iy, base, iw, uvScale = 1000, sides = 15) {
    const vx = -uz, vz = ux, k = uvScale;
    const C = [[-hl, -hd], [hl, -hd], [hl, hd], [-hl, hd]].map(([a, b]) => [x + ux * a + vx * b, z + uz * a + vz * b]);
    const H = (y1 - y0) * k;
    const N = [[-vx, 0, -vz], [ux, 0, uz], [vx, 0, vz], [-ux, 0, -uz]];
    for (let s2 = 0; s2 < 4; s2++) {
      if (!(sides >> s2 & 1)) continue;
      const a = C[s2], b2 = C[(s2 + 1) % 4], L = Math.hypot(b2[0] - a[0], b2[1] - a[1]) * k;
      quadN(c, [[a[0], y0, a[1]], [b2[0], y0, b2[1]], [b2[0], y1, b2[1]], [a[0], y1, a[1]]], N[s2], [0, 0, L, 0, L, H, 0, H], colr, bid, iy, base, iw);
    }
    quadN(c, C.map(p => [p[0], y1, p[1]]), [0, 1, 0], [0, 0, hl * 2 * k, 0, hl * 2 * k, hd * 2 * k, 0, hd * 2 * k], colr, bid, iy, base, iw);
  }

  const total = osm.buildings.length;
  const stats = { pitched: 0, flat: 0, named: 0, walls: [0, 0, 0, 0], styles: [0, 0, 0, 0, 0, 0, 0, 0], roofs: [0, 0, 0, 0] };

  /* ------------------------------------------------ urban topology rasters */
  const tTopo = performance.now();
  const { isNearRoad, rings, holesOf, partyWall, dup } = urbanTopology(osm.roads, osm.buildings, terrain.bounds);
  stats.topologyMs = Math.round(performance.now() - tTopo);
  const estateOf = estates(osm.buildings, rings, dup);
  // mosques (Phase 5): religious polygons plus any building holding a cami / mescit name
  const mosque = new Uint8Array(total);
  for (let i = 0; i < total; i++) if (osm.buildings[i][3] === 5) mosque[i] = 1;
  for (const p of named) {
    if (!/cami|mescit/.test(p[0].toLocaleLowerCase('tr'))) continue;
    for (let i = 0; i < total; i++) {
      const r = rings[i]; if (dup[i] || r.length < 6) continue;
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      for (let k = 0; k < r.length; k += 2) { if (r[k] < x0) x0 = r[k]; if (r[k] > x1) x1 = r[k]; if (r[k + 1] < z0) z0 = r[k + 1]; if (r[k + 1] > z1) z1 = r[k + 1]; }
      if (p.wx >= x0 && p.wx <= x1 && p.wz >= z0 && p.wz <= z1 && pointInRing(p.wx, p.wz, r)) { mosque[i] = 1; break; }
    }
  }
  for (let bid = 0; bid < total; bid++) {
    if (bid % 2000 === 0) progress('buildings', bid / total);
    const b = osm.buildings[bid];
    const ring = rings[bid], holes = holesOf[bid];
    if (ring.length < 6 || dup[bid]) { stats.duplicates = (stats.duplicates || 0) + (dup[bid] ? 1 : 0); continue; }
    let sa = signedArea(ring);
    const area = Math.abs(sa) * 1e6;
    if (area < 6) continue;
    const n = ring.length / 2;
    let cx = 0, cz = 0; for (let i = 0; i < ring.length; i += 2) { cx += ring[i]; cz += ring[i + 1]; } cx /= n; cz /= n;
    const r1 = hash2(cx * 13.1, cz * 7.7), r2 = hash2(cx + 3.3, cz - 9.1), r3 = hash2(cz * 5.3, cx * 2.9);
    const lc = landAt(cx, cz);
    const industrial = b[3] === 2 || (lc === 1 && area > 250) || area > 3200;
    const mah = mahalleOf(cx, cz), dense = DENSE_MAH.has(mah);
    // TOKİ / Kiptaş estate: the whole group shares one hash for palette, height and roof
    const est = dense && !industrial && estateOf[bid] >= 0 ? estateOf[bid] : -1;
    const eh = est >= 0 ? hash2(est * .731, est * .117 + 4.1) : 0;

    // heights in metres: OSM tags first, otherwise an estimate quantised to floors
    let floorH = industrial ? 5 : mosque[bid] ? 4.5 : 3.05, floors, heightM, known = 0;
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
      if (est >= 0) { floors = 5 + Math.floor(eh * 7) + (r1 > .8); heightM = floors * floorH + .6; }
      if (mosque[bid] && !industrial) { floors = Math.max(1, Math.round(Math.min(13, 5.5 + Math.sqrt(area) * .22) / 4.5)); heightM = floors * 4.5 + .3; }
    }
    // wall topology: 0 street front, 1 side, 2 rear/courtyard, 3 blind party wall
    const positive = sa >= 0, roles = new Uint8Array(n);
    let fx = 0, fz = 0, longest = -1, longestLen = 0, partyLen = 0;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n, ax = ring[i * 2], az = ring[i * 2 + 1], bx = ring[j * 2], bz = ring[j * 2 + 1];
      const dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz);
      if (len < 2e-4) { roles[i] = 3; continue; }
      const nx = (positive ? dz : -dz) / len, nz = (positive ? -dx : dx) / len;
      if (len < .0028) { roles[i] = 3; continue; }
      if (partyWall(bid, ax, az, bx, bz, nx, nz, len)) { roles[i] = 3; partyLen += len; continue; }
      if (isNearRoad((ax + bx) / 2 + nx * .008, (az + bz) / 2 + nz * .008)) { roles[i] = 0; fx += nx * len; fz += nz * len; }
      else { roles[i] = 1; if (len > longestLen) { longestLen = len; longest = i; } }
    }
    if (fx === 0 && fz === 0 && longest >= 0) {
      roles[longest] = 0;
      const j = (longest + 1) % n, dx = ring[j * 2] - ring[longest * 2], dz = ring[j * 2 + 1] - ring[longest * 2 + 1];
      fx = positive ? dz : -dz; fz = positive ? -dx : dx;
    }
    {
      const fl = Math.hypot(fx, fz) || 1; fx /= fl; fz /= fl;
      for (let i = 0; i < n; i++) if (roles[i] === 1) {
        const j = (i + 1) % n, dx = ring[j * 2] - ring[i * 2], dz = ring[j * 2 + 1] - ring[i * 2 + 1], len = Math.hypot(dx, dz);
        if (((positive ? dz : -dz) * fx + (positive ? -dx : dx) * fz) / len < -.5) roles[i] = 2;
      }
    }

    // visual style 0..7: 0 apartment, 1 glass/office tower, 2 factory/OSB hall, 3 house/villa,
    // 4 bitişik nizam 1990s apartment, 5 public/civic, 6 retail/mall, 7 shipyard hangar/logistics
    const kind = b[3], perim = ring.reduce((s2, _, k) => k % 2 ? s2 : s2 + Math.hypot(ring[(k + 2) % ring.length] - ring[k], ring[(k + 3) % ring.length] - ring[k + 1]), 0);
    let style;
    if (industrial) style = inShipyard(cx, cz) || (kind === 2 && area > 9000) ? 7 : kind === 4 && area < 2500 ? 6 : 2;
    else if (kind === 4) style = floors >= 7 ? 1 : (floors <= 2 || area > 1500) ? 6 : partyLen > perim * .18 ? 4 : 0;
    else if (kind === 0 || kind === 5 || kind === 7) style = floors >= 9 ? 1 : 5;
    else if (kind === 6) style = area < 200 ? 3 : 2;
    else if (floors >= 9) style = 1;
    else if (floors <= 2 && area < 200 || kind === 3 && floors <= 3) style = 3;
    else style = (partyLen > perim * .18 && floors >= 3) || r2 < .18 ? 4 : 0;
    const isMosque = mosque[bid] === 1 && !industrial;
    if (isMosque) style = 5;
    // dense mahalles: estates and new residential towers are plastered apartment blocks, not curtain walls
    const villa = style === 3 && !industrial && (VILLA_MAH.has(mah) || cz < 1.8);
    const site = dense && est < 0 && (kind === 1 || kind === 0 && b[2]) && floors >= 5 && style !== 4 && (floors >= 9 || r3 > .62);
    if ((est >= 0 || site) && style === 1) style = 0;

    // roof type: 0 flat, 1 hipped, 2 pyramidal, 3 gabled; explicit roofShape (b[6]) wins over heuristics
    const convex = isConvex(ring), quad = n === 4 && convex, pitchable = !holes && !industrial && convex;
    const rs = b[6] || 0;
    let roofType = 0;
    if (isMosque) { /* flat roof: the dome superstructure is added after the building pass */ }
    else if (rs === 2) roofType = !pitchable ? 0 : quad ? 1 : n <= 10 ? 2 : 0;
    else if (rs === 3) roofType = !pitchable ? 0 : quad ? 3 : n <= 10 ? 2 : 0;
    else if (rs === 4) roofType = pitchable && n <= 12 ? 2 : 0;
    else if (rs === 0 && est >= 0) roofType = pitchable && n <= 10 && eh < .55 ? (quad ? 1 : 2) : 0;
    else if (rs === 0 && site) roofType = 0;
    else if (rs === 0 && villa && pitchable && n <= 10) roofType = quad ? (r3 < .25 ? 3 : 1) : 2;
    else if (rs === 0 && pitchable && style !== 1 && style !== 6 && n <= 10 && area < 1300 && r3 < (style === 3 ? .92 : .78)) roofType = quad ? (style === 3 && r3 < .35 ? 3 : 1) : 2;
    // L-shaped plans (6 orthogonal corners): two overlapping hipped wings (roofType 4 while building, reported as hipped)
    let lWings = null;
    if (roofType === 0 && !isMosque && n === 6 && !convex && !holes && !industrial && area < 900 && (rs === 0 || rs === 2) && style !== 1 && style !== 6 && r3 < .85) {
      lWings = lShapeWings(ring);
      if (lWings) roofType = 4;
    }
    const PARAPET = .00055, parapet = roofType === 0 && !isMosque && !industrial && !holes && area >= 55 && style !== 2 && style !== 7;

    // mahalle archetypes (Phase 4)
    let arche = 0, palette = STYLE_WALLS[style], pr = r2;
    if (isMosque) { palette = KUFEKI; arche = 6; } // style 5 + arche 6: the shader draws arched mosque windows
    else if (COASTAL_MAH.has(mah) && cz > 5.8 && (style === 0 || style === 3 || style === 4 || style === 6)) { arche = 1; palette = COASTAL_WALLS; }
    else if (est >= 0) { arche = 3; palette = ESTATE_WALLS; pr = eh; }
    else if (site) { arche = 4; palette = SITE_WALLS; }
    else if (dense && style === 4) arche = 2;
    else if (villa) { arche = 5; palette = VILLA_WALLS; }
    else if (industrial && (style === 2 || style === 7) && !inShipyard(cx, cz)) arche = area > 1200 ? 7 : 6; // OSB hall; 7 with loading docks
    stats.arche = stats.arche || [0, 0, 0, 0, 0, 0, 0, 0]; stats.arche[arche]++;

    // colours
    stats.styles[style]++;
    let wallC = tagColour(b[5]) || pick(palette, pr);
    let roofC = tagColour(b[4]);
    if (!roofC) {
      const s = sat(cx, cz);
      if (roofType) roofC = arche === 5 ? pick(VILLA_TILES, r3) : pick(TILES, est >= 0 ? eh * 3.7 % 1 : r3);
      else if (industrial) roofC = s ? mix(pick(METAL, r3), s, area > 2500 ? .75 : .45) : pick(METAL, r3);
      else roofC = s ? mix(pick(FLAT, r3), s, .3) : pick(FLAT, r3);
    }

    // ground and top
    let gMin = Infinity, gMax = -Infinity;
    const gy = new Float32Array(n);
    for (let i = 0; i < n; i++) { const g = elev(ring[i * 2], ring[i * 2 + 1]); gy[i] = g; if (g < gMin) gMin = g; if (g > gMax) gMax = g; }
    // level plinth (subasman): the ground floor starts 0.3 m above the highest corner and a
    // stone/concrete plinth absorbs the slope down to 1.2 m below each corner
    const hKm = heightM / 1000, base = gMax + .0003, top = base + hKm;
    const minKm = Math.min(b[7] || 0, heightM - 1) / 1000, floating = minKm > 0;
    const seed = est >= 0 ? eh * 5.3 % 1 : r1; // estates share window lighting, balcony and accent choices
    const c = getChunk(cx, cz);

    // walls (each edge spans a whole number of window bays)
    const bay = BAY[style];
    const iw = packW(floors, seed, arche);
    const topW = top + (parapet ? PARAPET : 0); // flat terraces get a parapet rising above the roof
    const walls = (r, outward, role) => {
      const m = r.length / 2;
      for (let i = 0; i < m; i++) {
        const j = (i + 1) % m, ax = r[i * 2], az = r[i * 2 + 1], bx = r[j * 2], bz = r[j * 2 + 1];
        const dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz); if (len < 2e-4) continue;
        const nx = (outward ? dz : -dz) / len, nz = (outward ? -dx : dx) / len;
        const wr = role === undefined ? roles[i] : role, iy = style + wr * 16; stats.walls[wr]++;
        const bays = Math.max(1, Math.round(len * 1000 / bay));
        const ga = role === undefined ? gy[i] : elev(ax, az), gb = role === undefined ? gy[j] : elev(bx, bz);
        const ya = floating ? base + minKm : ga - .0012, yb = floating ? base + minKm : gb - .0012;
        const va = floating ? 0 : (ya - base) * 1000 / floorH, vb = floating ? 0 : (yb - base) * 1000 / floorH, vt = (topW - (floating ? ya : base)) * 1000 / floorH;
        const i0 = vert(c, ax, ya, az, nx, 0, nz, 0, va, wallC, bid, iy, floating ? minKm : 0, iw);
        const i1 = vert(c, bx, yb, bz, nx, 0, nz, bays, vb, wallC, bid, iy, floating ? minKm : 0, iw);
        const i2 = vert(c, bx, topW, bz, nx, 0, nz, bays, vt, wallC, bid, iy, hKm + topW - top, iw);
        const i3 = vert(c, ax, topW, az, nx, 0, nz, 0, vt, wallC, bid, iy, hKm + topW - top, iw);
        // outward winding: (A,C,B)(A,D,C) when the right-hand perpendicular is outward
        if (-dz * nx + dx * nz > 0) c.idx.push3(i0, i1, i2), c.idx.push3(i0, i2, i3);
        else c.idx.push3(i0, i2, i1), c.idx.push3(i0, i3, i2);
      }
    };
    walls(ring, positive);
    // courtyard walls face into the hole, i.e. against the hole ring's own outward side
    if (holes) for (const h of holes) walls(h, signedArea(h) < 0, 2);

    // 3D balcony stacks (wallRole 4 in info.y) on street fronts and long side walls of apartments:
    // one box per stack from the first floor slab to just under the roof, never on blind party walls
    if ((style === 0 || style === 4) && floors >= 2 && area >= 75 && !floating) {
      const D = .0011, y0 = base + floorH / 1000 - .00015, y1 = top - .0004, glazed = style === 4 || r3 > .7;
      const biy = (glazed ? 4 : 0) + 64;
      // the two longest street fronts and the longest long side wall carry balconies
      const cand = [];
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n, len = Math.hypot(ring[j * 2] - ring[i * 2], ring[j * 2 + 1] - ring[i * 2 + 1]);
        if ((roles[i] === 0 && len >= .006) || (roles[i] === 1 && len >= .009)) cand.push([roles[i], len, i]);
      }
      cand.sort((a, b2) => a[0] - b2[0] || b2[1] - a[1]);
      const pickE = cand.filter(e => e[0] === 0).slice(0, 2).concat(cand.filter(e => e[0] === 1).slice(0, 1));
      for (const [, , i] of pickE) {
        const j = (i + 1) % n, ax = ring[i * 2], az = ring[i * 2 + 1], ex = ring[j * 2] - ax, ez = ring[j * 2 + 1] - az, len = Math.hypot(ex, ez);
        const bays = Math.max(1, Math.round(len * 1000 / bay)); if (bays < 2) continue;
        const nx = (positive ? ez : -ez) / len, nz = (positive ? -ex : ex) / len, tx = ex / len, tz = ez / len;
        const w = bays >= 6 ? 1.6 : 1.2, starts = bays >= 5 ? [bays * .25 - w / 2, bays * .75 - w / 2] : [(bays - w) / 2];
        for (const u0 of starts) {
          const t0 = u0 / bays * len, t1 = (u0 + w) / bays * len;
          const A = [ax + tx * t0, az + tz * t0], B = [ax + tx * t1, az + tz * t1];
          const A2 = [A[0] + nx * D, A[1] + nz * D], B2 = [B[0] + nx * D, B[1] + nz * D];
          const v0 = (y0 - base) * 1000 / floorH, v1 = (y1 - base) * 1000 / floorH, dU = D * 1000 / bay;
          quadN(c, [[A2[0], y0, A2[1]], [B2[0], y0, B2[1]], [B2[0], y1, B2[1]], [A2[0], y1, A2[1]]], [nx, 0, nz], [0, v0, w, v0, w, v1, 0, v1], wallC, bid, biy, base, iw);
          quadN(c, [[A[0], y0, A[1]], [A2[0], y0, A2[1]], [A2[0], y1, A2[1]], [A[0], y1, A[1]]], [-tx, 0, -tz], [0, v0, dU, v0, dU, v1, 0, v1], wallC, bid, biy, base, iw);
          quadN(c, [[B2[0], y0, B2[1]], [B[0], y0, B[1]], [B[0], y1, B[1]], [B2[0], y1, B2[1]]], [tx, 0, tz], [0, v0, dU, v0, dU, v1, 0, v1], wallC, bid, biy, base, iw);
          quadN(c, [[A[0], y0, A[1]], [B[0], y0, B[1]], [B2[0], y0, B2[1]], [A2[0], y0, A2[1]]], [0, -1, 0], [0, 0, w, 0, w, dU, 0, dU], wallC, bid, biy, base, iw);
          quadN(c, [[A[0], y1, A[1]], [B[0], y1, B[1]], [B2[0], y1, B2[1]], [A2[0], y1, A2[1]]], [0, 1, 0], [0, 0, w, 0, w, dU, 0, dU], wallC, bid, biy, base, iw);
          stats.balconies = (stats.balconies || 0) + 1;
        }
      }
    }

    // roof
    // >= 100 tells the shader this is a roof: 110 flat, 111 hipped, 112 pyramid, 113 metal, 114 dome, 115 minaret,
    // 116 gabled, 117 eave soffit / fascia, 118 parapet coping
    const roofStyle = roofType === 3 ? 116 : 110 + roofType;
    const EAVE = arche === 5 ? .00055 : .0004, FASCIA = .00012, PITCH = arche === 5 ? .75 : 1; // villas: generous saçak, low slope
    const T = (q, y = top, rel = hKm) => [q[0], y, q[1], rel];
    const eaveOf = (a, b2) => { const ex = b2[0] - a[0], ez = b2[1] - a[1], l = Math.hypot(ex, ez) || 1; return [a[0], a[1], ex / l, ez / l]; };
    /** Sloped underside from the wall top P to the eave rim E (dropped by `drop`), plus a thin fascia on the rim. */
    const eaves = (P, E, drop) => {
      const m = P.length, ye = top - drop, yf = ye - FASCIA;
      let pcx = 0, pcz = 0; for (const q of P) { pcx += q[0] / m; pcz += q[1] / m; }
      for (let k = 0; k < m; k++) {
        const k2 = (k + 1) % m, ex = E[k2][0] - E[k][0], ez = E[k2][1] - E[k][1], l = Math.hypot(ex, ez); if (l < 1e-6) continue;
        let nx = ez / l, nz = -ex / l;
        if (((E[k][0] + E[k2][0]) / 2 - pcx) * nx + ((E[k][1] + E[k2][1]) / 2 - pcz) * nz < 0) { nx = -nx; nz = -nz; }
        const L = l * 1000;
        quadN(c, [[E[k][0], yf, E[k][1]], [E[k2][0], yf, E[k2][1]], [E[k2][0], ye, E[k2][1]], [E[k][0], ye, E[k][1]]], [nx, 0, nz], [0, 0, L, 0, L, .12, 0, .12], roofC, bid, 117, base, iw);
        quadN(c, [[P[k][0], top, P[k][1]], [P[k2][0], top, P[k2][1]], [E[k2][0], yf, E[k2][1]], [E[k][0], yf, E[k][1]]], [0, -1, 0], [0, 0, L, 0, L, .4, 0, .4], wallC, bid, 117, base, iw);
      }
    };
    /** Hipped (or gabled) roof over a convex quadrilateral with a saçak overhang. */
    const hipQuad = (P, gable, rs) => {
      const e0 = Math.hypot(P[1][0] - P[0][0], P[1][1] - P[0][1]), e1 = Math.hypot(P[2][0] - P[1][0], P[2][1] - P[1][1]);
      const Q = e0 >= e1 ? P : [P[1], P[2], P[3], P[0]];
      const L = Math.max(e0, e1), Wd = Math.min(e0, e1);
      if (Wd <= .003) return false;
      let qx = 0, qz = 0; for (const q of Q) { qx += q[0] / 4; qz += q[1] / 4; }
      const ux = ((Q[1][0] - Q[0][0]) + (Q[2][0] - Q[3][0])) / 2, uz = ((Q[1][1] - Q[0][1]) + (Q[2][1] - Q[3][1])) / 2, ul = Math.hypot(ux, uz);
      const dxu = ux / ul, dzu = uz / ul, half = gable ? L / 2 : Math.max(0, (L - Wd) / 2);
      const rh = Math.min(gable ? 4.2 : 3.6, Math.max(1.3, Wd * 1000 * (gable ? .32 : .26) * PITCH)) / 1000;
      const ry = top + rh, rrel = hKm + rh, drop = EAVE * rh / (Wd / 2); ridgeH = Math.max(ridgeH, rh);
      // gabled ridge ends sit exactly over the short-edge midpoints so the gable walls stay vertical; the roof runs on past them
      const R1 = gable ? [(Q[3][0] + Q[0][0]) / 2, ry, (Q[3][1] + Q[0][1]) / 2, rrel] : [qx - dxu * half, ry, qz - dzu * half, rrel];
      const R2 = gable ? [(Q[1][0] + Q[2][0]) / 2, ry, (Q[1][1] + Q[2][1]) / 2, rrel] : [qx + dxu * half, ry, qz + dzu * half, rrel];
      const E = offsetPoly(Q, EAVE), ye = top - drop, re = hKm - drop;
      const R1e = gable ? [R1[0] - dxu * EAVE, ry, R1[2] - dzu * EAVE, rrel] : R1, R2e = gable ? [R2[0] + dxu * EAVE, ry, R2[2] + dzu * EAVE, rrel] : R2;
      const face = (a, b2, r2, r1) => { const ev = eaveOf(a, b2); roofTri(c, [...T(a, ye, re), ...T(b2, ye, re), ...r2], roofC, bid, rs, iw, ev); roofTri(c, [...T(a, ye, re), ...r2, ...r1], roofC, bid, rs, iw, ev); };
      face(E[0], E[1], R2e, R1e);
      face(E[2], E[3], R1e, R2e);
      if (gable) {
        // vertical triangular gable end walls in the wall colour (plain plaster), and the barge overhang under the roof
        const gableWall = (a, b2, r) => {
          const ex = b2[0] - a[0], ez = b2[1] - a[1], l = Math.hypot(ex, ez) || 1;
          let nx = ez / l, nz = -ex / l;
          if (((a[0] + b2[0]) / 2 - qx) * nx + ((a[1] + b2[1]) / 2 - qz) * nz < 0) { nx = -nx; nz = -nz; }
          const iy = style + 48, vt = hKm * 1000 / floorH, bays = Math.max(1, Math.round(l * 1000 / bay));
          const i0 = vert(c, a[0], top, a[1], nx, 0, nz, 0, vt, wallC, bid, iy, hKm, iw);
          const i1 = vert(c, b2[0], top, b2[1], nx, 0, nz, bays, vt, wallC, bid, iy, hKm, iw);
          const i2 = vert(c, r[0], r[1], r[2], nx, 0, nz, bays / 2, vt + rh * 1000 / floorH, wallC, bid, iy, r[3], iw);
          if (-ez * nx + ex * nz > 0) c.idx.push3(i0, i1, i2); else c.idx.push3(i0, i2, i1);
        };
        gableWall(Q[1], Q[2], R2); gableWall(Q[3], Q[0], R1);
        // barge boards: the underside of the overhang beyond each gable
        roofTri(c, [...T(E[1], ye - FASCIA, re), ...T(E[2], ye - FASCIA, re), ...R2e.map((v, k) => k === 1 ? v - FASCIA : v)], roofC, bid, 117, iw, null);
        roofTri(c, [...T(E[3], ye - FASCIA, re), ...T(E[0], ye - FASCIA, re), ...R1e.map((v, k) => k === 1 ? v - FASCIA : v)], roofC, bid, 117, iw, null);
      } else {
        roofTri(c, [...T(E[1], ye, re), ...T(E[2], ye, re), ...R2], roofC, bid, rs, iw, eaveOf(E[1], E[2]));
        roofTri(c, [...T(E[3], ye, re), ...T(E[0], ye, re), ...R1], roofC, bid, rs, iw, eaveOf(E[3], E[0]));
      }
      eaves(Q, E, drop);
      return true;
    };
    let built = false, ridgeH = 0;
    if (roofType === 1 || roofType === 3) {
      built = hipQuad([0, 1, 2, 3].map(k => [ring[k * 2], ring[k * 2 + 1]]), roofType === 3, roofStyle);
      if (built) stats.pitched++;
    } else if (roofType === 2) {
      const rh = Math.min(3.4, Math.max(1.2, Math.sqrt(area) * .22 * PITCH)) / 1000; ridgeH = rh;
      const apex = [cx, top + rh, cz, hKm + rh];
      const P = []; for (let i = 0; i < n; i++) P.push([ring[i * 2], ring[i * 2 + 1]]);
      const E = offsetPoly(P, EAVE), drop = EAVE * rh / (Math.sqrt(area) / 2000);
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n, a = E[i], b2 = E[j];
        const ex = b2[0] - a[0], ez = b2[1] - a[1], l = Math.hypot(ex, ez); if (l < 1e-5) continue;
        roofTri(c, [a[0], top - drop, a[1], hKm - drop, b2[0], top - drop, b2[1], hKm - drop, ...apex], roofC, bid, roofStyle, iw, [a[0], a[1], ex / l, ez / l]);
      }
      eaves(P, E, drop);
      built = true; stats.pitched++;
    } else if (roofType === 4) {
      // L-shaped plan: two overlapping hipped wings whose union forms the valleys
      for (const W of lWings) hipQuad(W, false, 111);
      roofType = 1; built = true; stats.pitched++; stats.lWings = (stats.lWings || 0) + 1;
    }
    if (!built) {
      roofType = 0;
      let flat = ring, holeIdx;
      if (holes) { flat = ring.slice(); holeIdx = []; for (const h of holes) { holeIdx.push(flat.length / 2); for (let k = 0; k < h.length; k++) flat.push(h[k]); } }
      const tri = earcut(flat, holeIdx);
      for (let t = 0; t < tri.length; t += 3) {
        const a = tri[t] * 2, bq = tri[t + 1] * 2, cc = tri[t + 2] * 2;
        roofTri(c, [flat[a], top, flat[a + 1], hKm, flat[bq], top, flat[bq + 1], hKm, flat[cc], top, flat[cc + 1], hKm], roofC, bid, industrial ? 113 : 110, iw, null);
      }
      if (parapet) {
        // perimeter parapet: coping on top and an inner face dropping back to the terrace
        const P = []; for (let i = 0; i < n; i++) P.push([ring[i * 2], ring[i * 2 + 1]]);
        const I = offsetPoly(P, -.0002), yt = top + PARAPET;
        for (let k = 0; k < n; k++) {
          const k2 = (k + 1) % n, L = Math.hypot(P[k2][0] - P[k][0], P[k2][1] - P[k][1]) * 1000; if (L < .2) continue;
          quadN(c, [[P[k][0], yt, P[k][1]], [P[k2][0], yt, P[k2][1]], [I[k2][0], yt, I[k2][1]], [I[k][0], yt, I[k][1]]], [0, 1, 0], [0, 0, L, 0, L, .2, 0, .2], wallC, bid, 118, base, iw);
          const ex = I[k2][0] - I[k][0], ez = I[k2][1] - I[k][1], l = Math.hypot(ex, ez) || 1;
          let nx = -ez / l * (positive ? 1 : -1), nz = ex / l * (positive ? 1 : -1);
          quadN(c, [[I[k][0], top, I[k][1]], [I[k2][0], top, I[k2][1]], [I[k2][0], yt, I[k2][1]], [I[k][0], yt, I[k][1]]], [nx, 0, nz], [0, 0, L, 0, L, .55, 0, .55], wallC, bid, 118, base, iw);
        }
        stats.parapets = (stats.parapets || 0) + 1;
      }
      stats.flat++;
    }

    // rooftop micro-architecture: 119 penthouse, 120 solar collector, 121 metal (tanks, HVAC), 122 skylight, 123 brick chimney
    {
      let ax = 1, az = 0, best = 0;
      for (let i = 0; i < n; i++) { const j = (i + 1) % n, ex = ring[j * 2] - ring[i * 2], ez = ring[j * 2 + 1] - ring[i * 2 + 1], l = Math.hypot(ex, ez); if (l > best) { best = l; ax = ex / l; az = ez / l; } }
      const inside = (x, z) => pointInRing(x, z, ring);
      const roofY = top;
      if (roofType === 0 && inside(cx, cz)) {
        if (floors >= 4 && area >= 120 && style !== 2 && style !== 7) {
          box(c, cx, cz, ax, az, .0014, .0014, roofY, roofY + .0024, wallC, bid, 119, base, iw);           // elevator machine room
          stats.penthouses = (stats.penthouses || 0) + 1;
        }
        if ((style === 0 || style === 3 || style === 4) && floors <= 6 && r2 < .55) {
          // günısı: south-facing tilted collector with a white hot-water cylinder along its top edge
          const units = area > 220 ? 3 : area > 110 ? 2 : 1;
          for (let u = 0; u < units; u++) {
            const px = cx + (u - (units - 1) / 2) * .0024 + .0032 * hash2(bid, u), pz = cz + .0035;
            if (!inside(px, pz) || !inside(px - .0011, pz + .0006) || !inside(px + .0011, pz + .0006)) continue;
            const y0 = roofY + .0002, y1 = y0 + .0011, zf = pz + .0005, zb = pz - .0004;
            const P = [[px - .001, y0, zf], [px + .001, y0, zf], [px + .001, y1, zb], [px - .001, y1, zb]];
            quadN(c, P, [0, .77, .64], [0, 0, 2, 0, 2, 1.4, 0, 1.4], wallC, bid, 120, base, iw);
            quadN(c, [P[1], P[0], P[3], P[2]], [0, -.77, -.64], [0, 0, 2, 0, 2, 1.4, 0, 1.4], wallC, bid, 121, base, iw);
            // cylinder: 8 sides along x
            const tr = .00025, ty = y1 + tr * .8, tz = zb - .0001, SEG = 8, b0 = c.v;
            for (let k = 0; k <= SEG; k++) {
              const th = k / SEG * Math.PI * 2, ny = Math.cos(th), nz2 = Math.sin(th);
              vert(c, px - .0009, ty + ny * tr, tz + nz2 * tr, 0, ny, nz2, 0, k, wallC, bid, 121, ty - base, iw);
              vert(c, px + .0009, ty + ny * tr, tz + nz2 * tr, 0, ny, nz2, 1.8, k, wallC, bid, 121, ty - base, iw);
            }
            for (let k = 0; k < SEG; k++) { const a = b0 + k * 2; c.idx.push3(a, a + 2, a + 1); c.idx.push3(a + 1, a + 2, a + 3); }
            stats.solar = (stats.solar || 0) + 1;
          }
        }
        if (arche >= 6 && style === 2 && area > 2800) {
          // sawtooth (shed) roof: rows of north-light glazing with a metal back slope, ridges along the hall
          const vx = -az, vz = ax, H = .0016, W = .0075, cs = [], ct = [];
          for (let i = 0; i < n; i++) { const dx = ring[i * 2] - cx, dz = ring[i * 2 + 1] - cz; ct.push(dx * ax + dz * az); cs.push(dx * vx + dz * vz); }
          const spans = sv => {
            const ts = [];
            for (let i = 0; i < n; i++) { const j = (i + 1) % n, a = cs[i] - sv, b2 = cs[j] - sv; if ((a < 0) !== (b2 < 0)) ts.push(ct[i] + (ct[j] - ct[i]) * a / (a - b2)); }
            ts.sort((p, q) => p - q); const out = []; for (let k = 0; k + 1 < ts.length; k += 2) out.push([ts[k], ts[k + 1]]); return out;
          };
          const s0 = Math.min(...cs), s1 = Math.max(...cs), P = (t, sv, y) => [cx + ax * t + vx * sv, y, cz + az * t + vz * sv];
          let teeth = 0;
          for (let sv = s0 + .003; sv + W < s1 - .002; sv += W) {
            const A = spans(sv), B = spans(sv + W);
            for (const [a0, a1] of A) for (const [b0, b1] of B) {
              const t0 = Math.max(a0, b0) + .0012, t1 = Math.min(a1, b1) - .0012; if (t1 - t0 < .004) continue;
              const L = (t1 - t0) * 1000, lo = roofY + .00005, hi = lo + H;
              quadN(c, [P(t0, sv, lo), P(t1, sv, lo), P(t1, sv, hi), P(t0, sv, hi)], [-vx, 0, -vz], [0, 0, L, 0, L, 1.6, 0, 1.6], wallC, bid, 122, base, iw);
              const sl = Math.hypot(W, H), ny = W / sl, nh = H / sl;
              quadN(c, [P(t0, sv, hi), P(t1, sv, hi), P(t1, sv + W, lo), P(t0, sv + W, lo)], [vx * nh, ny, vz * nh], [0, 0, L, 0, L, sl * 1000, 0, sl * 1000], roofC, bid, 113, base, iw);
              for (const [t, d] of [[t0, -1], [t1, 1]]) quadN(c, [P(t, sv, lo), P(t, sv + W, lo), P(t, sv, hi), P(t, sv, hi)], [ax * d, 0, az * d], [0, 0, 7.5, 0, 0, 1.6, 0, 1.6], roofC, bid, 113, base, iw);
              teeth++;
            }
          }
          if (teeth) stats.sawtooth = (stats.sawtooth || 0) + 1;
        } else if ((style === 2 || style === 6 || style === 7) && area > 450) {
          const span = Math.sqrt(area) / 1000;
          if (r3 < .5 || style === 6) {
            const units = area > 2500 ? 3 : area > 1000 ? 2 : 1;
            for (let u = 0; u < units; u++) {
              const t = (u - (units - 1) / 2) * span * .28, px = cx + ax * t, pz = cz + az * t;
              if (inside(px, pz)) box(c, px, pz, ax, az, .0015, .001, roofY, roofY + .0016, wallC, bid, 121, base, iw); // HVAC chiller
            }
          } else {
            // linear roof monitor / skylight strips along the hall
            for (const off of [-.25, .25]) {
              const px = cx - az * span * off, pz = cz + ax * span * off;
              if (inside(px, pz)) box(c, px, pz, ax, az, span * .32, .001, roofY, roofY + .0008, wallC, bid, 122, base, iw);
            }
          }
          stats.hvac = (stats.hvac || 0) + 1;
        }
      } else if (roofType > 0 && area >= 65 && ridgeH > 0) {
        // brick chimney rising 0.9 m above the middle of a roof slope
        const i = Math.floor(r2 * n) % n, j = (i + 1) % n, mx = (ring[i * 2] + ring[j * 2]) / 2, mz = (ring[i * 2 + 1] + ring[j * 2 + 1]) / 2;
        const px = cx + (mx - cx) * .45, pz = cz + (mz - cz) * .45;
        if (inside(px, pz)) { box(c, px, pz, ax, az, .000275, .000275, top, top + ridgeH * .55 + .0009, wallC, bid, 123, base, iw); stats.chimneys = (stats.chimneys || 0) + 1; }
      }
    }
    stats.roofs[roofType]++;
    // occupancy for tree placement
    fillRing(ring, occ, OW, OH, bx0, bz0, OC, 1);

    const m = bid * 12;
    meta[m] = cx; meta[m + 1] = cz; meta[m + 2] = heightM; meta[m + 3] = known; meta[m + 4] = floors; meta[m + 5] = area;
    meta[m + 6] = gMin; meta[m + 7] = style; meta[m + 8] = roofType; meta[m + 9] = b[3]; meta[m + 10] = industrial ? 1 : 0; meta[m + 11] = top;
    const gk = Math.floor(cx / BG) + ',' + Math.floor(cz / BG);
    (bgrid.get(gk) || bgrid.set(gk, []).get(gk)).push(bid);
  }

  // attach names of named building POIs
  const names = {};
  for (const p of named) {
    const i0 = Math.floor(p.wx / BG), j0 = Math.floor(p.wz / BG);
    search: for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
      const list = bgrid.get((i0 + di) + ',' + (j0 + dj)); if (!list) continue;
      for (const id of list) if (meta[id * 12 + 2] > 0 && pointInRing(p.wx, p.wz, rings[id])) { names[id] = p[0]; stats.named++; break search; }
    }
  }
  /**
   * Surface of revolution around (ox, oz) from a bottom-to-top profile of [r, y, v?, nr?, ny?] points, one facet per side.
   * `smooth` interpolates normals around the axis (domes); otherwise facets are flat, or concave-fluted by `flute` radians.
   * uv: u counts facets (so integer u marks facet edges), v defaults to height in 2.4 m units.
   */
  function lathe(c, ox, oz, prof, sides, colr, bid, code, g0, iw, smooth = false, flute = 0) {
    for (let k = 0; k + 1 < prof.length; k++) {
      const [r0, y0, v0 = (y0 - g0) * 1000 / 2.4, n0r, n0y] = prof[k], [r1, y1, v1 = (y1 - g0) * 1000 / 2.4, n1r, n1y] = prof[k + 1];
      if (r0 <= 0 && r1 <= 0) continue;
      const dr = r0 - r1, dy = y1 - y0, nl = Math.hypot(dy, dr) || 1, sny = dr / nl, snh = dy / nl;
      const fl = flute && r0 === r1 && dy > .003 ? flute : 0;
      for (let s2 = 0; s2 < sides; s2++) {
        const t0 = s2 / sides * Math.PI * 2, t1 = (s2 + 1) / sides * Math.PI * 2, tc = (t0 + t1) / 2;
        const ids = [[t0, r0, y0, v0, n0r, n0y, s2, tc - fl], [t1, r0, y0, v0, n0r, n0y, s2 + 1, tc + fl], [t1, r1, y1, v1, n1r, n1y, s2 + 1, tc + fl], [t0, r1, y1, v1, n1r, n1y, s2, tc - fl]].map(([t, r, y, v, nr, ny, u, tn]) => {
          const ta = smooth ? t : tn, hr = nr ?? snh, vy = ny ?? sny;
          return vert(c, ox + Math.cos(t) * r, y, oz + Math.sin(t) * r, Math.cos(ta) * hr, vy, Math.sin(ta) * hr, u, v, colr, bid, code, y - g0, iw);
        });
        // winding from the non-degenerate triangle against the expected outward normal
        const P = q => [ox + Math.cos(q[0]) * q[1], q[2], oz + Math.sin(q[0]) * q[1]];
        const A0 = P([t0, r0, y0]), A1 = P([t1, r0, y0]), B1 = P([t1, r1, y1]), B0 = P([t0, r1, y1]);
        const f = r0 >= r1 ? faceNormal(...A0, ...A1, ...B1) : faceNormal(...A0, ...B1, ...B0);
        if (f[0] * Math.cos(tc) * snh + f[1] * sny + f[2] * Math.sin(tc) * snh >= 0) c.idx.push3(ids[0], ids[1], ids[2]), c.idx.push3(ids[0], ids[2], ids[3]);
        else c.idx.push3(ids[0], ids[2], ids[1]), c.idx.push3(ids[0], ids[3], ids[2]);
      }
    }
  }
  // mosques (Phase 5): cut-stone prayer hall with an octagonal kasnak, ribbed lead dome and gilded alem, corner
  // cupolas on larger halls, and Turkish minarets on the entrance (son cemaat) corners opposite the qibla
  // info.y roof codes: 114 lead, 115 minaret stone, 118 cornice, 124 gilded bronze
  const LEAD = [.5, .54, .57], STONE = hex('#e2dacb'), BRONZE = [.8, .62, .28];
  const QX = Math.sin(151 * Math.PI / 180), QZ = -Math.cos(151 * Math.PI / 180); // qibla bearing from Tuzla (x east, z south)
  const alem = (c, x, y, z, sc, bid, iwM) => lathe(c, x, z, [[.00007 * sc, y], [.00007 * sc, y + .0009 * sc], [.00028 * sc, y + .0012 * sc], [.00028 * sc, y + .0015 * sc], [.00005 * sc, y + .0019 * sc], [0, y + .0026 * sc]], 6, BRONZE, bid, 124, y, iwM);
  const domeOn = (c, x, z, rd, y0, bid, iwM, big) => {
    const R = rd / Math.cos(Math.PI / 8), hd = .28 * rd, yd = y0 + hd;
    lathe(c, x, z, [[R, y0 - .0002, 1.05], [R, yd, 1.95]], 8, STONE, bid, 5, y0, packW(2, .5));                 // kasnak with arched windows
    lathe(c, x, z, [[R, yd], [R * 1.05, yd], [R * 1.05, yd + .00025], [rd * .98, yd + .00025]], 8, STONE, bid, 118, y0, iwM); // cornice
    const RINGS = big ? 8 : 5, prof = [];
    for (let i = 0; i <= RINGS; i++) { const ph = i / RINGS * Math.PI / 2; prof.push([rd * Math.cos(ph), yd + .00025 + rd * Math.sin(ph) * .96, i, Math.cos(ph), Math.sin(ph)]); }
    lathe(c, x, z, prof, big ? 24 : 12, LEAD, bid, 114, y0, iwM, true);
    return yd + .00025 + rd * .96;
  };
  for (let bid = 0; bid < total; bid++) {
    const m = bid * 12;
    if (!mosque[bid] || !(meta[m + 2] > 0) || meta[m + 10]) continue;
    const cx = meta[m], cz = meta[m + 1], area = meta[m + 5], top = meta[m + 11], ring = rings[bid], n = ring.length / 2;
    const c = getChunk(cx, cz), iwM = packW(1, .5), side = Math.sqrt(area) / 1000;
    const rd = Math.min(14, Math.max(3.5, Math.sqrt(area) * .3)) / 1000;
    const apex = domeOn(c, cx, cz, rd, top, bid, iwM, true);
    alem(c, cx, apex, cz, 1.3, bid, iwM);
    // corner cupolas between the main dome and the hall corners
    let ax = 1, az = 0, best = 0;
    for (let i = 0; i < n; i++) { const j = (i + 1) % n, ex = ring[j * 2] - ring[i * 2], ez = ring[j * 2 + 1] - ring[i * 2 + 1], l = Math.hypot(ex, ez); if (l > best) { best = l; ax = ex / l; az = ez / l; } }
    if (area >= 220) {
      let t0 = Infinity, t1 = -Infinity, s0 = Infinity, s1 = -Infinity;
      for (let i = 0; i < n; i++) { const dx = ring[i * 2] - cx, dz = ring[i * 2 + 1] - cz, t = dx * ax + dz * az, sv = -dx * az + dz * ax; t0 = Math.min(t0, t); t1 = Math.max(t1, t); s0 = Math.min(s0, sv); s1 = Math.max(s1, sv); }
      const rc = .38 * rd, mg = rc * 1.35;
      for (const [t, sv] of [[t0 + mg, s0 + mg], [t1 - mg, s0 + mg], [t1 - mg, s1 - mg], [t0 + mg, s1 - mg]]) {
        const px = cx + ax * t - az * sv, pz = cz + az * t + ax * sv;
        if (Math.hypot(t, sv) < rd * 1.08 / Math.cos(Math.PI / 8) + rc * 1.1 || !pointInRing(px, pz, ring)) continue;
        const ya = domeOn(c, px, pz, rc, top, bid, iwM, false);
        alem(c, px, ya, pz, .6, bid, iwM);
        stats.cupolas = (stats.cupolas || 0) + 1;
      }
    }
    // minarets on the front corners: the vertex furthest from the qibla, and for grand mosques the other front corner
    const fd = i => -(ring[i * 2] - cx) * QX - (ring[i * 2 + 1] - cz) * QZ;
    let ca = 0; for (let i = 1; i < n; i++) if (fd(i) > fd(ca)) ca = i;
    const corners = [ca];
    if (area > 550) {
      let cb = -1;
      for (let i = 0; i < n; i++) if (Math.hypot(ring[i * 2] - ring[ca * 2], ring[i * 2 + 1] - ring[ca * 2 + 1]) > side * .45 && (cb < 0 || fd(i) > fd(cb))) cb = i;
      if (cb >= 0) corners.push(cb);
    }
    const mr = Math.min(.0017, .0011 + Math.sqrt(area) * .00001), mh = Math.min(.052, Math.max(.026, .022 + Math.sqrt(area) * .0004));
    for (const k of corners) {
      const kx = ring[k * 2], kz = ring[k * 2 + 1], dl = Math.hypot(cx - kx, cz - kz) || 1;
      const mx = kx + (cx - kx) / dl * mr * 1.6, mz = kz + (cz - kz) / dl * mr * 1.6, g = elev(mx, mz);
      const yK = g + Math.max(.004, (top - g) * .85), yS1 = g + mh * .74, yS2 = g + mh * .87, yT = g + mh;
      // kaide: square stone base, buried 1.2 m into the slope
      box(c, mx, mz, ax, az, mr * 1.25, mr * 1.25, g - .0012, yK, STONE, bid, 115, g, iwM);
      const prof = [[mr * 1.2, yK], [mr, yK + .0018], [mr, yS1 - .0013], [mr * 1.65, yS1], [mr * 1.65, yS1 + .001], [mr * 1.55, yS1 + .001], [mr * 1.55, yS1], [mr * .9, yS1]];
      if (area > 550) prof.push([mr * .9, yS2 - .0011], [mr * 1.5, yS2], [mr * 1.5, yS2 + .0009], [mr * 1.42, yS2 + .0009], [mr * 1.42, yS2], [mr * .8, yS2]);
      const rT = area > 550 ? mr * .8 : mr * .9;
      prof.push([rT, yT], [rT * 1.18, yT], [rT * 1.18, yT + .0003]);
      lathe(c, mx, mz, prof, 12, STONE, bid, 115, g, iwM, false, .3);
      // külah: tall lead cone, then the alem
      const yC = yT + .0003, hC = .006 + mh * .09;
      lathe(c, mx, mz, [[rT * 1.12, yC], [rT * .55, yC + hC * .55], [0, yC + hC]], 12, LEAD, bid, 114, g, iwM, true);
      alem(c, mx, yC + hC - .0002, mz, .9, bid, iwM);
      stats.minarets = (stats.minarets || 0) + 1;
    }
    stats.mosques = (stats.mosques || 0) + 1;
  }
  // hero landmarks share the chunk buffers; info encoders must match vert() above
  Object.assign(stats, buildLandmarks({ vert, getChunk, elev, pois: osm.pois, roads: osm.roads, meta, names, rings, firstId: total, wall: s => s, roof: s => 100 + s, iw: packW }));
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

/* ------------------------------------------------ urban topology rasters */
// Kept out of build() so V8 optimises these hot loops on their own.
/**
 * Mass-housing estates (TOKİ / Kiptaş): mid-size blocks of near-identical footprint repeated within
 * 150 m. Similar neighbours are linked and each connected group shares its lowest building id,
 * which seeds the estate's coordinated palette, height and roofs. Returns -1 for non-estate buildings.
 */
function estates(buildings, rings, dup) {
  const N = buildings.length, cxs = new Float32Array(N), czs = new Float32Array(N), ar = new Float32Array(N), nv = new Uint8Array(N);
  const cand = [], G = .15, cells = new Map();
  for (let i = 0; i < N; i++) {
    const r = rings[i], k = buildings[i][3];
    if (dup[i] || r.length < 8 || (k !== 1 && k !== 0)) continue;
    const a = Math.abs(signedArea(r)) * 1e6; if (a < 280 || a > 750) continue;
    let x = 0, z = 0; for (let j = 0; j < r.length; j += 2) { x += r[j]; z += r[j + 1]; }
    cxs[i] = x / (r.length / 2); czs[i] = z / (r.length / 2); ar[i] = a; nv[i] = Math.min(255, r.length / 2);
    const key = Math.floor(cxs[i] / G) * 65536 + Math.floor(czs[i] / G);
    (cells.get(key) || cells.set(key, []).get(key)).push(i); cand.push(i);
  }
  const parent = new Int32Array(N).fill(-1), deg = new Uint8Array(N);
  const find = i => { while (parent[i] !== i) i = parent[i] = parent[parent[i]]; return i; };
  for (const i of cand) parent[i] = i;
  for (const i of cand) {
    const gx = Math.floor(cxs[i] / G), gz = Math.floor(czs[i] / G);
    for (let ox = -1; ox <= 1; ox++) for (let oz = -1; oz <= 1; oz++) {
      const L = cells.get((gx + ox) * 65536 + gz + oz); if (!L) continue;
      for (const j of L) {
        if (j <= i || Math.abs(nv[i] - nv[j]) > 2 || Math.abs(ar[i] / ar[j] - 1) > .12) continue;
        if ((cxs[i] - cxs[j]) ** 2 + (czs[i] - czs[j]) ** 2 > G * G) continue;
        deg[i] = Math.min(255, deg[i] + 1); deg[j] = Math.min(255, deg[j] + 1);
        const a = find(i), b = find(j); if (a !== b) parent[Math.max(a, b)] = Math.min(a, b);
      }
    }
  }
  const out = new Int32Array(N).fill(-1), size = new Map();
  for (const i of cand) if (deg[i] >= 3) { const r = find(i); size.set(r, (size.get(r) || 0) + 1); }
  for (const i of cand) if (deg[i] >= 3 && size.get(find(i)) >= 6) out[i] = find(i);
  return out;
}

function urbanTopology(roads, buildings, [bx0, bz0, bx1, bz1]) {
  const total = buildings.length;
  // road frontage raster: 6 m cells stamped within 18 m of driveable and pedestrian centrelines (12 m stride)
  const RC = .006, RW = Math.ceil((bx1 - bx0) / RC), RH = Math.ceil((bz1 - bz0) / RC);
  const roadR = new Uint8Array(RW * RH), SPAN = [0, 2, 3, 3, 3, 2, 0];
  for (const [k, a] of roads) {
    if (k > 4 || a.length < 4) continue;
    for (let i = 0; i + 3 < a.length; i += 2) {
      const ax = a[i], az = a[i + 1], dx = a[i + 2] - ax, dz = a[i + 3] - az, s = Math.max(1, Math.ceil(Math.hypot(dx, dz) / (RC * 2)));
      for (let q = 0; q <= s; q++) {
        const gi = Math.floor((ax + dx * q / s - bx0) / RC), gj = Math.floor((az + dz * q / s - bz0) / RC);
        for (let dj = -3; dj <= 3; dj++) {
          const jj = gj + dj; if (jj < 0 || jj >= RH) continue;
          const w = SPAN[dj + 3], row = jj * RW;
          for (let ii = Math.max(0, gi - w), i1 = Math.min(RW - 1, gi + w); ii <= i1; ii++) roadR[row + ii] = 1;
        }
      }
    }
  }
  const isNearRoad = (x, z) => { const i = Math.floor((x - bx0) / RC), j = Math.floor((z - bz0) / RC); return i >= 0 && j >= 0 && i < RW && j < RH && roadR[j * RW + i] === 1; };

  // cleaned outer rings and courtyard holes for every building
  const rings = new Array(total), holesOf = new Array(total);
  for (let bid = 0; bid < total; bid++) {
    const b = buildings[bid];
    rings[bid] = cleanRing(b[0]);
    const hs = Array.isArray(b[8]) ? b[8].map(cleanRing).filter(r => r.length >= 6) : null;
    holesOf[bid] = hs && hs.length ? hs : null;
  }
  // duplicated footprints (same outline mapped twice) would z-fight: keep the first one
  const dup = new Uint8Array(total), seen = new Map();
  for (let bid = 0; bid < total; bid++) {
    const r = rings[bid]; if (r.length < 6) continue;
    let cx = 0, cz = 0; for (let i = 0; i < r.length; i += 2) { cx += r[i]; cz += r[i + 1]; } cx /= r.length / 2; cz /= r.length / 2;
    const a = Math.abs(signedArea(r)), key = Math.round(cx / .0015) * 100003 + Math.round(cz / .0015), other = seen.get(key);
    if (other !== undefined && Math.abs(a - other) < .2 * Math.max(a, other)) dup[bid] = 1; else seen.set(key, a);
  }
  // party-wall spatial hash: building edges longer than 2.5 m, sampled every metre into 2 m cells.
  // (cell, edge) pairs are bucketed by a counting pass into a CSR list indexed by an open-addressing table.
  const EC = .002, EW = Math.ceil((bx1 - bx0) / EC) + 1;
  const edges = new Buf(Float32Array, 1 << 18), eOwn = new Buf(Int32Array, 1 << 16), pk = new Buf(Int32Array, 1 << 19), pe = new Buf(Int32Array, 1 << 19);
  const ekey = (x, z) => Math.floor((z - bz0) / EC) * EW + Math.floor((x - bx0) / EC);
  for (let bid = 0; bid < total; bid++) {
    const r = rings[bid], n = r.length / 2; if (n < 3 || dup[bid]) continue;
    const ccw = signedArea(r) >= 0; // edges are stored so that (dz, -dx) is their outward normal
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n, ax = r[i * 2], az = r[i * 2 + 1], bx = r[j * 2], bz = r[j * 2 + 1], len = Math.hypot(bx - ax, bz - az);
      if (len < .0025) continue;
      const e = eOwn.n; eOwn.push1(bid); if (ccw) edges.push4(ax, az, bx, bz); else edges.push4(bx, bz, ax, az);
      const s = Math.ceil(len / .001); let last = -1;
      for (let q = 0; q <= s; q++) {
        const key = ekey(ax + (bx - ax) * q / s, az + (bz - az) * q / s);
        if (key !== last) { last = key; pk.push1(key); pe.push1(e); }
      }
    }
  }
  let HS = 1; while (HS < pk.n * 1.5) HS <<= 1;
  const hKey = new Int32Array(HS).fill(-1), hStart = new Int32Array(HS), hEnd = new Int32Array(HS), pSlot = new Int32Array(pk.n);
  const slotOf = key => { let slot = Math.imul(key, 0x9E3779B1) >>> 0 & (HS - 1); for (;;) { const kk = hKey[slot]; if (kk === key || kk === -1) return slot; slot = (slot + 1) & (HS - 1); } };
  for (let k = 0; k < pk.n; k++) { const slot = slotOf(pk.a[k]); hKey[slot] = pk.a[k]; hEnd[slot]++; pSlot[k] = slot; }
  for (let slot = 0, acc = 0; slot < HS; slot++) { hStart[slot] = acc; acc += hEnd[slot]; hEnd[slot] = hStart[slot]; }
  const cellEdges = new Int32Array(pk.n);
  for (let k = 0; k < pk.n; k++) cellEdges[hEnd[pSlot[k]]++] = pe.a[k];
  const cellSlot = key => { const slot = slotOf(key); return hKey[slot] === key ? slot : -1; };
  const EA = edges.a, EO = eOwn.a;
  /** True when another building's edge runs parallel within 1.4 m in front of this wall (bitişik nizam). */
  function partyWall(bid, ax, az, bx, bz, nx, nz, len) {
    const ux = (bx - ax) / len, uz = (bz - az) / len; let hits = 0;
    for (let t = 0; t < 3; t++) {
      const f = .2 + .3 * t, px = ax + (bx - ax) * f, pz = az + (bz - az) * f;
      let hit = false, prev = -1;
      for (let s = 0; s < 3 && !hit; s++) {
        const key = ekey(px + nx * .0007 * s, pz + nz * .0007 * s); if (key === prev) continue; prev = key;
        const slot = cellSlot(key); if (slot < 0) continue;
        for (let k = hStart[slot], k1 = hEnd[slot]; k < k1; k++) {
          const e = cellEdges[k]; if (EO[e] === bid) continue;
          const o = e * 4, ex = EA[o + 2] - EA[o], ez = EA[o + 3] - EA[o + 1], el = Math.hypot(ex, ez);
          // a shared wall runs back to back: parallel, with opposite outward normals
          if ((ez * nx - ex * nz) / el > -.85) continue;
          let tt = ((px - EA[o]) * ex + (pz - EA[o + 1]) * ez) / (el * el); tt = tt < 0 ? 0 : tt > 1 ? 1 : tt;
          const qx = EA[o] + ex * tt - px, qz = EA[o + 1] + ez * tt - pz;
          if (qx * qx + qz * qz < .0014 * .0014 && qx * nx + qz * nz > -.0004) { hit = true; break; }
        }
      }
      if (hit && ++hits >= 2) return true;
    }
    return false;
  }
  return { isNearRoad, rings, holesOf, partyWall, dup };
}

function rev(a) { const o = []; for (let i = a.length - 2; i >= 0; i -= 2) o.push(a[i], a[i + 1]); return o; }
