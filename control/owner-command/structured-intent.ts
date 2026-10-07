import { randomUUID } from "node:crypto";
import { executeLocalRead, type LocalReadRequest } from "./local-read-operations";
import { EXECUTABLE_INTENTS, classifyIntentType, operationForIntent } from "./intent-contract";
import { listCapabilities } from "../command-router/capability-registry";
import { evaluateExecutionPermission, type ExecutionPolicyContext } from "../../permissions/execution-policy/contract";
import { getIdentityRegistration } from "../../permissions/access-control/identity-registry";
import { listMembershipsForIdentity } from "../../permissions/access-control/membership-registry";
import { listExecutionGrantsForIdentity } from "../../permissions/execution-policy/contract";
import { createPersistentFileStore } from "../../software/registry-database/adapters/persistent-file-store";
import { translateOwnerMessage, recordOwnerVisibleResult } from "../owner-command-semantics/contract";
import { queryAgentSessionRegistry } from "../../connections/agent-registry/session-registry";
import { admitAgentWork } from "../agent-work/contract";

export type OwnerIntent = {
  version: "1";
  request_id: string;
  owner_session_id: string;
  intent_type: string;
  desired_outcome: string;
  target: { kind: string; identity: string } | null;
  constraints: string[];
  requested_side_effect: "READ_ONLY" | "NONE" | string;
  context_refs: string[];
  selected_capability?: string | null;
  selected_tool?: string | null;
  arguments?: Record<string, string>;
};

export type ResourceResolution = {
  capability_id: string | null;
  candidate_resources: string[];
  selected_resource_id: string | null;
  availability: "AVAILABLE" | "READ_ONLY" | "PERMISSION_REQUIRED" | "RESOURCE_UNAVAILABLE" | "EXECUTOR_UNAVAILABLE" | "CONTRACT_INCOMPLETE" | "UNKNOWN";
  permission_state: string;
  executor_id: string | null;
  reason: string;
  evidence_refs: string[];
};

// The executable vocabulary is no longer declared here. It lives in
// ./intent-contract.ts, which the interpreter prompt reads from the same file —
// see that module's header for what the three-way duplication actually cost.
/**
 * PIPE 1: the canonical registry is the identity authority for capabilities.
 * Built once per module load, the same way the rest of this file treats its
 * other registries. `listCapabilities` imported from ../command-router is the
 * ROUTING table and is kept for connectivity state only.
 */
const canonicalStore = createPersistentFileStore();

const OWNER_IDENTITY = "identity-deadboard-owner";
const ACCOUNT_ID = "account-deadboard-owner";
const WORKSPACE_ID = "workspace-deadboard-owner";

export function validateOwnerIntent(input: unknown): OwnerIntent | { status: "INVALID"; reason: string } {
  if (!input || typeof input !== "object") return { status: "INVALID", reason: "INTENT_MUST_BE_OBJECT" };
  const value = input as Partial<OwnerIntent>;
  if (typeof value.intent_type !== "string" || !value.intent_type) return { status: "INVALID", reason: "INTENT_TYPE_REQUIRED" };
  if (typeof value.owner_session_id !== "string" || !value.owner_session_id) return { status: "INVALID", reason: "OWNER_SESSION_ID_REQUIRED" };
  if (value.selected_capability != null || value.selected_tool != null) {
    // PIPE 1: a caller may name a capability by its CANONICAL capability_id
    // (the identity) or, for backward compatibility, by an existing route slug.
    // Both are exact-id lookups in their own namespace — never name inference.
    const selected = typeof value.selected_capability === "string" ? value.selected_capability : null;
    const canonical = selected ? canonicalStore.findCapabilityById(selected) : null;
    // PIPE 2F: a canonical capability reaches its route through the explicit
    // CAPABILITY_TO_API relationship, never by comparing canonical_name to a slug.
    const boundSlug = canonical?.relationships.find((edge) => edge.relationship_kind === "CAPABILITY_TO_API" && edge.to_id.startsWith("route:"))?.to_id.slice("route:".length);
    const routeForCanonical = boundSlug ? listCapabilities().find((item) => item.capability_id === boundSlug) : undefined;
    const capability = routeForCanonical ?? (selected ? listCapabilities().find((item) => item.capability_id === selected) : undefined);
    if (!canonical && !capability) return { status: "INVALID", reason: "SELECTED_CAPABILITY_NOT_REGISTERED" };
    // A canonical capability with no bound route has no supported_commands to
    // validate a tool against — report that honestly rather than guessing one.
    if (!capability) return { status: "INVALID", reason: "SELECTED_CAPABILITY_HAS_NO_BOUND_ROUTE" };
    if (typeof value.selected_tool !== "string" || !capability.supported_commands.includes(value.selected_tool)) return { status: "INVALID", reason: "SELECTED_TOOL_NOT_SUPPORTED_BY_CAPABILITY" };
    if (value.arguments != null && (typeof value.arguments !== "object" || Array.isArray(value.arguments) || Object.values(value.arguments as object).some((item) => typeof item !== "string"))) return { status: "INVALID", reason: "ARGUMENTS_MUST_BE_STRING_MAP" };
  }
  return {
    version: "1", request_id: typeof value.request_id === "string" && value.request_id ? value.request_id : randomUUID(),
    owner_session_id: value.owner_session_id, intent_type: value.intent_type,
    desired_outcome: typeof value.desired_outcome === "string" ? value.desired_outcome : "",
    target: value.target ?? null, constraints: Array.isArray(value.constraints) ? value.constraints.map(String) : [],
    requested_side_effect: value.requested_side_effect ?? "READ_ONLY",
    context_refs: Array.isArray(value.context_refs) ? value.context_refs.map(String) : [],
    selected_capability: value.selected_capability ?? null,
    selected_tool: value.selected_tool ?? null,
    arguments: value.arguments ?? {},
  };
}

/**
 * PIPE A (Owner, 2026-08-31): every owner-visible result produced through
 * /owner/intent is persisted under ITS OWN command_id before being returned.
 * Previously only the natural-language path (`resolveAndExecuteOwnerRequest`)
 * called `finish()`, so results from the live structured endpoint were never
 * written to semantic history at all - which is why a result could not be
 * correlated back to the command that produced it.
 */
export async function resolveAndExecuteOwnerIntent(input: unknown): Promise<Record<string, unknown>> {
  const result = await executeOwnerIntentInner(input);
  const requestId = typeof result.request_id === "string" && result.request_id
    ? result.request_id
    : (typeof (input as any)?.request_id === "string" ? (input as any).request_id : null);
  if (requestId) {
    const structuredOutcome = typeof (input as any)?.desired_outcome === "string" ? (input as any).desired_outcome : "";
    recordOwnerVisibleResult(requestId, OWNER_IDENTITY, structuredOutcome, { ...result, command_id: requestId });
  }
  return result;
}

async function executeOwnerIntentInner(input: unknown): Promise<Record<string, unknown>> {
  const intent = validateOwnerIntent(input);
  if ("status" in intent) return { status: "CAPABILITY_UNKNOWN", request_id: null, intent_type: (input as any)?.intent_type ?? null, result: intent };

  // INTENT CONTRACT — checked before capability resolution and before any
  // operation mapping, because "software never agreed this word means
  // anything" is a different failure from "the capability could not be
  // resolved". Reporting the first as the second is what made a model that
  // echoed the prompt's own placeholder ("existing") look like a missing
  // capability. CAPABILITY_UNKNOWN keeps its original meaning here.
  const intentClass = classifyIntentType(intent.intent_type);
  if (intentClass === "NOT_IN_CONTRACT") {
    return { version: "1", request_id: intent.request_id, intent_type: intent.intent_type, capability_id: null, resource_id: null, executor_id: null, authority_decision: "NOT_APPLICABLE", status: "INTENT_TYPE_NOT_IN_CONTRACT", result: { reason: "INTENT_TYPE_NOT_IN_CONTRACT", declared_by: "control/owner-command/data/executable-intent-contract.json", executable_values: EXECUTABLE_INTENTS }, evidence_refs: ["control/owner-command/intent-contract.ts"] };
  }
  if (intentClass === "NON_EXECUTABLE") {
    return { version: "1", request_id: intent.request_id, intent_type: intent.intent_type, capability_id: null, resource_id: null, executor_id: null, authority_decision: "NOT_APPLICABLE", status: "SEMANTIC_UNKNOWN", result: { reason: "INTENT_NOT_EXECUTABLE", declared_by: "control/owner-command/data/executable-intent-contract.json" }, evidence_refs: ["control/owner-command/intent-contract.ts"] };
  }
  if (intent.intent_type === "LIST_CAPABILITIES" || intent.intent_type === "LIST_AVAILABLE_CAPABILITIES" || intent.intent_type === "CAPABILITY_STATUS") {
    // PIPE 1 (Owner, 2026-08-31): capability identity now comes from the
    // canonical registry, not from control/command-router/capability-registry.ts.
    // That file is NOT deleted and NOT a duplicate registry — it carries routing
    // /connectivity semantics (health_status CONNECTED/NOT_CONNECTED, endpoint)
    // that canonical has no populated field for, so it is joined in below as
    // connectivity metadata. capability_id remains the one identity.
    // PIPE 2F: the route binding is now an EXPLICIT canonical relationship
    // (CAPABILITY_TO_API -> "route:<slug>"), not a runtime canonical_name string
    // comparison. Name matching is gone from the authority path entirely — a
    // route reaches a capability only if a real relationship row says so.
    const routesBySlug = new Map(listCapabilities().map((route) => [route.capability_id, route]));
    const capabilities = canonicalStore.listCapabilities().map((capability) => {
      const boundSlugs = capability.relationships
        .filter((edge) => edge.relationship_kind === "CAPABILITY_TO_API" && edge.to_id.startsWith("route:"))
        .map((edge) => edge.to_id.slice("route:".length));
      const route = boundSlugs.map((slug) => routesBySlug.get(slug)).find((r) => r !== undefined);
      return {
        capability_id: capability.capability_id,
        canonical_name: capability.canonical_name,
        registry_status: capability.status,
        input_contract: capability.input_contract,
        output_contract: capability.output_contract,
        side_effect_class: "UNKNOWN",
        connectivity_state: route ? route.health_status : "NO_ROUTE_BOUND",
        route_slugs: boundSlugs,
        verification_method: "canonical registry (software/registry-database/data/canonical/capabilities.jsonl)",
      };
    });
    const result = intent.intent_type === "CAPABILITY_STATUS"
      ? capabilities.filter((capability) => !intent.target?.identity || capability.capability_id === intent.target.identity)
      // "AVAILABLE" keeps its original meaning — actually callable right now —
      // which is connectivity, not registration. Reading it off the route join
      // preserves exactly what the routing table already knew.
      : intent.intent_type === "LIST_AVAILABLE_CAPABILITIES" ? capabilities.filter((capability) => capability.connectivity_state === "CONNECTED") : capabilities;
    return { version: "1", request_id: intent.request_id, operation_id: null, task_id: null, intent_type: intent.intent_type, capability_id: "capability-registry", resource_id: null, executor_id: "canonical-registry-read", authority_decision: "ALLOW_READ_ONLY", status: "OBSERVED", result, evidence_refs: ["software/registry-database/data/canonical/capabilities.jsonl", "control/command-router/capability-registry.ts"], side_effect: "NONE", started_at: new Date().toISOString(), completed_at: new Date().toISOString() };
  }
  const operation = operationForIntent(intent.intent_type);
  if (!operation) return { version: "1", request_id: intent.request_id, intent_type: intent.intent_type, capability_id: null, resource_id: null, executor_id: null, authority_decision: "NOT_APPLICABLE", status: "CAPABILITY_UNKNOWN", result: null, evidence_refs: [] };
  if (intent.requested_side_effect !== "READ_ONLY" && intent.requested_side_effect !== "NONE") return { version: "1", request_id: intent.request_id, operation_id: null, task_id: null, intent_type: intent.intent_type, capability_id: "execution", resource_id: null, executor_id: null, owner_identity: OWNER_IDENTITY, authority_source: "permissions/execution-policy/contract.ts", authority_decision: "DENY", permission_decision: "DENY", status: "BLOCKED", result: { reason: "READ_ONLY_REQUIRED" }, evidence_refs: [], side_effect: "NONE", started_at: new Date().toISOString(), completed_at: new Date().toISOString() };
  if (intent.target && intent.target.identity !== "workspace" && intent.target.identity !== "/Users/tam/Desktop/dna-os-control-workspace") return { version: "1", request_id: intent.request_id, operation_id: null, task_id: null, intent_type: intent.intent_type, capability_id: "execution", resource_id: null, executor_id: null, owner_identity: OWNER_IDENTITY, authority_source: "resource-resolution", authority_decision: "NOT_APPLICABLE", permission_decision: "NOT_APPLICABLE", status: "RESOURCE_UNAVAILABLE", result: { reason: "NO_CANONICAL_RESOURCE_FOR_TARGET" }, evidence_refs: [] , side_effect: "NONE", started_at: new Date().toISOString(), completed_at: new Date().toISOString() };
  // PIPE B/D: resolve the CANONICAL capability + resource that actually backs
  // this executor, through the explicit route binding written in Pipe 2 — not
  // by name. If no binding resolves, the ids stay null and the reason says so
  // rather than falling back to a guessed identity.
  const executionRoute = "execution";
  const canonicalExecution = canonicalStore.listCapabilities().find((c) =>
    c.relationships.some((e) => e.relationship_kind === "CAPABILITY_TO_API" && e.to_id === `route:${executionRoute}`));
  const resolution: ResourceResolution = {
    capability_id: canonicalExecution?.capability_id ?? "execution",
    candidate_resources: canonicalExecution ? [...canonicalExecution.resource_ids] : [],
    selected_resource_id: canonicalExecution?.resource_ids[0] ?? null,
    availability: "READ_ONLY", permission_state: "READ_ONLY", executor_id: "local-read-operations",
    reason: canonicalExecution
      ? `canonical capability resolved through explicit CAPABILITY_TO_API binding route:${executionRoute}`
      : "no canonical binding for route:execution - identity unresolved, not guessed",
    evidence_refs: ["control/owner-command/local-read-operations.ts", "canonical CAPABILITY_TO_API binding"],
  };
  const permissionRequest = {
    identity_id: OWNER_IDENTITY, account_id: ACCOUNT_ID, workspace_id: WORKSPACE_ID,
    capability: "execution.run", command_id: "unknown", action: "run",
    cwd_scope: "repo/dna-os-control-workspace", requested_args: [operation], correlation_id: intent.request_id,
  };
  const permissionContext: ExecutionPolicyContext = {
    identity: getIdentityRegistration(OWNER_IDENTITY)?.identity,
    memberships: listMembershipsForIdentity(OWNER_IDENTITY),
    grants: listExecutionGrantsForIdentity(OWNER_IDENTITY),
    command: { command_id: "unknown", required_capability: "execution.run", allowed_actions: ["run"], allowed_cwd_scope_prefixes: ["repo/"] },
  };
  const authority = evaluateExecutionPermission(permissionRequest, permissionContext);
  if (authority.decision !== "ALLOW") return { version: "1", request_id: intent.request_id, operation_id: null, task_id: null, intent_type: intent.intent_type, capability_id: resolution.capability_id, resource_id: resolution.selected_resource_id, executor_id: resolution.executor_id, owner_identity: OWNER_IDENTITY, authority_source: "permissions/execution-policy/contract.ts", authority_decision: authority.decision, permission_decision: authority.decision, status: "BLOCKED", result: { reason: authority.reason_codes }, evidence_refs: resolution.evidence_refs, side_effect: "NONE", started_at: new Date().toISOString(), completed_at: new Date().toISOString() };
  const request: LocalReadRequest = { command_id: intent.request_id, canonical_capability_id: canonicalExecution?.capability_id, resource_id: resolution.selected_resource_id ?? undefined, task_id: `intent-${intent.request_id}`, owner_session_id: intent.owner_session_id, requested_operation: operation, target: intent.target?.identity ?? "workspace", workspace_scope: "dna-os-control-workspace", allowed_operations: [operation], side_effect_policy: "READ_ONLY", expected_result: intent.desired_outcome, verification_requirement: "machine fields" };
  const observed = await executeLocalRead(request);
  return { ...observed, version: "1", request_id: intent.request_id, intent_type: intent.intent_type, capability_id: resolution.capability_id, resource_resolution: resolution, executor_id: resolution.executor_id, owner_identity: OWNER_IDENTITY, authority_source: "permissions/execution-policy/contract.ts", authority_decision: authority.decision, permission_decision: authority.decision, status: (observed.result as any)?.status ?? "UNKNOWN", evidence_refs: [`local-operation-${observed.operation_id}`] };
}

/** Core-owned natural-language boundary. Interpretation is retained as
 * provenance; only registered, deterministic outcomes are executed. */
export async function resolveAndExecuteOwnerRequest(rawText: string, ownerSessionId = "OWNER_UI"): Promise<Record<string, unknown>> {
  const messageId = `owner-request-${randomUUID()}`;
  const finish = (value: Record<string, unknown>): Record<string, unknown> => { recordOwnerVisibleResult(messageId, OWNER_IDENTITY, rawText, value); return value; };
  const translated = translateOwnerMessage(messageId, rawText, { identity_id: OWNER_IDENTITY, acting_as_account_id: ACCOUNT_ID, acting_as_tenant_id: "tenant-deadboard-owner", software_id: "dna-os-deadboard", kind: "human" } as any, { registryStore: createPersistentFileStore() });
  if (!translated.semantic.ok) return finish({ command_id: messageId, raw_request: rawText, resolution_status: "UNKNOWN", resolution_stage: "SEMANTIC_INTERPRETATION", interpreted_outcome: translated.semantic, execution_started: false, evidence_refs: [] });
  const context: any = translated.semantic.context;
  const semantic = context.semantic_interpretation ?? {};
  const action = String(context.action ?? semantic.action ?? "UNKNOWN").toUpperCase();
  const targetExpression = String(semantic.target_text ?? context.target_text ?? "");
  const targetClass = String(semantic.target_class ?? context.target_class ?? "UNKNOWN").toUpperCase();
  const requested = String(context.semantic_interpretation?.requested_result ?? context.requested_result ?? "").toLowerCase();
  const intent = String(context.intent ?? "").toLowerCase();
  const mentionedEntities = Array.isArray(semantic.entity_mentions) ? semantic.entity_mentions.map((value: unknown) => String(value).toLowerCase()) : [];
  const requestsAgentWork = mentionedEntities.some((value: string) => value === "agent" || value.includes("agent"))
    && ["RUN", "CHECK", "VERIFY", "READ"].includes(action)
    && targetExpression.length > 0;
  let intentType: string | null = null;
  if (targetExpression.toLowerCase() === "agent" && (requested.includes("พร้อม") || requested.includes("available") || rawText.includes("พร้อมรับงาน"))) intentType = "LIST_AVAILABLE_AGENTS";
  else if (requestsAgentWork) intentType = "AGENT_WORK_REQUEST";
  else if (requested.includes("revision") || intent.includes("revision")) intentType = "READ_REPOSITORY_STATE";
  else if (intent.includes("core") && (intent.includes("running") || intent.includes("status"))) intentType = "INSPECT_LOCAL_RUNTIME";
  else if (intent.includes("capabilit")) intentType = "LIST_CAPABILITIES";
  else if (intent.includes("resource")) intentType = "LIST_AVAILABLE_CAPABILITIES";
  if (action === "CREATE") return finish({ command_id: messageId, raw_request: rawText, interpreted_action: action, target_expression: targetExpression, target_class: targetClass, instance_intent: semantic.parameters?.instance_intent ?? (rawText.includes("อีก") ? "NEW_INSTANCE" : "UNKNOWN"), candidate_systems: [], candidate_capabilities: context.resolved_capabilities ?? [], candidate_resources: context.resolved_resources ?? [], candidate_relationships: [], existence_status: "NO_PROVEN_MATCH", missing_requirements: ["canonical target identity", "instance-specific requirements"], owner_input_required: "BLOCKED_FOR_OWNER_DECISION", command_satisfaction: "NEW_ACTION_REQUIRED", resolution_status: "UNKNOWN", resolution_stage: "TARGET_RESOLUTION", work_required: false, execution_started: false, evidence_refs: context.evidence_refs ?? [] });
  if (intentType === "LIST_AVAILABLE_AGENTS") {
    const registry = await queryAgentSessionRegistry();
    const executable = registry.entries.filter((entry) => entry.safe_to_assign && entry.status === "IDLE");
    return finish({ command_id: messageId, raw_request: rawText, resolution_status: "RESOLVED", resolution_stage: "RESOURCE_RESOLUTION", execution_started: false, work_required: false, result: { summary: `ตรวจจาก Agent Registry จริง: ลงทะเบียน ${registry.total_agents} ตัว, พร้อมรับงานยืนยันได้ ${executable.length} ตัว`, registered_agents: registry.entries, available_agents: executable, evidence: "connections/agent-registry/session-registry.ts#queryAgentSessionRegistry" }, evidence_refs: ["connections/agent-registry/session-registry.ts#queryAgentSessionRegistry"] });
  }
  if (intentType === "AGENT_WORK_REQUEST") {
    const workId = `work-${randomUUID()}`;
    const admission = admitAgentWork({
      command_id: messageId,
      work_id: workId,
      parent_work_id: null,
      owner_request: rawText,
      work_kind: "READ_ONLY_AGENT_INSPECTION",
      required_capability: "agent-host",
      target: targetExpression,
      workspace_scope: "/Users/tam/Desktop/dna-os-control-workspace",
      side_effect_class: "READ_ONLY",
      authority_ref: "owner-command-owner-session",
      resource_requirements: ["authorized-agent-worker"],
      expected_result: context.requested_result ?? "inspection report with evidence",
      verification_requirements: ["persisted-result", "evidence-lineage"],
    });
    if (!admission.ok) return finish({ command_id: messageId, raw_request: rawText, resolution_status: "BLOCKED", resolution_stage: "WORK_ADMISSION", work_id: workId, missing_fields: admission.missing_fields, execution_started: false, evidence_refs: [] });
    return finish({
      command_id: messageId,
      raw_request: rawText,
      interpreted_action: action,
      target_expression: targetExpression,
      target_class: targetClass,
      resolution_status: "RESOLVED",
      resolution_stage: "WORK_ADMISSION",
      execution_started: false,
      work_required: true,
      work_id: workId,
      result: { status: "WORK_CREATED", admission_id: admission.admission_id, target: targetExpression, work_kind: "READ_ONLY_AGENT_INSPECTION" },
      evidence_refs: [admission.evidence_id],
    });
  }
  if (!intentType) return finish({ command_id: messageId, raw_request: rawText, interpreted_action: action, target_expression: targetExpression, target_class: targetClass, candidate_capabilities: context.resolved_capabilities ?? [], candidate_resources: context.resolved_resources ?? [], resolution_status: "UNKNOWN", resolution_stage: "CAPABILITY_RESOLUTION", authority_decision: "NOT_APPLICABLE", work_required: false, execution_started: false, evidence_refs: context.evidence_refs ?? [] });
  const result = await resolveAndExecuteOwnerIntent({ version: "1", request_id: messageId, owner_session_id: ownerSessionId, intent_type: intentType, desired_outcome: context.requested_result ?? rawText, target: { kind: "workspace", identity: "workspace" }, constraints: [], requested_side_effect: "READ_ONLY", context_refs: context.evidence_refs ?? [] });
  return finish({ command_id: messageId, raw_request: rawText, interpreted_outcome: context, resolution_status: result.status === "CAPABILITY_UNKNOWN" ? "UNKNOWN" : result.status === "BLOCKED" ? "BLOCKED" : "RESOLVED", resolution_stage: "EXECUTION", capability_candidates: context.resolved_capabilities ?? [], resource_candidates: context.resolved_resources ?? [], selected_capability: result.capability_id ?? null, selected_resource: result.resource_id ?? null, authority_decision: result.authority_decision ?? "UNKNOWN", work_required: false, work_ids: [], execution_started: result.operation_id != null, ...result });
}
