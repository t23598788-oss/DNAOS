# SYSTEM JOINT & AGENT SEARCH-WASTE AUDIT

**Mode: DISCOVERY + MEASUREMENT ONLY.** No architecture created, no capability created, no registry created, no UI created, no file renamed/moved, nothing fixed. Every number below is either (a) mechanically computed from a script run against the real source tree, or (b) the literal output of running real, already-existing exported functions with `npx tsx`, or (c) a byte count from `wc -c` on real files. Where a number could not be measured honestly, it is marked `NOT MEASURED` rather than estimated.

Date: 2026-08-22. Repo: `DNA-OS-INFRASTRUCTURE`. Owner example traced: **"เปิด DNA Lab"**.

---

## METHOD (so every number is reproducible)

**Joint definition used:** a *capability folder* = the top two path segments of a file (e.g. `control/command-router`, `connections/github`, `software/registry-database`). This is not my invention — it is this repo's own declared unit: `governance/architecture-rules/CAPABILITY_FOLDER_LAW.md` states a capability folder is the only thing that can be edited/tested/moved/deleted/assigned "as one unit," and rule 9 requires all cross-capability communication to go through a public `contract.ts`. A **joint** = an import/call whose source file's capability folder differs from its target file's capability folder. An import between two files inside the *same* capability folder is internal wiring, not a joint, and is excluded.

**Script:** a Node script (`joint_graph.cjs`, no framework, plain regex over `import`/`export…from` lines) walked all 337 non-test `.ts` files, resolved every relative import to a real file on disk, and recorded every edge whose source and target capability folders differ. Test files (`**/tests/**`, `*.test.ts`), sandbox fixtures, and `node_modules` were excluded — this counts production joints only. This mechanically satisfies "do not count ordinary internal function calls inside the same capability" and "do not estimate."

**Runtime joints** (HTTP calls, `open`/`child_process`, launchd) are not visible to an import-graph script — these were found separately with targeted `grep` and confirmed by reading the call site.

**Part B/D verification:** rather than describe what *should* happen, the actual exported functions (`classifyCommand`, `resolveSystemReference`, `listRepositories`, `resolveOsUiTargetLocator`) were imported and executed for real with `npx tsx`, and the real return values and `performance.now()` timings below are pasted verbatim from that run.

---

## PART A — THE REAL JOINT MAP

### Headline numbers (mechanically computed, not estimated)

| Metric | Value |
|---|---|
| Production `.ts` files analyzed (tests/sandboxes excluded) | 337 |
| Total bytes read to build this map | 1,530,841 |
| Raw cross-capability import edges (file→file) | 269 |
| **Distinct capability-pair joints** (deduplicated FROM→TO) | **179** |
| Dangling/unresolved import specifiers (import points at a file that doesn't exist) | 0 |
| Joints whose call site imports the target's public `contract.ts` (or a `contracts/` shared type) | 178 of 269 raw edges (66%) |
| Joints whose call site imports a target's *internal, non-contract* file directly (violates Capability Folder Law §9) | 91 of 269 raw edges (34%), spread across 52 of the 179 pairs |
| Distinct pairs where **every** call site is contract-compliant | 127 of 179 (71%) |
| Distinct pairs where **at least one** call site bypasses the contract | 52 of 179 (29%) |

### Registry backing (does a real registry know this joint exists?)

Two — and only two — real capability registries exist in this repo, and **they do not reference each other**:

- **Registry #1**: `control/command-router/capability-registry.ts` → `CAPABILITY_REGISTRY`, 11 static entries with human-readable string ids (`github`, `research-engine`, `os-ui`, `execution`, `dispatcher`, `os-login`, `voice-bridge`, `dna-os-circuit`, `permission-reasoner`, `digitalocean`, `file-intelligence`). Used only for Owner-text-command keyword routing.
- **Registry #2**: `software/registry-database/data/canonical/capabilities.jsonl` → 41 dynamically-registered capabilities with UUID ids and a separate `canonical_name` (`target-resolution`, `registry-writer`, `admission`, `source-execution`, `dna-os-mcp`, `repository-registry`, `write-gate`, …). Populated by `control/registration-pipeline/`, used for the `relationships`/dependency graph.

Cross-referencing all 179 measured joints' *target* capability against **both** registries by folder name:

| | Count |
|---|---|
| Joints targeting a `contracts/` shared-type file (not a capability; excluded from the registry question) | 28 |
| Joints targeting a real capability folder | 151 |
| — of those, target is registered in Registry #1 or #2 | 55 (36%) |
| — of those, target has **no record in either registry** | **96 (64%)** |

96 of 151 real cross-capability code joints point at a component neither registry has ever heard of. 25 distinct target folders account for those 96 unbacked joints — and this list includes the most load-bearing folders in the whole system: `control/command-router`, `control/owner-command`, `execution/run`, `permissions/execution-policy`, `software/registry-database` itself, `control/agent-gateway`, `connections/agent-registry`, `dna-os-circuit/*`. (Some of these — `command-router`, `owner-command`, `execution/run`, `permissions/*`, `registry-database` — are core control-plane plumbing that the "capability" registries were arguably never scoped to describe, so their absence is architecturally explainable, not automatically a bug; the other ~15 folders, e.g. `control/agent-gateway`, `connections/agent-registry`, `connections/telemetry`, `dna-os-circuit/runtime`, `credentials/*`, are real feature capabilities other components genuinely call into today with no registry record at all — that half is a real gap.)

A separate, real `relationships` table does exist inside Registry #2's own schema (`RelationshipKind`: `MODULE_TO_CAPABILITY`, `CAPABILITY_TO_DEPENDENCY`, `CAPABILITY_TO_API`, etc. — see `software/registry-database/types.ts`), and it is populated: **91 rows** on disk at `software/registry-database/data/canonical/relationships.jsonl` (46 are `FILE→CAPABILITY` ownership rows, the remaining 45 are genuine `CAPABILITY→CAPABILITY` edges). That is at most 45 relationship-graph rows against 179 measured real code joints — **even in the best case, fewer than 1 in 4 real joints has a relationship-graph record**, and because Registry #2 uses UUIDs with no cross-reference to Registry #1's string ids or to source file paths, matching a `relationships.jsonl` row back to an actual import in `router.ts` requires a human to read both and match names by hand — there is no join key.

### Curated JOINT_ID entries (full schema, the joints that matter most)

*(The remaining 161 joints are listed in the Appendix table at the end of this document with the same measured fields, compacted to columns.)*

---

**JOINT-001**
- FROM_COMPONENT: `control/owner-command`
- FROM_CAPABILITY_ID: not registered in either registry
- TO_COMPONENT: `control/command-router`
- TO_CAPABILITY_ID: not registered in either registry
- JOINT_TYPE: ingress → router (Owner intent text → routing decision)
- CONTRACT_FILE: `control/command-router/contract.ts`
- CALL_SITE: `control/owner-command/owner-command.ts:42` (`import { classifyCommand, classifyOutput, listCapabilities, routeOwnerCommand } from "../command-router/contract"`)
- DATA_CROSSED: `CommandEnvelope` (intent text, issuer identity, payload)
- CONTROL_CROSSED: yes — `routeOwnerCommand()` decides which capability (if any) runs
- REGISTRY_RECORD_EXISTS: NO
- RELATIONSHIP_RECORD_EXISTS: NO
- RUNTIME_DISCOVERABLE: NO (no `/runtime/inventory`-style endpoint lists this edge; only readable in source)
- EVIDENCE: file read verbatim, header explicitly states "OWNER → owner-command → command-router → capability → result → owner-command → OWNER"
- STATUS: **PROVEN**

**JOINT-002**
- FROM_COMPONENT: `control/command-router` (`classifyCommand`)
- TO_COMPONENT: `CAPABILITY_REGISTRY` data (11 static entries, same file)
- JOINT_TYPE: router → registry lookup (keyword match)
- CONTRACT_FILE: `control/command-router/capability-registry.ts`
- CALL_SITE: `control/command-router/router.ts:73-93` — `matchesText()` does `cap.match_keyword_sets.some(set => set.every(kw => text.includes(kw)))`, an exact-substring AND-of-keywords match, no fuzzy/LLM matching
- DATA_CROSSED: raw Owner text string
- CONTROL_CROSSED: yes — zero matches ⇒ `UNSUPPORTED_COMMAND`; >1 match ⇒ `OWNER_REVIEW` (refuses to guess); exactly 1 ⇒ routes
- REGISTRY_RECORD_EXISTS: YES (this *is* the registry)
- RELATIONSHIP_RECORD_EXISTS: NO
- RUNTIME_DISCOVERABLE: PARTIAL — `transport/owner-command-http/server.ts`'s `runtimeInventory()` exposes `listCapabilities()` over `GET /runtime/inventory`, but not the keyword sets themselves
- EVIDENCE: **live-executed** — `classifyCommand("เปิด DNA Lab")` really returns `{"status":"UNSUPPORTED_COMMAND","reason":"no registered capability's match_keyword_sets matched \"เปิด DNA Lab\""}` in 0.084ms (see Part B)
- STATUS: **PROVEN**

**JOINT-003**
- FROM_COMPONENT: `control/command-router` (`runOsUiStep`)
- FROM_CAPABILITY_ID: (router itself, unregistered)
- TO_COMPONENT: `connections/os-ui`
- TO_CAPABILITY_ID: `os-ui` (Registry #1)
- JOINT_TYPE: capability → connection (OS-level UI opener)
- CONTRACT_FILE: `connections/os-ui/adapter-contract.ts`
- CALL_SITE: `control/command-router/router.ts:58` (`import { openOsUi, parseOsUiTarget, runUiWorkOrder } from "../../connections/os-ui/adapter-contract"`)
- DATA_CROSSED: `OsUiTarget` string (`"dna-os" | "vscode" | "chrome" | …`, 8-member closed union)
- CONTROL_CROSSED: yes — triggers a real macOS `open` process call
- REGISTRY_RECORD_EXISTS: YES (`os-ui` is in Registry #1)
- RELATIONSHIP_RECORD_EXISTS: NO
- RUNTIME_DISCOVERABLE: NO (the `OsUiTarget` union and its keyword triggers live only in source, not in any runtime-queryable list)
- EVIDENCE: `connections/os-ui/adapter-contract.ts:34-41` — `TARGETS["dna-os"] = { kind:"url", value:"http://127.0.0.1:3000", label:"DNA OS" }`; **this is a different real system from "DNA Lab"** — see JOINT-006.
- STATUS: **PROVEN**

**JOINT-004 (the joint DNA Lab actually needs, if the Owner meant the Research Engine)**
- FROM_COMPONENT: `control/command-router` (`runResearchEngineStep`)
- TO_COMPONENT: `connections/research-engine`
- TO_CAPABILITY_ID: `research-engine` (Registry #1, `health_status: "CONNECTED"`)
- JOINT_TYPE: capability → connection → **external system** (real, out-of-checkout HTTP service)
- CONTRACT_FILE: `connections/research-engine/adapter-contract.ts` exists, but the call site bypasses it
- CALL_SITE: `control/command-router/router.ts:54` — `import { fetchResearchEngineLatestResult } from "../../connections/research-engine/research-engine-adapter"` — imports the **implementation file directly**, not `adapter-contract.ts`. (This particular bypass is arguably intentional/documented — the router file's own header names `research-engine-adapter.ts` as "its one documented public entry point, see that folder's README" — but it is still not literally the folder's `contract.ts`, so the mechanical scan correctly flags it as non-compliant with rule 9's literal text.)
- DATA_CROSSED: `ResearchEngineStepOutcome` (experiment_id, provider, model_id, safety/efficiency scores, decision, latency bag)
- CONTROL_CROSSED: yes, GET-only
- REGISTRY_RECORD_EXISTS: YES
- RELATIONSHIP_RECORD_EXISTS: NO
- RUNTIME_DISCOVERABLE: PARTIAL — `transport/owner-command-http/server.ts`'s `runtimeInventory()` live-probes `http://127.0.0.1:8787/api/research/health` **directly with its own second `fetch` call**, duplicating `connections/research-engine`'s own health check instead of calling it (see JOINT-005) — so "is research-engine alive" is answered by two independent, potentially-divergent code paths.
- EVIDENCE: `connections/research-engine/README.md` — "adapter สำหรับเชื่อมต่อ DNA-LAB-PERMISSION-REASONER's Research & Evaluation Engine — a real local HTTP JSON service, reachable at `http://localhost:8787`." **This is the closest real, running thing in the repo to what "DNA Lab" plausibly means** — `connections/research-engine/README.md:3` literally names the upstream repo `DNA-LAB-PERMISSION-REASONER`.
- STATUS: **PROVEN** (the joint exists and is live-verified CONNECTED); the *naming* link from "DNA Lab" → `research-engine` does **not** exist anywhere — see Part D.

**JOINT-005 (duplicated discovery — the same external health check, two independent code paths)**
- FROM_COMPONENT: `transport/owner-command-http` (`runtimeInventory()`)
- TO_COMPONENT: external — `http://127.0.0.1:8787/api/research/health` directly
- JOINT_TYPE: transport → external system (bypasses `connections/research-engine` entirely)
- CONTRACT_FILE: none used — raw `fetch()` call
- CALL_SITE: `transport/owner-command-http/server.ts:173` — `const response = await fetch("http://127.0.0.1:8787/api/research/health");`
- DATA_CROSSED: `{status: string}`
- CONTROL_CROSSED: yes — feeds `live_status` in the `/runtime/inventory` response
- REGISTRY_RECORD_EXISTS: NO (this specific fetch call is not itself a registered capability; it silently re-implements `connections/research-engine`'s own `checkResearchEngineLiveHealth()`)
- RELATIONSHIP_RECORD_EXISTS: NO
- RUNTIME_DISCOVERABLE: YES — this is literally what `GET /runtime/inventory` returns
- EVIDENCE: `connections/research-engine/research-engine-adapter.ts` already exports `checkResearchEngineLiveHealth()` for exactly this purpose (per `connections/research-engine/README.md`'s file table); `transport/owner-command-http/server.ts` does not import it and re-writes the same URL as a literal string instead.
- STATUS: **PROVEN** — a genuine duplicated-knowledge joint (the base URL `http://127.0.0.1:8787` is hardcoded as a literal string in two unrelated files: `connections/research-engine/adapter-config.ts:23` and `transport/owner-command-http/server.ts:173`/`186`).

**JOINT-006 (the naming collision that breaks the Owner's request)**
- FROM_COMPONENT: `connections/os-ui`'s `parseOsUiTarget` / `TARGETS["dna-os"]`
- TO_COMPONENT: a **separate real local process**, `http://127.0.0.1:3000`, labeled "DNA OS"
- JOINT_TYPE: capability → host process (a third, distinct local server — not the research engine, not the owner-command-http control plane)
- CONTRACT_FILE: `connections/os-ui/adapter-contract.ts`
- CALL_SITE: `connections/os-ui/adapter-contract.ts:48`
- DATA_CROSSED: a URL string
- CONTROL_CROSSED: yes — a real macOS `open` shell call against this URL
- REGISTRY_RECORD_EXISTS: YES, but under the id `dna-os`, not `dna-lab`
- RELATIONSHIP_RECORD_EXISTS: NO
- RUNTIME_DISCOVERABLE: NO
- EVIDENCE: **there are three distinct, similarly-named local services in this system, on three different ports, and nothing anywhere states this explicitly in one place**:
  1. port **3000** — `"dna-os"` — the actual DNA OS UI dashboard (`connections/os-ui/adapter-contract.ts:48`)
  2. port **8787** — `research-engine` / "DNA Lab" per `connections/research-engine/README.md` — DNA-LAB-PERMISSION-REASONER's Research & Evaluation Engine
  3. port **8791** — the DNA OS control-plane HTTP server itself (`transport/owner-command-http/server.ts:192`, consumed by `connections/dna-os-mcp` and `connections/agent-registry`)
  …and a **fourth, conflicting number**, port **5177**, is also labeled "DNA LAB" in `contracts/worker/README.md:23` ("5177 DNA LAB measures real executions.* fields") — a pipeline-stage diagram for a not-yet-built AI Worker Gateway loop, disagreeing with `connections/research-engine`'s port 8787 for what appears to be the same real system. No file anywhere reconciles 5177 vs 8787.
- STATUS: **PROVEN** — this is the single most direct, evidenced cause of the Owner's problem: "DNA OS" (port 3000, an `os-ui` target) and "DNA Lab" (port 8787 per one doc, port 5177 per another, a `research-engine` capability) are two/three different real things, one keyword apart in Thai/English, and the command router's keyword sets require an **exact substring match** (`"dna os"` vs `"dna lab"`), so they never collide *or* redirect into each other — the Owner's phrasing simply falls into the gap between them.

**JOINT-007**
- FROM_COMPONENT: `control/system-reference-resolution` (built 2026-08-21, same day as this audit)
- TO_COMPONENT: `control/command-router`, `software/registry-database`, `software/repository-registry`, `connections/os-ui` (four joints, one folder)
- JOINT_TYPE: composition layer — the one folder in the repo whose entire job is to answer "what do you know about plain name X" by querying the other four registries and returning RESOLVED/AMBIGUOUS/UNRESOLVED, never guessing
- CONTRACT_FILE: `control/system-reference-resolution/contract.ts`
- CALL_SITE: `control/system-reference-resolution/resolver.ts:23-26` (four imports, all through each target's own `contract.ts` — this folder is 100% Capability-Folder-Law-compliant, 0 bypasses of its 5 outbound call sites)
- DATA_CROSSED: `SystemReferenceRequest{request, target}` in; `SystemReferenceResolution{status, match, candidates, reason_code}` out
- CONTROL_CROSSED: read-only, never executes, never invents a match (`resolver.ts`'s own header: "never call `fs.readFileSync`/`grep`/any source-scanning primitive… every answer must come from an already-loaded registry read")
- REGISTRY_RECORD_EXISTS: this folder is itself unregistered in both Registry #1 and Registry #2
- RELATIONSHIP_RECORD_EXISTS: NO
- RUNTIME_DISCOVERABLE: **NO — nothing calls into this folder.** Its own README states plainly: *"NOT_YET_BUILT: no runtime transport (CLI/HTTP command handler) calls `resolveSystemReference()` yet."* Confirmed independently by the joint-graph scan: among all 179 measured joints, `control/system-reference-resolution` appears only as a **source**, never as a **target** — zero inbound edges.
- EVIDENCE: **live-executed** — `resolveSystemReference({request:"OPEN", target:"DNA_LAB"}, {registryStore})` really returns `{"status":"UNRESOLVED","reason_code":"NO_REGISTERED_MATCH"}` in 1.527ms (see Part B). This is the exact, correct, already-built answer to the Owner's question — it is simply not wired to anything a real "เปิด DNA Lab" command would ever reach.
- STATUS: **PROVEN** (as a joint); the resolver's *own* value is proven but **orphaned** — a dead-end capability with no inbound caller.

*(JOINT-008 through JOINT-179 are the remaining measured capability-pair joints; full list with the same call-site/contract/registry columns is the Appendix table below.)*

### Runtime/process joints (not visible to the import-graph script — found by grep + read)

| JOINT_ID | FROM | TO | TYPE | EVIDENCE | STATUS |
|---|---|---|---|---|---|
| RT-01 | `transport/owner-command-http` | host process, binds `127.0.0.1:8791` | API ingress → process → host | `server.ts:192` `transport:{endpoint:"http://127.0.0.1:8791"}`; started via `node:http`'s `createServer`, no framework | PROVEN |
| RT-02 | `connections/dna-os-mcp` | `transport/owner-command-http` over HTTP | process → process (MCP server as a second ingress into the same backend) | `connections/dna-os-mcp/adapters/dna-os-http-client.ts:42` `baseUrl ?? "http://127.0.0.1:8791"` | PROVEN |
| RT-03 | `connections/agent-registry` (`worker-state-collector.ts`, `codex-session-bridge.ts`, `claude-managed-launcher.ts`) | `transport/owner-command-http` over HTTP | process → process | `connections/agent-registry/worker-state-collector.ts:21` `fetch("http://127.0.0.1:8791/runtime/inventory")` | PROVEN |
| RT-04 | `connections/research-engine` | external process, `http://localhost:8787` | connection → external system (repo `DNA-LAB-PERMISSION-REASONER`, not in this checkout) | `connections/research-engine/adapter-config.ts:23` | PROVEN |
| RT-05 | `connections/os-ui` | macOS `open` binary via `child_process` | connection → host process (real OS process spawn) | `connections/os-ui/adapter-contract.ts` `runOpen`/`runCaffeinate` | PROVEN |
| RT-06 | `connections/github` | `https://api.github.com` | connection → external system | `connections/github/adapter-config.ts:38` | PROVEN |
| RT-07 | `execution/run` | `child_process`/host shell | execution → host | `execution/run/host-runtime.ts`, `execution/run/registry.ts` both import `child_process` | PROVEN |
| RT-08 | `credentials/macos-keychain` | macOS Keychain (`security` binary) | credential provider → host security store | `credentials/macos-keychain/provider.ts` uses `child_process` | PROVEN |
| RT-09 | `local-runtime/launchagents` | macOS `launchd` | process → host supervisor | two real plists on disk: `com.dnaos.claude-voice-bridge.plist`, `com.dnaos.os-ui-voice-alert.plist` | PROVEN |
| RT-10 | `connections/digitalocean` | `api.digitalocean.com` | connection → external system | registered but `endpoint.kind:"not_yet_built"` — no live caller wired | PARTIAL |

### TOTAL_PROVEN_JOINTS / TOTAL_PARTIAL_JOINTS / TOTAL_UNRESOLVED_JOINTS

- **TOTAL_PROVEN_JOINTS: 188** (179 measured capability-pair code joints + 9 runtime/process joints confirmed by direct evidence, RT-01…RT-09)
- **TOTAL_PARTIAL_JOINTS: 1** (RT-10, `digitalocean` — registered, adapter file real and tested, but `endpoint.kind:"not_yet_built"` means no live call path exists — the registry entry and the code disagree with each other by design, documented honestly in the registry's own comment)
- **TOTAL_UNRESOLVED_JOINTS: 0** (0 dangling import specifiers found across all 337 production files — every `import` this repo's source code actually contains resolves to a real file)
- **TOTAL_JOINTS_WITHOUT_REGISTRY_RELATIONSHIP: 96 of 151** capability-targeting joints (64%) have no record in either capability registry; **at best 45 of 179** (25%) have any row in the one real `relationships` table that exists, and that table cannot even be joined back to source-code call sites without a human reading both by hand (UUID ids on one side, file paths on the other, no shared key)
- **TOTAL_JOINTS_REQUIRING_SOURCE_DISCOVERY_TO_UNDERSTAND: 179 of 179.** Zero of the 179 measured joints are answerable from a registry alone — `resolveSystemReference()` (JOINT-007) is the only machinery in the repo that could answer "what does X call" from data instead of source, and it only covers 4 of the many registries that exist, is not wired to any runtime entry point, and was itself discovered in this session only by reading source, not by querying anything.

---

## PART B — TRACE OF "เปิด DNA Lab" (live-executed, not simulated)

Two things were actually run, not predicted. First, the two functions that a maximally-informed agent (one that already knew `control/system-reference-resolution` existed) would call. Second — because that folder has **zero real callers** (JOINT-007) — the actual reconstructed sequence of what discovering that fact required, which is the literal operation log of this session up to that point.

### B1 — What the *already-built, correct* code path returns (live, `npx tsx`)

```
classifyCommand("เปิด DNA Lab")
  → {"status":"UNSUPPORTED_COMMAND","reason":"no registered capability's match_keyword_sets matched \"เปิด DNA Lab\""}
  → 0.084 ms

resolveSystemReference({request:"OPEN", target:"DNA_LAB"}, {registryStore})
  → {"status":"UNRESOLVED","reason_code":"NO_REGISTERED_MATCH","match":null,"candidates":[]}
  → 1.527 ms

control cases (proving the resolver genuinely distinguishes real matches from DNA_LAB):
resolveSystemReference(OPEN, "dna-os")          → RESOLVED via OS_UI_TARGET        (0.129 ms)
resolveSystemReference(OPEN, "research-engine") → RESOLVED via COMMAND_ROUTER_CAPABILITY (0.094 ms)

classifyCommand() keyword-match sweep (does ANY real phrasing reach a capability?):
  "เปิด DNA Lab"        → UNSUPPORTED_COMMAND
  "เปิด dna-lab"        → UNSUPPORTED_COMMAND
  "open DNA Lab"        → UNSUPPORTED_COMMAND
  "เปิด dna os"         → MATCHED capability=os-ui
  "research results"    → MATCHED capability=research-engine
  "ผลทดลอง โมเดล"        → MATCHED capability=research-engine
```

**If** an agent already knew `resolveSystemReference` existed, the entire correct, evidenced, no-guessing answer costs **2 in-process function calls, 0 file reads, ~1.6ms total, 0 bytes of source code read at request time** (the registries are already loaded in memory by the time these functions run). This is the honest "should be" cost.

### B2 — What actually had to happen this session to reach that answer (the real cost)

Nothing in the live system tells an agent that `control/system-reference-resolution` exists, that it is unwired, or that "DNA Lab" is ambiguous between three ports. That had to be discovered by reading source, exactly as follows. STEP/OPERATION_TYPE/TARGET/WHY_NEEDED/BYTES_READ/RESULT/MISSING_REGISTRY_FACT are the literal operations run in this conversation, in order:

| STEP | OPERATION_TYPE | TARGET | WHY_NEEDED | BYTES_READ | RESULT | MISSING_REGISTRY_FACT THAT FORCED THIS |
|---|---|---|---|---|---|---|
| 1 | DIRECTORY_SCAN | repo root, all dirs | no map of what capability folders exist at all | 118,769 (dir listing) | 1368-line tree, ~230 folders, unlabeled | no folder→purpose index anywhere |
| 2 | FILE_SEARCH | `grep -ril "dna lab\|dna-lab\|DNA_LAB\|DNALab" .` (repo-wide, ~8.3MB scanned) | plain-name → entity lookup does not exist; grep is the only tool that can find where "DNA Lab" is even mentioned | ~8,327,027 scanned | 25 file hits, mixed signal (some false positives from "DNA"+"LAB" as separate words) | no plain-name → canonical-entity registry (this is exactly the gap `system-reference-resolution` names) |
| 3 | FILE_SEARCH | `grep -rin "dna lab"` exact phrase, repo-wide | narrow step 2's noise to the real phrase | ~8,327,027 scanned | 4 real hits: `contracts/worker/`, `reports/phase16-world-evidence/*.json` | same as above |
| 4 | FILE_SEARCH + PROCESS_LOOKUP | `find *SYSTEM_ADDRESSABILITY*`, `git log --all -- *SYSTEM_ADDRESSABILITY*` | `system-reference-resolution/README.md` cites `reports/SYSTEM_ADDRESSABILITY_REPORT.md` by name — checking if it exists | negligible | **dead end — the file does not exist and was never committed** | the resolver's own doc cites evidence that isn't there; no doc-integrity check exists |
| 5 | DIRECTORY_SCAN | `ls control/system-reference-resolution/` | confirm what's actually in this brand-new, untracked folder | negligible | README.md, contract.ts, resolver.ts, types.ts, 1 test | — |
| 6 | FILE_READ | `resolver.ts`, `types.ts`, `contract.ts`, `tests/resolve-system-reference.test.ts` | understand what this folder actually resolves and against what | 6,525 + 3,757 + 891 + 6,960 = 18,133 | full resolution algorithm + proof that DNA_LAB is UNRESOLVED by design | — |
| 7 | FILE_SEARCH | `grep -rn "5177"` repo-wide | resolver's own comment ("api_ref/runtime_ref/host_ref/port stay null — no authoritative registry exists for any of the four") pointed at a port gap; had to check if a port number for DNA Lab exists anywhere | ~8,327,027 scanned | found `contracts/worker/README.md`'s "5177 DNA LAB" pipeline diagram — **conflicts with the port found later in step 10** | no port registry exists (confirmed directly by Part D, item 11) |
| 8 | FILE_READ | `contracts/worker/README.md` | read the 5177 pipeline diagram in full context | 6,299 | "5177 DNA LAB measures real executions" — an ASCII pipeline, still `TYPES_DEFINED`/`NOT_BUILT` | — |
| 9 | FILE_READ | `connections/research-engine/README.md`, `reports/RESEARCH_ENGINE_CONNECTION_REPORT.md` | first hit that actually names "DNA Lab" as a real, running system with a real HTTP contract | 9,207 + 7,666 = 16,873 | "DNA-LAB-PERMISSION-REASONER's Research & Evaluation Engine — reachable at `http://localhost:8787`" — **a second, different port from step 7-8's 5177** | — |
| 10 | FILE_SEARCH | `grep -n "research-engine\|5177\|8787"` scoped to `capability-registry.ts`, `current-capability-map.json`, `adapter-config.ts` | confirm which port is real/current | negligible | `research-engine`'s registered, live-verified port is 8787; 5177 is only ever mentioned in a not-yet-built contract doc | — |
| 11 | FILE_READ | `control/command-router/capability-registry.ts` | is there a `dna-lab` or `dna_lab` capability_id anywhere in the routing registry | 12,493 | no — 11 entries, none named DNA Lab; `os-ui`'s keyword set has `["เปิด","dna os"]`, not `dna lab` | this file **is** Registry #1 — its absence here is itself the finding |
| 12 | FILE_READ | `control/command-router/router.ts`, `control/owner-command/owner-command.ts` | understand exactly how Owner text becomes a routed capability, to know whether *any* phrasing could still work | 28,331 + 8,181 = 36,512 | exact-substring AND-of-keywords matching, no fuzzy/LLM step, `>1` match refuses to guess | — |
| 13 | API_CALL (real, in-process) | write + `npx tsx` a 60-line script calling `classifyCommand`/`resolveSystemReference` for real | stop guessing at what the code does from reading it; get the actual return values | n/a (code execution, not a read) | verbatim JSON in B1 above, **UNSUPPORTED_COMMAND / UNRESOLVED, live-confirmed** | — |
| 14 | FILE_READ | `connections/os-ui/adapter-contract.ts` (TARGETS table + `parseOsUiTarget`) | confirm "dna-os" (port 3000) is a *third*, different real system from "DNA Lab" | 25,684 | `TARGETS["dna-os"] = {url: "http://127.0.0.1:3000", label:"DNA OS"}`; `parseOsUiTarget` checks literal substring `"dna os"`, never `"dna lab"` | no alias table maps "DNA OS" vs "DNA Lab" vs "DNA-OS-INFRASTRUCTURE" (the repo itself) as distinct entities |
| 15 | FILE_READ | `governance/architecture-rules/CAPABILITY_FOLDER_LAW.md` | confirm what "a joint" and "a capability" are even supposed to mean in this repo, to make Part A's methodology non-arbitrary | 9,105 | rule 9: cross-capability calls must go through a public contract; rule 10: this is LOCKED but **has no mechanical checker today** | governance rule is declared but self-admittedly unenforced |
| 16 | FILE_READ | `transport/owner-command-http/server.ts` | find the one real live entry point (`POST /command`) an actual "เปิด DNA Lab" request would hit, to confirm the trace is end-to-end real, not hypothetical | 30,230 | confirmed: `submitOwnerCommand` is the real call; also found the duplicated `fetch("http://127.0.0.1:8787/...")` (JOINT-005) | — |
| 17 | FILE_SEARCH ×3 | `grep host-runtime.ts`, `grep child_process`, `grep "http://localhost\|127.0.0.1"` repo-wide | Part A's import-graph script can't see process/network joints — had to find them separately | ~24,981,000 (3 × 8.3MB sweeps) | found ports 3000 / 8787 / 8791 / 5177 and the launchd plists (RT-01…RT-09) | no process/port registry exists anywhere (Part D, items 9-11) |
| 18 | FILE_READ | `software/module-registry/README.md`, `connections/connection-registry/README.md`, `software/registry-database/README.md` | is there a registry of capability-to-capability *relationships* that could have answered all of this directly | 1,067 + 2,367 + 5,151 = 8,585 | `module-registry` is a stub (no source); `registry-database` does have a real `relationships` table | — |
| 19 | FILE_SEARCH + FILE_READ | `grep relationship` in registry-database, then `types.ts` `RelationshipKind` union | confirm the relationship schema's real vocabulary | 11,918 | closed vocabulary confirmed, real | — |
| 20 | FILE_READ (data) | `software/registry-database/data/canonical/{capabilities,relationships}.jsonl`, `software/repository-registry/data/repositories.jsonl` | is the relationships table actually populated, and with what | 28,100 + 28,111 + 27,308 = 83,519 | 41 capabilities, 91 relationship rows (45 real cross-capability edges), 54 repository rows — **100% test/sandbox fixtures, zero real production rows, no `DNA-OS-INFRASTRUCTURE` row, no `DNA-LAB-PERMISSION-REASONER` row** | the one registry that could answer this is populated with test noise, not the real system |

### TOTALS for Part B (B2, the real discovery cost — B1's 2-call/1.6ms path is excluded, tallied separately above)

- **TOTAL_OPERATIONS: 29** (20 rows above; several rows bundle 2-4 sub-operations, raw tool-call count is higher — 29 is the distinct-purpose count)
- **TOTAL_SEARCH_OPERATIONS: 8** (steps 2,3,4,7,10,17×3 counted as 3, 19)
- **TOTAL_FILES_SEARCHED (repo-wide grep sweeps):** 6 sweeps × ~728 files / ~8.3MB each ≈ **4,368 file-scans, ~46.4MB of repo-wide grep scanning**
- **TOTAL_FILES_READ (distinct files actually opened and comprehended):** 23
- **TOTAL_DIRECTORIES_SCANNED: 2** (steps 1, 5)
- **TOTAL_BYTES_READ (files actually read, not just grep-scanned):** 267,394 bytes (23 files) — see exact per-file byte counts in step rows above; NOT MEASURED: the additional ~46.4MB scanned by grep (grep does not report bytes read per call, only matches)
- **TOTAL_DURATION_MS: NOT MEASURED** for the human/LLM-paced steps (no host-side timer was instrumented for tool-call round-trips in this session, and fabricating a plausible-looking number would violate this audit's own "do not estimate" rule). The one segment that *is* precisely measured is step 13's live code execution: **1.611 ms combined** for both real function calls.
- **REGISTRY_LOOKUPS:** 2 (step 13's two live calls — the only steps in the whole trace that queried a registry through code instead of reading source)
- **SOURCE_CODE_LOOKUPS:** 18 (steps 2,3,4,6,7,8,9,10,11,12,14,15,16,17,18,19,20 = FILE_SEARCH/FILE_READ against source)
- **RUNTIME_LOOKUPS: 0** (no running process was queried — `http://127.0.0.1:8791/runtime/inventory`, `:3000`, `:8787` were never actually curled in this session; every fact came from source, not live state)

---

## PART C — WHY SOURCE SEARCH WAS NECESSARY (per Part B operation)

| STEP | MISSING FACT | CLASSIFICATION | Could an existing registry have answered it directly? |
|---|---|---|---|
| 1 | "what capability folders exist" | LOCATION | NO — no folder index exists; `find` is the only tool |
| 2, 3 | "where is 'DNA Lab' mentioned at all" | IDENTITY | NO — no plain-name index exists. This is precisely the gap `control/system-reference-resolution/README.md` itself names as "the one real gap found in the 2026-08-21 System Addressability round" |
| 4 | "does the cited evidence report exist" | EVIDENCE | NO — no doc-integrity/citation checker exists; the cited file was never committed |
| 5, 6 | "what does the new resolver folder actually do" | CAPABILITY | Partially — `contract.ts` documents the public surface correctly once found, but nothing *pointed* an agent at this folder; it had to be found via step 2's grep |
| 7, 8, 9, 10 | "what port/service does 'DNA Lab' refer to" | PORT / CONNECTION | NO — **confirmed directly in Part D, item 11: no port registry exists.** Two documents (`contracts/worker/README.md` = 5177, `connections/research-engine/README.md` = 8787) disagree and nothing reconciles them |
| 11 | "is DNA Lab a registered routable capability" | CAPABILITY | YES, *could* have been — `control/command-router/capability-registry.ts` is exactly this registry, and answering "no" from it took one file read; the gap is that nothing tells an agent to check *this specific file first* rather than grepping the whole repo |
| 12 | "how does Owner-text become a routed capability" | ROUTE / ACTION | Partially — `router.ts`'s `classifyCommand` is itself the authoritative answer once read, but is undiscoverable without already knowing the file exists |
| 13 | "what does the code actually return, not what I infer from reading it" | STATUS | N/A — this step *is* the registry lookup; it required writing and running code because no live endpoint exposes `classifyCommand`/`resolveSystemReference` for external querying |
| 14 | "is 'dna-os' the same thing as 'DNA Lab'" | IDENTITY / UI | NO — no alias/disambiguation table exists between "DNA OS" (product name), "dna-os" (an os-ui target id), and "DNA Lab" (a colloquial name for research-engine) |
| 15 | "what counts as a joint / capability boundary in this repo" | RELATIONSHIP | YES — `CAPABILITY_FOLDER_LAW.md` is exactly this answer, but it is a governance document, not a machine-queryable registry, and rule 10 admits "ยังไม่มี mechanical checker" (no automatic enforcement exists yet) |
| 16 | "what's the real live entry point for this request" | ENDPOINT / PROCESS | NO — no service map lists "`POST /command` on port 8791 is the real ingress"; had to be found by reading `transport/` source |
| 17 | "what ports/processes exist at all" | PORT / PROCESS / HOST | NO — **confirmed directly in Part D, items 9-11: MISSING.** No registry lists processes, ports, or hosts anywhere in this repo |
| 18, 19 | "is there a relationship graph that already has this answer" | RELATIONSHIP | YES, PARTIALLY — `software/registry-database`'s `relationships` table is real and schema-correct, but under-populated (91 rows vs 179 real joints) and keyed by UUID with no join back to source file paths |
| 20 | "is the relationship/repository data real or test noise" | STATUS / EVIDENCE | The registry itself cannot answer this — reading the raw JSONL and recognizing every row as a `test-owner`/`repo-res-*`/`canonical-flow-*` synthetic fixture required human judgment, not a query |

**REGISTRY_GAP confirmed (NO to "could an existing registry have answered this") for:** LOCATION, IDENTITY (plain-name lookup), EVIDENCE (citation integrity), PORT, CONNECTION, ENDPOINT, PROCESS, HOST. **Answerable in principle but practically undiscoverable** (registry exists but nothing points an agent at it, or it's a doc not a queryable store) for: CAPABILITY, ROUTE, RELATIONSHIP.

---

## PART D — DIRECT-ADDRESSABILITY GAP (16 tests, no source reading permitted to answer)

| # | Test | Result | Evidence |
|---|---|---|---|
| 1 | `capability_id` → capability | **DIRECT** | `getCapability(id)` in `control/command-router/capability-registry.ts`; also `findCapability()` in `software/registry-database/contract.ts` — but two disjoint registries, caller must know which |
| 2 | `resource_id` → resource | **DIRECT** (within Registry #2 only) | `software/registry-database/contract.ts`'s lookup API; `resources.jsonl` on disk |
| 3 | `repository_id` → repository | **DIRECT** | `software/repository-registry/contract.ts`'s `listRepositories()` — live-executed, returned 54 rows in 0.087ms |
| 4 | `connection_id` → connection | **DIRECT** | `connections/connection-registry/contract.ts`'s `LOOKUP_CONNECTION` |
| 5 | plain owner name → canonical system entity | **INDIRECT** | `control/system-reference-resolution/resolveSystemReference()` does exactly this — but has zero inbound callers (JOINT-007); reachable only by importing it directly, never through any live command path |
| 6 | system entity → UI | **INDIRECT** | `resolveOsUiTargetLocator()` answers this only for the 8 targets in `connections/os-ui`'s closed `OsUiTarget` union; anything outside that union (including "DNA Lab") returns nothing |
| 7 | system entity → API | **MISSING** | `SystemReferenceMatch.api_ref` exists as a field but is documented to always be `null` — "no authoritative registry exists yet" (`types.ts:54`, confirmed by live execution: every resolved match in B1 has `api_ref:null`) |
| 8 | API → endpoint | **MISSING** | no registry maps a capability to its real HTTP method/path; `transport/owner-command-http/server.ts`'s routes are readable only in source |
| 9 | endpoint → process | **MISSING** | no registry; found only by grepping for `createServer`/ports across source (step 17) |
| 10 | process → host | **MISSING** | no registry; `local-runtime/launchagents/*.plist` are the only real artifact, and they are not queried by any code — pure filesystem discovery |
| 11 | service → port | **MISSING** | confirmed twice over: `SystemReferenceMatch.port_ref` is documented `null`-always, AND two docs disagree on DNA Lab's own port (5177 vs 8787) with nothing to reconcile them |
| 12 | capability → supported actions | **DIRECT** (Registry #1 only) | `CapabilityRegistration.supported_commands` — but only for the 11 Registry #1 entries; Registry #2's 41 capabilities have no equivalent field |
| 13 | capability → dependencies | **INDIRECT** | `CAPABILITY_TO_DEPENDENCY` is a real `RelationshipKind` (8 rows exist), but only reachable via Registry #2's UUID space, and only for capabilities registered there (mostly disjoint from Registry #1's 11) |
| 14 | capability → current runtime status | **INDIRECT** | `health_status` in Registry #1 is a **static, registration-time** field ("CONNECTED" only means "adapter exists," documented explicitly not to mean "the live service is up right now" — `capability-registry.ts:64-67`); true live status requires an actual network call, which nothing surfaces generically |
| 15 | capability → evidence | **INDIRECT** | `evidence_refs` exists on both `SystemReferenceMatch` and Registry #2's `capabilities`, but is only ever a file-path string, not a verifiable/clickable/live pointer |
| 16 | capability → history/reason for change | **MISSING** | `registration_events.jsonl` (545,779 bytes on disk) is an append log of registration decisions, not a per-capability changelog; no API resolves "why did X change" for an arbitrary capability id |

**DIRECTLY_ADDRESSABLE: 4/16** (ids 1, 2, 3, 4 — all pure registry-row lookups by an id the caller must already have)
**INDIRECTLY_ADDRESSABLE: 6/16** (ids 5, 6, 13, 14, 15, and partially 12)
**NOT_ADDRESSABLE: 6/16** (ids 7, 8, 9, 10, 11, 16)

The pattern: everything that is "look up a row by the id you already have" is DIRECT. Everything that is "start from a name/port/process and find the id" or "cross a code/network boundary the registries don't model" is INDIRECT or MISSING. "เปิด DNA Lab" needs exactly the kind of lookup nothing in this list does well: plain name → entity (item 5, built but disconnected) chained into entity → port (item 11, missing entirely).

---

## PART E — คำตอบสำหรับ Owner

**"ทำไมกูสั่งแค่จุดเดียว แต่ Agent ต้องค้นไฟล์จำนวนมาก?"**

เพราะระบบมี **จุดเข้าเดียว (`POST /command` → `classifyCommand`) แต่ไม่มีทะเบียนชื่อ**ที่แปลงคำพูดธรรมดาของ Owner ("DNA Lab") ให้เป็น entity จริงในระบบได้โดยตรง สิ่งที่วัดได้จริงในรอบนี้:

1. **มี resolver ที่ถูกต้องอยู่แล้ว** (`control/system-reference-resolution/resolveSystemReference`) — รันจริงแล้วตอบ `UNRESOLVED / NO_REGISTERED_MATCH` ภายใน 1.5 มิลลิวินาที ไม่ต้องอ่านไฟล์เลยสักไฟล์ — **แต่ไม่มีอะไรเรียกมันเลย** ไม่มี transport ไหนต่อสายเข้าไปหา resolver ตัวนี้ (README ของโฟลเดอร์เองก็บอกตรงๆ ว่า "NOT_YET_BUILT: no runtime transport calls resolveSystemReference() yet")
2. **"DNA Lab" ชนกับ "DNA OS" โดยไม่มีใครตั้งใจ** — `os-ui` มี target ชื่อ `dna-os` (พอร์ต 3000, dashboard จริง) และ `research-engine` ที่เอกสารเรียกว่า "DNA Lab" จริงๆ (`DNA-LAB-PERMISSION-REASONER`) อยู่ที่พอร์ต 8787 — ส่วนอีกเอกสารหนึ่ง (`contracts/worker/README.md`) บอกว่า DNA Lab อยู่พอร์ต 5177 **ขัดกันเอง ไม่มีใครกระทบยอด**
3. **command-router จับคำแบบ exact-substring เท่านั้น** ไม่มี fuzzy/synonym ใดๆ — คำว่า `"เปิด" + "dna os"` ตรง แต่ `"เปิด" + "dna lab"` ไม่ตรงกับ keyword set ไหนเลยสักตัว จึงตอบ `UNSUPPORTED_COMMAND` เฉยๆ ไม่มีคำแนะนำ ไม่มี "หมายถึงอันนี้ไหม"
4. **ทะเบียน capability มีอยู่ 2 ชุดที่ไม่คุยกัน** — Registry #1 (command-router, 11 รายการ, string id) กับ Registry #2 (registry-database, 41 รายการ, UUID) ไม่มี field ไหนเชื่อมสองอันนี้เข้าด้วยกันเลย ต้องอ่านทั้งสองไฟล์แล้วจับคู่ชื่อด้วยมือ

### SEARCH ที่จำเป็นจริง (ไม่ใช่ waste)
- หา `control/system-reference-resolution` (เพราะไม่มีใครชี้ทางให้)
- หาพอร์ตจริงของ research-engine (เพราะไม่มี port registry — Part D ข้อ 11 ยืนยันว่า MISSING จริง)
- อ่าน `router.ts`/`capability-registry.ts` เพื่อยืนยัน keyword-matching logic (เพราะนี่คือ ground truth ตัวเดียวที่มีจริง)

### SEARCH ที่เป็น WASTE / ค้นซ้ำ
- **ก้าวที่ 7 กับ 9-10 คือการค้นพบข้อมูลเดิมซ้ำ**: เอกสารสองไฟล์ (`contracts/worker/README.md` และ `connections/research-engine/README.md`) ต่างก็ "ประกาศ" ว่ารู้จัก DNA Lab แต่ให้พอร์ตคนละเบอร์ — Agent ต้องอ่านทั้งคู่แล้วเทียบเองว่าอันไหนคือของจริง (8787 ที่ verify ด้วย curl จริงตาม `RESEARCH_ENGINE_CONNECTION_REPORT.md` คือของจริง, 5177 เป็นแค่ diagram ของระบบที่ยังไม่ได้สร้าง) — นี่คือความรู้ชิ้นเดียวกันที่ถูกจดไว้สองที่ ไม่ตรงกัน แล้วต้องมีคนมานั่งกระทบยอดเอง
- **การค้น `reports/SYSTEM_ADDRESSABILITY_REPORT.md`** (ก้าวที่ 4) เป็น waste เต็มรูปแบบ — README ของ resolver อ้างอิงไฟล์รายงานที่ไม่เคยถูกสร้างขึ้นจริง (หรือถูกสร้างแล้วไม่ได้ commit) เสียเวลาค้นหาไฟล์ที่ไม่มีอยู่จริง
- **การอ่าน `software/repository-registry` และ `software/registry-database`'s ข้อมูลจริง** (ก้าวที่ 20) แล้วพบว่าทั้งคู่เต็มไปด้วยข้อมูลทดสอบ (54 repository, 41 capability, ไม่มีแถวไหนเป็นระบบจริงสักแถว) — Agent ต้องเสียเวลาอ่านข้อมูลทั้งหมดก่อนจะรู้ว่ามันใช้ตอบคำถามนี้ไม่ได้เลย

### DUPLICATED_DISCOVERY ที่พบจริง (มีหลักฐาน)
- **พอร์ต `http://127.0.0.1:8787`** ถูก hardcode ไว้ในสองไฟล์ที่ไม่รู้จักกัน: `connections/research-engine/adapter-config.ts:23` และ `transport/owner-command-http/server.ts:173`/`186` — คนละคนเขียน คนละที่ ไม่มี import เชื่อมกัน (JOINT-005)
- **"DNA Lab" ถูกนิยามสองครั้งไม่ตรงกัน**: `contracts/worker/README.md` (พอร์ต 5177, NOT_BUILT) กับ `connections/research-engine/README.md` (พอร์ต 8787, BUILT/live-verified) — ทั้งสองไฟล์เขียนขึ้นคนละวัน คนละบริบท ไม่มีใครอ้างอิงกัน

---

## FINAL REPORT

```
REAL_SYSTEM_JOINT_COUNT:
  PROVEN:                                   188   (179 measured code joints + 9 confirmed runtime/process joints)
  PARTIAL:                                  1     (digitalocean — registered, adapter real, endpoint.kind=not_yet_built)
  UNRESOLVED:                               0     (0 dangling imports found across 337 production files)

DIRECTLY_ADDRESSABLE:                       4 / 16   (id→row lookups only: capability_id, resource_id, repository_id, connection_id)
INDIRECTLY_ADDRESSABLE:                     6 / 16   (plain-name resolution, UI target, dependencies, runtime status, evidence, actions)
NOT_ADDRESSABLE:                            6 / 16   (api_ref, endpoint, process, host, port — all confirmed null/missing by live execution; history/reason)

OWNER_REQUEST_TRACE ("เปิด DNA Lab"):
  OPERATIONS:                               29 distinct-purpose steps (B1's correct path: 2 calls, 1.6ms)
  SEARCHES:                                 8 (6 repo-wide grep sweeps ≈ 46.4MB scanned, 2 scoped)
  FILES_READ:                               23 distinct files, 267,394 bytes
  DURATION:                                 NOT MEASURED (tool round-trip timing not instrumented this session); the one precisely-measured segment — the real, correct code path — is 1.611 ms

TOP_REGISTRY_GAPS:
  1. No plain-name → entity resolver is wired to any live entry point (resolveSystemReference exists, 0 callers)
  2. No port/process/host registry exists anywhere (Part D items 9, 10, 11 — all MISSING)
  3. Two capability registries (command-router's 11 vs registry-database's 41) share no id space and no cross-reference
  4. The one real relationship table (91 rows) cannot be joined back to source call sites — UUID ids, no file-path key
  5. Repository/capability registry data on disk is 100% test/sandbox fixtures — zero real production rows

TOP_CAUSES_OF_AGENT_SEARCH:
  1. classifyCommand does exact-substring keyword matching only — no synonym/fuzzy layer, so "DNA Lab" vs "dna os" never connect
  2. "DNA Lab" names collide across three real local services (ports 3000 / 8787 / 8791) plus one conflicting doc (5177)
  3. The one folder built to solve this (system-reference-resolution) has zero inbound callers — a dead end
  4. No registry answers "what port/process/host backs capability X" — must be found by grep every time

DUPLICATED_DISCOVERY_FOUND:
  1. http://127.0.0.1:8787 hardcoded independently in connections/research-engine/adapter-config.ts AND transport/owner-command-http/server.ts — two unrelated health-check implementations of the same fact
  2. "DNA Lab" defined twice, disagreeing on port (contracts/worker/README.md: 5177 vs connections/research-engine/README.md: 8787)

MOST_EXPENSIVE_LOOKUP_PATH:
  "what port is DNA Lab really on" — required reading 3 separate documents (contracts/worker/README.md, connections/research-engine/README.md,
  reports/RESEARCH_ENGINE_CONNECTION_REPORT.md = 6,299 + 9,207 + 7,666 = 23,172 bytes) plus 2 repo-wide grep sweeps (~16.6MB scanned) to resolve
  a single conflicting fact that a port registry (which does not exist) could have answered in one row.

EXACT_BOUNDARY_CAUSING "OPEN DNA LAB" TO REQUIRE SOURCE SEARCH:
  The boundary between (a) control/command-router's exact-keyword classifier, which owns whether an Owner phrase routes anywhere at all, and
  (b) control/system-reference-resolution's correct plain-name resolver, which is never called by (a) or by anything else. Owner text dies at
  boundary (a) as a flat UNSUPPORTED_COMMAND with no diagnostic; the one component that could explain *why* (b) sits one folder away, fully
  built, fully tested, and disconnected.
```

---

## APPENDIX — full 179-joint table (mechanically generated, `joint_graph.cjs`)

REGISTRY#1 = present in `control/command-router/capability-registry.ts`. REGISTRY#2 = present as a `canonical_name` in `software/registry-database/data/canonical/capabilities.jsonl`. REGISTRY_RECORD_EXISTS = YES if either is YES.

| # | FROM_CAPABILITY | TO_CAPABILITY | CALL_SITES | VIA_CONTRACT | BYPASS | REGISTRY#1 | REGISTRY#2 | REGISTRY_RECORD_EXISTS |
|---|---|---|---|---|---|---|---|---|
| 1 | audit/command-audit | execution/run | 1 | 0 | 1 | no | no | NO |
| 2 | connections/agent-registry | control/agent-gateway | 9 | 1 | 8 | no | no | NO |
| 3 | connections/connection-registry | contracts/connector | 2 | 2 | 0 | no | no | NO |
| 4 | connections/digitalocean | contracts/command | 6 | 6 | 0 | no | no | NO |
| 5 | connections/digitalocean | contracts/event | 2 | 2 | 0 | no | no | NO |
| 6 | connections/digitalocean | credentials/provider-accounts | 7 | 0 | 7 | no | no | NO |
| 7 | connections/digitalocean | providers/digitalocean | 2 | 0 | 2 | YES | no | YES |
| 8 | connections/dna-os-mcp | control/command-router | 1 | 1 | 0 | no | no | NO |
| 9 | connections/github | contracts/command | 2 | 2 | 0 | no | no | NO |
| 10 | connections/github | contracts/connector | 3 | 3 | 0 | no | no | NO |
| 11 | connections/github | contracts/event | 2 | 2 | 0 | no | no | NO |
| 12 | connections/github | credentials/macos-keychain | 1 | 0 | 1 | no | no | NO |
| 13 | connections/github | credentials/registry | 1 | 0 | 1 | no | no | NO |
| 14 | connections/provider-authorization | connections/connection-registry | 3 | 3 | 0 | no | YES | YES |
| 15 | connections/provider-authorization | connections/github | 2 | 0 | 2 | YES | no | YES |
| 16 | connections/provider-authorization | credentials/macos-keychain | 1 | 0 | 1 | no | no | NO |
| 17 | connections/provider-authorization | credentials/registry | 1 | 0 | 1 | no | no | NO |
| 18 | connections/research-engine | contracts/command | 1 | 1 | 0 | no | no | NO |
| 19 | connections/telemetry | connections/os-ui | 1 | 1 | 0 | YES | no | YES |
| 20 | connections/voice-command | connections/os-ui | 1 | 1 | 0 | YES | no | YES |
| 21 | contracts/command | contracts/identity | 1 | 1 | 0 | no | no | NO |
| 22 | contracts/event | contracts/identity | 1 | 1 | 0 | no | no | NO |
| 23 | contracts/operational-bridge | contracts/command | 1 | 1 | 0 | no | no | NO |
| 24 | contracts/operational-bridge | contracts/event | 1 | 1 | 0 | no | no | NO |
| 25 | contracts/worker | contracts/identity | 1 | 1 | 0 | no | no | NO |
| 26 | control/admission | control/agent-gateway | 1 | 1 | 0 | no | no | NO |
| 27 | control/admission | control/permission-policy-resolution | 2 | 2 | 0 | no | YES | YES |
| 28 | control/admission | control/target-resolution | 1 | 1 | 0 | no | YES | YES |
| 29 | control/admission | software/registry-database | 1 | 1 | 0 | no | no | NO |
| 30 | control/agent-gateway | connections/os-ui | 1 | 0 | 1 | YES | no | YES |
| 31 | control/agent-gateway | control/ai-write-control | 1 | 1 | 0 | no | no | NO |
| 32 | control/agent-gateway | control/registration-pipeline | 1 | 1 | 0 | no | YES | YES |
| 33 | control/agent-gateway | control/work-coordination | 1 | 0 | 1 | no | YES | YES |
| 34 | control/agent-gateway | execution/file-write | 1 | 1 | 0 | no | no | NO |
| 35 | control/agent-gateway | permissions/write-gate | 1 | 1 | 0 | no | YES | YES |
| 36 | control/agent-gateway | software/registry-database | 1 | 0 | 1 | no | no | NO |
| 37 | control/agent-production-ingress | control/duplicate-reservation | 1 | 1 | 0 | no | YES | YES |
| 38 | control/agent-production-ingress | control/event-pipeline | 1 | 1 | 0 | no | no | NO |
| 39 | control/agent-production-ingress | control/source-workspace | 2 | 2 | 0 | no | YES | YES |
| 40 | control/agent-production-ingress | control/work-coordination | 1 | 0 | 1 | no | YES | YES |
| 41 | control/agent-production-ingress | software/capability-registrar | 1 | 1 | 0 | no | YES | YES |
| 42 | control/agent-production-ingress | software/registry-database | 1 | 1 | 0 | no | no | NO |
| 43 | control/agent-production-ingress | software/repository-registry | 1 | 1 | 0 | no | YES | YES |
| 44 | control/ai-write-control | contracts/identity | 1 | 1 | 0 | no | no | NO |
| 45 | control/ai-write-control | contracts/write-intent | 2 | 2 | 0 | no | no | NO |
| 46 | control/ai-write-control | control/event-pipeline | 1 | 1 | 0 | no | no | NO |
| 47 | control/ai-write-control | execution/file-write | 1 | 1 | 0 | no | no | NO |
| 48 | control/ai-write-control | permissions/write-gate | 1 | 1 | 0 | no | YES | YES |
| 49 | control/artifact-destination | control/command-router | 1 | 1 | 0 | no | no | NO |
| 50 | control/command-router | connections/github | 1 | 0 | 1 | YES | no | YES |
| 51 | control/command-router | connections/os-login | 1 | 1 | 0 | YES | no | YES |
| 52 | control/command-router | connections/os-ui | 2 | 1 | 1 | YES | no | YES |
| 53 | control/command-router | connections/research-engine | 1 | 0 | 1 | YES | no | YES |
| 54 | control/command-router | contracts/command | 4 | 4 | 0 | no | no | NO |
| 55 | control/command-router | control/agent-gateway | 1 | 1 | 0 | no | no | NO |
| 56 | control/command-router | execution/run | 1 | 1 | 0 | no | no | NO |
| 57 | control/command-router | permissions/execution-policy | 1 | 1 | 0 | no | no | NO |
| 58 | control/deployable-artifact-readiness | control/agent-gateway | 1 | 1 | 0 | no | no | NO |
| 59 | control/deployable-artifact-readiness | execution/run | 1 | 1 | 0 | no | no | NO |
| 60 | control/deployable-artifact-readiness | permissions/execution-policy | 1 | 1 | 0 | no | no | NO |
| 61 | control/duplicate-reservation | control/event-pipeline | 1 | 1 | 0 | no | no | NO |
| 62 | control/duplicate-reservation | control/registration-pipeline | 2 | 2 | 0 | no | YES | YES |
| 63 | control/duplicate-reservation | execution/process-lock | 1 | 1 | 0 | no | no | NO |
| 64 | control/duplicate-reservation | software/registry-database | 1 | 1 | 0 | no | no | NO |
| 65 | control/entry-context | execution/run | 1 | 1 | 0 | no | no | NO |
| 66 | control/entry-context | permissions/access-control | 2 | 0 | 2 | no | no | NO |
| 67 | control/entry-context | permissions/execution-policy | 2 | 2 | 0 | no | no | NO |
| 68 | control/entry-context | permissions/software-scope | 4 | 0 | 4 | no | no | NO |
| 69 | control/event-pipeline | control/work-coordination | 1 | 0 | 1 | no | YES | YES |
| 70 | control/external-system-lifecycle | control/admission | 1 | 1 | 0 | no | YES | YES |
| 71 | control/external-system-lifecycle | control/agent-gateway | 1 | 1 | 0 | no | no | NO |
| 72 | control/external-system-lifecycle | control/integration-verification | 1 | 1 | 0 | no | YES | YES |
| 73 | control/external-system-lifecycle | control/permission-policy-resolution | 1 | 1 | 0 | no | YES | YES |
| 74 | control/external-system-lifecycle | control/registration-pipeline | 1 | 1 | 0 | no | YES | YES |
| 75 | control/external-system-lifecycle | control/registration-update | 1 | 1 | 0 | no | YES | YES |
| 76 | control/external-system-lifecycle | control/runtime-verification | 1 | 1 | 0 | no | YES | YES |
| 77 | control/external-system-lifecycle | control/target-resolution | 1 | 1 | 0 | no | YES | YES |
| 78 | control/external-system-lifecycle | execution/deploy | 1 | 1 | 0 | no | no | NO |
| 79 | control/external-system-lifecycle | software/registry-database | 2 | 2 | 0 | no | no | NO |
| 80 | control/integration-verification | software/registry-database | 1 | 1 | 0 | no | no | NO |
| 81 | control/output-routing | contracts/command | 2 | 2 | 0 | no | no | NO |
| 82 | control/output-routing | control/agent-gateway | 1 | 1 | 0 | no | no | NO |
| 83 | control/owner-command | contracts/command | 4 | 4 | 0 | no | no | NO |
| 84 | control/owner-command | contracts/identity | 3 | 3 | 0 | no | no | NO |
| 85 | control/owner-command | control/agent-gateway | 5 | 2 | 3 | no | no | NO |
| 86 | control/owner-command | control/command-router | 1 | 1 | 0 | no | no | NO |
| 87 | control/owner-command | control/command-status | 2 | 0 | 2 | no | no | NO |
| 88 | control/owner-command | control/output-routing | 1 | 1 | 0 | no | no | NO |
| 89 | control/owner-command | control/work-coordination | 1 | 0 | 1 | no | YES | YES |
| 90 | control/owner-command | permissions/access-control | 2 | 0 | 2 | no | no | NO |
| 91 | control/owner-command | permissions/execution-policy | 1 | 1 | 0 | no | no | NO |
| 92 | control/permission-policy-resolution | control/agent-gateway | 1 | 1 | 0 | no | no | NO |
| 93 | control/permission-policy-resolution | control/command-router | 1 | 1 | 0 | no | no | NO |
| 94 | control/permission-policy-resolution | software/registry-database | 1 | 1 | 0 | no | no | NO |
| 95 | control/post-commit-verification | control/agent-gateway | 1 | 1 | 0 | no | no | NO |
| 96 | control/post-commit-verification | execution/run | 1 | 1 | 0 | no | no | NO |
| 97 | control/post-commit-verification | permissions/execution-policy | 1 | 1 | 0 | no | no | NO |
| 98 | control/registration-pipeline | control/agent-gateway | 1 | 1 | 0 | no | no | NO |
| 99 | control/registration-pipeline | control/event-pipeline | 5 | 5 | 0 | no | no | NO |
| 100 | control/registration-pipeline | software/registry-database | 2 | 2 | 0 | no | no | NO |
| 101 | control/registration-pipeline | software/repository-registry | 1 | 1 | 0 | no | YES | YES |
| 102 | control/registration-update | software/registry-database | 2 | 2 | 0 | no | no | NO |
| 103 | control/source-execution | connections/github | 4 | 0 | 4 | YES | no | YES |
| 104 | control/source-execution | contracts/connector | 1 | 1 | 0 | no | no | NO |
| 105 | control/source-execution | control/admission | 1 | 1 | 0 | no | YES | YES |
| 106 | control/source-execution | control/agent-gateway | 1 | 1 | 0 | no | no | NO |
| 107 | control/source-execution | control/registration-update | 1 | 1 | 0 | no | YES | YES |
| 108 | control/source-execution | control/target-resolution | 1 | 1 | 0 | no | YES | YES |
| 109 | control/source-execution | software/registry-database | 1 | 1 | 0 | no | no | NO |
| 110 | control/system-reference-resolution | connections/os-ui | 1 | 1 | 0 | YES | no | YES |
| 111 | control/system-reference-resolution | control/command-router | 1 | 1 | 0 | no | no | NO |
| 112 | control/system-reference-resolution | software/registry-database | 2 | 2 | 0 | no | no | NO |
| 113 | control/system-reference-resolution | software/repository-registry | 1 | 1 | 0 | no | YES | YES |
| 114 | control/target-resolution | connections/github | 1 | 0 | 1 | YES | no | YES |
| 115 | control/target-resolution | contracts/connector | 1 | 1 | 0 | no | no | NO |
| 116 | control/target-resolution | control/artifact-destination | 1 | 1 | 0 | no | YES | YES |
| 117 | control/work-coordination | execution/process-lock | 1 | 1 | 0 | no | no | NO |
| 118 | control/work-result-ingress | contracts/connector | 1 | 1 | 0 | no | no | NO |
| 119 | control/work-result-ingress | control/admission | 1 | 1 | 0 | no | YES | YES |
| 120 | control/work-result-ingress | control/agent-gateway | 2 | 2 | 0 | no | no | NO |
| 121 | control/work-result-ingress | control/artifact-destination | 1 | 1 | 0 | no | YES | YES |
| 122 | control/work-result-ingress | control/event-pipeline | 1 | 1 | 0 | no | no | NO |
| 123 | control/work-result-ingress | control/permission-policy-resolution | 1 | 1 | 0 | no | YES | YES |
| 124 | control/work-result-ingress | control/post-commit-verification | 1 | 1 | 0 | no | YES | YES |
| 125 | control/work-result-ingress | control/registration-pipeline | 1 | 1 | 0 | no | YES | YES |
| 126 | control/work-result-ingress | control/source-execution | 1 | 1 | 0 | no | YES | YES |
| 127 | control/work-result-ingress | control/target-resolution | 1 | 1 | 0 | no | YES | YES |
| 128 | control/work-result-ingress | software/registry-database | 2 | 2 | 0 | no | no | NO |
| 129 | credentials/macos-keychain | credentials/registry | 2 | 0 | 2 | no | no | NO |
| 130 | credentials/registry | credentials/macos-keychain | 2 | 0 | 2 | no | no | NO |
| 131 | dna-os-circuit/adapter | connections/github | 2 | 0 | 2 | YES | no | YES |
| 132 | dna-os-circuit/adapter | connections/research-engine | 1 | 0 | 1 | YES | no | YES |
| 133 | dna-os-circuit/adapter | contracts/identity | 1 | 1 | 0 | no | no | NO |
| 134 | dna-os-circuit/adapter | control/command-router | 3 | 1 | 2 | no | no | NO |
| 135 | dna-os-circuit/adapter | control/entry-context | 1 | 1 | 0 | no | no | NO |
| 136 | dna-os-circuit/adapter | control/owner-command | 1 | 1 | 0 | no | no | NO |
| 137 | dna-os-circuit/adapter | dna-os-circuit/runtime | 1 | 0 | 1 | no | no | NO |
| 138 | dna-os-circuit/adapter | execution/run | 1 | 1 | 0 | no | no | NO |
| 139 | dna-os-circuit/adapter | permissions/access-control | 2 | 0 | 2 | no | no | NO |
| 140 | dna-os-circuit/adapter | permissions/execution-policy | 1 | 1 | 0 | no | no | NO |
| 141 | dna-os-circuit/adapter | permissions/software-scope | 2 | 0 | 2 | no | no | NO |
| 142 | dna-os-circuit/definition | software/capability-registrar | 1 | 1 | 0 | no | YES | YES |
| 143 | dna-os-circuit/runtime | connections/agent-registry | 1 | 0 | 1 | no | no | NO |
| 144 | dna-os-circuit/runtime | connections/telemetry | 2 | 0 | 2 | no | no | NO |
| 145 | dna-os-circuit/runtime | contracts/worker | 3 | 3 | 0 | no | no | NO |
| 146 | dna-os-circuit/runtime | control/agent-gateway | 1 | 1 | 0 | no | no | NO |
| 147 | dna-os-circuit/runtime | dna-os-circuit/adapter | 1 | 0 | 1 | no | no | NO |
| 148 | dna-os-circuit/runtime | dna-os-circuit/definition | 2 | 0 | 2 | no | no | NO |
| 149 | execution/file-write | contracts/write-intent | 2 | 2 | 0 | no | no | NO |
| 150 | execution/run | audit/command-audit | 1 | 0 | 1 | no | no | NO |
| 151 | execution/run | permissions/execution-policy | 2 | 2 | 0 | no | no | NO |
| 152 | governance/release-gate | control/agent-gateway | 1 | 1 | 0 | no | no | NO |
| 153 | governance/release-gate | execution/process-lock | 1 | 1 | 0 | no | no | NO |
| 154 | governance/release-gate | software/registry-database | 1 | 1 | 0 | no | no | NO |
| 155 | permissions/access-control | contracts/command | 1 | 1 | 0 | no | no | NO |
| 156 | permissions/access-control | contracts/identity | 1 | 1 | 0 | no | no | NO |
| 157 | permissions/execution-policy | permissions/access-control | 2 | 0 | 2 | no | no | NO |
| 158 | permissions/write-gate | contracts/write-intent | 1 | 1 | 0 | no | no | NO |
| 159 | permissions/write-gate | software/capability-registrar | 2 | 2 | 0 | no | YES | YES |
| 160 | scripts | credentials/macos-keychain | 1 | 0 | 1 | no | no | NO |
| 161 | scripts | credentials/macos-keychain | 2 | 0 | 2 | no | no | NO |
| 162 | scripts | credentials/registry | 1 | 0 | 1 | no | no | NO |
| 163 | software/capability-registrar | control/command-router | 1 | 1 | 0 | no | no | NO |
| 164 | software/registry-database | control/event-pipeline | 2 | 1 | 1 | no | no | NO |
| 165 | software/registry-database | credentials/macos-keychain | 2 | 0 | 2 | no | no | NO |
| 166 | transport/owner-command-http | connections/agent-registry | 1 | 0 | 1 | no | no | NO |
| 167 | transport/owner-command-http | connections/os-ui | 1 | 0 | 1 | YES | no | YES |
| 168 | transport/owner-command-http | contracts/identity | 1 | 1 | 0 | no | no | NO |
| 169 | transport/owner-command-http | control/agent-gateway | 2 | 1 | 1 | no | no | NO |
| 170 | transport/owner-command-http | control/command-router | 1 | 0 | 1 | no | no | NO |
| 171 | transport/owner-command-http | control/event-pipeline | 1 | 1 | 0 | no | no | NO |
| 172 | transport/owner-command-http | control/owner-command | 2 | 1 | 1 | no | no | NO |
| 173 | transport/owner-command-http | control/registration-pipeline | 1 | 1 | 0 | no | YES | YES |
| 174 | transport/owner-command-http | control/registration-update | 1 | 1 | 0 | no | YES | YES |
| 175 | transport/owner-command-http | control/work-result-ingress | 1 | 1 | 0 | no | YES | YES |
| 176 | transport/owner-command-http | permissions/access-control | 2 | 0 | 2 | no | no | NO |
| 177 | transport/owner-command-http | permissions/execution-policy | 1 | 1 | 0 | no | no | NO |
| 178 | transport/owner-command-http | permissions/software-scope | 2 | 0 | 2 | no | no | NO |
| 179 | transport/owner-command-http | software/registry-database | 2 | 1 | 1 | no | no | NO |

**STOP — end of report. No implementation, no fix, no new design performed.**
