/**
 * หน้าที่: the MCP tools exposed by this capability folder. Every
 * handler does the same three things, in order: (1) run the MCP Tool
 * Resolver (./capability-gate.ts) — refuse with CAPABILITY_NOT_AVAILABLE
 * before touching anything else if it fails; (2) call exactly one method
 * on ./adapters/dna-os-http-client.ts, which itself only reaches DNA OS's
 * own already-canonical HTTP transport — except list/lookup of routed
 * capabilities, which read the existing command-router registry through
 * ./capability-projection.ts (same source as ./capability-gate.ts, never
 * a second catalog); (3) thread a correlation_id through and return the
 * real response, never a fabricated one.
 *
 * Typed Owner commands go to POST /owner/submit-command
 * (`submitOwnerCommand`). POST /command remains chat-intake / WorkOrder
 * and is not a model command door. Registration, consent approval, secret
 * retrieval, and arbitrary shell are not registered as MCP tools.
 *
 * Input: none (module-level tool list).
 * Output: `DNA_OS_MCP_TOOLS` — one entry per tool: metadata + a
 * `handler(args)` returning an MCP `CallToolResult`-shaped object.
 * Dependency ที่อนุญาต: ./types.ts, ./capability-gate.ts,
 * ./adapters/dna-os-http-client.ts, ./identity.ts,
 * ./capability-projection.ts, zod.
 * สิ่งที่ห้ามแตะ: never add a tool for registration, consent-approve,
 * get_secret, or a generic shell. Never let a mutating handler call
 * `fetch` against anything other than the one DnaOsHttpClient instance
 * it's given.
 */

import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { McpToolMetadata } from "./types";

const jsonMap = z.record(z.string(), z.unknown());
import { resolveCapabilityForTool } from "./capability-gate";
import { DnaOsHttpClient } from "./adapters/dna-os-http-client";
import { resolveAgentIdentity } from "./identity";
import { projectCapability, projectCapabilityList } from "./capability-projection";
import {
  getCapabilityStatusFact,
  getLatestWorkFact,
  getRuntimeIdentityFact,
  getSystemHealthFact,
  getWorkEvidenceFact,
  getWorkStatusFact,
} from "./runtime-facts";
import {
  capabilitiesPublicView,
  discoverInstalledApplications,
  getApplicationCapabilities,
  getCapabilityBindingStatus,
  getLocalExecutionEvidence,
  getLocalExecutionStatus,
  getLocalResourceForSession,
  getRemoteServiceBinding,
  invokeLocalCapability,
  listApplicationInventory,
  listLocalResourcesForSession,
  listPersistedInventory,
  listRemoteServiceBindings,
  publicRemoteServiceView,
  refreshMachineInventory,
} from "../../control/local-resource-access/contract";
import {
  getDevice,
  getLocalTool,
  getToolHealth,
  listDevices,
  listLocalTools,
  listToolCapabilities,
  listToolHealth,
  refreshLocalToolFabric,
  resolveLocalToolRoute,
} from "../../control/local-tool-fabric/contract";
import {
  applyOwnerReviewDecision,
  attachActionPreview,
  listActivityViewRows,
  listDocumentTemplates,
  listLauncherItems,
  normalizeAiOutputToCanonicalView,
  openOwnerReviewView,
  renderActivityView,
  renderCanonicalView,
} from "../../control/canonical-view/contract";
import {
  createAiHandoff,
  getAiClientDiscovery,
  googleChromeGeminiAvailability,
  inspectLocalForClient,
  invokeSiteTool,
  listSiteTools,
  routeSearch,
} from "../../control/ai-client-bridge/contract";
import {
  MCP_PROTOCOL_COMPAT,
  createResourceHandle,
  decideOwnerComputeFirst,
  evaluateUniversalClient,
  getClientStatus,
  getOwnerEnvironment,
  getResourceHandle,
  getWorkContext,
  listOwnerEnvironments,
  listUniversalClients,
  submitOwnerIntent,
  getAiQueenStatus,
  getAiQueenCapabilityProfile,
} from "../../control/owner-client-runtime/contract";
import { discoverRailwayMcpProvider, railwayMcpBehindDnaOs } from "../railway/mcp-provider";
import {
  getGithubBypassPolicy,
  getGithubMainGovernance,
  getGithubRulesetStatus,
  getRemoteAdmissionGateStatus,
  getRequiredStatusChecks,
} from "../../control/github-branch-governance/contract";
import {
  listAppLauncherItems,
  openOwnerWorkItem,
  ownerSearch,
  ownerWorkSurfaceSnapshot,
  requestOwnerWorkAction,
} from "../../control/owner-work-surface/contract";
import { latestOwnerResponse, mcpOwnerFactResult, peekOwnerResponse } from "../../control/conversation-runtime/owner-response-projection";
import {
  detectCapabilityDrift,
  getCommandStatus,
  getMacosBridgeStatus,
  getMacosPermissionState,
  listCommandQueue,
  listMacosCapabilities,
  listSystemActivity,
  probeEndpointSecurity,
  refreshMacosBridge,
} from "../../control/macos-native-bridge/contract";
import { mcpDiscovery } from "../../control/work-production-pipeline/contract";
import {
  classifySurfaceIntent,
  invokeCodingWorker,
  latestLease,
  latestSession,
  ownerSurfaceSeparationSlice,
  prepareDevelopmentProposal,
} from "../../control/owner-surface-separation/contract";
import {
  applyRegisteredSourceMutation,
  codingKnowledgeFirst,
  createScopedDevelopmentWorktree,
  developmentContext,
  readScopedSource,
} from "../../control/mcp-code-knowledge/contract";
import {
  attentionIndex,
  listActiveWork,
  listDeliveries,
  listNotifications,
  queryNotifications,
  readMacosNotificationPermission,
} from "../../control/owner-notification/contract";
import {
  discoverInboundAdapters,
  getInboundAdapter,
  listSubmittedWork,
  ownerWorkNotificationSummary,
  ownerWorkVisibility,
  workOutputSummary,
} from "../../control/inbound-event-fabric/contract";
import {
  getProductionCheckpoint,
  getSourceLineageStatus,
  getWorkCompletionReadiness,
  getWorkCompletionReport,
  listAdmissionReadyWork,
  listProductionCheckpoints,
  ownerProductionReadinessSummary,
  getLineageClosureStatus,
  githubProtectionStatus,
  inspectDeploymentTargets,
  remoteProductionGate,
  getExistingDeploymentMethod,
  getRealProductionLineage,
  getRemoteAuthenticationStatus,
  getRemoteProductionBinding,
  listRemoteProductionResources,
  getRailwayDeployCapabilityStatus,
  getRemoteDeployment,
  getRemoteDeploymentRevision,
  getRuntimeRevisionAlignment,
} from "../../control/production-checkpoint/contract";
import {
  consumerPayload,
  getActiveActivities,
  getBoundaries,
  getCurrentState,
  getFacts,
  getRecentEvents,
  getRelationships,
  listEntitiesByType,
  projectOwnerInformation,
  queryEntityByCanonicalName,
  queryEntityById,
} from "../../control/canonical-information/query";
import { ensureSafeCanonicalIngest } from "../../control/canonical-information/ingest-safe";

const AgentIdentityShape = z.object({ id: z.string(), email: z.string().optional() }).optional();

export interface McpToolResult {
  [x: string]: unknown;
  content: Array<{ type: "text"; text: string }>;
  structuredContent: Record<string, unknown>;
  isError?: boolean;
}

function textResult(structuredContent: Record<string, unknown>, isError = false): McpToolResult {
  return { content: [{ type: "text", text: JSON.stringify(structuredContent, null, 2) }], structuredContent, isError };
}

function capabilityNotAvailable(correlation_id: string, capability_id: string | null, reason: string): McpToolResult {
  return textResult({ status: "CAPABILITY_NOT_AVAILABLE", correlation_id, capability_id, reason }, true);
}

export interface DnaOsMcpTool {
  metadata: McpToolMetadata;
  inputShape: z.ZodRawShape;
  handler: (args: Record<string, unknown>, client: DnaOsHttpClient) => Promise<McpToolResult>;
}

export const DNA_OS_MCP_TOOLS: readonly DnaOsMcpTool[] = [
  {
    metadata: {
      name: "submit_command",
      title: "Submit DNA OS Command",
      description: "Submit Owner command text into DNA OS submitOwnerCommand (POST /owner/submit-command). DNA OS classifies, routes through the existing command-router and execution-policy, and returns the real task/evidence. This tool never decides the outcome itself.",
      read_write: "write",
      permission_scope: "owner-command",
      evidence_behavior: "returns command_id/task_id/decision/evidence from the real DNA OS response",
      dna_os_capability_id: null,
    },
    inputShape: {
      commandText: z.string().min(1).describe("The command text, exactly as DNA OS's owner-command ingress expects it"),
      work_id: z.string().optional().describe("Canonical work_id to continue; never a command_id"),
      payload: jsonMap.optional().describe("Owner-presented envelope payload such as engineering_coding_intent"),
      agentIdentity: AgentIdentityShape.describe("Correlation-only identity for the MCP response — DNA OS authenticates the Owner via its own session, never via this field as authority"),
    },
    handler: async (args, client) => {
      const correlation_id = randomUUID();
      const gate = resolveCapabilityForTool(null);
      const identity = resolveAgentIdentity(args.agentIdentity as { id?: unknown; email?: unknown } | undefined);
      const response = await client.submitCommand({
        commandText: String(args.commandText),
        ...(typeof args.work_id === "string" ? { work_id: args.work_id } : {}),
        ...(args.payload && typeof args.payload === "object" && !Array.isArray(args.payload) ? { payload: args.payload as Record<string, unknown> } : {}),
      });
      const body = response.body as Record<string, unknown>;
      const result = body.result as Record<string, unknown> | undefined;
      const outputContract = body.output_contract as Record<string, unknown> | undefined;
      const decisionArtifact = Array.isArray(result?.artifacts) ? (result!.artifacts as Array<Record<string, unknown>>).find((a) => a.kind === "decision_id") : undefined;
      return textResult({
        status: response.status,
        correlation_id,
        gate,
        mcp_agent_correlation: identity,
        dna_os_command_id: body.command_id ?? null,
        dna_os_work_id: body.work_id ?? null,
        dna_os_task_id: result?.task_id ?? null,
        dna_os_decision_id: decisionArtifact?.ref ?? null,
        dna_os_result_status: result?.status ?? null,
        output_lane: outputContract?.lane ?? null,
        dispatcher_task_id: outputContract?.dispatcher_task_id ?? null,
        evidence: result?.evidence ?? [],
        error: body.error ?? null,
        reason_code: body.reason_code ?? null,
        raw: body,
      });
    },
  },
  {
    metadata: {
      name: "list_capabilities",
      title: "List DNA OS Capabilities",
      description: "List sanitized, model-visible rows from the existing command-router capability registry. Not a second registry. Omits endpoints, contract paths, secrets, and credentials.",
      read_write: "read",
      permission_scope: "registry-lookup",
      evidence_behavior: "returns a sanitized projection of control/command-router/capability-registry.ts",
      dna_os_capability_id: null,
    },
    inputShape: {},
    handler: async () => {
      const correlation_id = randomUUID();
      const gate = resolveCapabilityForTool(null);
      const capabilities = projectCapabilityList();
      return textResult({
        status: 200,
        correlation_id,
        gate,
        source: "control/command-router/capability-registry.ts",
        capabilities,
      });
    },
  },
  {
    metadata: {
      name: "lookup_capability",
      title: "Lookup Registered Capability",
      description: "Look up one sanitized capability row from the existing command-router registry.",
      read_write: "read",
      permission_scope: "registry-lookup",
      evidence_behavior: "returns a sanitized projection of control/command-router/capability-registry.ts",
      dna_os_capability_id: null,
    },
    inputShape: { capability_id: z.string().min(1) },
    handler: async (args) => {
      const correlation_id = randomUUID();
      const gate = resolveCapabilityForTool(null);
      const capability = projectCapability(String(args.capability_id));
      const found = capability !== null;
      return textResult({
        status: found ? 200 : 404,
        correlation_id,
        gate,
        found,
        capability,
        reason: found ? null : "CAPABILITY_NOT_FOUND",
      });
    },
  },
  {
    metadata: {
      name: "get_resource",
      title: "Get Registered Resource",
      description: "Look up one resource by resource_id via DNA OS's real findResourceById. Returns the real row, or a clean not-found result — never fabricated.",
      read_write: "read",
      permission_scope: "registry-lookup",
      evidence_behavior: "returns the real registry row or null, no evidence trail generated by a lookup",
      dna_os_capability_id: null,
    },
    inputShape: { resource_id: z.string().min(1) },
    handler: async (args, client) => {
      const correlation_id = randomUUID();
      const gate = resolveCapabilityForTool(null);
      const response = await client.getResource(String(args.resource_id));
      const found = response.status === 200;
      return textResult({
        status: response.status,
        correlation_id,
        gate,
        found,
        resource: found ? response.body : null,
        reason: found ? null : "RESOURCE_NOT_FOUND",
      });
    },
  },
  {
    metadata: {
      name: "get_task",
      title: "Get Task Status/Result/Evidence",
      description: "Look up one task's real status, result, explanation, and handoffs by task_id via DNA OS's real agent-gateway task store.",
      read_write: "read",
      permission_scope: "task-status",
      evidence_behavior: "returns the real task/result/evidence trail for an existing task_id",
      dna_os_capability_id: null,
    },
    inputShape: { task_id: z.string().min(1) },
    handler: async (args, client) => {
      const correlation_id = randomUUID();
      const gate = resolveCapabilityForTool(null);
      const response = await client.getTask(String(args.task_id));
      const found = response.status === 200;
      const body = response.body as Record<string, unknown> | undefined;
      const task = body?.task as Record<string, unknown> | undefined;
      return textResult({
        status: response.status,
        correlation_id,
        gate,
        found,
        output_lane: task?.output_lane ?? null,
        task: found ? response.body : null,
        reason: found ? null : "TASK_NOT_FOUND",
      });
    },
  },
  {
    metadata: {
      name: "submit_work_result",
      title: "Submit Agent Work Result",
      description: "Submit a completed-work result for an existing, EXECUTING/VERIFYING task through DNA OS's real canonical Work Result Ingress (control/work-result-ingress/): validates task/worker/session, classifies the result's contents, splits them into individual Registration Candidates (each changed file, each test result, each explicitly-declared new capability — never one resource standing in for the whole submission), runs each through the real Registration Pipeline, then records the handoff as evidence of the delivery and computes the next decision from real persisted evidence. This tool never bypasses any of that.",
      read_write: "write",
      permission_scope: "work-result-ingress",
      evidence_behavior: "returns the real registered artifacts (resource_id/capability_id per split piece), the handoff recorded as evidence, and the next decision computed from persisted evidence",
      dna_os_capability_id: "dispatcher",
    },
    inputShape: {
      task_id: z.string().min(1),
      agent_id: z.string().min(1),
      role: z.string().min(1),
      input_reference: z.string(),
      files_read: z.array(z.string()).default([]),
      files_changed: z.array(z.string()).default([]),
      tests_run: z.array(z.string()).default([]),
      status: z.enum(["RECEIVED", "IN_PROGRESS", "VERIFIED", "FAILED", "BLOCKED"]),
      evidence_refs: z.array(z.string()).default([]),
      blockers: z.array(z.string()).default([]),
      next_action: z.string().nullable().default(null),
      capabilities_introduced: z
        .array(z.object({ name: z.string(), source_location: z.string(), purpose: z.string() }))
        .optional()
        .describe("New capabilities this work result explicitly introduces — never inferred from files_changed, only ever registered when named here"),
    },
    handler: async (args, client) => {
      const correlation_id = randomUUID();
      const gate = resolveCapabilityForTool("dispatcher");
      if (gate.status === "CAPABILITY_NOT_AVAILABLE") return capabilityNotAvailable(correlation_id, gate.capability_id, gate.reason);
      const response = await client.submitWorkResult(args);
      const body = response.body as Record<string, unknown>;
      return textResult({
        status: response.status,
        correlation_id,
        gate,
        dna_os_decision: body.status ?? null,
        ingress_status: body.ingress_status ?? null,
        handoff_id: body.handoff_id ?? null,
        artifacts: body.artifacts ?? [],
        next_decision: body.next_decision ?? null,
        error: body.error ?? null,
        raw: body,
      });
    },
  },
  {
    metadata: {
      name: "get_system_status",
      title: "Get DNA OS System Status",
      description: "Read DNA OS's real live capability/runtime inventory (transport, supervisor, evidence store, and every capability's real registry_status/live_status). Never a static or fabricated summary.",
      read_write: "read",
      permission_scope: "system-status",
      evidence_behavior: "returns the real live capability/runtime inventory, each entry with its own evidence array",
      dna_os_capability_id: null,
    },
    inputShape: {},
    handler: async (_args, client) => {
      const correlation_id = randomUUID();
      const gate = resolveCapabilityForTool(null);
      const response = await client.getSystemStatus();
      return textResult({ status: response.status, correlation_id, gate, system_status: response.body });
    },
  },
  {
    metadata: {
      name: "dna_os.get_runtime_identity",
      title: "DNA OS Runtime Identity",
      description: "Return DNA OS runtime and system instance identity from DNA OS itself. Never credentials.",
      read_write: "read",
      permission_scope: "system-status",
      evidence_behavior: "returns DNA OS runtime/evidence facts with a DNA_OS_RUNTIME proof envelope",
      dna_os_capability_id: null,
    },
    inputShape: {},
    handler: async () => {
      const correlation_id = randomUUID();
      return textResult({ status: 200, correlation_id, gate: resolveCapabilityForTool(null), ...getRuntimeIdentityFact() });
    },
  },
  {
    metadata: {
      name: "dna_os.get_system_health",
      title: "DNA OS System Health",
      description: "Return structured DNA OS health from the runtime and capability registry. Not inferred from GitHub.",
      read_write: "read",
      permission_scope: "system-status",
      evidence_behavior: "returns DNA OS runtime/evidence facts with a DNA_OS_RUNTIME proof envelope",
      dna_os_capability_id: null,
    },
    inputShape: {},
    handler: async () => {
      const correlation_id = randomUUID();
      return textResult({ status: 200, correlation_id, gate: resolveCapabilityForTool(null), ...getSystemHealthFact() });
    },
  },
  {
    metadata: {
      name: "dna_os.get_latest_work",
      title: "DNA OS Latest Work",
      description: "Return the latest canonical work fact recorded by DNA OS runtime/evidence.",
      read_write: "read",
      permission_scope: "task-status",
      evidence_behavior: "returns DNA OS runtime/evidence facts with a DNA_OS_RUNTIME proof envelope",
      dna_os_capability_id: null,
    },
    inputShape: {},
    handler: async () => {
      const correlation_id = randomUUID();
      return textResult({ status: 200, correlation_id, gate: resolveCapabilityForTool(null), ...getLatestWorkFact() });
    },
  },
  {
    metadata: {
      name: "dna_os.get_work_status",
      title: "DNA OS Work Status",
      description: "Return DNA OS lifecycle status for a canonical work_id from persisted runtime evidence.",
      read_write: "read",
      permission_scope: "task-status",
      evidence_behavior: "returns DNA OS runtime/evidence facts with a DNA_OS_RUNTIME proof envelope",
      dna_os_capability_id: null,
    },
    inputShape: { work_id: z.string().optional() },
    handler: async (args) => {
      const correlation_id = randomUUID();
      const workId = typeof args.work_id === "string" ? args.work_id : undefined;
      return textResult({ status: 200, correlation_id, gate: resolveCapabilityForTool(null), ...getWorkStatusFact(workId) });
    },
  },
  {
    metadata: {
      name: "dna_os.get_work_evidence",
      title: "DNA OS Work Evidence",
      description: "Return DNA OS persisted evidence for a work_id, including GitHub remote proof and workspace cleanup proof when recorded. Never secrets.",
      read_write: "read",
      permission_scope: "task-status",
      evidence_behavior: "returns DNA OS runtime/evidence facts with a DNA_OS_RUNTIME proof envelope",
      dna_os_capability_id: null,
    },
    inputShape: { work_id: z.string().optional() },
    handler: async (args) => {
      const correlation_id = randomUUID();
      const workId = typeof args.work_id === "string" ? args.work_id : undefined;
      return textResult({ status: 200, correlation_id, gate: resolveCapabilityForTool(null), ...getWorkEvidenceFact(workId) });
    },
  },
  {
    metadata: {
      name: "dna_os.get_capability_status",
      title: "DNA OS Capability Status",
      description: "Return sanitized capability health from the existing command-router registry.",
      read_write: "read",
      permission_scope: "registry-lookup",
      evidence_behavior: "returns DNA OS runtime/evidence facts with a DNA_OS_RUNTIME proof envelope",
      dna_os_capability_id: null,
    },
    inputShape: { capability_id: z.string().optional() },
    handler: async (args) => {
      const correlation_id = randomUUID();
      const capabilityId = typeof args.capability_id === "string" ? args.capability_id : undefined;
      return textResult({ status: 200, correlation_id, gate: resolveCapabilityForTool(null), ...getCapabilityStatusFact(capabilityId) });
    },
  },
  {
    metadata: {
      name: "dna_os.list_local_resources",
      title: "List Owner-authorized local resources",
      description: "List LOCAL_RESOURCE_V1 rows this AI session is allowed to see. Unknown sessions receive an empty list.",
      read_write: "read",
      permission_scope: "local-resource-access",
      evidence_behavior: "returns DNA_OS_LOCAL_EXECUTION evidence after Owner-policy local resource authorization",
      dna_os_capability_id: "local-resource-access",
    },
    inputShape: { ai_client_id: z.string(), session_id: z.string() },
    handler: async (args) => {
      const correlation_id = randomUUID();
      const gate = resolveCapabilityForTool("local-resource-access");
      if (gate.status !== "REGISTERED_VERIFIED_AVAILABLE") return capabilityNotAvailable(correlation_id, gate.capability_id, gate.reason);
      const ai = String(args.ai_client_id ?? "");
      const session = String(args.session_id ?? "");
      return textResult({ status: 200, correlation_id, gate, source: "DNA_OS_RUNTIME", resources: listLocalResourcesForSession(ai, session) });
    },
  },
  {
    metadata: {
      name: "dna_os.get_local_resource",
      title: "Get one Owner-authorized local resource",
      description: "Return one registered local resource if this session may see it.",
      read_write: "read",
      permission_scope: "local-resource-access",
      evidence_behavior: "returns DNA_OS_LOCAL_EXECUTION evidence after Owner-policy local resource authorization",
      dna_os_capability_id: "local-resource-access",
    },
    inputShape: { ai_client_id: z.string(), session_id: z.string(), resource_id: z.string() },
    handler: async (args) => {
      const correlation_id = randomUUID();
      const gate = resolveCapabilityForTool("local-resource-access");
      if (gate.status !== "REGISTERED_VERIFIED_AVAILABLE") return capabilityNotAvailable(correlation_id, gate.capability_id, gate.reason);
      const resource = getLocalResourceForSession(String(args.ai_client_id ?? ""), String(args.session_id ?? ""), String(args.resource_id ?? ""));
      return textResult({ status: resource ? 200 : 404, correlation_id, gate, source: "DNA_OS_RUNTIME", resource });
    },
  },
  {
    metadata: {
      name: "dna_os.get_local_capabilities",
      title: "List local resource capabilities",
      description: "Return the safe local capability catalog. Invocation still requires an Owner grant.",
      read_write: "read",
      permission_scope: "local-resource-access",
      evidence_behavior: "returns DNA_OS_LOCAL_EXECUTION evidence after Owner-policy local resource authorization",
      dna_os_capability_id: "local-resource-access",
    },
    inputShape: {},
    handler: async () => {
      const correlation_id = randomUUID();
      const gate = resolveCapabilityForTool("local-resource-access");
      if (gate.status !== "REGISTERED_VERIFIED_AVAILABLE") return capabilityNotAvailable(correlation_id, gate.capability_id, gate.reason);
      return textResult({ status: 200, correlation_id, gate, source: "DNA_OS_RUNTIME", capabilities: capabilitiesPublicView() });
    },
  },
  {
    metadata: {
      name: "dna_os.create_scoped_workspace",
      title: "Create a scoped local workspace",
      description: "Create a DNA OS scoped workspace for authorized local resources. Unmanaged Owner files are never attached.",
      read_write: "write",
      permission_scope: "local-resource-access",
      evidence_behavior: "returns DNA_OS_LOCAL_EXECUTION evidence after Owner-policy local resource authorization",
      dna_os_capability_id: "local-resource-access",
    },
    inputShape: {
      ai_client_id: z.string(),
      session_id: z.string(),
      work_id: z.string(),
      resource_id: z.string(),
      resource_ids: z.array(z.string()).optional(),
    },
    handler: async (args) => {
      const correlation_id = randomUUID();
      const gate = resolveCapabilityForTool("local-resource-access");
      if (gate.status !== "REGISTERED_VERIFIED_AVAILABLE") return capabilityNotAvailable(correlation_id, gate.capability_id, gate.reason);
      const invoked = await invokeLocalCapability({
        ai_client_id: String(args.ai_client_id ?? ""),
        session_id: String(args.session_id ?? ""),
        work_id: String(args.work_id ?? ""),
        capability: "local.workspace.create",
        resource_id: String(args.resource_id ?? ""),
        input: { resource_ids: args.resource_ids ?? [args.resource_id] },
      });
      return textResult({ status: invoked.ok ? 200 : 403, correlation_id, gate, source: "DNA_OS_RUNTIME", ...invoked }, !invoked.ok);
    },
  },
  {
    metadata: {
      name: "dna_os.invoke_local_capability",
      title: "Invoke an Owner-authorized local capability",
      description: "Run a registered local capability under Owner policy. Arbitrary shell and unrestricted filesystem access are not available.",
      read_write: "write",
      permission_scope: "local-resource-access",
      evidence_behavior: "returns DNA_OS_LOCAL_EXECUTION evidence after Owner-policy local resource authorization",
      dna_os_capability_id: "local-resource-access",
    },
    inputShape: {
      ai_client_id: z.string(),
      session_id: z.string(),
      work_id: z.string(),
      capability: z.string(),
      resource_id: z.string(),
      input: jsonMap.optional(),
    },
    handler: async (args) => {
      const correlation_id = randomUUID();
      const gate = resolveCapabilityForTool("local-resource-access");
      if (gate.status !== "REGISTERED_VERIFIED_AVAILABLE") return capabilityNotAvailable(correlation_id, gate.capability_id, gate.reason);
      const capability = String(args.capability ?? "");
      if (capability === "execute_any_command" || capability === "read_any_path" || capability === "write_any_path") {
        return textResult({ status: 403, correlation_id, gate, source: "DNA_OS_RUNTIME", denied: true, reason_code: "UNKNOWN_CAPABILITY" }, true);
      }
      const invoked = await invokeLocalCapability({
        ai_client_id: String(args.ai_client_id ?? ""),
        session_id: String(args.session_id ?? ""),
        work_id: String(args.work_id ?? ""),
        capability: capability as never,
        resource_id: String(args.resource_id ?? ""),
        input: (args.input && typeof args.input === "object") ? args.input as Record<string, unknown> : {},
      });
      return textResult({ status: invoked.ok ? 200 : 403, correlation_id, gate, source: "DNA_OS_RUNTIME", ...invoked }, !invoked.ok);
    },
  },
  {
    metadata: {
      name: "dna_os.get_local_execution_status",
      title: "Local execution status",
      description: "Return DNA_OS_LOCAL_EXECUTION status for a work_id.",
      read_write: "read",
      permission_scope: "local-resource-access",
      evidence_behavior: "returns DNA_OS_LOCAL_EXECUTION evidence after Owner-policy local resource authorization",
      dna_os_capability_id: "local-resource-access",
    },
    inputShape: { work_id: z.string(), execution_id: z.string().optional() },
    handler: async (args) => {
      const correlation_id = randomUUID();
      const gate = resolveCapabilityForTool("local-resource-access");
      if (gate.status !== "REGISTERED_VERIFIED_AVAILABLE") return capabilityNotAvailable(correlation_id, gate.capability_id, gate.reason);
      return textResult({ status: 200, correlation_id, gate, ...getLocalExecutionStatus(String(args.work_id ?? ""), typeof args.execution_id === "string" ? args.execution_id : undefined) });
    },
  },
  {
    metadata: {
      name: "dna_os.get_local_execution_evidence",
      title: "Local execution evidence",
      description: "Return DNA_OS_LOCAL_EXECUTION envelopes. Never secrets or unrestricted paths.",
      read_write: "read",
      permission_scope: "local-resource-access",
      evidence_behavior: "returns DNA_OS_LOCAL_EXECUTION evidence after Owner-policy local resource authorization",
      dna_os_capability_id: "local-resource-access",
    },
    inputShape: { work_id: z.string(), execution_id: z.string().optional() },
    handler: async (args) => {
      const correlation_id = randomUUID();
      const gate = resolveCapabilityForTool("local-resource-access");
      if (gate.status !== "REGISTERED_VERIFIED_AVAILABLE") return capabilityNotAvailable(correlation_id, gate.capability_id, gate.reason);
      return textResult({ status: 200, correlation_id, gate, ...getLocalExecutionEvidence(String(args.work_id ?? ""), typeof args.execution_id === "string" ? args.execution_id : undefined) });
    },
  },
  {
    metadata: {
      name: "dna_os.get_machine_inventory",
      title: "Machine capability inventory",
      description: "Refresh and return MACHINE_CAPABILITY_INVENTORY_V1. Discovery never grants authority.",
      read_write: "read",
      permission_scope: "local-resource-access",
      evidence_behavior: "returns DNA_OS_LOCAL_EXECUTION evidence after Owner-policy local resource authorization",
      dna_os_capability_id: "local-resource-access",
    },
    inputShape: { ai_client_id: z.string().optional(), session_id: z.string().optional(), work_id: z.string().optional() },
    handler: async (args) => {
      const correlation_id = randomUUID();
      const gate = resolveCapabilityForTool("local-resource-access");
      if (gate.status !== "REGISTERED_VERIFIED_AVAILABLE") return capabilityNotAvailable(correlation_id, gate.capability_id, gate.reason);
      const ai = String(args.ai_client_id ?? "ai://mcp-discovery");
      const session = String(args.session_id ?? "session-mcp-discovery");
      const work = String(args.work_id ?? `work-inventory-${correlation_id}`);
      const inventory = refreshMachineInventory(work, session, ai);
      return textResult({
        status: 200, correlation_id, gate, source: "DNA_OS_RUNTIME",
        schema: "MACHINE_CAPABILITY_INVENTORY_V1",
        discovery_grants_authority: false,
        inventory,
        persisted: listPersistedInventory(),
      });
    },
  },
  {
    metadata: {
      name: "dna_os.list_applications",
      title: "List discovered and registered applications",
      description: "List installed applications from OS metadata. usage_authorized remains false until Owner enablement.",
      read_write: "read",
      permission_scope: "local-resource-access",
      evidence_behavior: "returns DNA_OS_LOCAL_EXECUTION evidence after Owner-policy local resource authorization",
      dna_os_capability_id: "local-resource-access",
    },
    inputShape: { ai_client_id: z.string().optional(), session_id: z.string().optional(), work_id: z.string().optional() },
    handler: async (args) => {
      const correlation_id = randomUUID();
      const gate = resolveCapabilityForTool("local-resource-access");
      if (gate.status !== "REGISTERED_VERIFIED_AVAILABLE") return capabilityNotAvailable(correlation_id, gate.capability_id, gate.reason);
      const discovered = discoverInstalledApplications(String(args.work_id ?? `work-apps-${correlation_id}`), String(args.session_id ?? "session-mcp-discovery"));
      const registered = listApplicationInventory(typeof args.ai_client_id === "string" ? args.ai_client_id : null, typeof args.session_id === "string" ? args.session_id : null);
      return textResult({
        status: 200, correlation_id, gate, source: "DNA_OS_RUNTIME",
        discovered,
        registered,
        usage_authorized: false,
      });
    },
  },
  {
    metadata: {
      name: "dna_os.get_application_capabilities",
      title: "Get application canonical capabilities",
      description: "Return declared vs verified vs Owner-enabled states for one registered application.",
      read_write: "read",
      permission_scope: "local-resource-access",
      evidence_behavior: "returns DNA_OS_LOCAL_EXECUTION evidence after Owner-policy local resource authorization",
      dna_os_capability_id: "local-resource-access",
    },
    inputShape: { application_id: z.string(), ai_client_id: z.string().optional(), session_id: z.string().optional() },
    handler: async (args) => {
      const correlation_id = randomUUID();
      const gate = resolveCapabilityForTool("local-resource-access");
      if (gate.status !== "REGISTERED_VERIFIED_AVAILABLE") return capabilityNotAvailable(correlation_id, gate.capability_id, gate.reason);
      const capabilities = getApplicationCapabilities(
        String(args.application_id ?? ""),
        typeof args.ai_client_id === "string" ? args.ai_client_id : null,
        typeof args.session_id === "string" ? args.session_id : null,
      );
      return textResult({ status: capabilities ? 200 : 404, correlation_id, gate, source: "DNA_OS_RUNTIME", capabilities });
    },
  },
  {
    metadata: {
      name: "dna_os.list_remote_services",
      title: "List remote service bindings",
      description: "List REMOTE_SERVICE_CAPABILITY_BINDING_V1 rows. Unconnected providers are NOT_AVAILABLE.",
      read_write: "read",
      permission_scope: "local-resource-access",
      evidence_behavior: "returns DNA_OS_LOCAL_EXECUTION evidence after Owner-policy local resource authorization",
      dna_os_capability_id: "local-resource-access",
    },
    inputShape: { ai_client_id: z.string().optional(), session_id: z.string().optional() },
    handler: async (args) => {
      const correlation_id = randomUUID();
      const gate = resolveCapabilityForTool("local-resource-access");
      if (gate.status !== "REGISTERED_VERIFIED_AVAILABLE") return capabilityNotAvailable(correlation_id, gate.capability_id, gate.reason);
      const services = listRemoteServiceBindings(
        typeof args.ai_client_id === "string" ? args.ai_client_id : null,
        typeof args.session_id === "string" ? args.session_id : null,
      ).map(publicRemoteServiceView);
      return textResult({ status: 200, correlation_id, gate, source: "DNA_OS_RUNTIME", services });
    },
  },
  {
    metadata: {
      name: "dna_os.get_remote_service_capabilities",
      title: "Get one remote service binding",
      description: "Return canonical action mapping and five-state capability atoms for one service_id.",
      read_write: "read",
      permission_scope: "local-resource-access",
      evidence_behavior: "returns DNA_OS_LOCAL_EXECUTION evidence after Owner-policy local resource authorization",
      dna_os_capability_id: "local-resource-access",
    },
    inputShape: { service_id: z.string(), ai_client_id: z.string().optional(), session_id: z.string().optional() },
    handler: async (args) => {
      const correlation_id = randomUUID();
      const gate = resolveCapabilityForTool("local-resource-access");
      if (gate.status !== "REGISTERED_VERIFIED_AVAILABLE") return capabilityNotAvailable(correlation_id, gate.capability_id, gate.reason);
      const binding = getRemoteServiceBinding(
        String(args.service_id ?? ""),
        typeof args.ai_client_id === "string" ? args.ai_client_id : null,
        typeof args.session_id === "string" ? args.session_id : null,
      );
      return textResult({
        status: binding ? 200 : 404,
        correlation_id,
        gate,
        source: "DNA_OS_RUNTIME",
        binding: binding ? publicRemoteServiceView(binding) : null,
      });
    },
  },
  {
    metadata: {
      name: "dna_os.get_capability_binding_status",
      title: "Get capability binding status",
      description: "Return DECLARED / ADAPTER_PRESENT / AUTHENTICATION_READY / RUNTIME_VERIFIED / OWNER_ENABLED for a binding_id.",
      read_write: "read",
      permission_scope: "local-resource-access",
      evidence_behavior: "returns DNA_OS_LOCAL_EXECUTION evidence after Owner-policy local resource authorization",
      dna_os_capability_id: "local-resource-access",
    },
    inputShape: { binding_id: z.string(), ai_client_id: z.string(), session_id: z.string() },
    handler: async (args) => {
      const correlation_id = randomUUID();
      const gate = resolveCapabilityForTool("local-resource-access");
      if (gate.status !== "REGISTERED_VERIFIED_AVAILABLE") return capabilityNotAvailable(correlation_id, gate.capability_id, gate.reason);
      const status = getCapabilityBindingStatus(String(args.binding_id ?? ""), String(args.ai_client_id ?? ""), String(args.session_id ?? ""));
      return textResult({ status: 200, correlation_id, gate, source: "DNA_OS_RUNTIME", binding: status });
    },
  },
  {
    metadata: {
      name: "dna_os.list_local_tools",
      title: "List local tool adapters",
      description: "Read-only LOCAL_TOOL_ADAPTER_FABRIC_V1 discovery. Adapter existence does not grant authority.",
      read_write: "read",
      permission_scope: "local-resource-access",
      evidence_behavior: "returns DNA_OS_LOCAL_EXECUTION evidence after Owner-policy local resource authorization",
      dna_os_capability_id: "local-resource-access",
    },
    inputShape: { ai_client_id: z.string().optional(), session_id: z.string().optional(), work_id: z.string().optional() },
    handler: async (args) => {
      const correlation_id = randomUUID();
      const gate = resolveCapabilityForTool("local-resource-access");
      if (gate.status !== "REGISTERED_VERIFIED_AVAILABLE") return capabilityNotAvailable(correlation_id, gate.capability_id, gate.reason);
      const ai = String(args.ai_client_id ?? "ai://mcp-discovery");
      const session = String(args.session_id ?? "session-mcp-discovery");
      const work = String(args.work_id ?? `work-tools-${correlation_id}`);
      const tools = refreshLocalToolFabric(work, session, ai);
      return textResult({
        status: 200, correlation_id, gate, source: "DNA_OS_RUNTIME",
        schema: "LOCAL_TOOL_ADAPTER_FABRIC_V1",
        discovery_grants_authority: false,
        tools: tools.map((row) => ({
          adapter_id: row.adapter_id,
          adapter_type: row.adapter_type,
          availability: row.availability,
          capabilities_verified: row.capabilities_verified,
          owner_enabled: row.owner_enabled,
          grants_authority: row.grants_authority,
        })),
        persisted: listLocalTools().length,
      });
    },
  },
  {
    metadata: {
      name: "dna_os.get_local_tool",
      title: "Get one local tool adapter",
      description: "Return one LOCAL_TOOL_ADAPTER_FABRIC_V1 row. Execution stays on invoke_local_capability.",
      read_write: "read",
      permission_scope: "local-resource-access",
      evidence_behavior: "returns DNA_OS_LOCAL_EXECUTION evidence after Owner-policy local resource authorization",
      dna_os_capability_id: "local-resource-access",
    },
    inputShape: {
      adapter_id: z.string(),
      ai_client_id: z.string().optional(),
      session_id: z.string().optional(),
      work_id: z.string().optional(),
    },
    handler: async (args) => {
      const correlation_id = randomUUID();
      const gate = resolveCapabilityForTool("local-resource-access");
      if (gate.status !== "REGISTERED_VERIFIED_AVAILABLE") return capabilityNotAvailable(correlation_id, gate.capability_id, gate.reason);
      refreshLocalToolFabric(
        String(args.work_id ?? `work-tool-${correlation_id}`),
        String(args.session_id ?? "session-mcp-discovery"),
        String(args.ai_client_id ?? "ai://mcp-discovery"),
      );
      const tool = getLocalTool(String(args.adapter_id ?? ""));
      return textResult({ status: tool ? 200 : 404, correlation_id, gate, source: "DNA_OS_RUNTIME", tool });
    },
  },
  {
    metadata: {
      name: "dna_os.list_tool_capabilities",
      title: "List verified local tool capabilities",
      description: "Declared vs verified canonical actions. Category does not imply capability.",
      read_write: "read",
      permission_scope: "local-resource-access",
      evidence_behavior: "returns DNA_OS_LOCAL_EXECUTION evidence after Owner-policy local resource authorization",
      dna_os_capability_id: "local-resource-access",
    },
    inputShape: { ai_client_id: z.string().optional(), session_id: z.string().optional(), work_id: z.string().optional() },
    handler: async (args) => {
      const correlation_id = randomUUID();
      const gate = resolveCapabilityForTool("local-resource-access");
      if (gate.status !== "REGISTERED_VERIFIED_AVAILABLE") return capabilityNotAvailable(correlation_id, gate.capability_id, gate.reason);
      refreshLocalToolFabric(
        String(args.work_id ?? `work-caps-${correlation_id}`),
        String(args.session_id ?? "session-mcp-discovery"),
        String(args.ai_client_id ?? "ai://mcp-discovery"),
      );
      return textResult({
        status: 200, correlation_id, gate, source: "DNA_OS_RUNTIME",
        capabilities: listToolCapabilities(),
        APP_CATEGORY_IMPLIES_CAPABILITY: false,
      });
    },
  },
  {
    metadata: {
      name: "dna_os.get_tool_health",
      title: "Get tool capability health",
      description: "Distinguish APPLICATION_INSTALLED, ADAPTER_AVAILABLE, CAPABILITY_VERIFIED, and AUTHORIZED.",
      read_write: "read",
      permission_scope: "local-resource-access",
      evidence_behavior: "returns DNA_OS_LOCAL_EXECUTION evidence after Owner-policy local resource authorization",
      dna_os_capability_id: "local-resource-access",
    },
    inputShape: {
      tool_id: z.string().optional(),
      ai_client_id: z.string().optional(),
      session_id: z.string().optional(),
      work_id: z.string().optional(),
    },
    handler: async (args) => {
      const correlation_id = randomUUID();
      const gate = resolveCapabilityForTool("local-resource-access");
      if (gate.status !== "REGISTERED_VERIFIED_AVAILABLE") return capabilityNotAvailable(correlation_id, gate.capability_id, gate.reason);
      refreshLocalToolFabric(
        String(args.work_id ?? `work-health-${correlation_id}`),
        String(args.session_id ?? "session-mcp-discovery"),
        String(args.ai_client_id ?? "ai://mcp-discovery"),
      );
      const tool_id = typeof args.tool_id === "string" ? args.tool_id : null;
      const health = tool_id ? getToolHealth(tool_id) : listToolHealth();
      return textResult({
        status: tool_id && !health ? 404 : 200,
        correlation_id, gate, source: "DNA_OS_RUNTIME",
        schema: "TOOL_CAPABILITY_HEALTH_V1",
        health,
      });
    },
  },
  {
    metadata: {
      name: "dna_os.list_devices",
      title: "List DEVICE_RESOURCE_V1 rows",
      description: "Hardware discovery only. Discovery grants no authority and no mutation.",
      read_write: "read",
      permission_scope: "local-resource-access",
      evidence_behavior: "returns DNA_OS_LOCAL_EXECUTION evidence after Owner-policy local resource authorization",
      dna_os_capability_id: "local-resource-access",
    },
    inputShape: { ai_client_id: z.string().optional(), session_id: z.string().optional(), work_id: z.string().optional() },
    handler: async (args) => {
      const correlation_id = randomUUID();
      const gate = resolveCapabilityForTool("local-resource-access");
      if (gate.status !== "REGISTERED_VERIFIED_AVAILABLE") return capabilityNotAvailable(correlation_id, gate.capability_id, gate.reason);
      refreshLocalToolFabric(
        String(args.work_id ?? `work-devices-${correlation_id}`),
        String(args.session_id ?? "session-mcp-discovery"),
        String(args.ai_client_id ?? "ai://mcp-discovery"),
      );
      const devices = listDevices();
      return textResult({
        status: 200, correlation_id, gate, source: "DNA_OS_RUNTIME",
        schema: "DEVICE_RESOURCE_V1",
        discovery_grants_authority: false,
        devices: devices.map((row) => ({
          device_id: row.device_id,
          device_type: row.device_type,
          availability: row.availability,
          owner_enabled: row.owner_enabled,
          grants_authority: row.grants_authority,
          capabilities: row.resource_id ? row.capabilities : [],
        })),
      });
    },
  },
  {
    metadata: {
      name: "dna_os.get_device",
      title: "Get one device resource",
      description: "Return one DEVICE_RESOURCE_V1 row without enabling mutation.",
      read_write: "read",
      permission_scope: "local-resource-access",
      evidence_behavior: "returns DNA_OS_LOCAL_EXECUTION evidence after Owner-policy local resource authorization",
      dna_os_capability_id: "local-resource-access",
    },
    inputShape: { device_id: z.string() },
    handler: async (args) => {
      const correlation_id = randomUUID();
      const gate = resolveCapabilityForTool("local-resource-access");
      if (gate.status !== "REGISTERED_VERIFIED_AVAILABLE") return capabilityNotAvailable(correlation_id, gate.capability_id, gate.reason);
      const device = getDevice(String(args.device_id ?? ""));
      return textResult({ status: device ? 200 : 404, correlation_id, gate, source: "DNA_OS_RUNTIME", device });
    },
  },
  {
    metadata: {
      name: "dna_os.resolve_local_tool_route",
      title: "Resolve native-first local tool route",
      description: "NATIVE_INTERFACE_FIRST_V1 ranking. Does not execute. Accessibility is never selected when a structured adapter exists.",
      read_write: "read",
      permission_scope: "local-resource-access",
      evidence_behavior: "returns DNA_OS_LOCAL_EXECUTION evidence after Owner-policy local resource authorization",
      dna_os_capability_id: "local-resource-access",
    },
    inputShape: {
      action: z.string(),
      application_id: z.string().optional(),
      resource_id: z.string().optional(),
      device_id: z.string().optional(),
      ai_client_id: z.string().optional(),
      session_id: z.string().optional(),
      work_id: z.string().optional(),
    },
    handler: async (args) => {
      const correlation_id = randomUUID();
      const gate = resolveCapabilityForTool("local-resource-access");
      if (gate.status !== "REGISTERED_VERIFIED_AVAILABLE") return capabilityNotAvailable(correlation_id, gate.capability_id, gate.reason);
      refreshLocalToolFabric(
        String(args.work_id ?? `work-route-${correlation_id}`),
        String(args.session_id ?? "session-mcp-discovery"),
        String(args.ai_client_id ?? "ai://mcp-discovery"),
      );
      const route = resolveLocalToolRoute({
        action: String(args.action ?? ""),
        application_id: typeof args.application_id === "string" ? args.application_id : undefined,
        resource_id: typeof args.resource_id === "string" ? args.resource_id : undefined,
        device_id: typeof args.device_id === "string" ? args.device_id : undefined,
      });
      return textResult({
        status: 200, correlation_id, gate, source: "DNA_OS_RUNTIME",
        route: {
          schema: route.schema,
          order: route.order,
          selected_adapter_id: route.selected?.adapter_id ?? null,
          selected_adapter_type: route.selected?.adapter_type ?? null,
          reason_code: route.reason_code,
          accessibility_used: route.accessibility_used,
        },
      });
    },
  },
  {
    metadata: {
      name: "dna_os.render_canonical_view",
      title: "Render a registered canonical view",
      description: "Render CANONICAL_VIEW_V1 from a registered schema. Arbitrary HTML/layout is not accepted.",
      read_write: "read",
      permission_scope: "local-resource-access",
      evidence_behavior: "returns DNA_OS_LOCAL_EXECUTION evidence after Owner-policy local resource authorization",
      dna_os_capability_id: "local-resource-access",
    },
    inputShape: {
      view_type: z.string(),
      data_schema: z.string().optional(),
      rows: z.array(jsonMap).optional(),
      fields: jsonMap.optional(),
      source_resource_ids: z.array(z.string()).optional(),
      filter_field: z.string().optional(),
      filter_contains: z.string().optional(),
      sort_field: z.string().optional(),
    },
    handler: async (args) => {
      const correlation_id = randomUUID();
      const gate = resolveCapabilityForTool("local-resource-access");
      if (gate.status !== "REGISTERED_VERIFIED_AVAILABLE") return capabilityNotAvailable(correlation_id, gate.capability_id, gate.reason);
      const view = renderCanonicalView({
        view_type: String(args.view_type ?? "SAFE_GENERIC_VIEW") as never,
        data_schema: typeof args.data_schema === "string" ? args.data_schema : undefined,
        rows: Array.isArray(args.rows) ? args.rows as Record<string, unknown>[] : undefined,
        fields: args.fields && typeof args.fields === "object" ? args.fields as Record<string, unknown> : undefined,
        source_resource_ids: Array.isArray(args.source_resource_ids) ? args.source_resource_ids.map(String) : undefined,
        filter_field: typeof args.filter_field === "string" ? args.filter_field : undefined,
        filter_contains: typeof args.filter_contains === "string" ? args.filter_contains : undefined,
        sort_field: typeof args.sort_field === "string" ? args.sort_field : undefined,
      });
      return textResult({ status: 200, correlation_id, gate, source: "DNA_OS_RUNTIME", view });
    },
  },
  {
    metadata: {
      name: "dna_os.normalize_ai_view",
      title: "Validate AI structured output against canonical view schemas",
      description: "Accept structured data matching a registered view schema. Reject arbitrary presentation.",
      read_write: "read",
      permission_scope: "local-resource-access",
      evidence_behavior: "returns DNA_OS_LOCAL_EXECUTION evidence after Owner-policy local resource authorization",
      dna_os_capability_id: "local-resource-access",
    },
    inputShape: {
      view_type: z.string().optional(),
      data_schema: z.string().optional(),
      rows: z.array(jsonMap).optional(),
      fields: jsonMap.optional(),
      html: z.unknown().optional(),
      layout: z.unknown().optional(),
      jsx: z.unknown().optional(),
      script: z.unknown().optional(),
      presentation: z.unknown().optional(),
      source_resource_ids: z.array(z.string()).optional(),
    },
    handler: async (args) => {
      const correlation_id = randomUUID();
      const gate = resolveCapabilityForTool("local-resource-access");
      if (gate.status !== "REGISTERED_VERIFIED_AVAILABLE") return capabilityNotAvailable(correlation_id, gate.capability_id, gate.reason);
      const normalized = normalizeAiOutputToCanonicalView(args);
      if (!normalized.ok) {
        return textResult({
          status: 400, correlation_id, gate, source: "DNA_OS_RUNTIME",
          accepted: false, reason_code: normalized.reason_code,
          VALID_CANONICAL_OUTPUT: "REJECTED", ARBITRARY_AI_PRESENTATION: "REJECTED",
        }, true);
      }
      return textResult({
        status: 200, correlation_id, gate, source: "DNA_OS_RUNTIME",
        accepted: true, view: normalized.view,
        VALID_CANONICAL_OUTPUT: "ACCEPTED", ARBITRARY_AI_PRESENTATION: "REJECTED",
      });
    },
  },
  {
    metadata: {
      name: "dna_os.open_owner_review",
      title: "Open OWNER_REVIEW_SURFACE_V1 in VIEW state",
      description: "Open the Owner review surface on the existing work path. Does not execute.",
      read_write: "read",
      permission_scope: "local-resource-access",
      evidence_behavior: "returns DNA_OS_LOCAL_EXECUTION evidence after Owner-policy local resource authorization",
      dna_os_capability_id: "local-resource-access",
    },
    inputShape: {
      work_id: z.string(),
      ai_client_id: z.string(),
      session_id: z.string(),
      view_type: z.string(),
      data_schema: z.string().optional(),
      rows: z.array(jsonMap).optional(),
      source_resource_ids: z.array(z.string()).optional(),
    },
    handler: async (args) => {
      const correlation_id = randomUUID();
      const gate = resolveCapabilityForTool("local-resource-access");
      if (gate.status !== "REGISTERED_VERIFIED_AVAILABLE") return capabilityNotAvailable(correlation_id, gate.capability_id, gate.reason);
      const review = openOwnerReviewView({
        work_id: String(args.work_id ?? ""),
        ai_client_id: String(args.ai_client_id ?? ""),
        session_id: String(args.session_id ?? ""),
        view_type: String(args.view_type ?? "SAFE_GENERIC_VIEW") as never,
        data_schema: typeof args.data_schema === "string" ? args.data_schema : undefined,
        rows: Array.isArray(args.rows) ? args.rows as Record<string, unknown>[] : undefined,
        source_resource_ids: Array.isArray(args.source_resource_ids) ? args.source_resource_ids.map(String) : undefined,
      });
      return textResult({ status: 200, correlation_id, gate, source: "DNA_OS_RUNTIME", review });
    },
  },
  {
    metadata: {
      name: "dna_os.create_action_preview",
      title: "Create ACTION_PREVIEW_V1",
      description: "Build a deterministic side-effect preview. Does not execute.",
      read_write: "read",
      permission_scope: "local-resource-access",
      evidence_behavior: "returns DNA_OS_LOCAL_EXECUTION evidence after Owner-policy local resource authorization",
      dna_os_capability_id: "local-resource-access",
    },
    inputShape: {
      review_id: z.string().optional(),
      work_id: z.string(),
      action: z.string(),
      resource_id: z.string(),
      input: jsonMap.optional(),
    },
    handler: async (args) => {
      const correlation_id = randomUUID();
      const gate = resolveCapabilityForTool("local-resource-access");
      if (gate.status !== "REGISTERED_VERIFIED_AVAILABLE") return capabilityNotAvailable(correlation_id, gate.capability_id, gate.reason);
      const review_id = typeof args.review_id === "string" ? args.review_id : "";
      const request = {
        work_id: String(args.work_id ?? ""),
        action: String(args.action ?? ""),
        resource_id: String(args.resource_id ?? ""),
        input: (args.input && typeof args.input === "object") ? args.input as Record<string, unknown> : {},
      };
      if (!review_id) {
        return textResult({ status: 400, correlation_id, gate, source: "DNA_OS_RUNTIME", reason_code: "REVIEW_REQUIRED" }, true);
      }
      const review = attachActionPreview(review_id, request);
      if ("ok" in review && review.ok === false) {
        return textResult({ status: 404, correlation_id, gate, source: "DNA_OS_RUNTIME", ...review }, true);
      }
      return textResult({ status: 200, correlation_id, gate, source: "DNA_OS_RUNTIME", review, PREVIEW_CREATED: true });
    },
  },
  {
    metadata: {
      name: "dna_os.apply_owner_review",
      title: "Apply Owner review decision",
      description: "APPROVE/EXECUTE route through invokeLocalCapability. REJECT does not execute.",
      read_write: "write",
      permission_scope: "local-resource-access",
      evidence_behavior: "returns DNA_OS_LOCAL_EXECUTION evidence after Owner-policy local resource authorization",
      dna_os_capability_id: "local-resource-access",
    },
    inputShape: {
      review_id: z.string(),
      decision: z.enum(["APPROVE", "REJECT", "EDIT_REQUEST", "EXECUTE", "VIEW_EVIDENCE"]),
      ai_client_id: z.string(),
      session_id: z.string(),
    },
    handler: async (args) => {
      const correlation_id = randomUUID();
      const gate = resolveCapabilityForTool("local-resource-access");
      if (gate.status !== "REGISTERED_VERIFIED_AVAILABLE") return capabilityNotAvailable(correlation_id, gate.capability_id, gate.reason);
      const review = await applyOwnerReviewDecision({
        review_id: String(args.review_id ?? ""),
        decision: String(args.decision ?? "") as never,
        ai_client_id: String(args.ai_client_id ?? ""),
        session_id: String(args.session_id ?? ""),
      });
      if ("ok" in review && review.ok === false) {
        return textResult({
          status: 403, correlation_id, gate, source: "DNA_OS_RUNTIME",
          ...review, EXECUTION: "BLOCKED", OWNER_APPROVAL_REQUIRED: review.reason_code === "OWNER_APPROVAL_REQUIRED",
        });
      }
      return textResult({ status: 200, correlation_id, gate, source: "DNA_OS_RUNTIME", review });
    },
  },
  {
    metadata: {
      name: "dna_os.list_launcher",
      title: "List discovery launcher items",
      description: "Populate launcher from discovered apps/resources/services. Discovery grants no authority.",
      read_write: "read",
      permission_scope: "local-resource-access",
      evidence_behavior: "returns DNA_OS_LOCAL_EXECUTION evidence after Owner-policy local resource authorization",
      dna_os_capability_id: "local-resource-access",
    },
    inputShape: { ai_client_id: z.string().optional(), session_id: z.string().optional(), work_id: z.string().optional() },
    handler: async (args) => {
      const correlation_id = randomUUID();
      const gate = resolveCapabilityForTool("local-resource-access");
      if (gate.status !== "REGISTERED_VERIFIED_AVAILABLE") return capabilityNotAvailable(correlation_id, gate.capability_id, gate.reason);
      const items = listLauncherItems(
        String(args.ai_client_id ?? "ai://mcp-discovery"),
        String(args.session_id ?? "session-mcp-discovery"),
        String(args.work_id ?? `work-launcher-${correlation_id}`),
      );
      return textResult({
        status: 200, correlation_id, gate, source: "DNA_OS_RUNTIME",
        items, grants_authority: false, UI_DISCOVERY_GRANTS_AUTHORITY: false,
      });
    },
  },
  {
    metadata: {
      name: "dna_os.get_activity_view",
      title: "ACTIVITY_VIEW_V1 from existing observability events",
      description: "Chronological projection of local resource events. Not a second event system.",
      read_write: "read",
      permission_scope: "local-resource-access",
      evidence_behavior: "returns DNA_OS_LOCAL_EXECUTION evidence after Owner-policy local resource authorization",
      dna_os_capability_id: "local-resource-access",
    },
    inputShape: { work_id: z.string().optional() },
    handler: async (args) => {
      const correlation_id = randomUUID();
      const gate = resolveCapabilityForTool("local-resource-access");
      if (gate.status !== "REGISTERED_VERIFIED_AVAILABLE") return capabilityNotAvailable(correlation_id, gate.capability_id, gate.reason);
      const view = renderActivityView(typeof args.work_id === "string" ? args.work_id : undefined);
      const rows = listActivityViewRows(typeof args.work_id === "string" ? args.work_id : undefined);
      return textResult({ status: 200, correlation_id, gate, source: "DNA_OS_RUNTIME", view, rows, second_event_system: false });
    },
  },
  {
    metadata: {
      name: "dna_os.list_document_templates",
      title: "List CANONICAL_DOCUMENT_TEMPLATE_V1 fixtures",
      description: "Fixture templates only. legal_correctness_claimed is false.",
      read_write: "read",
      permission_scope: "local-resource-access",
      evidence_behavior: "returns DNA_OS_LOCAL_EXECUTION evidence after Owner-policy local resource authorization",
      dna_os_capability_id: "local-resource-access",
    },
    inputShape: {},
    handler: async () => {
      const correlation_id = randomUUID();
      const gate = resolveCapabilityForTool("local-resource-access");
      if (gate.status !== "REGISTERED_VERIFIED_AVAILABLE") return capabilityNotAvailable(correlation_id, gate.capability_id, gate.reason);
      return textResult({
        status: 200, correlation_id, gate, source: "DNA_OS_RUNTIME",
        templates: listDocumentTemplates(),
        legal_correctness_claimed: false,
      });
    },
  },
  {
    metadata: {
      name: "dna_os.get_site_tool_catalog",
      title: "WebMCP/site-tool catalog",
      description: "Read-only catalog of site tools mapped to existing DNA OS operations. Discovery does not execute.",
      read_write: "read",
      permission_scope: "local-resource-access",
      evidence_behavior: "returns DNA_OS_LOCAL_EXECUTION evidence after Owner-policy local resource authorization",
      dna_os_capability_id: "local-resource-access",
    },
    inputShape: {},
    handler: async () => {
      const correlation_id = randomUUID();
      const gate = resolveCapabilityForTool("local-resource-access");
      if (gate.status !== "REGISTERED_VERIFIED_AVAILABLE") return capabilityNotAvailable(correlation_id, gate.capability_id, gate.reason);
      return textResult({ status: 200, correlation_id, gate, source: "DNA_OS_RUNTIME", ...listSiteTools() });
    },
  },
  {
    metadata: {
      name: "dna_os.get_ai_client_discovery",
      title: "AI client capability discovery",
      description: "Read-only discovery of resources, capabilities, views, and approval requirements. No hidden paths or secrets.",
      read_write: "read",
      permission_scope: "local-resource-access",
      evidence_behavior: "returns DNA_OS_LOCAL_EXECUTION evidence after Owner-policy local resource authorization",
      dna_os_capability_id: "local-resource-access",
    },
    inputShape: { ai_client_id: z.string(), session_id: z.string() },
    handler: async (args) => {
      const correlation_id = randomUUID();
      const gate = resolveCapabilityForTool("local-resource-access");
      if (gate.status !== "REGISTERED_VERIFIED_AVAILABLE") return capabilityNotAvailable(correlation_id, gate.capability_id, gate.reason);
      return textResult({
        status: 200, correlation_id, gate, source: "DNA_OS_RUNTIME",
        ...getAiClientDiscovery(String(args.ai_client_id ?? ""), String(args.session_id ?? "")),
        google: googleChromeGeminiAvailability(),
      });
    },
  },
  {
    metadata: {
      name: "dna_os.inspect_local_for_client",
      title: "Local-first inspection for an AI client",
      description: "Search/parse locally and return a minimized working set. Does not send the repository.",
      read_write: "read",
      permission_scope: "local-resource-access",
      evidence_behavior: "returns DNA_OS_LOCAL_EXECUTION evidence after Owner-policy local resource authorization",
      dna_os_capability_id: "local-resource-access",
    },
    inputShape: {
      ai_client_id: z.string(),
      session_id: z.string(),
      work_id: z.string(),
      resource_id: z.string(),
      query: z.string(),
    },
    handler: async (args) => {
      const correlation_id = randomUUID();
      const gate = resolveCapabilityForTool("local-resource-access");
      if (gate.status !== "REGISTERED_VERIFIED_AVAILABLE") return capabilityNotAvailable(correlation_id, gate.capability_id, gate.reason);
      const inspected = await inspectLocalForClient({
        ai_client_id: String(args.ai_client_id ?? ""),
        session_id: String(args.session_id ?? ""),
        work_id: String(args.work_id ?? ""),
        resource_id: String(args.resource_id ?? ""),
        query: String(args.query ?? ""),
      });
      if (!inspected.ok) return textResult({ status: 403, correlation_id, gate, source: "DNA_OS_RUNTIME", ...inspected });
      return textResult({ status: 200, correlation_id, gate, source: "DNA_OS_RUNTIME", ...inspected });
    },
  },
  {
    metadata: {
      name: "dna_os.route_search",
      title: "Route LOCAL vs WEB vs remote-service search",
      description: "Owner policy first. Local source is never sent to web search because Google is available.",
      read_write: "read",
      permission_scope: "local-resource-access",
      evidence_behavior: "returns DNA_OS_LOCAL_EXECUTION evidence after Owner-policy local resource authorization",
      dna_os_capability_id: "local-resource-access",
    },
    inputShape: {
      ai_identity: z.string(),
      session_id: z.string(),
      query: z.string(),
      intent: z.string().optional(),
      resource_type: z.string().optional(),
      preferred_provider: z.string().optional(),
      local_source: z.string().optional(),
      work_id: z.string().optional(),
    },
    handler: async (args) => {
      const correlation_id = randomUUID();
      const gate = resolveCapabilityForTool("local-resource-access");
      if (gate.status !== "REGISTERED_VERIFIED_AVAILABLE") return capabilityNotAvailable(correlation_id, gate.capability_id, gate.reason);
      return textResult({
        status: 200, correlation_id, gate, source: "DNA_OS_RUNTIME",
        ...routeSearch({
          intent: (args.intent as never) ?? "AUTO",
          query: String(args.query ?? ""),
          resource_type: args.resource_type as never,
          ai_identity: String(args.ai_identity ?? ""),
          session_id: String(args.session_id ?? ""),
          work_id: typeof args.work_id === "string" ? args.work_id : undefined,
          preferred_provider: typeof args.preferred_provider === "string" ? args.preferred_provider : undefined,
          local_source: typeof args.local_source === "string" ? args.local_source : undefined,
        }),
      });
    },
  },
  {
    metadata: {
      name: "dna_os.create_ai_handoff",
      title: "Create AI_HANDOFF_V1",
      description: "Transfer approved structured work context between AI clients. Transcripts are rejected.",
      read_write: "write",
      permission_scope: "local-resource-access",
      evidence_behavior: "returns DNA_OS_LOCAL_EXECUTION evidence after Owner-policy local resource authorization",
      dna_os_capability_id: "local-resource-access",
    },
    inputShape: {
      from_client_id: z.string(),
      to_client_id: z.string(),
      work_id: z.string(),
      goal: z.string(),
      canonical_action: z.string(),
      resource_refs: z.array(z.string()),
      current_state: z.string(),
      structured_evidence_refs: z.array(z.string()),
      open_questions: z.array(z.string()).optional(),
      approved_working_context: jsonMap,
      transcript: z.unknown().optional(),
    },
    handler: async (args) => {
      const correlation_id = randomUUID();
      const gate = resolveCapabilityForTool("local-resource-access");
      if (gate.status !== "REGISTERED_VERIFIED_AVAILABLE") return capabilityNotAvailable(correlation_id, gate.capability_id, gate.reason);
      const handoff = createAiHandoff({
        from_client_id: String(args.from_client_id ?? ""),
        to_client_id: String(args.to_client_id ?? ""),
        work_id: String(args.work_id ?? ""),
        goal: String(args.goal ?? ""),
        canonical_action: String(args.canonical_action ?? ""),
        resource_refs: Array.isArray(args.resource_refs) ? args.resource_refs.map(String) : [],
        current_state: String(args.current_state ?? ""),
        structured_evidence_refs: Array.isArray(args.structured_evidence_refs) ? args.structured_evidence_refs.map(String) : [],
        open_questions: Array.isArray(args.open_questions) ? args.open_questions.map(String) : [],
        approved_working_context: (args.approved_working_context && typeof args.approved_working_context === "object")
          ? args.approved_working_context as Record<string, unknown> : {},
        transcript: args.transcript,
      });
      if ("ok" in handoff && handoff.ok === false) {
        return textResult({ status: 400, correlation_id, gate, source: "DNA_OS_RUNTIME", ...handoff }, true);
      }
      return textResult({ status: 200, correlation_id, gate, source: "DNA_OS_RUNTIME", handoff });
    },
  },
  {
    metadata: {
      name: "dna_os.invoke_site_tool",
      title: "Invoke an allowlisted site tool through the existing gateway",
      description: "Same canonical operations as MCP. Not a second execution path. Side-effecting invoke remains preview-gated.",
      read_write: "write",
      permission_scope: "local-resource-access",
      evidence_behavior: "returns DNA_OS_LOCAL_EXECUTION evidence after Owner-policy local resource authorization",
      dna_os_capability_id: "local-resource-access",
    },
    inputShape: {
      tool_name: z.string(),
      ai_client_id: z.string(),
      session_id: z.string(),
      work_id: z.string().optional(),
      arguments: jsonMap.optional(),
    },
    handler: async (args) => {
      const correlation_id = randomUUID();
      const gate = resolveCapabilityForTool("local-resource-access");
      if (gate.status !== "REGISTERED_VERIFIED_AVAILABLE") return capabilityNotAvailable(correlation_id, gate.capability_id, gate.reason);
      const invoked = await invokeSiteTool({
        tool_name: String(args.tool_name ?? ""),
        arguments: (args.arguments && typeof args.arguments === "object") ? args.arguments as Record<string, unknown> : {},
        ai_client_id: String(args.ai_client_id ?? ""),
        session_id: String(args.session_id ?? ""),
        work_id: typeof args.work_id === "string" ? args.work_id : undefined,
      });
      return textResult({
        status: invoked.ok ? 200 : 403, correlation_id, gate, source: "DNA_OS_RUNTIME", ...invoked,
      });
    },
  },
  {
    metadata: {
      name: "dna_os.list_clients",
      title: "List UNIVERSAL_CLIENT_V1 records",
      description: "Discovery of registered clients. Provider names are metadata. Discovery grants no authority.",
      read_write: "read",
      permission_scope: "local-resource-access",
      evidence_behavior: "returns DNA_OS_LOCAL_EXECUTION evidence after Owner-policy local resource authorization",
      dna_os_capability_id: "local-resource-access",
    },
    inputShape: {},
    handler: async () => {
      const correlation_id = randomUUID();
      const gate = resolveCapabilityForTool("local-resource-access");
      if (gate.status !== "REGISTERED_VERIFIED_AVAILABLE") return capabilityNotAvailable(correlation_id, gate.capability_id, gate.reason);
      return textResult({
        status: 200, correlation_id, gate, source: "DNA_OS_RUNTIME",
        clients: listUniversalClients(),
        discovery_grants_authority: false,
        protocol: MCP_PROTOCOL_COMPAT,
      });
    },
  },
  {
    metadata: {
      name: "dna_os.get_client_status",
      title: "Get one universal client status",
      description: "Authentication is not authority. Provider identity grants zero authority.",
      read_write: "read",
      permission_scope: "local-resource-access",
      evidence_behavior: "returns DNA_OS_LOCAL_EXECUTION evidence after Owner-policy local resource authorization",
      dna_os_capability_id: "local-resource-access",
    },
    inputShape: { client_id: z.string(), protocol_version: z.string().optional() },
    handler: async (args) => {
      const correlation_id = randomUUID();
      const gate = resolveCapabilityForTool("local-resource-access");
      if (gate.status !== "REGISTERED_VERIFIED_AVAILABLE") return capabilityNotAvailable(correlation_id, gate.capability_id, gate.reason);
      const status = getClientStatus(String(args.client_id ?? ""));
      const evald = evaluateUniversalClient(String(args.client_id ?? ""), typeof args.protocol_version === "string" ? args.protocol_version : undefined);
      return textResult({ status: 200, correlation_id, gate, source: "DNA_OS_RUNTIME", ...status, evald });
    },
  },
  {
    metadata: {
      name: "dna_os.list_owner_environments",
      title: "List OWNER_RESOURCE_ENVIRONMENT_V1",
      description: "Where Owner compute/data lives. AI provider infrastructure is not an Owner environment.",
      read_write: "read",
      permission_scope: "local-resource-access",
      evidence_behavior: "returns DNA_OS_LOCAL_EXECUTION evidence after Owner-policy local resource authorization",
      dna_os_capability_id: "local-resource-access",
    },
    inputShape: {},
    handler: async () => {
      const correlation_id = randomUUID();
      const gate = resolveCapabilityForTool("local-resource-access");
      if (gate.status !== "REGISTERED_VERIFIED_AVAILABLE") return capabilityNotAvailable(correlation_id, gate.capability_id, gate.reason);
      return textResult({ status: 200, correlation_id, gate, source: "DNA_OS_RUNTIME", environments: listOwnerEnvironments() });
    },
  },
  {
    metadata: {
      name: "dna_os.get_owner_environment",
      title: "Get one Owner environment",
      description: "Read one OWNER_RESOURCE_ENVIRONMENT_V1 row.",
      read_write: "read",
      permission_scope: "local-resource-access",
      evidence_behavior: "returns DNA_OS_LOCAL_EXECUTION evidence after Owner-policy local resource authorization",
      dna_os_capability_id: "local-resource-access",
    },
    inputShape: { environment_id: z.string() },
    handler: async (args) => {
      const correlation_id = randomUUID();
      const gate = resolveCapabilityForTool("local-resource-access");
      if (gate.status !== "REGISTERED_VERIFIED_AVAILABLE") return capabilityNotAvailable(correlation_id, gate.capability_id, gate.reason);
      const environment = getOwnerEnvironment(String(args.environment_id ?? ""));
      return textResult({ status: environment ? 200 : 404, correlation_id, gate, source: "DNA_OS_RUNTIME", environment });
    },
  },
  {
    metadata: {
      name: "dna_os.get_resource_handle",
      title: "Get RESOURCE_HANDLE_V1",
      description: "Logical handle. Does not return raw source contents.",
      read_write: "read",
      permission_scope: "local-resource-access",
      evidence_behavior: "returns DNA_OS_LOCAL_EXECUTION evidence after Owner-policy local resource authorization",
      dna_os_capability_id: "local-resource-access",
    },
    inputShape: { resource_handle: z.string().optional(), resource_id: z.string().optional(), logical_path: z.string().optional() },
    handler: async (args) => {
      const correlation_id = randomUUID();
      const gate = resolveCapabilityForTool("local-resource-access");
      if (gate.status !== "REGISTERED_VERIFIED_AVAILABLE") return capabilityNotAvailable(correlation_id, gate.capability_id, gate.reason);
      if (typeof args.resource_handle === "string") {
        return textResult({ status: 200, correlation_id, gate, source: "DNA_OS_RUNTIME", handle: getResourceHandle(args.resource_handle) });
      }
      const handle = createResourceHandle({
        resource_id: String(args.resource_id ?? ""),
        logical_path: typeof args.logical_path === "string" ? args.logical_path : undefined,
      });
      return textResult({ status: 200, correlation_id, gate, source: "DNA_OS_RUNTIME", handle });
    },
  },
  {
    metadata: {
      name: "dna_os.resolve_capability_route",
      title: "OWNER_COMPUTE_FIRST capability route",
      description: "Owner policy first. External AI reasoning only when required. Does not execute.",
      read_write: "read",
      permission_scope: "local-resource-access",
      evidence_behavior: "returns DNA_OS_LOCAL_EXECUTION evidence after Owner-policy local resource authorization",
      dna_os_capability_id: "local-resource-access",
    },
    inputShape: {
      capability: z.string(),
      resource_id: z.string(),
      ai_identity: z.string(),
      session_id: z.string(),
      work_id: z.string().optional(),
      semantic_review_required: z.boolean().optional(),
    },
    handler: async (args) => {
      const correlation_id = randomUUID();
      const gate = resolveCapabilityForTool("local-resource-access");
      if (gate.status !== "REGISTERED_VERIFIED_AVAILABLE") return capabilityNotAvailable(correlation_id, gate.capability_id, gate.reason);
      const route = decideOwnerComputeFirst({
        capability: String(args.capability ?? ""),
        resource_id: String(args.resource_id ?? ""),
        bytes_proposed: 0,
        semantic_review_required: args.semantic_review_required === true,
        ai_identity: String(args.ai_identity ?? ""),
        session_id: String(args.session_id ?? ""),
        work_id: typeof args.work_id === "string" ? args.work_id : undefined,
      });
      return textResult({ status: 200, correlation_id, gate, source: "DNA_OS_RUNTIME", route, executes: false });
    },
  },
  {
    metadata: {
      name: "dna_os.get_work_context",
      title: "Get WORK_CONTEXT_V1",
      description: "Cross-client work context without transcripts.",
      read_write: "read",
      permission_scope: "local-resource-access",
      evidence_behavior: "returns DNA_OS_LOCAL_EXECUTION evidence after Owner-policy local resource authorization",
      dna_os_capability_id: "local-resource-access",
    },
    inputShape: { work_id: z.string() },
    handler: async (args) => {
      const correlation_id = randomUUID();
      const gate = resolveCapabilityForTool("local-resource-access");
      if (gate.status !== "REGISTERED_VERIFIED_AVAILABLE") return capabilityNotAvailable(correlation_id, gate.capability_id, gate.reason);
      return textResult({ status: 200, correlation_id, gate, source: "DNA_OS_RUNTIME", context: getWorkContext(String(args.work_id ?? "")) });
    },
  },
  {
    metadata: {
      name: "dna_os.submit_owner_intent",
      title: "Submit OWNER_INTENT_REQUEST_V1",
      description: "Normalize intent and run the canonical Owner-controlled path. Request is not authority.",
      read_write: "write",
      permission_scope: "local-resource-access",
      evidence_behavior: "returns DNA_OS_LOCAL_EXECUTION evidence after Owner-policy local resource authorization",
      dna_os_capability_id: "local-resource-access",
    },
    inputShape: {
      client_id: z.string(),
      session_id: z.string(),
      work_id: z.string(),
      text: z.string(),
      resource_id: z.string(),
      destination_id: z.string().optional(),
      protocol_version: z.string().optional(),
      semantic_review_required: z.boolean().optional(),
      copy_destination_logical: z.string().optional(),
    },
    handler: async (args) => {
      const correlation_id = randomUUID();
      const gate = resolveCapabilityForTool("local-resource-access");
      if (gate.status !== "REGISTERED_VERIFIED_AVAILABLE") return capabilityNotAvailable(correlation_id, gate.capability_id, gate.reason);
      const submitted = await submitOwnerIntent({
        client_id: String(args.client_id ?? ""),
        session_id: String(args.session_id ?? ""),
        work_id: String(args.work_id ?? ""),
        text: String(args.text ?? ""),
        resource_id: String(args.resource_id ?? ""),
        destination_id: typeof args.destination_id === "string" ? args.destination_id : undefined,
        protocol_version: typeof args.protocol_version === "string" ? args.protocol_version : undefined,
        semantic_review_required: args.semantic_review_required === true,
        copy_destination_logical: typeof args.copy_destination_logical === "string" ? args.copy_destination_logical : undefined,
      });
      return textResult({ status: submitted.ok ? 200 : 403, correlation_id, gate, source: "DNA_OS_RUNTIME", ...submitted });
    },
  },
  {
    metadata: {
      name: "dna_os.get_owner_work_surface",
      title: "OWNER_WORK_SURFACE_V1 snapshot",
      description: "Central Owner work surface. Discovery grants no authority. Chat is not the primary UI.",
      read_write: "read",
      permission_scope: "local-resource-access",
      evidence_behavior: "returns DNA_OS_LOCAL_EXECUTION evidence after Owner-policy local resource authorization",
      dna_os_capability_id: "local-resource-access",
    },
    inputShape: { ai_client_id: z.string().optional(), session_id: z.string().optional() },
    handler: async (args) => {
      const correlation_id = randomUUID();
      const gate = resolveCapabilityForTool("local-resource-access");
      if (gate.status !== "REGISTERED_VERIFIED_AVAILABLE") return capabilityNotAvailable(correlation_id, gate.capability_id, gate.reason);
      return textResult({
        status: 200, correlation_id, gate, source: "DNA_OS_RUNTIME",
        ...ownerWorkSurfaceSnapshot(String(args.ai_client_id ?? "ai://mcp-discovery"), String(args.session_id ?? "session-mcp-discovery")),
      });
    },
  },
  {
    metadata: {
      name: "dna_os.get_owner_response",
      title: "OWNER_RESPONSE_PROJECTION_V1",
      description: "Read-only Owner response projection. A verified factual answer is a structured result, not an MCP error, even when no action executed.",
      read_write: "read",
      permission_scope: "local-resource-access",
      evidence_behavior: "returns DNA_OS_LOCAL_EXECUTION evidence after Owner-policy local resource authorization",
      dna_os_capability_id: "local-resource-access",
    },
    inputShape: { request_id: z.string().optional() },
    handler: async (args) => {
      const correlation_id = randomUUID();
      const gate = resolveCapabilityForTool("local-resource-access");
      if (gate.status !== "REGISTERED_VERIFIED_AVAILABLE") return capabilityNotAvailable(correlation_id, gate.capability_id, gate.reason);
      const state = typeof args.request_id === "string" && args.request_id.length > 0
        ? peekOwnerResponse(args.request_id)
        : latestOwnerResponse();
      if (!state) {
        return textResult({ status: 404, correlation_id, gate, source: "DNA_OS_RUNTIME", error: "OWNER_RESPONSE_NOT_FOUND" }, false);
      }
      const fact = mcpOwnerFactResult(state);
      return textResult({
        status: 200,
        correlation_id,
        gate,
        source: "DNA_OS_RUNTIME",
        ...fact,
        owner_response_state: state,
      }, false);
    },
  },
  {
    metadata: {
      name: "dna_os.list_app_launcher",
      title: "APP_LAUNCHER_ITEM_V1 list",
      description: "Icons and categories are navigation only. They grant no capability.",
      read_write: "read",
      permission_scope: "local-resource-access",
      evidence_behavior: "returns DNA_OS_LOCAL_EXECUTION evidence after Owner-policy local resource authorization",
      dna_os_capability_id: "local-resource-access",
    },
    inputShape: { ai_client_id: z.string().optional(), session_id: z.string().optional(), work_id: z.string().optional() },
    handler: async (args) => {
      const correlation_id = randomUUID();
      const gate = resolveCapabilityForTool("local-resource-access");
      if (gate.status !== "REGISTERED_VERIFIED_AVAILABLE") return capabilityNotAvailable(correlation_id, gate.capability_id, gate.reason);
      const items = listAppLauncherItems(
        String(args.ai_client_id ?? "ai://mcp-discovery"),
        String(args.session_id ?? "session-mcp-discovery"),
        String(args.work_id ?? `work-launcher-${correlation_id}`),
      );
      return textResult({ status: 200, correlation_id, gate, source: "DNA_OS_RUNTIME", items, grants_authority: false });
    },
  },
  {
    metadata: {
      name: "dna_os.owner_search",
      title: "OWNER_SEARCH_V1",
      description: "Search authorized Owner sources locally first. Does not upload local corpora to external AI.",
      read_write: "read",
      permission_scope: "local-resource-access",
      evidence_behavior: "returns DNA_OS_LOCAL_EXECUTION evidence after Owner-policy local resource authorization",
      dna_os_capability_id: "local-resource-access",
    },
    inputShape: { query: z.string(), ai_client_id: z.string(), session_id: z.string(), work_id: z.string() },
    handler: async (args) => {
      const correlation_id = randomUUID();
      const gate = resolveCapabilityForTool("local-resource-access");
      if (gate.status !== "REGISTERED_VERIFIED_AVAILABLE") return capabilityNotAvailable(correlation_id, gate.capability_id, gate.reason);
      const search = await ownerSearch({
        query: String(args.query ?? ""),
        ai_client_id: String(args.ai_client_id ?? ""),
        session_id: String(args.session_id ?? ""),
        work_id: String(args.work_id ?? ""),
      });
      return textResult({ status: 200, correlation_id, gate, source: "DNA_OS_RUNTIME", search });
    },
  },
  {
    metadata: {
      name: "dna_os.open_owner_work",
      title: "Open a launcher item on OWNER_WORK_SURFACE_V1",
      description: "Opens a registered canonical view. Icons grant no authority.",
      read_write: "write",
      permission_scope: "local-resource-access",
      evidence_behavior: "returns DNA_OS_LOCAL_EXECUTION evidence after Owner-policy local resource authorization",
      dna_os_capability_id: "local-resource-access",
    },
    inputShape: {
      app_id: z.string(),
      ai_client_id: z.string(),
      session_id: z.string(),
      work_id: z.string(),
      logical_path: z.string().optional(),
    },
    handler: async (args) => {
      const correlation_id = randomUUID();
      const gate = resolveCapabilityForTool("local-resource-access");
      if (gate.status !== "REGISTERED_VERIFIED_AVAILABLE") return capabilityNotAvailable(correlation_id, gate.capability_id, gate.reason);
      const opened = await openOwnerWorkItem({
        app_id: String(args.app_id ?? ""),
        ai_client_id: String(args.ai_client_id ?? ""),
        session_id: String(args.session_id ?? ""),
        work_id: String(args.work_id ?? ""),
        logical_path: typeof args.logical_path === "string" ? args.logical_path : undefined,
      });
      return textResult({ status: opened.ok === false ? 403 : 200, correlation_id, gate, source: "DNA_OS_RUNTIME", ...opened });
    },
  },
  {
    metadata: {
      name: "dna_os.request_owner_work_action",
      title: "Request a canonical action from the Owner work surface",
      description: "Creates ACTION_PREVIEW_V1. Does not execute. Owner decision remains required for side effects.",
      read_write: "write",
      permission_scope: "local-resource-access",
      evidence_behavior: "returns DNA_OS_LOCAL_EXECUTION evidence after Owner-policy local resource authorization",
      dna_os_capability_id: "local-resource-access",
    },
    inputShape: {
      review_id: z.string(),
      action: z.string(),
      resource_id: z.string(),
      work_id: z.string(),
      payload: jsonMap.optional(),
    },
    handler: async (args) => {
      const correlation_id = randomUUID();
      const gate = resolveCapabilityForTool("local-resource-access");
      if (gate.status !== "REGISTERED_VERIFIED_AVAILABLE") return capabilityNotAvailable(correlation_id, gate.capability_id, gate.reason);
      const requested = await requestOwnerWorkAction({
        review_id: String(args.review_id ?? ""),
        action: String(args.action ?? ""),
        resource_id: String(args.resource_id ?? ""),
        work_id: String(args.work_id ?? ""),
        payload: args.payload && typeof args.payload === "object" ? args.payload as Record<string, unknown> : undefined,
      });
      return textResult({ status: requested.ok === false ? 403 : 200, correlation_id, gate, source: "DNA_OS_RUNTIME", ...requested });
    },
  },
  {
    metadata: {
      name: "dna_os.get_macos_bridge_status",
      title: "macOS native control bridge status",
      description: "Read-only MACOS_NATIVE_CONTROL_BRIDGE_V1. Interface existence does not grant authority.",
      read_write: "read",
      permission_scope: "local-resource-access",
      evidence_behavior: "returns DNA_OS_LOCAL_EXECUTION evidence after Owner-policy local resource authorization",
      dna_os_capability_id: "local-resource-access",
    },
    inputShape: { ai_client_id: z.string().optional(), session_id: z.string().optional(), work_id: z.string().optional() },
    handler: async (args) => {
      const correlation_id = randomUUID();
      const gate = resolveCapabilityForTool("local-resource-access");
      if (gate.status !== "REGISTERED_VERIFIED_AVAILABLE") return capabilityNotAvailable(correlation_id, gate.capability_id, gate.reason);
      const status = getMacosBridgeStatus(
        String(args.ai_client_id ?? "ai://mcp-discovery"),
        String(args.session_id ?? "session-mcp-discovery"),
        String(args.work_id ?? `work-macos-${correlation_id}`),
      );
      return textResult({ status: 200, correlation_id, gate, source: "DNA_OS_RUNTIME", ...status });
    },
  },
  {
    metadata: {
      name: "dna_os.list_macos_capabilities",
      title: "List verified macOS native capabilities",
      description: "Declared vs verified native interfaces. Discovery does not enable execution.",
      read_write: "read",
      permission_scope: "local-resource-access",
      evidence_behavior: "returns DNA_OS_LOCAL_EXECUTION evidence after Owner-policy local resource authorization",
      dna_os_capability_id: "local-resource-access",
    },
    inputShape: { ai_client_id: z.string().optional(), session_id: z.string().optional(), work_id: z.string().optional() },
    handler: async (args) => {
      const correlation_id = randomUUID();
      const gate = resolveCapabilityForTool("local-resource-access");
      if (gate.status !== "REGISTERED_VERIFIED_AVAILABLE") return capabilityNotAvailable(correlation_id, gate.capability_id, gate.reason);
      refreshMacosBridge(
        String(args.work_id ?? `work-macos-caps-${correlation_id}`),
        String(args.session_id ?? "session-mcp-discovery"),
        String(args.ai_client_id ?? "ai://mcp-discovery"),
      );
      return textResult({ status: 200, correlation_id, gate, source: "DNA_OS_RUNTIME", capabilities: listMacosCapabilities() });
    },
  },
  {
    metadata: {
      name: "dna_os.get_macos_permission_state",
      title: "macOS TCC/entitlement truth",
      description: "REQUIRED/GRANTED/DENIED/NOT_REQUESTED/NOT_AVAILABLE. Does not prompt for permission.",
      read_write: "read",
      permission_scope: "local-resource-access",
      evidence_behavior: "returns DNA_OS_LOCAL_EXECUTION evidence after Owner-policy local resource authorization",
      dna_os_capability_id: "local-resource-access",
    },
    inputShape: {},
    handler: async () => {
      const correlation_id = randomUUID();
      const gate = resolveCapabilityForTool("local-resource-access");
      if (gate.status !== "REGISTERED_VERIFIED_AVAILABLE") return capabilityNotAvailable(correlation_id, gate.capability_id, gate.reason);
      return textResult({
        status: 200, correlation_id, gate, source: "DNA_OS_RUNTIME",
        schema: "MACOS_PERMISSION_STATE_V1",
        NEW_PERMISSION_AUTO_REQUESTED: false,
        permissions: getMacosPermissionState(),
      });
    },
  },
  {
    metadata: {
      name: "dna_os.get_command_queue",
      title: "Owner command queue",
      description: "Read OWNER_COMMAND_QUEUE_V1. Execution stays on the canonical Owner path.",
      read_write: "read",
      permission_scope: "local-resource-access",
      evidence_behavior: "returns DNA_OS_LOCAL_EXECUTION evidence after Owner-policy local resource authorization",
      dna_os_capability_id: "local-resource-access",
    },
    inputShape: {},
    handler: async () => {
      const correlation_id = randomUUID();
      const gate = resolveCapabilityForTool("local-resource-access");
      if (gate.status !== "REGISTERED_VERIFIED_AVAILABLE") return capabilityNotAvailable(correlation_id, gate.capability_id, gate.reason);
      return textResult({ status: 200, correlation_id, gate, source: "DNA_OS_RUNTIME", queue: listCommandQueue() });
    },
  },
  {
    metadata: {
      name: "dna_os.get_command_status",
      title: "Get one queued Owner command",
      description: "Read one OWNER_COMMAND_QUEUE_V1 row by command_id.",
      read_write: "read",
      permission_scope: "local-resource-access",
      evidence_behavior: "returns DNA_OS_LOCAL_EXECUTION evidence after Owner-policy local resource authorization",
      dna_os_capability_id: "local-resource-access",
    },
    inputShape: { command_id: z.string() },
    handler: async (args) => {
      const correlation_id = randomUUID();
      const gate = resolveCapabilityForTool("local-resource-access");
      if (gate.status !== "REGISTERED_VERIFIED_AVAILABLE") return capabilityNotAvailable(correlation_id, gate.capability_id, gate.reason);
      const command = getCommandStatus(String(args.command_id ?? ""));
      return textResult({ status: command ? 200 : 404, correlation_id, gate, source: "DNA_OS_RUNTIME", command });
    },
  },
  {
    metadata: {
      name: "dna_os.get_system_activity",
      title: "Correlated macOS system activity",
      description: "MACOS_EVENT_CORRELATION_V1 over the existing event stream. Observe-only.",
      read_write: "read",
      permission_scope: "local-resource-access",
      evidence_behavior: "returns DNA_OS_LOCAL_EXECUTION evidence after Owner-policy local resource authorization",
      dna_os_capability_id: "local-resource-access",
    },
    inputShape: { work_id: z.string().optional() },
    handler: async (args) => {
      const correlation_id = randomUUID();
      const gate = resolveCapabilityForTool("local-resource-access");
      if (gate.status !== "REGISTERED_VERIFIED_AVAILABLE") return capabilityNotAvailable(correlation_id, gate.capability_id, gate.reason);
      const es = await probeEndpointSecurity();
      return textResult({
        status: 200, correlation_id, gate, source: "DNA_OS_RUNTIME",
        activity: listSystemActivity(typeof args.work_id === "string" ? args.work_id : undefined),
        observe_blocks_system_activity: false,
        endpoint_security: es,
      });
    },
  },
  {
    metadata: {
      name: "dna_os.get_capability_drift",
      title: "macOS capability drift",
      description: "Compare OWNER_MACHINE_BASELINE_V1. Newly discovered capabilities are not auto-enabled.",
      read_write: "read",
      permission_scope: "local-resource-access",
      evidence_behavior: "returns DNA_OS_LOCAL_EXECUTION evidence after Owner-policy local resource authorization",
      dna_os_capability_id: "local-resource-access",
    },
    inputShape: { ai_client_id: z.string().optional(), session_id: z.string().optional(), work_id: z.string().optional() },
    handler: async (args) => {
      const correlation_id = randomUUID();
      const gate = resolveCapabilityForTool("local-resource-access");
      if (gate.status !== "REGISTERED_VERIFIED_AVAILABLE") return capabilityNotAvailable(correlation_id, gate.capability_id, gate.reason);
      refreshMacosBridge(
        String(args.work_id ?? `work-drift-${correlation_id}`),
        String(args.session_id ?? "session-mcp-discovery"),
        String(args.ai_client_id ?? "ai://mcp-discovery"),
      );
      return textResult({
        status: 200, correlation_id, gate, source: "DNA_OS_RUNTIME",
        drift: detectCapabilityDrift(),
        NEW_CAPABILITY_AUTO_ENABLED: false,
      });
    },
  },
  {
    metadata: {
      name: "dna_os.get_development_work",
      title: "Development work discovery",
      description: "Read-only OWNER_DEVELOPMENT_INTENT / work order. Does not execute or deploy.",
      read_write: "read",
      permission_scope: "local-resource-access",
      evidence_behavior: "returns DNA_OS_LOCAL_EXECUTION evidence after Owner-policy local resource authorization",
      dna_os_capability_id: "local-resource-access",
    },
    inputShape: { work_id: z.string().optional() },
    handler: async (args) => {
      const correlation_id = randomUUID();
      const gate = resolveCapabilityForTool("local-resource-access");
      if (gate.status !== "REGISTERED_VERIFIED_AVAILABLE") return capabilityNotAvailable(correlation_id, gate.capability_id, gate.reason);
      return textResult({ status: 200, correlation_id, gate, source: "DNA_OS_RUNTIME", ...mcpDiscovery("get_development_work", args.work_id ? String(args.work_id) : undefined) });
    },
  },
  {
    metadata: {
      name: "dna_os.get_development_status",
      title: "Development artifact status",
      description: "Read-only DEVELOPMENT_ARTIFACT_LIFECYCLE_V1 state. Not authority.",
      read_write: "read",
      permission_scope: "local-resource-access",
      evidence_behavior: "returns DNA_OS_LOCAL_EXECUTION evidence after Owner-policy local resource authorization",
      dna_os_capability_id: "local-resource-access",
    },
    inputShape: { work_id: z.string().optional() },
    handler: async (args) => {
      const correlation_id = randomUUID();
      const gate = resolveCapabilityForTool("local-resource-access");
      if (gate.status !== "REGISTERED_VERIFIED_AVAILABLE") return capabilityNotAvailable(correlation_id, gate.capability_id, gate.reason);
      return textResult({ status: 200, correlation_id, gate, source: "DNA_OS_RUNTIME", ...mcpDiscovery("get_development_status", args.work_id ? String(args.work_id) : undefined) });
    },
  },
  {
    metadata: {
      name: "dna_os.get_production_pipeline",
      title: "Production pipeline discovery",
      description: "Read-only DNA_OS_WORK_PRODUCTION_PIPELINE_V1. Execution stays on the Owner path.",
      read_write: "read",
      permission_scope: "local-resource-access",
      evidence_behavior: "returns DNA_OS_LOCAL_EXECUTION evidence after Owner-policy local resource authorization",
      dna_os_capability_id: "local-resource-access",
    },
    inputShape: { work_id: z.string().optional() },
    handler: async (args) => {
      const correlation_id = randomUUID();
      const gate = resolveCapabilityForTool("local-resource-access");
      if (gate.status !== "REGISTERED_VERIFIED_AVAILABLE") return capabilityNotAvailable(correlation_id, gate.capability_id, gate.reason);
      return textResult({ status: 200, correlation_id, gate, source: "DNA_OS_RUNTIME", ...mcpDiscovery("get_production_pipeline", args.work_id ? String(args.work_id) : undefined) });
    },
  },
  {
    metadata: {
      name: "dna_os.get_artifact_status",
      title: "Production artifact status",
      description: "Read-only PRODUCTION_ARTIFACT_V1 identity. Source files are not deployable proof.",
      read_write: "read",
      permission_scope: "local-resource-access",
      evidence_behavior: "returns DNA_OS_LOCAL_EXECUTION evidence after Owner-policy local resource authorization",
      dna_os_capability_id: "local-resource-access",
    },
    inputShape: { work_id: z.string().optional() },
    handler: async (args) => {
      const correlation_id = randomUUID();
      const gate = resolveCapabilityForTool("local-resource-access");
      if (gate.status !== "REGISTERED_VERIFIED_AVAILABLE") return capabilityNotAvailable(correlation_id, gate.capability_id, gate.reason);
      return textResult({ status: 200, correlation_id, gate, source: "DNA_OS_RUNTIME", ...mcpDiscovery("get_artifact_status", args.work_id ? String(args.work_id) : undefined) });
    },
  },
  {
    metadata: {
      name: "dna_os.get_verification_status",
      title: "Machine verification status",
      description: "Read-only CODE_VERIFICATION_REGISTRY_V1 results. AI self-assessment is not evidence.",
      read_write: "read",
      permission_scope: "local-resource-access",
      evidence_behavior: "returns DNA_OS_LOCAL_EXECUTION evidence after Owner-policy local resource authorization",
      dna_os_capability_id: "local-resource-access",
    },
    inputShape: { work_id: z.string().optional() },
    handler: async (args) => {
      const correlation_id = randomUUID();
      const gate = resolveCapabilityForTool("local-resource-access");
      if (gate.status !== "REGISTERED_VERIFIED_AVAILABLE") return capabilityNotAvailable(correlation_id, gate.capability_id, gate.reason);
      return textResult({ status: 200, correlation_id, gate, source: "DNA_OS_RUNTIME", ...mcpDiscovery("get_verification_status", args.work_id ? String(args.work_id) : undefined) });
    },
  },
  {
    metadata: {
      name: "dna_os.get_promotion_status",
      title: "Canonical source promotion status",
      description: "Read-only CANONICAL_SOURCE_PROMOTION_V1. GitHub protection is reported honestly.",
      read_write: "read",
      permission_scope: "local-resource-access",
      evidence_behavior: "returns DNA_OS_LOCAL_EXECUTION evidence after Owner-policy local resource authorization",
      dna_os_capability_id: "local-resource-access",
    },
    inputShape: { work_id: z.string().optional() },
    handler: async (args) => {
      const correlation_id = randomUUID();
      const gate = resolveCapabilityForTool("local-resource-access");
      if (gate.status !== "REGISTERED_VERIFIED_AVAILABLE") return capabilityNotAvailable(correlation_id, gate.capability_id, gate.reason);
      return textResult({ status: 200, correlation_id, gate, source: "DNA_OS_RUNTIME", ...mcpDiscovery("get_promotion_status", args.work_id ? String(args.work_id) : undefined) });
    },
  },
  {
    metadata: {
      name: "dna_os.get_deployment_status",
      title: "Production deployment status",
      description: "Read-only PRODUCTION_DEPLOYMENT_V1. Does not deploy.",
      read_write: "read",
      permission_scope: "local-resource-access",
      evidence_behavior: "returns DNA_OS_LOCAL_EXECUTION evidence after Owner-policy local resource authorization",
      dna_os_capability_id: "local-resource-access",
    },
    inputShape: { work_id: z.string().optional() },
    handler: async (args) => {
      const correlation_id = randomUUID();
      const gate = resolveCapabilityForTool("local-resource-access");
      if (gate.status !== "REGISTERED_VERIFIED_AVAILABLE") return capabilityNotAvailable(correlation_id, gate.capability_id, gate.reason);
      return textResult({ status: 200, correlation_id, gate, source: "DNA_OS_RUNTIME", ...mcpDiscovery("get_deployment_status", args.work_id ? String(args.work_id) : undefined) });
    },
  },
  {
    metadata: {
      name: "dna_os.get_runtime_verification",
      title: "Runtime verification discovery",
      description: "Read-only PRODUCTION_RUNTIME_VERIFICATION_V1. A deploy command is not verification.",
      read_write: "read",
      permission_scope: "local-resource-access",
      evidence_behavior: "returns DNA_OS_LOCAL_EXECUTION evidence after Owner-policy local resource authorization",
      dna_os_capability_id: "local-resource-access",
    },
    inputShape: { work_id: z.string().optional() },
    handler: async (args) => {
      const correlation_id = randomUUID();
      const gate = resolveCapabilityForTool("local-resource-access");
      if (gate.status !== "REGISTERED_VERIFIED_AVAILABLE") return capabilityNotAvailable(correlation_id, gate.capability_id, gate.reason);
      return textResult({ status: 200, correlation_id, gate, source: "DNA_OS_RUNTIME", ...mcpDiscovery("get_runtime_verification", args.work_id ? String(args.work_id) : undefined) });
    },
  },
  {
    metadata: {
      name: "dna_os.get_capability_lineage",
      title: "End-to-end work lineage",
      description: "Read-only END_TO_END_WORK_LINEAGE_V1 from Owner intent to capability.",
      read_write: "read",
      permission_scope: "local-resource-access",
      evidence_behavior: "returns DNA_OS_LOCAL_EXECUTION evidence after Owner-policy local resource authorization",
      dna_os_capability_id: "local-resource-access",
    },
    inputShape: { work_id: z.string().optional() },
    handler: async (args) => {
      const correlation_id = randomUUID();
      const gate = resolveCapabilityForTool("local-resource-access");
      if (gate.status !== "REGISTERED_VERIFIED_AVAILABLE") return capabilityNotAvailable(correlation_id, gate.capability_id, gate.reason);
      return textResult({ status: 200, correlation_id, gate, source: "DNA_OS_RUNTIME", ...mcpDiscovery("get_capability_lineage", args.work_id ? String(args.work_id) : undefined) });
    },
  },
  {
    metadata: {
      name: "dna_os.list_development_notifications",
      title: "Development activity notifications",
      description: "Read-only DEVELOPMENT_ACTIVITY_NOTIFICATION_V1. Meaningful states only.",
      read_write: "read",
      permission_scope: "local-resource-access",
      evidence_behavior: "returns DNA_OS_LOCAL_EXECUTION evidence after Owner-policy local resource authorization",
      dna_os_capability_id: "local-resource-access",
    },
    inputShape: { work_id: z.string().optional() },
    handler: async (args) => {
      const correlation_id = randomUUID();
      const gate = resolveCapabilityForTool("local-resource-access");
      if (gate.status !== "REGISTERED_VERIFIED_AVAILABLE") return capabilityNotAvailable(correlation_id, gate.capability_id, gate.reason);
      return textResult({ status: 200, correlation_id, gate, source: "DNA_OS_RUNTIME", ...mcpDiscovery("list_development_notifications", args.work_id ? String(args.work_id) : undefined) });
    },
  },
  {
    metadata: {
      name: "dna_os.get_owner_surface",
      title: "Owner operational/development surface snapshot",
      description: "Read-only surface separation. Discovery is not authority.",
      read_write: "read",
      permission_scope: "local-resource-access",
      evidence_behavior: "returns DNA_OS_LOCAL_EXECUTION evidence after Owner-policy local resource authorization",
      dna_os_capability_id: "local-resource-access",
    },
    inputShape: { surface_session_id: z.string().optional() },
    handler: async () => {
      const correlation_id = randomUUID();
      const gate = resolveCapabilityForTool("local-resource-access");
      if (gate.status !== "REGISTERED_VERIFIED_AVAILABLE") return capabilityNotAvailable(correlation_id, gate.capability_id, gate.reason);
      return textResult({ status: 200, correlation_id, gate, source: "DNA_OS_RUNTIME", ...ownerSurfaceSeparationSlice() });
    },
  },
  {
    metadata: {
      name: "dna_os.route_owner_surface_request",
      title: "Classify an Owner request against the active surface",
      description: "Language may classify intent. It cannot escalate OPERATIONAL to DEVELOPMENT.",
      read_write: "read",
      permission_scope: "local-resource-access",
      evidence_behavior: "returns DNA_OS_LOCAL_EXECUTION evidence after Owner-policy local resource authorization",
      dna_os_capability_id: "local-resource-access",
    },
    inputShape: { surface_session_id: z.string(), text: z.string() },
    handler: async (args) => {
      const correlation_id = randomUUID();
      const gate = resolveCapabilityForTool("local-resource-access");
      if (gate.status !== "REGISTERED_VERIFIED_AVAILABLE") return capabilityNotAvailable(correlation_id, gate.capability_id, gate.reason);
      const session = latestSession(String(args.surface_session_id));
      if (!session) return textResult({ status: 404, correlation_id, gate, reason_code: "SURFACE_SESSION_NOT_FOUND" }, false);
      return textResult({ status: 200, correlation_id, gate, source: "DNA_OS_RUNTIME", ...classifySurfaceIntent(String(args.text), session) });
    },
  },
  {
    metadata: {
      name: "dna_os.submit_development_control",
      title: "Prepare a development change proposal",
      description: "Development Control only. Does not modify source. Biometric lease is still required.",
      read_write: "write",
      permission_scope: "local-resource-access",
      evidence_behavior: "returns DNA_OS_LOCAL_EXECUTION evidence after Owner-policy local resource authorization",
      dna_os_capability_id: "local-resource-access",
    },
    inputShape: { surface_session_id: z.string(), goal: z.string() },
    handler: async (args) => {
      const correlation_id = randomUUID();
      const gate = resolveCapabilityForTool("local-resource-access");
      if (gate.status !== "REGISTERED_VERIFIED_AVAILABLE") return capabilityNotAvailable(correlation_id, gate.capability_id, gate.reason);
      const session = latestSession(String(args.surface_session_id));
      if (!session) return textResult({ status: 404, correlation_id, gate, reason_code: "SURFACE_SESSION_NOT_FOUND" }, false);
      return textResult({ status: 200, correlation_id, gate, source: "DNA_OS_RUNTIME", ...prepareDevelopmentProposal({ session, goal: String(args.goal) }) });
    },
  },
  {
    metadata: {
      name: "dna_os.modify_source",
      title: "Modify source under a development lease",
      description: "Requires DEVELOPMENT surface plus an active scoped lease. Not a production deploy.",
      read_write: "write",
      permission_scope: "local-resource-access",
      evidence_behavior: "returns DNA_OS_LOCAL_EXECUTION evidence after Owner-policy local resource authorization",
      dna_os_capability_id: "local-resource-access",
    },
    inputShape: { surface_session_id: z.string(), lease_id: z.string(), relative_path: z.string(), contents: z.string() },
    handler: async (args) => {
      const correlation_id = randomUUID();
      const gate = resolveCapabilityForTool("local-resource-access");
      if (gate.status !== "REGISTERED_VERIFIED_AVAILABLE") return capabilityNotAvailable(correlation_id, gate.capability_id, gate.reason);
      const session = latestSession(String(args.surface_session_id));
      const lease = latestLease(String(args.lease_id));
      if (!session || !lease) return textResult({ status: 403, correlation_id, gate, reason_code: "DEVELOPMENT_LEASE_REQUIRED" }, true);
      return textResult({
        status: 200,
        correlation_id,
        gate,
        source: "DNA_OS_RUNTIME",
        ...applyRegisteredSourceMutation({
          session,
          lease,
          client_id: "mcp-coding-client",
          work_id: lease.work_id,
          relative_path: String(args.relative_path),
          contents: String(args.contents),
        }),
      });
    },
  },
  {
    metadata: {
      name: "dna_os.create_worktree",
      title: "Create coding worktree",
      description: "Not included in a source-write lease. Production/workspace authorities remain separate.",
      read_write: "write",
      permission_scope: "local-resource-access",
      evidence_behavior: "returns DNA_OS_LOCAL_EXECUTION evidence after Owner-policy local resource authorization",
      dna_os_capability_id: "local-resource-access",
    },
    inputShape: { surface_session_id: z.string().optional() },
    handler: async () => {
      const correlation_id = randomUUID();
      return textResult({ status: 403, correlation_id, reason_code: "NOT_IN_SOURCE_WRITE_LEASE", SOURCE_CHANGE_AUTHORITY_SEPARATED_FROM_PRODUCTION: true }, true);
    },
  },
  {
    metadata: {
      name: "dna_os.invoke_coding_worker",
      title: "Invoke coding worker",
      description: "Operational surface cannot invoke. Development requires a scoped lease.",
      read_write: "write",
      permission_scope: "local-resource-access",
      evidence_behavior: "returns DNA_OS_LOCAL_EXECUTION evidence after Owner-policy local resource authorization",
      dna_os_capability_id: "local-resource-access",
    },
    inputShape: { surface_session_id: z.string() },
    handler: async (args) => {
      const correlation_id = randomUUID();
      const gate = resolveCapabilityForTool("local-resource-access");
      if (gate.status !== "REGISTERED_VERIFIED_AVAILABLE") return capabilityNotAvailable(correlation_id, gate.capability_id, gate.reason);
      const session = latestSession(String(args.surface_session_id));
      if (!session) return textResult({ status: 403, correlation_id, gate, ...invokeCodingWorker({ schema: "OWNER_SURFACE_SESSION_V1", session_id: "missing", owner_id: "unknown", surface_id: "OPERATIONAL_OWNER_SURFACE", authority_domain: "OPERATIONAL", created_at: new Date().toISOString(), pending_action_authority: null, development_lease_id: null }) }, true);
      return textResult({ status: 200, correlation_id, gate, source: "DNA_OS_RUNTIME", ...invokeCodingWorker(session) });
    },
  },
  {
    metadata: {
      name: "dna_os.commit_source",
      title: "Commit source",
      description: "Git commit remains on the production pipeline authority, not the source-write lease.",
      read_write: "write",
      permission_scope: "local-resource-access",
      evidence_behavior: "returns DNA_OS_LOCAL_EXECUTION evidence after Owner-policy local resource authorization",
      dna_os_capability_id: "local-resource-access",
    },
    inputShape: { surface_session_id: z.string().optional() },
    handler: async () => textResult({ status: 403, reason_code: "NOT_IN_SOURCE_WRITE_LEASE", PRODUCTION_PROMOTION_AUTHORITY: false }, true),
  },
  {
    metadata: {
      name: "dna_os.publish_source",
      title: "Publish source",
      description: "Publish remains on the production pipeline authority, not the source-write lease.",
      read_write: "write",
      permission_scope: "local-resource-access",
      evidence_behavior: "returns DNA_OS_LOCAL_EXECUTION evidence after Owner-policy local resource authorization",
      dna_os_capability_id: "local-resource-access",
    },
    inputShape: { surface_session_id: z.string().optional() },
    handler: async () => textResult({ status: 403, reason_code: "NOT_IN_SOURCE_WRITE_LEASE", PRODUCTION_PROMOTION_AUTHORITY: false }, true),
  },
  {
    metadata: {
      name: "dna_os.create_scoped_development_workspace",
      title: "Create isolated development worktree",
      description: "Creates a lease-scoped worktree. Does not mutate canonical main.",
      read_write: "write",
      permission_scope: "local-resource-access",
      evidence_behavior: "returns DNA_OS_LOCAL_EXECUTION evidence after Owner-policy local resource authorization",
      dna_os_capability_id: "local-resource-access",
    },
    inputShape: { surface_session_id: z.string(), lease_id: z.string() },
    handler: async (args) => {
      const correlation_id = randomUUID();
      const gate = resolveCapabilityForTool("local-resource-access");
      if (gate.status !== "REGISTERED_VERIFIED_AVAILABLE") return capabilityNotAvailable(correlation_id, gate.capability_id, gate.reason);
      const session = latestSession(String(args.surface_session_id));
      const lease = latestLease(String(args.lease_id));
      if (!session) return textResult({ status: 403, correlation_id, gate, reason_code: "DEVELOPMENT_AUTHORITY_REQUIRED" }, true);
      return textResult({ status: 200, correlation_id, gate, source: "DNA_OS_RUNTIME", ...createScopedDevelopmentWorktree({ session, lease, work_id: lease?.work_id ?? "missing" }) });
    },
  },
  {
    metadata: {
      name: "dna_os.apply_scoped_source_write",
      title: "Apply registered scoped source mutation",
      description: "Writes only inside the isolated worktree after scope, lease, and revision checks.",
      read_write: "write",
      permission_scope: "local-resource-access",
      evidence_behavior: "returns DNA_OS_LOCAL_EXECUTION evidence after Owner-policy local resource authorization",
      dna_os_capability_id: "local-resource-access",
    },
    inputShape: {
      surface_session_id: z.string(),
      lease_id: z.string(),
      client_id: z.string(),
      relative_path: z.string(),
      contents: z.string(),
      expected_revision: z.string().optional(),
      expected_preimage_hash: z.string().optional(),
      resource_handle: z.string().optional(),
      mutation_type: z.string().optional(),
    },
    handler: async (args) => {
      const correlation_id = randomUUID();
      const gate = resolveCapabilityForTool("local-resource-access");
      if (gate.status !== "REGISTERED_VERIFIED_AVAILABLE") return capabilityNotAvailable(correlation_id, gate.capability_id, gate.reason);
      const session = latestSession(String(args.surface_session_id));
      const lease = latestLease(String(args.lease_id));
      if (!session) return textResult({ status: 403, correlation_id, gate, reason_code: "DEVELOPMENT_AUTHORITY_REQUIRED" }, true);
      return textResult({
        status: 200,
        correlation_id,
        gate,
        source: "DNA_OS_RUNTIME",
        ...applyRegisteredSourceMutation({
          session,
          lease,
          client_id: String(args.client_id),
          work_id: lease?.work_id ?? "missing",
          relative_path: String(args.relative_path),
          contents: String(args.contents),
          expected_revision: typeof args.expected_revision === "string" ? args.expected_revision : undefined,
          expected_preimage_hash: typeof args.expected_preimage_hash === "string" ? args.expected_preimage_hash : undefined,
        }),
      });
    },
  },
  {
    metadata: {
      name: "dna_os.create_scoped_source_file",
      title: "Create a file in the scoped worktree",
      description: "Registered create inside isolated worktree only.",
      read_write: "write",
      permission_scope: "local-resource-access",
      evidence_behavior: "returns DNA_OS_LOCAL_EXECUTION evidence after Owner-policy local resource authorization",
      dna_os_capability_id: "local-resource-access",
    },
    inputShape: {
      surface_session_id: z.string(),
      lease_id: z.string(),
      client_id: z.string(),
      relative_path: z.string(),
      contents: z.string(),
      expected_revision: z.string().optional(),
    },
    handler: async (args) => {
      const correlation_id = randomUUID();
      const gate = resolveCapabilityForTool("local-resource-access");
      if (gate.status !== "REGISTERED_VERIFIED_AVAILABLE") return capabilityNotAvailable(correlation_id, gate.capability_id, gate.reason);
      const session = latestSession(String(args.surface_session_id));
      const lease = latestLease(String(args.lease_id));
      if (!session) return textResult({ status: 403, correlation_id, gate, reason_code: "DEVELOPMENT_AUTHORITY_REQUIRED" }, true);
      return textResult({
        status: 200,
        correlation_id,
        gate,
        source: "DNA_OS_RUNTIME",
        ...applyRegisteredSourceMutation({
          session,
          lease,
          client_id: String(args.client_id),
          work_id: lease?.work_id ?? "missing",
          relative_path: String(args.relative_path),
          contents: String(args.contents),
          expected_revision: typeof args.expected_revision === "string" ? args.expected_revision : undefined,
        }),
      });
    },
  },
  {
    metadata: {
      name: "dna_os.delete_scoped_source_file",
      title: "Delete a file in the scoped worktree",
      description: "Registered delete inside isolated worktree only.",
      read_write: "write",
      permission_scope: "local-resource-access",
      evidence_behavior: "returns DNA_OS_LOCAL_EXECUTION evidence after Owner-policy local resource authorization",
      dna_os_capability_id: "local-resource-access",
    },
    inputShape: {
      surface_session_id: z.string(),
      lease_id: z.string(),
      client_id: z.string(),
      relative_path: z.string(),
      expected_revision: z.string().optional(),
      expected_preimage_hash: z.string().optional(),
    },
    handler: async (args) => {
      const correlation_id = randomUUID();
      const gate = resolveCapabilityForTool("local-resource-access");
      if (gate.status !== "REGISTERED_VERIFIED_AVAILABLE") return capabilityNotAvailable(correlation_id, gate.capability_id, gate.reason);
      const session = latestSession(String(args.surface_session_id));
      const lease = latestLease(String(args.lease_id));
      if (!session) return textResult({ status: 403, correlation_id, gate, reason_code: "DEVELOPMENT_AUTHORITY_REQUIRED" }, true);
      return textResult({
        status: 200,
        correlation_id,
        gate,
        source: "DNA_OS_RUNTIME",
        ...applyRegisteredSourceMutation({
          session,
          lease,
          client_id: String(args.client_id),
          work_id: lease?.work_id ?? "missing",
          relative_path: String(args.relative_path),
          contents: "",
          expected_revision: typeof args.expected_revision === "string" ? args.expected_revision : undefined,
          expected_preimage_hash: typeof args.expected_preimage_hash === "string" ? args.expected_preimage_hash : undefined,
        }),
      });
    },
  },
  {
    metadata: {
      name: "dna_os.read_scoped_source",
      title: "Read scoped worktree source by handle",
      description: "Bounded source read. Does not grant write authority.",
      read_write: "read",
      permission_scope: "local-resource-access",
      evidence_behavior: "returns DNA_OS_LOCAL_EXECUTION evidence after Owner-policy local resource authorization",
      dna_os_capability_id: "local-resource-access",
    },
    inputShape: { surface_session_id: z.string(), lease_id: z.string(), relative_path: z.string() },
    handler: async (args) => {
      const correlation_id = randomUUID();
      const gate = resolveCapabilityForTool("local-resource-access");
      if (gate.status !== "REGISTERED_VERIFIED_AVAILABLE") return capabilityNotAvailable(correlation_id, gate.capability_id, gate.reason);
      const session = latestSession(String(args.surface_session_id));
      const lease = latestLease(String(args.lease_id));
      if (!session) return textResult({ status: 403, correlation_id, gate, reason_code: "DEVELOPMENT_AUTHORITY_REQUIRED" }, true);
      return textResult({ status: 200, correlation_id, gate, source: "DNA_OS_RUNTIME", ...readScopedSource({ session, lease, work_id: lease?.work_id ?? "missing", relative_path: String(args.relative_path) }) });
    },
  },
  {
    metadata: {
      name: "dna_os.get_development_context",
      title: "Structured development context",
      description: "Registered facts for a work order. Not a repository dump.",
      read_write: "read",
      permission_scope: "local-resource-access",
      evidence_behavior: "returns DNA_OS_LOCAL_EXECUTION evidence after Owner-policy local resource authorization",
      dna_os_capability_id: "local-resource-access",
    },
    inputShape: { surface_session_id: z.string().optional(), lease_id: z.string().optional(), work_id: z.string(), goal: z.string() },
    handler: async (args) => {
      const correlation_id = randomUUID();
      const gate = resolveCapabilityForTool("local-resource-access");
      if (gate.status !== "REGISTERED_VERIFIED_AVAILABLE") return capabilityNotAvailable(correlation_id, gate.capability_id, gate.reason);
      const lease = typeof args.lease_id === "string" ? latestLease(args.lease_id) : null;
      return textResult({ status: 200, correlation_id, gate, source: "DNA_OS_RUNTIME", ...developmentContext({ work_id: String(args.work_id), lease, goal: String(args.goal) }) });
    },
  },
  {
    metadata: {
      name: "dna_os.get_coding_knowledge",
      title: "Registered-fact-first coding knowledge",
      description: "Resolve capability ownership and dependencies from canonical information before source search.",
      read_write: "read",
      permission_scope: "local-resource-access",
      evidence_behavior: "returns DNA_OS_LOCAL_EXECUTION evidence after Owner-policy local resource authorization",
      dna_os_capability_id: "local-resource-access",
    },
    inputShape: { capability_id: z.string() },
    handler: async (args) => {
      const correlation_id = randomUUID();
      const gate = resolveCapabilityForTool("local-resource-access");
      if (gate.status !== "REGISTERED_VERIFIED_AVAILABLE") return capabilityNotAvailable(correlation_id, gate.capability_id, gate.reason);
      return textResult({ status: 200, correlation_id, gate, source: "DNA_OS_RUNTIME", ...codingKnowledgeFirst(String(args.capability_id)) });
    },
  },
  {
    metadata: {
      name: "dna_os.list_notifications",
      title: "List Owner notifications",
      description: "Read-only OWNER_NOTIFICATION_V1 history. Not authority.",
      read_write: "read",
      permission_scope: "local-resource-access",
      evidence_behavior: "returns DNA_OS_LOCAL_EXECUTION evidence after Owner-policy local resource authorization",
      dna_os_capability_id: "local-resource-access",
    },
    inputShape: { filter: z.string().optional() },
    handler: async (args) => {
      const correlation_id = randomUUID();
      const gate = resolveCapabilityForTool("local-resource-access");
      if (gate.status !== "REGISTERED_VERIFIED_AVAILABLE") return capabilityNotAvailable(correlation_id, gate.capability_id, gate.reason);
      const filter = String(args.filter ?? "latest") as "latest" | "unread" | "action_required" | "failed" | "success";
      return textResult({ status: 200, correlation_id, gate, source: "DNA_OS_RUNTIME", INFORMATION_ACCESS_GRANTS_AUTHORITY: false, notifications: queryNotifications(filter) });
    },
  },
  {
    metadata: {
      name: "dna_os.get_notification",
      title: "Get one Owner notification",
      description: "Read-only OWNER_NOTIFICATION_V1 by id.",
      read_write: "read",
      permission_scope: "local-resource-access",
      evidence_behavior: "returns DNA_OS_LOCAL_EXECUTION evidence after Owner-policy local resource authorization",
      dna_os_capability_id: "local-resource-access",
    },
    inputShape: { notification_id: z.string() },
    handler: async (args) => {
      const correlation_id = randomUUID();
      const gate = resolveCapabilityForTool("local-resource-access");
      if (gate.status !== "REGISTERED_VERIFIED_AVAILABLE") return capabilityNotAvailable(correlation_id, gate.capability_id, gate.reason);
      const row = listNotifications().find((item) => item.notification_id === String(args.notification_id)) ?? null;
      return textResult({ status: row ? 200 : 404, correlation_id, gate, source: "DNA_OS_RUNTIME", INFORMATION_ACCESS_GRANTS_AUTHORITY: false, notification: row });
    },
  },
  {
    metadata: {
      name: "dna_os.get_notification_summary",
      title: "Owner attention index",
      description: "Unread/action/warning/critical counters. Read-only.",
      read_write: "read",
      permission_scope: "local-resource-access",
      evidence_behavior: "returns DNA_OS_LOCAL_EXECUTION evidence after Owner-policy local resource authorization",
      dna_os_capability_id: "local-resource-access",
    },
    inputShape: {},
    handler: async () => {
      const correlation_id = randomUUID();
      const gate = resolveCapabilityForTool("local-resource-access");
      if (gate.status !== "REGISTERED_VERIFIED_AVAILABLE") return capabilityNotAvailable(correlation_id, gate.capability_id, gate.reason);
      return textResult({ status: 200, correlation_id, gate, source: "DNA_OS_RUNTIME", INFORMATION_ACCESS_GRANTS_AUTHORITY: false, ...attentionIndex() });
    },
  },
  {
    metadata: {
      name: "dna_os.get_active_work",
      title: "Active Owner work projection",
      description: "What is happening now. Not a notification history.",
      read_write: "read",
      permission_scope: "local-resource-access",
      evidence_behavior: "returns DNA_OS_LOCAL_EXECUTION evidence after Owner-policy local resource authorization",
      dna_os_capability_id: "local-resource-access",
    },
    inputShape: {},
    handler: async () => {
      const correlation_id = randomUUID();
      const gate = resolveCapabilityForTool("local-resource-access");
      if (gate.status !== "REGISTERED_VERIFIED_AVAILABLE") return capabilityNotAvailable(correlation_id, gate.capability_id, gate.reason);
      return textResult({ status: 200, correlation_id, gate, source: "DNA_OS_RUNTIME", INFORMATION_ACCESS_GRANTS_AUTHORITY: false, ACTIVITY_NE_NOTIFICATION: true, work: listActiveWork() });
    },
  },
  {
    metadata: {
      name: "dna_os.get_owner_attention_required",
      title: "Action-required notifications",
      description: "Notifications that need Owner action. Clicking does not grant source authority.",
      read_write: "read",
      permission_scope: "local-resource-access",
      evidence_behavior: "returns DNA_OS_LOCAL_EXECUTION evidence after Owner-policy local resource authorization",
      dna_os_capability_id: "local-resource-access",
    },
    inputShape: {},
    handler: async () => {
      const correlation_id = randomUUID();
      const gate = resolveCapabilityForTool("local-resource-access");
      if (gate.status !== "REGISTERED_VERIFIED_AVAILABLE") return capabilityNotAvailable(correlation_id, gate.capability_id, gate.reason);
      return textResult({ status: 200, correlation_id, gate, source: "DNA_OS_RUNTIME", INFORMATION_ACCESS_GRANTS_AUTHORITY: false, SOURCE_WRITE_AUTHORITY: false, notifications: queryNotifications("action_required") });
    },
  },
  {
    metadata: {
      name: "dna_os.get_notification_delivery_status",
      title: "Notification delivery evidence",
      description: "DELIVERY_REQUESTED vs ACCEPTED_BY_OS. USER_VIEWED_UNKNOWN.",
      read_write: "read",
      permission_scope: "local-resource-access",
      evidence_behavior: "returns DNA_OS_LOCAL_EXECUTION evidence after Owner-policy local resource authorization",
      dna_os_capability_id: "local-resource-access",
    },
    inputShape: { notification_id: z.string().optional() },
    handler: async (args) => {
      const correlation_id = randomUUID();
      const gate = resolveCapabilityForTool("local-resource-access");
      if (gate.status !== "REGISTERED_VERIFIED_AVAILABLE") return capabilityNotAvailable(correlation_id, gate.capability_id, gate.reason);
      const id = typeof args.notification_id === "string" ? args.notification_id : null;
      const rows = listDeliveries().filter((row) => !id || row.notification_id === id);
      return textResult({ status: 200, correlation_id, gate, source: "DNA_OS_RUNTIME", USER_VIEWED_UNKNOWN: true, deliveries: rows });
    },
  },
  {
    metadata: {
      name: "dna_os.get_macos_notification_permission",
      title: "macOS notification permission truth",
      description: "Reads UNNotificationSettings. Does not request authorization.",
      read_write: "read",
      permission_scope: "local-resource-access",
      evidence_behavior: "returns DNA_OS_LOCAL_EXECUTION evidence after Owner-policy local resource authorization",
      dna_os_capability_id: "local-resource-access",
    },
    inputShape: {},
    handler: async () => {
      const correlation_id = randomUUID();
      const gate = resolveCapabilityForTool("local-resource-access");
      if (gate.status !== "REGISTERED_VERIFIED_AVAILABLE") return capabilityNotAvailable(correlation_id, gate.capability_id, gate.reason);
      return textResult({ status: 200, correlation_id, gate, source: "DNA_OS_RUNTIME", ...readMacosNotificationPermission() });
    },
  },
  {
    metadata: {
      name: "dna_os.list_inbound_adapters",
      title: "List inbound event adapters",
      description: "Discovery never grants authority. Unconnected providers stay NOT_WIRED/NOT_AVAILABLE.",
      read_write: "read",
      permission_scope: "local-resource-access",
      evidence_behavior: "returns DNA_OS_LOCAL_EXECUTION evidence after Owner-policy local resource authorization",
      dna_os_capability_id: "local-resource-access",
    },
    inputShape: {},
    handler: async () => {
      const correlation_id = randomUUID();
      const gate = resolveCapabilityForTool("local-resource-access");
      if (gate.status !== "REGISTERED_VERIFIED_AVAILABLE") return capabilityNotAvailable(correlation_id, gate.capability_id, gate.reason);
      return textResult({ status: 200, correlation_id, gate, source: "DNA_OS_RUNTIME", INBOUND_EVENT_GRANTS_AUTHORITY: false, adapters: discoverInboundAdapters() });
    },
  },
  {
    metadata: {
      name: "dna_os.get_inbound_adapter",
      title: "Get one inbound adapter",
      description: "Read-only adapter contract.",
      read_write: "read",
      permission_scope: "local-resource-access",
      evidence_behavior: "returns DNA_OS_LOCAL_EXECUTION evidence after Owner-policy local resource authorization",
      dna_os_capability_id: "local-resource-access",
    },
    inputShape: { adapter_id: z.string() },
    handler: async (args) => {
      const correlation_id = randomUUID();
      const gate = resolveCapabilityForTool("local-resource-access");
      if (gate.status !== "REGISTERED_VERIFIED_AVAILABLE") return capabilityNotAvailable(correlation_id, gate.capability_id, gate.reason);
      return textResult({ status: 200, correlation_id, gate, source: "DNA_OS_RUNTIME", INBOUND_EVENT_GRANTS_AUTHORITY: false, adapter: getInboundAdapter(String(args.adapter_id)) });
    },
  },
  {
    metadata: {
      name: "dna_os.get_submitted_work",
      title: "Get Owner-submitted work",
      description: "Work remains visible after the Owner leaves the coding client.",
      read_write: "read",
      permission_scope: "local-resource-access",
      evidence_behavior: "returns DNA_OS_LOCAL_EXECUTION evidence after Owner-policy local resource authorization",
      dna_os_capability_id: "local-resource-access",
    },
    inputShape: { work_id: z.string().optional() },
    handler: async (args) => {
      const correlation_id = randomUUID();
      const gate = resolveCapabilityForTool("local-resource-access");
      if (gate.status !== "REGISTERED_VERIFIED_AVAILABLE") return capabilityNotAvailable(correlation_id, gate.capability_id, gate.reason);
      const id = typeof args.work_id === "string" ? args.work_id : null;
      const rows = id ? listSubmittedWork().filter((row) => row.work_id === id) : listSubmittedWork();
      return textResult({ status: 200, correlation_id, gate, source: "DNA_OS_RUNTIME", INBOUND_EVENT_GRANTS_AUTHORITY: false, work: rows });
    },
  },
  {
    metadata: {
      name: "dna_os.list_active_work",
      title: "List continuously visible submitted work",
      description: "Which coding client is doing what. Not a repository search.",
      read_write: "read",
      permission_scope: "local-resource-access",
      evidence_behavior: "returns DNA_OS_LOCAL_EXECUTION evidence after Owner-policy local resource authorization",
      dna_os_capability_id: "local-resource-access",
    },
    inputShape: {},
    handler: async () => {
      const correlation_id = randomUUID();
      const gate = resolveCapabilityForTool("local-resource-access");
      if (gate.status !== "REGISTERED_VERIFIED_AVAILABLE") return capabilityNotAvailable(correlation_id, gate.capability_id, gate.reason);
      return textResult({ status: 200, correlation_id, gate, source: "DNA_OS_RUNTIME", INBOUND_EVENT_SOURCE_SEARCH_REQUIRED: false, ...ownerWorkVisibility() });
    },
  },
  {
    metadata: {
      name: "dna_os.get_work_output_summary",
      title: "Work output accounting",
      description: "Reports/results/artifacts. Raw logs are not reports.",
      read_write: "read",
      permission_scope: "local-resource-access",
      evidence_behavior: "returns DNA_OS_LOCAL_EXECUTION evidence after Owner-policy local resource authorization",
      dna_os_capability_id: "local-resource-access",
    },
    inputShape: { work_id: z.string().optional() },
    handler: async (args) => {
      const correlation_id = randomUUID();
      const gate = resolveCapabilityForTool("local-resource-access");
      if (gate.status !== "REGISTERED_VERIFIED_AVAILABLE") return capabilityNotAvailable(correlation_id, gate.capability_id, gate.reason);
      return textResult({ status: 200, correlation_id, gate, source: "DNA_OS_RUNTIME", ...workOutputSummary(typeof args.work_id === "string" ? args.work_id : undefined) });
    },
  },
  {
    metadata: {
      name: "dna_os.get_owner_work_notification_summary",
      title: "Owner work notification summary",
      description: "Running/completed/failed/reports/attention. Backend only.",
      read_write: "read",
      permission_scope: "local-resource-access",
      evidence_behavior: "returns DNA_OS_LOCAL_EXECUTION evidence after Owner-policy local resource authorization",
      dna_os_capability_id: "local-resource-access",
    },
    inputShape: {},
    handler: async () => {
      const correlation_id = randomUUID();
      const gate = resolveCapabilityForTool("local-resource-access");
      if (gate.status !== "REGISTERED_VERIFIED_AVAILABLE") return capabilityNotAvailable(correlation_id, gate.capability_id, gate.reason);
      return textResult({ status: 200, correlation_id, gate, source: "DNA_OS_RUNTIME", ...ownerWorkNotificationSummary() });
    },
  },
  {
    metadata: {
      name: "dna_os.get_provider_event_status",
      title: "Inbound provider adapter health",
      description: "Does not fake email/messaging connectivity.",
      read_write: "read",
      permission_scope: "local-resource-access",
      evidence_behavior: "returns DNA_OS_LOCAL_EXECUTION evidence after Owner-policy local resource authorization",
      dna_os_capability_id: "local-resource-access",
    },
    inputShape: {},
    handler: async () => {
      const correlation_id = randomUUID();
      const gate = resolveCapabilityForTool("local-resource-access");
      if (gate.status !== "REGISTERED_VERIFIED_AVAILABLE") return capabilityNotAvailable(correlation_id, gate.capability_id, gate.reason);
      return textResult({
        status: 200,
        correlation_id,
        gate,
        source: "DNA_OS_RUNTIME",
        INBOUND_EVENT_GRANTS_AUTHORITY: false,
        adapters: discoverInboundAdapters().map((row) => ({ adapter_id: row.adapter_id, health: row.health, last_event_at: row.last_event_at })),
      });
    },
  },
  {
    metadata: {
      name: "dna_os.get_production_checkpoint",
      title: "Get production checkpoint",
      description: "Read-only PRODUCTION_CHECKPOINT_V1. Machine evidence, not agent prose.",
      read_write: "read",
      permission_scope: "local-resource-access",
      evidence_behavior: "returns DNA_OS_LOCAL_EXECUTION evidence after Owner-policy local resource authorization",
      dna_os_capability_id: "local-resource-access",
    },
    inputShape: { work_id: z.string(), checkpoint_type: z.string().optional() },
    handler: async (args) => {
      const correlation_id = randomUUID();
      const gate = resolveCapabilityForTool("local-resource-access");
      if (gate.status !== "REGISTERED_VERIFIED_AVAILABLE") return capabilityNotAvailable(correlation_id, gate.capability_id, gate.reason);
      return textResult({
        status: 200,
        correlation_id,
        gate,
        source: "DNA_OS_RUNTIME",
        AGENT_DONE_EQUALS_WORK_COMPLETED: false,
        checkpoint: getProductionCheckpoint(String(args.work_id), typeof args.checkpoint_type === "string" ? args.checkpoint_type : undefined),
      });
    },
  },
  {
    metadata: {
      name: "dna_os.list_production_checkpoints",
      title: "List production checkpoints",
      description: "Read-only checkpoint list. No execution authority.",
      read_write: "read",
      permission_scope: "local-resource-access",
      evidence_behavior: "returns DNA_OS_LOCAL_EXECUTION evidence after Owner-policy local resource authorization",
      dna_os_capability_id: "local-resource-access",
    },
    inputShape: { work_id: z.string().optional() },
    handler: async (args) => {
      const correlation_id = randomUUID();
      const gate = resolveCapabilityForTool("local-resource-access");
      if (gate.status !== "REGISTERED_VERIFIED_AVAILABLE") return capabilityNotAvailable(correlation_id, gate.capability_id, gate.reason);
      return textResult({
        status: 200,
        correlation_id,
        gate,
        source: "DNA_OS_RUNTIME",
        checkpoints: listProductionCheckpoints(typeof args.work_id === "string" ? args.work_id : undefined),
      });
    },
  },
  {
    metadata: {
      name: "dna_os.get_work_completion_readiness",
      title: "Work completion readiness",
      description: "WORK_COMPLETION_READINESS_V1. Agent done is not work completed.",
      read_write: "read",
      permission_scope: "local-resource-access",
      evidence_behavior: "returns DNA_OS_LOCAL_EXECUTION evidence after Owner-policy local resource authorization",
      dna_os_capability_id: "local-resource-access",
    },
    inputShape: { work_id: z.string() },
    handler: async (args) => {
      const correlation_id = randomUUID();
      const gate = resolveCapabilityForTool("local-resource-access");
      if (gate.status !== "REGISTERED_VERIFIED_AVAILABLE") return capabilityNotAvailable(correlation_id, gate.capability_id, gate.reason);
      return textResult({
        status: 200,
        correlation_id,
        gate,
        source: "DNA_OS_RUNTIME",
        AGENT_DONE_EQUALS_WORK_COMPLETED: false,
        readiness: getWorkCompletionReadiness(String(args.work_id)),
      });
    },
  },
  {
    metadata: {
      name: "dna_os.get_work_completion_report",
      title: "Work completion report",
      description: "WORK_COMPLETION_REPORT_V1. Raw logs are not reports.",
      read_write: "read",
      permission_scope: "local-resource-access",
      evidence_behavior: "returns DNA_OS_LOCAL_EXECUTION evidence after Owner-policy local resource authorization",
      dna_os_capability_id: "local-resource-access",
    },
    inputShape: { work_id: z.string() },
    handler: async (args) => {
      const correlation_id = randomUUID();
      const gate = resolveCapabilityForTool("local-resource-access");
      if (gate.status !== "REGISTERED_VERIFIED_AVAILABLE") return capabilityNotAvailable(correlation_id, gate.capability_id, gate.reason);
      return textResult({
        status: 200,
        correlation_id,
        gate,
        source: "DNA_OS_RUNTIME",
        report: getWorkCompletionReport(String(args.work_id)),
      });
    },
  },
  {
    metadata: {
      name: "dna_os.get_source_lineage_status",
      title: "Source lineage status",
      description: "Compare workspace/candidate/canonical/remote/deploy/runtime revisions. No auto-repair.",
      read_write: "read",
      permission_scope: "local-resource-access",
      evidence_behavior: "returns DNA_OS_LOCAL_EXECUTION evidence after Owner-policy local resource authorization",
      dna_os_capability_id: "local-resource-access",
    },
    inputShape: { work_id: z.string() },
    handler: async (args) => {
      const correlation_id = randomUUID();
      const gate = resolveCapabilityForTool("local-resource-access");
      if (gate.status !== "REGISTERED_VERIFIED_AVAILABLE") return capabilityNotAvailable(correlation_id, gate.capability_id, gate.reason);
      return textResult({
        status: 200,
        correlation_id,
        gate,
        source: "DNA_OS_RUNTIME",
        lineage: getSourceLineageStatus(String(args.work_id)),
      });
    },
  },
  {
    metadata: {
      name: "dna_os.get_production_readiness_summary",
      title: "Owner production readiness summary",
      description: "OWNER_PRODUCTION_READINESS_SUMMARY_V1. LOCAL_FIXTURE is not remote production.",
      read_write: "read",
      permission_scope: "local-resource-access",
      evidence_behavior: "returns DNA_OS_LOCAL_EXECUTION evidence after Owner-policy local resource authorization",
      dna_os_capability_id: "local-resource-access",
    },
    inputShape: {},
    handler: async () => {
      const correlation_id = randomUUID();
      const gate = resolveCapabilityForTool("local-resource-access");
      if (gate.status !== "REGISTERED_VERIFIED_AVAILABLE") return capabilityNotAvailable(correlation_id, gate.capability_id, gate.reason);
      const remote = remoteProductionGate();
      return textResult({
        status: 200,
        correlation_id,
        gate,
        source: "DNA_OS_RUNTIME",
        LOCAL_FIXTURE_EQUALS_REMOTE_PRODUCTION: false,
        REMOTE_PRODUCTION_READY: remote.REMOTE_PRODUCTION_READY,
        summary: ownerProductionReadinessSummary(),
      });
    },
  },
  {
    metadata: {
      name: "dna_os.get_lineage_closure_status",
      title: "Source lineage closure",
      description: "SOURCE_LINEAGE_CLOSURE_V1. Divergence is explicit. No auto-repair.",
      read_write: "read",
      permission_scope: "local-resource-access",
      evidence_behavior: "returns DNA_OS_LOCAL_EXECUTION evidence after Owner-policy local resource authorization",
      dna_os_capability_id: "local-resource-access",
    },
    inputShape: { work_id: z.string().optional() },
    handler: async (args) => {
      const correlation_id = randomUUID();
      const gate = resolveCapabilityForTool("local-resource-access");
      if (gate.status !== "REGISTERED_VERIFIED_AVAILABLE") return capabilityNotAvailable(correlation_id, gate.capability_id, gate.reason);
      return textResult({
        status: 200,
        correlation_id,
        gate,
        source: "DNA_OS_RUNTIME",
        AUTO_REPAIR_ALLOWED: false,
        lineage: getLineageClosureStatus(typeof args.work_id === "string" ? args.work_id : undefined),
      });
    },
  },
  {
    metadata: {
      name: "dna_os.list_admission_ready_work",
      title: "List admission-ready work",
      description: "Candidates that passed machine admission checks. Agent prose is irrelevant.",
      read_write: "read",
      permission_scope: "local-resource-access",
      evidence_behavior: "returns DNA_OS_LOCAL_EXECUTION evidence after Owner-policy local resource authorization",
      dna_os_capability_id: "local-resource-access",
    },
    inputShape: {},
    handler: async () => {
      const correlation_id = randomUUID();
      const gate = resolveCapabilityForTool("local-resource-access");
      if (gate.status !== "REGISTERED_VERIFIED_AVAILABLE") return capabilityNotAvailable(correlation_id, gate.capability_id, gate.reason);
      return textResult({
        status: 200,
        correlation_id,
        gate,
        source: "DNA_OS_RUNTIME",
        work: listAdmissionReadyWork(),
      });
    },
  },
  {
    metadata: {
      name: "dna_os.get_deployment_target_status",
      title: "Deployment target registry status",
      description: "LOCAL_FIXTURE vs REMOTE_REAL. Does not invent cloud deployment.",
      read_write: "read",
      permission_scope: "local-resource-access",
      evidence_behavior: "returns DNA_OS_LOCAL_EXECUTION evidence after Owner-policy local resource authorization",
      dna_os_capability_id: "local-resource-access",
    },
    inputShape: {},
    handler: async () => {
      const correlation_id = randomUUID();
      const gate = resolveCapabilityForTool("local-resource-access");
      if (gate.status !== "REGISTERED_VERIFIED_AVAILABLE") return capabilityNotAvailable(correlation_id, gate.capability_id, gate.reason);
      const remote = remoteProductionGate();
      return textResult({
        status: 200,
        correlation_id,
        gate,
        source: "DNA_OS_RUNTIME",
        targets: inspectDeploymentTargets(),
        REMOTE_PRODUCTION_READY: remote.REMOTE_PRODUCTION_READY,
        REMOTE_REAL: remote.REMOTE_REAL,
        PRODUCTION_ENVIRONMENT: remote.PRODUCTION_ENVIRONMENT,
        missing_boundary: remote.missing_boundary,
      });
    },
  },
  {
    metadata: {
      name: "dna_os.get_github_protection_status",
      title: "GitHub environment protection status",
      description: "Does not assume reviewers or protection rules. NOT_AVAILABLE when unverified.",
      read_write: "read",
      permission_scope: "local-resource-access",
      evidence_behavior: "returns DNA_OS_LOCAL_EXECUTION evidence after Owner-policy local resource authorization",
      dna_os_capability_id: "local-resource-access",
    },
    inputShape: {},
    handler: async () => {
      const correlation_id = randomUUID();
      const gate = resolveCapabilityForTool("local-resource-access");
      if (gate.status !== "REGISTERED_VERIFIED_AVAILABLE") return capabilityNotAvailable(correlation_id, gate.capability_id, gate.reason);
      return textResult({
        status: 200,
        correlation_id,
        gate,
        source: "DNA_OS_RUNTIME",
        ...githubProtectionStatus(),
      });
    },
  },
  {
    metadata: {
      name: "dna_os.list_remote_production_resources",
      title: "List discovered remote production resources",
      description: "Read-only REMOTE_RESOURCE_IDENTITY_V1. Does not grant deploy authority.",
      read_write: "read",
      permission_scope: "local-resource-access",
      evidence_behavior: "returns DNA_OS_LOCAL_EXECUTION evidence after Owner-policy local resource authorization",
      dna_os_capability_id: "local-resource-access",
    },
    inputShape: {},
    handler: async () => {
      const correlation_id = randomUUID();
      const gate = resolveCapabilityForTool("local-resource-access");
      if (gate.status !== "REGISTERED_VERIFIED_AVAILABLE") return capabilityNotAvailable(correlation_id, gate.capability_id, gate.reason);
      return textResult({
        status: 200,
        correlation_id,
        gate,
        source: "DNA_OS_RUNTIME",
        REMOTE_RESOURCE_DISCOVERY_GRANTS_AUTHORITY: false,
        resources: listRemoteProductionResources(),
      });
    },
  },
  {
    metadata: {
      name: "dna_os.get_remote_production_binding",
      title: "Remote production binding",
      description: "Read-only existing remote production discovery/binding report.",
      read_write: "read",
      permission_scope: "local-resource-access",
      evidence_behavior: "returns DNA_OS_LOCAL_EXECUTION evidence after Owner-policy local resource authorization",
      dna_os_capability_id: "local-resource-access",
    },
    inputShape: {},
    handler: async () => {
      const correlation_id = randomUUID();
      const gate = resolveCapabilityForTool("local-resource-access");
      if (gate.status !== "REGISTERED_VERIFIED_AVAILABLE") return capabilityNotAvailable(correlation_id, gate.capability_id, gate.reason);
      return textResult({
        status: 200,
        correlation_id,
        gate,
        source: "DNA_OS_RUNTIME",
        REMOTE_RESOURCE_DISCOVERY_GRANTS_AUTHORITY: false,
        binding: getRemoteProductionBinding(),
      });
    },
  },
  {
    metadata: {
      name: "dna_os.get_real_production_lineage",
      title: "Real production lineage",
      description: "REAL_PRODUCTION_LINEAGE_V1 excluding fixture revisions.",
      read_write: "read",
      permission_scope: "local-resource-access",
      evidence_behavior: "returns DNA_OS_LOCAL_EXECUTION evidence after Owner-policy local resource authorization",
      dna_os_capability_id: "local-resource-access",
    },
    inputShape: {},
    handler: async () => {
      const correlation_id = randomUUID();
      const gate = resolveCapabilityForTool("local-resource-access");
      if (gate.status !== "REGISTERED_VERIFIED_AVAILABLE") return capabilityNotAvailable(correlation_id, gate.capability_id, gate.reason);
      return textResult({
        status: 200,
        correlation_id,
        gate,
        source: "DNA_OS_RUNTIME",
        lineage: getRealProductionLineage(),
      });
    },
  },
  {
    metadata: {
      name: "dna_os.get_existing_deployment_method",
      title: "Existing deployment method",
      description: "Historical/existing deployment method. Does not invent a new pipeline.",
      read_write: "read",
      permission_scope: "local-resource-access",
      evidence_behavior: "returns DNA_OS_LOCAL_EXECUTION evidence after Owner-policy local resource authorization",
      dna_os_capability_id: "local-resource-access",
    },
    inputShape: {},
    handler: async () => {
      const correlation_id = randomUUID();
      const gate = resolveCapabilityForTool("local-resource-access");
      if (gate.status !== "REGISTERED_VERIFIED_AVAILABLE") return capabilityNotAvailable(correlation_id, gate.capability_id, gate.reason);
      return textResult({
        status: 200,
        correlation_id,
        gate,
        source: "DNA_OS_RUNTIME",
        ...getExistingDeploymentMethod(),
      });
    },
  },
  {
    metadata: {
      name: "dna_os.get_remote_authentication_status",
      title: "Remote authentication status",
      description: "Credential-ref readiness only. Never returns secrets.",
      read_write: "read",
      permission_scope: "local-resource-access",
      evidence_behavior: "returns DNA_OS_LOCAL_EXECUTION evidence after Owner-policy local resource authorization",
      dna_os_capability_id: "local-resource-access",
    },
    inputShape: {},
    handler: async () => {
      const correlation_id = randomUUID();
      const gate = resolveCapabilityForTool("local-resource-access");
      if (gate.status !== "REGISTERED_VERIFIED_AVAILABLE") return capabilityNotAvailable(correlation_id, gate.capability_id, gate.reason);
      return textResult({
        status: 200,
        correlation_id,
        gate,
        source: "DNA_OS_RUNTIME",
        ...getRemoteAuthenticationStatus(),
      });
    },
  },
  {
    metadata: {
      name: "dna_os.get_railway_deploy_capability_status",
      title: "Railway deploy capability status",
      description: "Read-only narrow deploy mutation status. Not deploy authority.",
      read_write: "read",
      permission_scope: "local-resource-access",
      evidence_behavior: "returns DNA_OS_LOCAL_EXECUTION evidence after Owner-policy local resource authorization",
      dna_os_capability_id: "local-resource-access",
    },
    inputShape: {},
    handler: async () => {
      const correlation_id = randomUUID();
      const gate = resolveCapabilityForTool("local-resource-access");
      if (gate.status !== "REGISTERED_VERIFIED_AVAILABLE") return capabilityNotAvailable(correlation_id, gate.capability_id, gate.reason);
      return textResult({
        status: 200,
        correlation_id,
        gate,
        source: "DNA_OS_RUNTIME",
        DEPLOY_WITHOUT_AUTHORITY: false,
        ...getRailwayDeployCapabilityStatus(),
      });
    },
  },
  {
    metadata: {
      name: "dna_os.get_remote_deployment",
      title: "Remote deployment record",
      description: "Last registered remote deployment. Request acceptance is not runtime success.",
      read_write: "read",
      permission_scope: "local-resource-access",
      evidence_behavior: "returns DNA_OS_LOCAL_EXECUTION evidence after Owner-policy local resource authorization",
      dna_os_capability_id: "local-resource-access",
    },
    inputShape: {},
    handler: async () => {
      const correlation_id = randomUUID();
      const gate = resolveCapabilityForTool("local-resource-access");
      if (gate.status !== "REGISTERED_VERIFIED_AVAILABLE") return capabilityNotAvailable(correlation_id, gate.capability_id, gate.reason);
      return textResult({ status: 200, correlation_id, gate, source: "DNA_OS_RUNTIME", deployment: getRemoteDeployment() });
    },
  },
  {
    metadata: {
      name: "dna_os.get_remote_deployment_revision",
      title: "Remote deployment revision",
      description: "Requested vs provider revision. Does not invent alignment.",
      read_write: "read",
      permission_scope: "local-resource-access",
      evidence_behavior: "returns DNA_OS_LOCAL_EXECUTION evidence after Owner-policy local resource authorization",
      dna_os_capability_id: "local-resource-access",
    },
    inputShape: {},
    handler: async () => {
      const correlation_id = randomUUID();
      const gate = resolveCapabilityForTool("local-resource-access");
      if (gate.status !== "REGISTERED_VERIFIED_AVAILABLE") return capabilityNotAvailable(correlation_id, gate.capability_id, gate.reason);
      return textResult({ status: 200, correlation_id, gate, source: "DNA_OS_RUNTIME", revision: getRemoteDeploymentRevision() });
    },
  },
  {
    metadata: {
      name: "dna_os.get_runtime_revision_alignment",
      title: "Runtime revision alignment",
      description: "Canonical/remote/deploy/runtime alignment. HTTP 200 is not revision proof.",
      read_write: "read",
      permission_scope: "local-resource-access",
      evidence_behavior: "returns DNA_OS_LOCAL_EXECUTION evidence after Owner-policy local resource authorization",
      dna_os_capability_id: "local-resource-access",
    },
    inputShape: {},
    handler: async () => {
      const correlation_id = randomUUID();
      const gate = resolveCapabilityForTool("local-resource-access");
      if (gate.status !== "REGISTERED_VERIFIED_AVAILABLE") return capabilityNotAvailable(correlation_id, gate.capability_id, gate.reason);
      return textResult({ status: 200, correlation_id, gate, source: "DNA_OS_RUNTIME", alignment: getRuntimeRevisionAlignment() });
    },
  },
  {
    metadata: {
      name: "dna_os.get_ai_queen_status",
      title: "AI Queen client status",
      description: "AI Queen is a DNA OS MCP capability consumer. Local runtime grants no authority.",
      read_write: "read",
      permission_scope: "local-resource-access",
      evidence_behavior: "returns DNA_OS_LOCAL_EXECUTION evidence after Owner-policy local resource authorization",
      dna_os_capability_id: "local-resource-access",
    },
    inputShape: {},
    handler: async () => {
      const correlation_id = randomUUID();
      const gate = resolveCapabilityForTool("local-resource-access");
      if (gate.status !== "REGISTERED_VERIFIED_AVAILABLE") return capabilityNotAvailable(correlation_id, gate.capability_id, gate.reason);
      return textResult({ status: 200, correlation_id, gate, source: "DNA_OS_RUNTIME", ...getAiQueenStatus() });
    },
  },
  {
    metadata: {
      name: "dna_os.get_ai_queen_capability_profile",
      title: "AI Queen granted capability profile",
      description: "Owner-granted operational tools only. Not a mutation catalog.",
      read_write: "read",
      permission_scope: "local-resource-access",
      evidence_behavior: "returns DNA_OS_LOCAL_EXECUTION evidence after Owner-policy local resource authorization",
      dna_os_capability_id: "local-resource-access",
    },
    inputShape: {},
    handler: async () => {
      const correlation_id = randomUUID();
      const gate = resolveCapabilityForTool("local-resource-access");
      if (gate.status !== "REGISTERED_VERIFIED_AVAILABLE") return capabilityNotAvailable(correlation_id, gate.capability_id, gate.reason);
      return textResult({ status: 200, correlation_id, gate, source: "DNA_OS_RUNTIME", ...getAiQueenCapabilityProfile() });
    },
  },
  {
    metadata: {
      name: "dna_os.get_railway_provider_interface_status",
      title: "Railway provider interface status",
      description: "Railway MCP/CLI sit behind DNA OS. Not production authority.",
      read_write: "read",
      permission_scope: "local-resource-access",
      evidence_behavior: "returns DNA_OS_LOCAL_EXECUTION evidence after Owner-policy local resource authorization",
      dna_os_capability_id: "local-resource-access",
    },
    inputShape: {},
    handler: async () => {
      const correlation_id = randomUUID();
      const gate = resolveCapabilityForTool("local-resource-access");
      if (gate.status !== "REGISTERED_VERIFIED_AVAILABLE") return capabilityNotAvailable(correlation_id, gate.capability_id, gate.reason);
      return textResult({
        status: 200,
        correlation_id,
        gate,
        source: "DNA_OS_RUNTIME",
        ...railwayMcpBehindDnaOs(),
        RAILWAY_MCP_DIRECT_AI_PRODUCTION_ACCESS: false,
      });
    },
  },
  {
    metadata: {
      name: "dna_os.get_railway_mcp_status",
      title: "Railway MCP/CLI discovery status",
      description: "CLI/MCP presence and login readiness. Never returns secrets or raw mutation tools.",
      read_write: "read",
      permission_scope: "local-resource-access",
      evidence_behavior: "returns DNA_OS_LOCAL_EXECUTION evidence after Owner-policy local resource authorization",
      dna_os_capability_id: "local-resource-access",
    },
    inputShape: {},
    handler: async () => {
      const correlation_id = randomUUID();
      const gate = resolveCapabilityForTool("local-resource-access");
      if (gate.status !== "REGISTERED_VERIFIED_AVAILABLE") return capabilityNotAvailable(correlation_id, gate.capability_id, gate.reason);
      const discovery = discoverRailwayMcpProvider();
      return textResult({
        status: 200,
        correlation_id,
        gate,
        source: "DNA_OS_RUNTIME",
        ...discovery,
        RAILWAY_SECRET_IN_MCP_CONTEXT: false,
      });
    },
  },
  {
    metadata: {
      name: "dna_os.get_github_main_governance",
      title: "GitHub canonical main governance",
      description: "Read-only GitHub main protection/ruleset discovery. Not mutation authority.",
      read_write: "read",
      permission_scope: "local-resource-access",
      evidence_behavior: "returns DNA_OS_LOCAL_EXECUTION evidence after Owner-policy local resource authorization",
      dna_os_capability_id: "local-resource-access",
    },
    inputShape: {},
    handler: async () => {
      const correlation_id = randomUUID();
      const gate = resolveCapabilityForTool("local-resource-access");
      if (gate.status !== "REGISTERED_VERIFIED_AVAILABLE") return capabilityNotAvailable(correlation_id, gate.capability_id, gate.reason);
      return textResult({ status: 200, correlation_id, gate, source: "DNA_OS_RUNTIME", ...getGithubMainGovernance() });
    },
  },
  {
    metadata: {
      name: "dna_os.get_github_ruleset_status",
      title: "GitHub ruleset status",
      description: "Read-only ruleset/evaluate/enforcement status. Does not create rulesets.",
      read_write: "read",
      permission_scope: "local-resource-access",
      evidence_behavior: "returns DNA_OS_LOCAL_EXECUTION evidence after Owner-policy local resource authorization",
      dna_os_capability_id: "local-resource-access",
    },
    inputShape: {},
    handler: async () => {
      const correlation_id = randomUUID();
      const gate = resolveCapabilityForTool("local-resource-access");
      if (gate.status !== "REGISTERED_VERIFIED_AVAILABLE") return capabilityNotAvailable(correlation_id, gate.capability_id, gate.reason);
      return textResult({ status: 200, correlation_id, gate, source: "DNA_OS_RUNTIME", ...getGithubRulesetStatus() });
    },
  },
  {
    metadata: {
      name: "dna_os.get_required_status_checks",
      title: "Discovered GitHub status checks",
      description: "Actual check/status contexts. Does not invent required check names.",
      read_write: "read",
      permission_scope: "local-resource-access",
      evidence_behavior: "returns DNA_OS_LOCAL_EXECUTION evidence after Owner-policy local resource authorization",
      dna_os_capability_id: "local-resource-access",
    },
    inputShape: {},
    handler: async () => {
      const correlation_id = randomUUID();
      const gate = resolveCapabilityForTool("local-resource-access");
      if (gate.status !== "REGISTERED_VERIFIED_AVAILABLE") return capabilityNotAvailable(correlation_id, gate.capability_id, gate.reason);
      return textResult({ status: 200, correlation_id, gate, source: "DNA_OS_RUNTIME", ...getRequiredStatusChecks() });
    },
  },
  {
    metadata: {
      name: "dna_os.get_github_bypass_policy",
      title: "GitHub bypass policy",
      description: "Human/AI/coding-client bypass is denied. Not a mutation tool.",
      read_write: "read",
      permission_scope: "local-resource-access",
      evidence_behavior: "returns DNA_OS_LOCAL_EXECUTION evidence after Owner-policy local resource authorization",
      dna_os_capability_id: "local-resource-access",
    },
    inputShape: {},
    handler: async () => {
      const correlation_id = randomUUID();
      const gate = resolveCapabilityForTool("local-resource-access");
      if (gate.status !== "REGISTERED_VERIFIED_AVAILABLE") return capabilityNotAvailable(correlation_id, gate.capability_id, gate.reason);
      return textResult({ status: 200, correlation_id, gate, source: "DNA_OS_RUNTIME", ...getGithubBypassPolicy() });
    },
  },
  {
    metadata: {
      name: "dna_os.get_remote_admission_gate_status",
      title: "DNA OS remote admission gate",
      description: "DNA_OS_REMOTE_ADMISSION_V1 reflects existing evidence. Not AI judgment.",
      read_write: "read",
      permission_scope: "local-resource-access",
      evidence_behavior: "returns DNA_OS_LOCAL_EXECUTION evidence after Owner-policy local resource authorization",
      dna_os_capability_id: "local-resource-access",
    },
    inputShape: {},
    handler: async () => {
      const correlation_id = randomUUID();
      const gate = resolveCapabilityForTool("local-resource-access");
      if (gate.status !== "REGISTERED_VERIFIED_AVAILABLE") return capabilityNotAvailable(correlation_id, gate.capability_id, gate.reason);
      return textResult({ status: 200, correlation_id, gate, source: "DNA_OS_RUNTIME", ...getRemoteAdmissionGateStatus() });
    },
  },
  ...([
    ["dna_os.get_information_entity", "entity_id"],
    ["dna_os.list_information_entities", "type"],
    ["dna_os.get_information_facts", "entity_id"],
    ["dna_os.get_information_relationships", "entity_id"],
    ["dna_os.get_information_boundaries", "connection_id"],
    ["dna_os.get_information_state", "entity_id"],
    ["dna_os.get_recent_events", "limit"],
    ["dna_os.get_active_activity", "none"],
    ["dna_os.get_owner_information_projection", "entity_id"],
    ["dna_os.get_consumer_payload", "entity_id"],
  ] as const).map(([name]) => ({
    metadata: {
      name,
      title: name,
      description: "Read-only DNA_OS_CANONICAL_INFORMATION_BACKEND_V1. Not authority.",
      read_write: "read" as const,
      permission_scope: "local-resource-access" as const,
      evidence_behavior: "returns DNA_OS_LOCAL_EXECUTION evidence after Owner-policy local resource authorization" as const,
      dna_os_capability_id: "local-resource-access",
    },
    inputShape: {
      entity_id: z.string().optional(),
      canonical_name: z.string().optional(),
      type: z.string().optional(),
      connection_id: z.string().optional(),
      limit: z.number().optional(),
      projection_type: z.string().optional(),
    },
    handler: async (args: Record<string, unknown>) => {
      const correlation_id = randomUUID();
      const gate = resolveCapabilityForTool("local-resource-access");
      if (gate.status !== "REGISTERED_VERIFIED_AVAILABLE") return capabilityNotAvailable(correlation_id, gate.capability_id, gate.reason);
      ensureSafeCanonicalIngest();
      const entityId = typeof args.entity_id === "string" ? args.entity_id : undefined;
      const payload =
        name === "dna_os.get_information_entity" ? (entityId ? queryEntityById(entityId) : queryEntityByCanonicalName(String(args.canonical_name ?? "")))
        : name === "dna_os.list_information_entities" ? listEntitiesByType((args.type as never) ?? "CAPABILITY")
        : name === "dna_os.get_information_facts" ? getFacts(entityId)
        : name === "dna_os.get_information_relationships" ? getRelationships(entityId)
        : name === "dna_os.get_information_boundaries" ? getBoundaries(typeof args.connection_id === "string" ? args.connection_id : undefined)
        : name === "dna_os.get_information_state" ? (entityId ? getCurrentState(entityId) : null)
        : name === "dna_os.get_recent_events" ? getRecentEvents(typeof args.limit === "number" ? args.limit : 20)
        : name === "dna_os.get_active_activity" ? getActiveActivities()
        : name === "dna_os.get_owner_information_projection" ? (entityId ? projectOwnerInformation(entityId, String(args.projection_type ?? "CAPABILITY_SUMMARY")) : null)
        : entityId ? consumerPayload(entityId, String(args.projection_type ?? "CAPABILITY_SUMMARY")) : null;
      return textResult({ status: 200, correlation_id, gate, source: "DNA_OS_RUNTIME", INFORMATION_ACCESS_GRANTS_AUTHORITY: false, result: payload });
    },
  })),
  {
    metadata: {
      name: "dna_os.resolve_tool_grant",
      title: "Resolve DNA OS MCP Tool Grant",
      description: "Ask DNA OS which MCP tools this caller may discover/invoke for the current scope. DNA OS decides the grant from export policy, capability gate, and canonical descriptors — the client does not choose arbitrary internal functions. Returns descriptors (references only, never secrets).",
      read_write: "read",
      permission_scope: "system-status",
      evidence_behavior: "returns DNA OS runtime/evidence facts with a DNA_OS_RUNTIME proof envelope",
      dna_os_capability_id: null,
    },
    inputShape: {
      requested_tool_id: z.string().optional().describe("Optional single tool_id to resolve; omit to list grants for this caller"),
      requested_capability_id: z.string().optional().describe("Optional capability_id filter"),
      task_scope: z.string().optional().describe("Optional scope such as VERIFICATION_READ_ONLY"),
      caller_context: z.object({
        caller: z.string(),
        channel: z.enum(["INTERNAL", "EXTERNAL"]),
        caller_class: z.enum(["UNAUTHENTICATED", "INTERNAL_DNA_OS", "OWNER_VERIFIED"]).optional(),
        owner_session_id: z.string().nullable().optional(),
        client_id: z.string().optional(),
        authority_domain: z.enum(["OPERATIONAL", "DEVELOPMENT"]).optional(),
        lease_active: z.boolean().optional(),
        granted_tools: z.array(z.string()).optional(),
      }).optional().describe("Caller context; when omitted, UNAUTHENTICATED EXTERNAL is assumed"),
    },
    handler: async (args) => {
      const { resolveToolGrant } = await import("./tool-grant");
      const correlation_id = randomUUID();
      const ctxRaw = args.caller_context;
      const caller = (ctxRaw && typeof ctxRaw === "object"
        ? ctxRaw
        : { caller: "external", channel: "EXTERNAL", caller_class: "UNAUTHENTICATED", owner_session_id: null }) as import("./export-policy").CallerContext;
      const result = resolveToolGrant({
        caller,
        requested_tool_id: typeof args.requested_tool_id === "string" ? args.requested_tool_id : undefined,
        requested_capability_id: typeof args.requested_capability_id === "string" ? args.requested_capability_id : undefined,
        task_scope: typeof args.task_scope === "string" ? args.task_scope : undefined,
      });
      return textResult({
        status: 200,
        correlation_id,
        source: "DNA_OS_RUNTIME",
        DNA_OS_IS_TOOL_AUTHORITY: true,
        secrets_exposed: false,
        ...result,
      });
    },
  },
  {
    metadata: {
      name: "dna_os.inspect_tool_descriptor",
      title: "Inspect Canonical MCP Tool Descriptor",
      description: "Resolve one tool_id to its canonical descriptor (capability/schema/connector/permission/approval/evidence references). Fail closed on unknown/revoked tools. Never returns credentials.",
      read_write: "read",
      permission_scope: "system-status",
      evidence_behavior: "returns DNA OS runtime/evidence facts with a DNA_OS_RUNTIME proof envelope",
      dna_os_capability_id: null,
    },
    inputShape: {
      tool_id: z.string().min(1).describe("Exact MCP tool_id to inspect"),
    },
    handler: async (args) => {
      const { resolveToolDescriptor } = await import("./tool-grant");
      const { canDiscover } = await import("./export-policy");
      const correlation_id = randomUUID();
      const toolId = String(args.tool_id ?? "");
      const discovery = canDiscover(toolId, { caller: "external", channel: "EXTERNAL", caller_class: "UNAUTHENTICATED" });
      // Unauthenticated inspect only for EXTERNAL_ALLOWED tools; others fail closed as not exposed
      const resolved = resolveToolDescriptor(toolId);
      if (resolved.status === "UNKNOWN_TOOL" || resolved.status === "REVOKED_TOOL") {
        return textResult({ status: resolved.status, correlation_id, tool_id: toolId, reason: resolved.reason, secrets_exposed: false }, true);
      }
      if (!discovery.allowed && resolved.descriptor?.export_class !== "EXTERNAL_ALLOWED") {
        return textResult({ status: "PERMISSION_DENIED", correlation_id, tool_id: toolId, reason: discovery.reason, secrets_exposed: false }, true);
      }
      if (resolved.status !== "RESOLVED") {
        return textResult({ status: resolved.status, correlation_id, tool_id: toolId, reason: resolved.reason, secrets_exposed: false }, true);
      }
      return textResult({
        status: 200,
        correlation_id,
        source: "DNA_OS_RUNTIME",
        secrets_exposed: false,
        descriptor: resolved.descriptor,
      });
    },
  },
];
