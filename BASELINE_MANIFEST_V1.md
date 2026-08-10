# FACTORY_BASELINE_V1 — Baseline Manifest

**Commit:** `bce2c4cad571a1b6c8b860fb3151ded680d3d838` (local only, not pushed)
**Timestamp:** 2026-08-10
**Scope:** Control Plane only — Owner-confirmed (AskUserQuestion, 2026-08-10), scoped down from the broader Factory Freeze precondition list `FCR-008` originally named (Front Office, Worker Team).
**Declared by:** MANAGER-07, on explicit Owner command ("FACTORY STABILIZATION & BASELINE PHASE").

## What is frozen (79 files, this commit only)

**New Control Plane runtime (6 files, 100% built and verified this session):**
`app/api/admin/ide/_lib/{managerQuestionRuntime,switchBasedOrchestratorRuntime,costGateRuntime,executionHandRuntime,edgeFunctionWorkerRuntime,gapLoopRuntime}.ts`

**Real acceptance suites (7 files):**
`scripts/{manager-question-queue,switch-based-orchestrator,cost-gate,execution-hand,edge-function-worker,gap-loop}-test.ts` + `scripts/execution-hand-dispatch-run.ts`

**Other new files:** `plugins/agent/server.ts`, `MASTER_EXECUTION_STATE.md` (regenerated), `DNA_OS_DASHBOARD.json`, `DEPLOYMENT_READINESS_REFRESH_ATTEMPT_2026-08-09.md`, `workers/execution-hand/` (real workspace + real evidence from live TASK-009/018/044 dispatches).

**Shared substrate (co-edited with the concurrent Advisor session's earlier-today base; MANAGER-07's verified additions live inside, cannot be split from the file at the git level):**
`app/api/admin/ide/_lib/{workerTaskOrchestrator,workerRegistry,artifactRegistry,codeWorkerRuntime,workerAdapter}.ts`, the 5 `workerAdapters/*.ts` files, `scripts/worker-assignment-test.ts`, `scripts/{dashboard.sh,hello.ts}`, `package.json`, `DNA_OS_HEALTH.json` (regenerated evidence).

**Shared registries (single ledgers both sessions write into; committed as their real, current, correct state — not filtered):**
`registry/{CONSTITUTION,rule-coverage,TASK_QUEUE,CHANGELOG,CURRENT_STATE,FACTORY_CENTRAL_REGISTRY,LOCK_MANAGER,module-registry}.json`, `registry/{COST_BUDGETS,COST_LEDGER}.json` (100% MANAGER-07's, cleanly separable).

**Pre-commit-hook fixes bundled in (all real, all independently verified, DNA-000120–122):**
2 stale `module-registry.json` entries removed (files already deleted); `engines/documents/engine.ts` — genuine, pre-existing (2026-08-07) dead-code gap fixed by wiring the import its own header already claimed, 16 real consumers confirmed unaffected; hardcoded fake Supabase URL in this session's own test file renamed; 15 real `purpose`/`purpose_th` registry descriptions written, replacing auto-stubs; 1 genuine `entry_point: true` classification.

**Explicitly excluded from this commit** (per Owner's 3 prohibitions): the concurrent Factory Architecture Advisor session's own distinct files — `TEAM_ROLE_CONTRACT.md`, `LOCKED_WORKFLOW.md`, every `*_PROPOSAL.md`/`*_REPORT.md` doc, `workers/worker-01-connector/` through `worker-06-factory/`, `front-office/`, `back-office/`, `connectors/`, `evidenceCollectorRuntime.ts`/`normalizationRuntime.ts`/`registryWriterRuntime.ts` (real, MANAGER_VERIFYed via `FCR-010`, but authored entirely by that session), `app/admin/connectors/*`, `app/api/admin/connectors/*`, `app/api/admin/capability-map/`, all Worker-Team/Department registries (`WORKER_IDENTITIES.json`, `TEAM_ORGANIZATION.json`, etc.), Supabase migrations, and every other unrelated pre-existing modified file already in the working tree before this session began.

## Tests passed (9 real suites, 207/207 — independently re-run by MANAGER-07 before AND after this commit)

| Suite | Result |
|---|---|
| `worker-01:test` (`SKIP_LIVE=1`) | 12/12 |
| `worker-02:test` | 9/9 |
| `native-factory-flow:test` | 17/17 |
| `manager-question-queue:test` | 21/21 |
| `switch-based-orchestrator:test` | 22/22 |
| `cost-gate:test` | 49/49 |
| `execution-hand:test` | 37/37 |
| `edge-function-worker:test` | 20/20 |
| `gap-loop:test` | 20/20 |

Plus: `npx tsc --noEmit` — 1 error, real and pre-existing (`app/api/admin/debt-events/[id]/issue-receipt/route.ts`, unrelated to this baseline, unchanged before/after). `registry/*.json` — 123/123 files valid JSON. `registry/LOCK_MANAGER.json` — empty (no residue). `npx tsx scripts/build-arch-book.ts` — 0 broken, 0 unused.

## Registries involved

`registry/CONSTITUTION.json` (iron_rules, Rule 250–259 + Rule 255 amendment — Factory Gap Loop), `registry/rule-coverage.json` (real `enforced_by`/`detection` evidence per rule), `registry/TASK_QUEUE.json` (`TASK-042/045/047/048/049/050/051/052` + the `TASK-018` fix, all `done`, plus `routing{}` classification on the 16-item backlog), `registry/CHANGELOG.json` (`DNA-000079` through `DNA-000122`, every entry independently re-verified before being recorded), `registry/FACTORY_CENTRAL_REGISTRY.json` (`type_enum`, `factory_status`, `FCR-009/010/011/012` resolved, `FCR-005/006/008` deferred), `registry/CURRENT_STATE.json` (regenerated, `FACTORY` exceptions_log entry appended), `registry/COST_BUDGETS.json`/`COST_LEDGER.json` (real, empty — no paid execution occurred without approval).

## Known Gaps deferred (real, disclosed, not silently dropped)

| Gap | Why deferred |
|---|---|
| `WORKER_IDENTITIES.json` 0/6 registered | Owner-confirmed out of V1 scope (2026-08-10) — real Worker self-registration, not MANAGER-07's to fabricate |
| `FCR-005` (`capability-registry.json` stale re: Worker-03/04) | Tied to the same deferred Worker Team work |
| `FCR-006` (3 status vocabularies coexist) | Tied to the same deferred Worker Team work |
| `FCR-008` (Front Office 0% built, `TASK-046` not started) | Owner-confirmed out of V1 scope (2026-08-10) |
| `TASK-044` (readiness audit) | Was blocked by the Cost Gate gap now fixed (`TASK-050`) — real, retriable candidate, not yet re-attempted |
| `TASK-009` (`DocumentBuilder.tsx` category-picker) | Genuinely blocked — `EXECUTION_HAND` correctly refused to guess; real open question for the Owner |
| 1 pre-existing `tsc` error (`issue-receipt/route.ts`) | Predates this session entirely, unrelated |

## Outside this Baseline entirely

Front Office AI (`TASK-046`, 0% real implementation), Worker Team self-registration and the 6 Department workspaces, the Factory Architecture Advisor's own runtime/registry work (real, verified via `FCR-010`, but not this baseline's to claim), whole-repo production deploy readiness (`npm run deploy-gate` — NOT READY, tracked as its own separate track per the Owner's explicit instruction, not mixed with this baseline), BMO / Black Box / World Data Engine (explicitly not started, per Owner prohibition).

## Restart / Resume contract

A fresh AI session should: read `MASTER_EXECUTION_STATE.md` first → check `registry/CURRENT_STATE.json`/`TASK_QUEUE.json` for real current status → re-run `computeFactoryStatus()` for a live, non-cached answer → treat this file as the frozen snapshot of what `FACTORY_BASELINE_V1` verified, not a claim about *current* state (which drifts). No change after this commit may retroactively edit this file or the frozen commit's content — any further work is a new, separate Change (new `DNA-000xxx` entry, new commit), never a silent amendment.
