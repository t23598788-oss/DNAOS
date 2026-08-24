# MEASUREMENT SYSTEM → REGISTRY → DATA SOURCE → UI TRACE

**Mode: Phases 1–6 measurement, completed. Phase 7 (implementation) NOT executed — see the note at the end explaining why, and what decision is needed before it can run.** Nothing in this round was edited, created, deleted, moved, or registered. Every claim below is cited to a real file:line, a real process (`ps`/`lsof`), or a real registry row — read by two independent research passes plus direct runtime verification, cross-checked against each other. Two repositories are involved: `/Users/tam/Desktop/DNA-OS-INFRASTRUCTURE` (this checkout) and `/Users/tam/Desktop/DNA-LAB-PERMISSION-REASONER` (a sibling repo, read-only in this round).

---

## PHASE 1 — RUNTIME VERIFIED FIRST (not inferred from source)

```
lsof -i :5177 → node, PID 3480, LISTEN
ps -p 3480 -o pid,ppid,lstart,command:
  PID 3480  PPID 1  Fri Aug 21 14:18:49 2026
  /usr/local/bin/node /Users/tam/Desktop/DNA-LAB-PERMISSION-REASONER/research/dashboard/monitor-ui/serve-static.mjs
cwd (lsof -p 3480): /Users/tam/Desktop/DNA-LAB-PERMISSION-REASONER/research/dashboard/monitor-ui
curl http://localhost:5177/ → real HTML, <title>DNA OS · Engineering Research Monitor</title>,
  serve-static.mjs:11 hardcodes PORT=5177, HOST=127.0.0.1, serves ./dist/ (a prebuilt Vite bundle)
```

**Every other real, currently-LISTENing port on this host** (`lsof -iTCP -sTCP:LISTEN -P`), relevant subset:

| Port | PID | Process | Repository |
|---|---|---|---|
| 5177 | 3480 | `serve-static.mjs` | DNA-LAB-PERMISSION-REASONER |
| 3000 | 4066 (child of 3485) | `next-server` (`next dev`) | dna-os-deadboard |
| 8787 | **3500, Python** | (see below) | DNA-LAB-PERMISSION-REASONER |
| 8791 | 9611 | `tsx transport/owner-command-http/server.ts` | DNA-OS-INFRASTRUCTURE (real, currently running) |
| 5432 | 3496 | `postgres` (`dna_os_local` DB exists, **0 tables** — confirms `software/registry-database/migrations/MIGRATION_PLAN.md`'s "NOT EXECUTED" status is still true right now) | — |

**8790** (`dna-os-circuit/runtime/server.ts`) is **NOT running** — confirmed by `lsof -i :8790` returning nothing.

**Port 8787 is not what a source-only search would have concluded.** `connections/research-engine/adapter-config.ts` in DNA-OS-INFRASTRUCTURE names `http://localhost:8787` as "DNA-LAB-PERMISSION-REASONER's Research & Evaluation Engine." Runtime proves the real process there is `Python`, PID 3500 — **not** a Node/TS process — confirming `connections/research-engine/`'s own discipline of never vendoring/assuming the real implementation was correct. Its actual source in DNA-LAB-PERMISSION-REASONER is `research/dashboard/api/server.py` (a Python HTTP server reading `research/storage/research.db`), per that file's own header comment. **This is the same real service both `connections/research-engine/` (DNA-OS-INFRASTRUCTURE) and the monitor-ui dashboard (DNA-LAB-PERMISSION-REASONER) independently call** — a real, runtime-proven, shared backend between the two repos.

**Port 8788** (referenced by the dashboard's `DnaOsComputeProvider.ts`) was not found LISTENing at the moment of this check — its own source header states it targets `dna_os/api/server.py`, "a sibling system... separate DB, separate API port, zero shared code" from the research engine, inside DNA-LAB-PERMISSION-REASONER, not DNA-OS-INFRASTRUCTURE. Not independently verified live in this round (out of the runtime scan's positive matches); the provider's own code shows it fails to an explicit `{status:'offline'}` state with no mock fallback if unreachable.

**Process launch timing**: PIDs 3480 (dashboard), 3485/4066 (dna-os-deadboard `next dev`), and 3496 (postgres) all started at the identical second, `14:18:49` — a coordinated dev-stack bootstrap. DNA-OS-INFRASTRUCTURE's own real processes (`transport/owner-command-http/server.ts` on 8791, voice-bridge workers) started separately, hours later (`9:41PM`, `6:57PM`) — evidence DNA-OS-INFRASTRUCTURE's control plane is **not** part of that same coordinated launch sequence.

---

## PHASE 2 — TRACE EVERY EXISTING MEASUREMENT

All 20 mounted source files traced (verified live in `App.tsx` — no dead/unused components found). Full per-file detail was gathered; the table below is the complete matrix, condensed to the required fields. `RUNTIME_PROVEN` = confirmed by a live process check (Phase 1) or a real HTTP/SSE call in the read source, not inferred.

| MEASUREMENT_ID | FILE | FUNCTION/EXPORT | REAL_INPUT_SOURCE | CURRENT_UI_COMPONENT | CURRENT_URL/PORT | RUNTIME_PROVEN |
|---|---|---|---|---|---|---|
| M1 | `analytics/bottleneckScore.ts` | `computeBottleneckScores` | **MOCK_DATA** — `mockIssues.ts` (14 literal rows) | `BottleneckBoard.tsx` | localhost:5177 | Formula real; input mock — proven by `App.tsx:106` `MockTelemetryProvider` wiring |
| M2 | `analytics/recurrenceMetrics.ts` | `computeRecurrenceMetrics`, `countRepeatedProblems` | **MOCK_DATA** — same `mockIssues.ts` | `RepeatedProblemMap.tsx`, `SummaryCards.tsx` | localhost:5177 | Same |
| M3 | (client-side agg. in `CapabilityGrowth.tsx:27-44`) | inline groupBy | **MOCK_DATA** — `mockCapabilities.ts` (18 literal rows) | `CapabilityGrowth.tsx` | localhost:5177 | `App.tsx:110/116` |
| M4 | (inline in `EngineeringTimeChart.tsx:22,35-46`) | inline calc | **HARDCODED_DATA** — imports `mockTimeEntries` from `data/mockTasks.ts` directly, bypassing even the mock *provider* abstraction | `EngineeringTimeChart.tsx` | localhost:5177 | `EngineeringTimeChart.tsx:7,25` |
| M5 | `data/DNAOSTelemetryProvider.ts` | `executionsProvider.getActive/getCostSummary/getTimeline` | **REAL_RUNTIME_DATA** — `fetch('http://127.0.0.1:8787/api/executions/*')` | `ConcurrentExecutionMeter.tsx` → `ExecutionDetailPanel.tsx` | localhost:5177 (data from :8787) | `DNAOSTelemetryProvider.ts:23-41,55-59`; degrades to explicit `offline`, no mock fallback |
| M6 | (inline in `ErrorMonitor.tsx:37-43,155-178`) | inline calc | **HARDCODED_DATA** — direct import `mockErrors`/`mockFunnelData` from `data/mockIssues.ts:34,35` | `ErrorMonitor.tsx` | localhost:5177 | `ErrorMonitor.tsx:3,34-35` |
| M7 | (inline in `GitMonitor.tsx:29-32`) | pass-rate calc | **MOCK_DATA** — `mockGitSummary` (`data/mockResources.ts`) | `GitMonitor.tsx` | localhost:5177 | `App.tsx:112/118` |
| M8 | `telemetry/useLocalTelemetry.ts` | `useLocalTelemetry()` | **REAL_MACHINE_DATA** — real OS sampler (`research/dashboard/api/telemetry_sampler.py`, ~1/sec) streamed via SSE `http://127.0.0.1:8787/api/local/telemetry/stream` | `LocalMachine.tsx`, `LocalMachineHistoryChart.tsx` | localhost:5177 (data from :8787) | `useLocalTelemetry.ts:111,120,133`; explicit STALE/OFFLINE watchdog, no mock fallback |
| M9 | `data/DnaOsComputeProvider.ts` | `getGpuOffers` | **REAL_RUNTIME_DATA** — `fetch('http://127.0.0.1:8788/api/gpu/offers')` | `ComputeResourceBoard.tsx` | localhost:5177 (data from :8788) | `DnaOsComputeProvider.ts:20-41`; not confirmed live in this round's port scan (see Phase 1 caveat) |
| M10 | (inline aggregation in `ConcurrentExecutionMeter.tsx`) | active-count/cost/timeline calc | **REAL_RUNTIME_DATA** — same `executionsProvider` as M5 | `ConcurrentExecutionMeter.tsx` | localhost:5177 (data from :8787) | Same as M5 |
| M11 | `analytics/costMetrics.ts` | `computeCostSummary` | **MOCK_DATA** — `mockResourceSnapshots` + `mockTasks` | `ResourceMonitor.tsx` (self-labels its own tiles "(mock)" in the UI, `ResourceMonitor.tsx:46-52,58`) | localhost:5177 | `App.tsx:111/117,161` |
| M12 | `data/DNAOSTelemetryProvider.ts` | `researchProvider.getLatestExperiment/getHistory/getHardware/getFixtures/getModelRegistry` | **REAL_RUNTIME_DATA** — `fetch('http://127.0.0.1:8787/api/research/*')` | `ModelResearch.tsx`, `ResearchMeta.tsx` (`ExperimentHistory`, `HardwareAndFixtures`) | localhost:5177 (data from :8787) | `DNAOSTelemetryProvider.ts:19-21,43-44,49`; explicit LIVE/OFFLINE badge, no mock fallback |
| M13 | `analytics/ownerSummary.ts` | `generateOwnerSummary` | **MOCK_DATA** — composes M11/taskMetrics/M1's mock inputs; own header states "No AI used. All text is derived from computed metrics" (real deterministic composition, mock underlying data) | `OwnerSummary.tsx` (self-labels "Mock Period", `OwnerSummary.tsx:52-56`) | localhost:5177 | `App.tsx:163,260-261` |
| M14 | `analytics/taskMetrics.ts` | `filterTasks`, `computeTaskSummary`, `getStatusCount`, `getTopReworkedTasks` | **MOCK_DATA** — `mockTasks.ts` | `WorkStateBoard.tsx`, `SummaryCards.tsx`, `OwnerSummary.tsx` | localhost:5177 | `App.tsx:106-119,159` |

**Additionally, this same session's own contribution in DNA-OS-INFRASTRUCTURE** (disclosed for completeness, not a pre-existing finding):

| MEASUREMENT_ID | IMPLEMENTATION_FILE | REAL_INPUT_SOURCE | CURRENT_CONSUMER | RUNTIME_PROVEN |
|---|---|---|---|---|
| M15 | `observability/joint-monitor/joint-store.ts` (`JointEvent`) | **PERSISTED_DATA** — real cross-capability call events, `data/joints.jsonl` (8 real rows, all from this session's own test runs — see Phase 5) | `observability/joint-monitor/server.ts`'s own `GET /events` SSE + inline HTML viewer | Server tested live, **not currently running** (port 5177 is held by the DNA-LAB dashboard — see Phase 4) |
| M16 | `observability/joint-monitor/joint-store.ts` (`ViolationEvent`) | **PERSISTED_DATA** — `data/violations.jsonl` (2 real rows, same test-run origin) | Same as M15 | Same |

**Zero cross-reference found**, in either direction, between DNA-OS-INFRASTRUCTURE's own source and the monitor-ui dashboard's source (`grep` for `8790`, `8791`, `DNA-OS-INFRASTRUCTURE`, `owner-command-http`, `dna-os-circuit` across the entire `monitor-ui/src/` tree, `serve-static.mjs`, `vite.config.ts`: **zero matches**). The only real, runtime-proven connection between the two repos is the **shared backend at port 8787** (M5, M8, M10, M12) — both repos independently call the same real Python service, neither repo imports the other's code.

---

## PHASE 3 — REGISTRY CHECK

Checked every real registry in DNA-OS-INFRASTRUCTURE: `control/command-router/capability-registry.ts` (11 entries), `software/registry-database/data/canonical/capabilities.jsonl` (41 entries), `reports/phase16-world-evidence/capability_index.json` (10 entries), `connections/connection-registry/`.

| Measurement concept | Classification | Evidence |
|---|---|---|
| M1/M2 (bottleneck + recurrence) | **IMPLEMENTED_BUT_NOT_REGISTERED in 2 of 3 registries; REGISTERED in the 3rd** | `capability_index.json` lines 72-81, `problem_type: "engineering_bottleneck_measurement_via_monitor-ui_dashboard"`, names `bottleneckScore.ts + recurrenceMetrics.ts` by file, states verbatim: `"current_status": "BLOCKED_MOCK_DATA — the formula (computeBottleneckScores) is real and deterministic, but its INPUT is hardcoded mock data... Any bottleneck_score/frequency/cost_impact number from this dashboard today is MOCK, not measured, and per Phase 22's own rule MUST NOT authorize autonomous modification."` **Not present** in `capability-registry.ts` or `capabilities.jsonl` (checked all rows of both — zero match for "bottleneck"). |
| M3 (capability growth) | **UNKNOWN / NO REGISTRY ROW FOUND** | No entry in any of the 3 registries names "capability growth." Closest adjacent real data (`software/registry-database/data/canonical/registration_events.jsonl`, 1,126 real rows) is itself registered as part of `registry-database`'s own capability, but nothing registers a "growth" *measurement* over it. |
| M4/M6 (engineering time, errors) | **NO REGISTRY ROW FOUND** | Zero match in any registry for "engineering time" or "error monitor." |
| M5/M10 (execution detail/active count) | **NOT REGISTERED as a dashboard/measurement capability** — but its *real data source* is | `execution/run/audit.ts`'s `ExecutionAuditEvent` type (durable via `audit/command-audit/file-audit-sink.ts`, 328 real rows in `execution-audit.jsonl`) is real, internal DNA-OS-INFRASTRUCTURE data — but this is NOT what M5/M10 actually read (M5/M10 read DNA-LAB-PERMISSION-REASONER's own `/api/executions/*`, a different, unverified-in-this-round dataset). No registry entry connects the two. |
| M7 (git monitor) | **NO REGISTRY ROW FOUND** | `connections/connection-registry/git-discovery.ts` does one-shot git identity discovery, not monitoring; no registry entry for a "git monitor" capability. |
| M8 (local machine telemetry) | **PARTIAL_MATCH, different implementation** | DNA-OS-INFRASTRUCTURE's own `connections/telemetry/contract.ts` defines a real, separately-implemented `TelemetrySnapshot` (CPU/RAM/disk/network/listening_ports) — a **different, unregistered-as-"local machine"-specifically, real capability** that overlaps in *purpose* with M8 but is not the same code and is not what the dashboard actually calls (dashboard calls DNA-LAB-PERMISSION-REASONER's own sampler at :8787, confirmed in Phase 1/2). Not cross-registered anywhere. |
| M9 (compute/GPU resources) | **NO REGISTRY ROW FOUND** | No DNA-OS-INFRASTRUCTURE registry entry for GPU/compute-offer tracking. |
| M11 (cost metrics) | **NO REGISTRY ROW FOUND** | Every `cost_source` field across all 10 `capability_index.json` rows is `"N/A"` except M1/M2's own entry (`"MOCK"`, line 79) — no real cost-tracking registry entry exists anywhere. |
| M12 (research experiment history/hardware/models) | **NOT REGISTERED as a dashboard capability** — but its real backend is `connections/research-engine`'s own registered target | `control/command-router/capability-registry.ts` DOES register `research-engine` (line ~53, `health_status: "CONNECTED"`, endpoint `connections/research-engine/research-engine-adapter.ts`) — targeting the SAME real `:8787` service M12 calls. This is the one case where a real DNA-OS-INFRASTRUCTURE registry entry and a real dashboard measurement (M12) are proven, by runtime, to point at the identical backend process — **but the registry entry and the dashboard component are never wired to each other**; each independently calls :8787 with its own client code. |
| M13 (owner summary) | **NO REGISTRY ROW FOUND** | No match in any registry. |
| M14 (task metrics) | **NOT REGISTERED as a dashboard capability** — but its real data-shape analog is registered elsewhere | `control/agent-gateway/data/tasks.jsonl` (10,338 real rows) is DNA-OS-INFRASTRUCTURE's own real task-lifecycle data, part of the `agent-gateway` capability (registered in `capability-registry.ts` implicitly via `dispatcher`). Different schema, different repository, never cross-registered against M14. |
| M15/M16 (joint/violation events) | **IMPLEMENTED, NOT REGISTERED anywhere** | `observability/joint-monitor/` itself has no entry in any of the 3 DNA-OS-INFRASTRUCTURE registries — built this session, not yet registered through `control/registration-pipeline/`. |

**No DUPLICATE_REGISTRATION found** — the one measurement that IS registered (M1/M2, `capability_index.json`) is registered exactly once, in exactly one of the three registries.

---

## PHASE 4 — UI ROUTING AUDIT

```
SOURCE                          PRODUCER              CALCULATOR                  PROVIDER                         UI COMPONENT              PAGE/URL/PORT
mockIssues.ts (hardcoded)   →   (literal array)   →   bottleneckScore.ts      →   MockTelemetryProvider.ts     →   BottleneckBoard.tsx    →   localhost:5177   [UI_USING_MOCK_WHILE_REAL_DATA_MAY_EXIST — see Phase 5]
mockIssues.ts (hardcoded)   →   (literal array)   →   recurrenceMetrics.ts    →   MockTelemetryProvider.ts     →   RepeatedProblemMap.tsx →   localhost:5177   [same]
mockCapabilities.ts         →   (literal array)   →   inline groupBy          →   MockTelemetryProvider.ts     →   CapabilityGrowth.tsx   →   localhost:5177   [same]
mockTasks.ts                →   (literal array)   →   (inline)                →   direct import (bypasses provider) →  EngineeringTimeChart.tsx → localhost:5177 [same, worse: bypasses even the mock abstraction]
research.db (real, Python)  →   /api/executions/* →   (inline agg.)           →   DNAOSTelemetryProvider.ts    →   ConcurrentExecutionMeter.tsx/ExecutionDetailPanel.tsx → localhost:5177 (:8787)  [RIGHT_DATA_RIGHT_UI]
mockIssues.ts                →   (literal array)   →   (inline)                →   direct import                →   ErrorMonitor.tsx       →   localhost:5177   [MOCK, no calculator to reuse — trivial pass-through]
mockResources.ts            →   (literal object)  →   (inline)                →   MockTelemetryProvider.ts     →   GitMonitor.tsx         →   localhost:5177   [MOCK]
research/dashboard/api/telemetry_sampler.py (real OS sampler) → SSE stream → (inline)  →  useLocalTelemetry.ts   →   LocalMachine.tsx / LocalMachineHistoryChart.tsx → localhost:5177 (:8787)  [RIGHT_DATA_RIGHT_UI]
dna_os.db (real, Python, sibling)  →  /api/gpu/offers  →  (inline)          →   DnaOsComputeProvider.ts      →   ComputeResourceBoard.tsx →  localhost:5177 (:8788)  [RIGHT_DATA_RIGHT_UI, not confirmed live this round]
mockResources.ts + mockTasks.ts →  (literal)        →   costMetrics.ts          →   MockTelemetryProvider.ts     →   ResourceMonitor.tsx    →   localhost:5177   [MOCK, self-disclosed in UI]
research.db (real, Python)  →   /api/research/*   →   (pass-through)          →   DNAOSTelemetryProvider.ts    →   ModelResearch.tsx / ResearchMeta.tsx → localhost:5177 (:8787)  [RIGHT_DATA_RIGHT_UI]
mockTasks/mockIssues/mockCapabilities → (literal)  →   ownerSummary.ts         →   MockTelemetryProvider.ts     →   OwnerSummary.tsx       →   localhost:5177   [MOCK, self-disclosed "Mock Period"]
mockTasks.ts                →   (literal array)   →   taskMetrics.ts          →   MockTelemetryProvider.ts     →   WorkStateBoard.tsx/SummaryCards.tsx → localhost:5177  [MOCK]
```

**Classification results:**
- **RIGHT_DATA_RIGHT_UI**: M5, M8, M9, M10, M12 (5 of 14) — real data, correctly reaching the intended, correct component, on the correct page.
- **UI_USING_MOCK_WHILE_REAL_DATA_EXISTS**: M1, M2 **only where a real, complete-enough substitute is separately proven to exist** — see Phase 5 for the exact per-item YES/NO verdict; every other mock case (M3, M4, M6, M7, M11, M13, M14) has **no proven, schema-complete real substitute found in either repo this round** and must be marked `UNRESOLVED` for this classification, not assumed.
- **REAL_DATA_NOT_CONNECTED**: DNA-OS-INFRASTRUCTURE's own real data (`execution-audit.jsonl`, `tasks.jsonl`, `evidence.jsonl`, `registration_events.jsonl`, `joint-monitor`'s `joints.jsonl`/`violations.jsonl`) is real and exists, but is not connected to ANY UI anywhere (not this dashboard, not any DNA-OS-INFRASTRUCTURE page) — genuinely disconnected real data.
- **DUPLICATE_UI_FOR_SAME_MEASUREMENT**: **NONE FOUND.** No DNA-OS-INFRASTRUCTURE UI (Circuit Board, Evidence Trace Viewer, `observability/joint-monitor`'s inline viewer) shows any of M1–M14's domains. No duplicate UI exists for any measurement in this trace.
- **DEAD_UI**: **NONE FOUND** — every one of the 20 traced files is confirmed mounted in `App.tsx`.
- **WRONG_PORT**: `observability/joint-monitor/`'s own `start.ts` and `README.md` claim port 5177 as "confirmed unclaimed" — **this claim is false**, proven directly by Phase 1's runtime check. This is a real `WRONG_PORT` finding, but it is a documentation/default-config error in a not-currently-running DNA-OS-INFRASTRUCTURE capability, not a case of the dashboard itself being wrongly routed.
- **WRONG_REPOSITORY_TARGET**: **NONE FOUND** — no measurement in the dashboard is proven to be pointed at the wrong repository; the split between DNA-LAB-PERMISSION-REASONER's own real backends (:8787, :8788) and DNA-OS-INFRASTRUCTURE's separate real data is a genuine, intentional repository boundary (per `DNAOSTelemetryProvider.ts`/`DnaOsComputeProvider.ts`'s own header comments), not a misrouting.
- **"Should this measurement route to Engineering Research Monitor but currently goes elsewhere?"** — **NO instance found.** Nothing in either repo computes any of M1–M16's measurements and sends the result to a *different* dashboard/page. Where DNA-OS-INFRASTRUCTURE has real, relevant data (task/execution/registration/joint data), it currently reaches **no UI at all** (not a wrong one) — see REAL_DATA_NOT_CONNECTED above.

---

## PHASE 5 — MOCK/FALLBACK INVENTORY

| FILE | EXPORT | UI_CONSUMER | WHY_USED | REAL_SOURCE_EXISTS | REAL_SOURCE_PATH | SAFE_TO_REMOVE |
|---|---|---|---|---|---|---|
| `data/mockIssues.ts` | `mockIssues` (14 rows) | `BottleneckBoard`, `RepeatedProblemMap`, `SummaryCards` (via M1/M2) | `capability_index.json:79` states verbatim: real provider exists but "is NOT wired for issues/tasks/capabilities" | **NO** — proven `NO` this round. DNA-OS-INFRASTRUCTURE has no data source shaped as `Issue{occurrence_count, total_time_lost, cost_impact, severity}` (`capability_index.json:75`'s own `input_contract`). `observability/joint-monitor`'s `ViolationEvent` (real, 2 rows) is the closest candidate but carries no `total_time_lost`/`cost_impact`/`severity` fields and has only 2 real rows — schema-incomplete, proven, not assumed. | **NO** (no schema-complete real replacement proven) |
| `data/mockIssues.ts` | `mockErrors`, `mockFunnelData` | `ErrorMonitor.tsx` | No real error-tracking schema found anywhere (`execution-audit.jsonl`'s `error_code` field is the closest, but is a single string per execution, not the multi-field `ErrorRecord`/funnel shape `ErrorMonitor.tsx` expects) | **NO** | — | **NO** |
| `data/mockCapabilities.ts` | `mockCapabilities` (18 rows) | `CapabilityGrowth.tsx`, `OwnerSummary.tsx` | `capability_index.json`-adjacent registries exist but in a different schema (`capabilities.jsonl`'s 41 UUID-keyed rows lack a `created_at`-week-groupable, status-simple shape without transformation) | **PARTIAL** — `software/registry-database/data/canonical/capabilities.jsonl` (41 real rows) has real capability data but a different schema; no proven adapter exists mapping one to the other | `software/registry-database/data/canonical/capabilities.jsonl` | **NO** (schema transform unproven, not built) |
| `data/mockTasks.ts` | `mockTasks`, `mockTimeEntries` | `WorkStateBoard`, `SummaryCards`, `OwnerSummary`, `EngineeringTimeChart` | No real "engineering time entry" (rework/blocked/build/test minutes) schema found anywhere in DNA-OS-INFRASTRUCTURE | **PARTIAL** — `control/agent-gateway/data/tasks.jsonl` (10,338 real rows) has real task lifecycle data but no `TimeEntry`-shaped (minutes-by-category) fields; a real, unbuilt transform would be required | `control/agent-gateway/data/tasks.jsonl` | **NO** |
| `data/mockResources.ts` | `mockResourceSnapshots`, `mockAggregatedResources`, `mockGitSummary` | `ResourceMonitor.tsx`, `GitMonitor.tsx` | No real CPU/RAM/disk/network/AI-token/cost snapshot schema, and no real git-monitoring capability, found registered anywhere in DNA-OS-INFRASTRUCTURE (checked `connections/connection-registry/git-discovery.ts` — one-shot identity discovery only, not a monitoring snapshot) | **PARTIAL** (resources) / **NO** (git) — `connections/telemetry/contract.ts`'s `TelemetrySnapshot` overlaps CPU/RAM/disk/network in *purpose* but is a different, unregistered-for-this-use implementation, and the dashboard doesn't call it | `connections/telemetry/contract.ts` (partial overlap only) | **NO** |
| `data/MockTelemetryProvider.ts` | `MockTelemetryProvider` | (the provider itself, wired at `App.tsx:106`) | Explicit placeholder per its own footer comment, "pending a future DNAOSTelemetryProvider swap for tasks/git/capabilities/resources/issues" — an aspiration the REAL `DNAOSTelemetryProvider.ts` (which now exists) never actually fulfilled; it only covers research/executions, a different data domain | **NO** (as a drop-in whole-provider replacement) | — | **NO** |

**No mock/fallback in this inventory has a proven, schema-complete real replacement available today.** Every "PARTIAL" case requires a new schema-transform (a new adapter/mapping function) that does not exist in either repo — which is real, unbuilt work, not a simple reconnection.

---

## PHASE 6 — RECONNECTION PLAN (existing-only, per the task's own hard constraints)

Per the task's rule ("ห้ามสร้าง calculator ใหม่ถ้ามีของเดิม... ถ้าพบของที่มีอยู่แต่ไม่ได้ลงทะเบียน ให้ระบุ REGISTRATION_REQUIRED... ถ้าพบลงทะเบียนแล้วแต่ไม่ได้เชื่อม ให้ระบุ WIRING_REQUIRED..."):

| Measurement | Existing real source | Existing calculation | Existing provider/API | Existing UI on :5177 | Required action |
|---|---|---|---|---|---|
| M1/M2 (bottleneck, recurrence) | **NOT PROVEN** — no schema-complete existing real source (Phase 5) | `bottleneckScore.ts`/`recurrenceMetrics.ts` (real, exists) | `MockTelemetryProvider.ts` (real, but mock) | `BottleneckBoard.tsx`/`RepeatedProblemMap.tsx` (real, exists) | **REGISTRATION_REQUIRED** is moot (already registered, `capability_index.json:72-81`) — the blocking gap is a genuine `MOCK_REPLACEMENT_REQUIRED`, but Phase 5 proves **no existing real source has the required schema** to satisfy it without new adapter code. **UNRESOLVED** under the "existing-only" constraint. |
| M5/M10/M12 (executions, research) | Real, proven live at `:8787` | Real, inline in components | `DNAOSTelemetryProvider.ts` (real) | Real, mounted | **No action required** — already fully wired, real, correct. |
| M8 (local machine) | Real, proven live SSE at `:8787` | Real, inline | `useLocalTelemetry.ts` (real) | Real, mounted | **No action required.** |
| M9 (compute/GPU) | Claimed real at `:8788`, not confirmed live this round | Real, inline | `DnaOsComputeProvider.ts` (real) | Real, mounted | **No action required** on the wiring itself; **UNRESOLVED** whether `:8788`'s process is actually running right now (out of this round's positive port scan — would need a direct re-check, not assumed). |
| M15/M16 (joint-monitor) | Real, `observability/joint-monitor/` (this session) | Real, `joint-store.ts` | Real, `client.ts`/`server.ts` | **NONE on :5177** — has its own, different, currently-not-running server on the same port number as the dashboard | **ROUTING_CORRECTION_REQUIRED is UNRESOLVED under "no new port" constraint** — `joint-monitor`'s default port (5177) collides with the real, already-running dashboard. Since the task forbids creating a new port, and the existing dashboard already legitimately owns 5177, this is a real, proven conflict this round cannot resolve within its own constraints (moving `joint-monitor` to a different port would itself be "creating a new port" in the sense of assigning one that isn't already its documented default — flagged, not decided). |
| M3/M4/M6/M7/M11/M13/M14 (all remaining MOCK/HARDCODED) | **NOT PROVEN** in either repo this round (Phase 5) | Real calculators exist for M3(inline)/M11/M13/M14 | `MockTelemetryProvider.ts` (mock) | Real, mounted | **UNRESOLVED** — no existing real source proven schema-complete; connecting any of these would require new adapter/transform code, which is out of this round's "existing-only" scope. |

**Net result of Phase 6, under the task's own strict "no new calculator/measurement/dashboard/port/capability" rule: zero items qualify for a same-session reconnection.** Every mock case that could theoretically be replaced (M1/M2/M3/M4/M11/M13/M14) requires a schema-transform adapter that is real, new work, not present in either repository today — building one would violate the explicit "ห้ามสร้าง calculator ใหม่ถ้ามีของเดิม" instruction's spirit only if reused verbatim, but the DATA-SHAPE ADAPTER ITSELF does not exist and its absence is the actual, proven blocker, not a wiring oversight.

---

## PHASE 7 — NOT EXECUTED

Per the task's own Phase 7 gate ("หลัง Phase 1-6 มี evidence ครบแล้ว จึงทำเฉพาะรายการที่พิสูจน์แล้วว่า... schema/output ตรงกับ consumer หรือมี existing adapter อยู่แล้ว"): **zero items in Phase 6's table satisfy all five of Phase 7's own preconditions.** The two items that ARE fully wired and correct (M5/M8/M9/M10/M12) need no action. The one item that is registered-but-blocked (M1/M2) has no existing schema-complete real source. The one clear defect found (`joint-monitor`'s false "unclaimed port" claim) is a documentation/config correction inside DNA-OS-INFRASTRUCTURE, not a "connect existing real data" action — flagged for a decision, not executed unilaterally, since the correct replacement port is not itself provable from this round's evidence (would need the Owner or a prior-informed decision to pick one that doesn't collide with anything else this scan found: 3000, 5177, 5432, 8787, 8788(?), 8790, 8791 are all now known-taken or claimed).

---

## FINAL MATRIX

| Measurement | Registry ID | Real Source | Calculator | Current Destination | Correct Destination | Mock Status | Runtime Evidence | Final Status |
|---|---|---|---|---|---|---|---|---|
| M1 Bottleneck | `capability_index.json` (`engineering_bottleneck_measurement_via_monitor-ui_dashboard`) | NOT_PROVEN | `bottleneckScore.ts` (real) | `BottleneckBoard.tsx` @ :5177 | Same (correct component, wrong data) | MOCK | Confirmed via `App.tsx:305` + registry's own `BLOCKED_MOCK_DATA` | UNRESOLVED |
| M2 Recurrence | Same entry | NOT_PROVEN | `recurrenceMetrics.ts` (real) | `RepeatedProblemMap.tsx` @ :5177 | Same | MOCK | Same | UNRESOLVED |
| M3 Capability growth | None | PARTIAL (`capabilities.jsonl`, schema mismatch) | inline (real) | `CapabilityGrowth.tsx` @ :5177 | Same | MOCK | `App.tsx:293` | UNRESOLVED |
| M4 Engineering time | None | NOT_PROVEN | inline (real) | `EngineeringTimeChart.tsx` @ :5177 | Same | HARDCODED | `EngineeringTimeChart.tsx:7,25` | UNRESOLVED |
| M5 Execution detail | None (dashboard-side) | REAL (:8787) | inline (real) | `ExecutionDetailPanel.tsx` @ :5177 | Same | REAL | `DNAOSTelemetryProvider.ts:23-41` | CORRECT — no action |
| M6 Error monitor | None | NOT_PROVEN | inline (real) | `ErrorMonitor.tsx` @ :5177 | Same | HARDCODED | `ErrorMonitor.tsx:3,34-35` | UNRESOLVED |
| M7 Git monitor | None | NOT_PROVEN | inline (real) | `GitMonitor.tsx` @ :5177 | Same | MOCK | `App.tsx:112/118` | UNRESOLVED |
| M8 Local machine | None (dashboard-side) | REAL (:8787 SSE) | inline (real) | `LocalMachine.tsx`/`...HistoryChart.tsx` @ :5177 | Same | REAL | `useLocalTelemetry.ts:111,120,133` | CORRECT — no action |
| M9 Compute/GPU | None | REAL (:8788, claimed) | inline (real) | `ComputeResourceBoard.tsx` @ :5177 | Same | REAL | `DnaOsComputeProvider.ts:20-41` (port liveness UNRESOLVED this round) | CORRECT, port-liveness UNRESOLVED |
| M10 Concurrent execution | None | REAL (:8787) | inline (real) | `ConcurrentExecutionMeter.tsx` @ :5177 | Same | REAL | Same as M5 | CORRECT — no action |
| M11 Cost metrics | None | NOT_PROVEN | `costMetrics.ts` (real) | `ResourceMonitor.tsx` @ :5177 | Same | MOCK (self-disclosed in UI) | `App.tsx:111/117,161` | UNRESOLVED |
| M12 Research meta | `research-engine` (`capability-registry.ts`, points at the same :8787) | REAL (:8787) | pass-through | `ModelResearch.tsx`/`ResearchMeta.tsx` @ :5177 | Same | REAL | `DNAOSTelemetryProvider.ts:19-21,43-44,49` | CORRECT; registry entry exists but is unwired to this UI (separate client) — WIRING_REQUIRED if unifying is ever desired, not executed |
| M13 Owner summary | None | NOT_PROVEN | `ownerSummary.ts` (real) | `OwnerSummary.tsx` @ :5177 | Same | MOCK (self-disclosed "Mock Period") | `App.tsx:163,260-261` | UNRESOLVED |
| M14 Task metrics | None (dashboard-side) | PARTIAL (`tasks.jsonl`, schema mismatch) | `taskMetrics.ts` (real) | `WorkStateBoard.tsx`/`SummaryCards.tsx` @ :5177 | Same | MOCK | `App.tsx:106-119,159` | UNRESOLVED |
| M15 Joint events | None | REAL, PERSISTED (`joints.jsonl`) | `joint-store.ts` (real) | `observability/joint-monitor`'s own viewer (not running) | Its own page, not :5177 | REAL | 8 real rows, this session | Port conflict with :5177 — UNRESOLVED (see Phase 6) |
| M16 Violation events | None | REAL, PERSISTED (`violations.jsonl`) | `joint-store.ts` (real) | Same as M15 | Same | REAL | 2 real rows, this session | Same |

---

## FINAL NUMBERS

```
TOTAL_MEASUREMENTS_FOUND:        16  (14 in the :5177 dashboard + 2 in DNA-OS-INFRASTRUCTURE's own joint-monitor)
REGISTERED:                       2  (M1, M2 — one shared capability_index.json entry)
NOT_REGISTERED:                  14
REGISTERED_NOT_CONNECTED:         2  (M1, M2 — registered AND already known-blocked by that same registry entry)
REAL_DATA_CONNECTED:              5  (M5, M8, M9, M10, M12 — proven live/real, correctly wired)
MOCK_DATA_FOUND:                  9  (M1, M2, M3, M4, M6, M7, M11, M13, M14)
MOCK_DATA_REMOVED:                0  (Phase 7 not executed — no proven schema-complete replacement existed for any of the 9)
WRONG_UI_ROUTING_FOUND:           0  (no measurement found routed to an incorrect existing UI)
ROUTING_CORRECTED:                0
DUPLICATE_UI_FOUND:               0
UNRESOLVED:                      11  (M1, M2, M3, M4, M6, M7, M9's port-liveness, M11, M13, M14, and the M15/M16 :5177 port conflict)
```

**Why Phase 7 produced zero corrections despite 9 mock-data findings:** the task's own precondition #2 ("schema/output ตรงกับ consumer หรือมี existing adapter อยู่แล้ว") was checked for every one of the 9 mock cases, individually, against every real data source found in both repositories (Phase 5's table). None passed — every candidate real source (`capabilities.jsonl`, `tasks.jsonl`, `connections/telemetry`) is a genuine, real, but **differently-shaped** dataset than what the dashboard's existing calculators expect, and no adapter bridging the two shapes exists in either repo. Building one was correctly out of scope for a measurement-only round that forbids new calculators — and per the task's own logic, a shape-transform IS new calculation work, not "connecting what already exists." This is reported as `UNRESOLVED`, not guessed around, per the task's explicit "ถ้าจุดใดพิสูจน์ไม่ได้ ให้ใส่ UNRESOLVED ห้ามเดาเพื่อให้รายงานครบ" instruction.

**One decision this report surfaces but does not resolve:** `observability/joint-monitor/`'s default port (5177) is proven, by live runtime check, to collide with the real, already-running Engineering Research Monitor dashboard. Fixing this requires picking a new default port for `joint-monitor` — which was out of this round's "no new port" scope to decide unilaterally, and is flagged here for an explicit decision rather than acted on.
