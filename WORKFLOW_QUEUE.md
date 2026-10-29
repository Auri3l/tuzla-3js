# Tuzla-3JS — Autonomous Sequential Ticket Queue (Opus 5.5 Workflow)

> [!IMPORTANT]
> **How Opus 5.5 Executes This Queue**
> 1. Find the **first unchecked (`[ ]`) ticket** below in strict numerical order (`1.1` $\rightarrow$ `8.2`).
> 2. Open the linked **Playbook File** and read the exact specification and `STRICT FILE ISOLATION` list for that ticket.
> 3. Implement **only** that single ticket while enforcing all invariants in [AGENTS.md](./AGENTS.md) (**44-byte vertex stride**, **1 draw call per chunk**, **zero external CDN fetches**).
> 4. Run the verification commands (`npm run build`, plus `python scripts/enrich_osm.py` or `python scripts/build_standalone.py` where specified).
> 5. Mark the ticket `[x]` in this file (`WORKFLOW_QUEUE.md`), commit with message `feat(phase-X): complete Ticket X.Y — <title>`, and advance to the next `[ ]` ticket.

---

## Phase 1: High-Performance Data, Topology & Taxonomy Pipeline
*Playbook: [PHASE1_PLAYBOOK.md](./PHASE1_PLAYBOOK.md)*

- [x] **Ticket 1.1** — Granular OSM Schema (`kind 0..7`, `roofShape`, `minH`, inner courtyards) in `scripts/extract_tuzla.py` + Pure-Python `scripts/enrich_osm.py` *(Completed in PR #1 / `191056e`)*
- [x] **Ticket 1.2** — $O(1)$ Urban Topology Rasters (6m Road-Frontage Raster + 2.5m *Bitişik Nizam* Blind Party-Wall Spatial Hash + Inner Courtyards + 0-Byte `info` Bit-Packing) in `src/engine/geometry.worker.js` & `src/engine/materials.js`
- [x] **Ticket 1.3** — Sloped Terrain Plinths (*Subasman*), `min_height` Support, Gabled Roofs & `8×2` (`2048×512`) Facade Atlas Expansion in `src/engine/geometry.worker.js` & `src/engine/materials.js`
- [x] **Ticket 1.4** — Per-Chunk Distance/Shadow Culling, Fast Ray-Filtered GPU Picking & 8-Style UI Inspector in `src/engine/index.js`, `src/main.js` & `src/i18n.js`

---

## Phase 2: Photographic PBR Shader & Analytical Interior Mapping Engine
*Playbook: [tickets/PHASE2_PLAYBOOK.md](./tickets/PHASE2_PLAYBOOK.md)*

- [x] **Ticket 2.1** — High-DPI Multi-Channel PBR Atlas (`uFacade`, `uMask`, Normal/Roughness relief, mullion micro-bevels, brick/mosaic/travertine procedural synthesis) in `src/engine/materials.js` *(GitHub Issue #5)*
- [x] **Ticket 2.2** — Analytical GLSL Ray-Box Interior Mapping (3D parallax ceilings, back walls, furniture silhouettes, curtains/blinds, and per-room warm/cool lighting behind window glass) in `src/engine/materials.js` *(GitHub Issue #6)*
- [x] **Ticket 2.3** — Photographic Facade Weathering (under-eave & under-balcony contact AO, ground splashback dirt gradient, vertical rain streaks below window sills, and cornice drip lines) in `src/engine/materials.js` *(GitHub Issue #7)*

---

## Phase 3: 3D Architectural Geometry Upgrade (Sub-Element Extrusion)
*Playbook: [tickets/PHASE3_PLAYBOOK.md](./tickets/PHASE3_PLAYBOOK.md)*

- [x] **Ticket 3.1** — 3D Protruding Balconies, Recessed *Gömme* Balconies & Tinted *Cam Balkon* Enclosures on Street/Side Residential Facades (`wallRole <= 1`) in `src/engine/geometry.worker.js` & `src/engine/materials.js` *(GitHub Issue #8)*
- [x] **Ticket 3.2** — Outward-Offset Roof Eaves (*Saçak* `0.45m` Overhang with Under-Soffit Shading), Flat-Roof Perimeter Parapet Walls (`0.60m` Coping) & L/U-Wing Roof Decomposition in `src/engine/geometry.worker.js` *(GitHub Issue #9)*
- [ ] **Ticket 3.3** — 3D Rooftop Micro-Architecture (Elevator Machine Penthouses, Brick Chimneys, Turkish Solar Water-Heater Frames + Cylindrical Tanks, and Industrial HVAC/Skylights) in `src/engine/geometry.worker.js` & `src/engine/materials.js` *(GitHub Issue #10)*

---

## Phase 4: The 24 Turkish Architectural Archetypes (Mahalle-Specific Rollout)
*Playbook: [tickets/PHASE4_PLAYBOOK.md](./tickets/PHASE4_PLAYBOOK.md)*

- [ ] **Ticket 4.1** — Coastal & Historical Tuzla Mahalles (*Postane, Cami, İstasyon, Evliya Çelebi*): Coastal boutique retail awnings, timber/pastel *Tuzla Yalı/Konak* houses, and historic masonry trim in `src/engine/geometry.worker.js` & `src/engine/materials.js` *(GitHub Issue #11)*
- [ ] **Ticket 4.2** — High-Density Apartments & Mass Housing (*Aydıntepe, İçmeler, Yayla, Şifa, Mimar Sinan, Orta*): TOKİ/Kiptaş symmetrical stepped blocks, 1980s–90s *Bitişik Nizam* mosaic apartments, and 2010s anthracite-frame *Site* blocks *(GitHub Issue #12)*
- [ ] **Ticket 4.3** — Northern Suburban Villas & Estates (*Tepeören, Akfırat, Orhanlı, Fatih, Anadolu*): Twin/detached modern villas, natural stone cladding, pergola terraces, and low-rise gated compound palettes *(GitHub Issue #13)*
- [ ] **Ticket 4.4** — Industrial OSBs & Logistics (*İAYOSB, BOSB, KOSB, TOSB, Deri OSB*): Corrugated sandwich panels, sawtooth north-light factory roofs, loading dock canopies, and admin glass annexes *(GitHub Issue #14)*

---

## Phase 5: Religious Architecture Overhaul (All 59 Named Mosques)
*Playbook: [tickets/PHASE5_PLAYBOOK.md](./tickets/PHASE5_PLAYBOOK.md)*

- [ ] **Ticket 5.1** — Mosque Classifier & Multi-Dome Ottoman Superstructure (Central lead dome on octagonal drum with clerestory windows, corner half-domes, and *Son Cemaat Yeri* entrance portico domes) in `src/engine/geometry.worker.js` & `src/engine/materials.js` *(GitHub Issue #15)*
- [ ] **Ticket 5.2** — High-Detail Turkish Minaret Generator (Square stone base *kaide*, chamfered transition *küp*, 12-sided fluted shaft, *şerefe* balcony with carved parapet, conical lead *külah* spire, and gilded *alem* finial) in `src/engine/geometry.worker.js` *(GitHub Issue #16)*

---

## Phase 6: Hero Landmarks & Special Complexes
*Playbook: [tickets/PHASE6_PLAYBOOK.md](./tickets/PHASE6_PLAYBOOK.md)*

- [x] **Ticket 6.1** — Tuzla Tersaneler Bölgesi (Shipyards Bay): Giant Goliath gantry cranes, jib cranes, slipways, drydocks, and heavy hull-assembly halls in `src/engine/geometry.worker.js` *(GitHub Issue #17)*
- [x] **Ticket 6.2** — Viaport Marina & Coastal Pier: Curved waterfront retail pavilions, marina breakwater lighthouse, floating yacht pontoons, and entertainment wheel/domes in `src/engine/geometry.worker.js` *(GitHub Issue #18)*
- [x] **Ticket 6.3** — Intercity İstanbul Park F1 Circuit (Akfırat): Main Grandstand with white tensile membrane roof & steel masts, VIP Pit Lane garages, and Race Control Tower in `src/engine/geometry.worker.js` *(GitHub Issue #19)*
- [x] **Ticket 6.4** — University Campuses (Sabancı Univ., İTÜ Denizcilik Fakültesi, Piri Reis Univ., Okan Univ.): Signature campus halls, clock/observation towers, and amphitheatre/dormitory ensembles in `src/engine/geometry.worker.js` *(GitHub Issue #20)*
- [x] **Ticket 6.5** — Marmaray Stations (*Tuzla, İçmeler, Aydıntepe*) & D-100 / E-80 Pedestrian Overpasses: Platform canopies and concourse bridges in `src/engine/geometry.worker.js` *(GitHub Issue #21)*

---

## Phase 7: Street-Level Micro-Environment & Night Photorealism
*Playbook: [tickets/PHASE7_PLAYBOOK.md](./tickets/PHASE7_PLAYBOOK.md)*

- [ ] **Ticket 7.1** — Ground-Floor Street Life & Shopfront Detailing (3D sloped canvas awnings, recessed shop doorways, rooftop/wall AC condenser units, and parcel boundary walls) in `src/engine/geometry.worker.js` & `src/engine/materials.js` *(GitHub Issue #22)*
- [ ] **Ticket 7.2** — Night-Time Photorealism (Multi-temperature interior rooms `2400K`–`6500K`, illuminated ground-floor shop vitrines, red/green *Eczane* & shop signs, floodlit mosque domes/minarets, and aviation warning beacons on cranes/towers) in `src/engine/materials.js` *(GitHub Issue #23)*

---

## Phase 8: Two-Tier Chunk LOD Streaming & Standalone Offline Packaging
*Playbook: [tickets/PHASE8_PLAYBOOK.md](./tickets/PHASE8_PLAYBOOK.md)*

- [ ] **Ticket 8.1** — Two-Tier Chunk Geometry Split (`chunk.shell` vs. `chunk.details` distance-culled at `< 1.8 km`) for locked 60 FPS in `src/engine/geometry.worker.js` & `src/engine/index.js` *(GitHub Issue #24)*
- [ ] **Ticket 8.2** — Final Production & Standalone Offline Bundle Verification (`npm run build` + `python scripts/build_standalone.py` $\rightarrow$ `tuzla-3d-preview.html`) *(GitHub Issue #25)*
