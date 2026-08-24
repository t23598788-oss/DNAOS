# control/work-result-ingress/

หน้าที่: the canonical Work Result Ingress — closes the gap where
`submit_work_result` (via `POST /handoff`) used to write straight into
`control/agent-gateway/`'s handoff store with no classification at all.

```
Agent
  -> submit_work_result
  -> Work Result Ingress (this folder)
  -> validate task/worker/session
  -> classify result contents
  -> split artifacts
  -> candidate(s)
  -> Registration Pipeline (control/event-pipeline/evaluateRegistration)
  -> Registry (software/registry-database/registerCandidate)
  -> handoff/evidence reference
  -> next decision
```

**The handoff record is now evidence that a delivery happened, never the
destination of the work.** A work result naming 3 changed files, 1 test
result, and 1 new capability is split into 5 separate Registration
Candidates before anything is registered — never one resource standing in
for the whole handoff. Each candidate goes through the real,
unmodified Registration Pipeline (Domain Classification -> Registration
Gate -> Registry Writer) exactly like `POST /registry/candidates` does —
no shortcut, no separate decision engine.

## Splitting rule (deterministic — see `./classifier.ts`)

| WorkResultInput field | becomes | resource_type | domain |
|---|---|---|---|
| each `files_changed[]` entry | one candidate | `SOURCE_REFERENCE` | `SOFTWARE_CONTROL_PLANE` |
| each `tests_run[]` entry | one candidate | `TEST_RESULT` | `ENGINEERING_EVIDENCE` |
| each `capabilities_introduced[]` entry (optional, explicitly agent-declared — never inferred) | one candidate | `CAPABILITY` | `SOFTWARE_CONTROL_PLANE` |

Every generated candidate carries the submitting agent's own
`evidence_refs` — nothing invented. If `evidence_refs` is empty, every
split candidate is honestly `REJECTED_EVIDENCE` by the same Registration
Gate every other candidate goes through.

## Admission (unchanged from before, just relocated to one place)

`ingestWorkResult()` runs the exact task/status/duplicate-submission
checks `transport/owner-command-http/server.ts`'s `handleAgentHandoff`
used to run inline — task must exist and carry an admitted `work_order`,
status must be `EXECUTING`/`VERIFYING`, no duplicate active submission —
plus the existing field-level `validateHandoff` checks. None of that
admission logic changed; it just now lives in one canonical function
instead of split between a transport file and the agent gateway.

## Result shape

`WorkResultIngressResult.status` is `REGISTERED` (every artifact
succeeded — or zero artifacts were declared, e.g. a pure status/blocker
report), `PARTIALLY_REGISTERED` (some artifacts failed — every one still
reported honestly, never silently dropped), or `REJECTED` (admission
failed before anything was classified, or every artifact failed).
`handoff_id`/`dna_os_decision` come from the real, now-recorded
`HandoffRecord`, which itself carries `registered_artifacts` — the real
`resource_id`/`capability_id` each split piece became.

## Responsibility boundary (Owner, 2026-08-21, SOFTWARE PRODUCTION PATH COMPOSITION round)

`control/work-result-ingress/` owns **POST-WORK result ingestion and
registration** — an Agent has already done real work (in its own real,
isolated `control/source-workspace/` worktree) and is submitting the
result. `control/agent-production-ingress/` owns **PRE-WRITE production
preparation** only (repository authority -> work ownership -> workspace
isolation -> existing asset lookup -> duplicate reservation) — it never
continues past its own `COMPLETE`. `control/external-system-lifecycle/`
is reused only for the lifecycle stages it genuinely owns (Model/
Provider/External-System registration with deploy-plan/runtime-verify) —
none of these three folders was merged into another; each keeps its own
real contract, composed only through those contracts.

`./continuation.ts`'s `continueRegisteredArtifact()` extends THIS
folder's own POST-WORK ownership one real step further: once an artifact
this folder just registered is genuinely `REGISTERED` (never DUPLICATE/
REJECTED/UNRESOLVED), it continues through the already-real, already-
verified `control/artifact-destination/` -> `control/target-resolution/`
-> `control/permission-policy-resolution/` -> `control/admission/` ->
(ADMITTED only) `control/source-execution/` -> (SUCCEEDED only)
`control/post-commit-verification/` — every one of those through its own
real, unmodified `contract.ts`, never recomputed here. See
`./continuation.ts`'s own header and
`./tests/canonical-flow-trace.test.ts` for the full, real, traced proof.

Input: `WorkResultInput`, a `RegistryStore` the caller already holds.
Output: `WorkResultIngressResult`.
Dependency ที่อนุญาต: `../agent-gateway/contract.ts`,
`../event-pipeline/contract.ts`, `../../software/registry-database/contract.ts`,
`../artifact-destination/contract.ts`, `../target-resolution/contract.ts`,
`../permission-policy-resolution/contract.ts`, `../admission/contract.ts`,
`../source-execution/contract.ts`, `../post-commit-verification/contract.ts`
(the last five for `./continuation.ts` only).
สิ่งที่ห้ามแตะ: never register an artifact before admission passes. Never
let a partial failure disappear — every artifact's real decision is
always in the result. Never let a DUPLICATE/REJECTED/UNRESOLVED
registration outcome reach `continueRegisteredArtifact()`'s real
continuation.
