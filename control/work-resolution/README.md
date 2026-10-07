# control/work-resolution/

**หน้าที่:** resolve the EXISTING system before any coding Agent is
dispatched, so the Agent receives an executable work packet instead of a
discovery assignment.

```
WRITE INTENT
  → resolveWriteIntent()        ← Registry + Capability Index + filesystem + source scan
  → ResolvedWorkContext          ← decision + exact paths + reuse list + write scope
  → toWorkPacketFields()         ← hands down into ../scheduler/work-packet.ts's OWN shape
  → Agent: "implement only the missing piece"
  → enforceProposedWrite()       ← pre-write gate, before any mutation
```

## This EXTENDS `../scheduler/work-packet.ts` — it does not replace it

That file already owns the correct dispatch boundary ("a Processing
Resource must not scan the repo, must not walk folders"). What it lacked
was the resolution layer: no `decision`, no `existing_capability_id`, no
`exact_source_paths`, no `components_to_reuse`, no
`forbidden_write_scope`. This folder computes exactly those and hands them
over in that file's own field names via `toWorkPacketFields`. **It is not
modified, and no second packet format exists.**

## Two real limitations, found while building — disclosed, not hidden

**1. The Registry cannot prove absence.** `software/registry-database/store-port.ts`
exposes lookup-by-exact-key only (`findCapabilityById` /
`BySemanticFingerprint` / `ByCanonicalName`). There is no enumerate. So a
registry miss is never evidence that something does not exist. That is why
`MISSING_CONFIRMED` additionally requires a real source scan to come back
empty, and why source-proven-but-unregistered becomes `UNRESOLVED`
(dispatch blocked, reconcile first) rather than "missing, go build it".

**2. The Lookup API returns no runtime metadata.** Its result carries
`capability_id` / `resource_ids` / `source_location` / `input_contract` /
`output_contract` / `dependencies` / `evidence_refs` — no `behavior`, no
`source_system`. So `runtime_owner`, `runtime_type` and
`credential_boundary` are derived from the REAL source file instead:
credential names come from actual `Deno.env.get("X")` / `process.env.X`
call sites, runtime kind from the path convention the repo genuinely uses.
Nothing is inferred from a name.

## Three defects this resolver had, caught by its own tests

Recorded because each produced a *confident wrong answer*, which is worse
than a refusal:

1. **Pooled filename tokens matched the wrong capability.** Tokenizing all
   scan-hit filenames at once let words from unrelated files combine —
   "email reader" resolved onto `agent-host`. Fixed: tokenize per file, and
   require the matched capability's own source paths to point back at that
   exact file.
2. **Bare single-token candidates matched generic names.** A lone token
   like `runtime` matched a real but unrelated capability. Fixed: every
   candidate must carry at least two parts.
3. **A silent 40-file cap hid the answer.** `_shared/gmail-client.ts` was
   result **#141 of 170**, so "email reader" resolved to UNRESOLVED while
   the implementation sat just past the cut-off. Fixed: cap raised to 500
   and any truncation is now REPORTED in the probe detail, so it can never
   look like a clean miss.

A fourth, in the tests rather than the resolver: the "no AI in the
resolution path" scan matched the word `completion` inside this folder's
own `completion_conditions` field. Narrowed to vendor names and real
model-call shapes.

## Decision rules (fixed, no scoring model)

| Condition | Decision |
|---|---|
| Registry match, same repo | `EXTEND_EXISTING` |
| Registry match, different repo/runtime | `ADAPT_EXISTING` |
| No registry match, but a scan hit whose **filename** matches an intent token | `UNRESOLVED` (registry gap → reconcile) |
| No tokens to search | `UNRESOLVED` |
| Every source empty | `MISSING_CONFIRMED` |

Content-grep is OR over tokens, so one common word makes almost any intent
"hit" somewhere. Only a hit whose **filename** carries an intent token is
treated as evidence of an existing implementation — that is what separates
"the implementation lives here" from "this word appears in a comment".

## Verification

```
npx tsc --noEmit                                            # clean
npx tsx control/work-resolution/tests/runtime-proof.test.ts # 31 passed, 0 failed  (Node >=18)
```

Proven live against the real Registry: **A** "email reader" →
`ADAPT_EXISTING` / `gmail-readonly-reader`; **B** "machine observation" →
`EXTEND_EXISTING`; **C** registry gap → `UNRESOLVED`; **D** genuinely
absent → `MISSING_CONFIRMED`.

## Known gaps

- `input_contract` / `output_contract` / `dependencies` / `blueprint_refs`
  / `service_id` are returned **empty or UNKNOWN**. The Registry has the
  first two, but wiring them through was not done this round.
- Live Census is **not** consulted — `deriveCensus` needs observations +
  a verification ledger the caller must supply. The capability index and
  source scan cover the same ground more cheaply here.
- Enforcement is a **library call**, not a hook. Nothing forces an Agent
  through `enforceProposedWrite` yet; wiring it into
  `permissions/write-gate/` is the next step and is not built.
- Steps 6 (during-write observation) and 8 (persisting the resolution)
  are **not implemented** — see the task report.
