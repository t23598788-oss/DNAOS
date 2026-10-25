# MASTER EXECUTION STATE — FACTORY REFERENCE INDEX

**This is a human-readable RENDERING and pointer index, not a second source of truth.** Real data lives in the JSON registries this file points to — same relationship `CLAUDE.md` has to `registry/CONSTITUTION.json`. If this file and those JSON registries ever disagree, the JSON wins; regenerate this file to match, not the other way around. Last regenerated: 2026-08-10, against `registry/CHANGELOG.json` DNA-000117, as STEP 2 (Structure Memory) of the Owner's Factory Stabilization & Baseline Phase.

**A new AI session should be able to bootstrap entirely from this file** — it names the real file for every real subsystem rather than re-explaining what each one does; read the cited file itself for detail, don't guess from the one-line description here.

## PROJECT STATUS

- Project: DNA OS — `dna-os-deadboard`
- Current phase: **Factory Stabilization & Baseline Phase** (Owner, 2026-08-10) — closing real Gaps, then freezing `FACTORY_BASELINE_V1`
- `FACTORY_BASELINE_V1` scope, Owner-confirmed: **Control Plane only** — Front Office and Worker Team self-registration are real, disclosed, non-blocking debt for this baseline, not in scope (see Known Remaining Gaps below)
- Real, live `factory_status`: **NOT_STABLE** — computed by `app/api/admin/ide/_lib/gapLoopRuntime.ts#computeFactoryStatus()`, not asserted; re-run it for the current answer, don't trust a cached number here

## 1. ARCHITECTURE

| What | Real file |
|---|---|
| Layer stack (core/gateway/engines/cognitive/presenter/services/plugins/registry) | `registry/CONSTITUTION.json` → `layer_stack`, rendered in `CLAUDE.md` |
| Module/import graph | `registry/architecture.json`, `registry/architecture-book.json` |
| Factory departments (12) | `registry/factory-registry.json` |
| Dependency rules (cross-layer imports) | `registry/dependency-graph.json` |

## 2. CONTROL PLANE (real, built and independently verified this session — DNA-000079 through DNA-000117)

MANAGER-07 is the Command/Planning/Dispatch Authority (Constitution Rule 252) — never writes source code itself, only CLASSIFY → PLAN → DISPATCH → VERIFY → ROUTE NEXT (Rule 259).

| Component | Real file | Constitution Rule |
|---|---|---|
| Registry-First Inquiry | (process discipline — check Registry before asking Owner) | Rule 250 |
| Manager Question Queue | `app/api/admin/ide/_lib/managerQuestionRuntime.ts` | Rule 251 |
| Manager Non-Mutation | (structural — enforced by every Runtime below never containing Manager-authored business logic) | Rule 252 |
| Switch-Based Orchestrator (gate pipeline: VALIDATE→CLASSIFY→DEDUP→NOISE_FILTER→DEPENDENCY_CHECK→LOCK→ROUTE→WORKER→EVIDENCE→VERIFY) | `app/api/admin/ide/_lib/switchBasedOrchestratorRuntime.ts` | Rule 252 (Closed-Loop Factory Mode) |
| Factory Central Registry Reporting Policy | `registry/FACTORY_CENTRAL_REGISTRY.json` | Rule 253 |
| Front Office AI / MANAGER-07 parallel command chains | `TEAM_ROLE_CONTRACT.md`, `LOCKED_WORKFLOW.md` (Advisor session's real output) | Rule 254 |
| Closed Loop Execution Policy (5 Owner-escalation criteria) + **Factory Gap Loop amendment** (10-category Gap taxonomy, dedup/merge, `FACTORY_STATUS`) | `app/api/admin/ide/_lib/gapLoopRuntime.ts` | Rule 255 |
| Capability-First Expansion Principle | (policy — see Rule text) | Rule 256 |
| Execution Plane Cost Gate (FREE_LOCAL / PAID_EXTERNAL / UNKNOWN_COST) | `app/api/admin/ide/_lib/costGateRuntime.ts` | Rule 257 |
| EXECUTION_HAND (minimal-context back-office execution worker) | `app/api/admin/ide/_lib/executionHandRuntime.ts` + `workers/execution-hand/` | Rule 258 |
| MANAGER-07 Tool-Calling Authority (Integration Assembly) | (process — see Rule text) | Rule 259 |

## 3. WORKER ROLES

| Role | Real file | Status |
|---|---|---|
| 11 `WorkerType`s (10 original + `EDGE_FUNCTION_WORKER`) | `app/api/admin/ide/_lib/workerRegistry.ts` | Real, tested |
| Edge Function dispatch (Supabase Edge Functions bridge) | `app/api/admin/ide/_lib/edgeFunctionWorkerRuntime.ts` | Real, tested (TASK-045) |
| EXECUTION_HAND (RECEIVE→EXECUTE→RETURN EVIDENCE only, never PASS) | `app/api/admin/ide/_lib/executionHandRuntime.ts` + `workers/execution-hand/{ROLE.md,CONTRACT.md}` | Real, tested |
| 6 Departments (Connector/QA/Data/Identity/Testing/Factory) | `workers/worker-01-connector/` … `workers/worker-06-factory/`, `registry/TEAM_ORGANIZATION.json`, `registry/WORKER_IDENTITIES.json` | **Real scaffolding, 0/6 self-registered** — out of `FACTORY_BASELINE_V1` scope, real debt (see §9) |
| Factory Architecture Advisor | `TEAM_ROLE_CONTRACT.md` | **Real, separate, independent AI session** — never contacted directly, only via `registry/FACTORY_CENTRAL_REGISTRY.json` (Communication Rule 1) |
| "Rapid Integration Team" | `RAPID_INTEGRATION_INVENTORY_REPORT.md` | A mission/discipline (reuse-first, discover-before-build), not a fixed identity — fulfilled by whichever session runs it, including a MANAGER-07-dispatched read-only research Agent |

## 4. RUNTIME (real `.ts` modules under `app/api/admin/ide/_lib/`, all built this session unless noted)

`managerQuestionRuntime.ts` · `switchBasedOrchestratorRuntime.ts` · `costGateRuntime.ts` · `executionHandRuntime.ts` · `edgeFunctionWorkerRuntime.ts` · `gapLoopRuntime.ts` · `workerTaskOrchestrator.ts` (pre-existing, extended) · `workerRegistry.ts` (pre-existing, extended) · `contextPlannerRuntime.ts` (pre-existing, reused) · `acceptanceContractRuntime.ts` (pre-existing, reused) · `evidenceCollectorRuntime.ts` / `normalizationRuntime.ts` / `registryWriterRuntime.ts` (real, Advisor session's GAP-1 submission, MANAGER_VERIFYed — see FCR-010).

## 5. REGISTRY (key real files — full list in `registry/README.md`)

`CONSTITUTION.json` (168 iron_rules, range Rule 100–259) · `rule-coverage.json` · `TASK_QUEUE.json` (49 real tasks) · `CHANGELOG.json` (117+ real DNA-numbered entries) · `LOCK_MANAGER.json` (per-file lock ledger — must be empty when idle) · `FACTORY_CENTRAL_REGISTRY.json` (12 real findings, `type_enum`, `factory_status`) · `CURRENT_STATE.json` (this file's JSON source) · `WORKER_IDENTITIES.json` / `TEAM_ORGANIZATION.json` / `WORKER_REGISTRATION_PROTOCOL.json` / `WORKER_COMMUNICATION_MAP.json` (Advisor session's real Department infra) · `AI_SESSIONS.json` · `COST_BUDGETS.json` / `COST_LEDGER.json` (Rule 257).

## 6. RULES

Source of truth: `registry/CONSTITUTION.json` → `iron_rules` (168 entries, Rule 100–259 — earlier numbers are legacy/renumbered, see the file's own gaps). Human-readable rendering: `CLAUDE.md` (**stale past ~Rule 117** — read the JSON directly for anything newer). Enforcement/verification status per rule: `registry/rule-coverage.json`. Amendment discipline: C-010 (append, never rewrite in place) — every Rule 255/257 amendment in this session followed that pattern.

## 7. ROUTING

Real dispatch entry points: `workerTaskOrchestrator.ts#createJobContract/runScopedWorkerJob` (10 original WorkerTypes) and `switchBasedOrchestratorRuntime.ts#attemptDispatch` (the gate-pipeline path, checks Cost Gate + Worker registration before releasing). `EDGE_FUNCTION_WORKER` and `EXECUTION_HAND` are each real, deliberate exceptions with their own dispatch functions (`edgeFunctionWorkerRuntime.ts#dispatchEdgeFunctionWorkerJob`, `executionHandRuntime.ts#executeJobContract`) — `runScopedWorkerJob()` real-refuses both rather than silently misrouting them into `CODE_WORKER`.

## 8. EVIDENCE

`registry/FACTORY_CENTRAL_REGISTRY.json` (real findings, FCR-001…012) · `registry/VALIDATION_RESULTS.json` · `registry/CHANGELOG.json` (every real DNA entry cites its own real, re-run test output — never asserted) · each `*-test.ts`/`*-acceptance-test.ts` under `scripts/` is itself real, runnable evidence, not a report about evidence.

## 9. COMPLETED TASKS (this session — see `registry/TASK_QUEUE.json` for full detail on all 49)

`TASK-042` Manager Question Queue · `TASK-043` Connector Department reorg (Advisor) · `TASK-045` EDGE_FUNCTION_WORKER · `TASK-047` Switch-Based Orchestrator · `TASK-048` Cost Gate · `TASK-049` EXECUTION_HAND · `TASK-050` Cost Gate FREE_LOCAL · `TASK-052` Factory Gap Loop runtime. Plus `TASK-018` (missing `plugins/agent/server.ts`, real honest stub). `TASK-051` (FCR-012 fix) — in progress as of this regeneration.

## 10. KNOWN REMAINING GAPS (real, current — re-run `computeFactoryStatus()` for the live answer, this is a snapshot)

| Gap | Real status | In `FACTORY_BASELINE_V1` scope? |
|---|---|---|
| `WORKER_IDENTITIES.json` 0/6 registered | Real, structural — no live Worker session has run its boot sequence | **No** — Owner-confirmed deferred (2026-08-10) |
| FCR-005 (`capability-registry.json` stale re: Worker-03/04) | TRACKED | No — tied to deferred Worker Team work |
| FCR-006 (3 status vocabularies coexist) | TRACKED | No — tied to deferred Worker Team work |
| FCR-008 (Front Office 0% built, TASK-046 not started) | TRACKED | No — Owner-confirmed deferred (2026-08-10) |
| FCR-012 (`DNA_OS_HEALTH.json` schema collision, real `tsc` errors) | TRACKED → fix in progress, `TASK-051` | **Yes** — being closed now |
| `TASK-044` (readiness audit) | blocked when Cost Gate had no FREE_LOCAL path — **now real, retriable** since `TASK-050` landed | Yes — real candidate, not yet retried |
| 1 pre-existing, unrelated `tsc` error (`issue-receipt/route.ts`) | Real, predates this session, out of scope | No — noted so it's never confused with a new regression |

## AI STARTUP

1. Read this file.
2. Check `factory_status` — re-run `gapLoopRuntime.ts#computeFactoryStatus()` live, don't trust a cached value.
3. Check `registry/TASK_QUEUE.json` for the real, current task list (`routing.bucket` field tells you EXECUTION_HAND / DEPARTMENT / BLOCKED_ON_DEPENDENCY).
4. Check `registry/LOCK_MANAGER.json` — must be empty before starting new work; never touch a file someone else's entry names.
5. Before building anything: search this file's §2–§5 for whether it already exists (Rule 101/103) — this session's own history is full of real examples of catching that before building.
6. Stop and ask the Owner only for what Rule 255's 5 real criteria name, or what genuinely isn't answerable from the Registry (Rule 250) — everything else, decide from evidence and keep moving.

## END CONDITION FOR THIS PHASE

Factory Stabilization & Baseline Phase ends when: `factory_status` for the Control-Plane scope is STABLE, `MASTER_EXECUTION_STATE.md`/`CURRENT_STATE.json` are current (this regeneration), a `FACTORY_BASELINE_V1` snapshot is recorded (commit + verified tests/runtimes + known non-blocking debt), and a fresh session can restart/resume from that baseline without losing context — verify that last claim by actually trying it, not by assuming this file is sufficient.
