# execution/run/

**หน้าที่:** สั่งรัน Software จริง (execute) หลังผ่าน
`../../permissions/execution-policy/` แล้ว

**Status (2026-08-16):** the execution CORE is built and tested —
ported from the old repo's real, proven `app/api/admin/ide/_lib/
executionRegistry.ts` + `executionRuntime.ts` (see
`../../reports/EXECUTION_MIGRATION_PLAN.md`,
`../../reports/EXECUTION_CORE_PORT_REPORT.md`). What is still
`NOT_YET_BUILT`: `../../control/command-router/` and
`../../control/owner-command/` (no real caller exists yet), and a real
`../../audit/command-audit/` store (this folder's `audit.ts` defines the
event shape + an in-memory-only default sink pending that). **Zero
public HTTP entrypoint by design this round** — `contract.ts` has no
importer outside this folder's own `tests/`.

**Input:** `ExecutionRequest` (see `types.ts`) + an already-decided
`ExecutionPermissionDecision` from
`../../permissions/execution-policy/contract.ts`. Not yet a
`CommandEnvelope` — that coupling is deferred until
`../../control/command-router/` exists and actually classifies intent.

**Output:** `ExecutionResult` (see `contract.ts`), `ExecutionEvent`
stream. Audit events recorded via `audit.ts`'s in-memory default sink
pending `../../audit/command-audit/`.

**Dependency ที่อนุญาต:** `../../permissions/execution-policy/` (type
only, for verifying an already-decided `ExecutionPermissionDecision` —
this folder never evaluates permission itself). No dependency yet on
`../../contracts/command/` or `../../connections/` — neither is needed
until the router/adapters this folder is meant to eventually serve
actually exist.

**สิ่งที่ห้ามแตะ:**
- ห้ามรันอะไรที่ยังไม่ผ่าน `../../governance/release-gate/` (not yet
  relevant — nothing calls this folder yet).
- Never call `spawn()` with an executable/argv that did not come from
  `registry.ts`'s `getCommandDescriptor()` — see `types.ts`'s header.
- Never skip permission verification — there is no code path in
  `executor.ts` that reaches a real process spawn without
  `verifyPermissionOrThrow()` having returned normally first.
- Never import from `../../control/command-router/`,
  `../../control/owner-command/`, or any `route.ts` — wiring either is
  explicitly out of scope until a separate, later round.

**Files:**
- `types.ts` — `CommandDescriptor`, `ExecutionRequest`, `ExecutionResult`,
  `ExecutionEvent`, `ExecutionErrorCode`, `ExecutionError`.
- `host-runtime.ts` — Node `child_process`/`crypto` ambient declarations
  + thin wrappers (this repo has no `@types/node`). Private.
- `registry.ts` — the allowlisted-command model, ported from the old
  repo. Only 4 real, generic commands registered today (`workspace.pwd`,
  `workspace.list`, and two test-only diagnostics — see its header for
  why the old repo's 9 repo-specific `npm run` commands were NOT ported).
  Private.
- `result.ts` — output sanitization (ANSI-strip, secret-redact) +
  terminal-status mapping. Private.
- `audit.ts` — `ExecutionAuditEvent` contract + in-memory default sink.
  Private.
- `executor.ts` — the core: permission verification, spawn, timeout,
  concurrency/locking, workspace-integrity check. Private.
- `contract.ts` — **the only file a caller outside this folder may
  import.**
- `tests/executor.test.ts` — end-to-end, real-process tests through
  `contract.ts` (18/18 passing as of 2026-08-16).
- `tests/result.test.ts` — focused unit tests for `result.ts`'s pure
  sanitization functions (11/11 passing as of 2026-08-16).

Run: `npx tsx execution/run/tests/executor.test.ts && npx tsx
execution/run/tests/result.test.ts`
