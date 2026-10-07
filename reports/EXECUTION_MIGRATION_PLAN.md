# EXECUTION Capability Migration Plan — dna-os-deadboard → DNA-OS-INFRASTRUCTURE

Status: READ-ONLY PLANNING ONLY. No file outside this report was created, edited, moved, staged, committed, or deployed. No mutating git command was run in either repo.

Sources read in full for this plan: `executionRegistry.ts` (585 lines), `executionRuntime.ts` (551 lines), `queueRuntime.ts` (imports/exports + `createRunCommandJob`, lines 330-400), `commandSurfaceRuntime.ts` (imports/exports + `handleOwnerCommand`, lines 229-320), `buildRuntime.ts` (imports/exports), `testRuntime.ts` (imports/exports), `factoryWorkspaceRuntime.ts` (imports/exports), plus five route.ts files: `execution/run/route.ts`, `execution/run/[id]/route.ts`, `execution/cancel/[id]/route.ts`, `execution/commands/route.ts`, `owner-command/route.ts`. Prior audit `reports/OLD_CONTROL_PLANE_DEEP_AUDIT.md` treated as ground truth for caller counts and cross-file map; re-verified against actual source rather than re-derived from scratch.

---

## 1. EXECUTION_CORE_FILES

| File | Classification | Responsibility |
|---|---|---|
| `_lib/executionRegistry.ts` | EXECUTION_POLICY + EXECUTION_VALIDATION | Allowlist (`COMMAND_REGISTRY: Record<commandId, CommandDefinition>`), `validateDynamicArgs()`, `resolveWorkingDirectory()`, `CHILD_ENV_ALLOWLIST`/`buildChildEnv()`, denylist re-check `isCommandDenied()`. Single source of truth for executable/argv — client input never reaches these. |
| `_lib/executionRuntime.ts` | EXECUTION_CORE | The spawn engine. `executeDefinition()` (spawn, shell:false, argv array, allowlisted env, cwd pinned), `startRun()` (registry lookup → executeDefinition), `getRun`, `listRuns`, `cancelRun`, `subscribeToRunEvents`, `getRunEvents`. Owns run-state map, concurrency counters, exclusive-lock set, secret redaction, ANSI stripping, workspace-integrity before/after git-status snapshot, timeout/grace-kill via process-group signal. |

## 2. EXECUTION_SUPPORT_FILES

| File | Classification | Responsibility |
|---|---|---|
| `_lib/queueRuntime.ts` | EXECUTION_CALLER | `createRunCommandJob()` is the sole real caller of `startRun()` from the job layer; wraps a `RunRecord` as a `Job`, dedupes in-flight commandId per owner, mirrors run events onto job status via `subscribeToRunEvents`. 15 route callers total (most unrelated to EXECUTION — Editor/Test/Build/Release/Deployment/Operations job types), but `createRunCommandJob` is the execution-relevant symbol. |
| `_lib/commandSurfaceRuntime.ts` | EXECUTION_CALLER | `handleOwnerCommand()` fast-path intent router; for `CHECK_ARCHITECTURE` and `RUN_REGISTERED_COMMAND` intents it calls `createRunCommandJob(commandId, undefined, actor, ownerId, false)` directly — always passes `ownerConfirmation=false`, so WORKSPACE_WRITE commands correctly surface `OWNER_CONFIRMATION_REQUIRED` rather than being silently confirmed. |
| `_lib/buildRuntime.ts` | EXECUTION_CALLER (thin layer) | Imports `startRun, subscribeToRunEvents, cancelRun` and `getCommandDefinition` directly from execution files; drives `build`/`typecheck`/`lint`/`architecture.check`/`governance` commandIds. 1503 lines, but the EXECUTION-relevant surface is narrow — most of the file is build-run bookkeeping (staleness, reproducibility comparison, gate reports), not execution logic itself. |
| `_lib/testRuntime.ts` | EXECUTION_CALLER (thin layer) | Imports `startRun, subscribeToRunEvents` directly; drives `ide.test`/`factory.test`/`governance.test`/`artifact.test`/`ui-inspection.test`/`review.test` commandIds. 559 lines, same pattern as buildRuntime — thin orchestration over the execution engine's public entry points only. |
| `_lib/gitReadOnly.ts` | NOT_EXECUTION (parallel, related system) | Separate real `git` via `execFile` for read-only status/diff/log/blame, used directly by 8 routes outside the commandId/registry path. Not part of the executionRuntime call chain, but `executionRegistry.ts`'s own comment explicitly says `git.status`/`git.diff` commandIds follow "the same convention... via execFile with a fixed argv" — worth keeping adjacent, not merging. |
| `_lib/executionHandRuntime.ts` | NOT_EXECUTION (orphan, do not port) | Confirmed by prior audit as a separate, more dangerous file-mutation + shell-exec engine with no live route caller. Explicitly out of scope — do not conflate with `executionRuntime.ts`, do not port. |
| `_lib/factoryWorkspaceRuntime.ts` | NOT_EXECUTION (mixed, needs extraction) | 729 lines. Does **not** import `executionRuntime.ts`/`executionRegistry.ts` directly — it calls `buildRuntime.ts`/`testRuntime.ts`'s public functions (`createTestRun`, `createBuildRequest`, etc.), i.e. it's a caller of EXECUTION's *consumers*, one level removed. See Section 8 for the extraction breakdown. |
| `app/api/admin/ide/execution/commands/route.ts` | EXECUTION_ADAPTER (HTTP boundary) | `GET` → `listCommandDefinitions()`, strips `executable`/`fixedArgs` from the response — client only ever sees id/label/description/category, never the real argv. |
| `app/api/admin/ide/execution/run/route.ts` | EXECUTION_ADAPTER (HTTP boundary) | `POST` → `createRunCommandJob()` (queueRuntime), then wires inspection (`inspectionRuntime.ts`) and artifact evidence (`artifactRuntime.ts`) onto the same run — this file is the fullest real end-to-end wiring example. |
| `app/api/admin/ide/execution/run/[id]/route.ts` | EXECUTION_ADAPTER | `GET` → `getRun()`, ownership-checked. |
| `app/api/admin/ide/execution/cancel/[id]/route.ts` | EXECUTION_ADAPTER | `POST` → `cancelRun()`, ownership-checked, SIGTERM→grace→SIGKILL on the exact spawned process group only. |
| `app/api/admin/ide/execution/stream/[id]/route.ts` | EXECUTION_ADAPTER (not read in full this pass — inferred from name/prior audit) | SSE wrapper around `subscribeToRunEvents`. |
| `app/api/admin/ide/owner-command/route.ts` | EXECUTION_CALLER (HTTP boundary) | `POST` → `handleOwnerCommand()` fast path, falls through to `factoryWorkspaceRuntime.ts`'s `runAutoOrchestration()` only on `UNRECOGNIZED`/`MODIFY_MODULE_HINT`. |
| `_lib/artifactRuntime.ts`, `_lib/inspectionRuntime.ts` | EXECUTION_AUDIT (referenced, not read in full this pass) | `createQueueJobArtifact`, `createExecutionResultArtifact`, `createInspectionResultArtifact` chain evidence off the real run's terminal event; `attachInspectionToRun` subscribes to the same run, spawns no second process. |

## 3. REAL_RUNTIME_ENTRYPOINTS

Two real entrypoints exist, both converging on the same core:

- **A. Direct Execution panel:** `execution/run/route.ts` (POST) → `queueRuntime.createRunCommandJob` → `executionRuntime.startRun`
- **B. Owner Command Surface:** `owner-command/route.ts` (POST) → `commandSurfaceRuntime.handleOwnerCommand` → `queueRuntime.createRunCommandJob` → `executionRuntime.startRun`

Both are traced end-to-end in Section 2 below (STEP 2 of the task).

## 4. SECURITY_PROPERTIES_TO_PRESERVE

Traced end-to-end (see full trace in the next section header repeated for STEP 2). Verified present in old code, file:line-level:

| Property | Present? | Where |
|---|---|---|
| Command allowlist | YES | `executionRegistry.ts` `COMMAND_REGISTRY` — commandId not present throws `INVALID_COMMAND` before any spawn |
| `spawn(shell:false)` | YES | `executionRuntime.ts:413-415` — literal `shell: false` |
| Fixed/structured argv | YES | `executionRegistry.ts` `fixedArgs: string[]` per command, `executionRuntime.ts:358` `fullArgv = [...def.fixedArgs, ...dynamicArgv]` — never string concatenation |
| No freeform shell execution | YES | No `exec()`/`execFile` with a joined string anywhere in the traced path; `SHELL_INJECTION_PATTERN` rejects shell metacharacters even as typed-arg values before they'd ever reach argv |
| cwd restrictions | YES | `resolveWorkingDirectory()` — only policy is `"workspace_root"` → `WORKSPACE_ROOT`, an explicit switch with no silent default branch |
| env restrictions | YES | `CHILD_ENV_ALLOWLIST` (8 names) + `buildChildEnv()` — full `process.env` (which may hold Supabase/Anthropic/DB secrets) is never passed to the child |
| Timeout | YES | `def.timeoutMs` per command, `executionRuntime.ts:452-457` `setTimeout` → `killGracefully` → SIGTERM then SIGKILL after `GRACE_PERIOD_MS` (5s), targets the whole process **group** (`killProcessGroup`, negative PID) not just the direct PID |
| Output capture | YES | stdout/stderr piped, ANSI-stripped, secret-redacted (`sanitizeChunk`), capped at `def.maxOutputBytes` with `truncated` flag and graceful kill on cap hit |
| Exit-code handling | YES | `child.on("exit", (code, signal) => ...)` → `finalize()` maps `code === 0` to `"passed"`, else `"failed"` with `EXECUTION_FAILED` |
| Permission gate | PARTIAL | `requireAuth(ADMIN_TIER)` at the HTTP route layer gates who can call at all; `requiresOwnerConfirmation` gates WORKSPACE_WRITE commands specifically (client must pass `ownerConfirmation:true`). There is **no dedicated execution-scope permission/policy module** distinct from the ADMIN_TIER auth check — see MISSING below. |
| Audit/evidence | YES (adjacent, not inside core) | `execution/run/route.ts` chains `createQueueJobArtifact` → `createExecutionResultArtifact` off the run's real terminal event; `RunRecord` itself carries `actor`, `normalizedArguments` (redacted), `stdoutHash`/`stderrHash`, `workspaceChangedPaths`. Evidence-writing lives in `artifactRuntime.ts`, called from the route, not from inside `executionRuntime.ts` itself. |
| Retry behavior | MISSING_IN_OLD_IMPLEMENTATION | No retry logic found in `executionRuntime.ts`/`executionRegistry.ts`/`queueRuntime.ts`'s `createRunCommandJob`. (`queueRuntime.ts` exports a generic `retryJob`, not read in full this pass — not confirmed to apply to RUN_COMMAND jobs; do not assume.) |
| Failure mode / fail-closed | YES | Every error path (`spawn` throw, denylist hit, concurrency limit, missing confirmation, unknown commandId) throws a typed `ExecutionError` before any process starts; nothing defaults to "allow". `finalize()` also fail-closes: a READ_ONLY command that unexpectedly changed the workspace (caught via before/after git-status diff) is downgraded to `"failed"`/`WORKSPACE_POLICY_VIOLATION`, never silently passed. |

## 5. MISSING_SECURITY_PROPERTIES

- **MISSING_IN_OLD_IMPLEMENTATION — Retry behavior**: no execution-level retry/backoff for a spawned run. Do not invent one during migration; if wanted, it is new scope requiring an owner decision (see Section 18).
- **MISSING_IN_OLD_IMPLEMENTATION — dedicated execution-scope permission module**: authorization today is (a) route-level `requireAuth(ADMIN_TIER)` and (b) the registry's static per-command `requiresOwnerConfirmation` flag. There is no separate "does this identity have permission to run *this* command" policy layer independent of the coarse ADMIN_TIER check. This matches the target repo's own stated gap — `permissions/execution-policy/README.md` already says "ยังไม่กำหนด — ต้องรอ execution/ มี executor จริงก่อน" (undefined, waiting for a real executor first). This migration is the trigger to design it — see Section 11.

## 6. BUILD_DEPENDENCIES

`_lib/buildRuntime.ts` consumes EXECUTION's public functions only: `startRun`, `subscribeToRunEvents`, `cancelRun` (from `executionRuntime.ts`) and `getCommandDefinition` (from `executionRegistry.ts`) — no reach into internal state (`runs` map, `activeLockKeys`, hashers, etc.). Drives commandIds: `build`, `typecheck`, `lint`, `architecture.check`, `governance`. 11 route callers per prior audit (not re-enumerated this pass).

## 7. TEST_DEPENDENCIES

`_lib/testRuntime.ts` consumes EXECUTION's public functions only: `startRun`, `subscribeToRunEvents` — same contract-only relationship as BUILD. Drives commandIds: `ide.test`, `factory.test`, `governance.test`, `artifact.test`, `ui-inspection.test`, `review.test`. 5 route callers per prior audit.

Both BUILD and TEST are confirmed thin — they never import from `executionRegistry.ts`'s `COMMAND_REGISTRY` object directly except via the one `getCommandDefinition` lookup (buildRuntime only), and never touch `executionRuntime.ts`'s internals (run-state Map, lock Set, hashers). This is the exact shape STEP 5 asked to confirm: BUILD/TEST are consumers of a public contract, not of private implementation.

## 8. MIXED_RESPONSIBILITY_EXTRACTIONS — `factoryWorkspaceRuntime.ts`

This file does not call `executionRuntime.ts` directly (confirmed by import list: it imports `createTestRun`/`getTestRun` from testRuntime.ts and `createBuildRequest`/`getBuildRun` from buildRuntime.ts — i.e., it is two hops from EXECUTION_CORE, not one). Per-piece classification:

| Piece | Symbols | Classification |
|---|---|---|
| Workspace session/state machine (create/attach/decide-gate) | `createWorkspaceSession`, `attachIntent`, `decideGate` | KEEP_OUTSIDE_EXECUTION — this is orchestration state, belongs with `control/command-status/lifecycle.ts` in the new repo, not with the executor |
| Capability resolution / context planning / execution-plan building | `runCapabilityResolution`, `recordCapabilityResolution`, `recordContextPlan`, `recordExecutionPlan` | EXTRACT_TO_ROUTER — these decide *what* to run and *whether* it's permitted before EXECUTION ever sees a commandId; conceptually belongs with `control/command-router/` |
| Worker assignment | `recordWorkerAssignment` | UNKNOWN — depends on whether "worker" maps to a `connections/` adapter or an AI dispatch concept not yet scaffolded in the new repo; needs an owner decision, not a guess |
| Test/build dispatch (`createTestRun`, `createBuildRequest`) | calls into testRuntime/buildRuntime | EXTRACT_TO_EXECUTION indirectly — these are the correct call pattern (through the public contract) and should be preserved as-is when BUILD/TEST are ported, not duplicated |
| Outcome/VSCode dependency reporting | `computeOutcomeReport`, `computeVSCodeDependencyReport` | KEEP_OUTSIDE_EXECUTION — reporting/read-model, not execution logic |
| Permission gating | none found as a distinct block inside this file — gating happens earlier, at the route (`requireAuth`) and inside `createRunCommandJob`'s confirmation check | EXTRACT_TO_PERMISSION (net-new) — there is no existing gate to extract from this specific file; the gate that exists lives in `executionRegistry.ts`'s `requiresOwnerConfirmation` and the route's `requireAuth`, already correctly placed |

Recommendation: do NOT port `factoryWorkspaceRuntime.ts` wholesale (confirmed, matches prior audit's flag). It is a caller of BUILD/TEST's public contract, not of EXECUTION_CORE, so it is out of scope for the EXECUTION migration itself — defer its 3-way split to a separate BUILD/TEST/orchestration migration plan.

## 9. TARGET_FOLDER_STRUCTURE

The target repo already has capability-folder scaffolding relevant to this migration (read directly, not assumed):
- `execution/run/README.md` — currently `NOT_YET_BUILT`, declares allowed deps `contracts/command/`, `permissions/execution-policy/`, `connections/`; output → `audit/command-audit/`
- `permissions/execution-policy/README.md` — currently `NOT_YET_BUILT`, explicitly waiting for `execution/` to have a real executor before its own policy can be designed
- `control/command-router/README.md`, `control/owner-command/README.md`, `control/command-status/lifecycle.ts` — router/gate scaffolding already present
- `audit/command-audit/README.md` (and siblings `code-change-audit`, `deployment-audit`) — append-only evidence destinations already scaffolded
- `contracts/command/command-envelope.ts`, `contracts/command/routing-result.ts` — already-defined command contract types

Proposed layout, built to fit this existing scaffold rather than a fresh generic shape:

```
execution/run/
  contract.ts      # PUBLIC_CONTRACT: execute(), ExecuteRequest/ExecuteResult types (Section 10)
  registry.ts       # PORT of executionRegistry.ts's COMMAND_REGISTRY + CommandDefinition + validateDynamicArgs + resolveWorkingDirectory + buildChildEnv + isCommandDenied
  executor.ts        # PORT of executionRuntime.ts's executeDefinition/startRun/spawn machinery
  result.ts          # RunRecord/RunEvent normalization, redaction, ANSI-stripping, workspace-integrity diff
  audit.ts           # NEW glue: writes to ../../audit/command-audit/ off each run's terminal event (currently done ad hoc in the old route.ts via artifactRuntime.ts)
  tests/
    allowlist.test.ts
    shell-safety.test.ts
    timeout-cwd.test.ts
    output-capture.test.ts

permissions/execution-policy/
  policy.ts          # NEW: the presently-missing execution-scope permission decision, consuming ../access-control/ + ../software-scope/ per its own README's declared allowed deps

control/command-router/  (existing scaffold)
  # dispatch: CommandEnvelope -> classify -> route to execution/run/ (or other capability), unchanged responsibility from its README

control/owner-command/   (existing scaffold)
  # PORT of commandSurfaceRuntime.ts's owner-fast-path recognition logic (RUN_REGISTERED_COMMAND / CHECK_ARCHITECTURE intents only — the execution-relevant subset)

audit/command-audit/     (existing scaffold)
  # PORT of the evidence-chaining pattern from execution/run/route.ts (createQueueJobArtifact -> createExecutionResultArtifact)
```

- **PUBLIC_CONTRACT**: `execution/run/contract.ts` — see Section 10.
- **PRIVATE_IMPLEMENTATION**: `execution/run/registry.ts`, `executor.ts`, `result.ts` — never imported directly by BUILD/TEST/router callers, only through `contract.ts`.
- **ALLOWED_CALLERS**: `control/command-router/` (post-authorization dispatch), a future `execution/build/` and `execution/test/` (thin consumers, mirroring old buildRuntime.ts/testRuntime.ts), `control/owner-command/` fast path — all calling only `contract.ts`'s `execute()`.
- **FORBIDDEN_CALLERS**: anything in `connections/` (adapters must not directly spawn — they go through this capability), anything in `ai/` or `software/` reaching past `control/command-router/` directly into `execution/run/registry.ts`/`executor.ts`.
- **PERMISSION_BOUNDARY**: `permissions/execution-policy/policy.ts` must run and approve before `execution/run/contract.ts#execute()` is called — enforced at the router, not inside the executor (executor may still re-check as defense-in-depth the way `isCommandDenied` does today, but must not become the primary gate).
- **AUDIT_BOUNDARY**: `audit/command-audit/` receives a record for every run reaching a terminal state (success, failure, cancel, timeout, output-limited) — write happens after the real terminal event, matching the old evidence-chaining pattern, never fabricated ahead of it per `audit/command-audit/README.md`'s own "written before caller learns of success" ordering rule.

## 10. PUBLIC_CONTRACT

```ts
// execution/run/contract.ts
interface ExecuteRequest {
  commandId: string;
  args?: Record<string, unknown>;
  cwdScope: "workspace_root"; // closed enum — never an arbitrary path from caller
  identity: { actorEmail: string; ownerId: string };
  correlationId: string;
  ownerConfirmation?: boolean; // only meaningful for WORKSPACE_WRITE commands
}

interface ExecuteResult {
  executionId: string;
  status: "queued" | "running" | "passed" | "failed" | "cancelled" | "timed_out" | "output_limited";
  exitCode: number | null;
  stdout: string;   // redacted, ANSI-stripped, size-capped
  stderr: string;
  durationMs: number | null;
  verification: { workspaceChangedPaths: string[] | null; workspacePolicyViolation: boolean };
  auditRef: string; // pointer into audit/command-audit/
}

function execute(req: ExecuteRequest): Promise<ExecuteResult>;
function getRun(executionId: string, ownerId: string): ExecuteResult;
function cancelRun(executionId: string, ownerId: string): ExecuteResult;
function subscribe(executionId: string, onEvent: (evt: RunEvent) => void): Unsubscribe;
```

Must NOT expose: raw shell strings (no field accepts one — `commandId` is the only command-shaped input), arbitrary cwd (`cwdScope` is a closed enum, not a path), unrestricted env (never a field at all — env stays entirely inside `registry.ts`'s allowlist), arbitrary command paths (`commandId` only, resolved server-side through `registry.ts`).

## 11. PERMISSION_BOUNDARY

```
Identity/Membership (permissions/access-control/)
        |
Permission Decision (permissions/execution-policy/ — NEW, currently NOT_YET_BUILT)
        |
EXECUTION Request (control/command-router/ -> execution/run/contract.ts#execute)
        |
Execution Policy (execution/run/registry.ts — allowlist + requiresOwnerConfirmation, PORTED)
        |
Executor (execution/run/executor.ts — spawn, PORTED)
```

In the old system, steps 2 and 4 were collapsed: there was no dedicated `permissions/execution-policy` equivalent, only route-level `requireAuth(ADMIN_TIER)` (coarse identity/tier check) plus the registry's static `requiresOwnerConfirmation` flag (a property of the command, not of the identity). The new repo's own `permissions/execution-policy/README.md` already anticipates this gap. EXECUTION may still verify execution-scope permission as defense-in-depth (mirroring `isCommandDenied`'s "never trust the registry check alone" pattern) but the primary identity/membership decision must live in `permissions/access-control/` + the new `permissions/execution-policy/` — EXECUTION must not become the identity system.

## 12. AUDIT_BOUNDARY

Old: evidence-writing lived in the HTTP route (`execution/run/route.ts`), calling `artifactRuntime.ts`'s `createQueueJobArtifact`/`createExecutionResultArtifact`, subscribed to the run's terminal event — never fabricated before the real event fires (confirmed: `subscribeToRunEvents` + replay-handling for the race where a fast command finishes before the subscription attaches).

New: this responsibility moves into `execution/run/audit.ts` (or is called from `control/command-router/` after `execute()` returns) writing to `audit/command-audit/`, preserving: append-only, written before the caller is told of success (per that folder's own README), one record per terminal run, never fabricated ahead of the real event.

## 13. FILE_BY_FILE_MIGRATION_TABLE

| OLD_FILE | OLD_SYMBOL | ROLE | TARGET_FILE | TARGET_SYMBOL | ACTION |
|---|---|---|---|---|---|
| executionRegistry.ts | `COMMAND_REGISTRY`, `CommandDefinition` | EXECUTION_POLICY | execution/run/registry.ts | same | PORT_AS_IS |
| executionRegistry.ts | `validateDynamicArgs` | EXECUTION_VALIDATION | execution/run/registry.ts | same | PORT_AS_IS |
| executionRegistry.ts | `resolveWorkingDirectory` | EXECUTION_POLICY | execution/run/registry.ts | same | PORT_AS_IS |
| executionRegistry.ts | `CHILD_ENV_ALLOWLIST`, `buildChildEnv` | EXECUTION_POLICY | execution/run/registry.ts | same | PORT_AS_IS |
| executionRegistry.ts | `isCommandDenied`, `DENIED_*` sets | EXECUTION_POLICY | execution/run/registry.ts | same | PORT_AS_IS |
| executionRegistry.ts | `ExecutionError`, `ExecutionErrorCode` | EXECUTION_CORE (errors) | execution/run/contract.ts | same | PORT_WITH_RENAME (align codes to new repo's error-shape convention if one exists — verify against `contracts/` before renaming) |
| executionRuntime.ts | `executeDefinition` | EXECUTION_CORE | execution/run/executor.ts | same | PORT_AS_IS |
| executionRuntime.ts | `startRun` | EXECUTION_CORE | execution/run/contract.ts (thin wrapper) + executor.ts (impl) | `execute` | PORT_WITH_RENAME |
| executionRuntime.ts | `getRun`, `listRuns`, `cancelRun`, `subscribeToRunEvents`, `getRunEvents` | EXECUTION_CORE | execution/run/contract.ts + result.ts | same names | PORT_AS_IS |
| executionRuntime.ts | `RunRecord`, `RunEvent`, `RunStatus` | EXECUTION_CORE (types) | execution/run/result.ts | same | PORT_AS_IS |
| executionRuntime.ts | redaction (`redactSecrets`, `STATIC_REDACTION_PATTERNS`, `knownSecretEnvValues`) | EXECUTION_CORE | execution/run/result.ts | same | PORT_AS_IS |
| executionRuntime.ts | ANSI stripping (`stripAnsi`, `sanitizeChunk`) | EXECUTION_CORE | execution/run/result.ts | same | PORT_AS_IS |
| executionRuntime.ts | workspace-integrity snapshot/diff (`captureWorkspaceSnapshot`, `diffWorkspaceSnapshots`) | EXECUTION_CORE | execution/run/result.ts | same | PORT_AS_IS (dependency: real `git`, matches `gitReadOnly.ts` convention — verify target repo has an equivalent read-only git wrapper before porting, or port that too) |
| executionRuntime.ts | `killProcessGroup`, `killGracefully`, timeout/grace timers | EXECUTION_CORE | execution/run/executor.ts | same | PORT_AS_IS |
| executionRuntime.ts | `__debugRunCount`, `__debugActiveLockKeys` | EXECUTION_TEST | execution/run/tests/ | same | PORT_AS_IS (test-only introspection) |
| gitReadOnly.ts | (whole file, not read this pass — per prior audit: real read-only git via execFile) | NOT_EXECUTION (adjacent) | connections/ or a shared read-only-git utility (location TBD — needs its own migration plan) | — | DO_NOT_MOVE as part of this plan; reference only, out of scope |
| queueRuntime.ts | `createRunCommandJob` | EXECUTION_CALLER | control/command-router/ (or execution/run/contract.ts's `execute` absorbs the job-wrapping) | — | EXTRACT_SYMBOL (only this function is execution-relevant; the other 90% of queueRuntime.ts, i.e. Editor/Test/Build/Release/Deployment/Operations job types, is out of scope) |
| commandSurfaceRuntime.ts | `handleOwnerCommand`'s `CHECK_ARCHITECTURE`/`RUN_REGISTERED_COMMAND` branches | EXECUTION_CALLER | control/owner-command/ | — | EXTRACT_SYMBOL (rest of the intent router — file-open hints, VSCode focus, step-gate checks — is NOT_EXECUTION, stays out) |
| buildRuntime.ts | `startRun`/`subscribeToRunEvents`/`cancelRun`/`getCommandDefinition` call sites | EXECUTION_CALLER | execution/build/ (future capability, separate plan) | — | KEEP_OLD_TEMPORARILY — repoint imports to the new `execution/run/contract.ts` only once it exists; do not port the rest of buildRuntime.ts under this plan |
| testRuntime.ts | `startRun`/`subscribeToRunEvents` call sites | EXECUTION_CALLER | execution/test/ (future capability, separate plan) | — | KEEP_OLD_TEMPORARILY — same as buildRuntime |
| factoryWorkspaceRuntime.ts | whole file | MIXED (see Section 8) | (split across control/, permissions/, and a to-be-named orchestration capability) | — | SPLIT_BEFORE_PORT — do not move as one file |
| executionHandRuntime.ts | whole file | ORPHAN, dangerous, no live caller | — | — | DO_NOT_MOVE |
| execution/run/route.ts (HTTP) | `POST` handler | EXECUTION_ADAPTER | control/command-router/ (dispatch) + execution/run/audit.ts (evidence wiring) | — | SPLIT_BEFORE_PORT (the route today conflates HTTP parsing, job creation, inspection attach, and artifact chaining — new repo's layering wants these as separate capabilities) |
| execution/run/[id]/route.ts, execution/cancel/[id]/route.ts, execution/commands/route.ts | `GET`/`POST` handlers | EXECUTION_ADAPTER | control/command-router/ or a thin API layer calling execution/run/contract.ts | — | PORT_WITH_RENAME |
| owner-command/route.ts | `POST` handler | EXECUTION_ADAPTER | control/owner-command/ | — | PORT_WITH_RENAME |

## 14. MIGRATION_SEQUENCE

1. **Contracts/types** — FILES: `execution/run/contract.ts` (ExecuteRequest/ExecuteResult, error codes), reusing `contracts/command/command-envelope.ts` where the shape already overlaps. DEPENDENCIES: none. TEST: type-only, compiles. ROLLBACK_POINT: delete the file, zero blast radius. BLOCK_CONDITION: none — safe to start immediately.
2. **Policy/validation** — FILES: `execution/run/registry.ts` (ported `COMMAND_REGISTRY`, `validateDynamicArgs`, `isCommandDenied`, `buildChildEnv`). DEPENDENCIES: step 1 types; a `WORKSPACE_ROOT`-equivalent constant must exist in the new repo (verify — old code imports it from `fsSecurity.ts`, not yet confirmed present in DNA-OS-INFRASTRUCTURE). TEST: unit tests for allowlist membership, denylist re-check, shell-metacharacter rejection — no process spawned yet. ROLLBACK_POINT: file is inert until executor.ts calls it. BLOCK_CONDITION: **STOP if `WORKSPACE_ROOT`/workspace-root resolution has no equivalent in the new repo** — do not invent a path convention ad hoc.
3. **Executor core** — FILES: `execution/run/executor.ts` (ported `executeDefinition`, spawn machinery, process-group kill, timeout/grace). DEPENDENCIES: step 2. TEST: real spawn of an allowlisted read-only command (e.g. workspace.pwd-equivalent) in an isolated temp cwd, assert shell:false, assert fixed argv, assert env allowlist. ROLLBACK_POINT: gate behind a feature flag / not yet wired to any route. BLOCK_CONDITION: **STOP if any test shows argv built via string concatenation or env passed unfiltered** — that would be a regression, not a port.
4. **Result normalization** — FILES: `execution/run/result.ts` (redaction, ANSI-strip, workspace-integrity diff). DEPENDENCIES: step 3; needs the real-git-status wrapper (from gitReadOnly.ts equivalent, or port it here too — see table row). TEST: fixture-based, secret patterns get redacted, ANSI stripped, workspace-changed-paths detected on a WORKSPACE_WRITE fixture. ROLLBACK_POINT: same as step 3. BLOCK_CONDITION: none beyond step 3's.
5. **Audit/evidence** — FILES: `execution/run/audit.ts`, wiring to `audit/command-audit/`. DEPENDENCIES: steps 1-4; `audit/command-audit/` capability itself is currently `NOT_YET_BUILT` per its own README — this migration may be what builds it, or it may block on a separate audit-capability build-out. TEST: assert one audit record per terminal run, written before caller sees success. ROLLBACK_POINT: audit writes can be no-op'd without breaking execution. BLOCK_CONDITION: **STOP and get an owner decision if `audit/command-audit/` has no storage backend yet** (old system used artifactRuntime.ts's in-memory Map — confirm whether the new repo wants persistent storage before porting an in-memory placeholder).
6. **Tests** — FILES: `execution/run/tests/*` (allowlist, shell-safety, timeout/cwd, output-capture — see Section 15 for full vector list). DEPENDENCIES: steps 1-5. TEST: is the test. ROLLBACK_POINT: n/a. BLOCK_CONDITION: none.
7. **Build consumer** — FILES: new `execution/build/` (thin, mirrors old buildRuntime.ts's execution-relevant slice only). DEPENDENCIES: steps 1-6 must pass parity (Section 16). TEST: `build`/`typecheck`/`lint`/`architecture.check`/`governance` commandIds succeed identically to old. ROLLBACK_POINT: old buildRuntime.ts stays live and callable until this is proven. BLOCK_CONDITION: **STOP if new executor's output for `npm run build` diverges from old** (exit code, stdout hash, duration order-of-magnitude).
8. **Test consumer** — FILES: new `execution/test/` (mirrors testRuntime.ts's execution-relevant slice). DEPENDENCIES/TEST/ROLLBACK/BLOCK: same pattern as step 7, for `ide.test`/`factory.test`/etc.
9. **Runtime entrypoint** — FILES: `control/command-router/`, `control/owner-command/` wired to call `execution/run/contract.ts#execute` for the RUN_REGISTERED_COMMAND / CHECK_ARCHITECTURE intents. DEPENDENCIES: `permissions/execution-policy/policy.ts` must exist and be wired in front of `execute()` (Section 11) — this is new work, not a port. TEST: end-to-end trace matching Section 15's parity vectors, run against the real router. ROLLBACK_POINT: old owner-command/execution routes stay live in the OLD repo throughout — nothing here touches them. BLOCK_CONDITION: **STOP if `permissions/execution-policy/` is not ready** — do not wire the router to bypass permission and call the executor directly "temporarily," since that recreates the exact collapse (identity check standing in for a real execution-permission decision) flagged as MISSING in Section 5.
10. **Retire old execution path** — FILES: none touched by this plan; listed for completeness only. DEPENDENCIES: full parity suite (Section 16) passing NEW vs OLD, owner sign-off. TEST: parity suite green. ROLLBACK_POINT: this is the point of no easy return — keep OLD repo's routes deployed and reachable until NEW has run in production long enough to trust it. BLOCK_CONDITION: **STOP — do not retire anything as part of this plan.** Retirement is explicitly out of scope; this plan produces the blueprint only.

## 15. PARITY_TEST_PLAN

Vectors to run identically against OLD_EXECUTION (`dna-os-deadboard`'s `executionRuntime.ts`) and NEW_EXECUTION (ported `execution/run/executor.ts`), expecting BEHAVIORALLY_EQUIVALENT:

1. Allowed command succeeds (`workspace.pwd` or `git.status`) — same exit code, same stdout shape.
2. Disallowed/unregistered commandId is rejected with `INVALID_COMMAND` before any spawn.
3. Shell metacharacters in a would-be dynamic arg cannot create shell behavior — assert argv array integrity, not string interpolation (both `isCommandDenied`'s pattern check and spawn's own shell:false).
4. Fixed argv is preserved byte-for-byte from registry definition to actual `spawn()` call (instrument/mock spawn to capture argv).
5. Timeout fires at `def.timeoutMs`, process group receives SIGTERM then SIGKILL after `GRACE_PERIOD_MS`, no orphaned children.
6. cwd scope enforced — process actually runs in `WORKSPACE_ROOT`-equivalent, never anything client-supplied.
7. Non-zero exit code captured and surfaced as `"failed"` with `EXECUTION_FAILED`.
8. stdout captured, redacted, ANSI-stripped, matches expected content for a fixture command.
9. stderr captured, same treatment as stdout.
10. Permission denied — a caller without the required identity/execution-permission is rejected before `execute()` runs (this vector is NEW-only for MISSING property in Section 5; OLD only has the coarser ADMIN_TIER check, so OLD's "equivalent" is `requireAuth` rejection, not a true execution-scope permission check).
11. Audit evidence emitted exactly once per terminal run, written before the caller is told of success.
12. WORKSPACE_WRITE command without `ownerConfirmation:true` is rejected with `OWNER_CONFIRMATION_REQUIRED` in both systems.
13. Output-limit truncation triggers gracefully at `maxOutputBytes`, matching `truncated`/`OUTPUT_LIMIT_REACHED` semantics.
14. READ_ONLY command that unexpectedly changes the workspace is caught by the before/after git-status diff and downgraded to failed/`WORKSPACE_POLICY_VIOLATION`, never silently passed.

## 16. OLD_FILES_RETIRE_AFTER_SUCCESS

Not retired as part of this plan (explicitly out of scope, STEP 10/BLOCK_CONDITION). Candidates once parity is proven and owner approves: `dna-os-deadboard/app/api/admin/ide/_lib/executionRegistry.ts`, `executionRuntime.ts`, and the execution-relevant slices of `queueRuntime.ts`/`commandSurfaceRuntime.ts` — but only after their route callers are repointed and the parity suite (Section 15) is green against production traffic, not just fixtures.

## 17. DUPLICATION_RISK

High if this plan is not followed: `executionRuntime.ts`'s spawn engine (551 lines) is production-grade with real, non-obvious hardening — process-group kill semantics, secret-value redaction sourced from live env at request time, before/after workspace-integrity diffing, exclusive-lock-key coordination distinct from the DB-backed `lockManager.ts` (documented in the file's own header as a deliberate, reasoned choice, not an oversight). Re-implementing any of this from scratch in DNA-OS-INFRASTRUCTURE risks silently dropping one of these properties (most likely candidates: the process-group kill, the redaction-from-live-env step, or the workspace-integrity fail-closed downgrade) without anyone noticing until an incident. Porting with the file-by-file table in Section 13 is materially lower risk than a rewrite.

## 18. OWNER_DECISIONS_REQUIRED

1. Does `permissions/execution-policy/` get built as part of this migration, or is EXECUTION temporarily gated by ADMIN_TIER-equivalent auth only (matching OLD's actual current state) until that capability is separately staffed? Section 9's block condition for migration step 9 depends on this.
2. Where does the workspace-integrity git snapshot live in the new repo — is `gitReadOnly.ts`'s pattern ported alongside, or does DNA-OS-INFRASTRUCTURE already have (or want) a single shared read-only-git utility other capabilities also use?
3. Should retry behavior be added to EXECUTION (it is MISSING_IN_OLD_IMPLEMENTATION, Section 5) or intentionally left absent, matching old behavior, with retry handled one layer up (at the job/router level) instead?
4. Does `audit/command-audit/` get a persistent backend as part of this migration, or does it start as an in-memory placeholder (matching old `artifactRuntime.ts`'s Map) with persistence deferred?
5. `factoryWorkspaceRuntime.ts`'s 3-way split (Section 8) is flagged but not resolved here — who owns designing the "orchestration" home for `runCapabilityResolution`/context-planning, since it doesn't cleanly map to `control/`, `permissions/`, or `execution/` as currently scaffolded?
6. Confirm whether BUILD (`execution/build/`) and TEST (`execution/test/`) capability folders should be built in the same migration wave as EXECUTION_CORE, or deferred to their own separate plans (this report treats them as thin future consumers per Section 9/14 but does not design their internals).

## 19. FILES_CHANGED

**0.** No file was created, edited, moved, staged, committed, pushed, or deployed by this task other than this single report at `DNA-OS-INFRASTRUCTURE/reports/EXECUTION_MIGRATION_PLAN.md`.

## 20. GIT_STATE_CHANGED

**false**, verified via `git status --porcelain=v2 --branch` in both repos before writing this report:

- `dna-os-deadboard`: pre-existing modified state (`app/admin/infrastructure/page.tsx` modified, ahead of origin/main by 34 commits) — pre-existing, not caused by this task, and unchanged by it (this task made zero writes into that repo).
- `DNA-OS-INFRASTRUCTURE`: pre-existing untracked/staged `connections/github/*` files and `reports/INFRASTRUCTURE_MIGRATION_COMPLETENESS_AUDIT.md`, plus the untracked `reports/OLD_CONTROL_PLANE_DEEP_AUDIT.md` — all present in git status at the start of this session per the harness's own git-status snapshot, none created or modified by this task. This task adds exactly one new untracked file: `reports/EXECUTION_MIGRATION_PLAN.md`.
