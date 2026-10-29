#!/usr/bin/env python3
"""Create a self-contained production HTML file after `npm run build`.

Everything needed by the 3D scene, including attribution and the derived OSM
and elevation data, stays in the HTML: no network request is needed to view it.
"""
from pathlib import Path
import base64
import re

ROOT = Path(__file__).resolve().parents[1]
DIST = ROOT / 'dist'
html = (DIST / 'index.html').read_text(encoding='utf-8')

script = re.search(r'<script type="module" crossorigin src="(\.?/assets/[^\"]+\.js)"></script>', html)
style = re.search(r'<link rel="stylesheet" crossorigin href="(\.?/assets/[^\"]+\.css)">', html)
if not script or not style:
    raise SystemExit('Built JS/CSS not found; run npm run build first')
js = (DIST / script.group(1).lstrip('./')).read_text(encoding='utf-8')
css = (DIST / style.group(1).lstrip('./')).read_text(encoding='utf-8')

def font_data(match):
    filename = match.group(1)
    data = (ROOT / 'public' / 'fonts' / filename).read_bytes()
    return 'url(data:font/ttf;base64,' + base64.b64encode(data).decode('ascii') + ')'
css, n_fonts = re.subn(r'url\([\"\']?(?:\.\./|\./|/)fonts/([^\)\"\']+)[\"\']?\)', font_data, css)
if n_fonts < 4:
    raise SystemExit(f'Expected four local font references; found {n_fonts}')

# Escape closing tags even if future OSM name tags contain HTML-like text.
js = re.sub(r'</script', r'<\\/script', js, flags=re.IGNORECASE)
html = html.replace(script.group(0), '<script type="module">\n' + js + '\n</script>')
html = html.replace(style.group(0), '<style>\n' + css + '\n</style>')

def json_script(identifier, filename):
    text = (ROOT / 'public' / 'data' / filename).read_text(encoding='utf-8')
    text = text.replace('<', r'\u003c')
    return f'<script type="application/json" id="{identifier}">{text}</script>'

ground = base64.b64encode((ROOT / 'public' / 'data' / 'tuzla-ground.jpg').read_bytes()).decode('ascii')
water = base64.b64encode((ROOT / 'public' / 'data' / 'water-mask.png').read_bytes()).decode('ascii')
data_tags = '\n'.join([
    json_script('tuzla-osm-data', 'tuzla-osm.json'),
    json_script('tuzla-terrain-data', 'terrain.json'),
    '<script type="text/plain" id="tuzla-ground-data">data:image/jpeg;base64,' + ground + '</script>',
    '<script type="text/plain" id="tuzla-water-data">data:image/png;base64,' + water + '</script>',
])
license_comment = '''
<!-- Tuzla 3D data attribution:
Map data © OpenStreetMap contributors, ODbL: https://www.openstreetmap.org/copyright
Sentinel-2 cloudless 2017 by EOX IT Services GmbH (modified Copernicus Sentinel data 2017), CC BY 4.0: https://s2maps.eu/
Terrain tiles by Tilezen/Mapzen via AWS Open Data. Europe terrain data produced using Copernicus data and information funded by the European Union – EU-DEM layers; global GMTED2010 and SRTM terrain data courtesy of the U.S. Geological Survey.
The embedded JSON elements are the data used for this model.
Fonts DM Sans and Playfair Display are distributed under the SIL Open Font License 1.1; full licenses are embedded below.
'''
for license_name in ('OFL-DM-Sans.txt', 'OFL-Playfair-Display.txt'):
    license_comment += '\n--- ' + license_name + ' ---\n' + (ROOT / 'public' / 'fonts' / license_name).read_text(encoding='utf-8').replace('--', '—')
license_comment += '\n-->\n'
html = html.replace('</body>', data_tags + '\n' + license_comment + '</body>')
out = ROOT / 'tuzla-3d-preview.html'
out.write_text(html, encoding='utf-8')
print(f'Wrote {out.name}: {out.stat().st_size / (1024 * 1024):.2f} MiB; {n_fonts} fonts embedded')
