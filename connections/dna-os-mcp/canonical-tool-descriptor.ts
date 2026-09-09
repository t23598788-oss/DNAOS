/**
 * Canonical MCP tool descriptor — references existing DNA OS owners.
 * Does not copy schemas, connectors, permissions, or approval logic.
 *
 * Owners (reuse, do not replace):
 * - capability: control/command-router/contract.ts
 * - meaning: control/durable-meaning/contract.ts
 * - schema: contracts/ + control/canonical-information/types.ts
 * - connector: connections/connection-registry/contract.ts
 * - permission: control/permission-policy-resolution/ + permissions/execution-policy/
 * - evidence: control/canonical-information (CanonicalEvidenceIndexV1) + per-capability evidence JSONL
 * - owner approval: control/owner-authentication/contract.ts + human-verification.ts
 */

export const CANONICAL_OWNERS = {
  capability_registry: "control/command-router/contract.ts#getCapability",
  meaning_registry: "control/durable-meaning/contract.ts#admitResource",
  schema_owner: "contracts/ + control/canonical-information/types.ts",
  connector_registry: "connections/connection-registry/contract.ts#lookupConnectionDeclaration",
  data_reference: "control/canonical-information/contract.ts",
  permission_owner: "control/permission-policy-resolution/contract.ts#resolvePolicy",
  evidence_owner: "control/canonical-information/types.ts#CanonicalEvidenceIndexV1",
  owner_approval_owner: "control/owner-authentication/contract.ts#validateOwnerSession",
  owner_device_verification: "control/owner-authentication/human-verification.ts#runVerification",
  mcp_export_policy: "connections/dna-os-mcp/export-policy.ts#canInvoke",
  mcp_capability_gate: "connections/dna-os-mcp/capability-gate.ts#resolveCapabilityForTool",
  mcp_transport: "connections/dna-os-mcp/adapters/dna-os-http-client.ts → transport/owner-command-http @ 127.0.0.1:8791",
} as const;

export type ToolExecutionMode = "READ_ONLY" | "MUTATING" | "PRIVILEGED_MUTATING";
export type ToolRiskClass = "CLASS_0_READ" | "CLASS_1_NAVIGATION" | "CLASS_2_INPUT" | "CLASS_3_SECURITY_OR_EXTERNAL_CONFIG" | "CLASS_4_IRREVERSIBLE";
export type ToolReadWriteClass = "READ_ONLY" | "MUTATES_DNA_OS";

/**
 * Machine-readable self-description so a client can discover use without
 * Owner-written procedures. Fields are references or closed enums — never secrets.
 */
export interface CanonicalToolDescriptor {
  readonly tool_id: string;
  /** Conceptual alias that resolved to this tool_id, if any (never a second tool). */
  readonly resolved_from_alias: string | null;
  readonly tool_version: string;
  readonly capability_id: string | null;
  readonly meaning_ref: string | null;
  readonly registration_ref: string | null;
  readonly schema_ref: string;
  readonly connector_ref: string | null;
  readonly data_ref: string | null;
  readonly runtime_ref: string;
  readonly source_revision_ref: string;
  readonly permission_scope_ref: string;
  readonly owner_approval_policy_ref: string | null;
  readonly validation_ref: string;
  readonly evidence_ref: string;
  readonly input_schema_ref: string;
  readonly output_schema_ref: string;
  readonly allowed_actions: readonly string[];
  readonly forbidden_operations: readonly string[];
  readonly execution_mode: ToolExecutionMode;
  readonly risk_class: ToolRiskClass;
  readonly read_write_class: ToolReadWriteClass;
  /** Derived class over existing tools — not a parallel registry. */
  readonly tool_surface_class: "OPERATIONAL" | "DEVELOPMENT" | "VERIFICATION" | "GRANT";
  readonly completion_contract_ref: string;
  readonly purpose: string;
  readonly prerequisites: readonly string[];
  readonly failure_states: readonly string[];
  readonly export_class: string;
  /** ALIGNED | OUT_OF_SYNC when policy/registry/docs refs disagree. */
  readonly alignment_status: "ALIGNED" | "OUT_OF_SYNC";
}

export type DescriptorResolutionStatus =
  | "RESOLVED"
  | "UNKNOWN_TOOL"
  | "REVOKED_TOOL"
  | "CAPABILITY_NOT_AVAILABLE"
  | "SCHEMA_REF_MISSING"
  | "CONNECTOR_UNAVAILABLE"
  | "PERMISSION_DENIED"
  | "APPROVAL_REQUIRED"
  | "OUT_OF_SYNC";

export interface DescriptorResolution {
  readonly status: DescriptorResolutionStatus;
  readonly descriptor: CanonicalToolDescriptor | null;
  readonly reason: string;
  readonly secrets_exposed: false;
}
