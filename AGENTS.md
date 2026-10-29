# Tuzla-3JS — Agent Developer & Project Management Rules

## 1. Architecture Overview (`Auri3l/tuzla-3js`)
- **`scripts/` (Offline Data & Build Pipeline)**:
  - `extract_tuzla.py`: Extracts Tuzla buildings, roads, landuse, trees, and POIs from OSM into `public/data/tuzla-osm.json` using local Web Mercator coordinates (`LAT0=40.89, LON0=29.35`, where `1.0` world unit = `1 km`, so `* 1000` = metres).
  - `enrich_osm.py`: Enriches `public/data/tuzla-osm.json` with granular building classifications (`kind 0..7`), roof shapes, and cleaned rings without requiring an `.osm.pbf` file.
  - `build_standalone.py`: Bundles the Vite production build (`dist/`), JSON datasets, ground/water imagery, and fonts into a single offline-capable file (`tuzla-3d-preview.html`).
- **`src/engine/` (Three.js WebGL2 Engine & Web Worker)**:
  - `geometry.worker.js`: Off-thread geometry builder. Triangulates all ~35,000+ buildings into spatial chunks (`1.6 km` grid), plus mitred road ribbons, traffic paths, rail chains, street lamps, and procedural trees. Returns transferable typed arrays.
  - `materials.js`: Shared uniforms (`shared`), procedural canvas texture atlas generator (`facadeAtlas()`), and `onBeforeCompile` GLSL shaders (`buildingMaterial`, `buildingDepthMaterial`, `buildingPickMaterial`, `terrainMaterial`, `roadMaterial`).
  - `index.js`: Scene setup, chunk instantiation, frustum/shadow culling, Preetham sky, GPU colour-ID picking (`pickAt`), street-level walk mode, and adaptive resolution loop.
  - `life.js`: Instanced trees, animated road traffic, Marmaray trains, and ships/yachts.

## 2. Performance & Photographic Detailing Invariants
1. **Vertex Stride Budget (44 Bytes/Vertex)**:
   - Every building chunk uses `position` (`Float32×3`), `normal` (`Int8×3`), `uv` (`Float32×2`), `color` (`Uint8×3`), and `info` (`Float32×4`).
   - Always bit-pack metadata (`style`, `wallRole`, `floors`, `seed`, `roofStyle`) into `info.y` and `info.w` before adding new vertex attributes.
2. **Single Draw-Call per Chunk**:
   - Never create individual `THREE.Mesh` objects per building. All buildings within a `1.6 km` chunk must batch into the chunk's `BufferGeometry` (or a paired `[chunk.shell, chunk.details]` two-tier LOD buffer).
3. **Standalone Offline Compatibility**:
   - Never introduce runtime `fetch()` calls to external CDNs or unbundled image files. All procedural atlases or embedded data must work inside `tuzla-3d-preview.html` via `scripts/build_standalone.py`.
4. **Sloped Terrain Fidelity (*Subasman*)**:
   - Building ground floors (`vFacade.y = 0`) must sit at `gMax + 0.0003` km (above the highest footprint corner), with a textured concrete/stone plinth (*subasman*) absorbing the slope down to `gy[i] - 0.0012` km.
5. **Urban Wall Topology**:
   - Ground-floor shopfronts (`row = 0`), awnings, and primary protruding balconies must only spawn on **street-facing edges (`wallRole == 0`)**, never on **blind party walls (`wallRole == 3` / *Bitişik Nizam*)**.

## 3. Workflow & Verification Commands
- `npm run dev`: Launch local Vite dev server.
- `npm run build`: Verify production bundle compiles cleanly.
- `python scripts/build_standalone.py`: Rebuild `tuzla-3d-preview.html` and verify offline single-file integrity.

## 4. Visual QA Camera Bookmarks
Verify all building geometry and shader changes against these URL hashes:
- **Postane / Coastal Street Level**: `#40.8162,29.3035,0.12,15,68,14.5`
- **İçmeler / Aydıntepe Dense Apartments**: `#40.8485,29.2980,0.18,-30,62,17.5`
- **Tersaneler (Shipyards Bay)**: `#40.8290,29.2860,0.45,110,55,11.0`
- **Viaport Marina**: `#40.8125,29.3145,0.35,-20,60,18.2`
- **İstanbul Park (Akfırat)**: `#40.9517,29.4050,0.65,45,58,15.0`

## 5. Autonomous Sequential Ticket Queue (`WORKFLOW_QUEUE.md`)
- All 8 phases (25 sequential tickets: `Ticket 1.1` $\rightarrow$ `Ticket 8.2`) are tracked in **[WORKFLOW_QUEUE.md](./WORKFLOW_QUEUE.md)** and detailed in **[PHASE1_PLAYBOOK.md](./PHASE1_PLAYBOOK.md)** and **`tickets/PHASE2_PLAYBOOK.md` .. `tickets/PHASE8_PLAYBOOK.md`**.
- Always pick the **first unchecked (`[ ]`) ticket** in `WORKFLOW_QUEUE.md`, implement only the files in its `STRICT FILE ISOLATION` scope, verify with `npm run build`, mark `[x]` in `WORKFLOW_QUEUE.md`, commit, and advance to the next ticket in order.

