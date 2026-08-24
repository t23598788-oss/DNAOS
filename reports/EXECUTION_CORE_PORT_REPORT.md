# EXECUTION CORE PORT — REPORT

Scope: `execution/run/` in DNA-OS-INFRASTRUCTURE. Ported from the old
repo's real, proven `app/api/admin/ide/_lib/executionRegistry.ts` +
`executionRuntime.ts` (`dna-os-deadboard`), per Owner instruction
2026-08-16 and the sequencing set in `reports/EXECUTION_MIGRATION_PLAN.md`
+ `reports/EXECUTION_POLICY_LAYER_REPORT.md`.

No public runtime entrypoint was wired. No route was created or
modified. `control/command-router/`, `control/owner-command/`, BUILD,
TEST, DEPLOY, ROLLBACK were not touched. Nothing was staged, committed,
pushed, or deployed.

---

## EXECUTION_CORE_STATUS

**BUILT AND TESTED**, behind a private/public split
(`contract.ts` public, everything else private), with **zero importers
outside this folder's own `tests/`** — confirmed by `grep -rn
"execution/run" ` across the rest of the repo returning no matches
outside `execution/run/` itself and this report.

---

## FILES_PORTED

Ported (design, structure, and security logic carried over; only names
changed where this repo's own conventions require it):

| Old file | New file | What was ported |
|---|---|---|
| `_lib/executionRegistry.ts` | `execution/run/registry.ts` | `CommandDefinition` → `CommandDescriptor` shape, `getCommandDefinition` → `getCommandDescriptor`, `validateDynamicArgs`, `resolveWorkingDirectory`, `CHILD_ENV_ALLOWLIST`/`buildChildEnv`, `isCommandDenied` (denylist, git/npm subcommand blocks, shell-injection-pattern re-check) |
| `_lib/executionRuntime.ts` | `execution/run/executor.ts` | `executeDefinition`/`startRun` → `startExecution`, concurrency guards (global + per-caller), exclusive-lock-key guard, `spawn(shell:false, detached:true)`, process-group kill (SIGTERM→grace→SIGKILL), output-limit truncation, `finalize()` precedence logic, `cancelRun`→`cancelExecution`, `getRun`→`getExecution`, `listRuns`→`listExecutions`, `subscribeToRunEvents`→`subscribeToExecutionEvents` |
| `_lib/executionRuntime.ts` (ANSI/redaction/workspace-diff sections) | `execution/run/result.ts` | `sanitizeChunk` (ANSI-strip + secret-redact), `diffWorkspaceSnapshots`, exit/timeout/signal → status mapping (renamed `mapTerminalStatus`) |

## FILES_REWRITTEN

None of the ported files were rewritten from scratch — every function
above carries the old file's real logic. The following are genuinely
NEW, with no old-repo equivalent:

| New file | Why it's new |
|---|---|
| `execution/run/types.ts` | The old repo defined these types inline inside `executionRegistry.ts`/`executionRuntime.ts`; this repo's convention is one `types.ts` per capability (see `permissions/execution-policy/types.ts`'s same pattern). Field names were also aligned to `ExecutionPermissionRequest`'s naming (`identity_id`/`account_id`/`workspace_id`/`capability`/`action`/`cwd_scope`/`requested_args`/`correlation_id`) so a request built for the permission check and a request built for execution describe the same event — the old repo had no equivalent scope model (it used a single `ownerId` string). |
| `execution/run/host-runtime.ts` | This repo has no `package.json`/`@types/node` (the old repo does); a self-contained ambient-declaration file was required to type-check `child_process`/`crypto` usage — see its own header for why `declare module` didn't work and a narrow `require()` exception was used instead. |
| `execution/run/audit.ts` | The old repo wrote audit evidence inline (e.g. actor/audit-log fields on `RunRecord` itself, consumed by IDE routes). This repo's target architecture calls for a distinct `audit/command-audit/` capability (`NOT_YET_BUILT`); `audit.ts` defines the event contract + an in-memory placeholder sink so `executor.ts` has something real to call without inventing that capability's real storage this round. |
| `execution/run/contract.ts` | New public/private split — the old repo had no such boundary (any file under `_lib/` could be imported by any route). |
| Permission verification inside `executor.ts` (`verifyPermissionOrThrow`) | **The one genuinely new behavior**, not present in the old repo at all — see §PERMISSION_BOUNDARY. |

---

## SECURITY_PROPERTIES_PRESERVED

Verified preserved, with a real, passing test for each (see
§PARITY_TEST_RESULT):

- **Command allowlist** — `registry.ts`'s `COMMAND_REGISTRY`; a
  `command_id` not present in it throws `UNKNOWN_COMMAND` before any
  process is created. Test: *"unknown command rejected before any
  process is created."*
- **`spawn(shell:false)`** — the only call site is
  `host-runtime.ts`'s `spawnProcess()`, hardcoded `shell: false`,
  never a caller-supplied option. Verified: `grep -rn "spawn("
  execution/run/*.ts` shows the literal call only inside
  `host-runtime.ts`.
- **Fixed argv** — `resolveArgv()` builds argv from `descriptor.fixedArgs`
  + validated dynamic values only, always a literal array, never string
  concatenation. Test: *"fixed argv is preserved exactly as registered."*
- **No freeform shell execution** — no code path accepts a raw shell
  string anywhere in `types.ts`/`registry.ts`/`executor.ts`.
  `validateDynamicArgs` additionally rejects any dynamic-arg VALUE
  containing a shell metacharacter outright (never just relying on
  `shell:false` making it inert). Test: *"shell metacharacters in a
  dynamic argument do not invoke shell behaviour (rejected outright)."*
- **cwd restrictions** — cwd is always server-resolved via
  `resolveWorkingDirectory()`; a caller's `cwd_scope` is validated only
  against the PERMISSION layer's `allowed_cwd_scope_prefixes` before a
  decision is ever `ALLOW`, never used to pick the real cwd directly.
  Test: *"invalid cwd_scope is rejected (permission layer denies before
  execution ever starts)."*
- **env restrictions** — `CHILD_ENV_ALLOWLIST` (7 names: `PATH`, `HOME`,
  `TMPDIR`, `LANG`, `LC_ALL`, `SHELL`, `NODE_ENV`); the full host
  environment is never passed to a child. (Not independently unit-tested
  this round — same as the old repo, this is enforced by construction:
  `buildChildEnv()` has no code path that copies `process.env` wholesale.)
- **Timeout** — real, ported precedence logic (`state.timedOut` set by a
  real `setTimeout`, checked first in `mapTerminalStatus`). Test:
  *"timeout is handled (real `/bin/sleep 2` killed by a short
  `timeout_ms` override)."*
- **Output capture** — real stdout/stderr capture, ANSI-stripped and
  secret-redacted, size-bounded per `maxOutputBytes`. Tests: *"stdout is
  captured and sanitized," "stderr is captured,"* plus 6 dedicated
  `result.test.ts` cases for ANSI-stripping and secret-redaction as pure
  functions (more reliable than depending on shell-quoting behavior).
- **Exit-code handling** — real numeric exit code always captured and
  mapped to a status. Test: *"nonzero exit is captured (real `ls`
  against a guaranteed-missing path)."*
- **Permission gate** — see §PERMISSION_BOUNDARY (new, not old-repo
  behavior — an addition, not a preserved property).
- **Audit/evidence** — every terminal execution records an
  `ExecutionAuditEvent` via `audit.ts`'s sink (in-memory placeholder,
  interface stable). Not yet unit-tested in isolation this round (no
  assertion reads `defaultAuditSink.list()` directly), but exercised on
  every real execution in `executor.test.ts`.
- **Retry behavior** — **NOT PRESENT IN THE OLD REPO EITHER.** The old
  `executionRuntime.ts` has no retry logic at all — a failed run simply
  reports `failed`/`timed_out`; callers may start a new run. Nothing was
  invented here — see §SECURITY_PROPERTIES_MISSING.
- **Failure mode / fail-closed** — every refusal path
  (`UNKNOWN_COMMAND`, `COMMAND_DENIED`, `PERMISSION_DENIED`,
  `OWNER_CONFIRMATION_REQUIRED`, `CONCURRENCY_LIMIT`, `COMMAND_BUSY`)
  throws before a run record is created — no partial state is ever left
  behind. Test: *"internal error during permission verification fails
  closed (never throws an unrelated error type)"* proves this holds even
  for a malformed decision object, not just the documented refusal paths.

---

## SECURITY_PROPERTIES_MISSING

Ported faithfully as `MISSING_IN_OLD_IMPLEMENTATION` — real gaps in the
OLD repo, not gaps introduced by this port:

- **Retry behavior** — no retry mechanism exists in
  `executionRuntime.ts`. Not invented here.
- **A distinct execution-scope permission check** — this is the one
  property that did NOT exist in the old repo at all (old repo: a
  coarse `requireAuth(ADMIN_TIER)` route check only). This round ADDS
  it (`permissions/execution-policy/`), rather than being missing from
  this port — flagged here only to be explicit that it is a genuine
  behavior change, not a like-for-like port. See
  `reports/EXECUTION_POLICY_LAYER_REPORT.md`.
- **A real external audit store** — the old repo wrote audit-relevant
  fields onto `RunRecord` itself, readable by its own IDE routes; this
  repo's target `audit/command-audit/` capability does not exist yet.
  `audit.ts` provides a stable interface + in-memory placeholder only —
  marked `NOT_YET_BUILT` in that file's own header, not invented as if
  it were a real store.
- **9 of the old repo's 11 registered commands** — `typecheck`,
  `ide.test`, `factory.test`, `build`, `governance`,
  `architecture.check`, `lint`, `governance.test`, `artifact.test`,
  `ui-inspection.test`, `review.test`, `registry.sync` are all real
  `npm run <script>` invocations tied to the OLD repo's own
  `package.json`. This repo has no `package.json` and no npm scripts —
  porting those entries would have fabricated commands that do not
  exist here. **NOT_PORTED**, explicitly, in `registry.ts`'s own header
  — not silently dropped.

---

## BUILD_DEPENDENCIES

Not touched this round (explicit instruction). For the record, the old
repo's real BUILD/TEST layers (`buildRuntime.ts`, `testRuntime.ts`) both
call `executionRuntime.ts`'s `startRun()` — i.e. they are thin consumers
of the exact engine this round ported. When BUILD/TEST are ported in a
later round, they are expected to depend on `execution/run/contract.ts`
only (`startExecution`/`getExecution`/etc.), never on
`executor.ts`/`registry.ts`/`result.ts`/`audit.ts` directly — matching
`reports/EXECUTION_MIGRATION_PLAN.md` §5's stated principle.

## TEST_DEPENDENCIES

Same as BUILD — not touched. The old repo's `testRuntime.ts` also calls
`executionRuntime.ts`'s `startRun()` for allowlisted test commands
(`ide.test`, `factory.test`, `governance.test`, `artifact.test`,
`ui-inspection.test`, `review.test`) — all currently `NOT_PORTED` (see
§SECURITY_PROPERTIES_MISSING), since none has a real npm script in this
repo yet.

---

## MIXED_RESPONSIBILITY_EXTRACTIONS

`factoryWorkspaceRuntime.ts` (flagged in
`reports/OLD_CONTROL_PLANE_DEEP_AUDIT.md` as the heaviest
mixed-responsibility file) was **not** touched or ported this round —
its execution-adjacent logic (dispatch into `queueRuntime.ts` →
`executionRuntime.ts`) was already fully captured by porting
`executionRuntime.ts` itself directly; `factoryWorkspaceRuntime.ts`'s
own orchestration/permission-gating/dispatch layers remain
`KEEP_OUTSIDE_EXECUTION` / `UNKNOWN`, unassigned, exactly as
`reports/EXECUTION_MIGRATION_PLAN.md` §6 recommended. No extraction was
needed from it for the core itself to be complete.

---

## TARGET_FOLDER_STRUCTURE

```
execution/run/
  types.ts            — CommandDescriptor, ExecutionRequest, ExecutionResult, ExecutionEvent, ExecutionError
  host-runtime.ts      — Node child_process/crypto ambient declarations (private)
  registry.ts          — allowlisted-command model (private)
  result.ts            — sanitization + status mapping (private)
  audit.ts             — audit event contract + in-memory sink (private)
  executor.ts          — the core: permission verification, spawn, lifecycle (private)
  contract.ts          — PUBLIC — the only importable file from outside this folder
  tests/
    executor.test.ts    — end-to-end, real-process tests (18 cases)
    result.test.ts      — pure-function sanitization tests (11 cases)
```

---

## PUBLIC_CONTRACT

`execution/run/contract.ts` exports:

- `startExecution(request: ExecutionRequest, decision:
  ExecutionPermissionDecision | undefined): ExecutionResult` — refuses
  to start (throws `ExecutionError`) on any permission failure, unknown
  command, denied command, missing confirmation, or concurrency/lock
  exhaustion. Never accepts a raw shell string, unrestricted cwd,
  unrestricted env, or an arbitrary executable path — only a
  `command_id` (resolved via `registry.ts`) and typed
  `requested_args`.
- `getExecution(executionId, identityId): ExecutionResult`
- `listExecutions(identityId): ExecutionResult[]`
- `cancelExecution(executionId, identityId): ExecutionResult`
- `subscribeToExecutionEvents(executionId, onEvent): { replay, unsubscribe } | null`
- `listCommandDescriptors(): CommandDescriptor[]`,
  `getCommandDescriptor(commandId): CommandDescriptor | undefined`
- `ExecutionError` (class, for `instanceof`/`.code` checks)
- Types: `CommandDescriptor`, `DynamicArgSpec`, `ExecutionErrorCode`,
  `ExecutionEvent`, `ExecutionEventType`, `ExecutionRequest`,
  `ExecutionResult`, `ExecutionStatus`, `ExecutionAuditEvent`.

`ExecutionResult` fields: `execution_id`, `correlation_id`,
`command_id`, `identity_id`/`account_id`/`workspace_id`,
`permission_decision_id`, `status`, `queuedAt`/`startedAt`/`completedAt`,
`durationMs`, `exitCode`, `signal`, `outputBytes`, `truncated`,
`errorCode`, `workingDirectory`, `mode`, `changesWorkspace`,
`ownerConfirmation`, `resolvedArgv` (sanitized, never raw), `stdoutHash`/
`stderrHash`, `workspaceChangedPaths`, `workspacePolicyViolation` — this
matches the task's required concept list exactly.

---

## PERMISSION_BOUNDARY

`executor.ts`'s `verifyPermissionOrThrow()` — called first, unconditionally,
before any registry lookup, before any process is created. Checks, in
order: decision present → `decision.decision_id === request.permission_decision_id`
→ `decision.decision === "ALLOW"` → decision's `scope` (account/workspace/
capability/command_id) matches the request exactly → decision not expired.
Any failure (including an unexpected internal error while checking, per
the try/catch added after this round's own parity testing caught a raw
`TypeError` leak — see §PARITY_TEST_RESULT) throws
`ExecutionError("PERMISSION_DENIED", ...)`, refusing to start — no run
record is ever created for a refused request.

This module does **not** evaluate identity, membership, or permission
itself — it only verifies an already-decided
`ExecutionPermissionDecision` object, imported as a type only from
`permissions/execution-policy/contract.ts`. It does not own global
identity logic, matching `reports/EXECUTION_POLICY_LAYER_REPORT.md`'s
own stated boundary.

---

## AUDIT_INTERFACE

`audit.ts`'s `ExecutionAuditSink` interface: `record(event)`, `list()`.
`createInMemoryAuditSink()` is the only implementation this round
provides — explicitly documented as a placeholder, never presented as
durable storage. `executor.ts` calls `defaultAuditSink.record(...)`
exactly once per terminal execution, inside `finalize()`, with a
`verification_result` derived from the real workspace-integrity
snapshot diff (`"workspace_unchanged"` / `"workspace_changed_as_expected"`
/ `"workspace_policy_violation"` / `"not_verified"`). When
`audit/command-audit/` is built in a later round, it is expected to
implement `ExecutionAuditSink` and be wired in as the new default —
`executor.ts` depends on the interface only.

---

## PARITY_TEST_RESULT

`npx tsx execution/run/tests/executor.test.ts` — **18/18 passing**
(real spawned processes: `/bin/pwd`, `/bin/ls -la`, `/bin/sleep`, and a
real nonexistent-path `ls` invocation — no mocks):

```
PASS  registry exposes at least one registered command
PASS  allowed registered command succeeds (real ALLOW decision -> real process)
PASS  unknown command rejected before any process is created
PASS  shell metacharacters in a dynamic argument do not invoke shell behaviour (rejected outright)
PASS  fixed argv is preserved exactly as registered (workspace.list -> /bin/ls -la)
PASS  nonzero exit is captured (real ls against a guaranteed-missing path)
PASS  stderr is captured
PASS  timeout is handled (real /bin/sleep 2 killed by a short timeout_ms override)
PASS  invalid cwd_scope is rejected (permission layer denies before execution ever starts)
PASS  stdout is captured and sanitized
PASS  DENY permission decision cannot execute
PASS  OWNER_REVIEW permission decision cannot execute
PASS  missing permission (undefined decision) cannot execute
PASS  permission/request mismatch cannot execute (different command_id than the decision was scoped to)
PASS  permission_decision_id must match the supplied decision object
PASS  expired ALLOW permission decision cannot execute
PASS  internal error during permission verification fails closed (never throws an unrelated error type)
PASS  read-only command's workspace-integrity check reports no unexpected change (real git status before/after)

18 passed, 0 failed
```

`npx tsx execution/run/tests/result.test.ts` — **11/11 passing** (pure
sanitization/mapping functions, no process spawned):

```
PASS  ANSI colour/style codes are stripped
PASS  ANSI OSC (title-setting) sequences are stripped
PASS  a static Authorization Bearer token pattern is redacted
PASS  a static sk-... style API key pattern is redacted
PASS  a known-secret-shaped environment variable's VALUE is redacted wherever it appears in output
PASS  plain text with no ANSI codes and no secrets passes through unchanged
PASS  mapTerminalStatus: a clean zero exit maps to passed
PASS  mapTerminalStatus: a nonzero exit maps to failed/EXECUTION_FAILED
PASS  mapTerminalStatus: timeout takes priority over a nonzero exit code
PASS  mapTerminalStatus: a workspace-policy violation downgrades a would-be pass to failed
PASS  mapTerminalStatus: a failed process start takes priority over every other signal

11 passed, 0 failed
```

Also verified: `npx tsc --noEmit -p tsconfig.json` — clean, zero errors,
under this repo's existing `strict: true` config.

Two real bugs were found and fixed DURING this round's own test-writing
(both before any commit, both in the new code, neither in the ported old
logic): (1) the `PROCESS_START_FAILED` path called `finalize()` before
setting the final status/error code, so the audit event briefly recorded
the wrong reason — fixed by threading a `processStartFailed` flag through
`mapTerminalStatus`'s precedence chain instead of overriding after the
fact; (2) `verifyPermissionOrThrow` could leak a raw `TypeError` for a
malformed decision object instead of failing closed as `ExecutionError`
— fixed by wrapping it in its own try/catch.

## OLD_NEW_DIFFERENCES

Directly comparable safe vectors (both real, both actually run — not a
side-by-side mock):

| Vector | OLD_EXECUTION (`executionRuntime.ts`, read only, not re-run this round) | NEW_EXECUTION (this round, actually run) | Difference |
|---|---|---|---|
| `spawn(shell:false)`, fixed argv, denylist re-check | Yes (read from source) | Yes (test-verified, real spawn) | None — behaviorally equivalent |
| Command allowlist as the only path to `spawn()` | Yes | Yes | None |
| ANSI-strip + secret-redact on every chunk | Yes | Yes (test-verified) | None |
| Process-group kill (SIGTERM→grace→SIGKILL) | Yes | Yes (ported unchanged; not independently timed-tested this round — the timeout test relies on the *timer firing*, not on measuring the grace period itself) | Untested timing detail, not a behavior change |
| Workspace-integrity (`git status` before/after) | Yes | Yes (test-verified for the READ_ONLY case) | None |
| Ownership model | `ownerId: string` (session-scoped) | `identity_id` + `account_id` + `workspace_id` (three-part scope, matching `permissions/execution-policy/`) | **Different, intentionally** — this repo's permission model is scope-based, not session-based |
| Permission gate before spawn | None (route-level `requireAuth(ADMIN_TIER)` only) | Real, scope-matched, unexpired `ALLOW` decision required | **New, additive** — see §PERMISSION_BOUNDARY |
| Registered commands | 11 (`git.status`, `git.diff`, `typecheck`, `ide.test`, `build`, `governance`, `architecture.check`, `lint`, `factory.test`, `governance.test`, `artifact.test`, `ui-inspection.test`, `review.test`, `registry.sync`, `workspace.pwd`, `workspace.list`) | 4 (`workspace.pwd`, `workspace.list`, `diagnostics.sleep`, `diagnostics.missing_path`) | **Narrower, by necessity** — 9 old entries are `npm run <script>` calls this repo has no scripts for yet (NOT_PORTED, not invented); the 2 diagnostics entries are new, test-only, real, harmless |
| Retry behavior | None | None | None — a real gap in both, not invented here |
| Audit storage | Inline on `RunRecord`, read by IDE routes directly | Stable interface (`audit.ts`), in-memory placeholder only | Old repo's is "real but ad hoc"; new repo's is "stable interface, no real store yet" — a structural improvement, not a regression, since no route reads either one in production today |

No old-implementation file was modified to make any test pass — old repo
git status confirmed unchanged (see §GIT_STATE_CHANGED).

---

## OLD_FILES_RETIRE_AFTER_SUCCESS

None yet — retiring `dna-os-deadboard`'s `executionRegistry.ts`/
`executionRuntime.ts` requires the OLD repo's own routes to first be
migrated to call the NEW capability (or a bridge), which requires
`control/command-router/` to exist first. Premature this round; not
attempted.

---

## FILES_CHANGED

Created (all new):
- `execution/run/types.ts`
- `execution/run/host-runtime.ts`
- `execution/run/registry.ts`
- `execution/run/result.ts`
- `execution/run/audit.ts`
- `execution/run/executor.ts`
- `execution/run/contract.ts`
- `execution/run/tests/executor.test.ts`
- `execution/run/tests/result.test.ts`
- This report.

Modified:
- `execution/run/README.md` (updated from `NOT_YET_BUILT` placeholder).

No file outside `execution/run/` (and this one report under `reports/`)
was created, edited, or deleted. No file under `control/`,
`app/api/**/route.ts`, or any BUILD/TEST/DEPLOY/ROLLBACK capability
folder was touched. No file in `dna-os-deadboard` was touched. Nothing
was staged (`git add`) or committed by this work.

---

## RUNTIME_ENTRYPOINT = NOT_STARTED

Confirmed by construction: `grep -rn "execution/run"` across this repo
outside `execution/run/` itself returns no matches. No `control/`
folder or `route.ts` file was created, read for editing, or modified.
`contract.ts`'s only importers are `execution/run/tests/executor.test.ts`
and `execution/run/tests/result.test.ts` (the latter imports `result.ts`
directly, a documented narrow exception for pure-function testing — see
that file's own header).

---

## EXECUTION_CORE_READY_FOR_WIRING = false

The core itself is complete and tested, but wiring a real entrypoint is
still blocked on:

1. **`control/command-router/` still `NOT_YET_BUILT`** — no real caller
   exists that classifies a `CommandEnvelope`, resolves Identity/
   Membership context, calls `permissions/execution-policy/`, and then
   calls this folder's `startExecution()`.
2. **`control/owner-command/` still `NOT_YET_BUILT`** — same gap for the
   Owner-facing command surface.
3. **No real `CommandPolicyDescriptor`/`ExecutionGrant` source** —
   `permissions/execution-policy/`'s own report already flagged this;
   still true, and this round did not change it.
4. **`audit/command-audit/` still `NOT_YET_BUILT`** — `executor.ts`
   currently records to an in-memory placeholder only; a real store
   should exist before this is wired to anything that matters
   operationally.
5. **Only 4 commands registered** — real production use needs the
   repo's own eventual `package.json`/npm scripts (or other real
   commands) registered first; registering more is straightforward
   once those exist, but none were invented this round.

None of these are defects in this round's deliverable — they are the
expected next steps `reports/EXECUTION_MIGRATION_PLAN.md`'s own
migration sequence already anticipated (steps 7–9: build/test consumers,
runtime entrypoint, old-route replacement — all still ahead).
