# Phase 2 Execution Playbook: Photographic PBR Shader & Analytical Interior Mapping Engine

> [!TIP]
> **Zero-Geometry-Bloat Photorealism**
> Phase 2 upgrades `src/engine/materials.js` so every building wall renders with multi-channel PBR surface relief, 3D parallax interior rooms behind glass windows, and physical contact/weathering gradients at **zero additional vertex cost**.

---

### TICKET 2.1 — High-DPI Multi-Channel PBR Facade Atlas (`src/engine/materials.js`)

#### STRICT FILE ISOLATION
- `src/engine/materials.js`

#### DELIVERABLES
1. **Upgrade `facadeAtlas()` Resolution & Channels**:
   - Increase per-cell resolution from `S = 256` (`2048×512`) to `S = 384` (`3072×768`) or `S = 512` (`4096×1024`) across the `8×2` style grid.
   - Pack three distinct material channels into `uMask` (`R`, `G`, `B`):
     - `msk.r`: Wall tint blend weight (`1.0` = painted plaster/siding tinted by vertex colour, `0.0` = untinted stone/brick/frame trim).
     - `msk.g`: Window glass opacity/reflectivity mask (`1.0` = clear reflective window pane, `0.5` = semi-sheer curtain/blind behind glass, `0.0` = opaque frame/wall).
     - `msk.b`: Micro-relief / height bevel map (`0.5` = flat wall plane, `< 0.35` = recessed window reveal / mortar joint / slab groove, `> 0.65` = protruding window sill / mullion / cornice / balcony railing).
2. **Screen-Space Normal Perturbation from `msk.b`**:
   - In `buildingMaterial()` (`#include <normal_fragment_maps>`), compute screen-space derivatives `dFdx(msk.b)` and `dFdy(msk.b)` faded by distance (`clamp(1.0 - length(fwidth(vFacade)) * 2.5, 0.0, 1.0)`) to perturb `normal`, giving window frames, sills, brick courses, and corrugated panels crisp sunlit edge highlights.

#### ACCEPTANCE CRITERIA
- Window frames, sills, and industrial corrugations catch directional sunlight with realistic micro-bevel normals.
- `npm run build` succeeds with 0 errors.

---

### TICKET 2.2 — Analytical GLSL Ray-Box Interior Mapping (`src/engine/materials.js`)

#### STRICT FILE ISOLATION
- `src/engine/materials.js`

#### DELIVERABLES
1. **Pass Camera Position / View Ray to Fragment Shader**:
   - In `BUILDING_VERT_PARS` / `BUILDING_BEGIN`, pass `vWPos` and world normal `vWNorm = normalize(mat3(modelMatrix) * vec3(normal))`.
2. **Analytical 3D Room Parallax Behind Glass (`tzGlass > 0.25`)**:
   - When `tzGlass > 0.25` and the building is within `1.8 km` of `cameraPosition`:
     - Construct a tangent-space room box per window bay `(floor(vFacade.x), floor(vFacade.y))` with room depth `0.65` bay units.
     - Intersect the view ray `normalize(vWPos - cameraPosition)` with the interior room planes (ceiling, floor, back wall, side partition walls).
     - Render procedural interior details on the intersected plane:
       - Warm ceiling light fixture glow on the ceiling plane (`y > 0.85`).
       - Back-wall wallpaper/plaster tone with vertical curtain/blind strips near the window edges (`abs(cell.x - 0.5) > 0.28`).
       - Mix interior parallax colour with exterior sky/Fresnel reflection based on viewing angle (`pow(1.0 - max(0.0, dot(-viewDir, vWNorm)), 3.0)`).

#### ACCEPTANCE CRITERIA
- Orbiting at street level (`#40.8162,29.3035,0.12,15,68,14.5` and `#40.8485,29.2980,0.18,-30,62,17.5`) reveals 3D depth, ceilings, curtains, and rooms inside apartment and shop windows.
- Distant buildings (`> 1.8 km`) smoothly fade to zero-cost flat glass reflection.
- `npm run build` succeeds with 0 errors.

---

### TICKET 2.3 — Photographic Facade Weathering, Rain Streaks & Contact AO (`src/engine/materials.js`)

#### STRICT FILE ISOLATION
- `src/engine/materials.js`

#### DELIVERABLES
1. **Multi-Scale Analytical Ambient Occlusion**:
   - Ground contact AO: darken base of plinth (`smoothstep(-0.35, 0.25, vFacade.y)`).
   - Under-eave top cornice AO: darken top `0.25` of the highest floor (`smoothstep(0.0, 0.35, floors - vFacade.y)`).
   - Under-sill rain streaks: subtle vertical streaking below window sills (`cell.y` just below sill line) modulated by `tzNoise(vec2(vFacade.x * 14.0, id))`.
2. **Ground Splashback & Plinth Coursemarks**:
   - Add realistic horizontal stone/concrete coursing lines and subtle mossy/soil splashback near the bottom of the *subasman* plinth (`vFacade.y < 0.0`).

#### ACCEPTANCE CRITERIA
- Buildings appear grounded onto the terrain and roof eaves with realistic architectural dirt/AO gradients.
- `npm run build` succeeds with 0 errors.
