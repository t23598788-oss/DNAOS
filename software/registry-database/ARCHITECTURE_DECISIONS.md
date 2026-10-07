# software/registry-database/ — Architecture Decisions

Scope: build the persistent `software_registry` schema, the Registry
Writer, and the Lookup API this round; prove them at the local/schema
layer with one hand-built candidate; no legacy source import, no parallel
test execution, no external AI access wiring, no production migration
execution.

## §FOLDER_PLACEMENT — duplicate/overlap check (Capability Folder Law ข้อ 4)

Checked every existing candidate location before creating this folder:

- `software/software-registry/` (`software.ts`, `software-registration.ts`)
  — a different concept entirely: `Software` there means an *external
  calling-client program identity* (e.g. `"kimi-code-cli"`), a resource an
  Account can be granted use of (see
  `../../permissions/software-scope/resource-grant.ts`). Not reused, not
  touched.
- `software/module-registry/`, `software/repository-registry/` — both
  empty stubs, explicitly narrower scope (module-level only / repo-metadata
  only per their own READMEs). Left alone.
- `software/capability-registrar/` — real, working, tested (`index.ts`,
  `contract.ts`, `tests/index.test.ts`, 2026-08-19), already depended on by
  `../../permissions/write-gate/types.ts`'s `WriteGateContext.registryIndex`.
  Its own header: *"ห้ามสร้าง registry คู่ขนานใหม่"* (no parallel registry).
  Verified this is not what that forbids: `capability-registrar` is a
  read-only in-memory projection of *this repo's own* folders (sourced from
  `../../control/command-router/capability-registry.ts`); this schema is a
  read/write, DB-backed graph of *externally-discovered* resources/
  capabilities. Referenced via its `contract.ts` for the test fixture only
  (§TEST_FIXTURE below), never modified, never duplicated.
- `../../control/event-pipeline/data/registry.jsonl` (written by
  `canonical-event-pipeline.ts`'s `ingestSource()`) — an idempotency-keyed
  event-ingestion ledger (resource_id/capability_id/event_id per canonical
  event), a coordination-log concern. Distinct from this schema's
  `registration_events` table (an audit trail of *registration decisions*
  specifically — approved/duplicate/rejected, not general event traffic).
  Noted here so the name similarity is never mistaken for the same table.

Decision: new capability folder `software/registry-database/`.

## §BUSINESS_DATA_BOUNDARY (G-VAL-003)

G-VAL-003: *"ห้าม migration/schema ของ Business Data ใน repo นี้"* — no
migration/schema of business data in this repo, framed as an unqualified
"never." `software_registry` stores control/infrastructure metadata
*about* software (resource identity, capability semantics, versions,
evidence references, registration decisions) — never company/customer/job/
document/payment content, and never a copy of business records. This
repo's own root `README.md` explicitly lists "Software Registry" among
what this repo is allowed to hold. Read as in-scope, not an exception to
G-VAL-003 — but flagged explicitly here since this is the first schema/
migration this repo has ever had, and G-VAL-003 deserves scrutiny on every
schema added under it, not a one-time judgment call.

## §DUPLICATE_GATE_WIRING

`../../control/event-pipeline/registration-contract.ts` (`evaluateRegistration`,
`fingerprintCandidate`) is real, correct-looking logic — but before this
round it had zero importers anywhere in the repo, no tests, and no
`contract.ts` boundary file (required by Capability Folder Law ข้อ 9 before
any other folder may import it). This round adds
`../../control/event-pipeline/contract.ts` (thin re-export, no logic
change) and `../../control/event-pipeline/tests/registration-contract.test.ts`
(proves all four `DuplicateDecision` outcomes) as necessary glue — not a
redesign of the gate. `registry-writer.ts` consumes its output
(`RegistrationDecision`) but never re-implements duplicate detection.

## §TEST_FIXTURE — no real "VERIFIED" candidate exists

The task asked to test with one already-VERIFIED candidate. The only
hand-written candidate record anywhere in this repo
(`../capability-registrar/candidates/local-qwen-semantic-check.ts`) is
explicitly `STATUS: "FAILED"`, with its own header forbidding it ever
being marked VERIFIED — and it is a different type shape entirely
(`CapabilityMetadata`, not `RegistrationCandidate`; the two schemas are
unrelated). Re-labeling it VERIFIED to satisfy the letter of the task would
violate this repo's own G-VAL-001 ("ห้าม fabricate capability หรือ
status").

Resolution: `tests/registry-writer.test.ts` hand-builds one
`RegistrationCandidate` describing `software/capability-registrar/`'s own
real, tested capability lookup logic — real `evidence_refs` pointing at its
real `contract.ts`/`index.ts`/`tests/index.test.ts`. This is the "one
hand-verified candidate, not a bulk/legacy import" the task asked for,
honestly framed as a registration-pipeline test fixture rather than a
re-labeled production status claim.

## §KIND_TO_ROW_MAPPING

`RegistrationCandidate.kind` is `"resource" | "capability"` — one or the
other, never both on a single candidate. Every `APPROVED_FOR_REGISTRATION`
candidate produces a `resources` row (`content_hash` = the candidate's own
`fingerprint.exact` — the writer never reads real file bytes, so this
deterministic per-candidate hash, already computed upstream by
`fingerprintCandidate()`, is what identifies the resource). When
`kind === "capability"`, it additionally produces a `capabilities` row
(`semantic_fingerprint` = `fingerprint.semantic`) plus a
`resource_capabilities` join row and a `MODULE_TO_CAPABILITY` relationship.
`resource_type`/`capability_type` default to fixed placeholder values
(`"MODULE"`/`"FUNCTION"`) because `RegistrationCandidate` carries no field
distinguishing a richer taxonomy yet — a real, flagged schema gap (see
`registry-writer.ts`'s own header), not invented.

## §IDEMPOTENCY — two layers, store layer is authoritative

Layer 1 (unchanged): `evaluateRegistration`'s advisory check against a
caller-supplied `existing` snapshot. Layer 2 (this folder's own guarantee):
`store-port.ts`'s `writeApprovedCandidate()` contract requires uniqueness
enforcement on `content_hash` (resources) and `semantic_fingerprint`
(capabilities) regardless of whether the upstream `existing` snapshot was
complete or stale. `adapters/local-file-store.ts` enforces this via
find-before-insert; `adapters/postgres-store.ts`'s real SQL uses
`insert ... on conflict (...) do update ... returning (xmax = 0) as
inserted` — never `do nothing returning *`, which silently returns zero
rows on the conflict path and would break exactly the "tell me if this was
new or existing" guarantee idempotency depends on.

`registration_events` is unconditional: `registerCandidate()` appends
exactly one event row for every call — approved, duplicate-exact,
duplicate-candidate, or rejected-evidence. Only the entity tables
(resources/capabilities/relationships/versions/evidence) are gated on
`APPROVED_FOR_REGISTRATION`. A resubmission that collapses into an
existing row still produces a new `registration_events` row (with
`duplicate_result` pointing at the existing id) — the audit trail records
every attempt, not only the first success.

## §PG_OVER_SUPABASE_JS

The task requires real Postgres ROLE-based access separation
(`business_runtime` / `software_registry_runtime` / `registry_writer`,
`migrations/0001_create_software_registry_roles.sql`), which maps directly
onto Postgres `CREATE ROLE`/`GRANT`/`REVOKE` and awkwardly onto Supabase's
client-key+RLS model. `pg` is added to `package.json` as this repo's
first-ever runtime database dependency — called out explicitly in
`../../reports/SOFTWARE_REGISTRY_DATABASE_REPORT.md` as its own line, not
left implicit under "migration not executed." No credential, connection
string, or live database is touched by this dependency addition —
`adapters/postgres-store.ts` receives an already-built `pg.Pool` and is not
invoked anywhere this round.

## §RELATIONSHIPS_VOCABULARY_NOT_SHARED_WITH_WRITE_INTENT

`../../contracts/write-intent/write-intent.ts` already defines
`WriteTargetType = FILE|MODULE|FUNCTION|API|TABLE|CONTRACT|CAPABILITY`.
`types.ts`'s `RelationshipEntityType` (`FILE|MODULE|CAPABILITY|WORKER|API|
TEST|DEPENDENCY|OWNER`) partially overlaps but is a deliberately separate
vocabulary: relationship-graph node kinds describe what the registry graph
connects (including workers, tests, dependencies, ownership — none of
which are write-gate targets), not what a write operation targets. Sharing
one union between the two domains would force an artificial coupling
between an access-control concern and a graph-modeling concern; kept
separate on purpose.
