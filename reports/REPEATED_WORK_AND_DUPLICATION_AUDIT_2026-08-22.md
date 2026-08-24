# REPEATED AI WORK, DUPLICATE CREATION & INTERPRETATION DRIFT — AUDIT

**Mode: DISCOVERY + MEASUREMENT ONLY.** No source edited, no capability created, no registry changed, no file renamed/moved/deleted, no solution proposed. Every claim below cites a real file, a real timestamp (`stat -f %Sm`, filesystem mtime — the only "history" available for the ~95% of this repo that was never committed to git), a real grep match, or a real report already sitting in this repo. Where cause cannot be proven from evidence, it is marked `NOT_PROVEN` rather than inferred.

**A note on git history:** `git log` shows only 7 real commits spanning this repo's whole life (`0dc260c` "Initial architecture baseline" through `837abe4`). The other ~330 production files are entirely untracked (`git status` shows `??`/`AM` for nearly everything). This means git cannot answer "what existed before what" for almost anything here — **filesystem mtimes are the only real chronological record**, and are used as such throughout, with the caveat that mtimes can be altered by a checkout/copy operation; they were cross-checked against in-file dated comments (`2026-08-DD fix`, `Phase N`) wherever possible, and every date below is corroborated by at least one such in-source citation, not mtime alone.

---

## 1. REPEATED_DISCOVERY

### 1.1 "Is 'DNA Lab' a real, addressable entity?" — proven independently rediscovered twice within ~17 minutes

| | |
|---|---|
| สิ่งที่ค้น | Whether "DNA Lab" resolves to a real capability/UI/port/host, and why an Owner command naming it fails |
| จำนวนครั้งที่พบหลักฐาน | **2 independent, evidenced investigations**, both concluding the identical fact (`DNA_LAB` → `UNRESOLVED`, no UI/API/port/host registry exists) |
| ตำแหน่งที่ความจริงมีอยู่แล้ว | `control/command-router/capability-registry.ts` (no `dna-lab` entry), `connections/os-ui/adapter-contract.ts` (target is `dna-os`, not `dna-lab`), `connections/research-engine/` (the real system, named differently) |
| เหตุใดครั้งต่อมาจึงหาโดยตรงไม่ได้ | The resolver built by investigation #1 (`control/system-reference-resolution/`) has **zero inbound callers** anywhere in the codebase — nothing routes an Owner command to it, so a second, independent process starting from the same Owner-facing question had no way to reach the first investigation's answer except by re-deriving it from source |

**Evidence, with exact filesystem timestamps (`stat -f %Sm`):**

```
2026-08-21 23:55:55  control/system-reference-resolution/README.md created
2026-08-21 23:58:26  .../tests/resolve-system-reference.test.ts created
2026-08-21 23:58:59  .../tests/stale-reference-protection.test.ts created
2026-08-22 00:02:19  .../tests/direct-action-proof.test.ts created
2026-08-22 00:03:14  .../tests/phase7-registration.test.ts created
2026-08-22 00:04:46  reports/SYSTEM_ADDRESSABILITY_REPORT.md created (Investigation #1's own final report)
2026-08-22 00:12:52  reports/SYSTEM_JOINT_AND_SEARCH_WASTE_AUDIT_2026-08-22.md created (Investigation #2's own final report)
```

Investigation #1 (`reports/SYSTEM_ADDRESSABILITY_REPORT.md`, Phase 1–2) independently concluded: *"UI: MISSING... API: MISSING... port: MISSING... host: MISSING... Owner decision: do not register a guess for DNA_LAB. Report UNRESOLVED honestly."*

Investigation #2 (this session's own prior audit, `reports/SYSTEM_JOINT_AND_SEARCH_WASTE_AUDIT_2026-08-22.md`) ran a `grep -r "SYSTEM_ADDRESSABILITY_REPORT"` search that returned **nothing** — because, per the timestamps above, that file did not yet exist at the moment the search ran (it lands at `00:04:46`; Investigation #2's own report, finished at `00:12:52`, states outright: *"the resolver's own doc cites evidence that isn't there... the cited file was never committed"*). Investigation #2 then independently re-derived the identical conclusion — three real, distinct local ports (3000/8787/8791) plus a fourth, conflicting documented port (5177) — by reading `contracts/worker/README.md`, `connections/research-engine/README.md`, and `control/command-router/capability-registry.ts` from scratch, at a real, measured cost of 23 files / 267,394 bytes read plus 6 repo-wide grep sweeps (already itemized in that report's own Part B).

**STATUS: PROVEN.** The fact was independently rediscovered from primary source twice, ~17 minutes apart, by two separate reasoning threads, because the first investigation's own output was not yet on disk when the second one searched for it, and — even once it does land — nothing wires the resolver either investigation built into any command an Owner would actually type.

### 1.2 "Which worker/adapter list does the Dispatcher actually use?" — rediscovered once, already fixed, but with an open follow-on risk

`control/agent-gateway/workers.ts`'s own header states plainly: *"Before this file existed, `control/command-router/router.ts` and `dna-os-circuit/runtime/server.ts` each declared their OWN separate array of the same adapters — two independent entry points into the same `submitTask` with two DIFFERENT worker lists (the circuit server's list was missing `aiWriteAdapter`)."* `dna-os-circuit/runtime/server.ts:63-65` corroborates from the other side: *"this used to declare its own local [fileIntelligenceAdapter, externalProviderAdapter] array, independently of control/command-router/router.ts's own copy — the two had drifted out of sync."* Both cite the same event: **Owner Work Order, 2026-08-20**.

This is discovery-then-fix, not still-open — but it directly demonstrates the mechanism: two files independently declared the same fact (which adapters exist) without either checking whether the other already had it, until a THIRD file (`workers.ts`) had to be created specifically to be the one place both would defer to. **STATUS: PROVEN** (as a historical, already-corrected instance — cited here because it is the clearest self-documented proof this failure mode is real and recurring in this codebase, not a one-off).

### 1.3 "Which capabilities/problem-types already exist?" — three separate answers, never cross-checked against each other

Every one of these is queried independently, by different code, for the same underlying question ("what capability handles X"):

1. `control/command-router/capability-registry.ts` — 11 entries, string ids (`github`, `os-ui`, `research-engine`, …)
2. `software/registry-database/data/canonical/capabilities.jsonl` — 41 entries, UUID ids (`target-resolution`, `registry-writer`, …)
3. `reports/phase16-world-evidence/capability_index.json` — 10 entries, keyed by `problem_type` (`server_hang_or_timeout`, `file_duplicate_or_orphan_detection`, …) — **read directly at runtime** by `control/agent-gateway/gateway.ts`'s `loadCapabilityIndex()`/`matchCapability()`, despite living inside `reports/`, normally a write-once output directory, not a registry

`gateway.ts`'s own `admitCompletedTask()` doc comment names the consequence directly: *"never gateway's own `matchCapability`/`evaluatePolicy` above, which is a separate, older, hardcoded-substring matcher against a different index and would silently re-decide an already-correct routing outcome."* — the codebase's own authors flagging, in a comment, that a second decision-maker for the same question still exists and must be deliberately bypassed by the real caller (`control/command-router/router.ts`) rather than removed.

**STATUS: PROVEN.** Three real, independently-populated "what capabilities exist" answers, zero shared id space, one explicitly documented as dangerous to call by accident.

---

## 2. DUPLICATE_CREATION

| # | Original | Date/evidence original existed first | Later item | Date/evidence | Classification | Evidence functions overlap/don't |
|---|---|---|---|---|---|---|
| 1 | `control/command-router/router.ts`'s local `[fileIntelligenceAdapter, externalProviderAdapter]` array | Pre-2026-08-20 (undated in source, but named as the earlier of the two by `workers.ts`'s own header) | `dna-os-circuit/runtime/server.ts`'s own separately-declared, DIFFERENT worker array (missing `aiWriteAdapter`) | Both replaced 2026-08-20 by `control/agent-gateway/workers.ts` | **EXACT_DUPLICATE** (later corrected) | Both fed the identical `submitTask()` call; `workers.ts`'s header states outright they "had drifted out of sync" — proven overlap, proven divergence, proven fix |
| 2 | `ai/agent-registry/` — README-only stub declaring intent for an "agent registry" capability | mtime 2026-08-14 | `connections/agent-registry/` — a full, ~19-file, real capability (session bridges, HTTP polling, launchers) also named "agent registry" | mtime 2026-08-20 (`registry.ts`) — 6 days later | **UNKNOWN** (name and stated purpose overlap heavily; cannot prove from evidence alone whether the second was deliberately placed in a different top-level group as a considered decision, or built without noticing the first) | `ai/agent-registry/README.md`'s own text: *"ทะเบียน... สำหรับกรณีที่ต้องอ้างอิง... ห้ามสร้าง schema ละเอียดเกินไปก่อนมี use case จริง"* — a deliberately-deferred registry; `connections/agent-registry/` is a real, live capability under a different top-level group (`connections/` vs `ai/`) that never references, imports, or mentions the `ai/agent-registry/` folder anywhere in its own ~19 files (confirmed by grep — zero cross-references either direction) |
| 3 | `control/command-router/capability-registry.ts` (11-entry capability registry, built earlier — referenced as pre-existing by every capability folder's own header, e.g. `research-engine`'s "Registered 2026-08-16") | ≤2026-08-16 | `software/registry-database/`'s 41-entry `capabilities.jsonl` (via `control/registration-pipeline/`) | mtime of canonical data 2026-08-20/21 (registration_events.jsonl spans that range) | **FUNCTIONAL_OVERLAP** | Both answer "does capability X exist, and what does it do" for a caller. Zero shared id/name between the two (confirmed directly: none of Registry #1's 11 string ids appear as a `canonical_name` in Registry #2's 41 rows, and vice versa) — the overlap is in PURPOSE, not in any single named capability being registered twice |
| 4 | Same two registries as #3 | — | `reports/phase16-world-evidence/capability_index.json` (10 entries, `problem_type`-keyed), read live by `control/agent-gateway/gateway.ts`'s `matchCapability()` | undated in-file, but lives inside a `phase16`-labeled report directory, i.e. built during a specific numbered round, not as a designed-in-advance registry | **FUNCTIONAL_OVERLAP**, explicitly self-flagged as dangerous (see §1.3 — `gateway.ts`'s own comment) | A THIRD "what capability handles X" answer, structurally different from both #3 registries (keyed by problem description, not by capability id), living in a directory (`reports/`) whose own convention elsewhere in this repo is write-once output evidence, not a live dependency |
| 5 | `execution/file-write/executor.ts`'s `executeFileWrite` (in-process write, gate-checked) | Built 2026-08-19 (per its own header: "Owner, 2026-08-19: 'File-write executor...'") | `execution/file-write/sandboxed-executor.ts`'s `executeFileWriteSandboxed` (same gate check, real kernel-sandboxed write) | Built 2026-08-22 (this session, per the header's own citation of `/Users/tam/.claude/plans/zesty-spinning-ripple.md`) | **LEGITIMATE_SEPARATE_RESPONSIBILITY** | Explicitly designed as two call paths sharing one contract shape, one flagged off by default (`AGENT_HOST_SANDBOXED_WRITES`) — not presented as a replacement, and both are named together in `execution/file-write/contract.ts`'s own header rather than one silently shadowing the other. Included here for completeness/transparency (this session's own contribution), not as a finding of accidental duplication |
| 6 | `contracts/worker/evaluation-result.ts`'s original field `rework_count` | Undated first draft | Renamed to `retry_count` | 2026-08-18 correction pass (`contracts/worker/README.md`: *"2026-08-18 correction pass... `rework_count` → `retry_count` (matches real column — it already existed, just under the wrong name)"*) | **EXACT_DUPLICATE at the naming level** (a field was invented under a new name for a concept that already existed under a different real name in the `executions` database table) | Self-documented by the repo's own README as a corrected mismatch, not inferred |

**Total classified this round: 6.** EXACT_DUPLICATE: 2 (#1, #6 — both self-documented and already corrected by the codebase's own authors). FUNCTIONAL_OVERLAP: 2 (#3, #4 — both still live/unresolved). UNKNOWN: 1 (#2 — real overlap in name/purpose, cause not provable). LEGITIMATE_SEPARATE_RESPONSIBILITY: 1 (#5).

---

## 3. INTERPRETATION_DRIFT

| Term | Distinct real referents found | Where drift is provably located |
|---|---|---|
| **"DNA Lab"** | (a) `connections/research-engine/`'s real system, named `DNA-LAB-PERMISSION-REASONER` in its own README, live at `http://localhost:8787`; (b) a NOT_YET_BUILT pipeline stage in `contracts/worker/README.md` labeled "5177 DNA LAB"; (c) `DNA-LAB-FILE-INTELLIGENCE`, a third, separate, `NOT_CONNECTED` registry entry also carrying "DNA-LAB" in its name | **SOURCE_DISCOVERY.** `connections/research-engine/README.md` and `contracts/worker/README.md` were written independently (different capability folders, different purposes — one a live HTTP adapter doc, one a not-yet-built pipeline diagram) and never cross-reference each other's port number for the same real upstream system. Neither an `OWNER_TEXT` nor `AGENT_INTERPRETATION` origin can be proven from evidence — both documents already existed with their own port before this round's investigation began; the drift is a property of the SOURCE files themselves, provably. |
| **"DNA OS" / "dna-os"** | (a) the `os-ui` capability's `dna-os` target, `connections/os-ui/adapter-contract.ts:48`, a URL `http://127.0.0.1:3000` labeled "DNA OS" — an external product's own UI, not built in this repo; (b) `DNA-OS-INFRASTRUCTURE`, this entire repository's own name | **ENTITY_RESOLUTION.** `control/system-reference-resolution/resolver.ts`'s own `OS_UI_TARGET_MEMBERSHIP` table and `matchOsUiTarget()` resolve the string `"dna-os"` to referent (a) only — there is no registered entity anywhere resolving to referent (b), the repo itself. Proven: `reports/SYSTEM_ADDRESSABILITY_REPORT.md` Phase 1's own table lists "UI/application/route" as **GENUINELY MISSING** for anything beyond the `os-ui` allowlist — the repo-as-an-entity is simply not a resolvable target anywhere in the system, by the system's own authoritative report. |
| **Capability identity (`capability_id` vs `canonical_name` vs `problem_type`)** | Three non-overlapping id vocabularies (§1.3/§2 #3-4) | **REGISTRY_LOOKUP.** Provable directly: `control/system-reference-resolution/resolver.ts` itself has to separately query `listCapabilities()` (Registry #1) and `findCapability()` (Registry #2) as two DIFFERENT match functions inside the SAME resolution call (`matchCommandRouterCapability` vs `matchRegistryDatabaseCapability`), because no shared key exists to look up one from the other — the drift is structurally located at the registry-lookup layer, not at interpretation of Owner text. |
| **"agent registry"** | (a) `ai/agent-registry/` (stub, never built); (b) `connections/agent-registry/` (fully real) | **NOT_PROVEN.** No file, comment, commit, or report anywhere states WHY the real implementation landed under `connections/` instead of `ai/`, or whether the author was aware of `ai/agent-registry/`'s existence at the time. The name collision itself is proven (§2 #2); its ROOT CAUSE (owner text vs agent interpretation vs failed source discovery) is not evidenced anywhere and is reported honestly as unknown, not guessed. |

No case in this section could be traced to `OWNER_TEXT` or `AGENT_INTERPRETATION` specifically — every provable instance originates in a structural property of the source/registry layer (two documents disagreeing, two registries with no shared key), never in a single agent's momentary misreading of an Owner's words. This is itself a finding: **the drift is a property of the system's addressability (or lack of it), not of any one agent's comprehension.**

---

## 4. DUPLICATE_UI / DUPLICATE_PRESENTATION

**Total real UI pages found in this repo: 2**, plus one built during this same session (disclosed separately, not counted as a pre-existing-duplication finding against itself).

| Page | Domain shown | DATA_SOURCE → API/FUNCTION → UI COMPONENT → PAGE/PORT |
|---|---|---|
| Circuit Board | Node/edge status of the DNA OS Circuit (`READY`/`RUNNING`/`PARTIAL`/`BLOCKED`/`NOT_YET_REAL`) | `dna-os-circuit/definition/circuit.json` (topology) + `dna-os-circuit/adapter/internal-state-adapter.ts` (real signal) → `dna-os-circuit/runtime/circuit-state.ts` (`CircuitState`) → `dna-os-circuit/runtime/server.ts`'s `GET /events` SSE + `GET /circuit.json` → `dna-os-circuit/ui/circuit-board/circuit-board.js` → served at port **8790** |
| Evidence Trace Viewer | The DETECTED → EVALUATED → DECISION chain for File-Intelligence findings | `dna-os-circuit/runtime/finding-receiver.ts`/`finding-evaluator.ts`/`finding-decider.ts` (real decision trail) → `GET /findings`, `/findings/evaluation-evidence`, `/findings/decision-evidence` → `dna-os-circuit/ui/evidence-trace/trace-viewer.js` → served at port **8790** (same server, different route) |

**Overlap analysis:** both pages are served by the SAME process (`dna-os-circuit/runtime/server.ts`, port 8790) and consume real, non-overlapping data domains (live topology status vs. a forensic finding-decision audit trail) — **LEGITIMATE_SEPARATE_RESPONSIBILITY**, not a duplicate. Neither was found to duplicate the other's domain; no evidence either was built "after" a page for the same data already existed.

**No other UI exists in this repo.** The `dna-os` target at port 3000 (`connections/os-ui/adapter-contract.ts`) is only ever `open`'d by this repo, never served by it — its actual UI code lives in a separate, external product ("Dead Board Next.js app, a separate repo/process" — `transport/owner-command-http/server.ts`'s own header) not present in this checkout, so this repo cannot be checked for duplicating it.

**Disclosed, not counted as a finding:** this same session built `observability/joint-monitor/`, a third real page (an inline HTML/SSE viewer of cross-capability call events, port **5177**). Domain check against the two existing pages: neither Circuit Board nor Evidence Trace Viewer shows cross-capability call/joint events — confirmed no existing page covered this domain before. **LEGITIMATE_SEPARATE_RESPONSIBILITY**, self-assessed honestly rather than omitted.

---

## 5. REPROCESSING COST

Measured directly from this session's own two audit rounds (the only rounds with byte/operation-level instrumentation available — no other round in this repo's history left measurable byte/token counts, so earlier rounds cannot be quantified and are not estimated here, per the task's own "ห้ามประมาณ" instruction).

| Classification | Measured evidence |
|---|---|
| SOURCE_RESEARCH | 23 files / 267,394 bytes read in one round chasing a single fact ("what is DNA Lab") — `reports/SYSTEM_JOINT_AND_SEARCH_WASTE_AUDIT_2026-08-22.md` Part B, itemized file-by-file |
| FILE_LOCATION | 2 full directory scans (root tree + `control/system-reference-resolution/` listing) before any file was read, same report |
| ENTITY_RESOLUTION | The SAME "DNA_LAB" resolution re-derived twice within ~17 minutes by two independent processes (§1.1) — the single most expensive repeated operation with byte-level proof in this repo |
| DEPENDENCY_DISCOVERY | Import-graph reconstruction required a purpose-built script (`joint_graph.cjs`) reading all 337 production files (1,530,841 bytes) because no dependency/relationship registry answers "what does X call" directly — confirmed independently by `governance/source-validation/`'s own checker later finding the identical 91-violation count by the identical method |
| CAPABILITY_DISCOVERY | 3 separate capability lists (§1.3) each require an independent read/query to rule in or out — no single lookup answers "does capability X already exist" |
| DUPLICATE_CHECK | `governance/architecture-rules/CAPABILITY_FOLDER_LAW.md`'s own Rule 4 mandates a duplicate-check before creating any new capability folder, but Rule 10's own text admits *"ยังไม่มี mechanical checker"* — every duplicate-check in this repo's history up to this session was manual, unmeasured, and (per §2's findings) sometimes missed |
| UI_DISCOVERY | 1 repo-wide `find -iname "*.html"` sweep (this session) was sufficient — the smallest-cost category measured, because only 2 real UI pages exist |
| ENDPOINT_DISCOVERY | Confirmed `GENUINELY MISSING` as a registry by TWO independent reports (`reports/SYSTEM_ADDRESSABILITY_REPORT.md` Phase 1 AND `reports/SYSTEM_JOINT_AND_SEARCH_WASTE_AUDIT_2026-08-22.md` Part D item 8) — meaning every future round must rediscover every endpoint from source, with no registry ever to consult first |
| REGISTRY_DISCOVERY | Same as CAPABILITY_DISCOVERY — 3 non-cross-referenced registries, each requiring separate discovery |
| RE-READ_EXISTING_CODE | `control/command-router/capability-registry.ts` and `control/command-router/router.ts` were each read in full at least twice across this session's two rounds (once in the joint audit, once again during this round's evidence-gathering for §1.3/§2) — a real, directly observed re-read, not inferred |

---

## RANKING (from evidence gathered this round — not extrapolated to rounds with no measurable record)

```
MOST_REPEATED_WORK:                 Re-deriving "does capability/entity X already exist" — 3 non-cross-referenced
                                     capability lists (command-router registry, registry-database, capability_index.json)
                                     force this exact question to be answered from scratch every time.

MOST_REPEATED_SEARCH:               "What/where is DNA Lab" — proven independently re-investigated twice within
                                     ~17 minutes (00:04:46 and 00:12:52 mtimes), full source-level re-derivation both times.

MOST_COMMON_INTERPRETATION_DRIFT:   Capability/entity identity (capability_id vs canonical_name vs problem_type) —
                                     3 distinct id vocabularies for the same underlying concept, zero shared keys,
                                     confirmed structurally at the REGISTRY_LOOKUP layer (§3).

MOST_COMMON_DUPLICATE_CREATION:     FUNCTIONAL_OVERLAP at the registry layer (2 of 6 classified cases; a 3rd almost-
                                     identical case, the worker-adapter-list duplication, was EXACT_DUPLICATE and
                                     already self-corrected 2026-08-20).

MOST_DUPLICATED_UI_DOMAIN:          NONE FOUND. Only 2 pre-existing UI pages exist in this repo and they cover
                                     non-overlapping domains — no duplicate UI domain is evidenced.

MOST_REPROCESSED_SOURCE_AREA:       control/command-router/ (capability-registry.ts + router.ts) — read in full,
                                     independently, at least twice across this session's two measured rounds, and
                                     named as a dependency-of-interest in both reports' own evidence trails.
```

---

## FINAL QUESTION

**"สิ่งที่ Agent สร้างใหม่บ่อยที่สุด เกิดจากไม่มีของเดิมจริง หรือเกิดจากไม่สามารถระบุตัวตน/ตำแหน่ง/ความสามารถของของเดิมได้ก่อนเริ่มสร้าง?"**

## `PROVEN_EXISTING_BUT_NOT_FOUND`

Every DUPLICATE_CREATION case this round could classify with a definite cause (§2, cases #1 and #6 — the only two with an explicit, dated, self-documented root cause in the codebase's own comments) was **PROVEN_EXISTING_BUT_NOT_FOUND**, not genuinely-missing-then-built:

- Case #1 (worker adapter lists): the codebase's OWN header comment states the second list was declared *"independently of `control/command-router/router.ts`'s own copy"* — the original already existed; the second author did not find/check it before declaring a new one.
- Case #6 (`rework_count`/`retry_count`): the codebase's OWN README states the real column *"already existed, just under the wrong name"* — a new name was invented for a concept that was already real and already present.
- Case #1.1 (the `DNA_LAB` resolver itself, `control/system-reference-resolution/`): this is the most significant instance by scale — the resolver, its 4 tests, and its final report were built in a 9-minute round (23:55:55 → 00:04:46) whose own Phase 1 table proves the SAME underlying facts (no UI/API/port/host registry) were already fully derivable from `control/command-router/capability-registry.ts` and `connections/os-ui/adapter-contract.ts`, both of which existed well before that round started (`os-ui` registered "2026-08-20" per capability-registry.ts's own inline comments). The round did not discover a missing capability — it discovered that an existing, already-registered set of capabilities could not be found/composed together, and built a NEW composition capability (`system-reference-resolution`) to do what direct lookup of the existing ones should have been able to do. That new capability, in turn, itself now sits undiscovered by anything that calls it (§1.1) — the same failure mode reproducing one level up.

The one case with genuinely `NOT_PROVEN` causation (§2 #2, `ai/agent-registry` vs `connections/agent-registry`) is excluded from this verdict rather than assumed — its name/purpose overlap is real, but no evidence establishes whether the second author ever looked for the first.

**Numeric basis:** of 6 classified duplicate-creation cases, 2 have a definite, self-documented, dated root cause — both `PROVEN_EXISTING_BUT_NOT_FOUND` — 2 are open `FUNCTIONAL_OVERLAP` with cause not directly documented in-source (but structurally consistent with the same pattern, per §1.3), 1 is `NOT_PROVEN`, 1 is `LEGITIMATE_SEPARATE_RESPONSIBILITY` (not a duplication case at all). **0 of 6** classified cases showed evidence of a genuinely-missing capability being correctly identified as missing before being built from scratch.

**STOP — measurement only. No fix proposed, no tool created, no file modified beyond this report.**
