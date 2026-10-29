# CLAUDE.md — Opus 5.5 Autonomous Ticket Runner (`Auri3l/tuzla-3js`)

## Immediate Action When Asked to "Start", "Continue", or "Run Next Ticket"
1. Open **[WORKFLOW_QUEUE.md](./WORKFLOW_QUEUE.md)** and locate the **first unchecked (`[ ]`) ticket** in strict numerical order (`Ticket 1.1` $\rightarrow$ `Ticket 8.2`).
2. Read the ticket's full technical specification in its linked Playbook:
   - Phase 1: **[PHASE1_PLAYBOOK.md](./PHASE1_PLAYBOOK.md)**
   - Phase 2: **[tickets/PHASE2_PLAYBOOK.md](./tickets/PHASE2_PLAYBOOK.md)**
   - Phase 3: **[tickets/PHASE3_PLAYBOOK.md](./tickets/PHASE3_PLAYBOOK.md)**
   - Phase 4: **[tickets/PHASE4_PLAYBOOK.md](./tickets/PHASE4_PLAYBOOK.md)**
   - Phase 5: **[tickets/PHASE5_PLAYBOOK.md](./tickets/PHASE5_PLAYBOOK.md)**
   - Phase 6: **[tickets/PHASE6_PLAYBOOK.md](./tickets/PHASE6_PLAYBOOK.md)**
   - Phase 7: **[tickets/PHASE7_PLAYBOOK.md](./tickets/PHASE7_PLAYBOOK.md)**
   - Phase 8: **[tickets/PHASE8_PLAYBOOK.md](./tickets/PHASE8_PLAYBOOK.md)**
3. Modify **only** the files listed in that ticket's `STRICT FILE ISOLATION` section.
4. Enforce all 5 Engine Invariants from **[AGENTS.md](./AGENTS.md)**:
   - **44-Byte Vertex Stride**: `position` (`Float32×3`), `normal` (`Int8×3`), `uv` (`Float32×2`), `color` (`Uint8×3`), `info` (`Float32×4`). Pack metadata into `info.y` and `info.w`.
   - **1 Draw Call per 1.6 km Chunk**: Batch all geometry into the chunk's `BufferGeometry`.
   - **Standalone Offline Bundle Compatibility**: Zero external CDN fetches; procedural textures/atlases must work in `tuzla-3d-preview.html`.
   - **Sloped Terrain Plinths (*Subasman*)**: `base = gMax + 0.0003` km, concrete/stone plinth down to `gy[i] - 0.0012` km.
   - **Urban Wall Topology (*Bitişik Nizam*)**: Shopfronts, awnings, and protruding balconies only on `wallRole == 0` (street-facing walls), never on `wallRole == 3` (blind party walls).
5. Run verification:
   ```bash
   npm run build
   ```
   *(And run `python scripts/enrich_osm.py` or `python scripts/build_standalone.py` when specified by the ticket).*
6. Update **[WORKFLOW_QUEUE.md](./WORKFLOW_QUEUE.md)** to mark the completed ticket `[x]`, commit your changes, and close the corresponding GitHub Issue if `gh` CLI is available.
