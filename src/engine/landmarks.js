// Hero landmarks: hand-placed parametric structures (shipyard cranes, marina,
// circuit, campuses, stations). Everything is emitted straight into the chunk
// buffers of the geometry worker, so a landmark costs no extra draw call and
// shares the chunk's shadow pass and 44-byte vertex layout.
//
// The worker hands over its own vertex writer and info encoders, so this module
// stays independent of how info.y / info.w are packed:
//   ctx.vert(c, x, y, z, nx, ny, nz, u, v, colour, bid, iy, rel, iw)
//   ctx.wall(style)  -> info.y for a facade wall of that style
//   ctx.roof(style)  -> info.y for a roof-type surface (13 metal, 14 dome, 15 plain)
//   ctx.iw(floors, seed) -> info.w
// plus ctx.meta / ctx.names / ctx.rings (per-building metadata, names and cleaned footprints)
// and ctx.roads (OSM line features: kind 4 motorway, 5 rail, 6 coastline).
import { toWorld, hash2 } from './geo.js';

const hex = h => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];
const M = .001; // one metre in world units (km)

/* -------------------------------------------------------------- painter */
/**
 * A painter writes solids into one chunk. Heights of its vertices are stored
 * relative to `g0` so the height-exaggeration slider stretches landmarks the
 * same way as buildings.
 */
function painter(ctx, x, z, g0, bid) {
  const { vert } = ctx;
  const c = ctx.getChunk(x, z);
  const PLAIN = ctx.roof(15), METAL = ctx.roof(13), FLAT = ctx.roof(10), iw = ctx.iw(0, hash2(x * 31.7, z * 17.3));
  const rel = y => Math.max(0, y - g0);
  const P = { c, g0, PLAIN, METAL, FLAT, ctx };

  /** Planar polygon (3..n points, convex), flat-shaded, facing away from `inside`. */
  P.poly = (pts, colr, iy = PLAIN, uvs = null, inside = null) => {
    // Newell normal: robust for slightly non-planar quads
    let nx = 0, ny = 0, nz = 0;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i], q = pts[(i + 1) % pts.length];
      nx += (p[1] - q[1]) * (p[2] + q[2]); ny += (p[2] - q[2]) * (p[0] + q[0]); nz += (p[0] - q[0]) * (p[1] + q[1]);
    }
    const l = Math.hypot(nx, ny, nz); if (l < 1e-14) return;
    nx /= l; ny /= l; nz /= l;
    let flip = false;
    if (inside) {
      let mx = 0, my = 0, mz = 0; for (const p of pts) { mx += p[0]; my += p[1]; mz += p[2]; }
      const k = pts.length; flip = (mx / k - inside[0]) * nx + (my / k - inside[1]) * ny + (mz / k - inside[2]) * nz < 0;
    }
    if (flip) { nx = -nx; ny = -ny; nz = -nz; }
    const base = c.v;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i], uv = uvs ? uvs[i] : null;
      vert(c, p[0], p[1], p[2], nx, ny, nz, uv ? uv[0] : 0, uv ? uv[1] : 0, colr, bid, iy, rel(p[1]), iw);
    }
    for (let i = 1; i + 1 < pts.length; i++) {
      if (flip) c.idx.push3(base, base + i + 1, base + i); else c.idx.push3(base, base + i, base + i + 1);
    }
  };
  /** Thin sheet visible from both sides (canopies, membranes, signs). */
  P.sheet = (pts, colr, iy = PLAIN, uvs = null) => {
    P.poly(pts, colr, iy, uvs);
    P.poly(pts.slice().reverse(), colr, iy, uvs ? uvs.slice().reverse() : null);
  };
  /**
   * Loft through rings of equal size (each ring a closed loop of [x,y,z]).
   * Faces are oriented away from the ring centres (or from `axis` when given).
   */
  P.loft = (rings, colr, iy = PLAIN, { caps = true, colours = null, axis = null } = {}) => {
    const n = rings[0].length;
    const centre = r => { let x = 0, y = 0, z = 0; for (const p of r) { x += p[0]; y += p[1]; z += p[2]; } return [x / n, y / n, z / n]; };
    const cs = rings.map(centre);
    for (let k = 0; k + 1 < rings.length; k++) {
      const a = rings[k], b = rings[k + 1], ins = axis || [(cs[k][0] + cs[k + 1][0]) / 2, (cs[k][1] + cs[k + 1][1]) / 2, (cs[k][2] + cs[k + 1][2]) / 2];
      const col = colours ? colours[k] : colr;
      for (let i = 0; i < n; i++) { const j = (i + 1) % n; P.poly([a[i], a[j], b[j], b[i]], col, iy, null, ins); }
    }
    if (caps) {
      const k = rings.length - 1;
      P.poly(rings[0], colours ? colours[0] : colr, iy, null, cs[1]);
      P.poly(rings[k], colours ? colours[k - 1] : colr, iy, null, cs[k - 1]);
    }
  };
  /** Box from y0 to y1 centred on (x,z), half extents hx along (ux,uz) and hz across. */
  P.box = (x, z, y0, y1, hx, hz, ux, uz, colr, iy = PLAIN, { top = true, bottom = false, wall = null, roofIy = null, topColour = null } = {}) => {
    const vx = -uz, vz = ux;
    const C = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => [x + ux * hx * a + vx * hz * b, z + uz * hx * a + vz * hz * b]);
    const ins = [x, (y0 + y1) / 2, z];
    for (let i = 0; i < 4; i++) {
      const p = C[i], q = C[(i + 1) % 4];
      let uvs = null, wy = iy;
      if (wall) {
        const len = Math.hypot(q[0] - p[0], q[1] - p[1]) / M, bays = Math.max(1, Math.round(len / wall.bay)), fl = (y1 - y0) / M / wall.floorH;
        uvs = [[0, 0], [bays, 0], [bays, fl], [0, fl]]; wy = ctx.wall(wall.style);
      }
      P.poly([[p[0], y0, p[1]], [q[0], y0, q[1]], [q[0], y1, q[1]], [p[0], y1, p[1]]], colr, wy, uvs, ins);
    }
    if (top) P.poly(C.map(p => [p[0], y1, p[1]]), topColour || colr, roofIy ?? (wall ? FLAT : iy), wall || roofIy !== null ? C.map(p => [p[0] / M, p[1] / M]) : null, [x, y0, z]);
    if (bottom) P.poly(C.map(p => [p[0], y0, p[1]]), colr, iy, null, [x, y1, z]);
  };
  /** Square-section strut between two 3D points. */
  P.beam = (a, b, w, colr, iy = PLAIN, h = w) => {
    const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2], l = Math.hypot(dx, dy, dz); if (l < 1e-9) return;
    const tx = dx / l, ty = dy / l, tz = dz / l;
    // side vectors: s horizontal (unless vertical), u = t x s
    let sx = -tz, sy = 0, sz = tx, sl = Math.hypot(sx, sz);
    if (sl < 1e-6) { sx = 1; sz = 0; sl = 1; }
    sx /= sl; sz /= sl;
    const ux = ty * sz - tz * sy, uy = tz * sx - tx * sz, uz = tx * sy - ty * sx;
    const ring = o => [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([p, q]) => [o[0] + sx * p * w / 2 + ux * q * h / 2, o[1] + sy * p * w / 2 + uy * q * h / 2, o[2] + sz * p * w / 2 + uz * q * h / 2]);
    P.loft([ring(a), ring(b)], colr, iy);
  };
  /** Vertical (optionally tapered) prism/cylinder. */
  P.cyl = (x, z, y0, y1, r0, r1, sides, colr, iy = PLAIN, caps = true, phase = 0) => {
    const ring = (y, r) => { const o = []; for (let s = 0; s < sides; s++) { const t = phase + s / sides * Math.PI * 2; o.push([x + Math.cos(t) * r, y, z + Math.sin(t) * r]); } return o; };
    if (r1 < 1e-7) {
      // cone
      const a = ring(y0, r0);
      for (let s = 0; s < sides; s++) P.poly([a[s], a[(s + 1) % sides], [x, y1, z]], colr, iy, null, [x, y0 + (y1 - y0) * .25, z]);
      if (caps) P.poly(a, colr, iy, null, [x, y1, z]);
      return;
    }
    P.loft([ring(y0, r0), ring(y1, r1)], colr, iy, { caps, axis: [x, (y0 + y1) / 2, z] });
  };
  return P;
}

/* ------------------------------------------------- 6.1 Tersaneler (shipyards) */
// Shoreline sites measured from the water mask: [x, z] on the quay edge.
// Each group shares one dock axis (unit vector pointing into the water).
const YARDS = [
  { // north-west shore of the shipyard bay (Aydınlı koyu), the main slipway row
    axis: [.56, .83],
    goliath: [[-5.868, 6.563], [-5.766, 6.542], [-5.671, 6.509], [-5.593, 6.446], [-5.510, 6.392], [-5.446, 6.305], [-5.373, 6.233], [-5.308, 6.148]],
    jib: [[-5.907, 6.595], [-5.265, 6.124]]
  },
  { // west side of the ART / Tuzla peninsula yards
    axis: [-.83, .56],
    goliath: [[-7.033, 5.784], [-6.927, 5.833], [-6.874, 5.899]],
    jib: [[-7.094, 5.721], [-7.065, 5.753], [-6.960, 5.802], [-6.852, 5.934], [-6.874, 5.983]]
  }
];
const CRANE_SCHEMES = [
  { leg: '#e9b51f', girder: '#e9b51f', cab: '#f2f0e8' },           // classic yellow
  { leg: '#2f5f9f', girder: '#eeeeea', cab: '#2f5f9f' },           // blue and white
  { leg: '#e07a22', girder: '#e07a22', cab: '#eeeeea' },           // orange
  { leg: '#eeeeea', girder: '#c8372d', cab: '#eeeeea' },           // red girder
  { leg: '#e9b51f', girder: '#2f5f9f', cab: '#e9b51f' }            // yellow legs, blue girder
].map(s => ({ leg: hex(s.leg), girder: hex(s.girder), cab: hex(s.cab) }));
const RED = hex('#c8372d'), WHITE = hex('#efeeea'), CONCRETE = hex('#b9b5ab'), DARK = hex('#3a3d40'), STEEL = hex('#8d969b');
const HULL_LOW = [hex('#8e3a2c'), hex('#6f3a33'), hex('#3d4c5c')], HULL_TOP = [hex('#d9dcdc'), hex('#2f4f7a'), hex('#c4c9c9'), hex('#9fa7a8'), hex('#e0e0da')];

/** Rail-mounted Goliath gantry crane straddling a dock. (x,z) centre, (ax,az) dock axis. */
function goliath(P, x, z, g, ax, az, span, height, scheme, trolleyAt) {
  const tx = -az, tz = ax; // bridge direction (across the dock)
  const at = (t, n, y) => [x + tx * t + ax * n, y, z + tz * t + az * n];
  const xz = (t, n) => [x + tx * t + ax * n, z + tz * t + az * n];
  const half = span / 2, girderD = 5.5 * M, girderW = 2.6 * M, yTop = g + height, yG = yTop - girderD;
  const legW = 1.8 * M, foot = 8 * M;
  for (const side of [-1, 1]) {
    const t = side * half;
    // bogie sill beam on the rail and the A-frame legs
    P.beam(at(t, -foot - 2 * M, g + .8 * M), at(t, foot + 2 * M, g + .8 * M), 2.2 * M, DARK, P.PLAIN, 1.6 * M);
    for (const n of [-1, 1]) P.beam(at(t, n * foot, g + 1.4 * M), at(t, n * 1.8 * M, yG), legW, scheme.leg);
    // knee bracing between the legs
    P.beam(at(t, -foot * .55, g + height * .42), at(t, foot * .55, g + height * .42), 1.1 * M, scheme.leg);
    // stair tower on one leg
    if (side < 0) P.box(...xz(t - 3.2 * M, 0), g, g + height * .7, 1.2 * M, 1.2 * M, tx, tz, STEEL);
  }
  // twin box girders with overhanging ends
  const ext = half + 7 * M;
  for (const n of [-1, 1]) P.box(...xz(0, n * 2.6 * M), yG, yTop, ext, girderW / 2, tx, tz, scheme.girder);
  // red/white warning stripes along the top edge of the girder ends
  const SW = 3 * M;
  for (const side of [-1, 1]) for (let k = 0; k < 4; k++) {
    const t = side * (ext - SW * (k + .5));
    for (const n of [-1, 1]) P.box(...xz(t, n * 2.6 * M), yTop, yTop + .9 * M, SW / 2, girderW / 2 + .05 * M, tx, tz, k % 2 ? WHITE : RED);
  }
  // end ties across the twin girders
  for (const side of [-1, 1]) P.box(...xz(side * (ext - 1 * M), 0), yG + 1 * M, yTop - .5 * M, 1 * M, 3.8 * M, tx, tz, scheme.girder, P.PLAIN);
  // trolley with hoist house on top and operator cabin hanging below
  const tt = trolleyAt * (half - 8 * M);
  P.box(...xz(tt, 0), yTop, yTop + 4.2 * M, 6 * M, 5.2 * M, tx, tz, scheme.cab);
  P.box(...xz(tt, 0), yTop + 4.2 * M, yTop + 4.6 * M, 6.3 * M, 5.5 * M, tx, tz, STEEL);
  P.box(...xz(tt + 3 * M, -3.6 * M), yG - 3.4 * M, yG, 1.6 * M, 1.4 * M, tx, tz, scheme.cab);
  // hoist ropes and the hook block
  const hook = yG - height * .45;
  for (const n of [-1, 1]) P.beam(at(tt, n * 1.2 * M, yG), at(tt, n * .6 * M, hook + 1.5 * M), .25 * M, DARK);
  P.box(...xz(tt, 0), hook, hook + 1.6 * M, 1.4 * M, 1.6 * M, tx, tz, scheme.leg);
  // aviation beacon posts at both ends
  for (const side of [-1, 1]) P.cyl(...xz(side * (ext - 1 * M), 0), yTop + .9 * M, yTop + 2.6 * M, .35 * M, .35 * M, 6, RED);
}

/** Dock under a gantry: two concrete pier walls running into the water and a hull on the slipway. */
function dock(P, x, z, g, ax, az, span, r) {
  const tx = -az, tz = ax;
  const len = (115 + r * 45) * M, back = 45 * M, pw = 7 * M, top = Math.max(g, 0) + 1.4 * M;
  const cx = (n) => [x + ax * n, z + az * n];
  for (const side of [-1, 1]) {
    const [px, pz] = cx((len - back) / 2);
    P.box(px + tx * side * span / 2, pz + tz * side * span / 2, -4 * M, top, (len + back) / 2, pw / 2, ax, az, CONCRETE);
    // crane rail on the pier
    P.box(px + tx * side * span / 2, pz + tz * side * span / 2, top, top + .35 * M, (len + back) / 2, .5 * M, ax, az, DARK);
  }
  // hull under construction on the slipway: stern on land, bow over the water
  const beam = Math.min(30, span - 14) * M / 2, L = Math.min(len * .9, (95 + r * 90) * M), depth = (11 + r * 7) * M;
  const keel = -2.5 * M, deck = keel + depth;
  const s0 = -back * .6, sections = [];
  // stations along the hull: [position 0..1, half-beam factor, keel lift]
  const ST = [[0, .78, .45], [.06, .95, .2], [.18, 1, 0], [.7, 1, 0], [.84, .82, .05], [.94, .45, .25], [1, .04, .55]];
  for (const [f, b, lift] of ST) {
    const [sx, sz] = cx(s0 + f * L), yk = keel + lift * depth * .6, hb = beam * b, hm = beam * Math.max(.04, b * .86);
    sections.push([
      [sx - tx * hm, yk, sz - tz * hm], [sx - tx * hb, keel + depth * .45, sz - tz * hb], [sx - tx * hb, deck, sz - tz * hb],
      [sx + tx * hb, deck, sz + tz * hb], [sx + tx * hb, keel + depth * .45, sz + tz * hb], [sx + tx * hm, yk, sz + tz * hm]
    ]);
  }
  // lower and upper hull bands get different paints: split each section ring in two lofts
  const low = sections.map(s => [s[0], s[1], s[4], s[5]]), up = sections.map(s => [s[1], s[2], s[3], s[4]]);
  P.loft(low, pick(HULL_LOW, r), P.PLAIN);
  P.loft(up, pick(HULL_TOP, r * 7.3), P.PLAIN);
  // open deck: slightly darker plate between the bulwarks
  // accommodation block near the stern on completed hulls
  if (r > .35) {
    const [hx, hz] = cx(s0 + L * .12);
    P.box(hx, hz, deck, deck + (9 + r * 6) * M, 7 * M, beam * .8, ax, az, WHITE, P.PLAIN, { wall: { style: 1, bay: 2.6, floorH: 2.9 } });
    P.box(...cx(s0 + L * .08), deck + (9 + r * 6) * M, deck + (15 + r * 6) * M, 1.8 * M, 1.8 * M, ax, az, RED);
  } else {
    // bare blocks waiting to be joined
    for (let k = 0; k < 3; k++) { const [bx, bz] = cx(s0 + L * (.25 + k * .2)); P.box(bx, bz, deck, deck + 4 * M, 7 * M, beam * .9, ax, az, STEEL, P.PLAIN); }
  }
}

/** Luffing jib crane on a portal base at the quay edge. */
function jibCrane(P, x, z, g, ax, az, r) {
  const tx = -az, tz = ax, base = Math.max(g, 0) + 1.2 * M, colr = r < .5 ? hex('#e9b51f') : hex('#d8dcdc'), acc = r < .5 ? DARK : RED;
  const portal = 10 * M;
  for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    const fx = x + ax * a * 4 * M + tx * b * 4 * M, fz = z + az * a * 4 * M + tz * b * 4 * M;
    P.beam([fx, base, fz], [x + ax * a * 2.2 * M + tx * b * 2.2 * M, base + portal, z + az * a * 2.2 * M + tz * b * 2.2 * M], 1 * M, colr);
  }
  P.box(x, z, base + portal - 1 * M, base + portal, 3 * M, 3 * M, ax, az, colr);
  const towerTop = base + portal + (16 + r * 8) * M;
  P.cyl(x, z, base + portal, towerTop, 1.6 * M, 1.3 * M, 8, colr);
  // machine house slewed by a random angle
  const th = (r - .5) * 1.4, sx = ax * Math.cos(th) - tx * Math.sin(th), sz = az * Math.cos(th) - tz * Math.sin(th);
  P.box(x - sx * 2 * M, z - sz * 2 * M, towerTop, towerTop + 4.5 * M, 4.5 * M, 2.4 * M, sx, sz, colr, P.PLAIN, { topColour: WHITE });
  P.box(x - sx * 6.5 * M, z - sz * 6.5 * M, towerTop + .5 * M, towerTop + 4 * M, 1.6 * M, 2.6 * M, sx, sz, acc); // counterweight
  P.box(x + sx * 2.6 * M, z + sz * 2.6 * M, towerTop + 1 * M, towerTop + 3.6 * M, 1.2 * M, 1.1 * M, sx, sz, WHITE); // cabin
  // jib luffed up at 50..65 degrees, lattice drawn as a pair of chords
  const ang = (50 + r * 15) * Math.PI / 180, L = (32 + r * 10) * M;
  const j0 = [x + sx * 1.5 * M, towerTop + 2 * M, z + sz * 1.5 * M], j1 = [j0[0] + sx * Math.cos(ang) * L, j0[1] + Math.sin(ang) * L, j0[2] + sz * Math.cos(ang) * L];
  for (const s of [-1, 1]) P.beam([j0[0] + tx * s * .9 * M, j0[1], j0[2] + tz * s * .9 * M], [j1[0] + tx * s * .4 * M, j1[1], j1[2] + tz * s * .4 * M], .7 * M, colr);
  for (let k = 1; k < 6; k++) { const f = k / 6, p = [j0[0] + (j1[0] - j0[0]) * f, j0[1] + (j1[1] - j0[1]) * f, j0[2] + (j1[2] - j0[2]) * f]; P.beam([p[0] - tx * .8 * M, p[1], p[2] - tz * .8 * M], [p[0] + tx * .8 * M, p[1], p[2] + tz * .8 * M], .35 * M, colr); }
  // A-frame and rope to the hook
  P.beam([x - sx * 3 * M, towerTop + 4.5 * M, z - sz * 3 * M], [x - sx * 1 * M, towerTop + 9 * M, z - sz * 1 * M], .6 * M, colr);
  P.beam(j1, [j1[0], j1[1] - L * .7, j1[2]], .2 * M, DARK);
  P.box(j1[0], j1[2], j1[1] - L * .7 - 1.2 * M, j1[1] - L * .7, .8 * M, .8 * M, sx, sz, acc);
}

const pick = (arr, r) => arr[Math.floor(r * arr.length) % arr.length];

function shipyards(ctx, nextId) {
  let n = 0;
  for (const yard of YARDS) {
    const l = Math.hypot(yard.axis[0], yard.axis[1]), ax = yard.axis[0] / l, az = yard.axis[1] / l;
    yard.goliath.forEach(([sx, sz], k) => {
      const r = hash2(sx * 71.3, sz * 19.1), r2 = hash2(sz * 5.7, sx * 3.1);
      const span = (45 + r * 30) * M, height = (38 + r2 * 14) * M;
      // the crane stands a little out over the water where the dock begins
      const x = sx + ax * 25 * M, z = sz + az * 25 * M, g = Math.max(0, ctx.elev(sx, sz));
      const P = painter(ctx, x, z, 0, nextId());
      dock(P, x, z, g, ax, az, span, r2);
      goliath(P, x, z, g + 1.75 * M, ax, az, span, height, CRANE_SCHEMES[(k + (yard === YARDS[1] ? 2 : 0)) % CRANE_SCHEMES.length], r * 2 - 1);
      n++;
    });
    yard.jib.forEach(([sx, sz]) => {
      const r = hash2(sx * 13.3, sz * 41.9), g = Math.max(0, ctx.elev(sx, sz));
      const x = sx + ax * 4 * M, z = sz + az * 4 * M;
      jibCrane(painter(ctx, x, z, 0, nextId()), x, z, g, ax, az, r);
      n++;
    });
  }
  return n;
}

/* ------------------------------------------------------ 6.2 Viaport Marina */
// Positions read off the OSM coastline (which traces every jetty) and the
// Sentinel-2 mosaic: the west basin inside the hook-shaped retail quarter and
// the east basin with the U-shaped jetties.
const MARINA = {
  // main floating pontoons [x0, z0, x1, z1]; finger berths are added along both sides
  pontoons: [
    [-2.672, 8.140, -2.600, 8.140], [-2.671, 8.190, -2.598, 8.190], [-2.670, 8.240, -2.598, 8.240], [-2.668, 8.290, -2.600, 8.290], [-2.662, 8.340, -2.605, 8.340],
    [-2.526, 8.160, -2.568, 8.160], [-2.524, 8.210, -2.568, 8.210], [-2.522, 8.260, -2.566, 8.260],
    [-2.990, 8.330, -2.905, 8.330], [-2.993, 8.380, -2.900, 8.380], [-2.995, 8.430, -2.895, 8.430], [-2.993, 8.480, -2.900, 8.480],
    [-2.860, 8.275, -2.815, 8.300], [-2.818, 8.330, -2.780, 8.355], [-2.775, 8.385, -2.742, 8.405]
  ],
  lighthouses: [[-2.697, 8.566], [-2.476, 8.397], [-2.469, 8.474]],
  pavilions: [[-2.588, 8.467], [-2.562, 8.466], [-2.537, 8.464]],
  wheel: [-2.503, 8.470],
  dome: [-2.900, 8.060]
};
const TIMBER = hex('#9a7b5a'), TIMBER_DARK = hex('#5e4632'), PONTOON = hex('#b9b3a6');

function pontoon(P, x0, z0, x1, z1) {
  const dx = x1 - x0, dz = z1 - z0, L = Math.hypot(dx, dz), ux = dx / L, uz = dz / L, vx = -uz, vz = ux;
  const y0 = .1 * M, y1 = .6 * M;
  P.box((x0 + x1) / 2, (z0 + z1) / 2, y0, y1, L / 2, 1.4 * M, ux, uz, PONTOON);
  const step = 6.5 * M, fl = 10 * M;
  for (let s = 4 * M; s < L - 2 * M; s += step) for (const side of [-1, 1]) {
    const cx = x0 + ux * s + vx * side * (1.4 * M + fl / 2), cz = z0 + uz * s + vz * side * (1.4 * M + fl / 2);
    P.box(cx, cz, y0, y1 - .05 * M, fl / 2, .5 * M, vx, vz, TIMBER);
    // mooring pile at the finger tip
    P.cyl(cx + vx * side * fl / 2, cz + vz * side * fl / 2, -1 * M, 2 * M, .18 * M, .18 * M, 6, DARK);
  }
}

function lighthouse(P, x, z, g, [band, band2] = [RED, WHITE]) {
  const y = Math.max(0, g);
  P.cyl(x, z, y - 1 * M, y + 1.5 * M, 2.6 * M, 2.4 * M, 10, CONCRETE);
  const H = 11 * M, N = 6;
  for (let k = 0; k < N; k++) {
    const a = k / N, b = (k + 1) / N;
    P.cyl(x, z, y + 1.5 * M + H * a, y + 1.5 * M + H * b, 1.6 * M - .5 * M * a, 1.6 * M - .5 * M * b, 10, k % 2 ? band2 : band);
  }
  const top = y + 1.5 * M + H;
  P.cyl(x, z, top, top + .35 * M, 1.8 * M, 1.8 * M, 10, DARK);
  P.cyl(x, z, top + .35 * M, top + 2.1 * M, .8 * M, .8 * M, 8, hex('#f6efc6'));
  P.cyl(x, z, top + 2.1 * M, top + 3.2 * M, 1 * M, 0, 8, band);
}

function pavilion(P, x, z, g, r) {
  const y = Math.max(0, g) + .2 * M, ux = 1, uz = 0;
  P.box(x, z, y - .6 * M, y + .3 * M, 9 * M, 6 * M, ux, uz, CONCRETE);
  P.box(x, z + 1 * M, y + .3 * M, y + 4.6 * M, 6 * M, 3.5 * M, ux, uz, r < .5 ? TIMBER : hex('#c9b293'), P.PLAIN, { wall: { style: 1, bay: 2.4, floorH: 4.3 } });
  // overhanging timber roof plate
  P.box(x, z - .5 * M, y + 4.6 * M, y + 5.1 * M, 7.2 * M, 5.5 * M, ux, uz, TIMBER_DARK);
  // pergola over the waterfront terrace (towards the basin, -z)
  const tz0 = z - 3 * M, tz1 = z - 9 * M;
  for (const sx of [-5.5, 0, 5.5]) P.beam([x + sx * M, y + .3 * M, tz1], [x + sx * M, y + 3.6 * M, tz1], .3 * M, TIMBER_DARK);
  P.beam([x - 6 * M, y + 3.6 * M, tz1], [x + 6 * M, y + 3.6 * M, tz1], .3 * M, TIMBER_DARK);
  for (let k = 0; k <= 10; k++) P.beam([x + (-5.5 + k * 1.1) * M, y + 3.75 * M, tz0], [x + (-5.5 + k * 1.1) * M, y + 3.75 * M, tz1 - .4 * M], .14 * M, TIMBER, P.PLAIN, .25 * M);
}

function ferrisWheel(P, x, z, g) {
  const R = 19 * M, y0 = Math.max(0, g), hubY = y0 + R + 4 * M, ux = 1, uz = 0, vx = 0, vz = 1, N = 24, w = 1.8 * M;
  const rim = (k, side, rr = R) => { const t = k / N * Math.PI * 2; return [x + ux * Math.cos(t) * rr + vx * side * w, hubY + Math.sin(t) * rr, z + uz * Math.cos(t) * rr + vz * side * w]; };
  for (const side of [-1, 1]) for (let k = 0; k < N; k++) {
    P.beam(rim(k, side), rim(k + 1, side), .45 * M, WHITE);
    P.beam([x + vx * side * w * .4, hubY, z + vz * side * w * .4], rim(k, side), .12 * M, STEEL);
  }
  for (let k = 0; k < N; k++) {
    P.beam(rim(k, -1), rim(k, 1), .25 * M, WHITE);
    // gondola hanging below the rim
    const p = rim(k, 0, R + .2 * M), c = k % 3 === 0 ? RED : k % 3 === 1 ? hex('#2f6fb0') : hex('#e9b51f');
    P.box(p[0], p[2], p[1] - 2.6 * M, p[1] - .4 * M, 1.1 * M, 1.1 * M, ux, uz, c);
  }
  P.beam([x - vx * 2.8 * M, hubY, z - vz * 2.8 * M], [x + vx * 2.8 * M, hubY, z + vz * 2.8 * M], 1.8 * M, STEEL); // hub axle
  // A-frame supports on both sides of the wheel plane
  for (const side of [-1, 1]) for (const s of [-1, 1]) P.beam([x + ux * s * 9 * M + vx * side * 6 * M, y0, z + uz * s * 9 * M + vz * side * 6 * M], [x + vx * side * 2.4 * M, hubY, z + vz * side * 2.4 * M], .9 * M, WHITE);
  P.box(x, z, y0, y0 + 3.2 * M, 6 * M, 4 * M, ux, uz, hex('#2f6fb0'), P.PLAIN, { wall: { style: 1, bay: 2.5, floorH: 3.2 } }); // boarding station
}

function aquariumDome(P, x, z, g) {
  const y0 = Math.max(0, g) + .3 * M, R = 14 * M, SIDES = 16, RINGS = 6, GLASS = hex('#7fa9b8');
  P.cyl(x, z, y0 - 1 * M, y0 + 2.5 * M, R * 1.04, R * 1.04, SIDES, CONCRETE);
  const rings = [];
  for (let r = 0; r <= RINGS; r++) {
    const ph = r / RINGS * Math.PI / 2 * .98, rr = Math.cos(ph) * R, yy = y0 + 2.5 * M + Math.sin(ph) * R * .85, ring = [];
    for (let s = 0; s < SIDES; s++) { const t = (s + (r % 2) * .5) / SIDES * Math.PI * 2; ring.push([x + Math.cos(t) * rr, yy, z + Math.sin(t) * rr]); }
    rings.push(ring);
  }
  P.loft(rings, GLASS, P.ctx.roof(14), { caps: false, axis: [x, y0, z] });
  P.cyl(x, z, rings[RINGS][0][1], rings[RINGS][0][1] + .6 * M, Math.cos(Math.PI / 2 * .98) * R + .2 * M, 0, SIDES, STEEL);
  // entrance canopy
  P.box(x, z + R + 3 * M, y0 + 3 * M, y0 + 3.4 * M, 5 * M, 3.5 * M, 1, 0, WHITE);
}

function marina(ctx, nextId) {
  let n = 0;
  const [mx, mz] = MARINA.wheel;
  const P = painter(ctx, mx, mz, 0, nextId());
  for (const [x0, z0, x1, z1] of MARINA.pontoons) { pontoon(P, x0, z0, x1, z1); n++; }
  for (const [x, z] of MARINA.lighthouses) { lighthouse(P, x, z, ctx.elev(x, z)); n++; }
  MARINA.pavilions.forEach(([x, z], k) => { pavilion(P, x, z, ctx.elev(x, z), k / 3); n++; });
  ferrisWheel(P, mx, mz, ctx.elev(mx, mz)); n++;
  const [dx, dz] = MARINA.dome;
  aquariumDome(painter(ctx, dx, dz, ctx.elev(dx, dz), nextId()), dx, dz, ctx.elev(dx, dz)); n++;
  return n;
}

/* ----------------------------------------- 6.3 Intercity İstanbul Park (F1) */
// The OSM footprints of the main grandstand (south of the start/finish
// straight) and the pit/paddock building (north of it) are already extruded
// by the worker as plain blocks; these pieces dress them as the real thing.
const F1 = {
  // grandstand footprint: rear edge A and front edge B (front faces the straight)
  standA: [[4.4996, -6.8167], [4.8869, -6.8950]],
  standB: [[4.4931, -6.8489], [4.8804, -6.9272]],
  podium: 15 * M, // height the worker gives this 8,800 m² block (3 industrial floors)
  // pit building: track-facing edge and paddock-facing edge
  pitFront: [[4.5240, -6.9136], [4.8308, -6.9747]],
  pitBack: [[4.5206, -6.9383], [4.8236, -6.9997]],
  pitHeight: 15 * M,
  vip: [[4.600, -6.989, 34], [4.680, -7.006, 42], [4.760, -7.022, 30]]
};
const SEATS = [hex('#c0392b'), hex('#d8d8d2'), hex('#2c5d9c'), hex('#3a3d40')];

/** Polygonal prism with facade-mapped walls (bays across, floors up) and a flat roof. */
function facadePrism(P, x, z, y0, y1, r, sides, colr, style, bay, floorH, phase = 0) {
  const pts = [];
  for (let s = 0; s < sides; s++) { const t = phase + s / sides * Math.PI * 2; pts.push([x + Math.cos(t) * r, z + Math.sin(t) * r]); }
  const fl = (y1 - y0) / M / floorH;
  for (let s = 0; s < sides; s++) {
    const a = pts[s], b = pts[(s + 1) % sides], bays = Math.max(1, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / M / bay));
    P.poly([[a[0], y0, a[1]], [b[0], y0, b[1]], [b[0], y1, b[1]], [a[0], y1, a[1]]], colr, P.ctx.wall(style), [[0, 0], [bays, 0], [bays, fl], [0, fl]], [x, (y0 + y1) / 2, z]);
  }
  P.poly(pts.map(p => [p[0], y1, p[1]]), colr, P.FLAT, pts.map(p => [p[0] / M, p[1] / M]), [x, y0, z]);
}

function grandstand(P, ctx) {
  const [A0, A1] = F1.standA, [B0, B1] = F1.standB;
  let ux = A1[0] - A0[0], uz = A1[1] - A0[1]; const L = Math.hypot(ux, uz); ux /= L; uz /= L;
  // f points from the rear edge towards the straight
  let fx = B0[0] - A0[0], fz = B0[1] - A0[1]; const D = fx * -uz + fz * ux; fx = -uz * Math.sign(D); fz = ux * Math.sign(D);
  const depth = Math.abs(D);
  const ring = [A0, A1, B1, B0];
  let gMin = Infinity, gMax = -Infinity; for (const [x, z] of ring) { const g = ctx.elev(x, z); gMin = Math.min(gMin, g); gMax = Math.max(gMax, g); }
  const top = gMax + .0003 + F1.podium; // on top of the podium whichever base rule the worker uses
  const at = (s, d, y) => [A0[0] + ux * s + fx * d, y, A0[1] + uz * s + fz * d];
  // treads face up, risers face the straight (+d)
  const strip = (d0, y0, d1, y1, colr) => P.poly([at(0, d0, y0), at(L, d0, y0), at(L, d1, y1), at(0, d1, y1)], colr, P.PLAIN, null,
    d0 === d1 ? at(L / 2, d0 - 1 * M, (y0 + y1) / 2) : at(L / 2, (d0 + d1) / 2, Math.min(y0, y1) - 1 * M));
  const endCaps = (d0, d1, yb, yt) => { for (const s of [0, L]) P.sheet([at(s, d0, yb), at(s, d1, yb), at(s, d1, yt), at(s, d0, yt)], CONCRETE); };
  // upper tier on the podium: 12 rows climbing from the front edge to the rear spine
  const ROWS = 12, rowD = (depth - 3 * M) / ROWS, rise = .95 * M;
  let y = top + 1.2 * M;
  strip(depth, top, depth, y, CONCRETE); // front parapet
  for (let k = 0; k < ROWS; k++) {
    const d0 = depth - k * rowD, d1 = d0 - rowD;
    strip(d0, y, d1, y, SEATS[(k >> 1) % SEATS.length]);
    endCaps(d0, d1, top, y);
    strip(d1, y, d1, y + rise, CONCRETE);
    y += rise;
  }
  const spineY = y + 3 * M;
  P.box(...at(L / 2, 1.5 * M, 0).filter((_, i) => i !== 1), top, spineY, L / 2, 1.5 * M, ux, uz, WHITE);
  // lower tier in front of the podium, down towards the track wall
  const front = 11 * M; let yl = gMax + 1 * M;
  for (let k = 0; k < 8; k++) {
    const d0 = depth + front - k * front / 8, d1 = d0 - front / 8;
    strip(d0, yl, d1, yl, SEATS[(k + 1) % SEATS.length]);
    endCaps(d0, d1, gMin - 1 * M, yl);
    strip(d1, yl, d1, yl + 1.1 * M, CONCRETE);
    yl += 1.1 * M;
  }
  strip(depth + front, gMin - 1 * M, depth + front, gMax + 1 * M, CONCRETE);
  // inclined steel masts behind the spine, 28 m above it, holding the tensile roof
  const N = 10, roofFront = depth + 6 * M, roofY0 = spineY + 1 * M, roofY1 = top + 13 * M, mastTop = spineY + 28 * M;
  const mastAt = k => (k + .5) / N * L;
  for (let k = 0; k < N; k++) {
    const s = mastAt(k), foot = at(s, -4 * M, gMin - .5 * M), head = at(s, -10 * M, mastTop);
    P.beam(foot, head, 1.3 * M, WHITE);
    P.beam(head, at(s, -30 * M, gMin), .2 * M, STEEL); // backstay
    for (const t of [.35, .7]) P.beam(head, at(s, roofFront * t + (1 - t) * 0, roofY0 + (roofY1 - roofY0) * t), .15 * M, STEEL);
    P.beam(head, at(s, roofFront, roofY1), .15 * M, STEEL);
    P.cyl(...at(s, -10 * M, 0).filter((_, i) => i !== 1), mastTop, mastTop + 1.5 * M, .5 * M, 0, 6, RED);
  }
  // white membrane: high at each mast line, sagging between them
  const MEM = hex('#f2f2ee');
  for (let k = 0; k <= N; k++) {
    const s0 = k === 0 ? 0 : mastAt(k - 1), s1 = k === N ? L : mastAt(k), sm = (s0 + s1) / 2, sag = 1.6 * M;
    for (const [a, b, ya, yb] of [[s0, sm, 0, sag], [sm, s1, sag, 0]]) {
      P.sheet([at(a, 0, roofY0 - ya * .3), at(b, 0, roofY0 - yb * .3), at(b, roofFront, roofY1 - yb), at(a, roofFront, roofY1 - ya)], MEM);
    }
  }
}

function pitBuilding(P, ctx) {
  const [F0, F1e] = F1.pitFront, [K0] = F1.pitBack;
  let ux = F1e[0] - F0[0], uz = F1e[1] - F0[1]; const L = Math.hypot(ux, uz); ux /= L; uz /= L;
  // outward normal of the track-facing wall (away from the paddock edge)
  let nx = -uz, nz = ux; if ((K0[0] - F0[0]) * nx + (K0[1] - F0[1]) * nz > 0) { nx = -nx; nz = -nz; }
  let g = -Infinity; for (const [x, z] of [F0, F1e, ...F1.pitBack]) g = Math.max(g, ctx.elev(x, z));
  const base = g + .0003, top = base + F1.pitHeight;
  const at = (s, d, y) => [F0[0] + ux * s + nx * d, y, F0[1] + uz * s + nz * d];
  const xz = (s, d) => [F0[0] + ux * s + nx * d, F0[1] + uz * s + nz * d];
  // 36 garage boxes: dark roller doors framed by team-coloured fascia
  const N = 36, bayW = L / N, TEAM = [hex('#c0392b'), hex('#1f3f7a'), hex('#e07a22'), hex('#2f8a57'), hex('#d8d8d2'), hex('#16a3c4')];
  for (let k = 0; k < N; k++) {
    const s = (k + .5) * bayW;
    P.box(...xz(s, .15 * M), base, base + 5 * M, bayW / 2 - .6 * M, .15 * M, ux, uz, DARK);
    P.box(...xz(s, .2 * M), base + 5 * M, base + 6.2 * M, bayW / 2 - .2 * M, .2 * M, ux, uz, TEAM[(k >> 1) % TEAM.length]);
  }
  // pit wall along the pit lane
  P.box(...xz(L / 2, 14 * M), base - 1 * M, base + 1.1 * M, L / 2, .4 * M, ux, uz, WHITE);
  // upper glass hospitality terrace cantilevered over the pit lane
  P.box(...xz(L / 2, 2.5 * M), top - 8 * M, top - 7.6 * M, L / 2, 2.5 * M, ux, uz, WHITE, P.PLAIN, { bottom: true });
  P.box(...xz(L / 2, 1.8 * M), top - 7.6 * M, top - 1 * M, L / 2, 1.8 * M, ux, uz, hex('#b9c7cf'), P.PLAIN, { wall: { style: 1, bay: 2.6, floorH: 3.3 } });
  for (let k = 0; k <= 18; k++) P.beam(at(k / 18 * L, 5 * M, top - 7.6 * M), at(k / 18 * L, 5 * M, top - 6.6 * M), .1 * M, STEEL);
  P.beam(at(0, 5 * M, top - 6.6 * M), at(L, 5 * M, top - 6.6 * M), .12 * M, STEEL); // balustrade rail
  // thin roof blade overhanging the terrace
  P.box(...xz(L / 2, 3 * M), top, top + .6 * M, L / 2 + 2 * M, 7 * M, ux, uz, WHITE, P.PLAIN, { bottom: true });
}

function istanbulPark(ctx, nextId) {
  const [cx, cz] = F1.standB[0];
  const g0 = ctx.elev(cx, cz);
  const P = painter(ctx, cx, cz, g0, nextId());
  grandstand(P, ctx);
  pitBuilding(P, ctx);
  for (const [x, z, h] of F1.vip) {
    const g = ctx.elev(x, z), Q = painter(ctx, x, z, g, nextId());
    facadePrism(Q, x, z, g - 1 * M, g + h * M, 9 * M, 6, hex('#a9bcc6'), 1, 2.6, 3.6);
    // steel crown and a slimmer sky-lounge drum
    facadePrism(Q, x, z, g + h * M, g + (h + 4) * M, 6.5 * M, 6, hex('#d8dee2'), 1, 2.4, 4, Math.PI / 6);
    Q.cyl(x, z, g + (h + 4) * M, g + (h + 5.2) * M, 10 * M, 10 * M, 6, WHITE);
  }
  return 3 + F1.vip.length;
}

/* ------------------------------------------------ 6.4 University campuses */
// Free plots were found next to each campus POI by scanning for clearance from
// building footprints, road ribbons and water; named halls are crowned in place.
const CAMPUS = {
  sabanci: { lakeTower: [2.300, -0.360] },
  itu: { sim: [-4.790, 8.378], mast: [-4.800, 8.390] },
  piriReis: { sim: [-5.0407, 8.4293], tower: [-5.0487, 8.390] },
  okan: { arc: [3.4425, -6.8757], dorm: [3.5113, -6.735] }
};
const BRICK = hex('#a45a3f'), CREAM = hex('#e6dcc4'), GLASS = hex('#9fb6c2'), COPPER = hex('#5f8f7e');

/** Oriented extent of a footprint ring: centre, unit long axis u, half sizes. */
function footprintBox(ring) {
  let best = 0, ux = 1, uz = 0;
  for (let i = 0; i < ring.length; i += 2) {
    const j = (i + 2) % ring.length, dx = ring[j] - ring[i], dz = ring[j + 1] - ring[i + 1], l = Math.hypot(dx, dz);
    if (l > best) { best = l; ux = dx / l; uz = dz / l; }
  }
  let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
  for (let i = 0; i < ring.length; i += 2) {
    const a = ring[i] * ux + ring[i + 1] * uz, b = -ring[i] * uz + ring[i + 1] * ux;
    a0 = Math.min(a0, a); a1 = Math.max(a1, a); b0 = Math.min(b0, b); b1 = Math.max(b1, b);
  }
  const ca = (a0 + a1) / 2, cb = (b0 + b1) / 2;
  return { x: ca * ux - cb * uz, z: ca * uz + cb * ux, ux, uz, ha: (a1 - a0) / 2, hb: (b1 - b0) / 2 };
}

/** Named buildings: [{ bid, ring, top, ground }] matching a pattern. */
function namedBuildings(ctx, re) {
  const out = [];
  for (const id in ctx.names) {
    if (!re.test(ctx.names[id])) continue;
    const ring = ctx.rings[id]; if (!Array.isArray(ring) || typeof ring[0] !== 'number') continue;
    const m = id * 12; out.push({ bid: +id, ring, top: ctx.meta[m + 11], ground: ctx.meta[m + 6] });
  }
  return out;
}

/** Glass barrel vault with steel ribs along the long axis of a roof. */
function barrelVault(P, f, y, rise) {
  const { x, z, ux, uz } = f, vx = -uz, vz = ux, ha = f.ha * .85, hb = f.hb * .8, SEG = 10;
  const arc = s => { const o = []; for (let k = 0; k <= SEG; k++) { const t = k / SEG * Math.PI; o.push([x + ux * s + vx * Math.cos(t) * hb, y + Math.sin(t) * rise, z + uz * s + vz * Math.cos(t) * hb]); } return o; };
  const ribs = Math.max(2, Math.round(ha * 2 / (6 * M)));
  for (let k = 0; k < ribs; k++) {
    const s0 = -ha + k / ribs * ha * 2, s1 = -ha + (k + 1) / ribs * ha * 2;
    const a = arc(s0), b = arc(s0 + .5 * M), c = arc(s1);
    for (const [p, q, colr] of [[a, b, STEEL], [b, c, GLASS]]) for (let i = 0; i < SEG; i++) P.poly([p[i], p[i + 1], q[i + 1], q[i]], colr, P.ctx.roof(14), null, [x + ux * (s0 + s1) / 2, y, z + uz * (s0 + s1) / 2]);
  }
  for (const s of [-ha, ha]) P.poly(arc(s), GLASS, P.ctx.roof(14), null, [x, y + rise * .3, z]);
}

function clockTower(P, x, z, g) {
  const w = 2.2 * M, H = 24 * M;
  P.box(x, z, g - 1 * M, g + H, w, w, 1, 0, BRICK);
  for (const h of [.3, .62, .9]) P.box(x, z, g + H * h, g + H * h + .6 * M, w + .25 * M, w + .25 * M, 1, 0, CREAM);
  // clock faces on all four sides
  for (const [nx, nz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const cx = x + nx * (w + .3 * M), cz = z + nz * (w + .3 * M), cy = g + H * .8;
    P.box(cx, cz, cy - 1.3 * M, cy + 1.3 * M, nx ? .1 * M : 1.3 * M, nx ? 1.3 * M : .1 * M, 1, 0, WHITE);
    P.box(cx + nx * .1 * M, cz + nz * .1 * M, cy - .1 * M, cy + 1 * M, nx ? .08 * M : .1 * M, nx ? .1 * M : .08 * M, 1, 0, DARK);
  }
  P.box(x, z, g + H, g + H + 3.5 * M, w * .8, w * .8, 1, 0, CREAM);
  P.cyl(x, z, g + H + 3.5 * M, g + H + 9 * M, w * 1.25, 0, 4, COPPER, P.PLAIN, true, Math.PI / 4);
}

function signalMast(P, x, z, g) {
  const H = 22 * M, top = g + H;
  P.cyl(x, z, g - .5 * M, g + .6 * M, 2.5 * M, 2.5 * M, 8, CONCRETE);
  P.cyl(x, z, g, top, .35 * M, .18 * M, 8, WHITE);
  for (const [h, w] of [[.62, 6], [.82, 4]]) P.beam([x - w * M, g + H * h, z], [x + w * M, g + H * h, z], .2 * M, WHITE);
  // signal flags hoisted on both yardarms
  const FLAGS = [RED, hex('#f2d22e'), hex('#2f5f9f'), WHITE, hex('#2f8a57')];
  for (const s of [-1, 1]) for (let k = 0; k < 4; k++) {
    const fx = x + s * (5.5 - k * .2) * M, fy = g + H * .62 - (k + 1) * 1.4 * M;
    P.sheet([[fx, fy, z], [fx + s * .1 * M, fy, z + 1 * M], [fx + s * .1 * M, fy + 1 * M, z + 1 * M], [fx, fy + 1 * M, z]], FLAGS[(k + (s > 0 ? 2 : 0)) % FLAGS.length]);
    P.beam([fx, fy + 1 * M, z], [fx, fy + 1.4 * M, z], .03 * M, DARK);
  }
  // radar bar on top
  P.box(x, z, top, top + .5 * M, 2.4 * M, .25 * M, 1, 0, DARK);
}

function simulatorHall(P, x, z, g, ux, uz) {
  P.box(x, z, g - 1 * M, g + 8.4 * M, 14 * M, 9 * M, ux, uz, GLASS, P.PLAIN, { wall: { style: 1, bay: 2.6, floorH: 4.2 } });
  P.box(x, z, g + 8.4 * M, g + 9 * M, 15.5 * M, 10.5 * M, ux, uz, WHITE, P.PLAIN, { bottom: true });
  // ship-bridge simulator dome on the roof
  const rings = [];
  for (let r = 0; r <= 4; r++) { const ph = r / 4 * Math.PI / 2 * .97, rr = Math.cos(ph) * 5 * M, ring = []; for (let s = 0; s < 12; s++) { const t = s / 12 * Math.PI * 2; ring.push([x + Math.cos(t) * rr, g + 9 * M + Math.sin(ph) * 5 * M, z + Math.sin(t) * rr]); } rings.push(ring); }
  P.loft(rings, WHITE, P.ctx.roof(14), { caps: true, axis: [x, g + 9 * M, z] });
}

function curvedFaculty(P, x, z, g) {
  // an arc of stepped wings around a forecourt, tallest in the middle; (x,z) is the arc's midpoint
  const R = 45 * M, N = 6, span = Math.PI * .55, mid = -Math.PI / 2, depth = 5.5 * M;
  const ox = x - Math.cos(mid) * R, oz = z - Math.sin(mid) * R, segL = 2 * R * Math.sin(span / N / 2);
  for (let k = 0; k < N; k++) {
    const t = mid - span / 2 + (k + .5) / N * span, cx = ox + Math.cos(t) * R, cz = oz + Math.sin(t) * R;
    const floors = 4 + Math.round(3 * (1 - Math.abs((k + .5) / N - .5) * 2)), h = floors * 3.6 * M;
    P.box(cx, cz, g - 1 * M, g + h, segL / 2 + .3 * M, depth, -Math.sin(t), Math.cos(t), k % 2 ? hex('#e4e2dc') : hex('#d2d6d8'), P.PLAIN, { wall: { style: 1, bay: 2.6, floorH: 3.6 } });
    P.box(cx, cz, g + h, g + h + .5 * M, segL / 2 + .7 * M, depth + .6 * M, -Math.sin(t), Math.cos(t), WHITE, P.PLAIN, { bottom: true });
  }
}

function campuses(ctx, nextId) {
  let n = 0;
  // Sabancı: glass vault on the Information Center, fly tower on the Performing Arts Center
  for (const b of namedBuildings(ctx, /Information Center/)) {
    const f = footprintBox(b.ring), P = painter(ctx, f.x, f.z, b.ground, b.bid);
    barrelVault(P, f, b.top, Math.min(9, f.hb / M * .45) * M); n++;
  }
  for (const b of namedBuildings(ctx, /Gösteri Merkezi/)) {
    const f = footprintBox(b.ring), P = painter(ctx, f.x, f.z, b.ground, b.bid);
    P.box(f.x - f.ux * f.ha * .35, f.z - f.uz * f.ha * .35, b.top - 1 * M, b.top + 11 * M, f.ha * .3, f.hb * .55, f.ux, f.uz, CREAM, P.PLAIN, { topColour: hex('#8e9295') });
    P.box(f.x + f.ux * f.ha * .3, f.z + f.uz * f.ha * .3, b.top, b.top + 1.2 * M, f.ha * .55, f.hb * .9, f.ux, f.uz, BRICK); n++;
  }
  {
    const [x, z] = CAMPUS.sabanci.lakeTower, g = ctx.elev(x, z);
    clockTower(painter(ctx, x, z, g, nextId()), x, z, g); n++;
  }
  // İTÜ Maritime Faculty and Piri Reis University: simulator halls, signal mast, observation tower
  for (const [sim, ux, uz] of [[CAMPUS.itu.sim, 1, 0], [CAMPUS.piriReis.sim, .8, .6]]) {
    const [x, z] = sim, g = ctx.elev(x, z);
    simulatorHall(painter(ctx, x, z, g, nextId()), x, z, g, ux, uz); n++;
  }
  {
    const [x, z] = CAMPUS.itu.mast, g = ctx.elev(x, z);
    signalMast(painter(ctx, x, z, g, nextId()), x, z, g); n++;
    const [tx, tz] = CAMPUS.piriReis.tower, tg = ctx.elev(tx, tz);
    lighthouse(painter(ctx, tx, tz, tg, nextId()), tx, tz, tg, [hex('#1f3f7a'), WHITE]); n++;
  }
  // Okan University: curved stepped faculty and twin dormitory slabs
  {
    const [x, z] = CAMPUS.okan.arc, g = ctx.elev(x, z);
    curvedFaculty(painter(ctx, x, z, g, nextId()), x, z, g); n++;
    const [dx, dz] = CAMPUS.okan.dorm, dg = ctx.elev(dx, dz), P = painter(ctx, dx, dz, dg, nextId());
    for (const s of [-1, 1]) P.box(dx, dz + s * 11 * M, dg - 1 * M, dg + 6 * 3 * M, 18 * M, 5.5 * M, 1, 0, s < 0 ? hex('#e3cfa6') : hex('#d6b4a4'), P.PLAIN, { wall: { style: 0, bay: 3.1, floorH: 3 } });
    n++;
  }
  return n;
}

/* ------------------------------------------ 6.5 Marmaray stations & overpasses */
const STATIONS = [['Aydıntepe', 40.852295, 29.293196], ['İçmeler', 40.845687, 29.300038], ['Tuzla', 40.82995, 29.322427]];
const RAIL_LIFT = .6 * M; // rail chains (and the trains on them) ride this far above the terrain

/** Segments of a road kind within r of (x,z): [ax, az, bx, bz]. */
function segmentsNear(roads, kind, x, z, r) {
  const out = [];
  for (const [k, a] of roads) {
    if (k !== kind) continue;
    for (let i = 0; i + 3 < a.length; i += 2) {
      const mx = (a[i] + a[i + 2]) / 2, mz = (a[i + 1] + a[i + 3]) / 2;
      if (Math.hypot(mx - x, mz - z) < r) out.push([a[i], a[i + 1], a[i + 2], a[i + 3]]);
    }
  }
  return out;
}
/** Length-weighted dominant direction of undirected segments. */
function dominantDir(segs) {
  let sx = 0, sz = 0;
  for (const [ax, az, bx, bz] of segs) { const dx = bx - ax, dz = bz - az, l = Math.hypot(dx, dz), t = Math.atan2(dz, dx) * 2; sx += Math.cos(t) * l; sz += Math.sin(t) * l; }
  const t = Math.atan2(sz, sx) / 2; return [Math.cos(t), Math.sin(t)];
}
/** Sorted lateral offsets of segment midpoints along (vx,vz), merged when closer than `merge`. */
function laneOffsets(segs, x, z, vx, vz, merge) {
  const o = segs.map(([ax, az, bx, bz]) => ((ax + bx) / 2 - x) * vx + ((az + bz) / 2 - z) * vz).sort((a, b) => a - b), out = [];
  for (const v of o) { if (out.length && v - out[out.length - 1][1] < merge) out[out.length - 1][1] = v; else out.push([v, v]); }
  return out.map(([a, b]) => (a + b) / 2);
}

/** Glass-walled footbridge between two points with stair/lift towers at the ends. */
function footbridge(P, ctx, a, b, deckY, towers = true) {
  const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz), ux = dx / L, uz = dz / L, cx = (a[0] + b[0]) / 2, cz = (a[1] + b[1]) / 2;
  P.box(cx, cz, deckY - 1.2 * M, deckY, L / 2, 2.4 * M, ux, uz, CONCRETE, P.PLAIN, { bottom: true });
  P.box(cx, cz, deckY, deckY + 3 * M, L / 2 - .1 * M, 2.1 * M, ux, uz, hex('#a9bcc6'), P.PLAIN, { wall: { style: 1, bay: 2.2, floorH: 3 }, top: false });
  P.box(cx, cz, deckY + 3 * M, deckY + 3.4 * M, L / 2 + .3 * M, 2.6 * M, ux, uz, WHITE, P.PLAIN, { bottom: true });
  if (!towers) return;
  for (const [x, z] of [a, b]) {
    const g = ctx.elev(x, z);
    P.box(x, z, g - 1 * M, deckY + 3.4 * M, 2.8 * M, 2.8 * M, ux, uz, hex('#a9bcc6'), P.PLAIN, { wall: { style: 1, bay: 2.8, floorH: 3.4 }, topColour: WHITE });
  }
}

function station(P, ctx, x, z) {
  const rails = segmentsNear(ctx.roads, 5, x, z, .12);
  if (rails.length < 2) return 0;
  const [ux, uz] = dominantDir(rails), vx = -uz, vz = ux;
  const lanes = laneOffsets(rails, x, z, vx, vz, 2.5 * M);
  // island platform in the widest gap between tracks (trains run ±1.3 m off each centreline, 3 m wide)
  let best = -1, gap = 0;
  for (let i = 0; i + 1 < lanes.length; i++) if (lanes[i + 1] - lanes[i] > gap) { gap = lanes[i + 1] - lanes[i]; best = i; }
  const clear = 3.1 * M;
  let off, w;
  if (best >= 0 && gap - 2 * clear >= 4 * M) { off = (lanes[best] + lanes[best + 1]) / 2; w = gap - 2 * clear; }
  else { off = lanes[lanes.length - 1] + clear + 3.5 * M; w = 7 * M; } // side platform beyond the outer track
  const L = 180 * M, SEG = 10, at = (s, d) => [x + ux * s + vx * (off + d), z + uz * s + vz * (off + d)];
  for (let k = 0; k < SEG; k++) {
    const s = -L / 2 + (k + .5) * L / SEG, [px, pz] = at(s, 0), rail = ctx.elev(px, pz) + RAIL_LIFT, top = rail + 1 * M;
    P.box(px, pz, rail - 1.2 * M, top, L / SEG / 2 + .05 * M, w / 2, ux, uz, CONCRETE, P.PLAIN, { topColour: hex('#c9c4ba') });
    // yellow safety lines along both edges
    for (const e of [-1, 1]) P.box(...at(s, e * (w / 2 - .45 * M)), top, top + .02 * M, L / SEG / 2, .15 * M, ux, uz, hex('#e9c21f'));
    // cantilevered butterfly canopy on a central column row
    if (k > 0 && k < SEG - 1) {
      const cy = top + 4.6 * M, hw = w / 2 + .8 * M;
      for (const c of [-.25, .25]) { const [qx, qz] = at(s + c * L / SEG, 0); P.cyl(qx, qz, top, cy, .22 * M, .22 * M, 8, STEEL); }
      const p = (ss, d, y) => { const [qx, qz] = at(ss, d); return [qx, y, qz]; }, s0 = s - L / SEG / 2, s1 = s + L / SEG / 2;
      for (const e of [-1, 1]) P.sheet([p(s0, 0, cy), p(s1, 0, cy), p(s1, e * hw, cy + .8 * M), p(s0, e * hw, cy + .8 * M)], k % 2 ? hex('#dfe5e8') : hex('#cfd8dc'));
      P.beam(p(s0, 0, cy - .05 * M), p(s1, 0, cy - .05 * M), .35 * M, STEEL);
    }
  }
  // concourse footbridge across every track, landing on the island via a lift tower
  const s = L * .3, lo = lanes[0] - off - 9 * M, hi = lanes[lanes.length - 1] - off + 9 * M;
  const [mx, mz] = at(s, 0), rail = ctx.elev(mx, mz) + RAIL_LIFT, deck = rail + 8 * M;
  footbridge(P, ctx, at(s, Math.min(lo, -w / 2 - 6 * M)), at(s, Math.max(hi, w / 2 + 6 * M)), deck);
  P.box(mx, mz, rail + 1 * M, deck + 3.4 * M, 2.4 * M, Math.min(2.4 * M, w / 2 - .4 * M), ux, uz, hex('#a9bcc6'), P.PLAIN, { wall: { style: 1, bay: 2.4, floorH: 3.4 }, topColour: WHITE });
  return 1;
}

/** Footbridge over the D-100 / E-80 carriageways nearest to a point. */
function motorwayOverpass(ctx, nextId, x, z) {
  let best = Infinity, bx = 0, bz = 0;
  for (const [k, a] of ctx.roads) {
    if (k !== 4) continue;
    for (let i = 0; i < a.length; i += 2) { const d = Math.hypot(a[i] - x, a[i + 1] - z); if (d < best) { best = d; bx = a[i]; bz = a[i + 1]; } }
  }
  if (best > .6) return 0;
  const segs = segmentsNear(ctx.roads, 4, bx, bz, .05);
  if (!segs.length) return 0;
  const [ux, uz] = dominantDir(segs), vx = -uz, vz = ux;
  const lanes = laneOffsets(segs, bx, bz, vx, vz, 3 * M);
  const lo = lanes[0] - 20 * M, hi = lanes[lanes.length - 1] + 20 * M;
  let g = -Infinity; for (let t = lo; t <= hi; t += 5 * M) g = Math.max(g, ctx.elev(bx + vx * t, bz + vz * t));
  const P = painter(ctx, bx, bz, ctx.elev(bx, bz), nextId());
  footbridge(P, ctx, [bx + vx * lo, bz + vz * lo], [bx + vx * hi, bz + vz * hi], g + 6.5 * M);
  return 1;
}

function marmaray(ctx, nextId) {
  let n = 0;
  for (const [, lat, lon] of STATIONS) {
    const [x, z] = toWorld(lat, lon), g = ctx.elev(x, z);
    n += station(painter(ctx, x, z, g, nextId()), ctx, x, z);
    n += motorwayOverpass(ctx, nextId, x, z);
  }
  return n;
}

/* -------------------------- 6.6 Şinasi Dural Caddesi Streetscape & Landmarks */
const SINASI_SPINE = [
  [40.8293186, 29.3056128],
  [40.8300500, 29.3057050],
  [40.8308508, 29.3057989],
  [40.8319850, 29.3059550],
  [40.8330980, 29.3061119],
  [40.8344890, 29.3062850],
  [40.8358500, 29.3064400],
  [40.8372500, 29.3065800],
  [40.8386390, 29.3064200],
  [40.8394580, 29.3066100],
  [40.8406474, 29.3069182]
];

const SINASI_STOPS = [
  [40.840810, 29.306380, -1], // Evliya Çelebi Camii (West / Northbound)
  [40.840880, 29.306781, 1],  // Evliya Çelebi Camii (East / Southbound)
  [40.838639, 29.306325, -1], // Hilmi Sonay ASM (West)
  [40.838506, 29.306513, 1],  // Hilmi Sonay ASM (East)
  [40.834489, 29.306223, -1], // Cezeri MTAL (West)
  [40.834927, 29.306344, 1]   // Cezeri MTAL (East)
];

const SINASI_CROSSINGS = [
  [40.831600, 29.305890], // Yeni Ceren / Ünsal Eczanesi
  [40.834700, 29.306305], // Cezeri Mesleki ve Teknik Anadolu Lisesi
  [40.838820, 29.306460], // Hilmi Sonay ASM / Barbaros Eczanesi
  [40.840520, 29.306875]  // Evliya Çelebi Merkez Camii / CarrefourSA
];

const SINASI_PHARMACIES = [
  [40.839012, 29.306532], // Barbaros Eczanesi
  [40.831985, 29.305776], // Yeni Ceren Eczanesi
  [40.831312, 29.305637]  // Ünsal Eczanesi
];

function sinasiDural(ctx, nextId) {
  let n = 0;
  const pts = SINASI_SPINE.map(([la, lo]) => toWorld(la, lo));
  const PAVING = hex('#c9c3b6'), KERB = hex('#9a968e'), STRIPE = hex('#ecebe6');
  const ANTHRACITE = hex('#2d3338'), BENCH = hex('#8d5f3c'), IETT_YELLOW = hex('#eab81c'), IETT_RED = hex('#c92a22');

  // 1. Continuous raised sidewalks & stone kerbs along both sides of Şinasi Dural Caddesi
  for (let i = 0; i + 1 < pts.length; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
    const dx = bx - ax, dz = bz - az, segL = Math.hypot(dx, dz);
    if (segL < 1e-5) continue;
    const ux = dx / segL, uz = dz / segL, vx = -uz, vz = ux;
    const steps = Math.max(1, Math.ceil(segL / (24 * M))), stepL = segL / steps;
    for (let s = 0; s < steps; s++) {
      const mx = ax + ux * (s + .5) * stepL, mz = az + uz * (s + .5) * stepL;
      const g = ctx.elev(mx, mz), P = painter(ctx, mx, mz, g, nextId());
      for (const side of [-1, 1]) {
        const sx = mx + vx * side * 6.8 * M, sz = mz + vz * side * 6.8 * M, sg = ctx.elev(sx, sz);
        // Sidewalk pavement slab (2.2 m wide, 16 cm above road)
        P.box(sx, sz, sg - .4 * M, sg + .56 * M, stepL / 2 + .08 * M, 1.1 * M, ux, uz, PAVING, P.PLAIN);
        // Kerbstone lip facing the asphalt
        const kx = mx + vx * side * 5.62 * M, kz = mz + vz * side * 5.62 * M;
        P.box(kx, kz, sg - .2 * M, sg + .58 * M, stepL / 2 + .08 * M, .12 * M, ux, uz, KERB, P.PLAIN);
      }
      n++;
    }
  }

  // 2. Zebra pedestrian crosswalks across the avenue
  for (const [la, lo] of SINASI_CROSSINGS) {
    const [cx, cz] = toWorld(la, lo), g = ctx.elev(cx, cz), P = painter(ctx, cx, cz, g, nextId());
    const ux = .085, uz = -.996, vx = -uz, vz = ux;
    for (let k = -3; k <= 3; k++) {
      const px = cx + vx * k * 1.35 * M, pz = cz + vz * k * 1.35 * M, pg = ctx.elev(px, pz);
      P.box(px, pz, pg + .38 * M, pg + .44 * M, 1.45 * M, .24 * M, ux, uz, STRIPE, P.PLAIN);
    }
    n++;
  }

  // 3. Real-world İETT modern glass bus shelters + yellow/red stop totems
  for (const [la, lo, side] of SINASI_STOPS) {
    const [sx, sz] = toWorld(la, lo), g = ctx.elev(sx, sz), P = painter(ctx, sx, sz, g, nextId());
    const ux = .085, uz = -.996, vx = -uz, vz = ux;
    // Raised boarding platform
    P.box(sx, sz, g - .4 * M, g + .62 * M, 2.4 * M, .95 * M, ux, uz, PAVING, P.PLAIN);
    // Rear tempered glass wall & anthracite frame
    const bx = sx + vx * side * .55 * M, bz = sz + vz * side * .55 * M;
    P.box(bx, bz, g + .62 * M, g + 3.05 * M, 2.05 * M, .06 * M, ux, uz, hex('#6a8793'), P.METAL);
    for (const c of [-1.95, 0, 1.95]) {
      P.box(bx + ux * c * M, bz + uz * c * M, g + .62 * M, g + 3.15 * M, .08 * M, .09 * M, ux, uz, ANTHRACITE, P.METAL);
    }
    // Cantilevered shelter roof canopy
    P.box(sx + vx * side * .05 * M, sz + vz * side * .05 * M, g + 3.12 * M, g + 3.26 * M, 2.25 * M, .88 * M, ux, uz, ANTHRACITE, P.METAL, { topColour: hex('#dfe4e6') });
    // Passenger wooden bench
    P.box(bx - vx * side * .32 * M, bz - vz * side * .32 * M, g + 1.05 * M, g + 1.15 * M, 1.35 * M, .24 * M, ux, uz, BENCH, P.PLAIN);
    // İETT yellow/red totem sign at the kerb
    const tx = sx + ux * 2.55 * M - vx * side * .45 * M, tz = sz + uz * 2.55 * M - vz * side * .45 * M;
    P.box(tx, tz, g + .6 * M, g + 2.85 * M, .12 * M, .22 * M, ux, uz, IETT_YELLOW, P.PLAIN);
    P.box(tx, tz, g + 2.85 * M, g + 3.25 * M, .13 * M, .24 * M, ux, uz, IETT_RED, P.PLAIN);
    n++;
  }

  // 4. Tuzla Cezeri Mesleki ve Teknik Anadolu Lisesi entrance gate portal & courtyard flagpole
  {
    const [gx, gz] = toWorld(40.83468, 29.30602), g = ctx.elev(gx, gz), P = painter(ctx, gx, gz, g, nextId());
    const ux = .085, uz = -.996, vx = -uz, vz = ux;
    for (const s of [-1, 1]) {
      P.box(gx + ux * s * 3.8 * M, gz + uz * s * 3.8 * M, g - .5 * M, g + 4.4 * M, .45 * M, .55 * M, ux, uz, CREAM, P.PLAIN);
    }
    // Overhead school portal arch beam
    P.box(gx, gz, g + 3.8 * M, g + 4.65 * M, 4.5 * M, .65 * M, ux, uz, hex('#2b4a6f'), P.PLAIN, { topColour: WHITE });
    // Ceremonial flagpole & Turkish flag in school forecourt
    const fx = gx - vx * 9 * M, fz = gz - vz * 9 * M, fg = ctx.elev(fx, fz);
    P.cyl(fx, fz, fg, fg + 11 * M, .09 * M, .05 * M, 8, WHITE, P.METAL);
    P.sheet([[fx, fg + 9.4 * M, fz], [fx + 2.1 * M, fg + 9.2 * M, fz + .4 * M], [fx + 2.1 * M, fg + 10.6 * M, fz + .4 * M], [fx, fg + 10.8 * M, fz]], IETT_RED);
    n++;
  }

  // 5. Hilmi Sonay ASM & Avenue Pharmacy ("E") illuminated street totems
  for (const [la, lo] of SINASI_PHARMACIES) {
    const [px, pz] = toWorld(la, lo), g = ctx.elev(px, pz), P = painter(ctx, px, pz, g, nextId());
    P.cyl(px, pz, g - .2 * M, g + 3.2 * M, .09 * M, .09 * M, 6, STEEL, P.METAL);
    P.box(px, pz, g + 3.2 * M, g + 4.15 * M, .48 * M, .14 * M, 1, 0, IETT_RED, P.PLAIN, { topColour: WHITE });
    P.box(px, pz, g + 3.4 * M, g + 3.95 * M, .32 * M, .16 * M, 1, 0, WHITE, P.PLAIN);
    n++;
  }

  // 6. Evliya Çelebi Merkez Camii courtyard octagonal şadırvan (at north head of Şinasi Dural Caddesi)
  {
    const [sx, sz] = toWorld(40.84086, 29.30656), g = ctx.elev(sx, sz), P = painter(ctx, sx, sz, g, nextId());
    P.cyl(sx, sz, g - .3 * M, g + .45 * M, 3.6 * M, 3.6 * M, 8, CREAM, P.PLAIN);
    P.cyl(sx, sz, g + .45 * M, g + 1.65 * M, 1.3 * M, 1.3 * M, 8, hex('#ded5c3'), P.PLAIN);
    for (let k = 0; k < 8; k++) {
      const th = k / 8 * Math.PI * 2, cx = sx + Math.cos(th) * 3.1 * M, cz = sz + Math.sin(th) * 3.1 * M;
      P.cyl(cx, cz, g + .45 * M, g + 2.85 * M, .14 * M, .14 * M, 6, CREAM, P.PLAIN);
    }
    P.cyl(sx, sz, g + 2.85 * M, g + 4.45 * M, 3.9 * M, 0, 8, hex('#7d8790'), P.ctx.roof(14));
    n++;
  }

  return n;
}

/* -------------------------------------------------------------- entry */
export function buildLandmarks(ctx) {
  let id = ctx.firstId;
  const nextId = () => id++; // ids past the last building are never pickable
  const stats = {};
  stats.shipyardCranes = shipyards(ctx, nextId);
  stats.marinaPieces = marina(ctx, nextId);
  stats.circuitPieces = istanbulPark(ctx, nextId);
  stats.campusPieces = campuses(ctx, nextId);
  stats.stationPieces = marmaray(ctx, nextId);
  stats.sinasiPieces = sinasiDural(ctx, nextId);
  return stats;
}

