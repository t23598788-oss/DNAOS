# control/output-routing/

หน้าที่: Output Routing — the second half of the Output Contract split
(`contracts/command/output-contract.ts`):

```
SYSTEM_STATE → registered output destination → API/read model → registered UI surface
WORK_ITEM    → registered worker capability   → MCP/Agent      → result back to DNA OS
```

**The rule this folder exists to enforce: no capability_id's destination
is ever hardcoded in logic.** `./output-router.ts`'s `resolveOutputConsumers()`
only reads `./consumer-registry.ts` and reports whichever REGISTERED
consumer(s) actually claimed that lane+capability_id — or
`NO_REGISTERED_CONSUMER` if none did. That is a real, honest answer, not
a fallback guess. Adding a route means registering a consumer, never
adding an `if (capability_id === "...")` somewhere.

## Registry, not hardcoding

- **WORK_ITEM consumers are never hand-listed.** They're derived
  directly from `control/agent-gateway/workers.ts`'s
  `DEFAULT_AGENT_WORKERS` — the one real Worker list `submitTask` itself
  dispatches to (that file's own docstring names the exact failure mode
  this avoids: two independent worker lists drifting out of sync).
- **SYSTEM_STATE consumers are hand-listed, but every entry carries a
  real `evidence_ref`** naming exactly which file/docstring in this repo
  establishes the relationship. Today that's two entries: `dna-os-deadboard`
  (documented in `transport/owner-command-http/server.ts`'s own header as
  the real UI consumer of `POST /command`) and `connections/dna-os-mcp`
  (this repo's own MCP read tools). Nothing else is registered — most
  `capability_id`s correctly resolve to `NO_REGISTERED_CONSUMER` right
  now, and that is the honest state, not a gap to paper over with a
  guess.

## Wired into

`control/owner-command/owner-command.ts`'s `submitOwnerCommand()` —
`SubmitOwnerCommandOutcome.output_routing` is computed from
`output_contract` via `resolveOutputConsumers()`, same pattern as
`output_contract` itself.

Input: a `DnaOsOutput` (`contracts/command/output-contract.ts`).
Output: `OutputRoutingResult` — `status: "ROUTED" | "NO_REGISTERED_CONSUMER"`
plus the real matched consumer list.
Dependency ที่อนุญาต: `./consumer-registry.ts`, `./output-router.ts`,
`./types.ts`, `../agent-gateway/contract.ts` (`DEFAULT_AGENT_WORKERS` only).
สิ่งที่ห้ามแตะ: never add a SYSTEM_STATE registry entry without a real
`evidence_ref`. Never hand-list a WORK_ITEM consumer — derive it from
`DEFAULT_AGENT_WORKERS`. Never let `resolveOutputConsumers()` fall back to
a default/guessed consumer — `NO_REGISTERED_CONSUMER` is correct when
nothing matches.
