import * as THREE from 'three';

// Shared uniforms: one object, referenced by every patched material, so a
// single assignment updates the whole scene.
export const shared = {
  uTime: { value: 0 },
  uNight: { value: 0 },          // 0 day … 1 full night
  uHScale: { value: 1.25 },      // building height exaggeration
  uSelected: { value: -1 },      // selected building id
  uPixelK: { value: .001 },      // world size of one pixel per unit of view depth
  uBounds: { value: new THREE.Vector4() }
};

const NOISE = /* glsl */`
float tzHash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float tzHash3(vec3 p){ return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
float tzNoise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(tzHash(i), tzHash(i + vec2(1, 0)), u.x), mix(tzHash(i + vec2(0, 1)), tzHash(i + vec2(1, 1)), u.x), u.y); }
float tzFbm(vec2 p){ float v = 0.0, a = .5; for(int i = 0; i < 4; i++){ v += a * tzNoise(p); p *= 2.03; a *= .5; } return v; }
`;

/* --------------------------------------------------------------- facades */
// An 8×2 atlas: columns are the eight visual styles (apartment, glass tower,
// factory, house, bitişik nizam apartment, public block, retail, hangar);
// the bottom row is the ground floor and the top row an upper floor.
export const ATLAS_STYLES = 8;
// Mask channels: r = wall tint weight, g = glass (1 clear pane, .5 curtain/blind),
// b = micro-relief height (.5 wall plane, < .35 recess/joint, > .65 frame/sill/rib).
function facadeAtlas() {
  const S = 384, col = document.createElement('canvas'), msk = document.createElement('canvas'), rel = document.createElement('canvas');
  col.width = msk.width = rel.width = S * ATLAS_STYLES; col.height = msk.height = rel.height = S * 2;
  const g = col.getContext('2d'), m = msk.getContext('2d'), b = rel.getContext('2d');
  const WALL = '#ffffff', TINT = 'rgb(255,0,0)', GLASS = 'rgb(0,255,0)', NONE = 'rgb(0,0,0)';
  const H = v => { const k = Math.round(v * 255); return `rgb(${k},${k},${k})`; };
  g.fillStyle = WALL; g.fillRect(0, 0, col.width, col.height);
  m.fillStyle = TINT; m.fillRect(0, 0, msk.width, msk.height);
  b.fillStyle = H(.5); b.fillRect(0, 0, rel.width, rel.height);
  const rect = (ctx, c, x, y, w, h) => { ctx.fillStyle = c; ctx.fillRect(x, y, w, h); };
  // default relief: glass sits recessed, untinted trim protrudes, tinted wall stays flat
  const both = (cx, cy, x, y, w, h, colour, mask, height) => {
    rect(g, colour, cx + x * S, cy + y * S, w * S, h * S); rect(m, mask, cx + x * S, cy + y * S, w * S, h * S);
    rect(b, H(height ?? (mask === GLASS ? .3 : mask === NONE ? .7 : .5)), cx + x * S, cy + y * S, w * S, h * S);
  };
  const relief = (cx, cy, x, y, w, h, height) => rect(b, H(height), cx + x * S, cy + y * S, w * S, h * S);
  const glass = (cx, cy, x, y, w, h, tone = '#3d5560') => {
    both(cx, cy, x, y, w, h, tone, GLASS);
    // reveal: the darker recess band just inside the frame
    relief(cx, cy, x, y, w, .012, .18); relief(cx, cy, x, y, .01, h, .22);
    const grd = g.createLinearGradient(cx + x * S, cy + y * S, cx + (x + w) * S, cy + (y + h) * S);
    grd.addColorStop(0, 'rgba(190,215,225,.35)'); grd.addColorStop(.5, 'rgba(255,255,255,0)'); grd.addColorStop(1, 'rgba(160,190,200,.18)');
    g.fillStyle = grd; g.fillRect(cx + x * S, cy + y * S, w * S, h * S);
  };
  const noise = (cx, cy, alpha) => { for (let i = 0; i < 2000; i++) { g.fillStyle = `rgba(0,0,0,${Math.random() * alpha})`; g.fillRect(cx + Math.random() * S, cy + Math.random() * S, 2, 2); } };
  for (let s = 0; s < ATLAS_STYLES; s++) for (let row = 0; row < 2; row++) {
    const cx = s * S, cy = row * S, ground = row === 1;
    noise(cx, cy, .05);
    if (s === 0) { // apartment: window with frame, sill and a balcony band
      if (!ground) {
        rect(g, 'rgba(0,0,0,.06)', cx, cy + .9 * S, S, .1 * S); // floor slab line
        relief(cx, cy, 0, .985, 1, .015, .3);                       // slab groove
        both(cx, cy, .2, .16, .6, .56, '#f4f2ec', NONE);        // frame
        glass(cx, cy, .24, .2, .52, .5);
        both(cx, cy, .495, .2, .01, .5, '#e9e7e0', NONE);         // mullion
        both(cx, cy, .17, .72, .66, .04, '#d9d6cc', NONE, .85);   // sill
        both(cx, cy, .1, .76, .8, .03, '#c9c6bd', NONE);          // balcony slab
        for (let i = 0; i <= 12; i++) both(cx, cy, .1 + i * .8 / 12, .62, .008, .14, '#8d8f8c', NONE); // railing
        both(cx, cy, .1, .62, .8, .012, '#8d8f8c', NONE);
      } else { // shop front with awning
        both(cx, cy, .04, .12, .92, .82, '#2f3436', NONE);
        glass(cx, cy, .07, .3, .86, .62, '#45606a');
        both(cx, cy, .04, .12, .92, .16, '#9a4a3c', NONE);      // awning / sign band, recoloured by the shader
        both(cx, cy, .48, .3, .04, .64, '#2f3436', NONE);
      }
    } else if (s === 1) { // curtain wall
      rect(g, '#d8dcdc', cx, cy, S, S); rect(m, NONE, cx, cy, S, S);
      both(cx, cy, 0, 0, 1, .14, '#b9bfc0', TINT);
      glass(cx, cy, .02, .16, .96, .82, '#4b6672');
      both(cx, cy, .49, .16, .02, .82, '#9aa3a6', NONE);
      if (ground) { glass(cx, cy, .04, .1, .92, .9, '#55707b'); both(cx, cy, .3, .1, .4, .02, '#7f8a8d', NONE); }
    } else if (s === 2) { // industrial cladding with a clerestory strip
      for (let i = 0; i < 32; i++) { both(cx, cy, i / 32, 0, .012, 1, 'rgba(0,0,0,.14)', 'rgb(200,0,0)', .25); relief(cx, cy, i / 32 + .016, 0, .01, 1, .75); }
      if (!ground) { glass(cx, cy, .04, .1, .92, .14, '#53656b'); both(cx, cy, 0, .3, 1, .015, 'rgba(0,0,0,.2)', TINT); }
      else { both(cx, cy, .12, .22, .76, .78, '#8f9596', NONE); for (let i = 0; i < 18; i++) both(cx, cy, .12, .24 + i * .042, .76, .008, '#6f7576', NONE); }
    } else if (s === 4) { // 1990s bitişik nizam apartment: mosaic tile cladding, recessed cam balkon
      for (let y = 0; y < 1; y += 1 / 24) for (let x = 0; x < 1; x += 1 / 24) {
        const k = Math.random(); rect(g, `rgba(${k < .5 ? '120,60,40' : '255,250,240'},${.05 + k * .07})`, cx + x * S, cy + y * S, S / 24 - 1, S / 24 - 1);
        rect(b, H(.44), cx + x * S + S / 24 - 2, cy + y * S, 2, S / 24); rect(b, H(.44), cx + x * S, cy + y * S + S / 24 - 2, S / 24, 2); // grout
      }
      if (!ground) {
        rect(g, 'rgba(0,0,0,.08)', cx, cy + .9 * S, S, .1 * S);
        both(cx, cy, .06, .1, .88, .64, '#5a5d5c', NONE);            // recess shadow
        glass(cx, cy, .08, .12, .84, .44, '#4a6068');                 // folding glass panes
        for (let i = 0; i <= 6; i++) both(cx, cy, .08 + i * .84 / 6 - .006, .12, .012, .44, '#d6d8d4', NONE);
        both(cx, cy, .06, .56, .88, .2, '#e8e2d6', TINT);             // parapet band
        both(cx, cy, .06, .76, .88, .025, '#bdb8ad', NONE);           // slab edge
      } else {
        both(cx, cy, .04, .12, .92, .82, '#2b2f31', NONE);
        glass(cx, cy, .07, .3, .86, .62, '#4b636c');
        both(cx, cy, .04, .12, .92, .16, '#9a4a3c', NONE);            // awning band (recoloured)
        both(cx, cy, .36, .3, .03, .64, '#2b2f31', NONE); both(cx, cy, .66, .3, .03, .64, '#2b2f31', NONE);
      }
    } else if (s === 5) { // public / school block: wide multi-mullion windows in a brick frame
      if (!ground) {
        rect(g, 'rgba(0,0,0,.05)', cx, cy + .88 * S, S, .12 * S);
        both(cx, cy, .08, .16, .84, .58, '#b0674c', NONE);            // brick surround
        glass(cx, cy, .11, .19, .78, .52, '#3f5862');
        for (let i = 1; i < 4; i++) both(cx, cy, .11 + i * .78 / 4 - .006, .19, .012, .52, '#eeece6', NONE);
        both(cx, cy, .11, .36, .78, .012, '#eeece6', NONE);           // transom
        both(cx, cy, .06, .74, .88, .05, '#d9d3c4', NONE);            // sill band
      } else {
        both(cx, cy, .06, .14, .88, .1, '#d9d3c4', NONE);             // entrance canopy edge
        both(cx, cy, .1, .26, .8, .74, '#3a4245', NONE);
        glass(cx, cy, .13, .29, .74, .71, '#4a636c');
        for (let i = 1; i < 4; i++) both(cx, cy, .13 + i * .74 / 4 - .007, .29, .014, .71, '#c9cbc8', NONE);
      }
    } else if (s === 6) { // retail: composite aluminium panels, strip window, glass vitrine
      for (let i = 0; i <= 4; i++) both(cx, cy, 0, i / 4, 1, .008, 'rgba(0,0,0,.18)', 'rgb(160,0,0)');
      for (let i = 0; i <= 2; i++) both(cx, cy, i / 2, 0, .008, 1, 'rgba(0,0,0,.18)', 'rgb(160,0,0)');
      if (!ground) { glass(cx, cy, 0, .34, 1, .2, '#4d6670'); both(cx, cy, 0, .34, 1, .012, '#9aa3a6', NONE); }
      else {
        both(cx, cy, 0, .06, 1, .2, '#9a4a3c', NONE);                 // fascia sign band (recoloured)
        glass(cx, cy, .02, .28, .96, .72, '#5a7680');
        both(cx, cy, .49, .28, .02, .72, '#8e979a', NONE);
      }
    } else if (s === 7) { // shipyard hangar / logistics: tall steel siding, sliding bay door
      for (let i = 0; i < 24; i++) { both(cx, cy, i / 24, 0, .016, 1, 'rgba(0,0,0,.16)', 'rgb(190,0,0)', .22); relief(cx, cy, i / 24 + .02, 0, .016, 1, .78); }
      for (let i = 0; i < 40; i++) rect(g, `rgba(110,70,40,${Math.random() * .08})`, cx + Math.random() * S, cy + Math.random() * S, 3, 10 + Math.random() * 30); // rust streaks
      if (!ground) { glass(cx, cy, 0, .08, 1, .1, '#56676c'); both(cx, cy, 0, .2, 1, .012, 'rgba(0,0,0,.25)', TINT); }
      else {
        both(cx, cy, .08, .12, .84, .88, '#7c8586', NONE);
        for (let i = 0; i < 14; i++) both(cx, cy, .08 + i * .06, .12, .006, .88, '#646c6d', NONE);
        for (let i = 0; i < 12; i++) both(cx, cy, .08 + i * .07, .9, .035, .1, i % 2 ? '#1d1d1b' : '#e2b62a', NONE); // safety stripes
      }
    } else { // small house: shuttered window or a door
      if (!ground) {
        both(cx, cy, .3, .22, .4, .48, '#f2f0ea', NONE); glass(cx, cy, .33, .25, .34, .42, '#3b4d55');
        both(cx, cy, .2, .22, .09, .48, '#6e5a46', NONE); both(cx, cy, .71, .22, .09, .48, '#6e5a46', NONE);
        both(cx, cy, .27, .7, .46, .035, '#d4d0c6', NONE);
      } else {
        both(cx, cy, .34, .3, .32, .7, '#6a4f3a', NONE); glass(cx, cy, .39, .36, .22, .2, '#3b4d55');
        both(cx, cy, .3, .26, .4, .04, '#d4d0c6', NONE);
      }
    }
  }
  const mk = (c, srgb) => { const t = new THREE.CanvasTexture(c); t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.anisotropy = 8; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; return t; };
  // fold the relief canvas into the mask's blue channel
  const md = m.getImageData(0, 0, msk.width, msk.height), rd = b.getImageData(0, 0, rel.width, rel.height).data;
  for (let i = 0; i < rd.length; i += 4) md.data[i + 2] = rd[i];
  m.putImageData(md, 0, 0);
  return { color: mk(col, true), mask: mk(msk, false) };
}

/* ------------------------------------------------------------- buildings */
const BUILDING_VERT_PARS = /* glsl */`
attribute vec4 info;
uniform float uHScale;
varying vec4 vInfo;
varying vec2 vFacade;
varying vec3 vWPos;
varying vec3 vWNorm;
`;
const BUILDING_BEGIN = /* glsl */`
vec3 transformed = vec3(position);
transformed.y += info.z * (uHScale - 1.0);
vInfo = info; vFacade = uv;
vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
vWNorm = normalize(mat3(modelMatrix) * normal);
`;

// Analytical interior mapping: a ray-box room behind every window bay.
// p = entry point in the bay (x, y in 0..1), d = view ray in room space (z into the room).
const INTERIOR = /* glsl */`
vec3 tzRoom(vec2 p, vec3 d, float depth, float rs, float shop, out float lamp) {
  vec3 o = vec3(p, 0.0);
  float tx = ((d.x > 0.0 ? 1.0 : 0.0) - o.x) / (abs(d.x) > 1e-4 ? d.x : 1e-4);
  float ty = ((d.y > 0.0 ? 1.0 : 0.0) - o.y) / (abs(d.y) > 1e-4 ? d.y : 1e-4);
  float tz = depth / max(d.z, 1e-4);
  float t = min(min(tx, ty), tz);
  vec3 q = o + d * t;
  vec3 wallC = mix(vec3(.78, .72, .62), vec3(.86, .85, .8), step(.4, rs));
  wallC = mix(wallC, vec3(.62, .7, .74), step(.85, rs));            // the odd pale-blue room
  if (shop > .5) wallC = vec3(.9, .9, .88);
  vec3 floorC = mix(vec3(.42, .28, .18), vec3(.55, .5, .46), step(.6, fract(rs * 7.1)));
  vec3 col; lamp = 0.0;
  if (t == tz) {
    col = wallC * .92;
    // furniture silhouettes against the back wall: sofa / cabinet / shelves
    float f = fract(rs * 13.3);
    if (q.y < .3 && abs(q.x - (.25 + .5 * f)) < .22) col = mix(vec3(.25, .22, .2), vec3(.45, .35, .3), fract(rs * 3.7));
    if (shop > .5 && q.y > .2 && q.y < .75 && fract(q.x * 5.0) < .8) col = mix(vec3(.7, .4, .3), vec3(.3, .45, .6), fract(floor(q.x * 5.0) * .37 + rs)); // shelves
    if (q.y > .45 && q.y < .7 && abs(q.x - (.7 - .4 * f)) < .1 && shop < .5) col = vec3(.35, .3, .26);                       // picture frame
  } else if (t == ty) {
    if (d.y > 0.0) {
      col = vec3(.9, .89, .86);
      float r = length(vec2(q.x - .5, (q.z - depth * .5) / depth));
      lamp = 1.0 - smoothstep(.05, .12, r);
    } else col = floorC;
  } else col = wallC * .82;                                            // side partitions
  // depth cue: rooms darken toward the back
  return col * mix(1.0, .55, clamp(q.z / depth, 0.0, 1.0));
}
`;

export function buildingMaterial() {
  const atlas = facadeAtlas();
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .88, metalness: 0, envMapIntensity: .55 });
  mat.userData.atlas = atlas; // handy for inspecting the generated textures
  mat.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, { uFacade: { value: atlas.color }, uMask: { value: atlas.mask }, uNight: shared.uNight, uHScale: shared.uHScale, uSelected: shared.uSelected, uTime: shared.uTime });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n' + BUILDING_VERT_PARS)
      .replace('#include <begin_vertex>', BUILDING_BEGIN);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
uniform sampler2D uFacade; uniform sampler2D uMask; uniform float uNight; uniform float uSelected; uniform float uTime;
varying vec4 vInfo; varying vec2 vFacade; varying vec3 vWPos; varying vec3 vWNorm;
${NOISE}
${INTERIOR}`)
      .replace('#include <color_fragment>', /* glsl */`
float tzRough = .9; vec3 tzGlow = vec3(0.0); float tzGlass = 0.0, tzRel = .5;
{
  // info.y: style + wallRole * 16 on walls, 100 + roof style on roofs; info.w: floors + seed
  // round first: interpolated varyings can land a hair below the packed integer
  // info.w = floors + (archetype + seed) / 8
  float iy = floor(vInfo.y + .5), id = floor(vInfo.x + .5), floors = floor(vInfo.w), aw = fract(vInfo.w) * 8.0;
  float arche = floor(aw), seed = fract(aw);
  float style = mod(iy, 16.0), wallRole = floor(iy / 16.0), rStyle = iy - 100.0;
  vec3 tint = pow(vColor, vec3(2.2)); // vertex colours are stored as sRGB bytes
  vec3 albedo;
  if (vInfo.y < 99.5) {
    float fl = floor(vFacade.y), bay = floor(vFacade.x);
    vec2 cell = fract(vFacade);
    float h = tzHash3(vec3(bay, fl, id));
    float row = 1.0;
    bool coastal = arche > .5 && arche < 1.5;
    bool shop = style < 1.5 || (style > 3.5 && style < 4.5) || (style > 5.5 && style < 6.5) || coastal;
    // coastal high streets: houses get the apartment shopfront column on the street front
    float aStyle = coastal && style > 2.5 && style < 3.5 && fl < .5 && wallRole < .5 ? 0.0 : style;
    if (fl < 0.5 && wallRole < 1.5) {
      // ground floor: shops and vitrines only on the street front, doors / bay doors elsewhere
      if (wallRole < 0.5 && shop) row = 0.0;
      else if (h < (style > 2.5 && !shop ? .35 : .22) * (wallRole < 0.5 ? 1.0 : .5)) row = 0.0;
    }
    // rear and courtyard walls: narrower utility / kitchen windows
    float squeeze = wallRole > 1.5 && wallRole < 2.5 ? 1.6 : 1.0, cx = .5 + (cell.x - .5) * squeeze;
    bool margin = cx < .015 || cx > .985;
    cx = clamp(cx, .015, .985);
    vec2 auv = vec2((aStyle + cx) * .125, (row == 0.0 ? 0.0 : .5) + cell.y * .5);
    vec2 dx = dFdx(vFacade) * vec2(.125 * squeeze, .5), dy = dFdy(vFacade) * vec2(.125 * squeeze, .5);
    vec3 tex = textureGrad(uFacade, auv, dx, dy).rgb;
    vec3 msk = textureGrad(uMask, auv, dx, dy).rgb;
    if (margin) { tex = vec3(.97); msk = vec3(1.0, 0.0, .5); } // plain wall beside the narrow window
    if (wallRole > 3.5) {
      // 3D balcony stack: slab edge, parapet or railing, then the open recess or cam balkon glazing per floor
      float cy = fract(vFacade.y);
      if (abs(vWNorm.y) > .5) { tex = vec3(.82); msk = vec3(.3, 0.0, .5); }                       // slab soffit / top
      else if (cy < .07) { tex = vec3(.88); msk = vec3(.15, 0.0, .78); }                          // slab edge
      else if (cy < .38) {
        if (style > 3.5 || seed > .55) { tex = vec3(.96); msk = vec3(1.0, 0.0, .55); }            // solid parapet
        else {
          float bar = step(.72, fract(vFacade.x * 14.0)) + step(.33, cy);
          tex = mix(vec3(.13, .13, .14), vec3(.36, .37, .38), clamp(bar, 0.0, 1.0)); msk = vec3(0.0, 0.0, bar > .5 ? .75 : .3); // railing, dark gap
        }
      } else if (style > 3.5) {
        float fr = clamp(step(.93, fract(vFacade.x * 3.0)) + step(.95, cy), 0.0, 1.0);          // folding cam balkon panes
        tex = mix(vec3(.3, .4, .45), vec3(.86), fr); msk = vec3(0.0, 1.0 - fr, fr > .5 ? .72 : .3);
      } else { tex = vec3(.2, .19, .18); msk = vec3(0.0, 0.0, .3); }                              // shaded open recess
    } else if (vFacade.y > floors + .02 && wallRole < 3.5) {
      // attic band and parapet above the last floor: plain plaster with a coping line at the very top
      tex = vec3(.94); msk = vec3(1.0, 0.0, .5);
    } else if (wallRole > 2.5) {
      // blind party wall (sağır cephe): plain plaster with floor-slab lines, no openings
      float sfw = fwidth(vFacade.y), slab = 1.0 - smoothstep(.025, .025 + sfw * 1.5, abs(fract(vFacade.y + .5) - .5));
      tex = vec3(.9) * (1.0 - .08 * slab * clamp(1.0 - sfw * 2.0, 0.0, 1.0));
      msk = vec3(1.0, 0.0, 0.0);
    }
    // coastal apartments: painted timber shutters beside the upper windows
    if (coastal && row > .5 && style < .5 && wallRole < 1.5 && vFacade.y > 1.0 && vFacade.y < floors + .02) {
      float sh = step(.1, cx) * step(cx, .19) + step(.81, cx) * step(cx, .9);
      if (sh > .5 && cell.y > .28 && cell.y < .84) {
        vec3 shc = fract(seed * 5.7) < .4 ? vec3(.3, .42, .3) : fract(seed * 5.7) < .7 ? vec3(.24, .4, .44) : vec3(.42, .3, .22);
        tex = shc * (.85 + .15 * step(.5, fract(cell.y * 14.0))); msk = vec3(0.0, 0.0, .7);
      }
    }
    // shop awnings take a per-shop colour; coastal awnings are striped canvas
    vec3 awn = mix(vec3(.62,.2,.16), mix(vec3(.16,.32,.5), vec3(.75,.58,.2), step(.5, fract(h * 7.0))), step(.4, h));
    if (coastal) awn = mix(awn, vec3(.93, .9, .82), step(.5, fract(cell.x * 7.0)));
    bool awning = aStyle < 0.5 || (style > 3.5 && style < 4.5);
    if (row == 0.0 && wallRole < 0.5 && awning && cell.y > .72 && cell.y < .88 && cell.x > .04 && cell.x < .96) tex = mix(tex, awn, .85);
    if (row == 0.0 && wallRole < 0.5 && style > 5.5 && style < 6.5 && cell.y > .74 && cell.y < .94) tex = mix(tex, awn * 1.2, .8); // retail fascia
    albedo = mix(tex, tex * tint, msk.r);
    float ao = mix(.72, 1.0, smoothstep(-.2, 1.1, vFacade.y));
    if (vFacade.y < 0.0) {
      // subasman: level travertine / concrete block plinth absorbing the slope
      msk = vec3(1.0, 0.0, .5);                                            // solid: no glass, flat relief
      vec2 pm = vec2(vFacade.x * 3.1, vFacade.y * 3.05);                  // metres
      float course = floor(pm.y / .45), jx = fract(pm.x / .9 + .5 * mod(course, 2.0)), jy = fract(pm.y / .45);
      float fwm = max(fwidth(pm.y), fwidth(pm.x)) * 1.2;
      float joint = max(1.0 - smoothstep(.0, .02 + fwm, min(jx, 1.0 - jx) * .9), 1.0 - smoothstep(.0, .02 + fwm, min(jy, 1.0 - jy) * .45));
      vec3 stone = mix(vec3(.74, .69, .6), tint * .78, step(.5, fract(seed * 7.3)));   // travertine or tinted concrete
      stone *= .9 + .16 * tzHash(vec2(floor(pm.x / .9 + .5 * mod(course, 2.0)), course) + id);
      albedo = mix(stone, stone * .55, joint * clamp(1.0 - fwm * 4.0, 0.0, 1.0));
      // drip-edge ledge: a 15 cm lit lip right under the ground floor with a shadow line beneath
      float ly = -vFacade.y * 3.05;
      albedo = mix(albedo, vec3(.86, .84, .8), 1.0 - smoothstep(.13, .15 + fwm, ly));
      albedo *= mix(1.0, .6, smoothstep(.15, .17 + fwm, ly) * (1.0 - smoothstep(.17, .32, ly)));
      // ground contact: the plinth reaches 1.2 m below the terrain at its lowest corner
      float gm = vInfo.z * 1000.0;
      ao *= mix(.6, 1.0, smoothstep(1.2, 2.1, gm));
      // soil splashback and a little moss along the foot of the plinth
      float splash = (1.0 - smoothstep(1.1, 1.9, gm)) * (.55 + .45 * tzNoise(vec2(vFacade.x * 9.0, gm * 3.0) + id));
      albedo = mix(albedo, albedo * vec3(.62, .58, .48), splash * .7);
      albedo = mix(albedo, vec3(.24, .3, .18), splash * .25 * step(.6, tzNoise(vec2(vFacade.x * 4.0 + id, 1.0))));
    } else {
      // splashback dirt on the lowest half metre of the ground floor
      float gy0 = vFacade.y * 3.05;
      albedo *= mix(.82, 1.0, smoothstep(.0, .55, gy0) + (1.0 - msk.r));
    }
    // ground-contact AO across the plinth and the bottom of the ground floor
    ao *= mix(.8, 1.0, smoothstep(-.35, .25, vFacade.y));
    // under-eave / cornice shadow on the top quarter of the highest floor
    float topV = floors + .2;
    ao *= mix(.78, 1.0, smoothstep(0.0, .35, topV - vFacade.y));
    albedo *= ao;
    // vertical rain streaks washing down from window sills and from the cornice
    if (vFacade.y > .6 && wallRole < 2.5) {
      float sx = vFacade.x * 14.0, streakN = tzNoise(vec2(sx, id)) * tzNoise(vec2(sx * 2.3, id + 3.0));
      float fadeS = clamp(1.0 - fwidth(sx) * .6, 0.0, 1.0);
      float underSill = step(cell.y, .25) * smoothstep(.0, .25, cell.y) * step(.18, cell.x) * step(cell.x, .82) * step(.5, row); // strongest right under the sill
      float underCornice = 1.0 - smoothstep(.0, .9, topV - .05 - vFacade.y);
      float streak = smoothstep(.15, .55, streakN) * max(underSill, underCornice) * fadeS;
      albedo *= 1.0 - .22 * streak * msk.r;
    }
    // subtle weathering
    albedo *= .93 + .1 * tzNoise(vec2(vFacade.x * 1.7 + id, vFacade.y * .8));
    tzGlass = msk.g; tzRel = msk.b;
    tzRough = mix(.92, .12, tzGlass);
    // lit windows after dusk
    float lit = step(h, mix(.12, .4, fract(seed * 13.7)) * (fl < .5 ? 1.4 : 1.0));
    vec3 warm = mix(vec3(1.0, .72, .42), vec3(1.0, .88, .7), fract(h * 31.0));
    if (fract(h * 17.0) < .12) warm = vec3(.72, .85, 1.0);
    float glowK = 1.0;
    // interior rooms behind the glass, faded out beyond 1.8 km
    vec3 toFrag = vWPos - cameraPosition; float camDist = length(toFrag);
    float near = (1.0 - smoothstep(1.2, 1.8, camDist)) * step(.25, tzGlass);
    vec3 N = normalize(vWNorm), T = normalize(cross(vec3(0.0, 1.0, 0.0), N));
    // orient T with the facade's u axis so side walls parallax the right way (derivatives taken in uniform flow)
    float su = dot(dFdx(vWPos), T) * dFdx(vFacade.x) + dot(dFdy(vWPos), T) * dFdy(vFacade.x);
    if (su < 0.0) T = -T;
    if (near > 0.0) {
      vec3 V = toFrag / camDist;
      vec3 d = normalize(vec3(dot(V, T), V.y, -dot(V, N)));
      float rs = tzHash3(vec3(bay, fl, id + 7.0)), lamp;
      float shop = row == 0.0 && wallRole < .5 ? 1.0 : 0.0;
      vec3 room = tzRoom(cell, d, shop > .5 ? 1.4 : .65, rs, shop, lamp);
      // curtains or blinds just behind the pane
      float cur = fract(rs * 5.3);
      if (shop < .5 && cur < .45 && abs(cell.x - .5) > .2) room = mix(room, mix(vec3(.85, .8, .7), vec3(.6, .45, .38), step(.25, cur)), .85);
      else if (shop < .5 && cur > .8 && cell.y > .55) room = mix(room, vec3(.82, .82, .78) * (.85 + .15 * step(.5, fract(cell.y * 18.0))), .9);
      float fres = pow(1.0 - max(0.0, dot(-V, N)), 3.0);
      vec3 inside = room * mix(.32, .06, uNight);                  // seen from outside: dim by day
      albedo = mix(albedo, mix(inside, albedo, fres), near * tzGlass * .9);
      // at night lit rooms show their ceiling lamp, walls and furniture
      glowK = mix(1.0, (.55 + 1.6 * lamp) * dot(room, vec3(.4)) * 1.6, near);
    }
    tzGlow = warm * lit * smoothstep(.3, .9, tzGlass) * uNight * (.45 + .5 * fract(h * 5.3)) * glowK;
    albedo = mix(albedo, albedo * .45, tzGlass * uNight);
  } else {
    // roofs
    vec2 p = vFacade; style = rStyle;
    if (style > 18.5) {
      // rooftop micro-architecture (uv in metres)
      if (style < 19.5) { albedo = tint * .92 * (.9 + .12 * tzNoise(p * 1.3 + id)); tzRough = .9; }                       // machine room
      else if (style < 20.5) {                                                                                          // solar collector
        float g = max(step(.9, fract(p.x * 2.5)), step(.92, fract(p.y * 1.2)));
        albedo = mix(vec3(.05, .08, .16), vec3(.55, .57, .6), g * clamp(1.0 - fwidth(p.x) * 3.0, 0.0, 1.0)); tzRough = .22;
      } else if (style < 21.5) { albedo = vec3(.8, .81, .8) * (.9 + .1 * tzNoise(p * 4.0)); tzRough = .4; }               // tank / HVAC
      else if (style < 22.5) { albedo = vec3(.2, .27, .3); tzRough = .12; }                                              // skylight glazing
      else {                                                                                                            // brick chimney
        float course = floor(p.y / .075), j = fract(p.x / .22 + .5 * mod(course, 2.0));
        float mortar = max(step(.88, fract(p.y / .075)), step(.92, j)) * clamp(1.0 - fwidth(p.y) * 8.0, 0.0, 1.0);
        albedo = mix(vec3(.45, .2, .14) * (.85 + .3 * tzHash(vec2(floor(p.x / .22), course))), vec3(.7, .67, .6), mortar);
        tzRough = .9;
      }
    } else if (style > 16.5 && style < 17.5) { albedo = tint * .62 * (.9 + .1 * tzNoise(p * 2.0)); tzRough = .9; }          // eave soffit / fascia, in shade
    else if (style > 17.5 && style < 18.5) { albedo = mix(tint, vec3(.8, .79, .76), .6) * (.88 + .14 * tzNoise(p * 3.0 + id)); tzRough = .92; } // parapet coping
    else if (style > 13.5 && style < 14.5) { albedo = tint * (.8 + .2 * vFacade.y / 6.0); tzRough = .45; }       // dome
    else if (style > 14.5 && style < 15.5) { albedo = tint * (.9 + .1 * step(.5, fract(vFacade.y * 6.0))); tzRough = .7; } // minaret
    else if ((style > 10.5 && style < 12.5) || (style > 15.5 && style < 16.5)) {
      // clay tiles: rows along the slope with staggered joints
      float rowi = floor(p.y / .34);
      float rr = fract(p.y / .34), cc = fract(p.x / .26 + .5 * mod(rowi, 2.0));
      float shade = .78 + .22 * smoothstep(0.0, .85, rr) - .12 * smoothstep(.9, 1.0, cc);
      float fade = clamp(1.0 - length(fwidth(p)) * 1.5, 0.0, 1.0);
      albedo = tint * mix(.9, shade, fade) * (.88 + .24 * tzNoise(p * .35 + id));
      tzRough = .75;
    } else if (style > 12.5) {
      // metal sheet roof with ribs
      float rib = smoothstep(.0, .08, abs(fract(p.x * 1.0) - .5) - .38);
      float fade = clamp(1.0 - fwidth(p.x) * 1.5, 0.0, 1.0);
      albedo = tint * (1.0 - .12 * rib * fade) * (.95 + .08 * tzNoise(p * .05));
      tzRough = .55;
    } else {
      // flat concrete: gravel noise, water tanks and solar heaters
      albedo = tint * (.86 + .2 * tzFbm(p * .25 + id));
      vec2 q = floor(p / 4.0); float hq = tzHash(q + id);
      vec2 f = fract(p / 4.0);
      if (hq < .07 && f.x > .2 && f.x < .8 && f.y > .3 && f.y < .7) albedo = vec3(.28, .33, .4);           // solar heater
      else if (hq > .96 && length(f - .5) < .22) albedo = vec3(.86, .86, .84);                              // water tank
      tzRough = .95;
    }
  }
  if (abs(vInfo.x - uSelected) < .5) { albedo = mix(albedo, vec3(1.0, .74, .35), .3); tzGlow += vec3(.12, .07, .02); }
  diffuseColor.rgb = albedo;
}
`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = tzRough;')
      .replace('#include <normal_fragment_maps>', /* glsl */`
#include <normal_fragment_maps>
{
  // screen-space bump from the atlas relief channel (frames, sills, ribs, joints), faded with distance
  float fade = clamp(1.0 - length(fwidth(vFacade)) * 12.0, 0.0, 1.0); // gone once a bay is < ~12 px
  float hgt = (tzRel - .5) * .00008 * fade;                 // ±4 cm in km
  vec2 dH = vec2(dFdx(hgt), dFdy(hgt));
  vec3 sx = dFdx(-vViewPosition), sy = dFdy(-vViewPosition);
  vec3 r1 = cross(sy, normal), r2 = cross(normal, sx);
  float det = dot(sx, r1) * faceDirection;
  if (abs(det) > 1e-20) normal = normalize(abs(det) * normal - sign(det) * (dH.x * r1 + dH.y * r2));
}`)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += tzGlow;');
  };
  mat.customProgramCacheKey = () => 'tz-building';
  return mat;
}

export function buildingDepthMaterial() {
  const mat = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  mat.onBeforeCompile = shader => {
    shader.uniforms.uHScale = shared.uHScale;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 info;\nuniform float uHScale;')
      .replace('#include <begin_vertex>', 'vec3 transformed = vec3(position);\ntransformed.y += info.z * (uHScale - 1.0);');
  };
  mat.customProgramCacheKey = () => 'tz-building-depth';
  return mat;
}

/** Encodes the building id as a colour for GPU picking. */
export function buildingPickMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uHScale: shared.uHScale },
    vertexShader: `attribute vec4 info; uniform float uHScale; varying float vId;
      void main(){ vec3 p = position; p.y += info.z * (uHScale - 1.0); vId = info.x; gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0); }`,
    fragmentShader: `varying float vId;
      void main(){ float id = floor(vId + .5) + 1.0; gl_FragColor = vec4(mod(id, 256.0) / 255.0, mod(floor(id / 256.0), 256.0) / 255.0, floor(id / 65536.0) / 255.0, 1.0); }`
  });
}

/* --------------------------------------------------------------- terrain */
export function terrainMaterial(ground, waterMask, landTint) {
  const mat = new THREE.MeshStandardMaterial({ map: ground, roughness: 1, metalness: 0, envMapIntensity: 1 });
  mat.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, { uWater: { value: waterMask }, uLand: { value: landTint }, uTime: shared.uTime, uNight: shared.uNight, uBounds: shared.uBounds });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vTWorld;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvTWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
uniform sampler2D uWater; uniform sampler2D uLand; uniform float uTime; uniform float uNight; uniform vec4 uBounds;
varying vec3 vTWorld;
${NOISE}
vec2 tzWave(vec2 p, float t){
  // sum of travelling waves: returns the slope of the surface
  vec2 s = vec2(0.0);
  s += vec2(.6, .8) * cos(dot(p, vec2(.6, .8)) * 1.6 + t * 1.3) * .06;
  s += vec2(-.7, .7) * cos(dot(p, vec2(-.7, .7)) * 2.9 + t * 1.9) * .04;
  s += vec2(.95, -.3) * cos(dot(p, vec2(.95, -.3)) * 5.1 + t * 2.6) * .025;
  s += vec2(tzNoise(p * .9 + t * .15) - .5, tzNoise(p * .9 - t * .13 + 7.0) - .5) * .12;
  return s;
}`)
      .replace('#include <map_fragment>', /* glsl */`
#include <map_fragment>
vec2 tzUv = vMapUv;
vec3 wm = texture2D(uWater, clamp(tzUv, vec2(.0005), vec2(.9995))).rgb;
float tzW = smoothstep(.25, .75, wm.r);
float tzOut = max(max(uBounds.x - vTWorld.x, vTWorld.x - uBounds.z), max(uBounds.y - vTWorld.z, vTWorld.z - uBounds.w));
{
  vec4 lt = texture2D(uLand, tzUv);
  vec3 g = diffuseColor.rgb;
  // land-use tint and close-range detail
  g = mix(g, lt.rgb, lt.a * .42);
  float d = tzFbm(vTWorld.xz * 260.0);
  float d2 = tzNoise(vTWorld.xz * 1400.0);
  g *= .86 + .2 * d + .08 * d2;
  // beyond the mosaic: fade the smeared border to a neutral landscape
  float outside = smoothstep(-.3, .8, tzOut);
  g = mix(g, vec3(.17, .19, .15) * (.85 + .3 * d), outside);
  vec3 deep = vec3(.025, .1, .14), shallow = vec3(.08, .27, .29);
  vec3 water = mix(shallow, deep, smoothstep(.0, .55, wm.g));
  water = mix(water, vec3(.12, .22, .2), wm.b * .6); // ponds and wetlands
  diffuseColor.rgb = mix(g, water, tzW);
}
`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(1.0, .07, tzW);')
      .replace('#include <normal_fragment_maps>', /* glsl */`
#include <normal_fragment_maps>
if (tzW > .01) {
  vec2 p = vTWorld.xz * 70.0;
  vec2 s = tzWave(p, uTime) + tzWave(p * 3.7, uTime * 1.6) * .45;
  float fade = 1.0 - smoothstep(.5, 4.0, length(fwidth(p)));
  vec3 wn = normalize(vec3(-s.x * fade, 1.0, -s.y * fade));
  vec3 vn = normalize((viewMatrix * vec4(wn, 0.0)).xyz);
  normal = normalize(mix(normal, vn, tzW));
  // shore foam
  float shore = 1.0 - smoothstep(.0, .07, wm.g);
  float foam = shore * tzW * smoothstep(.35, .85, tzNoise(vTWorld.xz * 900.0 + vec2(uTime * .4, 0.0)) * (.6 + .4 * sin(uTime * 1.2 + wm.g * 90.0)));
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.82, .88, .86), foam * .45 * (1.0 - wm.b) * smoothstep(.5, .9, wm.r));
}
`);
  };
  mat.customProgramCacheKey = () => 'tz-terrain';
  return mat;
}

/* ----------------------------------------------------------------- roads */
export function roadMaterial() {
  const mat = new THREE.MeshStandardMaterial({ roughness: .85, metalness: 0, side: THREE.DoubleSide, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4, envMapIntensity: .12 });
  mat.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, { uPixelK: shared.uPixelK, uNight: shared.uNight, uTime: shared.uTime });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
attribute vec2 across; attribute float kind; uniform float uPixelK;
varying vec2 vRoad; varying float vKind; varying float vWiden;`)
      .replace('#include <begin_vertex>', /* glsl */`
vec3 transformed = vec3(position);
{
  vec4 vp = modelViewMatrix * vec4(position, 1.0);
  float px = -vp.z * uPixelK;
  float hw = length(across);
  float minPx = kind > 7.5 ? 1.4 : kind > 6.5 ? .7 : kind > 4.5 ? 1.1 : kind > 3.5 ? 1.6 : kind > 2.5 ? 1.25 : kind > 1.5 ? .9 : kind > .5 ? .5 : 0.0;
  float widen = max(1.0, px * minPx / max(hw, 1e-6));
  transformed.xz += across * uv.x * widen;
  transformed.y += min(px * .5, .004) * step(.5, widen - 1.0);
  vRoad = uv; vKind = kind; vWiden = widen;
}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
uniform float uNight; uniform float uTime;
varying vec2 vRoad; varying float vKind; varying float vWiden;
${NOISE}
float tzLine(float x, float c, float w){ float fw = fwidth(x) * 1.2; return 1.0 - smoothstep(w - fw, w + fw, abs(x - c)); }
float tzDash(float y, float on, float period){ float fw = fwidth(y); float f = fract(y / period) * period; return smoothstep(0.0, fw, f) * (1.0 - smoothstep(on - fw, on, f)); }`)
      .replace('#include <color_fragment>', /* glsl */`
float tzRough = .85; vec3 tzGlow = vec3(0.0);
{
  float k = vKind, x = vRoad.x, y = vRoad.y;
  float far = clamp(1.0 - fwidth(y) * .9, 0.0, 1.0) * step(vWiden, 1.05); // markings only when resolvable
  vec3 c;
  float edge = smoothstep(1.0, .86, abs(x));
  if (k < .5) { c = vec3(.42, .4, .37) * (.9 + .15 * tzNoise(vec2(x * 3.0, y * .7))); }
  else if (k > 6.5 && k < 7.5) { c = vec3(.08, .2, .22); tzRough = .15; }
  else if (k > 4.5 && k < 5.5) {
    // rail corridor: ballast, sleepers and two tracks
    c = vec3(.4, .37, .33) * (.85 + .25 * tzNoise(vec2(x * 20.0, y * 2.0)));
    float sl = step(.55, fract(y / .6)) * far;
    for (int t = 0; t < 2; t++) {
      float cx = t == 0 ? -.42 : .42;
      c = mix(c, vec3(.27, .21, .16), sl * (1.0 - smoothstep(.22, .26, abs(x - cx))));
      c = mix(c, vec3(.62, .62, .64), max(tzLine(x, cx - .13, .018), tzLine(x, cx + .13, .018)) * far);
    }
    tzRough = .9;
  } else {
    float base = k > 7.5 ? .11 : k > 3.5 ? .12 : k > 2.5 ? .13 : k > 1.5 ? .14 : .16;
    c = vec3(base) * (.92 + .14 * tzNoise(vec2(x * 6.0, y * .5)) + .04 * tzNoise(vec2(x * 40.0, y * 9.0)));
    vec3 paint = vec3(.88, .88, .84);
    float m = 0.0;
    if (k > 7.5) {
      // race circuit: red and white kerbs
      float kerb = step(.86, abs(x));
      c = mix(c, mix(vec3(.75, .12, .1), vec3(.92), step(.5, fract(y / 4.0))), kerb * far);
      m = tzLine(x, .8, .015);
    } else if (k > 3.5) {
      c = mix(c, vec3(.55, .55, .52), 1.0 - smoothstep(.04, .06, abs(x)));                // median barrier
      m = max(tzLine(abs(x), .1, .012), tzLine(abs(x), .93, .012));
      m = max(m, max(tzLine(abs(x), .38, .01), tzLine(abs(x), .65, .01)) * tzDash(y, 4.0, 12.0));
    } else if (k > 2.5) {
      m = max(tzLine(x, -.02, .012), tzLine(x, .02, .012));
      m = max(m, tzLine(abs(x), .5, .012) * tzDash(y, 3.0, 9.0));
      m = max(m, tzLine(abs(x), .92, .014));
    } else if (k > 1.5) {
      m = tzLine(x, 0.0, .018) * tzDash(y, 3.0, 9.0);
      m = max(m, tzLine(abs(x), .9, .016));
    }
    c = mix(c, paint, m * far);
    // kerbstones on urban roads
    if (k < 3.5) c = mix(c, vec3(.62, .6, .56), smoothstep(.9, .97, abs(x)) * far);
    tzRough = .9 - .3 * m;
    // sodium street lighting at night
    tzGlow = vec3(1.0, .62, .28) * uNight * (k > 1.5 ? .11 : .06) * (.7 + .3 * sin(y * .2));
  }
  diffuseColor.rgb = c;
  diffuseColor.a = edge;
}`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = tzRough;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += tzGlow;');
  };
  mat.transparent = true;
  mat.customProgramCacheKey = () => 'tz-road';
  return mat;
}

/* --------------------------------------------------- glowing light points */
export function glowPointsMaterial(color, size, nightOnly = true) {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color) }, uSize: { value: size }, uNight: shared.uNight, uPixelK: shared.uPixelK, uAlways: { value: nightOnly ? 0 : 1 } },
    vertexShader: `uniform float uSize; uniform float uPixelK; varying float vFade;
      void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv;
        float px = uSize / (-mv.z * uPixelK); gl_PointSize = clamp(px, 1.5, 48.0); vFade = clamp(px / 2.5, .25, 1.0); }`,
    fragmentShader: `uniform vec3 uColor; uniform float uNight; uniform float uAlways; varying float vFade;
      void main(){ vec2 d = gl_PointCoord - .5; float r = length(d) * 2.0; float a = exp(-r * r * 4.0) + .6 * exp(-r * r * 40.0);
        float k = max(uNight, uAlways); if (k < .01) discard; gl_FragColor = vec4(uColor * a * 2.2, a * k * vFade); }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending
  });
}
