#!/usr/bin/env python3
"""Reclassify the buildings in public/data/tuzla-osm.json without the OSM PBF.

Standard library only. Every building gets a granular kind (b[3], 0..7), an
inferred roofShape (b[6], 0..7) and a minH (b[7]) from POIs and Turkish names
near its footprint, the landuse it sits in, its size and its shape.

kind:      0 civic, 1 apartment, 2 industrial, 3 house, 4 commercial,
           5 religious, 6 auxiliary, 7 sports
roofShape: 0 default, 1 flat, 2 hipped, 3 gabled, 4 pyramidal, 5 dome,
           6 skillion, 7 sawtooth/round

The file is rewritten in place; running it again gives the same result.
"""
import json, math, re, sys, time, collections
from pathlib import Path

PATH = Path(sys.argv[1] if len(sys.argv) > 1 else 'public/data/tuzla-osm.json')
R = 6378137.0
LAT0, LON0 = 40.89, 29.35
COS = math.cos(math.radians(LAT0))
Y0 = R * math.log(math.tan(math.pi / 4 + math.radians(LAT0) / 2))
CELL = .1          # spatial grid cell, km
POI_RADIUS = .022  # POI within 22 m of the centroid (or inside the footprint)


def xy(lon, lat):
    return (R * math.radians(lon - LON0) * COS / 1000,
            (Y0 - R * math.log(math.tan(math.pi / 4 + math.radians(lat) / 2))) * COS / 1000)


def box(lat1, lon1, lat2, lon2):
    (x1, z1), (x2, z2) = xy(lon1, lat1), xy(lon2, lat2)
    return min(x1, x2), min(z1, z2), max(x1, x2), max(z1, z2)


# Shipyards along the western coast and the organised industrial zones (OSB).
INDUSTRIAL_ZONES = [
    box(40.826, 29.250, 40.852, 29.294),  # Tuzla Tersaneler
    box(40.868, 29.336, 40.888, 29.372),  # İstanbul Deri OSB
    box(40.872, 29.378, 40.895, 29.420),  # Tuzla OSB / Birlik OSB / KOSB / İAYOSB
]
VILLA_Z = 1.5  # km; north of this lie Tepeören, Akfırat, Orhanlı, Fatih

# A POI type or name votes for a kind; the highest-priority vote wins.
PRIORITY = [5, 0, 7, 4, 2]
TYPE_KIND = {
    5: {'place_of_worship', 'mosque'},
    0: {'school', 'university', 'college', 'hospital', 'clinic', 'public', 'post_office', 'police', 'townhall',
        'kindergarten', 'library', 'fire_station', 'station', 'train_station', 'courthouse', 'research_institute'},
    7: {'stadium', 'sports_centre', 'pitch', 'sports_hall', 'swimming_pool'},
    4: {'supermarket', 'mall', 'hotel', 'bank', 'restaurant', 'fast_food', 'cafe', 'pharmacy', 'convenience',
        'hardware', 'furniture', 'car_repair', 'fuel', 'shop', 'kiosk', 'department_store', 'bakery'},
    2: {'industrial', 'works', 'factory', 'warehouse'},
}
NAME_KIND = {
    5: r'\bcam(i|ii|isi)\b|\bmescit|\bmescid|\bcemevi',
    0: r'\bokul|\blise|üniversite|fakülte|enstitü|\bkolej|hastane|sağlık|poliklinik|belediye|kaymakamlık'
       r'|istasyon|marmaray|kütüphane|\byurt|öğrenci',
    7: r'\bspor|stadyum|tribün|formula|istanbul ?park\b|kapalı spor|yüzme',
    4: r'\bavm\b|\bmarket|migros|\bbim\b|\ba101\b|\bşok\b|carrefour|\botel|\bhotel|\bplaza|iş merkezi|\bofis'
       r'|\bbanka|marina|viaport|çarşı',
    2: r'sanayi|fabrika|tersane|\bdepo\b|lojistik|antrepo|hangar|üretim|\bmetal|kimya|otomotiv|shipyard',
}
NAME_RE = {k: re.compile(v) for k, v in NAME_KIND.items()}
# Neighbourhood and transit-stop labels ("Cami", "İstasyon", "Postane" mahalle) are not buildings.
PLACE_TYPES = {'suburb', 'town', 'village', 'locality', 'neighbourhood', 'quarter', 'hamlet', 'stop', 'city'}
HOUSE_LAND = {'residential', 'garden', 'orchard', 'farmland'}


def tr_lower(s):
    return s.replace('I', 'ı').replace('İ', 'i').lower()


def poi_kind(name, typ):
    if typ in PLACE_TYPES:
        return None
    for k in PRIORITY:
        if typ in TYPE_KIND[k]:
            return k
    if typ in ('kiosk',):
        return 4
    n = tr_lower(name)
    for k in PRIORITY:
        if NAME_RE[k].search(n):
            return k
    return None


def clean(ring):
    """Remove duplicate consecutive vertices, including a closing duplicate of the first."""
    out = []
    for i in range(0, len(ring) - 1, 2):
        x, z = ring[i], ring[i + 1]
        if out and out[-2] == x and out[-1] == z:
            continue
        out += (x, z)
    while len(out) > 6 and out[0] == out[-2] and out[1] == out[-1]:
        del out[-2:]
    return out


def area_km2(r):
    s = 0.
    n = len(r)
    for i in range(0, n, 2):
        j = (i + 2) % n
        s += r[i] * r[j + 1] - r[j] * r[i + 1]
    return abs(s) / 2


def inside(r, x, z):
    hit = False
    n = len(r)
    j = n - 2
    for i in range(0, n, 2):
        xi, zi, xj, zj = r[i], r[i + 1], r[j], r[j + 1]
        if (zi > z) != (zj > z) and x < (xj - xi) * (z - zi) / (zj - zi) + xi:
            hit = not hit
        j = i
    return hit


def bbox_of(r):
    xs, zs = r[0::2], r[1::2]
    return min(xs), min(zs), max(xs), max(zs)


def cells(x1, z1, x2, z2):
    for i in range(math.floor(x1 / CELL), math.floor(x2 / CELL) + 1):
        for j in range(math.floor(z1 / CELL), math.floor(z2 / CELL) + 1):
            yield i, j


def quad_shape(r):
    """(is 4-vertex, convex, aspect ratio) of a footprint."""
    if len(r) != 8:
        return False, False, 0
    sign = 0
    for i in range(4):
        ax, az = r[2 * i], r[2 * i + 1]
        bx, bz = r[(2 * i + 2) % 8], r[(2 * i + 3) % 8]
        cx, cz = r[(2 * i + 4) % 8], r[(2 * i + 5) % 8]
        c = (bx - ax) * (cz - bz) - (bz - az) * (cx - bx)
        if c and sign and (c > 0) != (sign > 0):
            return True, False, 0
        sign = sign or c
    e = [math.hypot(r[(2 * i + 2) % 8] - r[2 * i], r[(2 * i + 3) % 8] - r[2 * i + 1]) for i in range(4)]
    a, b = (e[0] + e[2]) / 2, (e[1] + e[3]) / 2
    return True, True, max(a, b) / (min(a, b) or 1e-9)


def hash01(r):
    h = int(abs(r[0]) * 1e4) * 73856093 ^ int(abs(r[1]) * 1e4) * 19349663
    return (h % 1000) / 1000


def main():
    t0 = time.time()
    before = PATH.stat().st_size
    osm = json.loads(PATH.read_text(encoding='utf-8'))
    meta = osm['meta']
    legacy = meta.get('buildingSchema') is None  # old 0..2 kinds: 0 other, 1 residential, 2 industrial/commercial

    land_grid = collections.defaultdict(list)
    for kind, ring in osm['land']:
        if kind in HOUSE_LAND or kind == 'industrial':
            bb = bbox_of(ring)
            item = (kind, ring, bb)
            for c in cells(*bb):
                land_grid[c].append(item)

    poi_grid = collections.defaultdict(list)
    for name, lat, lon, typ in osm['pois']:
        k = poi_kind(name or '', typ or '')
        if k is None:
            continue
        x, z = xy(lon, lat)
        poi_grid[(math.floor(x / CELL), math.floor(z / CELL))].append((x, z, k, typ == 'kiosk' or 'büfe' in tr_lower(name)))

    rank = {k: i for i, k in enumerate(PRIORITY)}
    kinds, roofs = collections.Counter(), collections.Counter()
    for b in osm['buildings']:
        while len(b) < 8:
            b.append('' if len(b) in (4, 5) else 0)
        r = b[0] = clean(b[0])
        if len(b) > 8:
            b[8] = [clean(h) for h in b[8] if len(h) >= 6]
        n = len(r) // 2
        cx, cz = sum(r[0::2]) / n, sum(r[1::2]) / n
        area = area_km2(r) * 1e6
        levels = b[2] or (round(b[1] / 3.05) if b[1] else 0)
        prior = b[3]
        group = ('other', 'res', 'ic')[prior] if legacy else {0: 'other', 1: 'res', 3: 'res', 2: 'ic', 4: 'ic'}.get(prior, 'other')

        # POIs inside the footprint or within 22 m of its centroid.
        x1, z1, x2, z2 = bbox_of(r)
        best, kiosk = None, False
        for c in cells(min(x1, cx - POI_RADIUS), min(z1, cz - POI_RADIUS), max(x2, cx + POI_RADIUS), max(z2, cz + POI_RADIUS)):
            for px, pz, k, kio in poi_grid.get(c, ()):
                if math.hypot(px - cx, pz - cz) <= POI_RADIUS or (x1 <= px <= x2 and z1 <= pz <= z2 and inside(r, px, pz)):
                    if best is None or rank[k] < rank[best]:
                        best = k
                    kiosk |= kio
        land = set()
        for kind, ring, bb in land_grid.get((math.floor(cx / CELL), math.floor(cz / CELL)), ()):
            if kind not in land and bb[0] <= cx <= bb[2] and bb[1] <= cz <= bb[3] and inside(ring, cx, cz):
                land.add(kind)
        in_zone = any(zx1 <= cx <= zx2 and zz1 <= cz <= zz2 for zx1, zz1, zx2, zz2 in INDUSTRIAL_ZONES)

        if best is not None and best != 2:
            kind = best
        elif best == 2 or ('industrial' in land and area > 220) or (in_zone and area >= 42):
            kind = 2
        elif area < 42 and levels <= 1:
            kind = 6
        elif group == 'res' and ((cz < VILLA_Z and 42 <= area <= 340 and levels <= 3) or
                                 (land & HOUSE_LAND and 45 <= area <= 165 and (levels in (1, 2) or (levels == 0 and area < 135)))):
            kind = 3
        elif group == 'res':
            kind = 1
        elif group == 'ic':
            kind = 2 if ('industrial' in land or area > 800) else 4
        else:
            kind = 0
        if kind == 6 and kiosk:
            kind = 4
        b[3] = kind

        quad, convex, aspect = quad_shape(r)
        if kind == 5 and area > 120:
            roof = 5
        elif kind == 2 and area > 1800:
            roof = 7
        elif kind in (2, 4, 7) or levels >= 7 or area > 1200:
            roof = 1
        elif kind in (1, 3) and quad and convex and 1.35 <= aspect <= 2.8 and area < 380 and hash01(r) < .35:
            roof = 3
        elif kind in (0, 1, 3) and quad and convex and area < 950:
            roof = 2
        else:
            roof = 0
        b[6] = roof
        kinds[kind] += 1
        roofs[roof] += 1
        # Trailing defaults are dropped to keep the file compact.
        while len(b) > 6 and b[-1] in (0, '', [], None):
            b.pop()

    meta['buildingSchema'] = '[ring,height,levels,kind,roofColour,wallColour,roofShape?,minH?,holes?]'
    meta['kindNames'] = ['civic', 'apartment', 'industrial', 'house', 'commercial', 'religious', 'auxiliary', 'sports']
    meta['roofShapeNames'] = ['default', 'flat', 'hipped', 'gabled', 'pyramidal', 'dome', 'skillion', 'sawtooth']
    meta['kindCounts'] = {str(k): kinds[k] for k in range(8)}
    meta['roofShapeCounts'] = {str(k): roofs[k] for k in range(8)}
    PATH.write_text(json.dumps(osm, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    after = PATH.stat().st_size
    dt = time.time() - t0
    print(f'Enriched {len(osm["buildings"])} buildings in {dt:.2f} s')
    print(f'Size {before:,} -> {after:,} bytes ({(after - before) / before * 100:+.2f}%)')
    print('kind      ', ' '.join(f'{k}:{kinds[k]}' for k in range(8)))
    print('roofShape ', ' '.join(f'{k}:{roofs[k]}' for k in range(8)))


if __name__ == '__main__':
    main()
