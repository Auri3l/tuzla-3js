// Shared geographic helpers. Used by the main thread and the geometry worker,
// so this module must not import three.js.
//
// World coordinates are a locally scaled Web Mercator in kilometres:
// x grows east, z grows south, y is height (km) above sea level.

export const R = 6378137, LAT0 = 40.89, LON0 = 29.35;
export const COS = Math.cos(LAT0 * Math.PI / 180);
const Y0 = R * Math.log(Math.tan(Math.PI / 4 + LAT0 * Math.PI / 360));

/** Terrain heights are exaggerated slightly for legibility. */
export const TERRAIN_SCALE = 1.35;

export function toWorld(lat, lon) {
  return [
    R * (lon - LON0) * Math.PI / 180 * COS / 1000,
    (Y0 - R * Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360))) * COS / 1000
  ];
}

export function toLatLon(x, z) {
  const lon = LON0 + x * 1000 / COS / R * 180 / Math.PI;
  const my = Y0 - z * 1000 / COS;
  const lat = (2 * Math.atan(Math.exp(my / R)) - Math.PI / 2) * 180 / Math.PI;
  return [lat, lon];
}

/** Bilinear elevation sampler (returns km, already exaggerated). */
export function terrainSampler(terrain) {
  const [xmin, zmin, xmax, zmax] = terrain.bounds, N = terrain.grid, H = terrain.heights;
  const sx = (N - 1) / (xmax - xmin), sz = (N - 1) / (zmax - zmin), k = TERRAIN_SCALE / 1000;
  return (x, z) => {
    let xx = (x - xmin) * sx, zz = (z - zmin) * sz;
    xx = xx < 0 ? 0 : xx > N - 1.001 ? N - 1.001 : xx;
    zz = zz < 0 ? 0 : zz > N - 1.001 ? N - 1.001 : zz;
    const i = xx | 0, j = zz | 0, fx = xx - i, fz = zz - j, o = j * N + i;
    const a = H[o], b = H[o + 1], c = H[o + N], d = H[o + N + 1];
    return ((a + (b - a) * fx) * (1 - fz) + (c + (d - c) * fx) * fz) * k;
  };
}

/** Deterministic hash in [0,1). */
export function hash2(a, b) {
  const x = Math.sin(a * 127.1 + b * 311.7) * 43758.5453123;
  return x - Math.floor(x);
}

/** Turkish-aware search normalisation. */
export function normalise(text) {
  return text.toLocaleLowerCase('tr')
    .replace(/[ıi̇]/g, 'i').replace(/ş/g, 's').replace(/ğ/g, 'g')
    .replace(/ü/g, 'u').replace(/ö/g, 'o').replace(/ç/g, 'c').replace(/â/g, 'a')
    .normalize('NFD').replace(/[̀-ͯ]/g, '');
}
