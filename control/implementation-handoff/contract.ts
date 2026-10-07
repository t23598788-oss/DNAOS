import { randomUUID } from "node:crypto";
import { nowIso } from "../agent-gateway/host-runtime";
import { saveEvidence } from "../agent-gateway/memory-store";

export const IMPLEMENTATION_HANDOFF_CONTRACT_VERSION = "1" as const;

export interface ImplementationHandoff {
  handoff_id: string;
  command_id: string;
  parent_work_id: string | null;
  failure_id: string;
  evidence_refs: readonly string[];
  owner_authorization_ref: string;
  requested_outcome: string;
  failure_boundary: string;
  target_scope: readonly string[];
  workspace_scope: string;
  allowed_operations: readonly string[];
  side_effect_class: "SOURCE_WRITE" | "READ_ONLY";
  executor_requirements: readonly string[];
  verification_requirements: readonly string[];
  created_at: string;
}

export type ImplementationHandoffResult =
  | { ok: true; handoff: ImplementationHandoff; evidence_id: string }
  | { ok: false; reason: string; missing_fields: readonly string[] };

export function createImplementationHandoff(input: Omit<ImplementationHandoff, "handoff_id" | "created_at">): ImplementationHandoffResult {
  const required: (keyof Omit<ImplementationHandoff, "handoff_id" | "created_at">)[] = [
    "command_id", "failure_id", "owner_authorization_ref", "requested_outcome",
    "failure_boundary", "workspace_scope",
  ];
  const missing = required.filter((field) => {
    const value = input[field];
    return typeof value !== "string" || value.trim().length === 0;
  });
  if (missing.length > 0) return { ok: false, reason: "IMPLEMENTATION_HANDOFF_INCOMPLETE", missing_fields: missing };
  if (input.evidence_refs.length === 0) return { ok: false, reason: "FAILURE_EVIDENCE_REQUIRED", missing_fields: ["evidence_refs"] };
  if (input.allowed_operations.length === 0) return { ok: false, reason: "ALLOWED_OPERATIONS_REQUIRED", missing_fields: ["allowed_operations"] };
  if (input.executor_requirements.length === 0) return { ok: false, reason: "EXECUTOR_REQUIREMENTS_REQUIRED", missing_fields: ["executor_requirements"] };
  if (input.verification_requirements.length === 0) return { ok: false, reason: "VERIFICATION_REQUIREMENTS_REQUIRED", missing_fields: ["verification_requirements"] };

  const handoff: ImplementationHandoff = { ...input, handoff_id: `handoff-${randomUUID()}`, created_at: nowIso() };
  const evidence_id = `ev-${randomUUID()}`;
  saveEvidence({
    evidence_id,
    task_id: handoff.parent_work_id ?? handoff.command_id,
    kind: "owner_decision",
    source: "control/implementation-handoff/contract.ts#createImplementationHandoff",
    recorded_at: handoff.created_at,
    payload: { contract_version: IMPLEMENTATION_HANDOFF_CONTRACT_VERSION, handoff },
  });
  return { ok: true, handoff, evidence_id };
}
