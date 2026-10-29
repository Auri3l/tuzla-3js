Execute the next sequential ticket in `WORKFLOW_QUEUE.md`:

1. Read `WORKFLOW_QUEUE.md` and find the first unchecked `- [ ] **Ticket X.Y**` item in order.
2. Open the linked playbook (`PHASE1_PLAYBOOK.md` or `tickets/PHASE<X>_PLAYBOOK.md`) and read the full specification for `Ticket X.Y`.
3. Implement `Ticket X.Y` adhering strictly to `FILES IN SCOPE` and the 44-byte vertex stride invariants in `AGENTS.md`.
4. Run `npm run build` (and `python scripts/enrich_osm.py` or `python scripts/build_standalone.py` if required by the ticket) and fix any errors.
5. Mark `- [x] **Ticket X.Y**` in `WORKFLOW_QUEUE.md`, commit the changes, and close the matching GitHub Issue if applicable.
