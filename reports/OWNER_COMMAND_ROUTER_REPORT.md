# OWNER COMMAND ROUTING SURFACE — BUILD REPORT

Scope: `control/owner-command/` and `control/command-router/` in
DNA-OS-INFRASTRUCTURE, per Owner instruction 2026-08-16. Built the single
Owner command-routing surface: `OWNER → owner-command → command-router →
registered capability → result → owner-command → OWNER`. No new
repository, no dashboard/server, no specialist implementation code moved
into this repo. Nothing committed, pushed, or deployed.

---

## OWNER_COMMAND_STATUS

Built and tested. `control/owner-command/contract.ts` exports
`submitOwnerCommand` (the single public entry point), `previewOwnerCommand`
(classification preview without routing), and `renderOwnerSurface` (a
plain formatted string, not a UI). `submitOwnerCommand`:
1. rejects any `issued_by.kind !== "human"` outright,
2. builds a `CommandEnvelope`,
3. calls `../command-router/contract.ts`'s `routeOwnerCommand` — the only
   capability boundary it ever crosses,
4. derives a `CommandLifecycleState` strictly along
   `../command-status/lifecycle.ts`'s `LEGAL_TRANSITIONS` (never skips
   `evidenced` before `responded`),
5. returns one `OwnerSurfaceState` (Current Command, Current Worker,
   Current Status, Progress, Result, Evidence, Warnings, Available
   Capabilities).

No transport wires real Owner input into this yet — no CLI/HTTP entry
point was built, matching "no dashboard, no new server" and this repo's
own "no framework deps" convention.

## COMMAND_ROUTER_STATUS

Built and tested. `control/command-router/contract.ts` exports
`classifyCommand`, `routeOwnerCommand`, `listCapabilities`,
`getCapability`. Routing logic:
- keyword-set classification (AND within a set, OR across sets) —
  `OWNER_REVIEW` on genuine ambiguity, `UNSUPPORTED_COMMAND` (mapped to
  `CapabilityResult.status: "FAILED"`, `next_action: "UNSUPPORTED_COMMAND"`)
  on no match,
- a hard permission gate: any step whose capability requires
  `execution-policy` is evaluated through the REAL
  `permissions/execution-policy/contract.ts` before
  `execution/run/contract.ts` is ever touched — proven by a test that
  asserts no `"execution"`-sourced evidence exists on a DENY decision,
- multi-worker sequencing: an explicit ordered `RouterStep[]` runs in
  order, stops at the first non-`COMPLETED` step, and folds every step's
  evidence/artifacts into ONE `CapabilityResult` sharing one `task_id`.

## REGISTERED_CAPABILITIES

`control/command-router/capability-registry.ts` — 5 entries:
`file-intelligence`, `permission-reasoner`, `research-engine`,
`execution`, `github`. Each carries `capability_id`, `repo_id`,
`contract` (verified file path), `endpoint` (typed reference — never a
cross-repo import path), `supported_commands`, `match_keyword_sets`,
`permission_requirement`, `health_status`.

## CONNECTED_CAPABILITIES

- **`execution`** → `execution/run/contract.ts` (`startExecution` etc.) —
  real, tested (18/18 in `execution/run/tests/`). Router step wired.
- **`github`** → `connections/github/adapter-contract.ts` +
  `github-adapter.ts`'s `handleGithubCommand` (its one documented public
  entry) — real, read-only, tested in this repo. Router step wired,
  verified in this environment via a deterministic credential-rejection
  path (no network required/available here).
- **`permission-reasoner`** → `permissions/execution-policy/contract.ts`'s
  `evaluateExecutionPermission` — real, tested (22/22). Registered as
  `CONNECTED` after reading its contract per Owner's conditional
  instruction: this is this repo's OWN local execution-scope permission
  decision surface, explicitly NOT the external
  `DNA-LAB-PERMISSION-REASONER` repo (not present here, and not silently
  conflated with this entry — see `ARCHITECTURE_DECISIONS.md`
  §PERMISSION_REASONER).

## NOT_CONNECTED_CAPABILITIES

- **`file-intelligence`** (`DNA-LAB-FILE-INTELLIGENCE`) — repo not
  present in this checkout. No contract file, no adapter. Routing to it
  returns `BLOCKED` with a warning, never a faked result (tested).
- **`research-engine`** — no research/evaluation engine repo present.
  Same `BLOCKED`, never faked (tested).

## ROUTING_TABLE

| Owner phrase (spec example) | matches | result |
|---|---|---|
| "ตรวจ 7 repo" | `file-intelligence` | `BLOCKED` (NOT_CONNECTED) |
| "เอาผลทดลองโมเดลล่าสุด" | `research-engine` | `BLOCKED` (NOT_CONNECTED) |
| "ตรวจ permission" | `permission-reasoner` | routes to `evaluateExecutionPermission` |
| "รันคำสั่งที่อนุญาตแล้ว" | `execution` | permission-gated, then `execution/run` |
| "อ่าน GitHub repo" | `github` | routes to `handleGithubCommand` |
| ambiguous text (matches 2+ sets) | — | `OWNER_REVIEW`, router never guesses |
| unmatched text | — | `FAILED` / `next_action: "UNSUPPORTED_COMMAND"` |

Multi-worker sequencing was demonstrated end-to-end with two REAL
capabilities (`permission-reasoner` → `execution`, ALLOW decision → real
spawned process reaching `passed`) rather than the spec's own
file-intelligence-based example, because `file-intelligence`/any
`repo-tree` capability is not present in this repo — reported honestly in
`ARCHITECTURE_DECISIONS.md` §MULTI_WORKER rather than faked.

## PERMISSION_BOUNDARY

Enforced path: Owner Command → Router → `evaluateExecutionPermission`
(`permissions/execution-policy/contract.ts`) → only on `ALLOW` →
`execution/run/contract.ts`'s `startExecution` → result. No
router→executor bypass exists in `router.ts` — `runExecutionStep` is the
only call site of `startExecution` and it is structurally unreachable
without first obtaining and checking a real `ExecutionPermissionDecision`.
Tested directly (`router.test.ts`'s "permission boundary" cases, both DENY
and the multi-worker ALLOW path).

## RESULT_CONTRACT

Added `contracts/command/capability-result.ts`: `CapabilityResult` —
`task_id`, `capability_id`, `status`
(`PENDING|RUNNING|COMPLETED|BLOCKED|OWNER_REVIEW|FAILED`), `summary`,
`evidence`, `artifacts`, `warnings`, `next_action`. Both
`control/owner-command/` and `control/command-router/` import this one
definition — it is not duplicated anywhere. Kept in `contracts/command/`
alongside the existing `command-envelope.ts`/`routing-result.ts`, which
it complements rather than replaces: `RoutingResult` still answers "was
this envelope allowed to route," `CapabilityResult` answers "what
happened once it did."

## OWNER_SURFACE

`OwnerSurfaceState` (`control/owner-command/types.ts`): `current_command`,
`current_worker`, `current_status` (a `CommandLifecycleStage`),
`progress` (`PENDING|IN_PROGRESS|DONE`), `result`, `evidence`,
`warnings`, `available_capabilities` (`{capability_id, connected}[]`).
`renderOwnerSurface()` formats it as plain text — no IDE exposure, no
source code, no cross-repo file paths, no web dashboard.

## FILES_CHANGED

New:
- `contracts/command/capability-result.ts`
- `control/command-router/{types,capability-registry,router,host-runtime,contract}.ts`
- `control/command-router/README.md` (rewritten from NOT_YET_BUILT stub),
  `control/command-router/ARCHITECTURE_DECISIONS.md`
- `control/command-router/tests/router.test.ts`
- `control/owner-command/{types,owner-command,host-runtime,contract}.ts`
- `control/owner-command/README.md` (rewritten from NOT_YET_BUILT stub),
  `control/owner-command/ARCHITECTURE_DECISIONS.md`
- `control/owner-command/tests/owner-command.test.ts`
- `reports/OWNER_COMMAND_ROUTER_REPORT.md` (this file)

Nothing outside `control/`, `contracts/command/`, and this report was
touched. `execution/run/README.md` still states "no real caller exists
yet" for this folder — now stale, but left untouched per this round's
"do not touch files outside control/, contracts/command/, and
test/report files" constraint; flagged under NEXT_BLOCKERS.

## NEXT_BLOCKERS

1. **`execution/run/README.md` is now stale** — it says no real caller
   exists; `control/command-router/` is now a real caller. Updating it
   was out of scope for this round (file lives outside the allowed
   paths); a follow-up round should update it.
2. **No real transport wires Owner input in** — `submitOwnerCommand` has
   no CLI/HTTP/etc. entry point yet, by design (no dashboard/server this
   round). A future round must decide how the Owner's actual command text
   reaches this function.
3. **`file-intelligence` / `research-engine` remain unbuilt** —
   registered honestly as `NOT_CONNECTED`; connecting them requires those
   repos/contracts to exist first, which is out of scope (read-only
   toward everything outside this repo).
4. **`DNA-LAB-PERMISSION-REASONER`** (the external repo) was never
   registered as a separate capability — only this repo's own
   `execution-policy` was registered under `permission-reasoner`. If the
   external reasoner is connected later it needs its OWN `capability_id`,
   not a silent swap of this entry.
5. **execution/run status mapping is best-effort** — `startExecution`
   returns synchronously while the spawned process may still be
   `queued`/`running`; the router surfaces that honestly as `RUNNING`
   rather than blocking to wait for a terminal state. A caller that wants
   a terminal result must poll `execution/run/contract.ts`'s
   `getExecution` itself (demonstrated in `router.test.ts`).
6. **No audit/durable store** — `control/command-status/lifecycle.ts` is
   an in-memory-shaped type only; nothing persists `CommandLifecycleState`
   across process restarts yet (matches `execution/run/audit.ts`'s own
   stated NOT_YET_BUILT durable-audit gap).
