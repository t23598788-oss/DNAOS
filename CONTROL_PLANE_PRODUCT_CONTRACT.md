# DNA OS Agent Control Plane — Product Contract

Canonical infrastructure root: `/Users/tam/Desktop/DNA-OS-INFRASTRUCTURE`.
Operational Owner Console integration: `/Users/tam/Desktop/dna-os-deadboard`.

## Product boundary

The one Owner command entrypoint is the loopback server:

```text
Owner Console -> deadboard /api/infra-command -> 127.0.0.1:8791/command
             -> owner-command -> command-router -> dispatcher
             -> Agent Gateway -> policy -> shared workers
             -> task/evidence/handoff store -> Owner Console
```

The infrastructure repository stores control metadata only: task IDs,
statuses, evidence references, audit facts, and bounded artifacts. It must not
store business data, passwords, API keys, Keychain secrets, or MFA material.

The canonical cross-repository path is the authenticated Deadboard
`/api/infra-command` request to the loopback Owner Command HTTP server. The
generic `contracts/operational-bridge/` type contract is retained for future
compatibility but is explicitly `NOT_CANONICAL` and must not be cited as live
runtime evidence.

## Phase contract and evidence

| Phase | Contract | Current evidence |
|---|---|---|
| 1 Discovery | supervisor, workers, handoff, task/evidence store, OS UI | `control/agent-gateway/`, `connections/os-ui/`, `control/command-router/capability-registry.ts` |
| 2 Runtime safety | no undeclared global crypto; fail closed | `permissions/execution-policy/policy.ts`, router regression test |
| 3 Orchestration | one router/dispatcher/controller/worker path; structured handoff admission | `control/agent-gateway/controller.ts`, `handoff.ts`, `workers.ts` |
| 4 Owner visibility | persisted task/evidence/handoff status through loopback HTTP | `transport/owner-command-http/server.ts`: `/health`, `/runtime/inventory`, `/task/:taskId`, `/handoffs` |
| 5 Recovery | append-only task/evidence state, idempotency, restart recovery | `gateway.ts`, `memory-store.ts`, `tests/automation-loop.e2e.test.ts` |
| 6 Sandbox proof | success, unauthorized, out-of-scope, validator failure, worker restart | `control/agent-gateway/tests/automation-loop.e2e.test.ts` |
| 7 Product package | one serve command, registry, health, audit/evidence, setup/run docs | `package.json`, this contract, root `README.md` |

## Status model

- `VERIFIED`: real code path and evidence/test proof passed.
- `FAILED`: execution began and produced a real failure; inspect execution evidence.
- `BLOCKED`: admission, policy, missing capability, restart recovery, or
  missing external authorization stopped execution; follow `next_action`.

Handoffs require `task_id`, `agent_id`, `role`, `input_reference`, files read/
changed, tests, status, evidence references, blockers, and `next_action`.
Secret-bearing references and forbidden paths are rejected before persistence.

## Setup and run

```bash
npm install
npm run typecheck
npm run test:integration
npm run owner-command:serve
```

The server binds to `127.0.0.1:8791` by default. Use `PORT=8792` for an
isolated local verification run. The Deadboard route defaults to the same
loopback URL and may override it with `INFRA_OWNER_COMMAND_URL`.

Write/control requests require `OWNER_COMMAND_HTTP_SHARED_SECRET` on the
Infrastructure LaunchAgent and the matching
`INFRA_OWNER_COMMAND_SHARED_SECRET` on Deadboard. Missing configuration is
`BLOCKED`; it is never treated as local authentication.

Authority source-of-truth is split by boundary, not duplicated: Supabase
`requireAuth` in Deadboard authenticates the human Owner for command ingress;
the Infrastructure `ownerIdentity` is attribution only and cannot mint an
Owner command without the authenticated Deadboard transport. Computer-use
does not become a second command authority: it independently requires the
existing local human-verification session and task-scoped lease before OS
execution, which remains an execution safety boundary.

Health and evidence reads:

```bash
npm run control-plane:health
npm run control-plane:inventory
curl -fsS http://127.0.0.1:8791/handoffs
curl -fsS http://127.0.0.1:8791/task/<task_id>
```

## Credential and Keychain contract

The macOS Keychain provider is resolver-only and is not a UI autofill
capability. It may invoke the fixed native `security find-generic-password`
operation when a real authorized caller supplies a reference. It never types
secrets, dismisses prompts, changes Keychain ACLs, bypasses login/MFA, or
writes secret values to task/evidence/handoff storage. Sandbox tests inject a
dummy command runner; they do not certify native permission or a real secret.

Native Keychain resolution therefore remains `BLOCKED` until the Owner grants
the normal macOS permission and a real reference is supplied through an
authorized provider path.

## Production business-code boundary

The existing WorkOrder validator permits only `tests/__sandbox__/` writes.
`.env`, SSH material, certificate/key files, Keychain databases, business
production paths, absolute paths, and traversal are rejected. No production
business-code write is productized by this contract.
