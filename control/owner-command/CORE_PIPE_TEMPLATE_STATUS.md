# CORE PIPE TEMPLATE — checkpoint status (2026-08-31)

```
CORE_PIPE_TEMPLATE_PROVEN = YES
SYSTEM_ASSEMBLY_COMPLETE  = NO
```

These two are deliberately separate. The first says **one** command has been
driven end to end with real identities and real evidence. The second says
nothing of the sort is true for the system as a whole. Proving a template is
not the same as applying it, and no count of proven pipes should be read as a
percentage of system completeness.

## What CORE_PIPE_TEMPLATE_PROVEN = YES actually means

One Owner command traversed every stage with real, re-readable ids:

```
COMMAND_ID     agentproof-1788190945074
CAPABILITY_ID  capability-84f9dc65-4427-478d-8103-c42032ef4d46   (agent-host)
ROUTE_ID       route:agent-host          via explicit CAPABILITY_TO_API
RESOURCE_ID    resource-cea69029-6d83-4be1-820c-786b09d3c1b9
POLICY         ALLOW / GRANTED           evaluateExecutionPermission
WORK_ID        work-08ef78c2-5844-4ffb-aa9c-47d369d530a5
ADMISSION_ID   agent-work-admission-8a668caa-3c5b-4403-8f29-2b56691cec76
ASSIGNMENT_ID  assignment-3693debd-b3b0-4f79-812d-4c9c833e6ef7
WORKER_ID      codex:01a05876-b2d3-7501-9b42-1211664a413e
SESSION_ID     01a05876-b2d3-7501-9b42-1211664a413e   (agent-produced thread id)
EVIDENCE_ID    ev-1a2fce9f-d946-4884-a7f7-4fcaffbf4215
```

Forward and reverse traversal both resolve. Runtime was observed by the agent
itself, not asserted by a model.

The worker binding rests on a real bootstrap handshake the agent completed on
its own: `probe_task_id 66D02DEC-06AF-4BC4-964C-1A981C57C8B0`,
`probe_evidence_id 8F20852C-3985-43B2-92B4-E5DA457E2FCE`, all seven readiness
checks true. Before this, the system had **zero** successful probes in its
entire history.

## Normal Core entrypoint

`POST /command` with a `workOrder` is the real entrypoint —
`transport/owner-command-http/server.ts:328` calls it "the already-built durable
Input Gateway -> Controller -> Agent Gateway pipeline". It was driven live and
traversed every stage, producing `capability_lookup`, `admission`,
`policy_decision`, `execution_output` (worker_kind CODEX, status LAUNCHED),
`verification`, and a `continuation` decision.

That run ended `FAILED / MALFORMED_RESULT`, and that is the correct outcome: the
agent's free-text reply did not conform to `DNA_OS_AGENT_RESULT_V1`, so the
gateway **fail-closed** instead of promoting an unverified result. The pipeline
is proven; that particular instruction was not contract-shaped.

## Known gaps — none repaired in this checkpoint, by instruction

- `MATCH_METHOD: LEGACY_SUBSTRING` — `control/agent-gateway`'s own capability
  lookup still matches by substring. Same defect class as Pipe 1, different
  module. Not touched.
- `SOURCE_REVISION_UNRESOLVED` — `commit_sha` is null on 589/589 versions.
  Lineage reaches evidence but not a git revision. Never back-filled.
- 1 of 113 capabilities has an eligible worker. 10 other agent records remain
  `safe_to_assign: false` with no probe.
- 2 routes (`file-intelligence`, `dna-os-circuit`) have no canonical counterpart
  and remain deliberately unbound.
- 9,701 discovered relationships still live only in the temporary truth graph.
- Core has no HTTP endpoint that dispatches agent work *without* a WorkOrder.

## PID reuse — permanent evidence

On 2026-08-31, `worker-states.jsonl` recorded `process_id 3521` for a DNA OS
agent. At that moment `ps -p 3521` was
`/Applications/Google Drive.app/Contents/MacOS/crashpad_handler`. The OS had
recycled the PID. A binding derived from it would have attached a canonical
capability to an unrelated third-party crash handler.

This is retained as a locked regression case in
`control/owner-command/tests/core-pipe-template-invariants.test.ts`, which also
asserts that no canonical worker binding may use a bare `pid:` identity.

## Regression guard

`control/owner-command/tests/core-pipe-template-invariants.test.ts` — 29
assertions locking every pipe closed here. It reads canonical and registry data
read-only and writes nothing.
