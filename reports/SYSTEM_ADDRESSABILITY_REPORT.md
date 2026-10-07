# System Addressability & Direct Resolution — Report

Round scope: DISCOVERY → PROVE → EXTEND_EXISTING → TEST → REGISTER → STOP.
No new architecture, UI, dashboard, registry, or agent created. AI memory
is not the source of truth anywhere in this round's code — every answer
`resolveSystemReference()` gives comes from a real, already-existing
registry read.

## Phase 1 — Discovery: authoritative owners (13 entity kinds)

| Entity kind | Authoritative owner | Status |
|---|---|---|
| capability identity | `software/registry-database/`, `control/command-router/capability-registry.ts`, `software/capability-registrar/` (3 real, complementary, non-duplicate registries) | REAL |
| resource identity | `software/registry-database/` (`ResourceRow`) | REAL |
| repository | `software/repository-registry/` | REAL |
| relationship | `software/registry-database/` (`RelationshipRow`/`RelationshipKind`) | REAL |
| connection | `connections/connection-registry/` | REAL |
| evidence | `software/registry-database/` (`EvidenceRow`) | REAL |
| process/runtime | `execution/process-lock/`, `control/work-coordination/`, `connections/agent-registry/` (narrow, non-unified) | PARTIAL |
| runtime status | `control/runtime-verification/`, `control/integration-verification/`, per-connection health checks | PARTIAL |
| action/capability (open/start/stop) | pipeline-stage `RequestedAction` enum + `os-ui`'s `UiWorkOrder.ui_action` (non-unified) | PARTIAL |
| **UI/application/route** | none — `control/artifact-destination/`'s own `UI_REGISTRY` slot states *"no real capability implements this... none is invented here"* | **GENUINELY MISSING** |
| **API/endpoint** | none — only scattered per-connection `adapter-config.ts` constants | **GENUINELY MISSING** |
| **port** | none | **GENUINELY MISSING** |
| **device/host** | none | **GENUINELY MISSING** |

Full detail, file paths, and quoted evidence for every row: see this round's discovery agent transcripts (referenced in conversation) — summarized accurately above, not re-derived from stale memory.

## Phase 2 — Prove the gap: DNA_LAB, the real case

- UI: MISSING. No route/URL/process anywhere named "DNA Lab."
- API: MISSING. No base URL/health path anywhere named "DNA Lab."
- Health endpoint: N/A (nothing to check).
- Host: MISSING.
- Capability (start/stop/open/check): MISSING.
- Evidence: MISSING.
- What IS real: `DNA-LAB-FILE-INTELLIGENCE` (registered `NOT_CONNECTED` in `control/command-router/capability-registry.ts`) and `DNA-LAB-PERMISSION-REASONER` (unregistered; its research-engine API is the real, live `http://localhost:8787/api/research/health`, confirmed reachable). Neither is literally "DNA Lab."
- UI vs. API kept strictly separate throughout — the live research-engine API's `HTTP 200` was never treated as proof any UI exists.
- **Owner decision (this round):** do not register a guess for DNA_LAB. Report UNRESOLVED honestly and keep it that way.

## Phase 3 — Direct Resolution: `resolveSystemReference()`

New capability: `control/system-reference-resolution/` (`resolveSystemReference(request, context)`). Composes four existing, real registries — no new storage:
1. `control/command-router/contract.ts#listCapabilities`
2. `software/registry-database/contract.ts#findCapability`
3. `software/repository-registry/contract.ts#listRepositories`
4. `connections/os-ui/adapter-contract.ts` target allowlist (via a new, additive `resolveOsUiTargetLocator` — see Extended Capabilities)

Exact, normalized string matching only — no fuzzy/embedding/LLM matching anywhere. Zero matches → `UNRESOLVED`. More than one real match → `AMBIGUOUS` (every candidate named, none auto-picked). Exactly one → `RESOLVED`, returning only ids that already exist in their own registry.

Proven (`tests/resolve-system-reference.test.ts`, 5/5 passing):
- `"github"` → `RESOLVED` via `COMMAND_ROUTER_CAPABILITY`.
- `"dna-os"` + `OPEN` → `RESOLVED` via `OS_UI_TARGET`, `action_ref=connections/os-ui#openOsUi`.
- `"DNA OS"` / `"dna_os"` → same real match (normalization proven).
- `"DNA_LAB"` → `UNRESOLVED`, `NO_REGISTERED_MATCH` — matches Phase 2 exactly, no guess.
- A genuine two-registry name collision (`"github"` registered a second time in `registry-database`) → `AMBIGUOUS`, both real candidates named.

## Phase 4 — Direct Action Proof (real, live, this round)

`tests/direct-action-proof.test.ts` — `OPEN dna-os`, end to end, all steps real:

```
REQUEST -> RESOLVED_TARGET -> RESOLVED_UI -> RUNTIME_CHECK -> ACTION_RESOLUTION
-> EXECUTION -> VERIFY_UI_REACHABLE -> RESULT -> EVIDENCE
```

- EXECUTION reused the existing `openOsUi("dna-os")` — really ran `/usr/bin/open http://127.0.0.1:3000` on this machine. **A real browser tab was opened as part of this proof.** No new browser automation was written.
- VERIFY_UI_REACHABLE: a real, live HTTP GET against the real, resolved URL (via a small additive `resolveOsUiTargetLocator` getter — see Extended Capabilities) → `reachable=true, statusCode=307`.

## Phase 5 — No-Source-Search Proof (measured, not asserted from inspection)

`fs.readFileSync`/`fs.readdirSync` were monkey-patched around the resolution call only, classifying every read by file type (`.ts/.js/.md` = source code, forbidden; `.jsonl/.json` = a registry's own data file, explicitly permitted per this round's own rule — "อนุญาตเฉพาะ indexed registry/evidence/runtime lookup"). Measured, one real run:

```
source_files_read: 0
repository_scan_count: 0
registry_data_reads: 1   (software/repository-registry/'s own .jsonl store — a permitted registry lookup, not a source-code scan)
registry_queries: 4      (all four sources checked unconditionally, by construction)
relationship_hops: 0
runtime_queries: 1       (the live HTTP reachability check)
resolution_duration_ms: 0.632
execution_duration_ms: 3259.095
verification_duration_ms: 231.401
ai_model_calls_after_intent_resolution: 0
```

## Phase 6 — Change Synchronization (stale-reference protection)

`tests/stale-reference-protection.test.ts`:
- **Repository path: PROVEN.** `resolveSystemReference`'s repository match now filters on `status === "ACTIVE"` (added this round). Proven against an isolated store: a freshly-registered repo resolves; after `suspendRepository()`, the identical target no longer resolves — the row is retained (auditable) but excluded, never silently deleted or silently still-live.
- **Capability path: GAP, reported, not fixed this round** (per this round's own "ถ้าไม่มี: รายงาน GAP และ STOP" instruction):
  - No mutation path anywhere in this repo can move a registered capability to `SUPERSEDED`/`RETIRED` — `control/registration-update/`'s `applyMutation` supports only `ADD_RELATIONSHIP`/`REMOVE_RELATIONSHIP`/`ADD_EVIDENCE`/`ADD_VERSION`.
  - `software/registry-database/lookup.ts`'s `findCapability` does not filter by status at all — if a capability ever does become stale by some future mechanism, it would still resolve today as if active.
  - Not patched this round: `lookup.ts` is shared, load-bearing infrastructure (the HTTP transport, `registration-pipeline`, and others all depend on its current behavior) — changing it has a blast radius beyond this round's scope.

## Phase 7 — Registration

`tests/phase7-registration.test.ts` — the one MATERIAL new capability this round (`resolveSystemReference` itself) went through the real pipeline, no hand-written insert:

```
Candidate -> Duplicate Gate -> Registry Writer -> Persistent Software Registry -> read-back verification
```

- Registered cleanly: `REGISTERED_CAPABILITY_ID=capability-8d726a41-ff15-4e6c-ace3-4f5f8130eb11`, `REGISTERED_RESOURCE_ID=resource-ee3248fa-8f3a-48c5-9f48-d9fa70489c46`.
- Read back via `findCapability()` — same capability, same resource, real source_location.
- Resubmitted the identical candidate — caught as `DUPLICATE` (`DUPLICATE_EXACT`), no second row.
- The small `os-ui` extension (`resolveOsUiTargetLocator`) is **not** separately registered here: `os-ui` lives in `command-router`'s static, hand-edited registry, not in `software/registry-database/` — there is no existing row there to `ADD_VERSION` against. Reported honestly rather than forcing a registration into the wrong registry.
- Runs against the local/test store — no durable, cross-restart persistent database exists yet (`software/registry-database/migrations/MIGRATION_PLAN.md`: `NOT EXECUTED`), unchanged by this round.

---

## FINAL REPORT

```
SYSTEM_ADDRESSABILITY_STATUS: PARTIAL — deterministic name->id resolution built and proven for 4 real registries; UI/API/port/host registries remain genuinely missing (Phase 1)
DNA_LAB_RESOLUTION_STATUS: UNRESOLVED (honest, proven — Owner declined to register a guess)
UI_API_SEPARATION_STATUS: PROVEN — never treats API health as UI readiness; structurally distinct match sources
DIRECT_ACTION_STATUS: PASS — OPEN dna-os proven end-to-end, real execution, real verification
NO_SOURCE_SEARCH_STATUS: PASS — measured, not asserted
REGISTRY_QUERY_COUNT: 4
SOURCE_FILES_READ: 0
REPOSITORY_SCAN_COUNT: 0
AI_MODEL_CALLS_AFTER_RESOLUTION: 0
RESOLUTION_DURATION_MS: 0.632 (measured; sub-millisecond in every observed run)
RUNTIME_VERIFICATION_STATUS: PASS
STALE_REFERENCE_PROTECTION: PARTIAL — repository path proven; capability path is a reported GAP, not fixed this round
REGISTRATION_STATUS: PASS
REGRESSION_STATUS: PASS — full typecheck clean; os-ui 24/24 + entire existing test:control-plane suite still pass

NEW_CAPABILITIES: control/system-reference-resolution/ (resolveSystemReference)
EXTENDED_CAPABILITIES: connections/os-ui/adapter-contract.ts (+resolveOsUiTargetLocator, additive, read-only, zero behavior change)
REUSED_CAPABILITIES: command-router#listCapabilities, registry-database#findCapability, repository-registry#listRepositories/createRepositoryRegistryStore, os-ui#openOsUi, registration-pipeline#runRegistrationPipeline
BLOCKED_CAPABILITIES: none forced this round — VERIFY_UI_REACHABLE is N/A (not blocked) for non-URL os-ui targets, since they are apps/paths, not URLs
EVIDENCE_REFERENCES:
  control/system-reference-resolution/{README.md,contract.ts,resolver.ts,types.ts}
  control/system-reference-resolution/tests/{resolve-system-reference,direct-action-proof,stale-reference-protection,phase7-registration}.test.ts
  connections/os-ui/adapter-contract.ts (resolveOsUiTargetLocator)
  reports/SYSTEM_ADDRESSABILITY_REPORT.md (this file)
```

No BLOCKER for what this round targeted. The two Phase 1 / Phase 6 GAPs (no UI/API/port/host registry; no capability lifecycle-status mutation or filter) are real, evidenced, and intentionally left as reported gaps rather than silently built around — closing them is out of this round's STOP boundary.
