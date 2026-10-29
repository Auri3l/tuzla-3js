# Tuzla-3JS: Master PM Workflow & Opus 5.5 Roadmap

> [!IMPORTANT]
> **Architectural Reality Check (`Auri3l/tuzla-3js`)**
> `tuzla-3js` processes **~35,000+ OSM building polygons** inside `src/engine/geometry.worker.js` into spatial chunks (`1.6 km` grid) and renders them with **1 draw call per chunk** using a single `1024×512` procedural 2D canvas (`facadeAtlas()` in `src/engine/materials.js`) with only **4 generic styles** (`0: apartment`, `1: curtain-wall`, `2: industrial`, `3: detached house`) and basic flat/hipped roofs.
>
> To reach **photographic-level fidelity for every building** while maintaining **60 FPS** and preserving the single-file offline bundle (`tuzla-3d-preview.html`), **do not create 35,000 separate glTF meshes**. Direct **Opus 5.5** through the **4-Tier Photographic Architecture Pipeline** below.

---

## 1. The PM Operating Model: How to Run Opus 5.5 as Your Workhorse

### The 5 Rules of Managing Opus on `tuzla-3js`
1. **Strict File Isolation per Ticket**: Never let Opus edit `scripts/extract_tuzla.py`, `src/engine/geometry.worker.js`, and `src/engine/materials.js` all at once unless executing a defined schema migration.
2. **Vertex Attribute Budget Discipline (44-Byte Stride)**:
   - Each vertex in `geometry.worker.js` uses `position` (`Float32×3`), `normal` (`Int8×3`), `uv` (`Float32×2`), `color` (`Uint8×3`), and `info` (`Float32×4`: `[bid, style, rel, seed]`).
   - Pack new photographic parameters (`wallRole`, `archetypeId`, `floors`, `roofType`) into the unused bits of `info.y` and `info.w` before considering any new vertex attributes.
3. **Visual QA Camera Bookmarks**: Every ticket given to Opus must include 2–3 exact URL hash coordinates (`#lat,lon,distm,azimuth,tilt,tHOURS`) in Tuzla to verify output visually at street level (`distm = 0.08`) and district level (`distm = 2.5`).
4. **Frame-Budget Gate (60 FPS Target)**: Every sprint ends with a performance check in `high` quality (`4096` shadows, bloom on).
5. **Dual-Target Build Verification**: After each phase, run `npm run build` AND `python3 scripts/build_standalone.py` to guarantee `tuzla-3d-preview.html` remains working offline.

---

## 2. How "Every Building at Photographic Level" is Partialized

| Tier | Scope in Tuzla | Building Count | Technical Approach for Opus 5.5 |
| :--- | :--- | :--- | :--- |
| **Tier 0: Core Engine & Shader Foundation** | Global rendering & geometry pipeline | All (~35,000+) | Upgrade `facadeAtlas()` from `1024×512` to a **High-DPI Multi-Channel PBR Atlas** (Albedo, Normal/Roughness, Material Mask, Interior Parallax) + analytical ground-contact and under-eave Ambient Occlusion (AO). |
| **Tier 1: Turkish Urban Taxonomy (24 Archetypes)** | All residential, commercial, & industrial buildings across 17 Mahalles | ~34,000 | Expand from 4 styles to **8 core procedural shader styles × 24 Turkish architectural presets** + per-edge topology (`Front Street Wall`, `Side Wall`, `Rear Wall`, `Blind Party Wall / Bitişik Nizam`). |
| **Tier 2: 3D Architectural Sub-Elements (LOD0/LOD1)** | Physical 3D protrusions on buildings within 1.8 km of camera | ~34,000 | Extrude real 3D **sloped terrain plinths (*subasman*)**, **3D protruding/recessed balconies & *cam balkon***, **roof parapets & eaves (*saçak*)**, **ground-floor shop awnings**, **elevator penthouses**, **AC units**, and **chimneys**. |
| **Tier 3: Hero Landmarks & Campus Complexes** | Named POIs, Universities, Shipyards, Marina, Mosques, F1 Circuit | ~150–250 complexes | Custom parametric landmark generators in `src/engine/landmarks.js` + `building:part` multi-volume extrusion for Viaport Marina, Tersaneler (Shipyards), İstanbul Park, Sabancı Univ., İTÜ Denizcilik, Piri Reis Univ., and 59 Mosques. |

---

## 3. Master 8-Phase Roadmap

- **PHASE 1: High-Performance Data, Topology & Taxonomy Pipeline** *(See [PHASE1_PLAYBOOK.md](./PHASE1_PLAYBOOK.md) for ready-to-run Opus 5.5 tickets)*
  - **1.1**: Granular OSM tag extraction (`kind 0..7`, `roof:shape`, `min_height`, inner courtyard holes) + standalone `scripts/enrich_osm.py`.
  - **1.2**: $O(1)$ Urban Topology Rasters in `geometry.worker.js` (Road-frontage detector + *Bitişik Nizam* blind party-wall spatial hash + inner courtyard triangulation + 0-byte attribute bit-packing).
  - **1.3**: True sloped terrain plinths (*subasman*), `min_height` support, gabled roofs, and `8×2` (`2048×512`) facade atlas expansion.
  - **1.4**: Per-chunk shadow-frustum culling (**-75% shadow GPU cost**) & ray-filtered GPU picking (**-90% pick cost**) in `src/engine/index.js`.
- **PHASE 2: Photographic PBR Shader & Interior Mapping Engine**
  - **2.1**: High-DPI `4096×4096` procedural PBR Atlas (`uFacadeAlbedo`, `uFacadeNormalRough`, `uFacadeMask`).
  - **2.2**: Analytical GLSL **Interior Mapping** (3D parallax ceilings, back walls, curtains, and warm/cool rooms behind window glass).
  - **2.3**: Rain-streak weathering, ground splashback dirt, and under-eave AO gradients.
- **PHASE 3: 3D Architectural Geometry Upgrade (Sub-Element Extrusion)**
  - **3.1**: True 3D protruding balconies, recessed *gömme* balconies, and tinted *cam balkon* enclosures on street-facing residential facades.
  - **3.2**: Outward-offset roof eaves (*saçak*, `0.45m` overhang), flat-roof perimeter parapet walls (`0.6m` high), and L/U-shape hip-roof decomposition.
  - **3.3**: Rooftop micro-architecture (elevator machine penthouses, brick chimneys, Turkish solar water heater arrays, industrial skylights & HVAC chillers).
- **PHASE 4: The 24 Turkish Architectural Archetypes (Mahalle-Specific Rollout)**
  - **4.1**: Coastal & Historical Tuzla (*Postane, Cami, İstasyon, Evliya Çelebi*).
  - **4.2**: High-Density Apartments & Mass Housing (*Aydıntepe, İçmeler, Yayla, Şifa, Mimar Sinan, Orta*).
  - **4.3**: Suburban Villas & Estates (*Tepeören, Akfırat, Orhanlı, Fatih, Anadolu*).
  - **4.4**: Industrial OSBs & Shipyards (*İAYOSB, BOSB, KOSB, TOSB, Deri OSB, Tersaneler*).
- **PHASE 5: Religious Architecture Overhaul (All 59 Named Mosques)**
  - **5.1**: Ottoman multi-dome vs. neighborhood cubical vs. modern mosque classifier.
  - **5.2**: Octagonal drum clerestory windows, portico (*son cemaat yeri*), faceted minaret with *küp*, *şerefe* balcony, *külah* spire, and *alem*.
- **PHASE 6: Hero Landmarks & Special Complexes (`src/engine/landmarks.js`)**
  - **6.1**: Tuzla Tersaneler Bölgesi (Goliath gantry cranes, drydocks, slipways, heavy assembly halls).
  - **6.2**: Viaport Marina (curved retail pavilions, lighthouse, floating pontoons, theme park Ferris wheel & aquarium).
  - **6.3**: Intercity İstanbul Park F1 Circuit (cable-suspended Main Grandstand tensile roof, VIP Control Towers, Pit Lane garages).
  - **6.4**: University Campuses (Sabancı Univ., İTÜ Maritime Faculty, Piri Reis Univ., Okan Univ.).
  - **6.5**: Marmaray Stations (Tuzla, İçmeler, Aydıntepe) & D-100 / E-80 highway overpasses.
- **PHASE 7: Street-Level Micro-Environment & Night Photorealism**
  - **7.1**: Parcel perimeter walls, iron railings, hedges, and entrance gates.
  - **7.2**: Night-time color-temperature variety (`2700K`–`6500K`), illuminated ground-floor shop vitrines, *Eczane* signs, and floodlit mosques.
- **PHASE 8: Two-Tier Chunk LOD Streaming & Standalone Packaging**
  - **8.1**: Split chunk buffers into `chunk.shell` (always visible in frustum) and `chunk.details` (3D balconies/clutter visible within `< 1.8 km`).
  - **8.2**: Final `npm run build` and `python3 scripts/build_standalone.py` verification.
