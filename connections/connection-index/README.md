# connections/connection-index/

Documentation-only Connection Index surface.

The per-connection `connection-document.json` is the authoritative semantic record. This folder contains projections only:

- `index.json` — machine-readable Owner/automation index.
- `INDEX.md` — human-readable Owner view with clickable document links.
- `build.ts` — deterministic projection builder; it reads authoritative connection documents and the existing Connection Registry declarations. It does not register, execute, probe, or change runtime behavior.

To add a future connection, create its authoritative `connection-document.json` using the same semantic structure as `connections/dna-os-mcp/connection-document.json`, then rerun `npx tsx connections/connection-index/build.ts`. Do not add an independent status registry.
