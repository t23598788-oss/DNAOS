/**
 * หน้าที่: `resolvePolicy()` — deterministically decides ALLOW / DENY /
 * REQUIRE_APPROVAL for one resolved artifact transition, before Admission
 * or Execute (neither built this round). No LLM, no AI reasoning, no
 * free-text policy generation — every branch below is a fixed check
 * against real, already-registered state (task store, software registry,
 * ./policy-registry.ts's data table). FAIL CLOSED ALWAYS: the only path
 * that reaches ALLOW is passing every structural check AND landing in the
 * explicit ALLOW branch of the decision table — there is no default/catch
 * -all branch that returns ALLOW.
 *
 * REGISTERED ARTIFACT -> DESTINATION MAPPING -> TARGET RESOLUTION
 *   -> PERMISSION / POLICY RESOLUTION (here)
 *   -> [ Admission -> Execute — future rounds, not built here ]
 *
 * The decision is persisted as an `Evidence` row (`kind: "policy_decision"`)
 * through the agent-gateway's own already-existing, disk-backed evidence
 * store — no new database, no separate permanent store invented here.
 *
 * Input: `PolicyResolutionInput`, a real `RegistryStore` instance.
 * Output: `resolvePolicy` -> `PolicyResult` (also persisted as evidence).
 * Dependency ที่อนุญาต: ../agent-gateway/contract.ts (getTask,
 * loadHandoffsForTask, saveEvidence — task/worker context and evidence
 * persistence only), ../../software/registry-database/contract.ts
 * (findResourceById, RegistryStore — read-only), ../command-router/contract.ts
 * (getCapability only — same reuse artifact-destination already makes),
 * ./types.ts, ./policy-registry.ts, ./host-runtime.ts.
 * สิ่งที่ห้ามแตะ: never call an LLM/AI adapter here. Never let a caller pass
 * a pre-computed `decision`. Never widen the decision table with a
 * wildcard/default ALLOW branch.
 */

import { getTask, loadHandoffsForTask, saveEvidence } from "../agent-gateway/contract";
import { findResourceById } from "../../software/registry-database/contract";
import type { RegistryStore } from "../../software/registry-database/contract";
import { getCapability } from "../command-router/contract";
import { allowedActionsFor, hasDestinationRule, isKnownAction, requiresEvidence, requiresOwnerApproval } from "./policy-registry";
import { newPolicyDecisionId, nowIso } from "./host-runtime";
import type { PolicyResolutionInput, PolicyResult } from "./types";

export interface PolicyResolutionContext {
  store: RegistryStore;
}

function deny(input: PolicyResolutionInput, reasonCode: string): PolicyResult {
  return finalize(input, "DENY", [reasonCode]);
}

function finalize(input: PolicyResolutionInput, decision: PolicyResult["decision"], reasonCodes: readonly string[]): PolicyResult {
  const result: PolicyResult = {
    policy_decision_id: newPolicyDecisionId(),
    artifact_resource_id: input.artifact_resource_id,
    source_capability_id: input.source_capability_id,
    target_capability_id: input.target_capability_id,
    requested_action: input.requested_action,
    decision,
    reason_codes: reasonCodes,
    evidence_refs: input.evidence_refs,
    task_id: input.task_id,
    correlation_id: input.correlation_id,
    created_at: nowIso(),
  };
  saveEvidence({
    evidence_id: result.policy_decision_id,
    task_id: result.task_id,
    kind: "policy_decision",
    source: "control/permission-policy-resolution",
    recorded_at: result.created_at,
    payload: result,
  });
  return result;
}

export function resolvePolicy(input: PolicyResolutionInput, context: PolicyResolutionContext): PolicyResult {
  // MINIMUM RULE 10 — unknown action -> DENY.
  if (!isKnownAction(input.requested_action)) return deny(input, "UNKNOWN_ACTION");
  const action = input.requested_action;

  // MINIMUM RULE 6 — task_id must exist.
  const task = getTask(input.task_id);
  if (!task) return deny(input, "TASK_NOT_FOUND");

  // MINIMUM RULE 7 — worker_id must match the admitted task/work context.
  // The admitted context for a WORK_ITEM task is whichever agent(s) have
  // already submitted a real handoff for this task — never a caller claim.
  const handoffs = loadHandoffsForTask(input.task_id);
  const workerAdmitted = handoffs.some((h) => h.agent_id === input.worker_id);
  if (!workerAdmitted) return deny(input, "WORKER_TASK_MISMATCH");

  // MINIMUM RULE 8 — artifact_resource_id must exist in canonical registry.
  const resource = findResourceById(input.artifact_resource_id, context.store);
  if (!resource) return deny(input, "ARTIFACT_NOT_FOUND");

  // MINIMUM RULE 11 — missing target -> DENY.
  if (!input.target_capability_id || !input.target_class) return deny(input, "TARGET_NOT_RESOLVED");

  // MINIMUM RULE 5 — target_capability_id must already be registered and
  // AVAILABLE/eligible. Reuses the same real backing this artifact's
  // target was resolved against (see
  // control/artifact-destination/destination-registry.ts): "software-registry"
  // is the registry backing itself (self-referential, available once a
  // real RESOLVED target exists); every other id must be a real,
  // currently-connected entry in command-router's own capability registry
  // — never re-derived or guessed here.
  const targetAvailable = input.target_capability_id === "software-registry" || getCapability(input.target_capability_id)?.health_status === "CONNECTED";
  if (!targetAvailable) return deny(input, "TARGET_NOT_AVAILABLE");

  // MINIMUM RULE 9 — source/target relationship must match the resolved destination.
  if (action !== "READ_SYSTEM_STATE" && !hasDestinationRule(input.artifact_resource_type, input.target_class)) {
    return deny(input, "SOURCE_TARGET_MISMATCH");
  }
  const allowed = allowedActionsFor(input.artifact_resource_type, input.target_class);
  if (!allowed.includes(action)) return deny(input, "ACTION_NOT_ALLOWED_FOR_DESTINATION");

  // MINIMUM RULE 12 — missing evidence where required -> DENY.
  if (requiresEvidence(action) && input.evidence_refs.length === 0) return deny(input, "EVIDENCE_REQUIRED");

  // MINIMUM RULE 13 — action outside the original work order scope -> DENY.
  // Only meaningful for WRITE_SOURCE against a real workspace_scope; other
  // action kinds don't touch a file path, so this check is a no-op for them.
  if (action === "WRITE_SOURCE" && task.work_order) {
    const scope = task.work_order.workspace_scope;
    if (!resource.source_location.startsWith(scope)) return deny(input, "OUTSIDE_WORK_ORDER_SCOPE");
  }

  // MINIMUM RULE 4 + 14 — system-level mutation requires owner approval.
  // (No implicit fallback ALLOW anywhere above or below this line — every
  // reachable path is an explicit DENY, an explicit REQUIRE_APPROVAL, or
  // this single explicit ALLOW branch.)
  if (requiresOwnerApproval(action)) return finalize(input, "REQUIRE_APPROVAL", ["OWNER_APPROVAL_REQUIRED"]);

  return finalize(input, "ALLOW", ["POLICY_MATCH"]);
}
