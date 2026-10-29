import '../style.css';
import { createTuzla } from './engine/index.js';
import { PLACES, STRINGS } from './i18n.js';
import { normalise } from './engine/geo.js';

const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const store = { get(k, d) { try { const v = localStorage.getItem('tuzla3d:' + k); return v === null ? d : JSON.parse(v); } catch { return d; } }, set(k, v) { try { localStorage.setItem('tuzla3d:' + k, JSON.stringify(v)); } catch { /* private mode */ } } };

let lang = store.get('lang', 'tr');
const T = () => STRINGS[lang];
let city = null, current = 'sahil', tourTimer = 0, stats = null;

/* ------------------------------------------------------------ hash state */
function parseHash() {
  const m = location.hash.match(/^#([\d.-]+),([\d.-]+),(\d+)m,([\d.]+),([\d.]+)(?:,t([\d.]+))?/);
  if (!m) return null;
  return { lat: +m[1], lon: +m[2], dist: +m[3] / 1000, az: +m[4], tilt: +m[5], hours: m[6] !== undefined ? +m[6] : null };
}
function writeHash(v) {
  const h = `#${v.lat.toFixed(5)},${v.lon.toFixed(5)},${Math.round(v.dist * 1000)}m,${v.az.toFixed(0)},${v.tilt.toFixed(0)},t${hours.toFixed(2)}`;
  history.replaceState(null, '', h);
}
const initial = parseHash();
let hours = initial?.hours ?? store.get('hours', 15.5);
const params = new URLSearchParams(location.search);
let quality = params.get('quality') || store.get('quality', matchMedia('(pointer: coarse)').matches || innerWidth < 700 ? 'low' : 'medium');
let heightScale = store.get('heightScale', 1.25);

/* -------------------------------------------------------------- language */
function applyLanguage() {
  const s = T();
  document.documentElement.lang = lang; document.title = s.htmlTitle;
  $$('[data-i18n]').forEach(el => { const v = s[el.dataset.i18n]; if (typeof v === 'string') el.textContent = v; });
  $$('[data-i18n-html]').forEach(el => { el.innerHTML = s[el.dataset.i18nHtml]; });
  $$('[data-i18n-ph]').forEach(el => { el.placeholder = s[el.dataset.i18nPh]; });
  $$('[data-i18n-title]').forEach(el => { el.title = s[el.dataset.i18nTitle]; el.setAttribute('aria-label', s[el.dataset.i18nTitle]); });
  $$('.lang-toggle button').forEach(b => b.classList.toggle('active', b.dataset.lang === lang));
  buildPlaceCards();
  $$('.lbl-place').forEach(el => { el.querySelector('b').textContent = s.places[el.dataset.place][0]; });
  if (current === 'district') showDistrict(false); else if (PLACES[current]) showPlaceText(current);
  $('#tour-button span').textContent = tourTimer ? s.tourStop : s.tour;
  if (stats) $('#stats').textContent = s.stats(stats);
  if (lastInfo) showInfo(lastInfo);
  city?.refreshLabels();
}
$$('.lang-toggle button').forEach(b => b.addEventListener('click', () => { lang = b.dataset.lang; store.set('lang', lang); applyLanguage(); }));

/* ---------------------------------------------------------------- places */
function buildPlaceCards() {
  const list = $('#place-list'); list.innerHTML = '';
  Object.keys(PLACES).forEach((key, i) => {
    const [name, sub] = T().places[key];
    const b = document.createElement('button');
    b.className = 'place-card' + (key === current ? ' active' : ''); b.dataset.place = key; b.setAttribute('aria-pressed', String(key === current));
    b.innerHTML = `<span class="place-index">${String(i + 1).padStart(2, '0')}</span><span><strong></strong><small></small></span><i>↗</i>`;
    b.querySelector('strong').textContent = name; b.querySelector('small').textContent = sub;
    b.addEventListener('click', () => { stopTour(); showPlace(key); });
    list.appendChild(b);
  });
}
function setActive(key) { $$('[data-place]').forEach(b => { const a = b.dataset.place === key; b.classList.toggle('active', a); if (b.tagName === 'BUTTON') b.setAttribute('aria-pressed', String(a)); }); }
const fmt = (lat, lon) => `${lat.toFixed(3)}° N  ${lon.toFixed(3)}° E`;
function showPlaceText(key) { const p = PLACES[key], [name, , desc] = T().places[key]; $('#view-name').textContent = name; $('#view-coords').textContent = fmt(p.lat, p.lon); $('#hero-description').textContent = desc; }
function showPlace(key) { current = key; showPlaceText(key); setActive(key); updateMode('3d'); city?.setPlace(key); }
function showDistrict(fly = true) { current = 'district'; $('#view-name').textContent = T().districtName; $('#view-coords').textContent = '40.890° N  29.350° E'; $('#hero-description').textContent = T().districtDesc; setActive(null); updateMode('3d'); if (fly) city?.overview(); }

/* ---------------------------------------------------------------- tour */
function stopTour() { if (!tourTimer) return; clearInterval(tourTimer); tourTimer = 0; city?.setAutoRotate(false); $('#tour-button').setAttribute('aria-pressed', 'false'); $('#tour-button span').textContent = T().tour; }
function startTour() {
  const keys = Object.keys(PLACES); let i = Math.max(0, keys.indexOf(current));
  const step = () => { i = (i + 1) % keys.length; showPlace(keys[i]); };
  step(); city?.setAutoRotate(true); tourTimer = setInterval(step, 11000);
  $('#tour-button').setAttribute('aria-pressed', 'true'); $('#tour-button span').textContent = T().tourStop;
}
$('#tour-button').addEventListener('click', () => tourTimer ? stopTour() : startTour());

/* ---------------------------------------------------------------- modes */
const threeButton = $('#three-d-button'), topButton = $('#top-button');
function updateMode(mode) { for (const [b, a] of [[threeButton, mode === '3d'], [topButton, mode === '2d']]) { b.classList.toggle('active', a); b.setAttribute('aria-pressed', String(a)); } }
threeButton.addEventListener('click', () => { updateMode('3d'); city?.changeMode('3d'); });
topButton.addEventListener('click', () => { updateMode('2d'); city?.changeMode('2d'); });
$('#district-button').addEventListener('click', () => { stopTour(); showDistrict(); });
$('#home-button').addEventListener('click', () => { stopTour(); showPlace('sahil'); });
$('#reset-view').addEventListener('click', () => { stopTour(); showPlace('sahil'); });
$('#zoom-in').addEventListener('click', () => city?.zoomBy(1.3));
$('#zoom-out').addEventListener('click', () => city?.zoomBy(1 / 1.3));
$('#compass').addEventListener('click', () => city?.northUp());

/* ---------------------------------------------------------------- panels */
function panel(buttonSel, panelSel) {
  const b = $(buttonSel), p = $(panelSel);
  b.addEventListener('click', () => { const open = p.hidden; $$('.panel').forEach(x => { x.hidden = true; }); $$('[aria-controls]').forEach(x => x.setAttribute('aria-expanded', 'false')); p.hidden = !open; b.setAttribute('aria-expanded', String(open)); });
}
panel('#layers-button', '#layers-panel'); panel('#settings-button', '#settings-panel');
let labelsOn = true;
$$('[data-layer]').forEach(input => input.addEventListener('change', e => {
  const name = input.dataset.layer;
  if (name === 'labels') { labelsOn = e.target.checked; $('#labels').classList.toggle('off', !labelsOn); return; }
  city?.setLayer(name, e.target.checked);
}));

/* time */
const timeRange = $('#time-range'), timeValue = $('#time-value');
const hhmm = h => { h = ((h % 24) + 24) % 24; const m = Math.round(h * 60); return `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };
function setHours(h, save = true) { hours = ((h % 24) + 24) % 24; timeRange.value = hours; timeValue.textContent = hhmm(hours); city?.setTime(hours); if (save) store.set('hours', hours); }
timeRange.addEventListener('input', () => setHours(+timeRange.value));
$('#time-now').addEventListener('click', () => { const d = new Date(), utc = d.getUTCHours() + d.getUTCMinutes() / 60; setHours(utc + 3); });
$$('[data-time]').forEach(b => b.addEventListener('click', () => setHours(+b.dataset.time)));
let lapse = 0, lapseLast = 0;
$('#timelapse').addEventListener('change', e => {
  if (e.target.checked) { lapseLast = performance.now(); const tick = now => { if (!lapse) return; setHours(hours + (now - lapseLast) / 1000 * .25, false); lapseLast = now; lapse = requestAnimationFrame(tick); }; lapse = requestAnimationFrame(tick); }
  else { cancelAnimationFrame(lapse); lapse = 0; store.set('hours', hours); }
});
/* heights */
const heightRange = $('#height-range');
heightRange.value = heightScale; $('#height-value').textContent = `${(+heightScale).toFixed(2)}×`;
heightRange.addEventListener('input', () => { heightScale = +heightRange.value; $('#height-value').textContent = `${heightScale.toFixed(2)}×`; city?.setHeightScale(heightScale); store.set('heightScale', heightScale); });
/* quality */
function markQuality() { $$('#quality-group button').forEach(b => b.classList.toggle('active', b.dataset.quality === quality)); }
$$('#quality-group button').forEach(b => b.addEventListener('click', () => { quality = b.dataset.quality; store.set('quality', quality); markQuality(); city?.setQuality(quality); }));
markQuality();
$('#animate-toggle').addEventListener('change', e => city?.setAnimate(e.target.checked));

/* ---------------------------------------------------------------- toast, share, screenshot, fullscreen */
let toastTimer = 0;
function toast(text) { const t = $('#toast'); t.textContent = text; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 2200); }
$('#share-button').addEventListener('click', async () => {
  if (city) writeHash(city.viewState());
  try { await navigator.clipboard.writeText(location.href); toast(T().copied); } catch { toast(location.href); }
});
$('#shot-button').addEventListener('click', () => {
  if (!city) return; const a = document.createElement('a'); a.href = city.screenshot(); a.download = `tuzla-3d-${hhmm(hours).replace(':', '')}.png`; a.click(); toast(T().saved);
});
$('#full-button').addEventListener('click', () => { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen?.(); });

/* ---------------------------------------------------------------- walk mode */
$('#walk-button').addEventListener('click', () => { if (!city) return; stopTour(); city.isWalking() ? city.exitWalk() : city.enterWalk(); });
$('#walk-exit').addEventListener('click', () => city?.exitWalk());
for (const [sel, v] of [['#walk-fwd', 1], ['#walk-back', -1]]) {
  const b = $(sel);
  b.addEventListener('pointerdown', e => { e.preventDefault(); if (city) city.walkInput.forward = v; });
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) b.addEventListener(ev, () => { if (city) city.walkInput.forward = 0; });
}

/* ---------------------------------------------------------------- building info */
let lastInfo = null;
function showInfo(info) {
  lastInfo = info; const card = $('#info-card');
  if (!info) { card.hidden = true; return; }
  const s = T(), isMosque = info.name && normalise(info.name).includes('cami');
  $('#info-kicker').textContent = isMosque ? s.types.mosque.toLocaleUpperCase(lang) : s.bTitle;
  $('#info-name').textContent = info.name || s.bUnnamed;
  const num = (v, d = 0) => v.toLocaleString(lang, { maximumFractionDigits: d });
  const rows = [
    [s.styles[0] === 'Konut' ? 'Tip' : 'Type', s.styles[info.style] || s.styles[0]],
    [s.bFloors, num(info.floors)],
    [s.bHeight, `${num(info.height, 1)} m`],
    [s.bArea, `${num(info.area)} m²`],
    [s.bGround, `${num(info.ground)} m`],
    [s.bRoof, [s.roofFlat, s.roofHip, s.roofPyr][info.roof] || s.roofFlat],
    [s.bSource, info.known === 1 ? s.bKnownH : info.known === 2 ? s.bKnownL : s.bEstimated],
    ['GPS', fmt(info.lat, info.lon)]
  ];
  const dl = $('#info-list'); dl.innerHTML = '';
  for (const [k, v] of rows) { const dt = document.createElement('dt'), dd = document.createElement('dd'); dt.textContent = k; dd.textContent = v; dl.append(dt, dd); }
  card.hidden = false;
}
$('#info-close').addEventListener('click', () => city?.select(-1));
$('#info-focus').addEventListener('click', () => { if (lastInfo) city?.select(lastInfo.id, true); });

/* ---------------------------------------------------------------- labels */
function makeLabels(engine) {
  const root = $('#labels');
  // curated places
  for (const key of Object.keys(PLACES)) {
    const p = PLACES[key], el = document.createElement('button');
    el.className = 'lbl lbl-place' + (key === current ? ' active' : ''); el.dataset.place = key;
    el.innerHTML = '<span class="pin-dot"></span><b></b><i>↗</i>'; el.querySelector('b').textContent = T().places[key][0];
    el.addEventListener('click', () => { stopTour(); showPlace(key); });
    root.appendChild(el); engine.addLabel(el, p.lat, p.lon, { priority: 100, lift: .06, maxDist: 40 });
  }
  const seen = new Set();
  const add = (f, cls, opts) => {
    const k = normalise(f.name) + Math.round(f.lat * 300) + ',' + Math.round(f.lon * 300); if (seen.has(k)) return; seen.add(k);
    const el = document.createElement(cls === 'lbl-hood' ? 'div' : 'button'); el.className = 'lbl ' + cls;
    el.innerHTML = cls === 'lbl-hood' ? '<b></b>' : '<span class="dot"></span><b></b>'; el.querySelector('b').textContent = f.name;
    if (el.tagName === 'BUTTON') el.addEventListener('click', () => { stopTour(); flyToFeature(f); });
    root.appendChild(el); engine.addLabel(el, f.lat, f.lon, opts);
  };
  for (const f of engine.features) {
    if (f.type === 'suburb' || f.type === 'town') add(f, 'lbl-hood', { priority: 50, lift: .02, minDist: .7, maxDist: 45 });
    else if (f.type === 'locality') add(f, 'lbl-hood small', { priority: 20, lift: .02, minDist: .7, maxDist: 14 });
  }
  for (const f of engine.features) {
    if (f.type === 'station') add(f, 'lbl-poi rail', { priority: 70, lift: .02, maxDist: 9 });
    else if (f.type === 'university' || f.type === 'hospital') add(f, 'lbl-poi edu', { priority: 40, lift: .025, maxDist: 6 });
    else if (f.type === 'building' && normalise(f.name).includes('cami')) add(f, 'lbl-poi mosque', { priority: 30, lift: .035, maxDist: 1.5 });
    else if (f.type === 'park' || f.type === 'wood') add(f, 'lbl-poi park', { priority: 15, lift: .015, maxDist: 1.2 });
    else if (f.type === 'school' || f.type === 'hotel') add(f, 'lbl-poi', { priority: 10, lift: .02, maxDist: .8 });
  }
}

/* ---------------------------------------------------------------- search */
const searchInput = $('#search-input'), results = $('#search-results');
let index = [], sel = -1, shown = [];
function buildIndex(engine) {
  const typeRank = { place: 0, suburb: 1, town: 1, station: 2, locality: 3, university: 3, hospital: 3, park: 4, mosque: 4, school: 5, building: 6 };
  const seen = new Set();
  for (const key of Object.keys(PLACES)) { const p = PLACES[key]; index.push({ name: STRINGS.tr.places[key][0], alt: STRINGS.en.places[key][0], lat: p.lat, lon: p.lon, type: 'place', key }); }
  for (const f of engine.features) {
    const type = f.type === 'building' && normalise(f.name).includes('cami') ? 'mosque' : f.type;
    const k = normalise(f.name) + '|' + type; if (seen.has(k) && type !== 'building') continue; seen.add(k);
    index.push({ ...f, type });
  }
  for (const e of index) { e.n = normalise(e.name) + (e.alt ? ' ' + normalise(e.alt) : ''); e.rank = typeRank[e.type] ?? 7; }
}
function runSearch() {
  const q = normalise(searchInput.value.trim());
  if (!q) { results.hidden = true; searchInput.setAttribute('aria-expanded', 'false'); return; }
  const words = q.split(/\s+/);
  shown = index.filter(e => words.every(w => e.n.includes(w))).map(e => ({ e, s: (e.n.startsWith(q) ? 0 : e.n.includes(' ' + q) ? 1 : 2) * 10 + e.rank })).sort((a, b) => a.s - b.s).slice(0, 8).map(x => x.e);
  results.innerHTML = ''; sel = shown.length ? 0 : -1;
  if (!shown.length) { const li = document.createElement('li'); li.className = 'empty'; li.textContent = T().searchNone; results.appendChild(li); }
  shown.forEach((e, i) => {
    const li = document.createElement('li'); li.role = 'option'; li.className = i === sel ? 'sel' : '';
    li.innerHTML = '<b></b><small></small>'; li.querySelector('b').textContent = lang === 'en' && e.alt ? e.alt : e.name;
    li.querySelector('small').textContent = e.type === 'place' ? T().types.place : (T().types[e.type] || e.type.replace(/_/g, ' '));
    li.addEventListener('mousedown', ev => { ev.preventDefault(); choose(e); });
    results.appendChild(li);
  });
  results.hidden = false; searchInput.setAttribute('aria-expanded', 'true');
}
function flyToFeature(f) {
  current = '';
  const dist = { suburb: 2.2, town: 2.2, locality: 1.6, station: .7, university: 1.1, hospital: .7, park: .6, mosque: .45, building: .4 }[f.type] ?? .6;
  city?.flyTo(f.lat, f.lon, dist, 200, 55);
  $('#view-name').textContent = f.name; $('#view-coords').textContent = fmt(f.lat, f.lon);
  $('#hero-description').textContent = T().types[f.type] || '';
  setActive(null);
  if (f.building !== undefined) setTimeout(() => city?.select(f.building), 900);
}
function choose(e) {
  searchInput.value = ''; results.hidden = true; searchInput.blur(); stopTour();
  if (e.type === 'place') showPlace(e.key); else flyToFeature(e);
}
searchInput.addEventListener('input', runSearch);
searchInput.addEventListener('focus', runSearch);
searchInput.addEventListener('blur', () => setTimeout(() => { results.hidden = true; }, 120));
searchInput.addEventListener('keydown', e => {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); if (!shown.length) return; sel = (sel + (e.key === 'ArrowDown' ? 1 : shown.length - 1)) % shown.length; [...results.children].forEach((li, i) => li.classList.toggle('sel', i === sel)); }
  else if (e.key === 'Enter' && sel >= 0) { e.preventDefault(); choose(shown[sel]); }
  else if (e.key === 'Escape') { searchInput.value = ''; results.hidden = true; searchInput.blur(); }
});

/* ---------------------------------------------------------------- about */
const modal = $('#about-modal'), aboutButton = $('#about-button');
function openAbout() { modal.hidden = false; $('#close-about').focus(); }
function closeAbout() { modal.hidden = true; aboutButton.focus(); }
aboutButton.addEventListener('click', openAbout); $('#close-about').addEventListener('click', closeAbout); $('#done-about').addEventListener('click', closeAbout);
modal.addEventListener('click', e => { if (e.target === modal) closeAbout(); });
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { if (!modal.hidden) closeAbout(); $$('.panel').forEach(p => { p.hidden = true; }); $$('[aria-controls]').forEach(x => x.setAttribute('aria-expanded', 'false')); if (lastInfo) city?.select(-1); }
  if (e.key === '/' && document.activeElement !== searchInput) { e.preventDefault(); searchInput.focus(); }
});

/* ---------------------------------------------------------------- start */
applyLanguage();
setHours(hours, false);
const loading = $('#loading'), loadingText = $('#loading-text'), bar = $('#loading-bar');
const STAGE = { load: ['lLoad', 0, .1], geometry: ['lGeometry', .1, .15], buildings: ['lBuildings', .15, .65], roads: ['lRoads', .65, .8], trees: ['lTreesP', .8, .92], scene: ['lScene', .92, 1] };
createTuzla({
  canvas: $('#map-canvas'), container: $('#map-shell'), places: PLACES, quality, hours, initialView: initial,
  onProgress(stage, v) { const [k, a, b] = STAGE[stage] || ['lScene', .9, 1]; loadingText.textContent = T()[k] + (stage === 'buildings' || stage === 'trees' ? ` … ${Math.round(v * 100)}%` : ''); bar.style.width = `${(a + (b - a) * v) * 100}%`; },
  onReady({ stats: s, ships }) {
    loading.classList.add('done');
    stats = { buildings: (s.flat || 0) + (s.pitched || 0), trees: s.trees, mosques: s.mosques || 0, ships: Object.entries(ships || {}).filter(([k]) => k !== 'yacht').reduce((a, [, v]) => a + v, 0) };
    $('#stats').textContent = T().stats(stats);
  },
  onError(err) { console.error(err); loadingText.textContent = T().fail; },
  onSelect: showInfo,
  onViewChange: writeHash,
  onWalkChange(on) { $('#walk-hud').hidden = !on; document.body.classList.toggle('walking', on); $('#walk-button').classList.toggle('active', on); }
}).then(engine => {
  city = engine; if (!engine) return;
  window.tuzla = engine; // handy for the console and automated checks
  if (params.get('anim') === '0') { engine.setAnimate(false); $('#animate-toggle').checked = false; }
  engine.setHeightScale(heightScale); engine.setTime(hours);
  makeLabels(engine); buildIndex(engine);
  if (initial) { current = ''; setActive(null); $('#view-name').textContent = '—'; $('#view-coords').textContent = fmt(initial.lat, initial.lon); }
}).catch(err => { console.error(err); loadingText.textContent = T().fail; });
