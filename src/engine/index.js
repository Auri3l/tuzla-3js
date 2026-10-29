import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import GeometryWorker from './geometry.worker.js?worker&inline';
import { toWorld, toLatLon, terrainSampler, TERRAIN_SCALE } from './geo.js';
import { shared, buildingMaterial, buildingDepthMaterial, buildingPickMaterial, terrainMaterial, roadMaterial } from './materials.js';
import { createSky } from './sky.js';
import { createTrees, createTraffic, createTrains, createShips, createLamps } from './life.js';

export const QUALITY = {
  low: { ratio: 1, shadow: 0, bloom: false, trees: 18000, cars: 350, grid: 420, aa: false },
  medium: { ratio: 1.5, shadow: 2048, bloom: false, trees: 50000, cars: 1100, grid: 700, aa: true },
  high: { ratio: 2, shadow: 4096, bloom: true, trees: 90000, cars: 2400, grid: 900, aa: true }
};

const waitFrame = () => new Promise(r => requestAnimationFrame(r));

async function jsonData(id, path) {
  const el = document.getElementById(id);
  if (el) return JSON.parse(el.textContent);
  const res = await fetch(path); if (!res.ok) throw new Error(`Could not load ${path}`); return res.json();
}
function imageSource(id, path) { const el = document.getElementById(id); return el ? el.textContent.trim() : path; }
async function loadImage(src) {
  const img = new Image(); img.decoding = 'async'; img.src = src;
  await img.decode(); return img;
}
function imageData(img) {
  const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
  const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0);
  return g.getImageData(0, 0, c.width, c.height);
}

/* -------------------------------------------------------------- land tint */
const LAND_COLOURS = {
  grass: [104, 146, 72, .55], park: [92, 140, 70, .62], garden: [98, 142, 74, .5], playground: [120, 150, 80, .45], recreation_ground: [100, 140, 72, .5],
  meadow: [130, 150, 80, .4], grassland: [128, 146, 82, .4], village_green: [100, 145, 75, .5], wood: [46, 88, 46, .66], forest: [42, 82, 44, .7],
  nature_reserve: [58, 96, 52, .45], scrub: [112, 126, 70, .45], farmland: [170, 155, 98, .3], orchard: [108, 138, 70, .45], vineyard: [120, 130, 70, .4],
  industrial: [150, 150, 148, .22], residential: [176, 156, 134, .1], cemetery: [82, 108, 74, .55], pitch: [64, 142, 72, .8], wetland: [70, 110, 90, .45]
};
function landTexture(land, bounds) {
  const [x0, z0, x1, z1] = bounds, W = 2048, H = Math.round(W * (z1 - z0) / (x1 - x0));
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  const sorted = land.map(([k, r]) => { let a = 0; for (let i = 0; i < r.length; i += 2) { const j = (i + 2) % r.length; a += r[i] * r[j + 1] - r[j] * r[i + 1]; } return [k, r, Math.abs(a)]; }).sort((a, b) => b[2] - a[2]);
  for (const [k, r] of sorted) {
    const col = LAND_COLOURS[k]; if (!col || r.length < 6) continue;
    g.fillStyle = `rgba(${col[0]},${col[1]},${col[2]},${col[3]})`;
    g.beginPath();
    for (let i = 0; i < r.length; i += 2) { const x = (r[i] - x0) / (x1 - x0) * W, y = (r[i + 1] - z0) / (z1 - z0) * H; i ? g.lineTo(x, y) : g.moveTo(x, y); }
    g.closePath(); g.fill();
    if (k === 'pitch') { g.strokeStyle = 'rgba(235,240,230,.7)'; g.lineWidth = .6; g.stroke(); }
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}

/* --------------------------------------------------------------- terrain */
function terrainMesh(terrain, elev, material, grid) {
  const [xmin, zmin, xmax, zmax] = terrain.bounds, M = 4; // km of skirt fading to sea level
  const X0 = xmin - M, Z0 = zmin - M, X1 = xmax + M, Z1 = zmax + M;
  const NX = grid, NZ = Math.round(grid * (Z1 - Z0) / (X1 - X0));
  const pos = new Float32Array(NX * NZ * 3), uv = new Float32Array(NX * NZ * 2), idx = new Uint32Array((NX - 1) * (NZ - 1) * 6);
  let p = 0, u = 0;
  for (let r = 0; r < NZ; r++) for (let c = 0; c < NX; c++) {
    const x = X0 + (X1 - X0) * c / (NX - 1), z = Z0 + (Z1 - Z0) * r / (NZ - 1);
    const out = Math.max(xmin - x, x - xmax, zmin - z, z - zmax, 0);
    const h = elev(x, z) * (1 - THREE.MathUtils.smoothstep(out, 0, M * .9));
    pos[p++] = x; pos[p++] = h; pos[p++] = z;
    uv[u++] = (x - xmin) / (xmax - xmin); uv[u++] = 1 - (z - zmin) / (zmax - zmin);
  }
  let i = 0;
  for (let r = 0; r < NZ - 1; r++) for (let c = 0; c < NX - 1; c++) {
    const a = r * NX + c, b = a + 1, d = a + NX, e = d + 1;
    idx[i++] = a; idx[i++] = d; idx[i++] = b; idx[i++] = b; idx[i++] = d; idx[i++] = e;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(new THREE.BufferAttribute(idx, 1)); geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, material); mesh.receiveShadow = true; mesh.name = 'terrain';
  // far plane beyond the skirt (water to the south, land to the north via the clamped mask)
  const S = 260, plane = new THREE.PlaneGeometry(S, S, 8, 8).rotateX(-Math.PI / 2);
  const pp = plane.attributes.position, puv = plane.attributes.uv;
  for (let k = 0; k < pp.count; k++) { pp.setY(k, -.004); puv.setXY(k, (pp.getX(k) - xmin) / (xmax - xmin), 1 - (pp.getZ(k) - zmin) / (zmax - zmin)); }
  const far = new THREE.Mesh(plane, material); far.receiveShadow = false; far.renderOrder = -1;
  return [mesh, far];
}

/* ------------------------------------------------------------------------ */
export async function createTuzla({ canvas, container, places, quality = 'medium', initialView = null, hours = 13, onProgress, onReady, onError, onSelect, onViewChange, onWalkChange }) {
  let Q = QUALITY[quality] || QUALITY.medium;
  let renderer;
  try { renderer = new THREE.WebGLRenderer({ canvas, antialias: Q.aa, alpha: false, powerPreference: 'high-performance', preserveDrawingBuffer: false }); }
  catch (e) { onError?.(e); return null; }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, Q.ratio));
  renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog('#c5d6de', 40, 160);
  const camera = new THREE.PerspectiveCamera(40, 1, .002, 200);
  const controls = new OrbitControls(camera, renderer.domElement);
  Object.assign(controls, { enableDamping: true, dampingFactor: .085, screenSpacePanning: false, minDistance: .045, maxDistance: 75, minPolarAngle: .002, maxPolarAngle: 1.5, rotateSpeed: .6, zoomSpeed: .9, panSpeed: .9, zoomToCursor: true });
  controls.keys = { LEFT: 'KeyA', UP: 'KeyW', RIGHT: 'KeyD', BOTTOM: 'KeyS' }; controls.keyPanSpeed = 22; controls.listenToKeyEvents(canvas);

  const sky = createSky(renderer, scene);
  const sun = sky.sun;

  /* ---- data */
  let osm, terrain, groundImg, maskImg;
  try {
    onProgress?.('load', 0);
    [osm, terrain, groundImg, maskImg] = await Promise.all([
      jsonData('tuzla-osm-data', './data/tuzla-osm.json'),
      jsonData('tuzla-terrain-data', './data/terrain.json'),
      loadImage(imageSource('tuzla-ground-data', './data/tuzla-ground.jpg')),
      loadImage(imageSource('tuzla-water-data', './data/water-mask.png')).catch(() => null)
    ]);
  } catch (e) { onError?.(e); return null; }
  const elev = terrainSampler(terrain);
  const [bx0, bz0, bx1, bz1] = terrain.bounds;
  shared.uBounds.value.set(bx0, bz0, bx1, bz1);

  // world positions for POIs (used by the worker to name buildings, and by search)
  for (const p of osm.pois) { const [x, z] = toWorld(p[1], p[2]); p.wx = x; p.wz = z; }

  /* ---- geometry worker */
  onProgress?.('geometry', 0);
  const groundPixels = imageData(groundImg);
  const worker = new GeometryWorker();
  const built = new Promise((resolve, reject) => {
    worker.onmessage = ({ data }) => {
      if (data.type === 'progress') onProgress?.(data.stage, data.value);
      else if (data.type === 'done') resolve(data);
      else if (data.type === 'error') reject(new Error(data.message));
    };
    worker.onerror = e => reject(e);
  });
  worker.postMessage({ type: 'build', osm: { buildings: osm.buildings, roads: osm.roads, land: osm.land, trees: osm.trees, pois: osm.pois.map(p => Object.assign([...p], { wx: p.wx, wz: p.wz })) }, terrain, ground: { width: groundPixels.width, height: groundPixels.height, data: groundPixels.data }, options: { treeBudget: QUALITY.high.trees, chunkSize: 1.6 } });

  /* ---- terrain and water (built while the worker runs) */
  const groundTex = new THREE.Texture(groundImg); groundTex.colorSpace = THREE.SRGBColorSpace; groundTex.anisotropy = 8; groundTex.needsUpdate = true;
  const maskTex = maskImg ? new THREE.Texture(maskImg) : new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
  maskTex.needsUpdate = true; maskTex.minFilter = THREE.LinearFilter; maskTex.generateMipmaps = false;
  const tMat = terrainMaterial(groundTex, maskTex, landTexture(osm.land, terrain.bounds));
  const [terrainM, farM] = terrainMesh(terrain, elev, tMat, Q.grid);
  scene.add(terrainM, farM);
  const maskPixels = maskImg ? imageData(maskImg) : null;

  /* ---- boundary */
  const bverts = []; for (let i = 0; i < osm.boundary.length; i += 2) { const x = osm.boundary[i], z = osm.boundary[i + 1]; bverts.push(x, elev(x, z) + .004, z); }
  const bgeo = new THREE.BufferGeometry(); bgeo.setAttribute('position', new THREE.Float32BufferAttribute(bverts, 3));
  const boundary = new THREE.Line(bgeo, new THREE.LineBasicMaterial({ color: '#b9f3d2', transparent: true, opacity: .85, fog: false }));
  boundary.renderOrder = 5; scene.add(boundary);

  let result;
  try { result = await built; } catch (e) { onError?.(e); return null; }
  worker.terminate();
  onProgress?.('scene', 0); await waitFrame();

  /* ---- buildings */
  const bMat = buildingMaterial(), bDepth = buildingDepthMaterial(), bPick = buildingPickMaterial();
  const buildings = new THREE.Group(); buildings.name = 'buildings';
  for (const chunk of result.chunks) for (const c of [chunk.shell, chunk.details]) {
    if (!c.position.length) continue;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(c.position, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(c.normal, 3, true));
    g.setAttribute('uv', new THREE.BufferAttribute(c.uv, 2));
    g.setAttribute('color', new THREE.BufferAttribute(c.color, 3, true));
    g.setAttribute('info', new THREE.BufferAttribute(c.info, 4));
    g.setIndex(new THREE.BufferAttribute(c.index, 1));
    g.computeBoundingBox(); g.boundingBox.max.y += .2; g.computeBoundingSphere(); g.boundingSphere.radius += .15;
    const m = new THREE.Mesh(g, bMat); m.customDepthMaterial = bDepth; m.castShadow = m.receiveShadow = true;
    m.userData.center = g.boundingSphere.center.clone(); m.userData.radius = g.boundingSphere.radius; m.userData.detail = c === chunk.details;
    buildings.add(m);
  }
  scene.add(buildings);
  const meta = result.meta, names = result.names;

  /* ---- roads */
  const rg = new THREE.BufferGeometry(), R = result.roads, nv = R.position.length / 3, normals = new Int8Array(nv * 3);
  for (let i = 0; i < nv; i++) normals[i * 3 + 1] = 127;
  rg.setAttribute('position', new THREE.BufferAttribute(R.position, 3)); rg.setAttribute('normal', new THREE.BufferAttribute(normals, 3, true));
  rg.setAttribute('across', new THREE.BufferAttribute(R.across, 2)); rg.setAttribute('uv', new THREE.BufferAttribute(R.uv, 2)); rg.setAttribute('kind', new THREE.BufferAttribute(R.kind, 1));
  rg.setIndex(new THREE.BufferAttribute(R.index, 1)); rg.computeBoundingSphere();
  const roads = new THREE.Mesh(rg, roadMaterial()); roads.receiveShadow = true; roads.renderOrder = 1; roads.frustumCulled = false; roads.name = 'roads';
  scene.add(roads);
  const lamps = createLamps(result.lamps); scene.add(lamps);

  /* ---- life */
  const trees = createTrees(result.trees, { budget: QUALITY.high.trees }); scene.add(trees);
  const traffic = createTraffic(result.paths, { count: QUALITY.high.cars }); scene.add(traffic.group);
  const trains = createTrains(result.rails); scene.add(trains.group);
  const ships = createShips(maskPixels, terrain.bounds, { seed: 7 }); scene.add(ships.group);

  /* ---- post-processing */
  let composer = null, bloom = null;
  function buildComposer() {
    const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
    composer = new EffectComposer(renderer, rt);
    composer.addPass(new RenderPass(scene, camera));
    bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), .35, .55, .82);
    composer.addPass(bloom); composer.addPass(new OutputPass());
  }

  /* ---- quality */
  function applyQuality(name) {
    Q = QUALITY[name] || Q; quality = name;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, Q.ratio));
    sun.castShadow = Q.shadow > 0;
    if (Q.shadow) { sun.shadow.mapSize.set(Q.shadow, Q.shadow); sun.shadow.map?.dispose(); sun.shadow.map = null; }
    trees.children.forEach(m => { m.castShadow = Q.shadow >= 4096; });
    let budget = Q.trees, total = 0; trees.children.forEach(m => total += m.instanceMatrix.count);
    const k = Math.min(1, budget / Math.max(1, total)); trees.children.forEach(m => { m.count = Math.ceil(m.instanceMatrix.count * k); });
    traffic.setCount(Q.cars);
    if (Q.bloom && !composer) buildComposer();
    resize(); needsRender = true;
  }
  sun.shadow.bias = -.00025; sun.shadow.normalBias = .0006;
  sun.shadow.camera.near = .1; sun.shadow.camera.far = 60;

  /* ---- camera helpers */
  const placeTarget = key => { const p = places[key]; const [x, z] = toWorld(p.lat, p.lon); return new THREE.Vector3(x, elev(x, z) + .01, z); };
  const offsetFor = (dist, azDeg, tiltDeg) => {
    const az = azDeg * Math.PI / 180, tilt = tiltDeg * Math.PI / 180;
    return new THREE.Vector3(Math.sin(az) * Math.sin(tilt) * dist, Math.cos(tilt) * dist, -Math.cos(az) * Math.sin(tilt) * dist);
  };
  const isPortrait = () => container.clientWidth <= 700 && container.clientHeight > container.clientWidth;
  let width = 0, height = 0, animation = null, raf = 0, first = true, mode = '3d', needsRender = true, walking = null;
  let animate = true, hidden = false;

  function fly(target, offset, duration = 1600, toFov = 40) {
    walking = null;
    const dest = target.clone();
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    animation = { start: performance.now(), duration: reduce ? 1 : duration, fromPos: camera.position.clone(), toPos: dest.clone().add(offset), fromTarget: controls.target.clone(), toTarget: dest, fromFov: camera.fov, toFov };
    // arc up when travelling far
    animation.lift = Math.min(6, animation.fromTarget.distanceTo(dest) * .35);
  }
  function setPlace(key) { const p = places[key]; if (!p) return; mode = '3d'; fly(placeTarget(key), offsetFor(p.dist * (isPortrait() ? 1.5 : 1), p.az, p.tilt)); }
  function flyTo(lat, lon, dist = .9, az = 200, tilt = 55) { const [x, z] = toWorld(lat, lon); mode = '3d'; fly(new THREE.Vector3(x, elev(x, z) + .01, z), offsetFor(dist, az, tilt)); }
  function overview() { mode = '3d'; fly(new THREE.Vector3(.6, .08, .2), offsetFor(isPortrait() ? 44 : 27, 196, 48), 1800, isPortrait() ? 50 : 40); }
  function reset() { setPlace(Object.keys(places)[0]); }
  function changeMode(next) {
    mode = next; const target = controls.target.clone(), dist = camera.position.distanceTo(target);
    const s = new THREE.Spherical().setFromVector3(camera.position.clone().sub(target));
    fly(target, next === '2d' ? new THREE.Vector3(0, dist, .0001) : new THREE.Vector3().setFromSpherical(new THREE.Spherical(dist, 1.0, s.theta)), 900, camera.fov);
  }
  function zoomBy(f) { animation = null; const o = camera.position.clone().sub(controls.target); o.setLength(THREE.MathUtils.clamp(o.length() / f, controls.minDistance, controls.maxDistance)); camera.position.copy(controls.target).add(o); controls.update(); }
  function northUp() { const o = camera.position.clone().sub(controls.target), s = new THREE.Spherical().setFromVector3(o); s.theta = 0; fly(controls.target.clone(), new THREE.Vector3().setFromSpherical(s), 700, camera.fov); }

  // initial camera
  if (initialView) {
    const [x, z] = toWorld(initialView.lat, initialView.lon); const t = new THREE.Vector3(x, elev(x, z) + .01, z);
    controls.target.copy(t); camera.position.copy(t).add(offsetFor(initialView.dist, initialView.az, initialView.tilt));
  } else {
    const k = Object.keys(places)[0], p = places[k], t = placeTarget(k);
    controls.target.copy(t); camera.position.copy(t).add(offsetFor(p.dist * (isPortrait() ? 1.5 : 1) * 2.2, p.az - 25, p.tilt - 5));
    setPlace(k);
  }
  controls.update();

  /* ---- view state for share links */
  function viewState() {
    const t = controls.target, o = camera.position.clone().sub(t), dist = o.length();
    const [lat, lon] = toLatLon(t.x, t.z);
    const az = (Math.atan2(o.x, -o.z) * 180 / Math.PI + 360) % 360, tilt = Math.acos(THREE.MathUtils.clamp(o.y / dist, -1, 1)) * 180 / Math.PI;
    return { lat, lon, dist, az, tilt };
  }
  let viewTimer = 0;
  controls.addEventListener('change', () => {
    needsRender = true; clearTimeout(viewTimer); viewTimer = setTimeout(() => onViewChange?.(viewState()), 350);
  });
  controls.addEventListener('start', () => { animation = null; });

  /* ---- picking */
  const pickTarget = new THREE.WebGLRenderTarget(1, 1), pickBuf = new Uint8Array(4), pickRay = new THREE.Raycaster(), pickNdc = new THREE.Vector2();
  function pickAt(clientX, clientY) {
    const rect = canvas.getBoundingClientRect(), x = clientX - rect.left, y = clientY - rect.top;
    // only the chunks whose bounding sphere the cursor ray crosses go into the pick pass
    pickNdc.set(x / rect.width * 2 - 1, 1 - y / rect.height * 2); pickRay.setFromCamera(pickNdc, camera);
    const hits = [];
    for (const m of buildings.children) if (m.visible && pickRay.ray.intersectsSphere(m.geometry.boundingSphere)) { m.layers.enable(1); hits.push(m); }
    if (!hits.length) return -1;
    camera.setViewOffset(width, height, x, y, 1, 1);
    const oldMask = camera.layers.mask, oldBg = scene.background, oldFog = scene.fog;
    camera.layers.set(1); scene.overrideMaterial = bPick; scene.background = null; scene.fog = null;
    renderer.setRenderTarget(pickTarget); renderer.setClearColor(0x000000, 1); renderer.clear(); renderer.render(scene, camera);
    renderer.readRenderTargetPixels(pickTarget, 0, 0, 1, 1, pickBuf);
    renderer.setRenderTarget(null); scene.overrideMaterial = null; camera.layers.mask = oldMask; scene.background = oldBg; scene.fog = oldFog;
    camera.clearViewOffset(); needsRender = true;
    for (const m of hits) m.layers.disable(1);
    const id = pickBuf[0] + pickBuf[1] * 256 + pickBuf[2] * 65536 - 1;
    return id >= 0 && id * 12 < meta.length && meta[id * 12 + 2] > 0 ? id : -1;
  }
  function buildingInfo(id) {
    const m = id * 12, [lat, lon] = toLatLon(meta[m], meta[m + 1]);
    return { id, name: names[id] || '', lat, lon, height: meta[m + 2], known: meta[m + 3], floors: meta[m + 4], area: meta[m + 5], ground: meta[m + 6] * 1000 / TERRAIN_SCALE, style: THREE.MathUtils.clamp(meta[m + 7] | 0, 0, 7), roof: THREE.MathUtils.clamp(meta[m + 8] | 0, 0, 3), roofType: THREE.MathUtils.clamp(meta[m + 8] | 0, 0, 3), kind: meta[m + 9], industrial: meta[m + 10] > 0 };
  }
  function select(id, focus = false) {
    shared.uSelected.value = id; needsRender = true;
    if (id < 0) { onSelect?.(null); return; }
    const info = buildingInfo(id); onSelect?.(info);
    if (focus) { const t = new THREE.Vector3(meta[id * 12], meta[id * 12 + 11], meta[id * 12 + 1]); const o = camera.position.clone().sub(controls.target); o.setLength(Math.min(o.length(), .45)); fly(t, o, 1000, camera.fov); }
  }
  let down = null;
  canvas.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; });
  canvas.addEventListener('pointerup', e => {
    if (!down || walking) return; const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y), dt = performance.now() - down.t; down = null;
    if (moved > 6 || dt > 500) return;
    select(pickAt(e.clientX, e.clientY));
  });
  canvas.addEventListener('dblclick', e => { const id = pickAt(e.clientX, e.clientY); if (id >= 0) select(id, true); });

  /* ---- walk mode (street level) */
  const keys = new Set();
  function enterWalk() {
    const t = controls.target.clone(), o = camera.position.clone().sub(t);
    walking = { yaw: Math.atan2(-o.x, -o.z), pitch: -.05, pos: new THREE.Vector3(t.x, elev(t.x, t.z) + .0017, t.z), back: { pos: camera.position.clone(), target: t, fov: camera.fov }, vy: 0 };
    animation = null; controls.enabled = false; camera.fov = 62; camera.updateProjectionMatrix(); onWalkChange?.(true); needsRender = true;
  }
  function exitWalk() {
    if (!walking) return; const b = walking.back, yaw = walking.yaw; walking = null; controls.enabled = true;
    camera.fov = b.fov; camera.updateProjectionMatrix();
    const t = new THREE.Vector3(camera.position.x - Math.sin(yaw) * .15, 0, camera.position.z - Math.cos(yaw) * .15); t.y = elev(t.x, t.z);
    controls.target.copy(t); fly(t, offsetFor(.4, 180 - yaw * 180 / Math.PI, 58), 1100, b.fov);
    onWalkChange?.(false);
  }
  let look = null;
  canvas.addEventListener('pointerdown', e => { if (walking) { look = { x: e.clientX, y: e.clientY }; canvas.setPointerCapture(e.pointerId); } });
  canvas.addEventListener('pointermove', e => {
    if (!walking || !look) return;
    walking.yaw -= (e.clientX - look.x) * .004; walking.pitch = THREE.MathUtils.clamp(walking.pitch - (e.clientY - look.y) * .004, -1.2, 1.2);
    look = { x: e.clientX, y: e.clientY }; needsRender = true;
  });
  canvas.addEventListener('pointerup', () => { look = null; });
  const onKeyDown = e => {
    if (walking) {
      if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'ShiftRight', 'KeyQ', 'KeyE'].includes(e.code)) { keys.add(e.code); e.preventDefault(); }
      if (e.code === 'Escape') exitWalk();
      return;
    }
    const key = e.key;
    if (key === 'ArrowLeft' || key === 'ArrowRight' || key === 'ArrowUp' || key === 'ArrowDown') {
      e.preventDefault(); animation = null; const s = new THREE.Spherical().setFromVector3(camera.position.clone().sub(controls.target));
      if (key === 'ArrowLeft') s.theta -= .08; if (key === 'ArrowRight') s.theta += .08;
      if (key === 'ArrowUp') s.phi = Math.max(controls.minPolarAngle, s.phi - .06); if (key === 'ArrowDown') s.phi = Math.min(controls.maxPolarAngle, s.phi + .06);
      camera.position.copy(controls.target).add(new THREE.Vector3().setFromSpherical(s)); controls.update();
    } else if (key === '+' || key === '=') { e.preventDefault(); zoomBy(1.2); }
    else if (key === '-' || key === '_') { e.preventDefault(); zoomBy(1 / 1.2); }
    else if (key === '0' || key === 'Home') { e.preventDefault(); reset(); }
    else if (key === 'n' || key === 'N') northUp();
  };
  const onKeyUp = e => keys.delete(e.code);
  canvas.addEventListener('keydown', onKeyDown); window.addEventListener('keyup', onKeyUp);
  const walkInput = { forward: 0 };
  function walkStep(dt) {
    const w = walking; let f = walkInput.forward, s = 0, turn = 0;
    if (keys.has('KeyW') || keys.has('ArrowUp')) f += 1; if (keys.has('KeyS') || keys.has('ArrowDown')) f -= 1;
    if (keys.has('KeyA')) s -= 1; if (keys.has('KeyD')) s += 1;
    if (keys.has('ArrowLeft') || keys.has('KeyQ')) turn += 1; if (keys.has('ArrowRight') || keys.has('KeyE')) turn -= 1;
    w.yaw += turn * dt * 1.4;
    const speed = (keys.has('ShiftLeft') || keys.has('ShiftRight') ? 30 : 6) / 1000;
    const fx = -Math.sin(w.yaw), fz = -Math.cos(w.yaw);
    w.pos.x += (fx * f - fz * s) * speed * dt; w.pos.z += (fz * f + fx * s) * speed * dt;
    const ground = elev(w.pos.x, w.pos.z), eye = ground + .0017;
    const dy = eye - w.pos.y; w.pos.y += dy * Math.min(1, dt * 10); if (Math.abs(dy) > 1e-6) needsRender = true;
    camera.position.copy(w.pos);
    const dir = new THREE.Vector3(Math.cos(w.pitch) * fx, Math.sin(w.pitch), Math.cos(w.pitch) * fz);
    camera.lookAt(camera.position.clone().add(dir));
    if (f || s || turn) needsRender = true;
  }

  /* ---- labels (HTML, positioned every frame) */
  const labels = [];
  function addLabel(el, lat, lon, opts = {}) {
    const [x, z] = toWorld(lat, lon); const p = new THREE.Vector3(x, elev(x, z) + (opts.lift ?? .03), z);
    labels.push({ el, p, minDist: opts.minDist ?? 0, maxDist: opts.maxDist ?? 1e9, priority: opts.priority ?? 0, key: opts.key });
    labels.sort((a, b) => b.priority - a.priority); needsRender = true;
  }
  const tmp = new THREE.Vector3();
  function updateLabels() {
    const placed = [], dist = camera.position.distanceTo(controls.target);
    for (const l of labels) {
      const el = l.el;
      let visible = !walking && dist >= l.minDist && dist <= l.maxDist && el.dataset.hidden !== '1';
      let x = 0, y = 0;
      if (visible) {
        tmp.copy(l.p).project(camera);
        x = (tmp.x * .5 + .5) * width; y = (-tmp.y * .5 + .5) * height;
        visible = tmp.z < 1 && x > 10 && x < width - 10 && y > 70 && y < height - 40;
      }
      if (visible) {
        if (!el._w) { el._w = el.offsetWidth; el._h = el.offsetHeight; }
        const w = el._w, h = el._h;
        const r = { l: x - w / 2 - 3, r: x + w / 2 + 3, t: y - h - 3, b: y + 3 };
        if (placed.some(o => r.l < o.r && r.r > o.l && r.t < o.b && r.b > o.t)) visible = false; else placed.push(r);
      }
      el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%)`;
      if (visible !== el._vis) { el._vis = visible; el.classList.toggle('shown', visible); }
    }
  }

  /* ---- compass */
  const compassArrow = container.parentElement.querySelector('.compass svg');
  const cB = new THREE.Vector3(), cN = new THREE.Vector3();
  function updateCompass() {
    if (!compassArrow) return;
    let a;
    if (walking) a = walking.yaw;
    else { cB.copy(controls.target).project(camera); cN.copy(controls.target).add(new THREE.Vector3(0, 0, -.1)).project(camera); a = Math.atan2((cN.x - cB.x) * width, (cN.y - cB.y) * height); }
    compassArrow.style.transform = `rotate(${a}rad)`;
  }

  /* ---- time of day */
  let skyState = sky.update(hours);
  function setTime(h) { hours = h; skyState = sky.update(h); shared.uNight.value = skyState.night; needsRender = true; }
  setTime(hours);

  /* ---- resize */
  function resize() {
    width = container.clientWidth; height = container.clientHeight; if (!width || !height) return;
    renderer.setSize(width, height, false); camera.aspect = width / height; camera.updateProjectionMatrix();
    if (composer) { composer.setPixelRatio(renderer.getPixelRatio()); composer.setSize(width, height); }
    needsRender = true;
  }

  /* ---- render loop */
  const clock = new THREE.Clock(); let frameAvg = 16, adaptiveScale = 1, lastAdapt = 0;
  const lightDir = new THREE.Vector3(), right = new THREE.Vector3(), upv = new THREE.Vector3();
  function updateShadow(focus, dist) {
    if (!sun.castShadow) return;
    const S = THREE.MathUtils.clamp(dist * .75, .25, 14), cam = sun.shadow.camera;
    if (cam.right !== S) { cam.left = -S; cam.right = S; cam.top = S; cam.bottom = -S; cam.updateProjectionMatrix(); }
    lightDir.copy(skyState.dir); if (lightDir.y < .05) lightDir.y = .05; lightDir.normalize();
    // snap to shadow texels to keep edges stable while panning
    right.crossVectors(lightDir, new THREE.Vector3(0, 1, 0)).normalize(); upv.crossVectors(right, lightDir).normalize();
    const texel = 2 * S / sun.shadow.mapSize.x;
    const a = Math.round(focus.dot(right) / texel) * texel - focus.dot(right), b = Math.round(focus.dot(upv) / texel) * texel - focus.dot(upv);
    const f = focus.clone().addScaledVector(right, a).addScaledVector(upv, b);
    sun.target.position.copy(f); sun.position.copy(f).addScaledVector(lightDir, 30); sun.target.updateMatrixWorld();
  }
  function render() {
    raf = requestAnimationFrame(render);
    if (hidden) return;
    const dt = Math.min(.1, clock.getDelta()), now = performance.now();
    if (animate) shared.uTime.value += dt;
    if (animation) {
      const t = Math.min(1, (now - animation.start) / animation.duration), e = t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      controls.target.lerpVectors(animation.fromTarget, animation.toTarget, e);
      camera.position.lerpVectors(animation.fromPos, animation.toPos, e);
      camera.position.y += Math.sin(Math.PI * e) * animation.lift;
      camera.fov = THREE.MathUtils.lerp(animation.fromFov, animation.toFov, e); camera.updateProjectionMatrix();
      needsRender = true; if (t === 1) animation = null;
    }
    if (walking) walkStep(dt); else controls.update();
    // keep the camera above ground
    if (!walking) { const g = elev(camera.position.x, camera.position.z) + .012; if (camera.position.y < g) { camera.position.y = g; } }
    const focus = walking ? camera.position : controls.target, dist = walking ? .002 : camera.position.distanceTo(controls.target);
    const near = walking ? .0004 : THREE.MathUtils.clamp(dist * .03, .0008, .6), far = walking ? 60 : Math.max(90, dist * 7);
    if (camera.near !== near || camera.far !== far) { camera.near = near; camera.far = far; camera.updateProjectionMatrix(); }
    scene.fog.color.copy(skyState.fog);
    const height = camera.position.y;
    scene.fog.near = walking ? 1.5 : Math.max(4, dist * 1.6 + height * .5); scene.fog.far = walking ? 18 : Math.max(30, dist * 6 + height * 2.5 + 20);
    shared.uPixelK.value = 2 * Math.tan(camera.fov * Math.PI / 360) / Math.max(1, renderer.domElement.height / renderer.getPixelRatio()) ;
    sky.follow(camera);
    // level of detail by distance
    const d = dist;
    // per-chunk distance culling, and only chunks near the shadow camera feed the shadow pass
    const bFar = scene.fog.far + 4, sFar = Math.min(16, dist * 1.1 + 2.5);
    for (const m of buildings.children) {
      const r = m.userData.center.distanceTo(focus) - m.userData.radius;
      m.visible = layerOn.buildings && r < bFar; m.castShadow = Q.shadow > 0 && r < sFar;
      if (m.userData.detail) {
        // details (balconies, awnings, rooftop clutter) only near the camera; they cast shadows only with high-res maps
        const cd = Math.max(0, m.userData.center.distanceTo(camera.position) - m.userData.radius);
        m.visible = m.visible && cd < 1.8; m.castShadow = m.visible && Q.shadow >= 4096 && cd < .9;
      }
    }
    trees.visible = layerOn.trees && d < 14;
    if (trees.visible) for (const m of trees.children) m.visible = m.userData.center.distanceTo(tmp.set(focus.x, 0, focus.z)) < Math.max(3.4, d * 1.4);
    traffic.group.visible = layerOn.traffic && d < 7;
    lamps.visible = layerOn.streets && skyState.night > .02 && d < 18;
    const anim = animate;
    if (anim) {
      if (traffic.group.visible) traffic.update(dt, skyState.night);
      trains.update(dt, skyState.night); ships.update(dt, skyState.night);
    }
    if (animate) needsRender = true; // water, trees and traffic move
    if (needsRender) {
      renderer.shadowMap.autoUpdate = sun.intensity > .02;
      updateShadow(focus, dist);
      if (composer && Q.bloom) { bloom.strength = .12 + .75 * skyState.night; bloom.threshold = skyState.night > .3 ? .6 : .9; composer.render(); }
      else renderer.render(scene, camera);
      updateLabels(); updateCompass();
      needsRender = false;
      if (first) { first = false; onReady?.({ stats: result.stats, ships: ships.counts }); }
      // adaptive resolution: back off when frames are slow, recover when fast
      frameAvg = frameAvg * .95 + dt * 1000 * .05;
      if (now - lastAdapt > 1500) {
        lastAdapt = now;
        const base = Math.min(window.devicePixelRatio || 1, Q.ratio);
        if (frameAvg > 40 && adaptiveScale > .55) adaptiveScale -= .15; else if (frameAvg < 22 && adaptiveScale < 1) adaptiveScale = Math.min(1, adaptiveScale + .1); else return;
        renderer.setPixelRatio(base * adaptiveScale); resize();
      }
    }
  }

  const layerOn = { buildings: true, streets: true, trees: true, boundary: true, traffic: true, water: true, ships: true };
  function setLayer(name, value) {
    layerOn[name] = value;
    const map = { buildings: [buildings], streets: [roads, lamps], trees: [trees], boundary: [boundary], traffic: [traffic.group, trains.group], ships: [ships.group] };
    (map[name] || []).forEach(o => { o.visible = value; }); needsRender = true;
  }

  document.addEventListener('visibilitychange', () => { hidden = document.hidden; clock.getDelta(); });
  resize(); const observer = new ResizeObserver(resize); observer.observe(container);
  applyQuality(quality);
  raf = requestAnimationFrame(render);

  // searchable features
  const features = osm.pois.map(p => ({ name: p[0], lat: p[1], lon: p[2], type: p[3] }));
  for (const id in names) { const m = id * 12, [lat, lon] = toLatLon(meta[m], meta[m + 1]); features.push({ name: names[id], lat, lon, type: 'building', building: +id }); }

  return {
    setPlace, flyTo, overview, reset, changeMode, zoomBy, northUp, setLayer, setTime, addLabel, select, enterWalk, exitWalk,
    walkInput, features, stats: result.stats, _debug: { scene, renderer, camera, sky },
    refreshLabels() { labels.forEach(l => { l.el._w = 0; }); needsRender = true; },
    setHeightScale(v) { shared.uHScale.value = v; needsRender = true; },
    setQuality: applyQuality,
    setAnimate(v) { animate = v; needsRender = true; },
    setAutoRotate(v) { controls.autoRotate = v; controls.autoRotateSpeed = .5; },
    getMode: () => mode, isWalking: () => !!walking, viewState,
    screenshot() {
      if (composer && Q.bloom) composer.render(); else renderer.render(scene, camera);
      return renderer.domElement.toDataURL('image/png');
    },
    dispose() { cancelAnimationFrame(raf); observer.disconnect(); canvas.removeEventListener('keydown', onKeyDown); window.removeEventListener('keyup', onKeyUp); controls.dispose(); renderer.dispose(); }
  };
}
