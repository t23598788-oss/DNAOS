# control/permission-policy-resolution/

หน้าที่: Permission / Policy Resolution — the layer between Target
Resolution (`control/target-resolution/`) and Admission / Execute (neither
built this round):

```
REGISTERED ARTIFACT
  -> DESTINATION MAPPING (control/artifact-destination/)
  -> TARGET RESOLUTION (control/target-resolution/)
  -> PERMISSION / POLICY RESOLUTION (this folder)
  -> [ Admission -> Execute — future rounds ]
```

For every resolved artifact target, deterministically decides **ALLOW /
DENY / REQUIRE_APPROVAL** for one `requested_action`. No LLM, no AI
reasoning, no free-text policy generation — `resolvePolicy()` is a fixed
sequence of checks against real, already-registered state
(`control/agent-gateway/`'s task/handoff store,
`software/registry-database/`'s resource lookup,
`control/command-router/`'s capability registry) followed by one plain
data-table lookup (`./policy-registry.ts`). AI/Agent code never decides
permission and can never override a decision.

## Fail-closed, always

Every one of the 15 minimum rules from the STEP that built this folder is
an explicit branch in `./resolver.ts` — there is no default/catch-all path
that returns `ALLOW`. The only way to reach `ALLOW` is passing every
structural check (known action, task exists, worker admitted on that task,
artifact exists, target resolved, target available, action valid for the
resolved destination, evidence present when required, in work-order scope)
and then landing in the one explicit `ALLOW` branch of the decision table.
System-level mutations (`REGISTER_SYSTEM_RESOURCE`, `UPDATE_SYSTEM_RESOURCE`,
`PREPARE_DEPLOYMENT`) never reach `ALLOW` even after every check passes —
they always resolve to `REQUIRE_APPROVAL`.

## Persistence

A `PolicyResult` is never a separate permanent store — it's persisted as
one `Evidence` row (`kind: "policy_decision"`) through
`control/agent-gateway/`'s already-existing, disk-backed, restart-surviving
evidence file (`control/agent-gateway/data/evidence.jsonl`), retrievable
via that folder's own `loadEvidenceForTask()`. `policy_decision_id` is the
`Evidence.evidence_id`.

Input: `PolicyResolutionInput` (`artifact_resource_id`,
`artifact_resource_type`, `source_capability_id`, `target_capability_id`,
`target_class`, `task_id`, `worker_id`, `requested_action`,
`evidence_refs`, `correlation_id`) plus a real `RegistryStore`.
Output: `PolicyResult`.
Dependency ที่อนุญาต: `../agent-gateway/contract.ts` (task/handoff/evidence
only), `../../software/registry-database/contract.ts` (`findResourceById`
only), `../command-router/contract.ts` (`getCapability` only — the same
reuse `control/artifact-destination/` already makes), `./types.ts`,
`./policy-registry.ts`, `./host-runtime.ts`.
สิ่งที่ห้ามแตะ: never call an LLM/AI adapter. Never accept a caller-supplied
`decision`. No new database, no new auth system, no execution runtime —
this folder only decides, it never acts.
