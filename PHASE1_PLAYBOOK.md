# Phase 1 Execution Playbook: High-Performance Data, Topology & Taxonomy Pipeline

> [!TIP]
> **Performance-First Architecture Guarantee**
> After auditing `scripts/extract_tuzla.py` (137 lines), `src/engine/geometry.worker.js` (534 lines), `src/engine/materials.js` (380 lines), and `src/engine/index.js` (526 lines), Phase 1 is engineered to add **zero extra bytes per vertex** (preserving the exact **44 bytes/vertex** stride) and **zero extra draw calls**, while keeping Web Worker build time under **+45 ms** and cutting shadow/picking GPU overhead by **75–90%**.

---

## Why Current Buildings Look "Procedural" (And How Phase 1 Fixes It at 60 FPS)

1. **`scripts/extract_tuzla.py` (Line 78)** collapses all OSM building tags into just 3 numbers (`kind = 2` industrial/commercial/retail, `kind = 1` residential/yes, `kind = 0` other). Supermarkets and shops get factory metal walls, and `building:part` / inner courtyards (`relation` multipolygons) are dropped.
2. **`src/engine/geometry.worker.js` (Lines 238–252)** treats every edge of a building identically: all 4 walls receive identical window bays and ground-floor shopfronts (`row = 0`), even when two buildings touch (*bitişik nizam* blind party walls) or face a narrow back alley.
3. **`src/engine/geometry.worker.js` (Line 230)** sets `base = gMin + (gMax - gMin) * 0.5` and sinks vertices by a fixed `1.5m` (`sink = .0015`), causing buildings on sloped hills (*Şifa, Mimar Sinan, Aydınlı, Tepeören*) to either float or bury half their ground floor underground.
4. **`info` Attribute (`Float32×4` at Line 154)** stores `[bid, style, rel, seed]`, leaving 20+ bits of precision in `info.y` and `info.w` completely unused.

---

## Sequential Work Packages for Opus 5.5

Feed these **4 sequential tickets** to Opus 5.5 one by one.

---

### TICKET 1.1 — Upgrade `scripts/extract_tuzla.py` + Create Standalone JSON Enricher (`scripts/enrich_osm.py`)

```markdown
### TASK: Phase 1 / Ticket 1.1 — Rich Building Schema & Courtyard Support in `scripts/extract_tuzla.py` + `scripts/enrich_osm.py`

#### CONTEXT & PERFORMANCE CONSTRAINTS
We are upgrading `Auri3l/tuzla-3js` to support photographic-level building detailing across all ~35,000+ buildings in Tuzla while keeping `public/data/tuzla-osm.json` compact (< 4.5 MB) and maintaining backward compatibility with `src/engine/geometry.worker.js`.

Currently in `scripts/extract_tuzla.py` (lines 68–87):
- `self.buildings.append([a, round(h,1) if h else 0, round(levels,1) if levels else 0, kind, roof, wall])`
- `kind` is only `0, 1, 2`, which merges `commercial`/`retail`/`supermarket` with `industrial`/`factory`, and ignores `roof:shape`, `min_height` / `building:min_level`, `building:material`, and multipolygon relation inner courtyard rings.

#### DELIVERABLES
1. **Update `scripts/extract_tuzla.py`**:
   - Expand `kind` (`b[3]`) from `0..2` to a granular integer sub-class (`0..7`) while keeping backwards compatibility:
     - `0`: civic / public / school / hospital / university / government (`amenity` or `building` in `school,university,college,hospital,public,civic,government,train_station`)
     - `1`: residential apartment (`apartments`, `residential`, `dormitory`, or `yes` with levels >= 3)
     - `2`: heavy industrial / factory / warehouse / hangar (`industrial`, `warehouse`, `factory`, `hangar`, `manufacture`, `storage_tank`, `silo`)
     - `3`: detached house / villa / bungalow / terrace (`house`, `detached`, `semidetached_house`, `terrace`, `bungalow`, `villa`, `cabin`)
     - `4`: commercial / retail / supermarket / mall / office (`commercial`, `retail`, `supermarket`, `office`, `kiosk`, `shop`, `hotel`)
     - `5`: religious / mosque (`mosque`, `place_of_worship`, `chapel`)
     - `6`: auxiliary / garage / shed / greenhouse / farm (`garage`, `garages`, `shed`, `greenhouse`, `farm_auxiliary`, `service`, `transformer_tower`)
     - `7`: sports / grandstand / stadium (`stadium`, `grandstand`, `sports_hall`, `riding_hall`)
   - Extract optional compact fields at the end of the building tuple `[a, h, levels, kind, roof, wall, roofShape, minH, holes]`:
     - `roofShape` (`b[6]`, integer `0=default, 1=flat, 2=hipped, 3=gabled, 4=pyramidal, 5=dome, 6=skillion, 7=sawtooth/round`)
     - `minH` (`b[7]`, `min_height` or `building:min_level * 3.05` rounded to `0.1m`, default `0`)
     - `holes` (`b[8]`, optional array of flat inner courtyard rings `[innerRing1, innerRing2]` from OSM multipolygon relations; omit trailing zero/empty elements to save JSON bytes!).
   - Add multipolygon relation handling so buildings with `inner` courtyard rings are extracted with their holes.

2. **Create `scripts/enrich_osm.py` (No-PBF Fast Upgrade Script)**:
   - Since `/tmp/turkey-latest.osm.pbf` may not always be present locally, write a standalone Python script `scripts/enrich_osm.py` that reads the existing `public/data/tuzla-osm.json`, cross-references `osm.pois`, `osm.land`, footprint geometry (area, convexity, elongation), and re-saves `public/data/tuzla-osm.json` with the refined `kind (0..7)` classification and cleaned rings in < 3 seconds.

#### ACCEPTANCE CRITERIA
- Running `python3 scripts/enrich_osm.py` succeeds and updates `public/data/tuzla-osm.json` with < 5% file size increase.
- `npm run build` still succeeds with 0 errors.
```

---

### TICKET 1.2 — $O(1)$ Urban Topology Engine in `src/engine/geometry.worker.js`

```markdown
### TASK: Phase 1 / Ticket 1.2 — Fast Urban Topology Rasters (Street-Frontage, Party Walls & Courtyards) in `src/engine/geometry.worker.js`

#### CONTEXT & PERFORMANCE CONSTRAINTS
In `src/engine/geometry.worker.js`, all walls of a building currently receive the same `style` and UV mapping (lines 238–252). In real Turkish urban blocks (Postane, İstasyon, İçmeler, Aydıntepe), buildings sit in *Bitişik Nizam* (shared/adjacent blind party walls) and only spawn shopfronts, awnings, and main balconies on street-facing edges.

We must compute per-edge topology in $O(N)$ time inside `build()` in `src/engine/geometry.worker.js` with **< 45 ms overhead** and **zero extra bytes per vertex**.

#### TECHNICAL SPECIFICATION
Modify `src/engine/geometry.worker.js`:

1. **Road Frontage Raster (`roadRaster`, 6m cell size)**:
   - Before the building loop (around line 114), rasterize driveable/pedestrian roads (`osm.roads` where `kind <= 4`) onto a `Uint8Array` grid (`RC = 0.006` km = 6m cells) stamping `1` within `18m` (`3` cells) of road centerlines.
   - Helper `isNearRoad(x, z)` checks this raster in $O(1)$.

2. **Adjacent Building Wall Spatial Hash (*Bitişik Nizam* Party-Wall Detector)**:
   - Pre-pass over `osm.buildings` (~12 ms): for each building edge `(ax, az) -> (bx, bz)` of length `> 2.5m`, quantize its sample points along the segment into a spatial hash grid with `2.0m` cells (`0.002` km).
   - During wall generation (line 238), check if another building has an adjacent edge within `1.4m` (`0.0014` km) in front of the wall's outward normal `(nx, nz)`.
   - Classify each wall edge `i` into `wallRole` (`0..3`):
     - `wallRole = 3` (**Blind Party Wall / Sağır Cephe**): adjacent to another building within `1.4m`, OR edge length `< 2.8m`. (Receives 0 windows, plastered blind wall with subtle structural floor-slab lines).
     - `wallRole = 0` (**Street-Facing Front Facade**): not a party wall, and `isNearRoad(midX + nx * 0.008, midZ + nz * 0.008)` is true (or the longest non-party edge if no road is within 18m). Eligible for ground-floor shopfronts, awnings, and primary balconies.
     - `wallRole = 1` (**Side / Secondary Facade**): regular upper windows, ground-floor residential windows (no shop awnings).
     - `wallRole = 2` (**Rear / Courtyard Facade**): narrower window bays, utility/kitchen windows.

3. **Inner Courtyard Holes (`b[8]`) Support**:
   - If a building entry has inner rings `b[8]`, extrude the inner courtyard walls with `wallRole = 2` and pass the flattened outer + inner rings with `holeIndices` to `earcut(flatVertices, holeIndices, 2)` when triangulating flat roofs (line 290).

4. **Zero-Bloat Attribute Packing into Existing `info` (`Float32×4`)**:
   - Do NOT add new `BufferAttribute`s. Keep vertex stride at 44 bytes:
   - `info.x` = `bid`
   - `info.y` = `style + wallRole * 16` for walls (`style` in `0..15`, `wallRole` in `0..3`), or `100 + roofStyle` for roofs/domes/minarets.
   - `info.z` = `rel` (height above ground in km, used by `uHScale`)
   - `info.w` = `Math.floor(floors) + Math.min(0.9999, Math.max(0.0001, seed))` (packs exact integer floor count + random seed in `[0, 1)`).

#### ACCEPTANCE CRITERIA
- Update `src/engine/materials.js` (`buildingMaterial`) to unpack `style = mod(vInfo.y, 16.0)`, `wallRole = floor(vInfo.y / 16.0)`, `floors = floor(vInfo.w)`, and `seed = fract(vInfo.w)` when `vInfo.y < 99.5` (and roof styles when `vInfo.y >= 99.5`).
- Render `wallRole == 3` (blind party walls) as solid tinted plaster/concrete with structural floor-slab lines and zero windows.
- Render ground-floor shopfronts (`row = 0`) ONLY when `wallRole == 0` (street-facing wall).
- Total worker execution time remains fast; `npm run build` passes cleanly.
```

---

### TICKET 1.3 — Sloped Terrain Plinths (*Subasman*), `min_height` Parts & 8×2 Atlas Expansion

```markdown
### TASK: Phase 1 / Ticket 1.3 — Sloped Terrain Plinths (Subasman), `min_height` Support & 8-Style Tuzla Facade Atlas

#### CONTEXT & PERFORMANCE CONSTRAINTS
In `src/engine/geometry.worker.js` (lines 227–248):
- Currently `base = gMin + (gMax - gMin) * .5`, meaning on sloped streets (Şifa, Mimar Sinan, Aydınlı, Tepeören), half of the ground-floor shop windows sink underground while the downhill side has distorted `va`/`vb` UVs.
- Real Turkish buildings have a level concrete/stone **plinth (*subasman*)** that absorbs the terrain slope from `gMin - 0.0012` up to `gMax + 0.0003`, and the ground floor (`v = 0`) starts cleanly above `gMax`.

#### TECHNICAL SPECIFICATION
1. **True Level Plinth (*Subasman*) Geometry & UV Alignment (`geometry.worker.js` lines 227–252)**:
   - Set `base = gMax + 0.0003` (0.3m above the highest corner of the footprint so no floor ever clips into the terrain).
   - If the building has `minH = b[7] > 0` (floating/stepped `building:part`), set `ya = yb = base + minH / 1000` and `va = vb = 0`.
   - Otherwise, for ground-touching buildings, `ya = gy[i] - 0.0012` and `yb = gy[j] - 0.0012`.
   - Because `va = (ya - base) * 1000 / floorH` is negative below `base`, the region `vFacade.y < 0.0` in `src/engine/materials.js` automatically maps to the **sloped stone/concrete plinth (*subasman*)**.
   - Enhance the `vFacade.y < 0.0` shader block in `src/engine/materials.js` (line 138) so the plinth renders as weathered travertine/concrete blocks with a `0.15m` drip-edge ledge at `vFacade.y == 0.0` and ground-contact ambient occlusion.

2. **Expand Building Classifier to 8 Core Visual Styles (`style = 0..7`)**:
   - Using `b[3]` (granular `kind 0..7`), `lc` (land class), `area`, `floors`, and world coordinates `(cx, cz)`:
     - `style 0`: **Standard Turkish Apartment** (balcony bands, PVC double windows, ground-floor shops on street edge)
     - `style 1`: **Modern Glass / Office / Residence Tower** (curtain wall or anthracite-framed floor-to-ceiling glass, spandrel bands)
     - `style 2`: **Industrial Factory / OSB Hall** (corrugated sandwich panels, high clerestory strip windows, roll-up truck loading doors on front edge)
     - `style 3`: **Detached House / Tepeören-Akfırat Villa** (shuttered windows, warm plaster/stone/wood accents, garden doors)
     - `style 4`: **Bitişik Nizam / 1990s Urban Apartment with *Cam Balkon*** (recessed *gömme* balconies enclosed with folding glass panes, brick/mosaic *BTB* facade texture)
     - `style 5`: **Public / School / University / Hospital Block** (symmetrical wide multi-mullion windows, terracotta/cream or brick academic facade, wide entrance canopy)
     - `style 6`: **Retail Mall / Supermarket / Coastal Commercial** (high ground-floor glass vitrine, composite aluminum fascia band, flat roof with HVAC)
     - `style 7`: **Shipyard Hangar / Heavy Logistics Warehouse** (giant weathered steel siding, tall sliding bay doors, safety stripe markings)
   - Expand `facadeAtlas()` in `src/engine/materials.js` from `4×2` (`1024×512`) to **`8×2` (`2048×512`)** and adjust `auv.x` multiplier in the fragment shader from `.25` to `.125` (`1.0 / 8.0`).

3. **Respect Explicit OSM `roofShape` (`b[6]`) & Add Gabled Roofs (`roofType === 3`)**:
   - In `geometry.worker.js` (line 213), if `b[6]` is present, honor it directly before falling back to heuristic roof selection.
   - Add **Gabled Roof (`roofType === 3`)** support alongside Hipped (`1`) and Pyramidal (`2`) by setting `half = L / 2` in the quadrilateral ridge builder (line 265) and emitting the two triangular gable end-walls.

#### ACCEPTANCE CRITERIA
- No building on sloped terrain buries its ground-floor windows underground; sloped bases show a clean concrete/stone *subasman* plinth.
- `facadeAtlas()` is `2048×512` (8 columns × 2 rows) and `auv` samples `1/8` per style column cleanly without mipmap bleeding (`dx`, `dy` scaled by `vec2(.125, .5)`).
- `npm run build` succeeds with 0 warnings/errors.
```

---

### TICKET 1.4 — Distance-Culled Chunk Shadow & Picking Optimization (`src/engine/index.js`)

```markdown
### TASK: Phase 1 / Ticket 1.4 — Chunk Frustum/Distance Culling, Shadow Culling & Fast GPU Picking in `src/engine/index.js`

#### CONTEXT & PERFORMANCE CONSTRAINTS
Before we add 3D balconies, roof overhangs, and landmarks in Phases 2–6, we must optimize how `src/engine/index.js` manages the building chunk meshes (`buildings.children`, lines 166–178) and GPU picking (`pickAt`, lines 279–291).

Currently:
1. Every building chunk has `castShadow = true` even when 15 km away from the camera, forcing Three.js to evaluate all chunks during the 4096×4096 shadow map pass.
2. `pickAt(clientX, clientY)` renders the entire `scene` with `camera.layers.set(1)` across all chunks, rather than ray-filtering only the chunk(s) intersecting the cursor ray.

#### TECHNICAL SPECIFICATION
1. **Per-Chunk Distance & Shadow Culling (`src/engine/index.js`)**:
   - When creating each chunk mesh `m` (line 175), store `m.userData.center = g.boundingSphere.center.clone()` and `m.userData.radius = g.boundingSphere.radius`.
   - In `render()` (around line 465), iterate over `buildings.children`:
     - Keep `m.visible = layerOn.buildings && (distToFocus - m.userData.radius < scene.fog.far + 4)`.
     - Set `m.castShadow = Q.shadow > 0 && (distToFocus - m.userData.radius < Math.min(16, dist * 1.1 + 2.5))` so only chunks near the active shadow camera frustum (`S = clamp(dist * .75, .25, 14)`) are submitted to the shadow depth pass.

2. **Fast Ray-Filtered GPU Picking (`pickAt`, line 279)**:
   - Before calling `renderer.render(scene, camera)` into `pickTarget`, construct a `THREE.Raycaster` from `(clientX, clientY)` and test `raycaster.ray.intersectsSphere(m.geometry.boundingSphere)` for each chunk `m` in `buildings.children`.
   - Temporarily enable layer `1` ONLY on the 1–3 chunks whose bounding sphere intersects the pick ray, and restore after reading the pixel. This reduces GPU pick cost by **90%+**.

3. **Update `buildingInfo(id)` & UI Inspector**:
   - Ensure `buildingInfo(id)` (line 292) reports the new 8 style categories (`style: 0..7`) and `roofType` (`0: flat, 1: hipped, 2: pyramidal, 3: gabled`) cleanly without breaking `src/main.js` or `src/i18n.js`.

#### ACCEPTANCE CRITERIA
- Shadow pass draw calls drop by 60–80% when zoomed into street/neighborhood level (`dist < 2.0`).
- Clicking and double-clicking buildings in `index.html` remains instantaneous and accurate.
- `npm run build` and `python3 scripts/build_standalone.py` both succeed.
```
