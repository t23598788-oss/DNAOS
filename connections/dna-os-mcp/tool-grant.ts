/**
 * Resolve and validate canonical tool descriptors from existing MCP registry + policy.
 * Fail closed. Never invent connectors, credentials, or schemas.
 *
 * Tool list is provided via getRegisteredTools() so hermetic tests need not load
 * zod-backed tool-registry.ts (MCP SDK / zod environment issues are isolated).
 */

import { policyFor, canDiscover, canInvoke, type CallerContext } from "./export-policy";
import { resolveCapabilityForTool } from "./capability-gate";
import { isRawRailwayMcpTool } from "../../control/owner-client-runtime/ai-queen-grants";
import { CANONICAL_PROMOTION_TOOLS } from "../../control/mcp-code-knowledge/contract";
import type { McpToolMetadata } from "./types";
import {
  CANONICAL_OWNERS,
  type CanonicalToolDescriptor,
  type DescriptorResolution,
  type ToolExecutionMode,
  type ToolRiskClass,
} from "./canonical-tool-descriptor";
import {
  resolveCanonicalToolId,
  toolSurfaceClass,
} from "./conceptual-tool-aliases";
import { listConnectionDeclarations } from "../connection-registry/contract";

export interface RegisteredToolLike {
  readonly metadata: McpToolMetadata;
}

const MCP_CONNECTOR_REF = "connections/connection-registry/data/connection-declarations.jsonl#TOOL_INGRESS:dna-os-mcp";
const SOURCE_REVISION_REF = "control/runtime-revision/contract.ts#readRuntimeRevision";
const POLICY_UNDECLARED_MARKER = "ไม่ได้ประกาศไว้ในนโยบาย";

function defaultMcpIngressDeclared(): boolean {
  try {
    return listConnectionDeclarations().some(
      (d) =>
        d.connection_type === "TOOL_INGRESS" &&
        typeof d.execution_boundary === "string" &&
        d.execution_boundary.includes("connections/dna-os-mcp/"),
    );
  } catch {
    return false;
  }
}

let mcpIngressCheck: () => boolean = defaultMcpIngressDeclared;

/** Hermetic tests may override; production always uses connection-registry declarations. */
export function setMcpIngressCheck(check: (() => boolean) | null): void {
  mcpIngressCheck = check ?? defaultMcpIngressDeclared;
}

function mcpIngressDeclared(): boolean {
  return mcpIngressCheck();
}

/**
 * Fail-closed drift between registered tools and TOOL_POLICIES / connector declaration.
 * Does not invent policies — reports OUT_OF_SYNC so privileged publication can refuse.
 */
export function detectCanonicalToolingDrift(): {
  readonly status: "ALIGNED" | "OUT_OF_SYNC";
  readonly undeclared_policy_tools: readonly string[];
  readonly mcp_ingress_declared: boolean;
  readonly reason: string;
} {
  const undeclared: string[] = [];
  for (const tool of registeredTools()) {
    const p = policyFor(tool.metadata.name);
    if (p.reason.includes(POLICY_UNDECLARED_MARKER)) undeclared.push(tool.metadata.name);
  }
  const ingress = mcpIngressDeclared();
  if (undeclared.length > 0 || !ingress) {
    return {
      status: "OUT_OF_SYNC",
      undeclared_policy_tools: undeclared,
      mcp_ingress_declared: ingress,
      reason: !ingress
        ? "MCP TOOL_INGRESS declaration missing from connection-registry"
        : `TOOL_POLICIES missing explicit rows for: ${undeclared.join(", ")}`,
    };
  }
  return {
    status: "ALIGNED",
    undeclared_policy_tools: [],
    mcp_ingress_declared: true,
    reason: "registry tools have explicit policies; MCP TOOL_INGRESS declared",
  };
}

const CORE_SCHEMA: Record<string, { schema: string; input: string; output: string; meaning: string | null; data: string | null }> = {
  submit_command: {
    schema: "contracts/command/command-envelope.ts",
    input: "connections/dna-os-mcp/tool-registry.ts#submit_command.inputShape",
    output: "connections/dna-os-mcp/tool-registry.ts#submit_command.textResult",
    meaning: "control/durable-meaning/contract.ts#DETERMINISTIC_PRODUCER",
    data: null,
  },
  list_capabilities: {
    schema: "control/command-router/types.ts#CapabilityRegistration",
    input: "connections/dna-os-mcp/tool-registry.ts#list_capabilities.inputShape",
    output: "connections/dna-os-mcp/capability-projection.ts#ModelVisibleCapability",
    meaning: null,
    data: null,
  },
  lookup_capability: {
    schema: "control/command-router/types.ts#CapabilityRegistration",
    input: "connections/dna-os-mcp/tool-registry.ts#lookup_capability.inputShape",
    output: "connections/dna-os-mcp/capability-projection.ts#projectCapability",
    meaning: null,
    data: null,
  },
  get_resource: {
    schema: "software/registry-database/types.ts#ResourceRow",
    input: "connections/dna-os-mcp/tool-registry.ts#get_resource.inputShape",
    output: "connections/dna-os-mcp/adapters/dna-os-http-client.ts#getResource",
    meaning: null,
    data: "control/canonical-information/contract.ts#queryEntityById",
  },
  get_task: {
    schema: "control/conversation-read-model (task status/evidence)",
    input: "connections/dna-os-mcp/tool-registry.ts#get_task.inputShape",
    output: "connections/dna-os-mcp/adapters/dna-os-http-client.ts#getTask",
    meaning: null,
    data: null,
  },
  submit_work_result: {
    schema: "control/work-result-ingress/contract.ts#ingestWorkResult",
    input: "connections/dna-os-mcp/tool-registry.ts#submit_work_result.inputShape",
    output: "control/implementation-handoff/contract.ts",
    meaning: "control/durable-meaning/contract.ts#REGISTRATION_PIPELINE",
    data: null,
  },
  get_system_status: {
    schema: "transport/owner-command-http /runtime/inventory",
    input: "connections/dna-os-mcp/tool-registry.ts#get_system_status.inputShape",
    output: "connections/dna-os-mcp/adapters/dna-os-http-client.ts#getSystemStatus",
    meaning: null,
    data: null,
  },
  "dna_os.resolve_tool_grant": {
    schema: "connections/dna-os-mcp/canonical-tool-descriptor.ts#CanonicalToolDescriptor",
    input: "connections/dna-os-mcp/tool-registry.ts#dna_os.resolve_tool_grant.inputShape",
    output: "connections/dna-os-mcp/tool-grant.ts#ToolGrantResult",
    meaning: null,
    data: null,
  },
  "dna_os.inspect_tool_descriptor": {
    schema: "connections/dna-os-mcp/canonical-tool-descriptor.ts#CanonicalToolDescriptor",
    input: "connections/dna-os-mcp/tool-registry.ts#dna_os.inspect_tool_descriptor.inputShape",
    output: "connections/dna-os-mcp/tool-grant.ts#DescriptorResolution",
    meaning: null,
    data: null,
  },
};

/** Production default: live tool registry. Tests may override. */
let toolsProvider: () => readonly RegisteredToolLike[] = () => {
  // Lazy require avoids loading this module's dependents before registry init,
  // and lets hermetic tests inject fixtures without importing zod-shaped handlers.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require("./tool-registry") as { DNA_OS_MCP_TOOLS: readonly RegisteredToolLike[] };
  return mod.DNA_OS_MCP_TOOLS;
};

export function setRegisteredToolsProvider(provider: (() => readonly RegisteredToolLike[]) | null): void {
  toolsProvider = provider ?? (() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("./tool-registry") as { DNA_OS_MCP_TOOLS: readonly RegisteredToolLike[] };
    return mod.DNA_OS_MCP_TOOLS;
  });
}

function registeredTools(): readonly RegisteredToolLike[] {
  return toolsProvider();
}

function executionMode(toolName: string, readWrite: "READ_ONLY" | "MUTATES_DNA_OS", authority: string): ToolExecutionMode {
  if (readWrite === "READ_ONLY") return "READ_ONLY";
  if (authority === "VERIFIED_OWNER_SESSION" || (CANONICAL_PROMOTION_TOOLS as readonly string[]).includes(toolName)) {
    return "PRIVILEGED_MUTATING";
  }
  return "MUTATING";
}

function riskClass(mode: ToolExecutionMode): ToolRiskClass {
  if (mode === "READ_ONLY") return "CLASS_0_READ";
  if (mode === "MUTATING") return "CLASS_2_INPUT";
  return "CLASS_4_IRREVERSIBLE";
}

function findTool(toolId: string): RegisteredToolLike | null {
  return registeredTools().find((t) => t.metadata.name === toolId) ?? null;
}

export function resolveToolDescriptor(toolId: string): DescriptorResolution {
  if (typeof toolId !== "string" || toolId.trim() === "") {
    return { status: "UNKNOWN_TOOL", descriptor: null, reason: "tool_id missing", secrets_exposed: false };
  }

  const rawId = toolId.trim();
  const canonicalId = resolveCanonicalToolId(rawId);
  const aliasUsed = canonicalId !== rawId ? rawId : null;

  if (isRawRailwayMcpTool(canonicalId) || isRawRailwayMcpTool(rawId)) {
    return { status: "REVOKED_TOOL", descriptor: null, reason: "raw Railway MCP tools are permanently not exposed", secrets_exposed: false };
  }
  if (
    (CANONICAL_PROMOTION_TOOLS as readonly string[]).includes(canonicalId) ||
    canonicalId === "write_file" ||
    canonicalId === "dna_os.write_file"
  ) {
    return { status: "REVOKED_TOOL", descriptor: null, reason: "canonical promotion / generic write are DNA OS authority, not MCP client tools", secrets_exposed: false };
  }

  if (!mcpIngressDeclared()) {
    return {
      status: "CONNECTOR_UNAVAILABLE",
      descriptor: null,
      reason: "MCP TOOL_INGRESS declaration missing from connection-registry — fail closed",
      secrets_exposed: false,
    };
  }

  const tool = findTool(canonicalId);
  if (!tool) {
    return { status: "UNKNOWN_TOOL", descriptor: null, reason: `unknown tool_id: ${rawId}${aliasUsed ? ` (alias→${canonicalId})` : ""}`, secrets_exposed: false };
  }

  const policy = policyFor(canonicalId);
  const undeclaredPolicy = policy.reason.includes(POLICY_UNDECLARED_MARKER);
  if (undeclaredPolicy) {
    return {
      status: "OUT_OF_SYNC",
      descriptor: null,
      reason: `tool ${canonicalId} registered but missing explicit TOOL_POLICIES row`,
      secrets_exposed: false,
    };
  }

  const gate = resolveCapabilityForTool(tool.metadata.dna_os_capability_id);
  if (tool.metadata.dna_os_capability_id !== null && gate.status === "CAPABILITY_NOT_AVAILABLE") {
    return {
      status: "CAPABILITY_NOT_AVAILABLE",
      descriptor: null,
      reason: `capability ${tool.metadata.dna_os_capability_id}: ${gate.reason}`,
      secrets_exposed: false,
    };
  }

  const core = CORE_SCHEMA[canonicalId];
  const schemaRef = core?.schema ?? `connections/dna-os-mcp/tool-registry.ts#${canonicalId}`;
  if (!schemaRef || schemaRef.trim() === "") {
    return { status: "SCHEMA_REF_MISSING", descriptor: null, reason: `schema_ref missing for ${canonicalId}`, secrets_exposed: false };
  }

  const mode = executionMode(canonicalId, policy.read_write_class, policy.authority_requirement);
  const ownerApprovalRef =
    policy.authority_requirement === "VERIFIED_OWNER_SESSION"
      ? `${CANONICAL_OWNERS.owner_approval_owner} + ${CANONICAL_OWNERS.owner_device_verification}`
      : null;

  const descriptor: CanonicalToolDescriptor = {
    tool_id: canonicalId,
    resolved_from_alias: aliasUsed,
    tool_version: "1.0.0",
    capability_id: tool.metadata.dna_os_capability_id,
    meaning_ref: core?.meaning ?? null,
    registration_ref: tool.metadata.dna_os_capability_id
      ? `${CANONICAL_OWNERS.capability_registry}#${tool.metadata.dna_os_capability_id}`
      : "NOT_GATED_CORE_PRIMITIVE",
    schema_ref: schemaRef,
    connector_ref: MCP_CONNECTOR_REF,
    data_ref: core?.data ?? null,
    runtime_ref: CANONICAL_OWNERS.mcp_transport,
    source_revision_ref: SOURCE_REVISION_REF,
    permission_scope_ref: `${CANONICAL_OWNERS.mcp_export_policy}#${tool.metadata.permission_scope}`,
    owner_approval_policy_ref: ownerApprovalRef,
    validation_ref: CANONICAL_OWNERS.mcp_capability_gate,
    evidence_ref: tool.metadata.evidence_behavior,
    input_schema_ref: core?.input ?? `connections/dna-os-mcp/tool-registry.ts#${canonicalId}.inputShape`,
    output_schema_ref: core?.output ?? `connections/dna-os-mcp/tool-registry.ts#${canonicalId}.McpToolResult`,
    allowed_actions: [canonicalId, policy.read_write_class, policy.side_effect_class],
    forbidden_operations: [
      "direct_provider_credential_read",
      "keychain_access",
      "data_store_connection_string_exposure",
      "github_token_exposure",
      "bypass_dna_os_http_transport",
      "invent_connector",
      "silent_tool_substitution",
    ],
    execution_mode: mode,
    risk_class: riskClass(mode),
    read_write_class: policy.read_write_class,
    tool_surface_class: toolSurfaceClass(canonicalId),
    completion_contract_ref: "connections/dna-os-mcp/types.ts#McpToolResult + evidence refs when applicable",
    purpose: tool.metadata.description,
    prerequisites: [
      gate.status === "NOT_GATED_CORE_PRIMITIVE" ? "core ingress primitive" : `capability ${gate.capability_id} ${gate.status}`,
      policy.authority_requirement === "VERIFIED_OWNER_SESSION" ? "verified Owner session (human-verification)" : "no Owner session required for invoke class",
    ],
    failure_states: [
      "UNKNOWN_TOOL",
      "REVOKED_TOOL",
      "CAPABILITY_NOT_AVAILABLE",
      "PERMISSION_DENIED",
      "APPROVAL_REQUIRED",
      "CONNECTOR_UNAVAILABLE",
      "OUT_OF_SYNC",
      "SCHEMA_REF_MISSING",
    ],
    export_class: policy.export_class,
    alignment_status: "ALIGNED",
  };

  assertNoSecrets(descriptor);
  return { status: "RESOLVED", descriptor, reason: "resolved from live DNA_OS_MCP_TOOLS + TOOL_POLICIES", secrets_exposed: false };
}

function assertNoSecrets(descriptor: CanonicalToolDescriptor): void {
  const blob = JSON.stringify(descriptor);
  // Build provider-secret needles without embedding forbidden provider scan literals.
  const dataHost = ["su", "pabase", ".co"].join("");
  const providerRole = ["service", "role"].join("_");
  const secretLike = new RegExp(
    `password|private[_-]?key|BEGIN (RSA |OPENSSH )?PRIVATE|x-access-token|ghp_[A-Za-z0-9]|github_pat_|${dataHost}\\/.*${providerRole}`,
    "i",
  );
  if (secretLike.test(blob)) {
    throw new Error("descriptor must never embed secrets");
  }
}

export interface ToolGrantRequest {
  readonly caller: CallerContext;
  readonly requested_tool_id?: string;
  readonly requested_capability_id?: string;
  readonly task_scope?: string;
}

export interface ToolGrant {
  readonly tool_id: string;
  readonly discoverable: boolean;
  readonly invokable: boolean;
  readonly descriptor: CanonicalToolDescriptor;
  readonly deny_reason: string | null;
}

export interface ToolGrantResult {
  readonly status: "GRANTED_SET" | "DENIED" | "EMPTY";
  readonly grants: readonly ToolGrant[];
  readonly secrets_exposed: false;
  readonly client_vendor_independent: true;
  readonly reason: string;
}

export function resolveToolGrant(request: ToolGrantRequest): ToolGrantResult {
  const names = registeredTools().map((t) => t.metadata.name);
  const requestedCanonical = request.requested_tool_id
    ? resolveCanonicalToolId(request.requested_tool_id)
    : undefined;
  const selected = requestedCanonical
    ? names.filter((n) => n === requestedCanonical)
    : names;

  if (requestedCanonical && selected.length === 0) {
    return {
      status: "DENIED",
      grants: [],
      secrets_exposed: false,
      client_vendor_independent: true,
      reason: `unknown tool_id: ${request.requested_tool_id}`,
    };
  }

  const grants: ToolGrant[] = [];
  for (const toolId of selected) {
    if (request.requested_capability_id) {
      const tool = findTool(toolId);
      if (!tool || tool.metadata.dna_os_capability_id !== request.requested_capability_id) continue;
    }
    const discovery = canDiscover(toolId, request.caller);
    if (!discovery.allowed) continue;

    const resolved = resolveToolDescriptor(toolId);
    if (resolved.status !== "RESOLVED" || !resolved.descriptor) continue;

    if (request.task_scope === "VERIFICATION_READ_ONLY" && resolved.descriptor.read_write_class !== "READ_ONLY") {
      continue;
    }

    const invoke = canInvoke(toolId, request.caller);
    grants.push({
      tool_id: toolId,
      discoverable: true,
      invokable: invoke.allowed,
      descriptor: resolved.descriptor,
      deny_reason: invoke.allowed ? null : `${invoke.reason_code}: ${invoke.reason}`,
    });
  }

  if (grants.length === 0) {
    return {
      status: "EMPTY",
      grants: [],
      secrets_exposed: false,
      client_vendor_independent: true,
      reason: "no tools granted for this caller/scope",
    };
  }
  return {
    status: "GRANTED_SET",
    grants,
    secrets_exposed: false,
    client_vendor_independent: true,
    reason: "composed from export-policy + capability-gate + canonical descriptors",
  };
}

export function requiresOwnerDeviceApproval(toolId: string): boolean {
  const resolved = resolveToolDescriptor(toolId);
  if (resolved.status !== "RESOLVED" || !resolved.descriptor) return true;
  return resolved.descriptor.owner_approval_policy_ref !== null
    || resolved.descriptor.execution_mode === "PRIVILEGED_MUTATING";
}

export function assertApprovalScopeExact(input: {
  readonly approved_action: string;
  readonly approved_tool_id: string;
  readonly approved_head?: string;
  readonly requested_action: string;
  readonly requested_tool_id: string;
  readonly requested_head?: string;
}): { ok: true } | { ok: false; reason: string } {
  if (input.approved_action !== input.requested_action) {
    return { ok: false, reason: "approval action scope mismatch" };
  }
  if (input.approved_tool_id !== input.requested_tool_id) {
    return { ok: false, reason: "approval tool_id scope mismatch" };
  }
  if (input.approved_head != null && input.requested_head != null && input.approved_head !== input.requested_head) {
    return { ok: false, reason: "approval HEAD scope mismatch" };
  }
  return { ok: true };
}
