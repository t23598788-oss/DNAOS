# control/admission/

หน้าที่: Admission — the layer between Permission/Policy Resolution and
Execute (not built this round):

```
REGISTERED ARTIFACT
  -> DESTINATION MAPPING (control/artifact-destination/)
  -> TARGET RESOLUTION (control/target-resolution/)
  -> PERMISSION/POLICY (control/permission-policy-resolution/)
  -> ADMISSION (this folder)
  -> STOP
```

Answers exactly one question: **"is this work item ready to be sent to
the target Policy already allowed?"** Single owner of that one question
— no other stage in this repo decides readiness, and this folder decides
nothing else.

## Never recomputes a prior stage

Admission takes the finished results of Classification, Duplicate
Resolution, Destination Mapping, Target Resolution, and Permission/Policy
exactly as produced — it never calls `classifyCandidate`,
`resolveDuplicate`, `resolveArtifactDestination`, `resolveTarget`, or
`resolvePolicy`. For the policy decision specifically, it does not even
trust the caller's claimed `policy_decision_id`/`policy_decision` on
their own — `./resolver.ts` independently re-reads the REAL, persisted
`PolicyResult` (the same `Evidence` row
`control/permission-policy-resolution/resolver.ts` itself wrote, `kind:
"policy_decision"`) and cross-checks the caller's claim against it. A
caller that assembled inputs from mismatched stages is caught here, not
trusted.

## The 7 readiness checks

1. `artifact_resource_id` has a real registration (`findResourceById`).
2. `resolved_target.target_status === "RESOLVED"` with a real `target_ref`.
3. The real, persisted policy decision references the same
   artifact/task as the caller's input.
4. The real policy decision is `ALLOW` (`DENY` -> `NOT_ADMITTED`,
   `REQUIRE_APPROVAL` -> `REQUIRE_APPROVAL`).
5. The task/work order still exists and is not in a terminal status
   (`COMPLETED`/`FAILED`/`BLOCKED`).
6. Required evidence is present (both the caller's own `evidence_refs`
   and the real policy decision's `evidence_refs`).
7. No other required fact is missing — any check this function cannot
   prove is `UNRESOLVED`, never guessed toward `ADMITTED`.

## Result

`AdmissionDecision` is exactly `ADMITTED | NOT_ADMITTED |
REQUIRE_APPROVAL | UNRESOLVED`. Every result is persisted as `Evidence`
(`kind: "admission"` — a literal `control/agent-gateway/types.ts`'s
`Evidence.kind` already carried, no new store, no new kind) through the
agent-gateway's existing, disk-backed evidence store — retrievable via
that folder's own `loadEvidenceForTask()`, restart-surviving.

`ADMITTED` produces exactly one thing: an `ExecutionReadyReference`
(`admission_id`, `artifact_resource_id`, `task_id`, `resolved_target`,
`authorized_action`, `policy_decision_id`, `evidence_refs`,
`correlation_id`) — a reference, never an action. Nothing in this folder
calls Git, GitHub, Vercel, a network API, or a child process; Execute
(a future round) is the only thing allowed to act on the reference.

Input: `AdmissionInput`, a real `RegistryStore`.
Output: `evaluateAdmission` -> `AdmissionResult`.
Dependency ที่อนุญาต: `../agent-gateway/contract.ts` (`getTask`,
`loadEvidenceForTask`, `saveEvidence` only),
`../../software/registry-database/contract.ts` (`findResourceById`,
`RegistryStore` only), `../target-resolution/contract.ts` (`ResolvedTarget`
type only), `../permission-policy-resolution/contract.ts`
(`PolicyDecision`/`PolicyResult` type only), `./types.ts`,
`./host-runtime.ts`.
สิ่งที่ห้ามแตะ: never call classification/duplicate/destination/target/
policy functions here. Never call a network API, git, GitHub, or a child
process. Never return `ADMITTED` from a default/fallback branch.
