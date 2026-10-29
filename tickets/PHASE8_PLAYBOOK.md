# Phase 8 Execution Playbook: Two-Tier Chunk LOD Streaming & Standalone Offline Packaging

> [!TIP]
> **Locked 60 FPS + Single-File Offline HTML Delivery**
> Phase 8 splits fine 3D micro-details (`balconies`, `awnings`, `rooftop solar/chimneys`) into a distance-culled `chunk.details` mesh (`visible < 1.8 km`) while keeping `chunk.shell` visible to the horizon, and packages the entire application into `tuzla-3d-preview.html`.

---

### TICKET 8.1 — Two-Tier Chunk Geometry Split (`chunk.shell` vs. `chunk.details`) (`src/engine/geometry.worker.js` & `src/engine/index.js`)

#### STRICT FILE ISOLATION
- `src/engine/geometry.worker.js`
- `src/engine/index.js`

#### DELIVERABLES
1. **Split Chunk Buffers in `src/engine/geometry.worker.js`**:
   - Each spatial chunk (`1.6 km × 1.6 km`) maintains two `Buf` sets using the identical 44-byte vertex layout:
     - `shell`: primary building walls, plinths, roofs, mosque domes/minarets, and hero landmarks (visible up to `scene.fog.far`).
     - `details`: 3D balconies, 3D shop awnings, chimneys, solar heaters, and small rooftop clutter (visible only when chunk distance `< 1.8 km`).
2. **Distance-Gated Rendering in `src/engine/index.js`**:
   - Instantiate `mShell` and `mDetails` per chunk sharing `bMat` and `bDepth`.
   - In `render()`, set `mDetails.visible = mShell.visible && (cd < 1.8)` and `mDetails.castShadow = Q.shadow >= 4096 && (cd < 0.9)`.

#### ACCEPTANCE CRITERIA
- Overview camera (`dist > 5 km`) skips all micro-detail vertices (`0` GPU cost at distance), while street/neighborhood views (`dist < 1.8 km`) seamlessly display full 3D balconies, awnings, and rooftop details at 60 FPS.
- `npm run build` succeeds with 0 errors.

---

### TICKET 8.2 — Final Production Build & Standalone Single-File Bundle (`scripts/build_standalone.py`)

#### STRICT FILE ISOLATION
- `scripts/build_standalone.py`
- `tuzla-3d-preview.html`

#### DELIVERABLES
1. **Rebuild & Verify Standalone Bundle**:
   - Run `npm run build`.
   - Run `python scripts/build_standalone.py` to embed the compiled `dist/` bundle, enriched `public/data/tuzla-osm.json`, terrain, ground imagery, water mask, and fonts into `tuzla-3d-preview.html`.
   - Verify that `tuzla-3d-preview.html` contains zero unresolved asset placeholders and works 100% offline.

#### ACCEPTANCE CRITERIA
- `npm run build` and `python scripts/build_standalone.py` succeed with 0 errors.
- All 25 tickets in `WORKFLOW_QUEUE.md` are marked `[x]`.
