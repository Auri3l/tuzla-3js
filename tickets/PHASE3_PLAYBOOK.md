# Phase 3 Execution Playbook: 3D Architectural Geometry Upgrade (Sub-Element Extrusion)

> [!TIP]
> **Single Draw-Call 3D Silhouette Fidelity**
> Phase 3 extrudes physical 3D balconies, roof overhangs (*saçak*), flat-roof parapets, and rooftop micro-architecture directly into the chunk `BufferGeometry` in `src/engine/geometry.worker.js` while preserving the **44-byte vertex stride**.

---

### TICKET 3.1 — 3D Protruding Balconies & *Cam Balkon* Enclosures (`src/engine/geometry.worker.js` & `src/engine/materials.js`)

#### STRICT FILE ISOLATION
- `src/engine/geometry.worker.js`
- `src/engine/materials.js`

#### DELIVERABLES
1. **3D Balcony Box Extrusion on Street/Side Residential Walls (`src/engine/geometry.worker.js`)**:
   - For residential buildings (`style === 0` or `style === 4`) with `floors >= 2` and `area >= 75` m²:
   - On edges where `wallRole === 0` (street-facing) or (`wallRole === 1` and `len >= 0.009` km):
     - Determine 1 or 2 symmetric balcony columns along the wall edge (`bays >= 2`).
     - Extrude a compact 3D balcony volume (`depth = 0.0011` km = `1.1m` outward along `(nx, nz)`) spanning from floor `1` (`base + floorH / 1000`) to `top - 0.0004` km (only 3 visible vertical faces + bottom soffit + top cap = 10 triangles per vertical balcony stack instead of per-floor boxes!).
     - Set UV `u` along the balcony perimeter so `buildingMaterial()` renders each floor's balcony parapet / railing / *cam balkon* glass cleanly along `vFacade.y`.
     - Pack `wallRole = 0` and `style = 0` (open railing balcony) or `style = 4` (*cam balkon* glazed enclosure) into `info.y`.

#### ACCEPTANCE CRITERIA
- Dense apartment streets (`#40.8485,29.2980,0.18,-30,62,17.5`) cast real 3D balcony shadows across facades.
- Blind party walls (`wallRole == 3`) never spawn protruding balconies.
- `npm run build` succeeds with 0 errors.

---

### TICKET 3.2 — Outward-Offset Roof Eaves (*Saçak*), Flat-Roof Parapets & L/U-Wing Roofs (`src/engine/geometry.worker.js`)

#### STRICT FILE ISOLATION
- `src/engine/geometry.worker.js`

#### DELIVERABLES
1. **Outward-Offset Roof Eaves (*Saçak* Overhang)**:
   - For pitched roofs (`roofType` in `1, 2, 3`), offset the eave polygon vertices outward by `0.0004` km (`0.40m`) along each corner's mitered outward normal so pitched roofs overhang the walls and cast a crisp eave shadow.
   - Emit the underside eave soffit ring (`top`) connecting the wall top to the overhanging eave rim.
2. **Flat-Roof Perimeter Parapet Wall (`roofType === 0`)**:
   - For flat-roofed apartment, civic, and commercial buildings (`roofType === 0`, ` !industrial`, `area >= 55` m²), extrude a `0.00055` km (`0.55m`) perimeter parapet rim above `top` (outer wall extension + top coping rim + inner parapet wall dropping down to `top`) so flat roofs look like authentic recessed concrete terraces rather than paper-thin planes.
3. **6- and 8-Vertex L-Wing Hipped Roofs**:
   - Extend the hipped roof builder to support orthogonal 6-vertex (L-shaped) residential footprints (`n === 6 && !convex && area < 900`) by decomposing into two intersecting ridge segments or a main wing + side gable wing.

#### ACCEPTANCE CRITERIA
- Pitched roofs overhang building walls with a `0.40m` *saçak* eave; flat roofs have a 3D perimeter parapet wall.
- `npm run build` succeeds with 0 errors.

---

### TICKET 3.3 — 3D Rooftop Micro-Architecture: Elevator Penthouses, Chimneys, Solar Heaters & HVAC (`src/engine/geometry.worker.js` & `src/engine/materials.js`)

#### STRICT FILE ISOLATION
- `src/engine/geometry.worker.js`
- `src/engine/materials.js`

#### DELIVERABLES
1. **Flat-Roof Superstructures (`roofType === 0`)**:
   - **Elevator Penthouse (*Asansör Kulesi*)**: On flat-roofed buildings with `floors >= 4` and `area >= 120` m², extrude a `2.8m × 2.8m × 2.4m` (`0.0028` km) concrete box near `(cx, cz)` using `wallC`.
   - **Turkish Solar Water Heaters (*Günısı*)**: On residential flat roofs (`floors <= 6`, `r2 < 0.55`), add a tilted solar collector panel + horizontal white hot-water cylinder (`10` triangles total).
   - **Industrial / Commercial HVAC Chillers & Skylights**: On `style === 2`, `6`, or `7` with `area > 450` m², add 1–3 rooftop HVAC chiller boxes or linear roof monitor skylights along the building axis.
2. **Pitched-Roof Brick Chimneys (`roofType` in `1, 2, 3`)**:
   - On pitched roofs (`area >= 65` m²), extrude a `0.55m × 0.55m` brick/terracotta chimney stack rising `0.9m` above the mid-slope.

#### ACCEPTANCE CRITERIA
- Rooftops across Tuzla feature authentic 3D elevator penthouses, chimneys, solar water heaters, and industrial HVAC units in a single draw call per chunk.
- `npm run build` succeeds with 0 errors.
