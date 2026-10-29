# Phase 5 Execution Playbook: Religious Architecture Overhaul (All 59 Named Mosques)

> [!TIP]
> **Authentic Ottoman & Contemporary Turkish Mosque Architecture**
> Phase 5 upgrades the mosque generator in `src/engine/geometry.worker.js` (lines 318–357) and shader styling in `src/engine/materials.js` so all ~59 mosques in Tuzla feature authentic multi-dome superstructures, arched clerestory drums, entrance porticos (*son cemaat yeri*), and detailed Turkish minarets.

---

### TICKET 5.1 — Mosque Classifier & Multi-Dome Ottoman Superstructure (`src/engine/geometry.worker.js` & `src/engine/materials.js`)

#### STRICT FILE ISOLATION
- `src/engine/geometry.worker.js`
- `src/engine/materials.js`

#### DELIVERABLES
1. **Trigger on Both `kind === 5` AND Mosque Names**:
   - In `src/engine/geometry.worker.js`, run the mosque generator for any building where `b[3] === 5` OR `names[id]` matches `cami` / `mescit`.
   - Force mosque walls to use cut limestone / *küfeki* stone palette (`#e6dfd1`, `#ded5c3`, `#d6cbb8`) with arched window bays (`style = 5`).
2. **Octagonal Drum + Central Lead Dome + Corner Cupolas**:
   - Extrude an octagonal stone drum (*kasnak*, height `0.28 * rd`) beneath the main hemispherical lead dome (`roofStyle = 114`).
   - For medium/large mosques (`area >= 220` m²), add 4 smaller corner cupolas (`0.38 * rd`) or 3 entrance portico domes (*son cemaat yeri*) along the front edge.
   - Enhance the lead dome shader (`rStyle == 14` in `src/engine/materials.js`) with radial standing-seam lead ribs and a gilded bronze *alem* finial at the apex.

#### ACCEPTANCE CRITERIA
- Every mosque in Tuzla (both named POIs and `kind == 5` polygons) displays a cut-stone prayer hall, octagonal drum, ribbed lead main dome, and side cupolas.
- `npm run build` succeeds with 0 errors.

---

### TICKET 5.2 — High-Detail Turkish Minaret Generator (`src/engine/geometry.worker.js`)

#### STRICT FILE ISOLATION
- `src/engine/geometry.worker.js`

#### DELIVERABLES
1. **Anatomically Accurate Turkish Minaret (`src/engine/geometry.worker.js`)**:
   - Upgrade the minaret builder (lines 338–356) to generate:
     - **Square Stone Plinth (*Kaide*)**: from ground `g` up to `top * 0.85`.
     - **Chamfered Transition (*Küp / Pabucu*)**: tapering from the square base to the cylindrical shaft.
     - **12-Sided Stone Shaft (*Gövde*)**: with subtle vertical fluting normals.
     - **Corbelled Balcony (*Şerefe*)**: flared *mukarnas* underside corbel + carved stone balustrade ring (`1.65 * mr`).
     - **Twin *Şerefe* on Large Mosques**: mosques with `area > 550` m² receive 2 *şerefe* balconies and a second minaret on the opposite front corner.
     - **Conical Lead Spire (*Külah*) & Finial (*Alem*)**: dark lead-grey (`LEAD`) conical roof (`roofStyle = 114`) topped by a thin bronze finial spike.

#### ACCEPTANCE CRITERIA
- Minarets feature realistic square bases, *şerefe* balconies, lead *külah* cones, and twin minarets on grand mosques.
- `npm run build` succeeds with 0 errors.
