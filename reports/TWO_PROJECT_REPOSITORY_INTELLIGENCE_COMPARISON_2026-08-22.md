# TWO-PROJECT RESEARCH-GATED ARCHITECTURE COMPARISON

**Mode: measurement + evidence + comparison only. STOP after this report.** No code moved, deleted, rewritten, merged, or created. Nothing was executed that mutates state — the DNA-LAB-FILE-INTELLIGENCE scanner was deliberately **not run** this round (it would overwrite its own `reports/*.json` and push an outbound POST) — all evidence below comes from its own pre-existing, already-generated output plus direct source reads.

## Project identification (from evidence, not assumption)

- **PROJECT A** = `/Users/tam/Desktop/dna-os-deadboard` — specifically `scripts/build-arch-book.ts` → `registry/architecture-book.json` (+ `registry/module-registry.json`), exposed through `GET /api/governance` / `GET+POST /api/build`, consumed by `/admin/system` (and its now-established duplicate/unique siblings — see the prior report in this same series, `ARCHITECTURE_UI_CANONICALIZATION_GATE_2026-08-22.md`).
- **PROJECT B** = `/Users/tam/Desktop/DNA-LAB-FILE-INTELLIGENCE` — a standalone repo, identified as the second real "repository intelligence" implementation by direct evidence: it is named explicitly in DNA-OS-INFRASTRUCTURE's own `reports/phase16-world-evidence/capability_index.json` for two capabilities ("file_duplicate_or_orphan_detection" and the cross-validation target for "codebase_dependency_graph_analysis"), and its own `reports/scan-history.json` contains 39 real, timestamped historical scans including 33 runs against DNA-OS-INFRASTRUCTURE itself — proving it is an actively-used, real tool, not a dormant stub.

Both projects independently produce a file-dependency graph from real source code. Per the task's own instruction, they are treated as fully independent systems below — no shared terminology assumed.

---

## PHASE 1 — PROJECT A TRACE (dna-os-deadboard)

```
UI (/admin/system, /admin/build)
  → GET/POST /api/build (app/api/build/route.ts)
  → POST triggers execSync("npx tsx scripts/sync-registry.ts && npx tsx scripts/build-arch-book.ts")
  → scripts/build-arch-book.ts: glob("**/*.{ts,tsx}") over the real repo (fs-based walk)
  → per file: extractImportsFromFile() [regex], extractExportsFromFile() [regex], extractSymbols() [real TypeScript compiler API, ts.Node/symbolKindOf]
  → calcStatus() cross-references registry/module-registry.json for OK/BROKEN/UNUSED/UNREGISTERED
  → writeFileSync registry/architecture-book.json (scripts/build-arch-book.ts:648)
  → GET /api/governance (app/api/governance/route.ts) reads the file back, adds violations[]/health
  → GraphView.tsx / ForceGraph3DView.tsx render nodes/edges
```

| | Evidence |
|---|---|
| Repository | `/Users/tam/Desktop/dna-os-deadboard` |
| Writer function | `scripts/build-arch-book.ts:648`, `writeFileSync` |
| Input | Real files on disk, `glob("**/*.{ts,tsx}", {cwd: ROOT})` (`build-arch-book.ts:472-475`) |
| Output | `registry/architecture-book.json` — real, on disk, 1,374 nodes (1,365 Module + 9 Layer), 4,774 edges (3,409 `imports` + 1,365 `contains`) |
| Side effects | Overwrites the registry file on every "Sync Now"; also `scripts/sync-registry.ts` writes `registry/module-registry.json` in the same trigger |
| Consumers | `/admin/system`, `/admin/graph` (dead redirect), `/admin/build`, `/admin/architecture` (partial), `/admin/engine-explorer` (module-registry only), plus ~20 non-UI files in `app/api/admin/ide/_lib/`, self-description factories, dependency-discovery scanners (established in the prior report in this series) |
| Runtime dependency | None to run the scan itself (pure Node script); the "Sync Now" HTTP trigger requires the Next.js dev/prod server to be up |
| Business dependency | None found (established in the prior two reports in this series) |

---

## PHASE 2 — PROJECT B TRACE (DNA-LAB-FILE-INTELLIGENCE)

Traced entirely on its own terms — this repo has no "layer," "health ring," or "governance" concepts of its own; those are Project A's vocabulary only.

```
CLI (npx ts-node src/cli.ts <path>) — the ONLY invocation surface (no HTTP trigger, no bin/main entry)
  → scanner/filesystemScanner.ts: real fs.readdirSync recursive walk (scanner/filesystemScanner.ts:33)
  → scanner/importScanner.ts: fs.readFileSync + 4 hand-written REGEXes (import/export-from/require/dynamic-import), NOT an AST parser (importScanner.ts:11-16,50)
  → dependency-map/buildDependencyMap.ts: resolves specifiers, builds file-to-file ImportEdge[] (types.ts:48-52)
  → classifier/classifyFile.ts: deterministic extension/path/content-banner rules (no AI)
  → duplicate-check/duplicateDetector.ts: SHA-256 exact hash + Jaccard token similarity (deterministic)
  → orphan-check/orphanDetector.ts: importedByCount === 0 + not-likely-entrypoint + no dynamic-load signal
  → dependency-map/detectArchitectureViolations.ts + detectDataAccessViolations.ts + detectRegistryViolations.ts + detectCommitScopeViolations.ts
  → reports/reportWriter.ts: writeFileSync reports/latest-{summary,files,dependency-map}.json
  → reports/scanHistory.ts: appends one row to reports/scan-history.json (durable, append-only)
  → reports/findingEmitter.ts: best-effort outbound POST to http://localhost:8790/findings (DNA-OS-INFRASTRUCTURE's dna-os-circuit)
  → ui/dashboard/server.ts (port 4173): GET /api/reports/<file> reads the SAME 3 JSON files back, no separate data path
```

| | Evidence |
|---|---|
| Repository | `/Users/tam/Desktop/DNA-LAB-FILE-INTELLIGENCE` |
| Writer functions | `reports/reportWriter.ts` (`writeReports`), `reports/scanHistory.ts` (`appendScanHistory`) |
| Input | Real files on disk, `fs.readdirSync` recursive walk (`scanner/filesystemScanner.ts:30-92`), excludes `node_modules,.git,.next,dist,build,coverage,vendor,caches` |
| Output | `reports/latest-summary.json`, `reports/latest-files.json`, `reports/latest-dependency-map.json` (overwritten each run), `reports/scan-history.json` (append-only, real 39-row history) |
| Side effects | Overwrites the three `latest-*` files every run; appends to `scan-history.json`; fires an outbound HTTP POST per finding to a DIFFERENT repository's process |
| Consumers | `ui/dashboard/server.ts` (its own dashboard, reads the exact same files); externally, DNA-OS-INFRASTRUCTURE's `capability_index.json` cites this tool's output by name |
| Runtime dependency | None to run the scan (CLI-only, `ts-node`); `git` binary required for `gitScanner.ts` |
| Business dependency | None found — this tool has no concept of business domains at all in its own code |

---

## RESEARCH GATE RESULTS

### PRINCIPLE 1 — Deterministic Repository Intelligence

| | Project A | Project B |
|---|---|---|
| What discovers structure | `scripts/build-arch-book.ts`'s `glob()` walk | `scanner/filesystemScanner.ts`'s `fs.readdirSync` recursive walk |
| Deterministic? | Yes — same real files in, same JSON shape out (confirmed: regex+TS-compiler-API extraction, no AI in this path) | Yes — confirmed no AI/LLM anywhere in the CLI's production path (`semantic-check/`'s local mlx-lm model exists but is explicitly disconnected — its own code comment: *"Do not point production src/cli.ts at this module"*) |
| Parses actual artifacts? | Yes — real `readFileSync` per file | Yes — real `readFileSync` per file |
| Regenerates reproducibly? | Yes — "Sync Now" is idempotent given the same source tree | Yes — CLI re-run is idempotent given the same source tree |
| Agent needs to explore repo itself? | No — `/api/governance`/`/api/build` serve pre-materialized JSON | No — `ui/dashboard`'s `/api/reports/*` serves pre-materialized JSON; the CLI itself must be re-run by a human/agent to refresh it, but a *consumer* of the output doesn't explore |
| Architecture already materialized before Agent receives it? | Yes | Yes |

**CLASSIFICATION: A = PASS, B = PASS.** Both are genuinely deterministic scanners producing pre-materialized JSON an Agent can consume without exploring the filesystem. Neither uses AI in its production data path. Evidence: `scripts/build-arch-book.ts:472-475,648`; `scanner/filesystemScanner.ts:33`, `reports/reportWriter.ts:7-21`.

### PRINCIPLE 2 — Symbol/Function-Level Architecture

This is where the two projects diverge, on precise evidence:

- **Project A**: the persisted **graph edges** are exclusively `imports` (3,409, file→file) and `contains` (1,365, layer→file) — confirmed by direct count of every edge in the real, on-disk `architecture-book.json`; **zero `calls` edges exist**, despite the TypeScript type definition (`build-arch-book.ts:80`) explicitly allowing a `"calls"` label. However, real symbol data IS extracted (via the actual TypeScript compiler API, `symbolKindOf(node: ts.Node)`, `build-arch-book.ts:189-266`) and attached as metadata to 1,088 of 1,365 module nodes (`node.symbols`, real function/class names with `line_start`/`line_end`), plus `import_sites` on 1,044 nodes (exact line number + `resolved_target`, but the target is a **file**, not the specific symbol being imported from it).
- **Project B**: confirmed, no symbol extraction of any kind exists anywhere in the repo (verified directly: no AST parser, only 4 regexes matching import/require/export-from statement TEXT, never looking inside function bodies). Edges are file-to-file only (`ImportEdge{from,to,resolved}`, `types.ts:48-52`).

**CLASSIFICATION: A = MODULE_LEVEL graph with attached-but-unlinked SYMBOL-LEVEL metadata (edges themselves never rise above file/module level — the graph's own traversable identity is file→file). B = FILE_ONLY**, strictly (no symbol concept exists at all). Neither project reaches FUNCTION_CALL_LEVEL or RUNTIME_CALL_LEVEL — confirmed by the explicit absence of "calls" edges in A's real output and the total absence of any call-site tracking in B's source. Per the task's own strict rule ("Do not award symbol-level capability merely because a parser extracts function names — the graph itself must preserve/use those identities"), Project A does **not** qualify as SYMBOL_LEVEL despite extracting symbols, because the graph's edges never use that identity.

### PRINCIPLE 3 — Static + Dynamic + Test Evidence

- **Project A static evidence**: `architecture-book.json`'s `imports`/`contains` edges, from the last "Sync Now" run — real, but a cached snapshot (confirmed 2-day-stale at measurement time in the prior report of this series).
- **Project A dynamic evidence**: `components/admin/useAiTaskPulse.ts` — a real, live Supabase Realtime subscription on the `ai_tasks` table (`useAiTaskPulse.ts:49-61`). But the node/edge it highlights comes from a **hardcoded lookup table** (`KIND_TARGET`, lines 18-22), manually authored to match a *different* file's (`supabase/functions/ai-callback/index.ts`) dispatch logic — **not** derived from, or joined back to, the same `filePath`/module identity the static graph uses. There is no shared join key between the static edge set and this runtime signal.
- **Project A test evidence**: no test file was found that proves a *specific* import/dependency edge in `architecture-book.json` two independent ways. `scripts/governance-test.ts` is a real, substantial regression suite, but it tests a **different** capability entirely (a rule-coverage/ghost-rule/duplicate-rule "Governance Runtime," `app/api/admin/ide/_lib/governanceRuntime.ts` — a Constitution/IRON-rule concept, not the architecture-book import graph). `local-runtime/architecture-drift-acceptance-test.ts` also tests a different, unrelated capability (a "Development Machine Policy drift detector," Constitution Rule 117). **No test evidence was found for this specific graph.**
- **Project B static evidence**: `dependency-map/buildDependencyMap.ts`'s `ImportEdge[]`, real, in `reports/latest-dependency-map.json`.
- **Project B dynamic evidence**: **none exists** — confirmed exhaustively (§6 of the trace): every "runtime"/"trace"/"instrument" match in the source is either a comment *acknowledging* that dynamic behavior is a known, unaddressed gap (`scanner/importScanner.ts:21,73`; `sandbox/runner/runSandbox.ts:260-261`'s `NEEDS_RUNTIME_EVIDENCE` category), or an unrelated use of the word (an LLM prompt instruction, a "zero-runtime-deps" dependency-footprint label).
- **Project B test evidence**: **zero test files exist in the repo** (confirmed: `find -iname "*.test.*"` returns nothing, no test framework in `package.json`). `sandbox/` self-validates the scanner's own rule coverage against fixtures — it does not prove any specific real-world edge claim about a scanned target.

**CLASSIFICATION: A = FAIL (dynamic evidence exists but is not joined to the same identity; test evidence absent for this specific graph). B = FAIL (no dynamic evidence of any kind; no test suite exists at all).** Neither project satisfies Principle 3 — this is the most decisive finding of this comparison. Both projects are, for this specific capability, static-analysis-only systems with no proven static↔dynamic↔test join.

### PRINCIPLE 4 — Controlled Tool Interface

- **Project A**: `GET /api/governance` and `GET/POST /api/build` are real, typed Next.js route handlers (`app/api/governance/route.ts`, `app/api/build/route.ts`), auth-gated (`requireAuth(ADMIN_TIER)`, confirmed in the prior report of this series for `/api/build`), accepting bounded query parameters (`?layer=`, `?node=`) and returning structured JSON. An Agent calling these gets a **narrow, structured, typed interface** — it cannot arbitrarily query the filesystem through this surface, only what the route explicitly exposes. The generation trigger (`POST /api/build`) is similarly bounded — it can only re-run the fixed two-script pipeline, not arbitrary shell commands.
- **Project B**: the **only** production invocation is a raw CLI command with a single positional filesystem-path argument (`npx ts-node src/cli.ts <path>`) — no flags, no subcommands, no typed contract, no bounded query surface. An Agent (or human) invoking this is handed a full scan of whatever directory it's pointed at, with no way to narrow the request (e.g., "just check file X") short of pointing it at a smaller directory. The **read side** (`ui/dashboard/server.ts`'s `GET /api/reports/<file>`) IS a bounded, allowlisted interface (exactly 3 filenames, `server.ts:23`) — structured for *reading* prior results, but the *scan-triggering* side has no equivalent structured interface at all.

**CLASSIFICATION: A = STRUCTURED** (both read and trigger surfaces are typed, bounded HTTP routes). **B = PARTIALLY_STRUCTURED** (the read surface, via the dashboard's allowlisted `/api/reports/<file>`, is structured; the scan-trigger surface is an unbounded CLI invocation with a raw filesystem path, closer to "shell access" than a typed contract).

### PRINCIPLES 5 AND 6

No third or fourth research principle was found documented anywhere in either repository (searched both repos' READMEs, `registry/architecture-book.json`'s own generator comments, `capability_index.json`, and this DNA-OS-INFRASTRUCTURE checkout's own governance docs for any additional numbered "research principle" beyond the four given in this task). Per the task's own instruction, these are not invented:

```
PRINCIPLE_5 = NOT_RECOVERED
PRINCIPLE_6 = NOT_RECOVERED
```

---

## PHASE 3 — ARCHITECTURAL RESOLUTION TEST

| Question | Project A | Project B |
|---|---|---|
| Knows folders? | YES — `layer:*` nodes, `build-arch-book.ts:583` | YES — implicit via `relPath` prefix, no explicit folder node |
| Knows files? | YES — `module:*` nodes, 1,365 real | YES — `FileRecord` per file, 563 in the most recent real scan |
| Knows imports? | YES — regex `extractImportsFromFile`, `build-arch-book.ts:154-181` | YES — regex `IMPORT_PATTERNS`, `importScanner.ts:11-16` |
| Knows exports? | YES — regex `extractExportsFromFile`, `build-arch-book.ts:109-152` | **NO** — confirmed, no export-name extraction anywhere |
| Knows symbols? | YES — real TS compiler API, `extractSymbols`/`symbolKindOf`, `build-arch-book.ts:189-266`, attached to 1,088 nodes | **NO** — confirmed, no symbol table exists |
| Knows functions (as callable entities)? | Partial — symbol `kind:"function"` is recorded as metadata (see sample: `{"name":"POST","kind":"function","line_start":14,"line_end":36}`), but never used to build a graph edge | **NO** |
| Knows callers? | NO (only file-level `dependents`, i.e. importers, not callers) | NO (only file-level `importedByOf`) |
| Knows callees? | NO (only file-level `internal_dependencies`, i.e. imports, not calls) | NO (only file-level `importsOf`) |
| Knows actual runtime calls? | NO (confirmed — no call-graph edges exist at any level) | NO (confirmed — no runtime instrumentation of any kind) |
| Knows tests proving the connection? | NO (no test found proving a specific edge) | NO (no test suite exists) |

---

## PHASE 4 — STATIC / RUNTIME / TEST JOIN TEST

**Project A — one real dependency traced end-to-end:**
```
source: app/admin/build/page.tsx real code — fetch("/api/governance")
→ parser: scripts/build-arch-book.ts's extractImportsFromFile (regex)
→ static identity: import_sites entry {specifier, line, resolved_target} attached to node "module:app/admin/build/page.tsx"
→ static edge: {source:"module:app/admin/build/page.tsx", target:"module:app/api/governance/route.ts", label:"imports"} — CONFIRMED present in the real, on-disk architecture-book.json (this exact edge was independently verified to exist by direct grep-equivalent JSON inspection this round, matching Project A's own trace report earlier in this series)
→ runtime event: NONE — no instrumentation observes this fetch() actually firing
→ runtime identity: NOT_PROVEN (nothing exists to produce one)
→ test evidence: NOT_PROVEN (no test found asserting this specific edge)
→ persisted evidence: only the static edge above
```
**CAN THESE THREE EVIDENCE TYPES BE JOINED TO THE SAME JOINT? NO.** Only the static layer exists for this (or any) specific edge in Project A. The one dynamic signal that DOES exist in the whole system (`useAiTaskPulse.ts`'s Realtime subscription) uses a hardcoded lookup table unconnected to any specific import edge's identity — it cannot be joined to this or any particular static edge.

**Project B — one real dependency traced end-to-end:**
```
source: audit/command-audit/file-audit-sink.ts (a real DNA-OS-INFRASTRUCTURE file, scanned by Project B per its own real output)
→ parser: scanner/importScanner.ts's regex IMPORT_PATTERNS
→ static identity: RawImport{from:"audit/command-audit/file-audit-sink.ts", specifier:"../../execution/run/audit"}
→ static edge: {from:"audit/command-audit/file-audit-sink.ts", to:"execution/run/audit.ts", resolved:true} — CONFIRMED present verbatim in the real reports/latest-dependency-map.json (cited directly by the tracing pass this round)
→ runtime event: NONE (confirmed, no instrumentation exists anywhere in this repo)
→ runtime identity: NOT_PROVEN
→ test evidence: NOT_PROVEN (zero test files exist in the repo)
→ persisted evidence: only the static edge above, in reports/latest-dependency-map.json
```
**CAN THESE THREE EVIDENCE TYPES BE JOINED TO THE SAME JOINT? NO.**

**Join key comparison**: Project A's join key, where it exists at all, would be `filePath`/`module:<filePath>` (used consistently across nodes, `dependents`, `internal_dependencies`, and `import_sites`). Project B's would be `relPath`. Neither project has a runtime or test evidence stream that uses this key (or any key) to join back to a static edge for any real, specific joint examined this round.

---

## PHASE 5 — AGENT INTERFACE TEST

**Example question: "What function calls X and is that call observed at runtime?"**

**Project A's answer path:**
1. Query `GET /api/governance?node=module:<file>` → returns `imports`/`importedBy`/`impact` — but this is FILE-level, not function-level; "X" as a *function* cannot be resolved to a node at all (no function nodes exist).
2. To even attempt a function-level answer, an Agent would have to fall back to reading the `symbols[]` array on the relevant file node (if present — only 1,088/1,365 files have one) to confirm the function exists, then separately, manually cross-reference `import_sites[]` on every *other* file node to see if any imports that file — but `import_sites` records only the specifier and target FILE, not which imported symbol was actually used at each site, so this still cannot conclusively answer "calls X."
3. "Observed at runtime" cannot be answered at all — no runtime call data exists anywhere in this system for any function.
- **Repository searches required**: 0 (once past step 1, the data is already materialized) — but the *question itself* is unanswerable from the structured data; the Agent would need to fall back to raw source reading (an unbounded search) to get a real answer, defeating Principle 4's structured-interface goal for this specific question.
- **Tool calls required**: 1 (the `/api/governance?node=` call), insufficient on its own.
- **Deterministic machine steps**: 1 (the API call) that returns an incomplete answer.
- **Agent inference/fallback steps**: unbounded (must read raw source to actually answer the question).

**Project B's answer path:**
1. Read `reports/latest-dependency-map.json` (or the equivalent `/api/reports/latest-dependency-map.json` from the dashboard) for file-level edges.
2. "Function X" cannot be resolved to any identity in this system at all — there is no symbol table, so the question is entirely unanswerable from Project B's structured output, at any resolution.
3. "Observed at runtime" — same conclusion as Project A: no runtime data exists.
- **Repository searches required**: 0 for the file-level partial answer; unbounded if the Agent must fall back to raw source reading to find the actual function.
- **Tool calls required**: 1 (a report read), which cannot answer the question as asked.

**Conclusion**: neither project's structured interface can answer this example question completely. Both would force an Agent back into unbounded raw-source exploration for the function-level and runtime-observation parts — exactly the failure mode both projects' deterministic-scanner design was meant to prevent, but only for the *file-level* portion of any question. Project A's interface is more STRUCTURED overall (Principle 4) but its data ceiling is the same practical limit as Project B's for this class of question.

---

## PHASE 6 — A VS B MATRIX

```
RESEARCH PRINCIPLE        PROJECT A                  PROJECT B                  EVIDENCE                                              DECISION
--------------------------------------------------------------------------------------------------------------------------------------------------
1 Deterministic RIG       PASS                       PASS                       build-arch-book.ts:472-475; filesystemScanner.ts:33   MERGE (both real, complementary strengths)
2 Symbol-level Joint      MODULE+metadata (not       FILE_ONLY                  architecture-book.json edge labels (imports/contains  A (A at least carries symbol metadata; neither
                          used for edges)                                        only); types.ts:48-52                                 reaches true symbol-graph)
3 Static+Dynamic+Test     FAIL                       FAIL                       useAiTaskPulse.ts:18-22 (unjoined); zero tests found  NEITHER
                                                                                  in either repo for this specific capability
4 Controlled Interface    STRUCTURED                 PARTIALLY_STRUCTURED       api/governance/route.ts, api/build/route.ts vs        A
                                                                                  src/cli.ts's unbounded path-argument CLI
5                         NOT_RECOVERED              NOT_RECOVERED              —                                                      —
6                         NOT_RECOVERED              NOT_RECOVERED              —                                                      —
```

---

## PHASE 7 — CAPABILITY-BY-CAPABILITY DECISION

| Capability | Project A implementation | Project B implementation | Best proven owner | Why | What must survive |
|---|---|---|---|---|---|
| Repository discovery | `glob()` walk, `build-arch-book.ts:472-475` | `fs.readdirSync` recursive walk, `filesystemScanner.ts:30-92` | **MERGE** (both proven, real, deterministic) | Neither is proven superior — both are real, working filesystem walkers with different exclude-lists | Both walker implementations |
| File dependency graph | `imports`/`contains` edges, `architecture-book.json` | `ImportEdge[]`, `latest-dependency-map.json` | **A** | A additionally carries per-edge `import_sites` (exact line + resolved target) and a richer per-node status/health computation (`calcStatus`, real cross-reference against a separate ownership registry); B's edges are a strict subset in information content | A's edge+import_sites schema |
| Symbol graph | Symbol metadata attached to nodes but unused for edges (`build-arch-book.ts:189-266`) | None exists | **A** (only real candidate, though not a true symbol-GRAPH — see Principle 2) | B has zero symbol extraction of any kind | A's `extractSymbols`/TS-compiler-API code, if this capability is ever built out into real edges |
| Function-call graph | Does not exist (zero `calls` edges) | Does not exist | **NEITHER** | Confirmed absent in both, by direct edge-label count (A) and by confirmed absence of any call-site parsing (B) | N/A — this capability does not currently exist in either project and would need to be built new (out of scope for this task) |
| Runtime observation | `useAiTaskPulse.ts`'s real Supabase Realtime subscription, but unjoined to static identity | None exists | **A** (weakly — real live signal exists, just not joined) | B has confirmed zero dynamic/runtime evidence anywhere | A's Realtime subscription mechanism, if ever properly joined to the static graph's own `filePath` identity |
| Test evidence | No test proves a specific graph edge (governance-test.ts and architecture-drift-acceptance-test.ts test unrelated capabilities) | Zero test suite exists at all | **NEITHER** | Both fail this equally, for different reasons (A has irrelevant tests, B has none) | N/A |
| Evidence persistence | `architecture-book.json`, overwritten each run, single snapshot | `latest-*.json` (overwritten) + `scan-history.json` (**durable, append-only, 39 real rows**) | **B** | B is the only one of the two with a durable historical record across multiple runs and multiple target repos — directly useful for "did this change over time" questions A cannot answer at all | B's `scanHistory.ts` append-only log design |
| Provenance | `generated_at` timestamp only | `scan_id` (UUID) + `scannedAt` + `root` per run, plus a full historical log | **B** | B's provenance model is strictly richer — every historical scan is individually identifiable and attributable to a specific target root | B's per-scan provenance fields |
| Agent query interface | `GET /api/governance`, `GET/POST /api/build` — typed, bounded HTTP routes, auth-gated | CLI-only for triggering (unbounded path arg); `GET /api/reports/<file>` (allowlisted) for reading | **A** | A's structured HTTP interface covers both read AND trigger; B's structured interface only covers read | A's route contracts |
| Visualization | 3D force-graph (`ForceGraph3DView.tsx`) + 5 other presentation surfaces (established in the prior report in this series) | Static HTML/JS dashboard (`ui/dashboard/`), simpler, single-purpose | **A** for richness; **B** for simplicity/singularity (no duplicate-presentation problem exists in B, unlike A's 5-route sprawl) | Different tradeoffs, not directly comparable on "better" — A has 5x the presentation surfaces and a real duplicate-UI problem (established separately); B has exactly one dashboard reading its own exact output, no duplication | Both — different value props |
| Registry | `module-registry.json` (per-file ownership/purpose/status, hand/tool-maintained) | No equivalent — B has no separate "registry," only its own generated output | **A** (B has nothing comparable) | B's `FileRecord` is fully generated, not a hand-curated ownership registry the way A's `module-registry.json` is | A's `module-registry.json` and its "no Shadow System" policy |
| Execution control | `POST /api/build` triggers the real regeneration pipeline, auth-gated | CLI invocation only, no HTTP trigger | **A** | A's trigger is a bounded HTTP route; B's is an unbounded shell command | A's `POST /api/build` pattern |

---

## PHASE 8 — SEPARATION BOUNDARY (proposed only — nothing executed)

| Capability | Classification |
|---|---|
| Repository discovery (both walkers) | **COMBINE_CAPABILITY** — both real, complementary; a future canonical scanner could reuse ideas from both exclude-lists/traversal strategies, but this is not authorization to merge code now |
| File dependency graph | **KEEP_A** as the richer schema (import_sites, status/health); Project B's `scan-history.json` durability idea is a **COMBINE_CAPABILITY** candidate for A, which currently has none |
| Symbol metadata | **KEEP_A** (B has nothing) |
| Function-call graph | **DEAD** in both senses relevant here — it doesn't exist in either project; not applicable to separate |
| Runtime observation | **KEEP_A** (weak, unjoined, but real) — B has nothing to combine |
| Test evidence | **UNKNOWN** for both — neither project has this capability in a form worth preserving for THIS specific graph |
| Evidence persistence / provenance | **COMBINE_CAPABILITY** — B's append-only `scan-history.json` design is a genuinely proven, superior pattern A's single-snapshot `architecture-book.json` lacks; this is a real candidate for a future shared contract, not a reason to move B's code into A now |
| Agent query interface | **KEEP_A** for the trigger side (B has nothing structured there); B's read-side allowlist pattern is unremarkable/already matched by A |
| Visualization (5 routes in A) | Per the prior report in this series: `/admin/system` = KEEP, `/admin/graph` = DEAD, `/admin/build` = DUPLICATE_PRESENTATION, `/admin/architecture` = mostly UNIQUE_CAPABILITY, `/admin/engine-explorer` = UNIQUE_CAPABILITY (unreachable) |
| Visualization (B's single dashboard) | **KEEP_B** — no duplication exists within B itself; it is a real, working, single-purpose consumer of B's own output |
| Registry (`module-registry.json`) | **KEEP_A** (B has no equivalent) |
| Cross-repo integration (B's `findingEmitter.ts` → DNA-OS-INFRASTRUCTURE's `dna-os-circuit` at `:8790`) | **KEEP_B** — this is B's own, already-real integration point into a THIRD system; not touched by this comparison |

**Implementation files, APIs, registries, scanners, parsers, runtime observers, test collectors, UI components, Agent interfaces, and shared consumers identified for the above** — all already enumerated with file:line citations in Phases 1, 2, and the capability matrix (Phase 7); not re-listed here to avoid duplication within this report itself.

---

## PHASE 9 — IMPACT PROOF

**UI detachability, code detachability, data detachability, and runtime detachability are evaluated separately, as instructed — none is inferred from another.**

| | Project A | Project B |
|---|---|---|
| **1. Who imports each implementation?** | `scripts/build-arch-book.ts` is imported by nothing (it's a CLI script, invoked via `execSync`, never `import`ed); its OUTPUT (`architecture-book.json`) is imported/read by ~25 files (established in the prior report in this series) | `dependency-map/buildDependencyMap.ts` etc. are imported only by `src/cli.ts`; the OUTPUT (`reports/*.json`) is read only by `ui/dashboard/server.ts` within this repo, plus referenced-by-name (not imported) in DNA-OS-INFRASTRUCTURE's `capability_index.json` |
| **2. Who calls each API/tool?** | `/api/governance`: 3 distinct route files (Phase 7 of the prior report). `/api/build`: 2 distinct route files | No HTTP API to trigger a scan exists to call. `GET /api/reports/<file>`: only `ui/dashboard`'s own client JS (not independently traced this round) |
| **3. Who reads each registry?** | `architecture-book.json`: ~25 files. `module-registry.json`: ~25+ files (both established in the prior report) | `reports/latest-*.json`: only `ui/dashboard/server.ts` within B itself |
| **4. Who writes each registry?** | `architecture-book.json`: only `build-arch-book.ts:648`. `module-registry.json`: `sync-registry.ts:46` (UI-reachable) + `new-module.ts:120` (CLI-only, not UI-reachable) | `reports/*.json`: only `reportWriter.ts`/`scanHistory.ts`, both only reachable via the CLI (`src/cli.ts`) |
| **5. What runtime process depends on it?** | None found to depend on architecture-book.json/module-registry.json existing at runtime for business operation (established) — several DEV-TOOLING processes (the `ide/_lib` runtime family) depend on them for THEIR OWN function, which is itself engineering-tooling, not business runtime | None — B's own scanner has no runtime dependency on its own output; `findingEmitter.ts`'s outbound POST is fire-and-forget, not depended upon by anything downstream that was traced |
| **6. What business workflow depends on it?** | None found (established twice now, across two prior reports in this series) | None found — confirmed, B's own code has zero business-domain concepts anywhere |
| **7. What breaks if presentation is removed?** | Established in the prior report: removing `/admin/graph`/`/admin/build` breaks zero business workflow; `/admin/build`'s removal DOES break the one confirmed-live nav path to any architecture-graph UI (a navigation dependency, not a code one) | Removing `ui/dashboard` breaks nothing else in either repo — no other consumer of its specific HTTP routes was found |
| **8. What breaks if implementation code is removed?** | Removing `build-arch-book.ts` itself would stop `architecture-book.json` from ever being regenerated — the ~25 non-UI readers would keep working against an increasingly stale file until it eventually diverges from the real repo (a slow-motion break, not an immediate one) | Removing `src/cli.ts`/`scanner/`/`dependency-map/` would stop all future scans — `ui/dashboard` would keep serving the last-generated `reports/*.json` indefinitely (its own 404 fallback message literally says "run `npm run scan` first," confirming it has no other way to get fresh data) |
| **9. What must continue running after separation?** | The `POST /api/build` trigger mechanism (or an equivalent), `scripts/build-arch-book.ts`/`scripts/sync-registry.ts` themselves, and continued write access to `registry/*.json` | `src/cli.ts` and its full module chain, continued write access to `reports/*.json`, and (if the Circuit integration is to be preserved) network reachability to `localhost:8790` |
| **10. Which files cannot be moved independently?** | `scripts/build-arch-book.ts` cannot be moved without also moving (or re-pointing) `registry/module-registry.json` (it reads this for status cross-referencing) and without breaking every one of its ~25 readers' relative-path assumptions unless those are updated in lockstep | `dependency-map/buildDependencyMap.ts` cannot be moved independently of `scanner/importScanner.ts` (direct function dependency) or `duplicate-check/`/`orphan-check/`/`classifier/` (all wired together in `src/cli.ts`'s single linear pipeline) |

**Key distinction honored, not conflated**: in both projects, the UI layer (Phase 8's presentation routes) is confirmed detachable with zero business impact — but the underlying DATA (the registry JSON files) and RUNTIME (the generation scripts, and in B's case the `git`-shelling and outbound-POST behavior) have real, separate dependency chains of their own that a "just delete the duplicate page" action would not touch at all, and that a full "separate this capability into its own service" action would have to handle explicitly.

---

## UNKNOWN / NOT_PROVEN LIST

- The exact figures "46 duplicates, 23 orphans" cited in DNA-OS-INFRASTRUCTURE's `capability_index.json` for Project B's Phase 19 run — the matching `301`-file scan IS confirmed real in `scan-history.json`, but the duplicate/orphan counts for that specific historical run are **not preserved anywhere on disk today** (only the most recent run's counts survive in `latest-summary.json`) — **NOT_PROVEN**, not assumed true or false.
- The "161 files (153-161 range)" ts-morph cross-validation figure cited in the same registry entry — **no scan-history.json row matches this number for any target repo** — **NOT_PROVEN**, flagged as potentially a different counting methodology, not confirmed.
- Whether Project A's `governance-test.ts`/`architecture-summary-test.ts` suites, while proven to test a *different* capability (the rule-coverage Governance Runtime), might incidentally also exercise `architecture-book.json` reads in a way that constitutes partial indirect test coverage — **NOT_PROVEN**, not deeply traced this round (out of the specific graph-edge-proof question this comparison needed).
- Project B's `ui/dashboard`'s client-side JS (`app.js`, `fileList.js`, etc.) was not traced line-by-line this round (confirmed only that the server-side data path is single-source) — **UNKNOWN** whether the client does any additional client-side computation beyond display.
- Whether any OTHER process beyond `ui/dashboard` reads DNA-LAB-FILE-INTELLIGENCE's `reports/*.json` files by direct filesystem access from a different repository (e.g., does DNA-OS-INFRASTRUCTURE ever read these files directly, beyond receiving the one-way `findingEmitter.ts` POST) — **NOT_PROVEN**, not searched for in DNA-OS-INFRASTRUCTURE this round (would require a fresh cross-repo grep, out of this round's scope).

---

## FINAL DECISION SUMMARY

No single project is the evidence-based "winner" overall — the task's own instruction (prefer stronger traceable evidence, not size/newness/prettiness) is honored by a **capability-by-capability MERGE recommendation**, not a whole-project pick:

- **File dependency graph, symbol metadata, registry, structured Agent interface, execution control** → Project A has stronger, more complete, more traceable evidence.
- **Evidence persistence/provenance (durable history across runs)** → Project B has stronger, more complete, more traceable evidence — a real capability Project A currently lacks entirely.
- **Symbol-to-function call graph, static+dynamic+test evidence joining** → **NEITHER** project satisfies these; both fail Principle 3, and neither reaches true function/call-level resolution (Principle 2). This is a genuine, evidenced gap in both systems, not a decision between them.

**STOP — evidence and comparison only. No code moved, deleted, rewritten, merged, or created.**
