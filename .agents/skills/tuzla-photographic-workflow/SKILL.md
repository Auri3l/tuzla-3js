---
name: tuzla-photographic-workflow
description: >-
  Project Manager workflow, 8-phase roadmap, and high-performance Opus 5.5 ticket
  playbook for detailing every building in Auri3l/tuzla-3js to photographic level
  while maintaining 60 FPS WebGL2 performance.
---

# Tuzla-3JS Photographic Building Detailing Workflow

When working in this workspace (`D:\Antigrav Projects\Tuzla 3JS`) or generating prompts/code for `Auri3l/tuzla-3js`, follow the structured project management documents in the workspace root:

1. **[AGENTS.md](../../AGENTS.md)** — Core engine invariants, 44-byte vertex stride rules, single draw-call chunk batching, and visual QA camera hashes.
2. **[ROADMAP_MASTER.md](../../ROADMAP_MASTER.md)** — The complete 8-Phase Master PM Workflow & Work Breakdown Structure (Data Enrichment $\rightarrow$ PBR Mega-Atlas & Interior Mapping $\rightarrow$ 3D Sub-Elements $\rightarrow$ 24 Turkish Archetypes $\rightarrow$ 59 Mosques $\rightarrow$ Hero Landmarks).
3. **[PHASE1_PLAYBOOK.md](../../PHASE1_PLAYBOOK.md)** — Ready-to-run sequential Opus 5.5 tickets (Tickets 1.1 to 1.4) for Phase 1 with zero extra vertex memory and 75–90% shadow/picking GPU optimizations.

## Execution Procedure per Phase
1. Select the next sequential ticket from the active Phase Playbook.
2. Verify that only the files listed in `FILES IN SCOPE` are modified.
3. Enforce the 44-byte vertex layout (`position`, `normal`, `uv`, `color`, `info`) and bit-packing specification in `src/engine/geometry.worker.js` and `src/engine/materials.js`.
4. Run `npm run build` and test against the 5 Tuzla QA camera hashes before advancing to the next ticket.
