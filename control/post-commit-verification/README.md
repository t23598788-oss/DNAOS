# control/post-commit-verification/

One job: given an already-succeeded Source Execution's commit SHA, answer exactly one question — "does this commit pass the build/test checks this repo itself declares are required?"

```
COMMIT SHA -> BUILD/TEST REQUIREMENT RESOLUTION -> RUN REQUIRED CHECKS
  -> COLLECT RESULTS -> BUILD/TEST DECISION -> PASS | FAIL | UNRESOLVED -> STOP
```

Never: re-classifies source, re-checks duplicates, re-maps destination, re-resolves target, re-decides policy, re-checks admission, commits/pushes, or deploys.

## Requirement resolution (`./requirement-resolution.ts`)

Deterministic, name-matched against this repo's own real `package.json` `scripts` — a fixed candidate map (`typecheck`, `test:unit`, `test:integration`, `build`), only ever required when the exact literal key exists. Today this repo declares `typecheck` and `test:integration`; no invented `unit_test`/`build` requirement.

## Execution (`./run-checks.ts`)

Reuses `execution/run/` (real process spawning, allowlisted commands) and `permissions/execution-policy/` (real ALLOW decision) — never a new shell execution engine. `execution/run/registry.ts` gained two real command descriptors this round: `npm.typecheck`, `npm.test_integration`.

## Decision (`./decision.ts`)

Pure: every required check PASSED → `VERIFIED`. Any check FAILED → `FAILED`. Missing/unresolved → `UNRESOLVED`. Never defaults to VERIFIED.

## Persistence

Every check and the final verification persist as Evidence through the existing `control/agent-gateway/` store (`kind: "post_commit_check"` / `"post_commit_verification"`) — the commit SHA is the primary reference; no new capability is ever created for a new verification.
