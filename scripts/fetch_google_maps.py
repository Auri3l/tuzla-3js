#!/usr/bin/env python3
"""Fetch high-resolution Google Maps satellite imagery for Tuzla and enrich
`public/data/tuzla-osm.json` with real satellite roof colours, roof shapes,
shadow-calibrated heights/levels, and live OSM/Overpass building & POI updates.

Outputs:
  1. `public/data/tuzla-ground.jpg` — High-resolution stitched Google Maps
     satellite imagery aligned 1:1 to `public/data/terrain.json` bounds.
  2. `public/data/tuzla-osm.json` — Enriched building tuples with real
     Google satellite `roofColour` (b[4]), refined `roofShape` (b[6]),
     calibrated `height` (b[1]) & `levels` (b[2]), and updated POIs.
"""
from __future__ import annotations

import concurrent.futures
import io
import json
import math
import re
import ssl
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from PIL import Image, ImageEnhance

Image.MAX_IMAGE_PIXELS = None

ROOT = Path(__file__).resolve().parents[1]
TERRAIN_PATH = ROOT / 'public' / 'data' / 'terrain.json'
OSM_PATH = ROOT / 'public' / 'data' / 'tuzla-osm.json'
GROUND_OUT = ROOT / 'public' / 'data' / 'tuzla-ground.jpg'
CACHE_DIR = ROOT / '.cache' / 'google_tiles'

# Local Web Mercator projection constants (must match src/engine/geo.js)
R = 6378137.0
LAT0, LON0 = 40.89, 29.35
COS = math.cos(math.radians(LAT0))
Y0 = R * math.log(math.tan(math.pi / 4.0 + math.radians(LAT0) / 2.0))


def to_world(lat: float, lon: float) -> tuple[float, float]:
    x = R * math.radians(lon - LON0) * COS / 1000.0
    z = (Y0 - R * math.log(math.tan(math.pi / 4.0 + math.radians(lat) / 2.0))) * COS / 1000.0
    return x, z


def to_lat_lon(x: float, z: float) -> tuple[float, float]:
    lon = LON0 + math.degrees(x * 1000.0 / (COS * R))
    my = Y0 - z * 1000.0 / COS
    lat = math.degrees(2.0 * math.atan(math.exp(my / R)) - math.pi / 2.0)
    return lat, lon


def latlon_to_tile_px(lat: float, lon: float, zoom: int) -> tuple[float, float]:
    n = 2 ** zoom
    px = (lon + 180.0) / 360.0 * n * 256.0
    lat_rad = math.radians(lat)
    py = (1.0 - math.log(math.tan(math.pi / 4.0 + lat_rad / 2.0)) / math.pi) / 2.0 * n * 256.0
    return px, py


def fetch_tile(tx: int, ty: int, zoom: int) -> Image.Image:
    """Download a single 256x256 Google Maps satellite tile with local disk caching."""
    cache_file = CACHE_DIR / f"s_{zoom}_{tx}_{ty}.jpg"
    if cache_file.exists() and cache_file.stat().st_size > 500:
        try:
            return Image.open(cache_file).convert('RGB')
        except Exception:
            pass

    server = (tx + ty) & 3
    url = f"https://mt{server}.google.com/vt/lyrs=s&x={tx}&y={ty}&z={zoom}"
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
        'Referer': 'https://www.google.com/maps/',
    }
    for attempt in range(4):
        try:
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, timeout=12) as resp:
                data = resp.read()
            img = Image.open(io.BytesIO(data)).convert('RGB')
            cache_file.write_bytes(data)
            return img
        except Exception:
            if attempt == 3:
                esri_url = f"https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{zoom}/{ty}/{tx}"
                try:
                    req2 = urllib.request.Request(esri_url, headers=headers)
                    with urllib.request.urlopen(req2, timeout=12) as resp2:
                        data2 = resp2.read()
                    img2 = Image.open(io.BytesIO(data2)).convert('RGB')
                    cache_file.write_bytes(data2)
                    return img2
                except Exception:
                    return Image.new('RGB', (256, 256), (38, 48, 42))
            time.sleep(0.25 * (attempt + 1))
    return Image.new('RGB', (256, 256), (38, 48, 42))


def build_google_satellite_mosaic(bounds: list[float], zoom: int = 16, out_max_dim: int = 6144) -> Image.Image:
    """Download & stitch Google Maps satellite tiles for `bounds` [bx0, bz0, bx1, bz1]."""
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    bx0, bz0, bx1, bz1 = bounds
    lat_n, lon_w = to_lat_lon(bx0, bz0)
    lat_s, lon_e = to_lat_lon(bx1, bz1)

    px0, py0 = latlon_to_tile_px(lat_n, lon_w, zoom)
    px1, py1 = latlon_to_tile_px(lat_s, lon_e, zoom)

    tx0, ty0 = int(math.floor(px0 / 256.0)), int(math.floor(py0 / 256.0))
    tx1, ty1 = int(math.floor(px1 / 256.0)), int(math.floor(py1 / 256.0))

    nx = tx1 - tx0 + 1
    ny = ty1 - ty0 + 1
    total_tiles = nx * ny
    print(f"[1/4] Assembling {total_tiles} Google Maps satellite tiles at Zoom {zoom} ({nx}x{ny} grid)...")

    coords = [(tx, ty) for ty in range(ty0, ty1 + 1) for tx in range(tx0, tx1 + 1)]
    canvas = Image.new('RGB', (nx * 256, ny * 256))

    t0 = time.time()
    done = 0
    with concurrent.futures.ThreadPoolExecutor(max_workers=24) as pool:
        future_to_coord = {pool.submit(fetch_tile, tx, ty, zoom): (tx, ty) for tx, ty in coords}
        for fut in concurrent.futures.as_completed(future_to_coord):
            tx, ty = future_to_coord[fut]
            tile_img = fut.result()
            canvas.paste(tile_img, ((tx - tx0) * 256, (ty - ty0) * 256))
            done += 1
            if done % 480 == 0 or done == total_tiles:
                print(f"      Processed {done}/{total_tiles} tiles ({time.time() - t0:.1f}s)")

    crop_box = (
        int(round(px0 - tx0 * 256.0)),
        int(round(py0 - ty0 * 256.0)),
        int(round(px1 - tx0 * 256.0)),
        int(round(py1 - ty0 * 256.0)),
    )
    cropped = canvas.crop(crop_box)
    cw, ch = cropped.size
    print(f"      Native Google Satellite mosaic cropped to exact terrain bounds: {cw}x{ch} px (~{(bx1 - bx0) * 1000 / cw:.2f} m/px)")

    scale = min(1.0, out_max_dim / max(cw, ch))
    out_w = int(round(cw * scale))
    out_h = int(round(ch * scale))
    ground_img = cropped.resize((out_w, out_h), Image.Resampling.LANCZOS) if scale < 1.0 else cropped.copy()

    ground_img = ImageEnhance.Contrast(ground_img).enhance(1.05)
    ground_img = ImageEnhance.Color(ground_img).enhance(1.06)
    ground_img.save(GROUND_OUT, format='JPEG', quality=85, optimize=True, progressive=True)
    print(f"      Saved {GROUND_OUT.relative_to(ROOT)}: {out_w}x{out_h} px ({GROUND_OUT.stat().st_size / (1024 * 1024):.2f} MiB)")
    return cropped


def fetch_overpass_enrichment(bounds: list[float]) -> tuple[list[dict], list[dict]]:
    """Query Overpass API mirrors for buildings with explicit height/levels/name/colour and rich POIs in Tuzla."""
    bx0, bz0, bx1, bz1 = bounds
    lat_n, lon_w = to_lat_lon(bx0, bz0)
    lat_s, lon_e = to_lat_lon(bx1, bz1)
    s_lat = max(40.800, lat_s)
    n_lat = min(40.960, lat_n)
    w_lon = max(29.260, lon_w)
    e_lon = min(29.440, lon_e)

    query = (
        f"[out:json][timeout:25];("
        f"way[building]['building:levels']({s_lat:.4f},{w_lon:.4f},{n_lat:.4f},{e_lon:.4f});"
        f"way[building][height]({s_lat:.4f},{w_lon:.4f},{n_lat:.4f},{e_lon:.4f});"
        f"way[building][name]({s_lat:.4f},{w_lon:.4f},{n_lat:.4f},{e_lon:.4f});"
        f"way[building]['roof:shape']({s_lat:.4f},{w_lon:.4f},{n_lat:.4f},{e_lon:.4f});"
        f"node[name][shop]({s_lat:.4f},{w_lon:.4f},{n_lat:.4f},{e_lon:.4f});"
        f"node[name][amenity]({s_lat:.4f},{w_lon:.4f},{n_lat:.4f},{e_lon:.4f});"
        f"node[name][office]({s_lat:.4f},{w_lon:.4f},{n_lat:.4f},{e_lon:.4f});"
        f"node[name][healthcare]({s_lat:.4f},{w_lon:.4f},{n_lat:.4f},{e_lon:.4f});"
        f"node[name][tourism]({s_lat:.4f},{w_lon:.4f},{n_lat:.4f},{e_lon:.4f});"
        f");out center tags;"
    )
    mirrors = [
        "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
        "https://overpass-api.de/api/interpreter",
    ]
    ctx = ssl._create_unverified_context()
    print("[2/4] Querying live OSM/Overpass mirrors for updated Tuzla building levels, heights, names & POIs...")
    for base_url in mirrors:
        try:
            full_url = base_url + "?data=" + urllib.parse.quote(query)
            req = urllib.request.Request(
                full_url,
                headers={
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0',
                    'Accept': 'application/json, */*;q=0.8',
                },
            )
            with urllib.request.urlopen(req, timeout=25, context=ctx) as resp:
                payload = json.loads(resp.read().decode('utf-8'))
            elements = payload.get('elements', [])
            ways = [el for el in elements if el.get('type') == 'way' and 'center' in el]
            nodes = [el for el in elements if el.get('type') == 'node' and 'lat' in el]
            print(f"      Retrieved {len(ways)} tagged buildings and {len(nodes)} named POIs from {base_url.split('/')[2]}")
            return ways, nodes
        except Exception as exc:
            print(f"      Mirror {base_url.split('/')[2]} skipped ({exc})")
    return [], []


def rgb_to_hex(r: int, g: int, b: int) -> str:
    return f"#{max(0, min(255, r)):02x}{max(0, min(255, g)):02x}{max(0, min(255, b)):02x}"


def parse_num(val: str | None) -> float | None:
    if not val:
        return None
    m = re.search(r'[-+]?\d+(?:\.\d+)?', str(val).replace(',', '.'))
    return float(m.group(0)) if m else None


def sample_building_from_satellite(
    ring: list[float],
    px_access,
    w: int,
    h: int,
    bx0: float,
    bz0: float,
    inv_dx: float,
    inv_dz: float,
) -> tuple[str | None, int, int]:
    """Sample interior roof pixels and North-West cast shadow length for a building footprint on the Google Satellite image.

    Returns:
      (roof_hex_colour, detected_roof_shape_hint, shadow_estimated_levels)
    """
    n = len(ring) // 2
    if n < 3:
        return None, 0, 0

    xs = ring[0::2]
    zs = ring[1::2]
    cx = sum(xs) / n
    cz = sum(zs) / n

    sample_pts = [(cx, cz)]
    for i in range(n):
        vx, vz = xs[i], zs[i]
        sample_pts.append((cx * 0.45 + vx * 0.55, cz * 0.45 + vz * 0.55))
        sample_pts.append((cx * 0.70 + vx * 0.30, cz * 0.70 + vz * 0.30))
        j = (i + 1) % n
        mx, mz = (vx + xs[j]) * 0.5, (vz + zs[j]) * 0.5
        sample_pts.append((cx * 0.50 + mx * 0.50, cz * 0.50 + mz * 0.50))

    samples = []
    seen_uv = set()
    for sx, sz in sample_pts:
        u = int((sx - bx0) * inv_dx * w)
        v = int((sz - bz0) * inv_dz * h)
        if 0 <= u < w and 0 <= v < h and (u, v) not in seen_uv:
            seen_uv.add((u, v))
            r, g, b = px_access[u, v]
            lum = 0.299 * r + 0.587 * g + 0.114 * b
            if 32 <= lum <= 246:
                samples.append((lum, r, g, b))

    if not samples:
        u = max(0, min(w - 1, int((cx - bx0) * inv_dx * w)))
        v = max(0, min(h - 1, int((cz - bz0) * inv_dz * h)))
        r, g, b = px_access[u, v]
        samples.append((0.299 * r + 0.587 * g + 0.114 * b, r, g, b))

    samples.sort(key=lambda t: t[0])
    k0 = len(samples) // 4
    k1 = max(k0 + 1, len(samples) - k0)
    core = samples[k0:k1]
    mr = sum(t[1] for t in core) / len(core)
    mg = sum(t[2] for t in core) / len(core)
    mb = sum(t[3] for t in core) / len(core)

    if mg > mr * 1.15 and mg > mb * 1.22 and mg < 130:
        return None, 0, 0

    roof_hint = 0
    if mr > mg * 1.14 and mr > mb * 1.26 and mr >= 82 and (mr - mb) >= 24:
        roof_hint = 2  # pitched clay tile roof
        boost = 1.12 if mr < 155 else 1.04
        rr = int(min(225, max(118, mr * boost)))
        gg = int(min(145, max(64, mg * boost * 0.96)))
        bb = int(min(115, max(50, mb * boost * 0.92)))
    else:
        sat_span = max(mr, mg, mb) - min(mr, mg, mb)
        if sat_span < 20 and 95 <= (mr + mg + mb) / 3 <= 225:
            roof_hint = 1  # concrete terrace / flat roof
        lum_avg = (mr + mg + mb) / 3.0
        gain = 1.18 if lum_avg < 90 else (1.08 if lum_avg < 140 else 0.96 if lum_avg > 215 else 1.02)
        rr = int(min(228, max(78, mr * gain)))
        gg = int(min(228, max(78, mg * gain)))
        bb = int(min(230, max(78, mb * gain)))

    # Measure sunlit reference ground South-East of building vs cast shadow North-West of building
    min_z = min(zs)
    max_z = max(zs)
    sun_lums = []
    for dist_km in (0.004, 0.008):
        su = int((cx + dist_km * 0.3 - bx0) * inv_dx * w)
        sv = int((max_z + dist_km - bz0) * inv_dz * h)
        if 0 <= su < w and 0 <= sv < h:
            sr, sg, sb = px_access[su, sv]
            sun_lums.append(0.299 * sr + 0.587 * sg + 0.114 * sb)
    ref_lum = max(105.0, sum(sun_lums) / len(sun_lums)) if sun_lums else 125.0
    shadow_thresh = min(82.0, ref_lum * 0.66)

    shadow_reach_m = 0.0
    for dist_m in (3.0, 5.5, 8.5, 12.0, 16.0, 21.0):
        dist_km = dist_m / 1000.0
        su = int((cx - dist_km * 0.32 - bx0) * inv_dx * w)
        sv = int((min_z - dist_km * 0.95 - bz0) * inv_dz * h)
        if 0 <= su < w and 0 <= sv < h:
            sr, sg, sb = px_access[su, sv]
            slum = 0.299 * sr + 0.587 * sg + 0.114 * sb
            if slum < shadow_thresh:
                shadow_reach_m = dist_m
            else:
                break

    # At ~62 deg solar elevation in Google's Tuzla imagery, 1 floor (~3.05m) casts ~1.65m shadow
    est_levels = 0
    if shadow_reach_m >= 5.5:
        est_levels = min(12, max(4, int(round(shadow_reach_m / 1.75))))

    return rgb_to_hex(rr, gg, bb), roof_hint, est_levels


def enrich_osm_with_google_data(mosaic: Image.Image, bounds: list[float]) -> None:
    """Enrich `public/data/tuzla-osm.json` with Google Satellite roof colours, shapes, heights & Overpass tags."""
    data = json.loads(OSM_PATH.read_text(encoding='utf-8'))
    buildings = data['buildings']
    pois = data['pois']

    bx0, bz0, bx1, bz1 = bounds
    inv_dx = 1.0 / (bx1 - bx0)
    inv_dz = 1.0 / (bz1 - bz0)
    w, h = mosaic.size
    px_access = mosaic.load()

    ways, nodes = fetch_overpass_enrichment(bounds)

    CELL = 0.05
    b_grid: dict[tuple[int, int], list[int]] = {}
    centroids: list[tuple[float, float, float]] = []
    for idx, b in enumerate(buildings):
        r = b[0]
        n = len(r) // 2
        cx = sum(r[0::2]) / n if n else 0.0
        cz = sum(r[1::2]) / n if n else 0.0
        area = 0.0
        for i in range(0, len(r), 2):
            j = (i + 2) % len(r)
            area += r[i] * r[j + 1] - r[j] * r[i + 1]
        area = abs(area) * 0.5 * 1e6
        centroids.append((cx, cz, area))
        key = (int(math.floor(cx / CELL)), int(math.floor(cz / CELL)))
        b_grid.setdefault(key, []).append(idx)

    existing_poi_keys = {(p[0].strip().lower(), round(p[1], 3), round(p[2], 3)) for p in pois}
    matched_overpass = 0
    added_pois = 0
    ROOF_MAP = {'flat': 1, 'hipped': 2, 'half-hipped': 2, 'gabled': 3, 'pyramidal': 4, 'dome': 5, 'skillion': 6, 'sawtooth': 7, 'round': 7}

    for way in ways:
        c = way['center']
        wx, wz = to_world(c['lat'], c['lon'])
        gx, gz = int(math.floor(wx / CELL)), int(math.floor(wz / CELL))
        best_i = -1
        best_d2 = 0.020 * 0.020
        for dx in (-1, 0, 1):
            for dz in (-1, 0, 1):
                for cand in b_grid.get((gx + dx, gz + dz), ()):
                    ccx, ccz, _ = centroids[cand]
                    d2 = (ccx - wx) ** 2 + (ccz - wz) ** 2
                    if d2 < best_d2:
                        best_d2 = d2
                        best_i = cand
        tags = way.get('tags', {})
        if best_i >= 0:
            b = buildings[best_i]
            while len(b) < 7:
                b.append(0 if len(b) != 4 and len(b) != 5 else '')
            lv = parse_num(tags.get('building:levels'))
            ht = parse_num(tags.get('height'))
            if lv and 1 <= lv <= 40:
                b[2] = int(round(lv))
                matched_overpass += 1
            if ht and 2.5 <= ht <= 150:
                b[1] = round(ht, 1)
                matched_overpass += 1
            if tags.get('building:colour'):
                b[5] = tags['building:colour']
            if tags.get('roof:colour'):
                b[4] = tags['roof:colour']
            rsh = ROOF_MAP.get((tags.get('roof:shape') or '').strip().lower(), 0)
            if rsh:
                b[6] = rsh

        nm = (tags.get('name') or '').strip()
        if nm:
            pk = (nm.lower(), round(c['lat'], 3), round(c['lon'], 3))
            if pk not in existing_poi_keys:
                existing_poi_keys.add(pk)
                pois.append([nm, round(c['lat'], 6), round(c['lon'], 6), 'building'])
                added_pois += 1

    for node in nodes:
        tags = node.get('tags', {})
        nm = (tags.get('name') or '').strip()
        if not nm:
            continue
        lat, lon = node['lat'], node['lon']
        pk = (nm.lower(), round(lat, 3), round(lon, 3))
        if pk not in existing_poi_keys:
            existing_poi_keys.add(pk)
            cat = (
                tags.get('shop')
                or tags.get('amenity')
                or tags.get('healthcare')
                or tags.get('office')
                or tags.get('tourism')
                or 'shop'
            )
            pois.append([nm, round(lat, 6), round(lon, 6), cat])
            added_pois += 1

    print(f"[3/4] Sampling Google Satellite roof colours, roof types & shadow heights for {len(buildings)} buildings...")
    coloured = 0
    clay_pitched = 0
    shadow_upgraded = 0

    for idx, b in enumerate(buildings):
        while len(b) < 7:
            b.append(0 if len(b) != 4 and len(b) != 5 else '')

        ring = b[0]
        cx, cz, area = centroids[idx]
        kind = b[3]

        roof_hex, roof_hint, est_levels = sample_building_from_satellite(
            ring, px_access, w, h, bx0, bz0, inv_dx, inv_dz
        )
        if roof_hex and kind != 5:
            b[4] = roof_hex
            coloured += 1

        if roof_hint == 2 and kind not in (2, 5, 7) and area < 1400:
            if b[6] in (0, 1):
                b[6] = 2
                clay_pitched += 1
        elif roof_hint == 1 and area > 450 and kind in (2, 4):
            if b[6] == 0:
                b[6] = 1

        if not b[1] and not b[2] and est_levels >= 4 and kind in (0, 1, 4) and 95 <= area <= 1400:
            b[2] = est_levels
            shadow_upgraded += 1

        while len(b) > 6 and b[-1] in (0, '', [], None):
            b.pop()

    print(f"      Sampled satellite roof colours for {coloured}/{len(buildings)} buildings")
    print(f"      Detected {clay_pitched} clay-tiled pitched roofs & {shadow_upgraded} shadow-calibrated building floor counts")
    if matched_overpass or added_pois:
        print(f"      Applied {matched_overpass} live Overpass height/level tags and added {added_pois} new POIs (total POIs: {len(pois)})")

    print(f"[4/4] Writing enriched {OSM_PATH.relative_to(ROOT)}...")
    OSM_PATH.write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    print(f"      Saved {OSM_PATH.relative_to(ROOT)} ({OSM_PATH.stat().st_size / (1024 * 1024):.2f} MiB)")


def main() -> None:
    terrain = json.loads(TERRAIN_PATH.read_text(encoding='utf-8'))
    bounds = terrain['bounds']
    zoom = int(sys.argv[1]) if len(sys.argv) > 1 else 16
    mosaic = build_google_satellite_mosaic(bounds, zoom=zoom, out_max_dim=6144)
    enrich_osm_with_google_data(mosaic, bounds)
    print("Done! Google Maps satellite imagery and building data enrichment complete.")


if __name__ == '__main__':
    main()
