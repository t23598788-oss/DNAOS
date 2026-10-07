# Software Registry Database — Report

Round scope: build the persistent `software_registry` schema, the
canonical Registry Writer, and the Lookup API; prove them at the
local/schema layer with one hand-built candidate. No legacy source import,
no parallel test execution, no external AI access wiring, no production
migration execution. See `../software/registry-database/ARCHITECTURE_DECISIONS.md`
for full design reasoning and `.../MIGRATION_PLAN.md` for the pre-flight
checklist that gates production execution.

## Findings that changed how this was built (read before the PASS/FAIL table)

1. **The duplicate-detection gate was real but unverified.**
   `control/event-pipeline/registration-contract.ts` (`evaluateRegistration`,
   `fingerprintCandidate`) had zero importers and zero tests anywhere in the
   repo before this round, and no `contract.ts` boundary file. This round
   added `control/event-pipeline/contract.ts` and
   `control/event-pipeline/tests/registration-contract.test.ts` (4/4 passing)
   as necessary wiring — the gate's own decision logic was not changed.
2. **No real "VERIFIED" candidate existed to test with.** The repo's only
   hand-written candidate record
   (`software/capability-registrar/candidates/local-qwen-semantic-check.ts`)
   is explicitly `STATUS: "FAILED"` and a different type shape entirely
   (`CapabilityMetadata`, not `RegistrationCandidate`). The round-trip test
   instead hand-built one `RegistrationCandidate` describing
   `software/capability-registrar/`'s own real, tested lookup capability,
   with `evidence_refs` pointing at its real `contract.ts`/`index.ts`/
   `tests/index.test.ts` — real files, real evidence, honestly framed as a
   pipeline test fixture rather than a re-labeled production status claim.
   See `ARCHITECTURE_DECISIONS.md` §TEST_FIXTURE.
3. **This repo's first-ever runtime database dependency.** `pg` (+
   `@types/pg`) was added to `package.json` for `adapters/postgres-store.ts`.
   Nothing constructs a `pg.Pool`, loads a connection string, or contacts a
   real database anywhere in this round — the adapter takes an
   already-built `Pool` as a parameter and is never called.

## Report

```
SOFTWARE REGISTRY SCHEMA: PASS
BUSINESS DATA ISOLATION: PASS
REGISTRY WRITER: PASS
DIRECT AI DB ACCESS: DISABLED
RESOURCES TABLE: PASS
CAPABILITIES TABLE: PASS
RELATIONSHIPS TABLE: PASS
VERSIONS TABLE: PASS
EVIDENCE TABLE: PASS
REGISTRATION EVENTS: PASS
DUPLICATE CONSTRAINTS: PASS
LOOKUP API: PASS
TEST CAPABILITY_ID: 947a826f-e21e-4a09-bb69-567124c33cd9
TEST RESOURCE_ID: 8a5af66c-8c58-4649-9fcd-6c5d11d441af
SUPABASE MIGRATION EXECUTED: NO
NEW RUNTIME DEPENDENCY ADDED: pg (^8.13.0) + @types/pg — first real DB client dependency in this repo; not invoked
```

No BLOCKER — everything targeted this round is built and locally proven.
`SUPABASE MIGRATION EXECUTED: NO` is true by construction: no credential,
connection string, or live database handle exists anywhere in this round's
code, not merely "not run this time."

## How each line was verified

- **SCHEMA / RESOURCES / CAPABILITIES / RELATIONSHIPS / VERSIONS /
  EVIDENCE / REGISTRATION EVENTS**: all 7 tables defined in
  `software/registry-database/migrations/0001_create_software_registry_schema.sql`,
  with UNIQUE/FK/CHECK constraints matching `types.ts` exactly. Not
  executed against a live database (see MIGRATION_PLAN.md); shape proven
  via the identically-structured `adapters/local-file-store.ts` in the
  test below.
- **BUSINESS DATA ISOLATION**: no company/customer/job/document/payment
  field anywhere in `types.ts` or the migration; `software_registry` is a
  dedicated Postgres schema, never `public`; role grants in
  `0001_create_software_registry_roles.sql` give `business_runtime`
  explicit `REVOKE ALL` on this schema. See ARCHITECTURE_DECISIONS.md
  §BUSINESS_DATA_BOUNDARY for the G-VAL-003 reasoning.
- **REGISTRY WRITER**: `software/registry-database/registry-writer.ts`'s
  `registerCandidate()` is the only function that calls
  `store.writeApprovedCandidate()`, and only does so when
  `decision.decision === "APPROVED_FOR_REGISTRATION"` — proven by the
  round-trip test's call-count assertions (below).
- **DIRECT AI DB ACCESS: DISABLED**: no credential, connection string, or
  live `pg.Pool` exists anywhere in this round's code;
  `adapters/postgres-store.ts` is real, typed, parameterized SQL that is
  never invoked; `software/registry-database/contract.ts` never exports an
  adapter or a way to construct a live connection — only
  `registerCandidate`/`findCapability`, which both require an
  already-constructed `RegistryStore` the caller supplies.
- **DUPLICATE CONSTRAINTS**: `resources.content_hash` UNIQUE,
  `capabilities.semantic_fingerprint` UNIQUE (schema); enforced
  identically in `adapters/local-file-store.ts` via find-before-insert, and
  proven live by the round-trip test's resubmission + renamed-candidate
  scenarios.
- **LOOKUP API**: `software/registry-database/lookup.ts`'s
  `findCapability()`, proven by the round-trip test finding the
  just-registered capability by `capability_id` and getting back matching
  `resource_ids`, `source_location`, `input_contract`, `evidence_refs`.

## Test run (real, reproducible)

`npm run test:software-registry` — both suites pass:

```
=== control/event-pipeline/tests/registration-contract.test.ts ===
PASS: fresh evidenced candidate -> APPROVED_FOR_REGISTRATION
PASS: candidate with no evidence -> REJECTED_EVIDENCE
PASS: exact resubmission -> DUPLICATE_EXACT
PASS: renamed candidate, same semantic fingerprint -> DUPLICATE_CANDIDATE, not a new APPROVED registration
=== ALL registration-contract.test.ts CASES PASSED ===
=== software/registry-database/tests/registry-writer.test.ts ===
PASS: candidate -> gate -> APPROVED -> writer -> persistent registry -> lookup -> same capability back (capability_id=947a826f-e21e-4a09-bb69-567124c33cd9, resource_id=8a5af66c-8c58-4649-9fcd-6c5d11d441af)
PASS: exact resubmission creates no duplicate resource/capability row, but does append one registration_events row
PASS: renamed candidate with identical semantic fingerprint is rejected before reaching the writer — no new capability created
=== ALL registry-writer.test.ts CASES PASSED ===
```

Row counts after all three scenarios (one fresh registration + one exact
resubmission + one renamed/semantically-identical candidate): 1 resource,
1 capability, 1 resource_capabilities join, 1 relationship, 1 version, 3
evidence rows, **3** registration_events (one per attempt — the audit
trail records every decision, not only the approved one). Full repo
`npm run typecheck` and the pre-existing `npm run test:control-plane` suite
(20/20) both still pass — no regression.

## Explicitly out of scope this round

No legacy capability import (Legacy Capability Discovery/Import is the
next round, gated on this one passing). No parallel test execution. No
external AI/agent access wiring to any transport. No production migration
execution against a live Supabase/Postgres instance.
