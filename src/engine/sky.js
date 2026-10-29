import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';

const LAT = 40.82 * Math.PI / 180, LON = 29.3;

/** Solar position for Tuzla. hours is local time (UTC+3). Returns {dir, elevation (rad), azimuth (rad from north)}. */
export function sunPosition(hours, date = new Date()) {
  const start = Date.UTC(date.getUTCFullYear(), 0, 0), day = Math.floor((date.getTime() - start) / 864e5);
  const B = 2 * Math.PI * (day - 81) / 364;
  const eot = 9.87 * Math.sin(2 * B) - 7.53 * Math.cos(B) - 1.5 * Math.sin(B); // minutes
  const decl = 23.44 * Math.PI / 180 * Math.sin(2 * Math.PI * (284 + day) / 365);
  const solar = hours - 3 + LON / 15 + eot / 60;
  const H = (solar - 12) * 15 * Math.PI / 180;
  const sinEl = Math.sin(LAT) * Math.sin(decl) + Math.cos(LAT) * Math.cos(decl) * Math.cos(H);
  const el = Math.asin(sinEl);
  const az = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(LAT) - Math.tan(decl) * Math.cos(LAT)) + Math.PI;
  const dir = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
  return { dir, elevation: el, azimuth: az };
}

const C = (h) => new THREE.Color(h);
const lerpC = (a, b, t) => a.clone().lerp(b, THREE.MathUtils.clamp(t, 0, 1));

export function createSky(renderer, scene) {
  const sky = new Sky();
  sky.material.depthWrite = false;
  sky.frustumCulled = false;
  sky.renderOrder = -10;
  const u = sky.material.uniforms;
  u.turbidity.value = 6; u.rayleigh.value = 1.6; u.mieCoefficient.value = .0045; u.mieDirectionalG.value = .8;
  scene.add(sky);

  // stars
  const starGeo = new THREE.BufferGeometry(), N = 2600, sp = new Float32Array(N * 3), ss = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const t = Math.random() * Math.PI * 2, y = Math.random() * .98 + .02, r = Math.sqrt(1 - y * y);
    sp.set([Math.cos(t) * r, y, Math.sin(t) * r], i * 3); ss[i] = Math.pow(Math.random(), 3) * 2.2 + .6;
  }
  starGeo.setAttribute('position', new THREE.BufferAttribute(sp, 3)); starGeo.setAttribute('size', new THREE.BufferAttribute(ss, 1));
  const starMat = new THREE.ShaderMaterial({
    uniforms: { uAlpha: { value: 0 } },
    vertexShader: 'attribute float size; void main(){ gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position.z = gl_Position.w * .9999; gl_PointSize = size; }',
    fragmentShader: 'uniform float uAlpha; void main(){ float r = length(gl_PointCoord - .5) * 2.0; gl_FragColor = vec4(vec3(1.0, .97, .9), (1.0 - r) * uAlpha); }',
    transparent: true, depthWrite: false
  });
  const stars = new THREE.Points(starGeo, starMat); stars.frustumCulled = false; stars.renderOrder = -9; scene.add(stars);

  const sun = new THREE.DirectionalLight('#fff3df', 2.6);
  sun.castShadow = false;
  scene.add(sun, sun.target);
  const moon = new THREE.DirectionalLight('#8fa6d8', 0);
  moon.position.set(-.4, .8, .45); scene.add(moon);
  const hemi = new THREE.HemisphereLight('#dfeef6', '#6d7d66', 1);
  scene.add(hemi);

  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  const envSky = new Sky(); envSky.scale.setScalar(100); envScene.add(envSky);
  let envRT = null, lastEnvKey = '';

  const state = { night: 0, dir: new THREE.Vector3(0, 1, 0), elevation: 1, fog: new THREE.Color(), hours: 12 };

  function update(hours) {
    state.hours = hours;
    const { dir, elevation } = sunPosition(hours);
    state.dir.copy(dir); state.elevation = elevation;
    const deg = elevation * 180 / Math.PI;
    const night = THREE.MathUtils.smoothstep(-deg, -4, 9);       // 0 above 4°, 1 below −9°
    const golden = 1 - THREE.MathUtils.smoothstep(deg, 2, 22);
    state.night = night;
    // the sky shader needs a sun direction; keep a hint of twilight after sunset
    const skyDir = dir.clone(); if (skyDir.y < -.12) skyDir.y = -.12;
    u.sunPosition.value.copy(skyDir);
    u.rayleigh.value = 1.2 + golden * 1.6;
    u.turbidity.value = 5 + golden * 4;
    sun.color.copy(lerpC(C('#fff6e8'), C('#ffb46b'), golden));
    sun.intensity = THREE.MathUtils.smoothstep(deg, -2, 6) * (.85 + .65 * (1 - golden));
    moon.intensity = night * .7;
    hemi.color.copy(lerpC(lerpC(C('#dcecf6'), C('#f1c9a8'), golden), C('#34476b'), night));
    hemi.groundColor.copy(lerpC(C('#6b7964'), C('#0c1013'), night));
    hemi.intensity = .28 + .34 * (1 - night) - golden * .08;
    starMat.uniforms.uAlpha.value = night;
    state.fog.copy(lerpC(lerpC(C('#c5d6de'), C('#e5c3a6'), golden), C('#0b1422'), night));
    scene.environmentIntensity = .15 + .45 * (1 - night);
    renderer.toneMappingExposure = .95 + night * .3;
    // refresh the reflection environment when the sky changed noticeably
    const key = Math.round(hours * 6);
    if (key !== lastEnvKey) {
      lastEnvKey = key;
      const eu = envSky.material.uniforms;
      eu.sunPosition.value.copy(skyDir); eu.rayleigh.value = u.rayleigh.value; eu.turbidity.value = u.turbidity.value;
      eu.mieCoefficient.value = u.mieCoefficient.value; eu.mieDirectionalG.value = u.mieDirectionalG.value;
      const old = envRT; envRT = pmrem.fromScene(envScene, 0, .1, 1000); scene.environment = envRT.texture; old?.dispose();
    }
    return state;
  }

  function follow(camera) {
    sky.position.copy(camera.position); sky.scale.setScalar(camera.far * 1.05);
    stars.position.copy(camera.position); stars.scale.setScalar(camera.far * .9);
  }

  return { sky, sun, moon, hemi, stars, update, follow, state };
}
