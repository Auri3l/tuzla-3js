# Phase 6 Execution Playbook: Hero Landmarks & Special Complexes

> [!TIP]
> **Zero-Draw-Call Parametric Landmarks**
> All Tuzla hero landmarks (Shipyard Goliath cranes, Viaport Marina, Intercity İstanbul Park F1 grandstand, University campuses, and Marmaray stations) are emitted directly into their spatial chunk's `BufferGeometry` in `src/engine/geometry.worker.js` so they render in the exact same chunk draw call and shadow pass!

---

### TICKET 6.1 — Tuzla Tersaneler Bölgesi: Goliath Gantry Cranes, Jib Cranes & Drydocks (`src/engine/geometry.worker.js`)

#### STRICT FILE ISOLATION
- `src/engine/geometry.worker.js`

#### DELIVERABLES
1. **Parametric Goliath Gantry Cranes & Shipyard Infrastructure**:
   - In the Tersaneler bay zone (`40.822..40.840 N, 29.275..29.298 E`), place 10–14 iconic yellow/orange/blue-and-white **Goliath Gantry Cranes** spanning `45m–75m` wide and `38m–52m` high over the shipyard slipways and drydocks.
   - Construct each gantry crane from A-frame leg pairs, a heavy upper box-girder bridge with operator trolley cabin, and high-visibility red/white top warning stripes.
   - Add waterfront luffing jib cranes along the outfitting piers.

#### ACCEPTANCE CRITERIA
- Camera bookmark `#40.8290,29.2860,0.45,110,55,11.0` (Tersaneler Bay) shows the unmistakable Tuzla shipyard skyline of giant gantry cranes and assembly halls.
- `npm run build` succeeds with 0 errors.

---

### TICKET 6.2 — Viaport Marina & Coastal Pier (`src/engine/geometry.worker.js`)

#### STRICT FILE ISOLATION
- `src/engine/geometry.worker.js`

#### DELIVERABLES
1. **Viaport Marina Architecture (`#40.8125,29.3145,0.35,-20,60,18.2`)**:
   - Enhance the Viaport Marina complex (`40.808..40.817 N, 29.308..29.323 E`) with:
     - Warm timber-and-glass waterfront retail promenade pavilions with overhanging pergolas.
     - Floating concrete/wood yacht mooring pontoons extending into the marina basin.
     - Red-and-white striped breakwater lighthouse at the western and eastern harbour mouths.
     - Theme park observation Ferris wheel silhouette (`38m` diameter truss ring + A-frame supports) and aquarium dome.

#### ACCEPTANCE CRITERIA
- Camera bookmark `#40.8125,29.3145,0.35,-20,60,18.2` displays Viaport Marina's piers, pontoons, lighthouse, and retail pavilions.
- `npm run build` succeeds with 0 errors.

---

### TICKET 6.3 — Intercity İstanbul Park F1 Circuit Grandstand & Pit Complex (`src/engine/geometry.worker.js`)

#### STRICT FILE ISOLATION
- `src/engine/geometry.worker.js`

#### DELIVERABLES
1. **İstanbul Park F1 Circuit Landmarks (`#40.9517,29.4050,0.65,45,58,15.0`)**:
   - Detect the Main Grandstand, Pit Lane Building, and VIP Paddock Towers along the start/finish straight (`kind === 7` or inside the circuit bounds `40.945..40.962 N, 29.400..29.418 E`):
     - **Main Grandstand**: tiered seating bowl + white cable-suspended tensile wing roof supported by a row of tall inclined steel masts rising `28m` above the rear spine.
     - **Pit Lane Garages & Paddock Club**: long two-tier pit building with ground-floor F1 garage bays and upper glass hospitality terrace.
     - **VIP Cylindrical/Hexagonal Hospitality Towers**: iconic glass-and-steel towers behind the paddock.

#### ACCEPTANCE CRITERIA
- Camera bookmark `#40.9517,29.4050,0.65,45,58,15.0` shows the F1 Main Grandstand tensile roof masts, tiered seating, Pit Lane garages, and VIP towers.
- `npm run build` succeeds with 0 errors.

---

### TICKET 6.4 — University Campuses: Sabancı, İTÜ Denizcilik, Piri Reis & Okan (`src/engine/geometry.worker.js`)

#### STRICT FILE ISOLATION
- `src/engine/geometry.worker.js`

#### DELIVERABLES
1. **Campus Architectural Signatures**:
   - **Sabancı University (Orhanlı/Tepeören)**: warm brick-and-cream academic buildings, Information Center library vault, Performing Arts Center, and campus clock/water tower around the central lake.
   - **İTÜ Denizcilik Fakültesi & Piri Reis University (Postane/Sahil)**: coastal maritime campus blocks, ceremonial courtyard facades, and modern glass simulation centers.
   - **Okan University (Akfırat)**: modern curved/stepped faculty blocks and student dormitories.

#### ACCEPTANCE CRITERIA
- Major Tuzla university campuses stand out with cohesive architectural palettes and landmark halls.
- `npm run build` succeeds with 0 errors.

---

### TICKET 6.5 — Marmaray Stations (*Tuzla, İçmeler, Aydıntepe*) & D-100 Overpasses (`src/engine/geometry.worker.js`)

#### STRICT FILE ISOLATION
- `src/engine/geometry.worker.js`

#### DELIVERABLES
1. **Marmaray Station Canopies & Concourses**:
   - Along the railway chain (`kind === 5` roads) at *Aydıntepe*, *İçmeler*, and *Tuzla* station POIs:
     - Generate `180m`-long island platform concrete decks, cantilevered steel/glass platform shelter canopies, and elevated pedestrian concourse overpasses spanning the tracks.

#### ACCEPTANCE CRITERIA
- Marmaray trains pass through covered station platforms at Aydıntepe, İçmeler, and Tuzla stations.
- `npm run build` succeeds with 0 errors.
