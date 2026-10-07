# control/command-router/ — Architecture Decisions

Scope: this round builds the single Owner command-routing surface using
ONLY `control/owner-command/` and `control/command-router/`, per Owner
instruction 2026-08-16. No new repository, no dashboard, no specialist
implementation code moved into this repo.

## §CAPABILITY_REGISTRY_VERIFICATION

Every `health_status` in `./capability-registry.ts` was set by reading
the actual file in this checkout, not assumed:

| capability_id | verified against | health_status | why |
|---|---|---|---|
| `file-intelligence` | (nothing — `DNA-LAB-FILE-INTELLIGENCE` is not checked out here) | `NOT_CONNECTED` | no repo, no contract file, no adapter present |
| `permission-reasoner` | `permissions/execution-policy/contract.ts` (read in full) | `CONNECTED` | see §PERMISSION_REASONER below |
| `research-engine` | (nothing) | `NOT_CONNECTED` | no repo, no contract file present |
| `execution` | `execution/run/contract.ts` (read in full — exports `startExecution`, `getExecution`, etc.) | `CONNECTED` | real, tested contract in this repo |
| `github` | `connections/github/adapter-contract.ts` + `connections/github/github-adapter.ts` (both read in full) | `CONNECTED` | real, tested adapter in this repo — `status-operations.ts`/`github-read-api.ts` confirmed read-only and real |

## §PERMISSION_REASONER

Owner's task spec allowed a conditional decision here: register
`DNA-LAB-PERMISSION-REASONER` as `NOT_CONNECTED` (it is not present in
this checkout) unless this repo's own
`permissions/execution-policy/` genuinely IS the real, callable interface
for permission decisions — verified by reading its `contract.ts` before
deciding.

Verified: `permissions/execution-policy/contract.ts` exports
`evaluateExecutionPermission`, a real, tested (22/22 passing) function
that takes a request + resolved context and returns a fully-evidenced
`ExecutionPermissionDecision` (`ALLOW`/`DENY`/`OWNER_REVIEW`) — this is a
genuine local permission-decision surface, not a stub. It answers a
narrower question ("how much EXECUTION right does this identity have for
this one command") than a general external permission reasoner might,
but it is the only real, callable permission-decision interface that
exists in this repo today.

Decision: registered `permission-reasoner` as `CONNECTED`, with
`repo_id: "DNA-OS-INFRASTRUCTURE"` (explicitly NOT the external
`DNA-LAB-PERMISSION-REASONER` repo — that remains unregistered/not
present) and `contract: "permissions/execution-policy/contract.ts"`. If
a real `DNA-LAB-PERMISSION-REASONER` repo/interface is connected later,
it should be registered as a SEPARATE capability_id, not silently
replace this one — the two answer different-shaped questions.

## §PERMISSION_BOUNDARY

Required path, enforced in `./router.ts`'s `runExecutionStep`: Owner
Command → Router → `evaluateExecutionPermission` (via
`permissions/execution-policy/contract.ts`) → only on `ALLOW` →
`execution/run/contract.ts`'s `startExecution` → real capability →
result. `DENY`/`OWNER_REVIEW` return `BLOCKED`/`OWNER_REVIEW`
`CapabilityResult`s and `startExecution` is never called — proven by
`../command-router/tests/router.test.ts`'s "permission boundary: execution
step is BLOCKED" test, which asserts no `"execution"`-sourced evidence
entry exists on the DENY path.

This mirrors `permissions/execution-policy/policy.ts`'s own stated rule:
"never call this from `../../execution/run/` or
`../../control/command-router/` yet — both are NOT_YET_BUILT" is now
satisfied for real, in the one direction the Owner spec requires
(router → policy → execution, never execution calling back into policy
or router).

## §NO_CROSS_REPO_IMPORT

Per `../../governance/architecture-rules/CAPABILITY_FOLDER_LAW.md` §9 and
`../../governance/dependency-rules/README.md` §G-DEP-003: this router
imports only from
- `../../contracts/command/` (shared contracts, zero outgoing deps)
- `../../permissions/execution-policy/contract.ts` (public contract only)
- `../../execution/run/contract.ts` (public contract only)
- `../../connections/github/github-adapter.ts` (the one documented public
  entry point of that capability folder, per its own header comment)

No file anywhere in this folder imports from a path outside this repo
(there is no such path to import — `DNA-LAB-FILE-INTELLIGENCE`,
`DNA-LAB-PERMISSION-REASONER`, and the research engine are not checked
out here), and no file imports another capability folder's PRIVATE
implementation (e.g. `connections/github/status-operations.ts`,
`execution/run/executor.ts`, `permissions/execution-policy/policy.ts` are
never imported directly — only their `contract.ts`/adapter entry point).

## §CLASSIFICATION

`classifyCommand` uses AND-within-a-set / OR-across-sets keyword
matching (`match_keyword_sets` in `./types.ts`) instead of single-keyword
matching specifically so "ตรวจ 7 repo" (file-intelligence: requires
"ตรวจ" AND "repo") does not collide with "ตรวจ permission"
(permission-reasoner: requires "ตรวจ" AND "permission") — both share the
Thai word "ตรวจ" but a single-keyword matcher would make them ambiguous
by accident, not by real intent overlap. When a command text genuinely
does satisfy two different capabilities' keyword sets, the router refuses
to guess and returns `OWNER_REVIEW` — see
`./tests/router.test.ts`'s ambiguous-match test.

## §MULTI_WORKER

`routeOwnerCommand` accepts an explicit `RouteOptions.steps` array and
runs it strictly in order, folding every step's evidence/artifacts into
ONE `CapabilityResult` (`task_id` stable across the whole sequence). The
sequence stops at the first step whose status is not `COMPLETED` — a
multi-worker command never silently skips a failed/blocked/owner-review
step to "try the next one anyway." Demonstrated end-to-end (real
`permissions/execution-policy/` decision followed by a real
`execution/run/` spawn) in
`./tests/router.test.ts`'s multi-worker test. The Owner spec's own
example ("ตรวจ repo แล้วจัดกิ่ง" → file-intelligence.audit →
repo-tree.place) could not be demonstrated with two REAL capabilities
because `file-intelligence` and any `repo-tree` capability are not
present in this repo — the mechanism is real and tested, the specific
two-step example from the spec is not, honestly reported here rather than
faked with a stub.
