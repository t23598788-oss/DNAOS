# control/registration-pipeline/

หน้าที่: Registration Pipeline, single-owner sequential stages:

```
INPUT
  -> VALIDATION            (./validation.ts)
  -> CLASSIFICATION        (../event-pipeline/contract.ts — classifyCandidate)
  -> DUPLICATE RESOLUTION  (./duplicate-resolution.ts)
  -> REGISTRATION DECISION (./decision.ts — pure combinator)
  -> REGISTRY WRITER       (../../software/registry-database/contract.ts —
                             commitRegisteredCandidate, write-only)
  -> [ existing, untouched: control/artifact-destination/,
       control/target-resolution/, control/permission-policy-resolution/ —
       none of these re-classify or re-check duplicates ]
  -> NEXT STAGE (Admission/Execute — not built)
```

`control/registration-pipeline/contract.ts`'s `runRegistrationPipeline()`
is the one real entry point. `transport/owner-command-http/server.ts`
(`POST /registry/candidates`) and `control/work-result-ingress/ingress.ts`
are its only two live callers — neither one calls classification,
duplicate resolution, or the writer directly any more.

## Stage ownership — exactly one owner each

| Stage | Owner | Checks duplicate? | Writes registry? | Decides destination? |
|---|---|---|---|---|
| VALIDATION | `./validation.ts` | No | No | No |
| CLASSIFICATION | `../event-pipeline/registration-contract.ts`'s `classifyCandidate` | No | No | No |
| DUPLICATE RESOLUTION | `./duplicate-resolution.ts` | **Yes — the only stage that does** | No | No |
| REGISTRATION DECISION | `./decision.ts` | No (combines 2+3, recomputes neither) | No | No |
| REGISTRY WRITER | `software/registry-database/registry-writer.ts`'s `commitRegisteredCandidate` | No | **Yes — only for an already-APPROVED candidate** | No |
| Destination/Target/Policy | `control/artifact-destination/`, `control/target-resolution/`, `control/permission-policy-resolution/` (unchanged) | No | No | Destination: yes; Target/Policy: use its result |

`software/registry-database/adapters/*.ts`'s `writeApprovedCandidate`
(the store's own low-level write) performs **technical idempotency only**
— the same `resource_id`/`capability_id` submitted twice is a no-op. It
never decides whether two candidates are the *same* by content — that
decision is Duplicate Resolution's alone, made **before** the store is
ever called to write.

## Duplicate Resolution's closed result set

`DuplicateResolutionStatus` is exactly `UNIQUE | DUPLICATE_EXACT |
DUPLICATE_SEMANTIC | UNRESOLVED_DUPLICATE` — nothing else. It queries the
real, current canonical registry (`store.findResourceByContentHash`,
`store.findCapabilityBySemanticFingerprint`) — never a caller-supplied
`existing` snapshot. A lookup failure is `UNRESOLVED_DUPLICATE`, fail
-closed, never treated as UNIQUE.

## UNRESOLVED handoff — never a guess, never a fallback

When Classification or Duplicate Resolution cannot conclude,
`runRegistrationPipeline()` returns:

```ts
{
  status: "UNRESOLVED",
  failed_stage, reason_code,
  resource_id, candidate_id,
  known_facts, missing_information,
  evidence_refs, correlation_id,
  work_item_task_id,
}
```

and `./explain-resource.ts` creates one real `Task`
(`output_lane: "WORK_ITEM"`, `status: "EXECUTING"`) plus one `Evidence`
row (`kind: "explain_resource_request"`) through
`control/agent-gateway/contract.ts`'s already-existing, disk-backed
store — no new store, no new registry.

**The Agent's job on this task is bounded:** read the artifact/source
cited, explain what it does, cite evidence/references. It may **not**
choose a database/table/destination, may **not** write the registry
directly, and may **not** set a final classification. It sends its
explanation back through the existing DNA OS MCP
(`connections/dna-os-mcp/`'s `submit_registration_candidate`) — ordinary
new evidence plus a *proposed* `resource_type`/`domain`. That resubmitted
candidate re-enters at exactly the same `runRegistrationPipeline()` call
— Classification is still the only thing that decides whether the
proposal is accepted, exactly as for any other candidate. The Agent
supplies information; the deterministic pipeline decides.

Input: `RegistrationCandidate`, a real `RegistryStore`, `correlation_id`.
Output: `runRegistrationPipeline` -> `PipelineResult`.
Dependency ที่อนุญาต: `./validation.ts`, `./duplicate-resolution.ts`,
`./decision.ts`, `./explain-resource.ts`, `./types.ts`,
`../event-pipeline/contract.ts`,
`../../software/registry-database/contract.ts`.
สิ่งที่ห้ามแตะ: never call `classifyCandidate`/`fingerprintCandidate`/
`resolveDuplicate`/`commitRegisteredCandidate` more than once per
candidate. Never let a downstream stage (destination/target/policy)
re-derive resource_type/domain or re-check for a duplicate — they
consume this pipeline's result directly.
