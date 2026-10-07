/**
 * OWNER_MACHINE_POLICY_V1 — extra Owner constraint on top of grants. Default remains DENY.
 * Absence of a policy does not grant access; it only means grants are the sole allow path.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname } from "node:path";
import { dataPath, nowIso } from "./host-runtime";
import type { AccessClass, AuthorityDecision, LocalCapabilityName, OwnerMachinePolicyV1 } from "./types";

function policyFile(): string {
  return dataPath("owner-machine-policy.jsonl", "OWNER_MACHINE_POLICY_LOG");
}

export function issueOwnerMachinePolicy(input: Omit<OwnerMachinePolicyV1, "schema" | "policy_id" | "issued_at">): OwnerMachinePolicyV1 {
  const row: OwnerMachinePolicyV1 = {
    schema: "OWNER_MACHINE_POLICY_V1",
    policy_id: `omp-${randomUUID()}`,
    issued_at: nowIso(),
    ...input,
  };
  const p = policyFile();
  mkdirSync(dirname(p), { recursive: true });
  appendFileSync(p, `${JSON.stringify(row)}\n`, "utf8");
  return row;
}

export function listOwnerMachinePolicies(): readonly OwnerMachinePolicyV1[] {
  const p = policyFile();
  if (!existsSync(p)) return [];
  const rows: OwnerMachinePolicyV1[] = [];
  for (const line of readFileSync(p, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try { rows.push(JSON.parse(line) as OwnerMachinePolicyV1); } catch { /* skip */ }
  }
  return rows;
}

export function matchingMachinePolicy(ai_identity: string, session_id: string): OwnerMachinePolicyV1 | null {
  const now = nowIso();
  const rows = listOwnerMachinePolicies().filter((row) =>
    row.ai_identity === ai_identity
    && row.session_id === session_id
    && (row.expires_at === null || row.expires_at > now),
  );
  return rows[rows.length - 1] ?? null;
}

export function evaluateOwnerMachinePolicy(input: {
  readonly ai_identity: string;
  readonly session_id: string;
  readonly resource_id: string;
  readonly capability: LocalCapabilityName;
  readonly access: AccessClass;
  readonly network_egress: string;
  readonly application_action_id?: string;
}): { decision: AuthorityDecision; reason_code: string } {
  const policy = matchingMachinePolicy(input.ai_identity, input.session_id);
  if (!policy) return { decision: "ALLOW", reason_code: "NO_MACHINE_POLICY" };
  if (policy.effect === "DENY") return { decision: "DENY", reason_code: "MACHINE_POLICY_DENY" };
  if (policy.visible_resource_ids.length > 0 && !policy.visible_resource_ids.includes(input.resource_id) && !policy.visible_resource_ids.includes("*")) {
    return { decision: "DENY", reason_code: "RESOURCE_NOT_VISIBLE" };
  }
  if (policy.read_only_capabilities.includes(input.capability) && input.access !== "READ") {
    return { decision: "DENY", reason_code: "READ_ONLY_CAPABILITY" };
  }
  if (policy.approval_required_capabilities.includes(input.capability)) {
    return { decision: "OWNER_APPROVAL_REQUIRED", reason_code: "OWNER_APPROVAL_REQUIRED" };
  }
  if (policy.local_only_resource_ids.includes(input.resource_id) && input.network_egress !== "LOCAL_ONLY") {
    return { decision: "DENY", reason_code: "LOCAL_ONLY_RESOURCE" };
  }
  if (input.network_egress !== "LOCAL_ONLY" && policy.allowed_network_destinations.length > 0 && !policy.allowed_network_destinations.includes("none") && !policy.allowed_network_destinations.includes(input.network_egress)) {
    return { decision: "DENY", reason_code: "NETWORK_DESTINATION_DENIED" };
  }
  if (input.application_action_id && policy.enabled_application_actions.length > 0 && !policy.enabled_application_actions.includes(input.application_action_id)) {
    return { decision: "DENY", reason_code: "APPLICATION_ACTION_NOT_ENABLED" };
  }
  return { decision: policy.effect, reason_code: "MACHINE_POLICY_ALLOW" };
}
