# Phase 7 Execution Playbook: Street-Level Micro-Environment & Night Photorealism

> [!TIP]
> **Street-Walk & Night-Time Atmosphere**
> Phase 7 brings street-level walk mode (`dist = 0.002`) and dusk/night rendering (`uNight > 0`) to photographic quality.

---

### TICKET 7.1 — Ground-Floor Street Life: 3D Shop Awnings, Entrance Canopies & Parcel Walls (`src/engine/geometry.worker.js` & `src/engine/materials.js`)

#### STRICT FILE ISOLATION
- `src/engine/geometry.worker.js`
- `src/engine/materials.js`

#### DELIVERABLES
1. **3D Sloped Shopfront Awnings (*Tente*) & Entrance Canopies**:
   - On street-facing commercial/apartment walls (`wallRole === 0`, `style` in `0, 4, 6`) along primary/secondary/residential streets:
     - Extrude a sloped 3D awning wedge (`1.1m` projection at `height = 3.1m` above `base`) over ground-floor shop bays so street-level walk mode has physical overhead shop awnings.
   - On civic/hospital/university/office buildings (`style` in `1, 5`), extrude a horizontal cantilevered entrance canopy over the main street-facing bay.

#### ACCEPTANCE CRITERIA
- Walking at street level in Postane or İçmeler shows 3D shop awnings and building entrance canopies overhead.
- `npm run build` succeeds with 0 errors.

---

### TICKET 7.2 — Night-Time Photorealism: Warm/Cool Interiors, Illuminated Shop Vitrines, *Eczane* Signs & Floodlit Landmarks (`src/engine/materials.js`)

#### STRICT FILE ISOLATION
- `src/engine/materials.js`

#### DELIVERABLES
1. **Rich Night-Time Emissive Shader (`uNight > 0`)**:
   - **Multi-Temperature Residential Windows**: vary lit room colour temperature per bay/floor between warm tungsten (`2700K`), neutral warm white (`3500K`), TV-screen cool blue flicker (`6500K`), and dim hallway glow on stairwell bays.
   - **Ground-Floor Commercial Vitrines (`row == 0.0` & `wallRole == 0.0`)**: keep street-facing ground-floor shops brightly lit in the evening with illuminated fascia sign bands and occasional glowing red/green pharmacy/market signage accents.
   - **Floodlit Mosque Domes & Minarets**: add warm architectural uplighting (`tzGlow`) on mosque domes (`rStyle == 14`) and minaret *şerefe* balconies (`rStyle == 15`) at night.

#### ACCEPTANCE CRITERIA
- Night and dusk views (`#40.8162,29.3035,0.12,15,68,20.5`) display realistic warm shopfronts, varied apartment rooms, and softly floodlit mosques.
- `npm run build` succeeds with 0 errors.
