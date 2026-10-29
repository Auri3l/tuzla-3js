// Vegetation and moving things: trees, cars, Marmaray trains and ships.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { shared, glowPointsMaterial } from './materials.js';
import { hash2, toWorld } from './geo.js';

function painted(geo, hexColour) {
  const c = new THREE.Color(hexColour), n = geo.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) a.set([c.r, c.g, c.b], i * 3);
  geo.setAttribute('color', new THREE.BufferAttribute(a, 3));
  if (geo.index) geo = geo.toNonIndexed();
  if (geo.attributes.uv) geo.deleteAttribute('uv');
  return geo;
}
function jitter(geo, amount, seed = 1) {
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), k = 1 + (hash2(x * 3.1 + seed, y * 7.3 + z * 1.7) - .5) * amount;
    p.setXYZ(i, x * k, y * k, z * k);
  }
  geo.computeVertexNormals(); return geo;
}
const box = (w, h, d, x, y, z, colour) => painted(new THREE.BoxGeometry(w, h, d).translate(x, y, z), colour);

/* ------------------------------------------------------------------ trees */
function treeGeometries() {
  const trunk = (r, h, c = '#5d4a39') => painted(new THREE.CylinderGeometry(r * .7, r, h, 6).translate(0, h / 2, 0), c);
  const deciduous = mergeGeometries([
    trunk(.28, 3),
    painted(jitter(new THREE.IcosahedronGeometry(2.7, 0), .22, 1).scale(1, .9, 1).translate(0, 5.2, 0), '#ffffff'),
    painted(jitter(new THREE.IcosahedronGeometry(1.8, 0), .3, 2).translate(1.1, 6.4, .4), '#f0f6e8')
  ]);
  // umbrella-shaped stone pine, typical of the Marmara coast
  const pine = mergeGeometries([
    trunk(.32, 7.2, '#6a5040'),
    painted(jitter(new THREE.IcosahedronGeometry(3.6, 0), .18, 3).scale(1, .42, 1).translate(0, 8.2, 0), '#d6e2cc'),
    painted(jitter(new THREE.IcosahedronGeometry(2.2, 0), .2, 4).scale(1, .5, 1).translate(-1.4, 7.6, 1), '#d6e2cc')
  ]);
  const cypress = mergeGeometries([
    trunk(.2, 1.2),
    painted(jitter(new THREE.IcosahedronGeometry(1, 0), .12, 5).scale(1.05, 5.2, 1.05).translate(0, 5.8, 0), '#b8c9ae')
  ]);
  const bush = painted(jitter(new THREE.IcosahedronGeometry(1.1, 0), .35, 6).scale(1.2, .8, 1.2).translate(0, .75, 0), '#e3ead6');
  return [deciduous, pine, cypress, bush];
}
function treeMaterial() {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .95, metalness: 0, envMapIntensity: .4 });
  m.onBeforeCompile = shader => {
    shader.uniforms.uTime = shared.uTime;
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
      #ifdef USE_INSTANCING
        float ph = instanceMatrix[3].x * 3100.0 + instanceMatrix[3].z * 1700.0;
        float sway = smoothstep(1.5, 9.0, position.y) * .12;
        transformed.x += sin(uTime * 1.3 + ph) * sway; transformed.z += cos(uTime * 1.1 + ph) * sway * .7;
      #endif`);
  };
  m.customProgramCacheKey = () => 'tz-tree';
  return m;
}

export function createTrees(data, { budget, cell = 4 }) {
  const group = new THREE.Group(); group.name = 'trees';
  const geos = treeGeometries(), mat = treeMaterial();
  const count = Math.min(data.length / 6, budget);
  const buckets = new Map();
  for (let i = 0; i < count; i++) {
    const o = i * 6, type = data[o + 4] | 0, key = type + ':' + Math.floor(data[o] / cell) + ',' + Math.floor(data[o + 2] / cell);
    (buckets.get(key) || buckets.set(key, []).get(key)).push(o);
  }
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), col = new THREE.Color();
  const greens = [['#5f7f4a', '#7a9655', '#4d6e3f', '#86a061', '#6b8a4c'], ['#46613c', '#536f43', '#3e5636'], ['#2f4a2f', '#3b5636'], ['#6f8250', '#7d8b56', '#5d7445']];
  for (const [key, list] of buckets) {
    const type = +key.split(':')[0];
    const mesh = new THREE.InstancedMesh(geos[type], mat, list.length);
    let cx = 0, cz = 0;
    list.forEach((o, i) => {
      const x = data[o], y = data[o + 1], z = data[o + 2], sc = data[o + 3], r = data[o + 5];
      q.setFromAxisAngle(up, r * Math.PI * 2);
      s.setScalar(sc * .001 * (type === 3 ? 1 : .85 + r * .3));
      p.set(x, y - .0003, z); m.compose(p, q, s); mesh.setMatrixAt(i, m);
      const pal = greens[type]; col.set(pal[Math.floor(r * 97) % pal.length]).offsetHSL((r - .5) * .03, 0, (hash2(x, z) - .5) * .08);
      mesh.setColorAt(i, col); cx += x; cz += z;
    });
    mesh.computeBoundingSphere();
    mesh.userData.center = new THREE.Vector3(cx / list.length, 0, cz / list.length);
    mesh.castShadow = true; mesh.receiveShadow = false;
    group.add(mesh);
  }
  return group;
}

/* --------------------------------------------------------------- traffic */
const CAR_COLOURS = ['#f4f4f2', '#f4f4f2', '#d9d9d6', '#1d1f22', '#2a2d31', '#8d9399', '#b8bcc0', '#a1262a', '#25466e', '#e8c547', '#3b5a3c', '#f4f4f2', '#c9c3b2', '#e8c547'];
function carGeometry() {
  return mergeGeometries([
    box(4.3, .8, 1.75, 0, .55, 0, '#ffffff'),
    box(2.3, .62, 1.6, -.25, 1.25, 0, '#2a3238'),
    box(.12, .25, 1.5, 2.16, .62, 0, '#fff7d6'),
    box(.12, .2, 1.5, -2.16, .7, 0, '#7a1414')
  ]);
}
function busGeometry() {
  return mergeGeometries([box(12, 2.6, 2.5, 0, 1.65, 0, '#ffffff'), box(11.4, .9, 2.54, 0, 2.1, 0, '#24303a')]);
}

function pathTable(paths) {
  const { points, offsets, kinds } = paths, list = [];
  for (let i = 0; i < kinds.length; i++) {
    const a = offsets[i], b = offsets[i + 1], n = b - a; if (n < 2) continue;
    const cum = new Float32Array(n); let L = 0;
    for (let k = 1; k < n; k++) { const o = (a + k) * 3, pO = o - 3; L += Math.hypot(points[o] - points[pO], points[o + 2] - points[pO + 2]); cum[k] = L; }
    if (L < .06) continue;
    list.push({ a, n, cum, length: L, kind: kinds[i] });
  }
  return list;
}

function sampleAlong(points, path, s, out, tangent, hint = 0) {
  const { a, n, cum } = path; let k = Math.min(Math.max(hint, 0), n - 2);
  while (k < n - 2 && cum[k + 1] < s) k++;
  while (k > 0 && cum[k] > s) k--;
  const t = (s - cum[k]) / Math.max(1e-9, cum[k + 1] - cum[k]), o = (a + k) * 3;
  out.set(points[o] + (points[o + 3] - points[o]) * t, points[o + 1] + (points[o + 4] - points[o + 1]) * t, points[o + 2] + (points[o + 5] - points[o + 2]) * t);
  tangent.set(points[o + 3] - points[o], 0, points[o + 5] - points[o + 2]).normalize();
  return k;
}

export function createTraffic(paths, { count }) {
  const group = new THREE.Group(); group.name = 'traffic';
  const table = pathTable(paths);
  const road = table.filter(p => p.kind >= 1 && p.kind <= 4), race = table.filter(p => p.kind === 8);
  const W = { 1: .5, 2: 2.2, 3: 4, 4: 7 };
  const cdf = []; let acc = 0; for (const p of road) { acc += p.length * W[p.kind]; cdf.push(acc); }
  const pickPath = r => { let lo = 0, hi = cdf.length - 1; const v = r * acc; while (lo < hi) { const mid = (lo + hi) >> 1; if (cdf[mid] < v) lo = mid + 1; else hi = mid; } return road[lo]; };
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .35, metalness: .25, envMapIntensity: 1 });
  const nBus = Math.round(count * .04), nRace = race.length ? 8 : 0, nCar = count - nBus;
  const cars = new THREE.InstancedMesh(carGeometry(), mat, nCar + nRace), buses = new THREE.InstancedMesh(busGeometry(), mat, Math.max(1, nBus));
  cars.frustumCulled = buses.frustumCulled = false; cars.castShadow = buses.castShadow = true;
  const agents = [], col = new THREE.Color();
  const spawn = (agent, r) => {
    const p = agent.race ? race[Math.floor(r * race.length) % race.length] : pickPath(r);
    agent.path = p; agent.s = hash2(r, 3.3) * p.length; agent.dir = hash2(r, 9.1) < .5 ? 1 : -1; agent.hint = 0;
    const kmh = agent.race ? 180 + 60 * hash2(r, 1) : p.kind === 4 ? 85 + 30 * hash2(r, 2) : p.kind === 3 ? 55 + 15 * hash2(r, 2) : p.kind === 2 ? 40 + 15 * hash2(r, 2) : 25 + 10 * hash2(r, 2);
    agent.speed = kmh / 3600 * (agent.bus ? .8 : 1);
    agent.lane = agent.race ? (hash2(r, 5) - .5) * .006 : p.kind === 4 ? (hash2(r, 4) < .5 ? .0035 : .0068) : p.kind === 3 ? .0032 : p.kind === 2 ? .0024 : .0016;
  };
  for (let i = 0; i < nCar + nRace; i++) {
    const a = { mesh: cars, i, race: i >= nCar, bus: false }; spawn(a, hash2(i * .37, 1.7)); agents.push(a);
    cars.setColorAt(i, col.set(a.race ? ['#c21f1f', '#e8e8e8', '#1f5fc2', '#f0c419'][i % 4] : CAR_COLOURS[i % CAR_COLOURS.length]));
  }
  for (let i = 0; i < nBus; i++) { const a = { mesh: buses, i, race: false, bus: true }; spawn(a, hash2(i * 1.91, 8.3)); agents.push(a); buses.setColorAt(i, col.set(i % 3 ? '#e5e3da' : '#d4473a')); }
  if (!nBus) buses.count = 0;
  group.add(cars, buses);

  // head and tail lights at night
  const N = agents.length, head = new Float32Array(N * 3), tail = new Float32Array(N * 3);
  const headGeo = new THREE.BufferGeometry(); headGeo.setAttribute('position', new THREE.BufferAttribute(head, 3));
  const tailGeo = new THREE.BufferGeometry(); tailGeo.setAttribute('position', new THREE.BufferAttribute(tail, 3));
  const headPts = new THREE.Points(headGeo, glowPointsMaterial('#fff1cf', .006)), tailPts = new THREE.Points(tailGeo, glowPointsMaterial('#ff2a1a', .004));
  headPts.frustumCulled = tailPts.frustumCulled = false; group.add(headPts, tailPts);

  const P = new THREE.Vector3(), T = new THREE.Vector3(), M = new THREE.Matrix4(), Q = new THREE.Quaternion(), S = new THREE.Vector3(.001, .001, .001), UP = new THREE.Vector3(0, 1, 0);
  let active = N;
  function update(dt, night) {
    for (let k = 0; k < N; k++) {
      const a = agents[k];
      if (a.mesh === cars && a.i >= active && !a.race) continue;
      a.s += a.dir * a.speed * dt;
      if (a.s < 0 || a.s > a.path.length) {
        if (a.race) { a.dir *= -1; a.s = THREE.MathUtils.clamp(a.s, 0, a.path.length); }
        else spawn(a, Math.random());
      }
      a.hint = sampleAlong(paths.points, a.path, a.s, P, T, a.hint);
      if (a.dir < 0) T.negate();
      P.x += -T.z * a.lane; P.z += T.x * a.lane; // keep right
      Q.setFromAxisAngle(UP, Math.atan2(-T.z, T.x));
      M.compose(P, Q, S); a.mesh.setMatrixAt(a.i, M);
      if (night > .02 || dt === 0) {
        head.set([P.x + T.x * .0022, P.y + .0007, P.z + T.z * .0022], k * 3);
        tail.set([P.x - T.x * .0022, P.y + .0008, P.z - T.z * .0022], k * 3);
      }
    }
    cars.instanceMatrix.needsUpdate = true; buses.instanceMatrix.needsUpdate = true;
    headPts.visible = tailPts.visible = night > .02;
    if (night > .02) { headGeo.attributes.position.needsUpdate = true; tailGeo.attributes.position.needsUpdate = true; }
  }
  function setCount(n) {
    active = Math.min(nCar, n);
    // hide inactive cars by collapsing them
    M.makeScale(0, 0, 0);
    for (let i = active; i < nCar; i++) cars.setMatrixAt(i, M);
  }
  update(0, 0);
  return { group, update, setCount, total: N };
}

/* ----------------------------------------------------------------- trains */
export function createTrains(rails) {
  const group = new THREE.Group(); group.name = 'trains';
  if (!rails.length) return { group, update() {} };
  const bodyMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .4, metalness: .3 });
  const winMat = new THREE.MeshStandardMaterial({ color: '#1f2a33', roughness: .15, metalness: .1, emissive: '#ffe6b5', emissiveIntensity: 0 });
  const body = mergeGeometries([box(20, 3.4, 3, 0, 2.2, 0, '#f2f2ef'), box(20.02, .35, 3.02, 0, 1.1, 0, '#c8202c'), box(19.6, .3, 2.6, 0, 4.05, 0, '#9aa0a5')]);
  const win = box(18.4, 1.05, 3.04, 0, 2.75, 0, '#ffffff');
  const CARS = 10, trains = [];
  rails.slice(0, 2).forEach((pts, ri) => {
    const n = pts.length / 3, cum = new Float32Array(n);
    for (let k = 1; k < n; k++) cum[k] = cum[k - 1] + Math.hypot(pts[k * 3] - pts[k * 3 - 3], pts[k * 3 + 2] - pts[k * 3 - 1]);
    const path = { a: 0, n, cum, length: cum[n - 1] };
    for (let t = 0; t < 2; t++) {
      const bodies = new THREE.InstancedMesh(body, bodyMat, CARS), wins = new THREE.InstancedMesh(win, winMat, CARS);
      bodies.frustumCulled = wins.frustumCulled = false; bodies.castShadow = true;
      group.add(bodies, wins);
      trains.push({ pts, path, bodies, wins, s: path.length * (t ? .3 : .75), dir: t ? 1 : -1, wait: 0, lane: t ? .0013 : -.0013, hints: new Int32Array(CARS) });
    }
  });
  const P = new THREE.Vector3(), T = new THREE.Vector3(), M = new THREE.Matrix4(), Q = new THREE.Quaternion(), S = new THREE.Vector3(.001, .001, .001), UP = new THREE.Vector3(0, 1, 0);
  const SPEED = 80 / 3600, LEN = .0205 * CARS;
  function update(dt, night) {
    winMat.emissiveIntensity = night * 1.6;
    for (const tr of trains) {
      if (tr.wait > 0) tr.wait -= dt;
      else {
        tr.s += tr.dir * SPEED * dt;
        const lo = LEN, hi = tr.path.length;
        if (tr.s > hi || tr.s < lo) { tr.s = THREE.MathUtils.clamp(tr.s, lo, hi); tr.dir *= -1; tr.wait = 25; }
      }
      for (let c = 0; c < CARS; c++) {
        const sc = THREE.MathUtils.clamp(tr.s - c * .0205 - .01, 0, tr.path.length);
        tr.hints[c] = sampleAlong(tr.pts, tr.path, sc, P, T, tr.hints[c]);
        P.x += -T.z * tr.lane; P.z += T.x * tr.lane;
        Q.setFromAxisAngle(UP, Math.atan2(-T.z, T.x)); M.compose(P, Q, S);
        tr.bodies.setMatrixAt(c, M); tr.wins.setMatrixAt(c, M);
      }
      tr.bodies.instanceMatrix.needsUpdate = true; tr.wins.instanceMatrix.needsUpdate = true;
    }
  }
  update(0, 0);
  return { group, update };
}

/* ------------------------------------------------------------------ ships */
function shipGeometry(type) {
  const hull = (L, B, D, colour, deck) => {
    const s = new THREE.Shape();
    s.moveTo(-L / 2, -B / 2); s.lineTo(L * .32, -B / 2); s.quadraticCurveTo(L * .47, -B / 2, L / 2, 0);
    s.quadraticCurveTo(L * .47, B / 2, L * .32, B / 2); s.lineTo(-L / 2, B / 2); s.lineTo(-L / 2, -B / 2);
    const g = new THREE.ExtrudeGeometry(s, { depth: D, bevelEnabled: false, curveSegments: 6 }).rotateX(-Math.PI / 2).translate(0, -D * .45, 0);
    const top = new THREE.ShapeGeometry(s, 6).rotateX(-Math.PI / 2).translate(0, D * .55 + .02, 0);
    return [painted(g, colour), painted(top, deck)];
  };
  if (type === 'container') {
    const parts = hull(190, 30, 16, '#1f3346', '#8c3b30');
    const cols = ['#b33a2e', '#2f6b9a', '#d9a531', '#3a7d4a', '#e8e6df', '#7b4a8a', '#cf6d2a', '#5a6670'];
    for (let i = 0; i < 14; i++) for (let j = 0; j < 4; j++) {
      const h = 2.6 * (2 + ((i * 7 + j * 3) % 4));
      parts.push(box(11.5, h, 6.8, -50 + i * 12.2, 8.8 + h / 2, -10.5 + j * 7, cols[(i * 5 + j * 3) % cols.length]));
    }
    parts.push(box(14, 18, 26, -80, 17, 0, '#f1f0ea'), box(6, 8, 6, -86, 29, 0, '#2b2f33'));
    return mergeGeometries(parts);
  }
  if (type === 'tanker') {
    const parts = hull(200, 32, 17, '#6b1f1f', '#4f5a4d');
    parts.push(box(150, 1.2, 2, 5, 9.6, 0, '#c9c4b5'), box(16, 16, 28, -84, 17, 0, '#f1f0ea'), box(7, 7, 7, -90, 28, 0, '#2a2f33'));
    for (let i = 0; i < 6; i++) parts.push(box(2.5, 2, 24, -55 + i * 24, 10, 0, '#b9b3a2'));
    return mergeGeometries(parts);
  }
  if (type === 'bulk') {
    const parts = hull(175, 28, 15, '#203a2b', '#6d3428');
    for (let i = 0; i < 6; i++) parts.push(box(16, 2.2, 20, -55 + i * 23, 9.5, 0, '#8a3d2f'));
    for (let i = 0; i < 4; i++) parts.push(box(1.5, 18, 1.5, -44 + i * 30, 17, 8, '#e1c037'));
    parts.push(box(13, 15, 24, -74, 15, 0, '#f1f0ea'), box(5, 6, 5, -79, 25, 0, '#2a2f33'));
    return mergeGeometries(parts);
  }
  if (type === 'tug') {
    const parts = hull(30, 10, 5, '#a3271e', '#3b3b3b');
    parts.push(box(10, 4, 7, 1, 5, 0, '#f1f0ea'), box(5, 2.5, 5, 1, 8, 0, '#f1f0ea'), box(1.5, 3, 1.5, -2, 9.5, 0, '#222'));
    return mergeGeometries(parts);
  }
  // yacht
  const parts = hull(14, 4.2, 2, '#f7f7f4', '#b8916a');
  parts.push(box(5.5, 1.4, 3, -.8, 1.6, 0, '#f2f2ee'), box(4, .5, 2.8, -.6, 2.25, 0, '#2d3a44'), box(.15, 13, .15, 1.3, 7.5, 0, '#d8d8d4'));
  return mergeGeometries(parts);
}

/** mask: {width, height, data} of water-mask.png; bounds: terrain bounds */
export function createShips(mask, bounds, { seed = 1 } = {}) {
  const group = new THREE.Group(); group.name = 'ships';
  if (!mask) return { group, update() {} };
  const [x0, z0, x1, z1] = bounds, { width: W, height: H, data } = mask;
  const at = (x, z, ch) => { const u = Math.floor((x - x0) / (x1 - x0) * W), v = Math.floor((z - z0) / (z1 - z0) * H); if (u < 0 || v < 0 || u >= W || v >= H) return ch === 1 ? 255 : 255; return data[(v * W + u) * 4 + ch]; };
  const water = (x, z) => at(x, z, 0) > 160, dist = (x, z) => at(x, z, 1);
  const fits = (x, z, h, L, B, minD) => {
    const c = Math.cos(h), s = Math.sin(h);
    for (const [a, b] of [[-.5, 0], [.5, 0], [0, -.5], [0, .5], [-.5, -.5], [.5, .5], [-.5, .5], [.5, -.5], [0, 0]]) {
      const px = x + c * a * L - s * b * B, pz = z - s * a * L - c * b * B; if (!water(px, pz) || dist(px, pz) < minD) return false;
    } return true;
  };
  let rs = seed; const rnd = () => (rs = (rs * 16807) % 2147483647) / 2147483647;
  const placed = [];
  const free = (x, z, r) => placed.every(p => Math.hypot(p[0] - x, p[1] - z) > r + p[2]);
  const items = { container: [], tanker: [], bulk: [], tug: [], yacht: [] };
  // anchored ships offshore swing to the same current
  const types = ['container', 'tanker', 'bulk', 'bulk', 'container', 'tanker'];
  for (let tries = 0, n = 0; tries < 6000 && n < 34; tries++) {
    const x = x0 + rnd() * (x1 - x0), z = z0 + rnd() * (z1 - z0);
    if (dist(x, z) < 200) continue;
    const h = (210 + (rnd() - .5) * 50) * Math.PI / 180;
    if (!fits(x, z, h, .2, .035, 120) || !free(x, z, .5)) continue;
    const t = types[n % types.length]; items[t].push({ x, z, h, moving: false }); placed.push([x, z, .25]); n++;
  }
  // shipyard quays along the western bay: moored parallel to the shore
  const [sx, sz] = toWorld(40.836, 29.291);
  for (let tries = 0, n = 0; tries < 30000 && n < 22; tries++) {
    const x = sx + (rnd() - .5) * 5, z = sz + (rnd() - .5) * 4;
    const d = dist(x, z); if (d < 18 || d > 70 || !water(x, z)) continue;
    const e = .02, gx = dist(x + e, z) - dist(x - e, z), gz = dist(x, z + e) - dist(x, z - e);
    if (!gx && !gz) continue;
    const h = Math.atan2(gx, gz) + (rnd() < .5 ? 0 : Math.PI);
    const t = rnd() < .5 ? 'bulk' : rnd() < .5 ? 'tanker' : 'container';
    if (!fits(x, z, h, .15, .024, 3) || !free(x, z, .1)) continue;
    items[t].push({ x, z, h, moving: false }); placed.push([x, z, .1]); n++;
  }
  // tugs near the yards
  for (let tries = 0, n = 0; tries < 3000 && n < 10; tries++) {
    const x = sx + (rnd() - .5) * 5, z = sz + (rnd() - .5) * 4; if (dist(x, z) < 50 || !water(x, z) || !free(x, z, .05)) continue;
    items.tug.push({ x, z, h: rnd() * 6.28, moving: rnd() < .6, speed: .003 }); placed.push([x, z, .03]); n++;
  }
  // yachts in Viaport Marina and the Tuzla fishing port
  for (const [lat, lon, count, spread, maxD] of [[40.8158, 29.3158, 110, .9, 40], [40.8142, 29.2992, 30, .32, 26]]) {
    const [mx, mz] = toWorld(lat, lon);
    for (let tries = 0, n = 0; tries < 8000 && n < count; tries++) {
      const x = mx + (rnd() - .5) * spread, z = mz + (rnd() - .5) * spread;
      const d = dist(x, z); if (!water(x, z) || d < 8 || d > maxD) continue;
      const e = .01, gx = dist(x + e, z) - dist(x - e, z), gz = dist(x, z + e) - dist(x, z - e);
      const h = Math.atan2(gx, gz) + Math.PI / 2 + (rnd() < .5 ? 0 : Math.PI);
      if (!fits(x, z, h, .016, .006, 2) || !free(x, z, .009)) continue;
      items.yacht.push({ x, z, h, moving: false }); placed.push([x, z, .007]); n++;
    }
  }
  // a few ships under way, crossing the Marmara
  for (let n = 0, tries = 0; n < 7 && tries < 3000; tries++) {
    const x = x0 + rnd() * (x1 - x0), z = z0 + rnd() * (z1 - z0), h = (rnd() < .5 ? 100 : 280) * Math.PI / 180 + (rnd() - .5) * .3;
    if (dist(x, z) < 220 || !fits(x, z, h, .22, .04, 150) || !free(x, z, .6)) continue;
    const t = ['container', 'tanker', 'bulk'][n % 3]; items[t].push({ x, z, h, moving: true, speed: (11 + rnd() * 5) * 1.852 / 3600 }); placed.push([x, z, .3]); n++;
  }

  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .6, metalness: .1, envMapIntensity: .8 });
  const meshes = [], M = new THREE.Matrix4(), Q = new THREE.Quaternion(), S = new THREE.Vector3(.001, .001, .001), P = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);
  const lights = [];
  for (const [type, list] of Object.entries(items)) {
    if (!list.length) continue;
    const mesh = new THREE.InstancedMesh(shipGeometry(type), mat, list.length);
    mesh.castShadow = true; mesh.frustumCulled = false;
    list.forEach((it, i) => {
      P.set(it.x, 0, it.z); Q.setFromAxisAngle(UP, it.h); M.compose(P, Q, S); mesh.setMatrixAt(i, M);
      if (type !== 'yacht') lights.push(it);
    });
    meshes.push({ mesh, list, type }); group.add(mesh);
  }
  // anchor and navigation lights
  const lp = new Float32Array(lights.length * 3), lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.BufferAttribute(lp, 3));
  const lpts = new THREE.Points(lg, glowPointsMaterial('#fff4d8', .01)); lpts.frustumCulled = false; group.add(lpts);
  // wakes behind moving vessels
  const wakeMat = new THREE.ShaderMaterial({
    uniforms: { uTime: shared.uTime },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform float uTime; varying vec2 vUv; void main(){
      float along = vUv.x, across = abs(vUv.y - .5) * 2.0;
      float spread = mix(.15, 1.0, 1.0 - along);
      float v = smoothstep(spread, spread * .3, across) * along * along;
      v *= .6 + .4 * sin((1.0 - along) * 40.0 - uTime * 3.0);
      gl_FragColor = vec4(vec3(.9, .95, .95), v * .55); }`,
    transparent: true, depthWrite: false
  });
  const movers = meshes.flatMap(m => m.list.map((it, i) => ({ it, i, m: m.mesh, type: m.type }))).filter(o => o.it.moving);
  const wakes = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2).translate(-.5, .0002, 0), wakeMat, Math.max(1, movers.length));
  wakes.frustumCulled = false; wakes.count = movers.length; group.add(wakes);
  const WS = new THREE.Vector3();

  function update(dt, night) {
    lpts.visible = night > .02;
    lights.forEach((it, k) => lp.set([it.x, .03, it.z], k * 3));
    lg.attributes.position.needsUpdate = true;
    movers.forEach((o, k) => {
      const it = o.it;
      const nx = it.x + Math.cos(it.h) * it.speed * dt, nz = it.z - Math.sin(it.h) * it.speed * dt;
      const L = o.type === 'tug' ? .03 : .2;
      if (!fits(nx + Math.cos(it.h) * L * .6, nz - Math.sin(it.h) * L * .6, it.h, L, L * .2, o.type === 'tug' ? 30 : 120)) it.h += Math.PI * (.6 + .3 * Math.random());
      else { it.x = nx; it.z = nz; }
      P.set(it.x, 0, it.z); Q.setFromAxisAngle(UP, it.h); M.compose(P, Q, S); o.m.setMatrixAt(o.i, M); o.m.instanceMatrix.needsUpdate = true;
      const wl = o.type === 'tug' ? .12 : .7, ww = o.type === 'tug' ? .02 : .09;
      P.set(it.x - Math.cos(it.h) * L * .45, 0, it.z + Math.sin(it.h) * L * .45);
      WS.set(wl, 1, ww); M.compose(P, Q, WS); wakes.setMatrixAt(k, M);
    });
    wakes.instanceMatrix.needsUpdate = true;
  }
  update(0, 0);
  const counts = Object.fromEntries(Object.entries(items).map(([k, v]) => [k, v.length]));
  return { group, update, counts };
}

/* ------------------------------------------------------------- lamp posts */
export function createLamps(positions) {
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const pts = new THREE.Points(g, glowPointsMaterial('#ffb35c', .007));
  pts.name = 'lamps'; pts.frustumCulled = false; return pts;
}
