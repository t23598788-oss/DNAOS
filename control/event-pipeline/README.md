# control/event-pipeline/

หน้าที่: canonical event ingestion (`canonical-event-pipeline.ts`, idempotent
via sha256 `idempotency_key`, appends to `data/*.jsonl`, enqueues into
`../work-coordination/`) + the registration/duplicate-detection gate
(`registration-contract.ts`: `fingerprintCandidate`, `evaluateRegistration`
→ `APPROVED_FOR_REGISTRATION | DUPLICATE_EXACT | DUPLICATE_CANDIDATE |
REJECTED_EVIDENCE`). These are two related but distinct concerns living in
one folder: event ingestion is a coordination-log concern; the registration
gate is a pure decision function over a candidate + an `existing` snapshot
the caller supplies — it does not itself read `data/registry.jsonl` or any
other persisted state.

Input: `SourceEvent` (event ingestion) / `RegistrationCandidate` +
`existing: readonly RegistrationCandidate[]` (registration gate).

Output: `PipelineResult` (event ingestion) / `RegistrationDecision`
(registration gate) — see `contract.ts`.

Dependency ที่อนุญาต: `../work-coordination/` (event ingestion only).
`registration-contract.ts` has no dependencies.

สิ่งที่ห้ามแตะ: never import `./registration-contract.ts` or
`./canonical-event-pipeline.ts` directly from outside this folder — go
through `./contract.ts`. `data/registry.jsonl` (written by
`ingestSource()`) is a coordination ledger keyed by
resource_id/capability_id/event_id — it is not the same thing as
`software/registry-database/`'s `software_registry.registration_events`
table (a persistent, DB-backed audit trail of registration *decisions*
specifically). Do not conflate the two when reading either.

**สถานะ:** `registration-contract.ts`'s logic is real, but until this
round it had zero importers and no test anywhere in the repo — see
`tests/registration-contract.test.ts` for the first proof it actually
produces all four decision outcomes correctly.
