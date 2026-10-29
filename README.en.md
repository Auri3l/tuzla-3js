# Tuzla, İstanbul — 3D district model (English)

An interactive, living Three.js model of Tuzla, built from mapped OpenStreetMap features, terrain elevation and openly licensed satellite imagery. The single-file `tuzla-3d-preview.html` works without network access in a modern, WebGL2-enabled browser; it includes the map data, imagery, fonts, and code.

## What is new in v2

- **Buildings:** façades with floors and window bays (apartment, glass office, industrial cladding and detached-house types), shop fronts with coloured awnings on ground floors, hipped and pyramid clay-tile roofs on residential blocks, flat concrete roofs with solar water heaters and tanks, ribbed metal roofs on factories, roof colours of large roofs sampled from the satellite mosaic, industrial classification from OSM land use. 59 named mosques get a lead dome and a minaret.
- **Light and time:** physically based materials, a Preetham sky with the real solar position for Tuzla's latitude and today's date, a time-of-day slider with presets, a “now” button and a time-lapse, sun shadows that follow the camera, night mode with lit windows, sodium street lighting, ~20 000 street lamps, stars, bloom (high quality).
- **Water:** a water mask derived from the Sentinel-2 mosaic, elevation and OSM water polygons drives animated waves, sky reflections, depth colour and shore foam; the Marmara continues to the horizon.
- **Vegetation:** OSM trees plus procedurally planted trees in forests, parks, gardens, cemeteries (cypresses), scrub and residential yards; Mediterranean stone pines; wind sway.
- **Life:** simulated traffic on the real road network with buses and head/tail lights, Marmaray trains on the rail line, anchored and moving cargo ships, vessels at the shipyard quays, tugs with wakes and yachts in Viaport Marina. These are simulations, not live data.
- **Streets:** continuous mitred road ribbons that follow the terrain, lane markings, median barriers, kerbs, rail sleepers and tracks, red-white kerbs on the İstanbul Park circuit; roads stay visible at district scale.
- **Interface:** Turkish and English, search over neighbourhoods, stations, mosques, schools, parks and named buildings, neighbourhood and POI labels, click a building for its details (double-click to zoom), street-level walk mode (WASD / arrows, Shift to run, touch buttons), auto tour, building height slider, Low/Medium/High quality, layer toggles, shareable view links (`#lat,lon,distm,azimuth,tilt,tHOURS`), screenshot and full screen.
- **Performance:** all geometry is generated in a Web Worker (inlined, so the standalone file still works offline); buildings are split into spatial chunks for frustum culling; trees in distance-culled instanced chunks; adaptive resolution when frames are slow; rendering pauses in a background tab.

## Open and use

- Open `tuzla-3d-preview.html` directly. Allow a few seconds for the district's geometry to be built.
- Drag to orbit; use the mouse wheel or pinch and the +/− controls to zoom. Click **View the district** for the whole district.
- Choose a map pin or place card to fly there. On small screens, swipe the card strip sideways to reach all eight places.
- Toggle **2D / 3D** and use the layers control to show or hide buildings, streets, trees, and the boundary. The circular arrow returns to the coast.
- With the canvas focused, arrow keys rotate, W A S D pan, `+` / `−` zoom, `N` turns north up, `0` or `Home` returns to the coast and `/` focuses search. The scene respects reduced-motion settings.

## Run the source project

Requires Node.js 20.19+ or 22.12+. From the project directory:

```bash
npm ci
npm run dev
```

Visit the local URL shown by Vite. For a normal web deployment use `npm run build` and serve `dist/` from a web server. To rebuild the standalone file use `npm run build:standalone`; it also requires Python 3 and embeds the production assets, datasets, imagery, and font licenses. The preprocessed data is already included and no external data service is contacted at runtime.

## Coverage and accuracy

- The model uses the OpenStreetMap boundary for [Tuzla relation 1276010](https://www.openstreetmap.org/relation/1276010). Its OSM country extract had replication timestamp **28 Oct 2026, 21:21:02 UTC** (29 Oct in İstanbul). Four additional raceway ways were checked through the OSM API on 29 Oct 2026. 
- The extracted dataset contains **19,690 building footprint features**, **11,508 road/coast/rail/water lines**, and **3,105 mapped tree points**. It also retains land polygons and points of interest as data; the scene renders the satellite ground and five selected place markers rather than every retained POI or land polygon. Mapped coverage is incomplete and can contain errors. Complex building relations, holes, and unmapped structures may be missing or simplified.
- Only **21** buildings had an explicit height tag; **2,230** had building-level tags; and **17,439 (about 89%)** had neither and use inferred heights. Level counts are converted at 3.15 m per level. All façade patterns and most roof colors are procedural; no building is a photographic replica. OSM-tagged geometry is not guaranteed to match the current real world.
- For legibility, the terrain is vertically scaled **1.35×** and building heights **1.25×** by default (adjustable 1–2.5× in settings). The terrain is sampled onto a 257 × 257 grid. It is not suitable for engineering, navigation, or surveying.
- The ground image is **Sentinel-2 cloudless 2017**, approximately 10 m native imagery. It predates many OSM edits and may differ from the current streets and buildings. Color and brightness were adjusted, outside-district land was dimmed, and water was styled. It is not high-resolution photogrammetry.
- Street-level visual references were the dated Commons photographs below. Google Street View panoramas could not be accessed and are not embedded; there is no live street-view layer.

## Data and attribution

- **OpenStreetMap:** map data © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), available under the [Open Database License](https://opendatacommons.org/licenses/odbl/). Extracted from [Geofabrik's Turkey OSM extract](https://download.geofabrik.de/europe/turkey.html), plus four [İstanbul Park raceway](https://www.openstreetmap.org/way/179048507) ways fetched from the OSM API. The derived, machine-readable data is in `public/data/tuzla-osm.json` and is also embedded in the standalone HTML.
- **Imagery:** *Sentinel-2 cloudless 2017* by [EOX IT Services GmbH](https://s2maps.eu/), containing modified Copernicus Sentinel data 2017, [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). The application further changes colors and dims the area outside Tuzla.
- **Elevation:** [Tilezen/Mapzen Terrain Tiles](https://github.com/tilezen/joerd/blob/master/docs/attribution.md) via [AWS Open Data](https://registry.opendata.aws/terrain-tiles/). Europe terrain data produced using Copernicus data and information funded by the European Union — EU-DEM layers. Global GMTED2010 and SRTM terrain data courtesy of the U.S. Geological Survey.
- **Street-level visual references consulted, not redistributed:** [Tuzla Sahil](https://commons.wikimedia.org/wiki/File:EROL_AKBULUT_TUZLA_SAH%C4%B0L_-_panoramio.jpg), Erol Akbulut, 2005, CC BY 3.0; [Tuzla Evleri](https://commons.wikimedia.org/wiki/File:Tuzla_Evleri_-_panoramio.jpg), Necdet Tunçer, 2012, CC BY-SA 3.0.
- **Code and typefaces:** Three.js and Vite are MIT licensed. DM Sans and Playfair Display are provided under the SIL Open Font License; the full licenses are in `public/fonts/` and embedded in the standalone HTML.

## Project structure and optional preprocessing

- `src/engine/index.js`: scene assembly, camera, picking, walk mode, labels, render loop.
- `src/engine/geometry.worker.js`: building shells and roofs, road ribbons, lamps, traffic paths, rail chains and tree placement.
- `src/engine/materials.js`: façade atlas and building, terrain/water and road shaders.
- `src/engine/sky.js`, `src/engine/life.js`: sky and sun, trees, traffic, trains and ships.
- `src/main.js`, `src/i18n.js`, `index.html`, `style.css`: interface, Turkish/English strings and curated places.
- `public/data/`: processed OSM geometry, elevation grid, original 2017 mosaic, and styled ground texture.
- `scripts/build_standalone.py`: combines the Vite build with embedded data and fonts.
- `scripts/make_water_mask.py`: derives `public/data/water-mask.png` (needs Pillow and numpy only).
- `scripts/extract_tuzla.py`, `scripts/make_ground.py`, `scripts/style_ground.py`: optional data preparation. Regeneration requires the included district boundary, Python packages `osmium`, `shapely`, `requests`, `Pillow`, and `numpy`, and access to the cited upstream data. The full Turkey PBF is large. If refreshing the source data, also update the snapshot date displayed in the information panel.
