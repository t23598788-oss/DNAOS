# DNA OS Circuit Core — Build Report

Date: 2026-08-16

## CIRCUIT_DEFINITION_STATUS

`dna-os-circuit/definition/circuit.json` is hand-authored (not scanned/generated), matching the hard constraint. Contents:

- **10 top-level nodes**: INPUT, OWNER_COMMAND, IDENTITY, PERMISSION, COMMAND_ROUTER, EXECUTION, VALIDATOR, REGISTRY, RESULT, OWNER_UI — exactly the fixed set specified, no extras.
- **11 top-level edges**: INPUT→OWNER_COMMAND→IDENTITY→PERMISSION→COMMAND_ROUTER, then COMMAND_ROUTER fans out to EXECUTION/VALIDATOR/REGISTRY, all three converge into RESULT→OWNER_UI.
- **Sub-circuit EXECUTION**: 8 nodes (Command Descriptor, Grant Resolution, Policy Evaluation, Start Execution, Process Runtime, Output Sanitization, Integrity Check, Execution Result), 7 edges, each mapped to a real file/function in `execution/run/`.
- **Sub-circuit PERMISSION**: 9 nodes (Identity Check, Account Check, Workspace Check, Command Check, Capability Check, Action Check, CWD Scope Check, Grant Resolution, terminal ALLOW/DENY/OWNER_REVIEW), 8 edges, each mapped to the exact rule function in `permissions/execution-policy/rules.ts`.
- 5 status enum values (READY/RUNNING/PARTIAL/BLOCKED/NOT_YET_REAL) and 2 edge states (IDLE/ACTIVE), with symbols (● ◉ ○ × –) exactly as specified.

## RUNTIME_STATUS

`dna-os-circuit/runtime/circuit-state.ts`:
- Loads the full node/edge id set from `circuit.json` (top-level + both sub-circuits, flattened into one map since ids are unique repo-wide).
- `updateNode(id, status, note)` / `updateEdge(id, state, label)` — validate the id exists and the status/state is one of the declared enum values; throw `UnknownNodeError`/`UnknownEdgeError`/`InvalidStatusError` otherwise (never silently accept an invented id or status).
- No-op updates (same status + same note) emit no event — verified by test.
- `snapshot()` returns the full current state; `on("change", ...)`/`off(...)` is a small hand-rolled emitter (no `node:events` import — this repo has no `@types/node`, matching the existing `execution/run/host-runtime.ts` convention of declaring only the exact host surface needed).

## ADAPTER_STATUS

`dna-os-circuit/adapter/internal-state-adapter.ts` is the only file under `dna-os-circuit/` that imports outside it, and only from this repo's own public contracts:

| Node | Status set from | Real signal |
|---|---|---|
| INPUT | hardcoded READY | conceptual entry point, no backing file |
| OWNER_COMMAND | READY | `control/owner-command/owner-command.ts` real module exists (capability map: SOURCE_ONLY, but callable) |
| IDENTITY | **PARTIAL** | `contracts/identity/envelope-identity.ts` is type-only — no resolver/verifier module found anywhere in repo (verified by search) |
| PERMISSION | READY | `capability-registry.ts["permission-reasoner"].health_status === "CONNECTED"` |
| COMMAND_ROUTER | READY | `control/command-router/router.ts` real routing logic exists |
| EXECUTION | READY | `capability-registry.ts["execution"].health_status === "CONNECTED"` |
| VALIDATOR | **NOT_YET_REAL** | verified: no validator module or capability-registry.ts entry exists anywhere in this repo — honestly marked, not faked |
| REGISTRY | **PARTIAL** | `execution/run/registry.ts` + `capability-registry.ts` both exist but are not wired as one unified routable REGISTRY capability |
| RESULT | READY | `contracts/command/capability-result.ts` real, used contract |
| OWNER_UI | **PARTIAL** | `renderOwnerSurface` exists but no real UI/transport consumes it |

Live health checks exercised (not just static registration facts): `connections/research-engine/research-engine-adapter.ts`'s real `checkResearchEngineLiveHealth()` (a real HTTP call, offline → `EXEC_PROCESS_RUNTIME` node set BLOCKED with an honest note, never mocked) and `connections/github`'s credential-presence read (`readEnvVar(EXPECTED_GITHUB_CREDENTIAL_ENV_VAR_NAME)`).

`driveRealPermissionAndExecutionDemo()` drives one real command (`workspace.pwd`) through the real `evaluateExecutionPermission()` and real `startExecution()` — no hardcoded timers simulate progress; every status flip is triggered by an actually-awaited real function returning.

## UI_STATUS

`dna-os-circuit/ui/circuit-board/index.html` + `circuit-board.js`: a static page, Cytoscape loaded via CDN `<script>` (no npm dependency), fetches `/circuit.json` for the fixed topology, renders nodes/edges with status-colored borders and symbols, then opens `EventSource("/events")` and applies every incoming snapshot/diff live. A malformed SSE payload is caught and logged without blanking the canvas (the analogous silent-failure mode called out in the task).

## LIVE_VERIFICATION

Started `dna-os-circuit/runtime/start.ts` (plain Node `http` server, no framework) on port 8790. Drove `driveRealPermissionAndExecutionDemo()` for real (not simulated). Captured two headless-Chrome screenshots (saved under the session scratchpad, `circuit-shots/idle.png` and `circuit-shots/midflight.png`), both read back and visually confirmed non-blank:

- **idle.png**: all 10 nodes rendered with their real starting status/symbol — INPUT/OWNER_COMMAND/PERMISSION/COMMAND_ROUTER/EXECUTION/RESULT/OWNER_UI green (●), IDENTITY and REGISTRY amber (○ PARTIAL), VALIDATOR gray (– NOT_YET_REAL). All edges idle/gray.
- **midflight.png**: captured while the real demo was in flight — OWNER_COMMAND node shown RUNNING (◉, blue border), and edges INPUT→OWNER_COMMAND ("COMMAND"), OWNER_COMMAND→IDENTITY ("IDENTITY"), IDENTITY→PERMISSION ("PERMISSION"), PERMISSION→COMMAND_ROUTER ("ALLOW" — the real `ExecutionDecisionValue` from `evaluateExecutionPermission()`), COMMAND_ROUTER→EXECUTION ("RUNNING"→settling to "COMPLETED"), EXECUTION→RESULT ("COMPLETED"), RESULT→OWNER_UI ("RESPONDED") all rendered ACTIVE (blue) — proving the SSE pipeline streams real state changes from real `permissions/execution-policy` and `execution/run` calls into the rendered graph.

One implementation note: the demo's edges settle back to IDLE 1.5s after completion by design (a real, bounded `setTimeout`, not a fake progression driver) — for the mid-flight screenshot capture only, this settle delay was temporarily widened to 12s to give headless Chrome's real process-launch time enough window, then reverted to 1500ms immediately after the screenshot; `npx tsc --noEmit` and all three new test files were re-run clean after the revert to confirm no residual change.

## FILES_CREATED

```
dna-os-circuit/definition/circuit.json
dna-os-circuit/runtime/circuit-state.ts
dna-os-circuit/runtime/host-runtime.ts
dna-os-circuit/runtime/server.ts
dna-os-circuit/runtime/start.ts
dna-os-circuit/runtime/tests/circuit-state.test.ts
dna-os-circuit/runtime/tests/server.test.ts
dna-os-circuit/adapter/internal-state-adapter.ts
dna-os-circuit/adapter/tests/internal-state-adapter.test.ts
dna-os-circuit/ui/circuit-board/index.html
dna-os-circuit/ui/circuit-board/circuit-board.js
```

Modified: `tsconfig.json` (added `"resolveJsonModule": true` — required to import `circuit.json`; no other change).

## TEST_RESULTS

```
npx tsx dna-os-circuit/runtime/tests/circuit-state.test.ts        → 5/5 PASS
npx tsx dna-os-circuit/adapter/tests/internal-state-adapter.test.ts → 2/2 PASS
npx tsx dna-os-circuit/runtime/tests/server.test.ts                → 2/2 PASS
npx tsc --noEmit (whole repo)                                       → 0 errors
```

Existing repo test suites re-run after the tsconfig change, all still pass (execution/run 4 files, permissions/execution-policy 2 files, connections/github 1 file) — no regressions.

## NEXT_BLOCKERS

- No transport wires real Owner input into `submitOwnerCommand`/`routeOwnerCommand` yet (pre-existing, not addressed this round) — the circuit's OWNER_COMMAND/COMMAND_ROUTER READY status reflects "real callable module," not "reachable by a real Owner today."
- IDENTITY and VALIDATOR have zero real backing code — the circuit reports this honestly (PARTIAL / NOT_YET_REAL) rather than inventing behavior; building either is out of scope for this round.
- REGISTRY and OWNER_UI are fragmented/partial by real fact, not by adapter limitation — unifying them into single routable capabilities is future work.
- Sub-circuit drill-down UI (click-to-zoom into EXECUTION/PERMISSION) is intentionally not built — only the data exists in `circuit.json`, per the task's explicit scope stop.
- Agent-discovery / topology-growth flow, and any GitHub/Supabase/LINE/Vercel wiring beyond existing read-only health checks, are explicitly out of scope and untouched.
