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

function lighthouse(P, x, z, g) {
  const y = Math.max(0, g);
  P.cyl(x, z, y - 1 * M, y + 1.5 * M, 2.6 * M, 2.4 * M, 10, CONCRETE);
  const H = 11 * M, N = 6;
  for (let k = 0; k < N; k++) {
    const a = k / N, b = (k + 1) / N;
    P.cyl(x, z, y + 1.5 * M + H * a, y + 1.5 * M + H * b, 1.6 * M - .5 * M * a, 1.6 * M - .5 * M * b, 10, k % 2 ? WHITE : RED);
  }
  const top = y + 1.5 * M + H;
  P.cyl(x, z, top, top + .35 * M, 1.8 * M, 1.8 * M, 10, DARK);
  P.cyl(x, z, top + .35 * M, top + 2.1 * M, .8 * M, .8 * M, 8, hex('#f6efc6'));
  P.cyl(x, z, top + 2.1 * M, top + 3.2 * M, 1 * M, 0, 8, RED);
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

/* -------------------------------------------------------------- entry */
export function buildLandmarks(ctx) {
  let id = ctx.firstId;
  const nextId = () => id++; // ids past the last building are never pickable
  const stats = {};
  stats.shipyardCranes = shipyards(ctx, nextId);
  stats.marinaPieces = marina(ctx, nextId);
  return stats;
}

