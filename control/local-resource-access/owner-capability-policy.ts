/**
 * OWNER_CAPABILITY_BINDING_POLICY_V1 — extra Owner enablement on discovered bindings.
 * Default remains DENY for remote services. Absence of a policy does not disable
 * already-proven local grants (LOCAL_RESOURCE / APPLICATION invoke).
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname } from "node:path";
import { dataPath, nowIso } from "./host-runtime";
import type { AuthorityDecision, OwnerCapabilityBindingPolicyV1 } from "./types";

function policyFile(): string {
  return dataPath("owner-capability-binding.jsonl", "OWNER_CAPABILITY_BINDING_LOG");
}

export function issueOwnerCapabilityBindingPolicy(input: Omit<OwnerCapabilityBindingPolicyV1, "schema" | "policy_id" | "issued_at">): OwnerCapabilityBindingPolicyV1 {
  const row: OwnerCapabilityBindingPolicyV1 = {
    schema: "OWNER_CAPABILITY_BINDING_POLICY_V1",
    policy_id: `ocb-${randomUUID()}`,
    issued_at: nowIso(),
    ...input,
  };
  const p = policyFile();
  mkdirSync(dirname(p), { recursive: true });
  appendFileSync(p, `${JSON.stringify(row)}\n`, "utf8");
  return row;
}

export function listOwnerCapabilityBindingPolicies(): readonly OwnerCapabilityBindingPolicyV1[] {
  const p = policyFile();
  if (!existsSync(p)) return [];
  const rows: OwnerCapabilityBindingPolicyV1[] = [];
  for (const line of readFileSync(p, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try { rows.push(JSON.parse(line) as OwnerCapabilityBindingPolicyV1); } catch { /* skip */ }
  }
  return rows;
}

export function matchingCapabilityBindingPolicy(ai_identity: string, session_id: string): OwnerCapabilityBindingPolicyV1 | null {
  const now = nowIso();
  const rows = listOwnerCapabilityBindingPolicies().filter((row) =>
    row.ai_identity === ai_identity
    && row.session_id === session_id
    && (row.expires_at === null || row.expires_at > now),
  );
  return rows[rows.length - 1] ?? null;
}

export function evaluateOwnerCapabilityBinding(input: {
  readonly ai_identity: string;
  readonly session_id: string;
  readonly binding_id: string;
  readonly action: string;
  readonly remote: boolean;
}): { decision: AuthorityDecision; reason_code: string; owner_enabled: boolean } {
  const policy = matchingCapabilityBindingPolicy(input.ai_identity, input.session_id);
  if (!policy) {
    if (input.remote) return { decision: "DENY", reason_code: "REMOTE_BINDING_NOT_OWNER_ENABLED", owner_enabled: false };
    return { decision: "ALLOW", reason_code: "NO_BINDING_POLICY", owner_enabled: false };
  }
  if (policy.effect === "DENY") return { decision: "DENY", reason_code: "BINDING_POLICY_DENY", owner_enabled: false };
  const enabled = policy.enabled_binding_ids.includes(input.binding_id) || policy.enabled_binding_ids.includes("*");
  if (!enabled) return { decision: "DENY", reason_code: "BINDING_NOT_OWNER_ENABLED", owner_enabled: false };
  if (policy.allowed_actions.length > 0 && !policy.allowed_actions.includes(input.action as never) && !policy.allowed_actions.includes("*" as never)) {
    return { decision: "DENY", reason_code: "ACTION_NOT_OWNER_ENABLED", owner_enabled: false };
  }
  if (policy.approval_required_actions.includes(input.action as never)) {
    return { decision: "OWNER_APPROVAL_REQUIRED", reason_code: "OWNER_APPROVAL_REQUIRED", owner_enabled: true };
  }
  return { decision: "ALLOW", reason_code: "BINDING_OWNER_ENABLED", owner_enabled: true };
}
