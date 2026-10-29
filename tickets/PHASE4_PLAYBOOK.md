# Phase 4 Execution Playbook: The 24 Turkish Architectural Archetypes (Mahalle-Specific Rollout)

> [!TIP]
> **Neighborhood-Accurate Urban Character Across All 17 Tuzla Mahalles**
> Phase 4 introduces geographic Mahalle zone detection in `src/engine/geometry.worker.js` and expands the procedural shader presets in `src/engine/materials.js` so coastal Postane, high-density İçmeler/Aydıntepe, suburban Tepeören/Akfırat, and the northern OSB industrial zones each exhibit their real-world Turkish architectural palette.

---

### TICKET 4.1 — Coastal & Historical Tuzla Mahalles (*Postane, Cami, İstasyon, Evliya Çelebi*)

#### STRICT FILE ISOLATION
- `src/engine/geometry.worker.js`
- `src/engine/materials.js`

#### DELIVERABLES
1. **Coastal Zone Classifier (`src/engine/geometry.worker.js`)**:
   - Identify buildings in the historic coastal belt (`z > 5.8` km and `x < -1.5` km — *Postane, Cami, İstasyon, Evliya Çelebi*).
   - Assign coastal Mediterranean/Marmara plaster palettes (warm cream, soft ochre, Aegean white-beige, pastel terracotta) and timber-shuttered / French-balcony residential proportions.
   - Ensure coastal commercial streets (*Cumhuriyet Cd., İstasyon Cd., Sahil Yolu*) spawn continuous ground-floor café/restaurant/boutique shopfronts with striped/warm canvas awnings on `wallRole == 0`.

#### ACCEPTANCE CRITERIA
- Camera bookmark `#40.8162,29.3035,0.12,15,68,14.5` (Postane / Coastal Street Level) reflects authentic coastal Tuzla character.
- `npm run build` succeeds with 0 errors.

---

### TICKET 4.2 — High-Density Apartments & Mass Housing (*Aydıntepe, İçmeler, Yayla, Şifa, Mimar Sinan, Orta*)

#### STRICT FILE ISOLATION
- `src/engine/geometry.worker.js`
- `src/engine/materials.js`

#### DELIVERABLES
1. **TOKİ / Kiptaş Mass-Housing & Dense Urban Block Archetypes**:
   - Detect repetitive multi-block housing estates (similar footprint area `280..750` m², `floors >= 5`, regular spacing in *Aydıntepe, İçmeler, Şifa, Mimar Sinan, Orta*) and assign coordinated estate colour palettes (warm sand/terracotta bands, dual-tone beige/brown plaster, uniform hipped/parapet roofs).
   - Distinguish 1980s–90s *Bitişik Nizam* mosaic/brick apartments (`style = 4`) from 2015+ anthracite-grey-and-white *Yeni Nesil Site* blocks (`style = 0/1` with dark window frames and glass balcony railings).

#### ACCEPTANCE CRITERIA
- Camera bookmark `#40.8485,29.2980,0.18,-30,62,17.5` (İçmeler / Aydıntepe) shows realistic variety between 1990s *Bitişik Nizam* apartments, modern anthracite-white *Site* blocks, and TOKİ-style estates.
- `npm run build` succeeds with 0 errors.

---

### TICKET 4.3 — Northern Suburban Villas & Estates (*Tepeören, Akfırat, Orhanlı, Fatih, Anadolu*)

#### STRICT FILE ISOLATION
- `src/engine/geometry.worker.js`
- `src/engine/materials.js`

#### DELIVERABLES
1. **Suburban Villa Compound Archetypes (`z < 1.8` km)**:
   - Refine `style = 3` in northern villa estates (*Tepeören, Akfırat, Orhanlı*):
     - Natural stone ground-floor cladding (`row == 0`) with warm timber/white stucco upper floor (`row == 1`).
     - Low-slope clay tile hipped roofs (`#9c4e38`, `#844232`, `#5a5652` slate grey for modern villas) with generous `0.55m` eaves.
     - Ground-floor garden patio sliding glass doors facing the yard.

#### ACCEPTANCE CRITERIA
- Villa neighborhoods around Akfırat and Tepeören (`#40.9517,29.4050,0.65,45,58,15.0`) display crisp stone-and-timber detached villas with tiled roofs.
- `npm run build` succeeds with 0 errors.

---

### TICKET 4.4 — Industrial OSBs & Logistics (*İAYOSB, BOSB, KOSB, TOSB, Deri OSB*)

#### STRICT FILE ISOLATION
- `src/engine/geometry.worker.js`
- `src/engine/materials.js`

#### DELIVERABLES
1. **OSB Factory & Warehouse Detailing (`style = 2` & `style = 7`)**:
   - Add corporate accent bands along the top parapet of OSB factory halls (blue, red, green, orange, or silver-grey composite fascia).
   - Render multiple truck loading dock bays (`row == 0` on `wallRole == 0` for large warehouses `area > 1200` m²) with dark rubber dock bumpers and sectional overhead doors.
   - Add sawtooth/monitor skylight roof profiles on large manufacturing halls (`area > 2800` m²).

#### ACCEPTANCE CRITERIA
- Industrial OSB zones in northern/central Tuzla look like authentic Turkish Organized Industrial Zones (OSB) with loading docks, corporate fascia stripes, and skylight roofs.
- `npm run build` succeeds with 0 errors.
