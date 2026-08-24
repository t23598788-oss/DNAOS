# control/ai-write-control/ — the Internal Control Agent

Owner-approved 2026-08-19. Turns a structured request from an
`ai_agent`/`external_program` Identity into a real `WriteIntent`
(`contracts/write-intent/write-intent.ts`) — **structural validation
only, never a permission decision**. `permissions/write-gate/` is the
only module allowed to say ALLOW/DENY/REUSE_EXISTING/UNKNOWN.

**Separate, locked boundary from `control/owner-command/`** (Owner,
2026-08-19): `control/owner-command/` stays the human-only Owner surface,
unchanged. This folder is structurally forbidden from accepting
`issued_by.kind === "human"`, and `control/owner-command/` is
structurally forbidden from accepting anything else — the two never
overlap.

## What's here

- `types.ts` — `RawWriteRequest`
- `ai-write-control.ts` — `submitWriteRequest(raw, requestingIdentity)`
- `contract.ts` — public boundary
- `host-runtime.ts` — id/time only

## NOT_YET_BUILT

No transport (the "DNA OS Control API" from Owner's architecture
diagram) wires a real external AI call into `submitWriteRequest` yet —
see `./tests/`, which drives this module directly.
