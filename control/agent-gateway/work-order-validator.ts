import type { WorkOrder } from "./types";

export interface ValidationResult {
  ok: boolean;
  reason_codes: string[];
  evidence: { source: string; note: string }[];
}

// Sandbox is deliberately outside every registered production capability
// folder, so the existing Write Gate can prove this is a new test artifact.
const SANDBOX_ROOT = "tests/__sandbox__/";
const FORBIDDEN_PREFIXES = [
  ".env",
  "supabase/migrations/",
  "app/business/",
  "engines/business",
  "production/",
];

export function validateWorkOrder(workOrder: WorkOrder): ValidationResult {
  const evidence = [{ source: "control/agent-gateway/work-order-validator.ts", note: "deterministic validation started" }];
  const reasons: string[] = [];
  if (workOrder.mode !== "sandbox") reasons.push("MODE_NOT_SANDBOX");
  if (!workOrder.target_path.startsWith(SANDBOX_ROOT)) reasons.push("OUT_OF_SANDBOX_SCOPE");
  if (workOrder.target_path.includes("..") || workOrder.target_path.startsWith("/")) reasons.push("PATH_TRAVERSAL");
  if (FORBIDDEN_PREFIXES.some((prefix) => workOrder.target_path.startsWith(prefix))) reasons.push("FORBIDDEN_PRODUCTION_FILE");
  if (!workOrder.workspace_scope || !workOrder.target_path.startsWith(workOrder.workspace_scope)) reasons.push("WORKSPACE_SCOPE_MISMATCH");
  if (!workOrder.content || workOrder.content.length > 1_000_000) reasons.push("CONTENT_INVALID");
  if (!workOrder.requested_change.trim()) reasons.push("MISSING_CHANGE_DESCRIPTION");
  if (workOrder.required_tests.length === 0) reasons.push("NO_REQUIRED_TESTS");
  if (workOrder.evidence.length === 0) reasons.push("NO_EVIDENCE");
  evidence.push({ source: "control/agent-gateway/work-order-validator.ts", note: `scope=${workOrder.workspace_scope} target=${workOrder.target_path}` });
  return { ok: reasons.length === 0, reason_codes: reasons, evidence };
}

export function validateSandboxReadback(workOrder: WorkOrder, actualContent: string | null): ValidationResult {
  const matches = actualContent === workOrder.content;
  return {
    ok: matches,
    reason_codes: matches ? [] : ["READBACK_MISMATCH"],
    evidence: [{ source: "control/agent-gateway/work-order-validator.ts", note: `sandbox.readback=${matches ? "PASS" : "FAIL"}` }],
  };
}
