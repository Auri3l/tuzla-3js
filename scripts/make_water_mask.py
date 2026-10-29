#!/usr/bin/env python3
"""Derive a water mask for the shader water from the Sentinel-2 mosaic,
the elevation grid and OSM water polygons.

Output public/data/water-mask.png (RGB, same size as the ground image):
  R = water (soft edged), G = distance from shore (0 at the coast, 255 far out),
  B = OSM inland water polygons only.
Run from the project directory with Python 3, Pillow and numpy.
"""
from pathlib import Path
import json
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / 'public' / 'data'
terrain = json.loads((DATA / 'terrain.json').read_text())
osm = json.loads((DATA / 'tuzla-osm.json').read_text(encoding='utf-8'))
img = Image.open(DATA / 'sentinel-tuzla-2017.jpg').convert('RGB')
w, h = img.size
xmin, zmin, xmax, zmax = terrain['bounds']
N = terrain['grid']

# Elevation resampled to the image grid (bilinear).
H = np.array(terrain['heights'], dtype='float32').reshape(N, N)
elev = np.asarray(Image.fromarray(H).resize((w, h), Image.BILINEAR))

px = np.asarray(img).astype('float32')
r, g, b = px[..., 0], px[..., 1], px[..., 2]
colour = (r < 80) & (b > r * 1.15) & (g > r * 1.02)
sea = colour & (elev < 1.5)

# OSM water polygons, drawn in image space.
def to_px(x, z):
    return ((x - xmin) / (xmax - xmin) * w, (z - zmin) / (zmax - zmin) * h)

inland = Image.new('L', (w, h), 0)
draw = ImageDraw.Draw(inland)
for kind, ring in osm['land']:
    if kind not in ('water', 'wetland'):
        continue
    pts = [to_px(ring[i], ring[i + 1]) for i in range(0, len(ring), 2)]
    if len(pts) >= 3:
        draw.polygon(pts, fill=255)

mask = Image.fromarray((sea * 255).astype('uint8'))
# Close speckle: remove isolated pixels, fill small gaps.
mask = mask.filter(ImageFilter.MedianFilter(5))
mask = mask.filter(ImageFilter.MaxFilter(3)).filter(ImageFilter.MinFilter(3))
mask = Image.fromarray(np.maximum(np.asarray(mask), np.asarray(inland)))

# Keep only reasonably large water bodies (drop dark-roof false positives).
arr = (np.asarray(mask) > 127)
small = Image.fromarray((arr * 255).astype('uint8')).filter(ImageFilter.MinFilter(7)).filter(ImageFilter.MaxFilter(9))
core = np.asarray(small) > 127
arr = arr & (np.asarray(Image.fromarray((core * 255).astype('uint8')).filter(ImageFilter.MaxFilter(15))) > 127)
arr = arr | (np.asarray(inland) > 127)

soft = Image.fromarray((arr * 255).astype('uint8')).filter(ImageFilter.GaussianBlur(1.2))

# Approximate distance to shore by summing progressively wider erosions.
dist = np.zeros((h, w), dtype='float32')
cur = Image.fromarray((arr * 255).astype('uint8'))
for step in range(16):
    cur = cur.filter(ImageFilter.MinFilter(5))
    dist += (np.asarray(cur) > 127)
dist = np.asarray(Image.fromarray((dist / 16 * 255).astype('uint8')).filter(ImageFilter.GaussianBlur(2)))

out = np.dstack([np.asarray(soft), dist, np.asarray(inland)]).astype('uint8')
Image.fromarray(out, 'RGB').save(DATA / 'water-mask.png', optimize=True)
print('water mask', w, h, 'water px', int(arr.sum()))
