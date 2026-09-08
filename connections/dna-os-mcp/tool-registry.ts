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
      payload: z.record(z.unknown()).optional().describe("Owner-presented envelope payload such as engineering_coding_intent"),
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
];
