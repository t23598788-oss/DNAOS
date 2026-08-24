/**
 * หน้าที่: the seven MCP tools exposed by this capability folder. Every
 * handler does the same three things, in order: (1) run the MCP Tool
 * Resolver (./capability-gate.ts) — refuse with CAPABILITY_NOT_AVAILABLE
 * before touching anything else if it fails; (2) call exactly one method
 * on ./adapters/dna-os-http-client.ts, which itself only reaches DNA OS's
 * own already-canonical HTTP transport; (3) thread a correlation_id
 * through and return the real response, never a fabricated one.
 *
 * No tool here queries Postgres/Supabase, calls GitHub/Vercel/any
 * provider, holds a database credential, issues raw SQL, or bypasses the
 * Registration Gate / execution-policy / work-coordination — every one of
 * those already lives inside the DNA OS pipeline this file calls into,
 * never re-implemented here.
 *
 * `submit_work_result` is the one tool whose canonical ingress (`POST
 * /handoff`) already existed before this MCP layer — it was NOT built for
 * this round. Every other tool reuses an endpoint transport/owner-command-http/server.ts
 * already exposed. No shortcut was created for any tool that lacked one.
 *
 * Input: none (module-level tool list).
 * Output: `DNA_OS_MCP_TOOLS` — one entry per tool: metadata + a
 * `handler(args)` returning an MCP `CallToolResult`-shaped object.
 * Dependency ที่อนุญาต: ./types.ts, ./capability-gate.ts,
 * ./adapters/dna-os-http-client.ts, ./identity.ts, zod.
 * สิ่งที่ห้ามแตะ: never add an eighth tool for a capability that isn't
 * REGISTERED + VERIFIED + AVAILABLE (or a proven core primitive) — see
 * ./capability-gate.ts. Never let a handler call `fetch` against anything
 * other than the one DnaOsHttpClient instance it's given.
 */

import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { McpToolMetadata } from "./types";
import { resolveCapabilityForTool } from "./capability-gate";
import { DnaOsHttpClient } from "./adapters/dna-os-http-client";
import { resolveAgentIdentity } from "./identity";

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
      description: "Submit free-form or structured Owner command text into DNA OS's real owner-command Input Ingress. DNA OS classifies, routes, and executes it through the existing command-router/execution-policy pipeline — this tool never decides the outcome itself.",
      read_write: "write",
      permission_scope: "owner-command",
      evidence_behavior: "returns command_id/task_id/decision/evidence from the real DNA OS response",
      dna_os_capability_id: null,
    },
    inputShape: {
      commandText: z.string().min(1).describe("The command text, exactly as DNA OS's owner-command ingress expects it"),
      idempotencyKey: z.string().optional(),
      agentIdentity: AgentIdentityShape.describe("External agent identity, forwarded to DNA OS's real identity boundary — never used to choose account/workspace/permission scope directly"),
    },
    handler: async (args, client) => {
      const correlation_id = randomUUID();
      const gate = resolveCapabilityForTool(null);
      const identity = resolveAgentIdentity(args.agentIdentity as { id?: unknown; email?: unknown } | undefined);
      const response = await client.submitCommand({
        commandText: String(args.commandText),
        idempotencyKey: typeof args.idempotencyKey === "string" ? args.idempotencyKey : undefined,
        ownerIdentity: identity,
      });
      const body = response.body as Record<string, unknown>;
      const envelope = body.envelope as Record<string, unknown> | undefined;
      const result = body.result as Record<string, unknown> | undefined;
      const outputContract = body.output_contract as Record<string, unknown> | undefined;
      const decisionArtifact = Array.isArray(result?.artifacts) ? (result!.artifacts as Array<Record<string, unknown>>).find((a) => a.kind === "decision_id") : undefined;
      return textResult({
        status: response.status,
        correlation_id,
        gate,
        dna_os_command_id: envelope?.command_id ?? null,
        dna_os_task_id: result?.task_id ?? null,
        dna_os_decision_id: decisionArtifact?.ref ?? null,
        dna_os_result_status: result?.status ?? null,
        // Output Contract lane (contracts/command/output-contract.ts): SYSTEM_STATE
        // (a status fact — read directly, no AI mediation) or WORK_ITEM (real work
        // dispatched to a Worker/Agent — comes back only through DNA OS's own
        // Verify/Register/Next Decision path). For WORK_ITEM, dispatcher_task_id
        // names the real, separately-findable inner task.
        output_lane: outputContract?.lane ?? null,
        dispatcher_task_id: outputContract?.dispatcher_task_id ?? null,
        evidence: result?.evidence ?? [],
        raw: body,
      });
    },
  },
  {
    metadata: {
      name: "submit_registration_candidate",
      title: "Submit Registration Candidate",
      description: "Submit a software_registry Registration Candidate through DNA OS's real Registration Ingress (Domain Classification -> Registration Gate -> Registry Writer). A candidate whose real resource_type is business data is rejected by DNA OS itself, never by this tool guessing. The authoritative result is ingress_status (REGISTERED/DUPLICATE/REJECTED/UNRESOLVED) with reason_code/duplicate_of — registration_status is the pre-write Registration Gate decision only, kept for evidence/debugging, never the field to branch on.",
      read_write: "write",
      permission_scope: "registration-pipeline",
      evidence_behavior: "returns ingress_status (authoritative: REGISTERED/DUPLICATE/REJECTED/UNRESOLVED) with reason_code/duplicate_of, plus registration_status/resource_id/capability_id/evidence_id from the real Registration Pipeline — registration_status is informational (the Gate's pre-write decision), never the field to make a caller-side decision on",
      dna_os_capability_id: null,
    },
    inputShape: {
      request_id: z.string(),
      source_type: z.string(),
      source_id: z.string(),
      correlation_id: z.string().optional(),
      submitted_at: z.string().optional(),
      evidence_refs: z.array(z.string()),
      candidate: z.object({
        candidate_id: z.string(),
        name: z.string().optional(),
        canonical_name: z.string().optional(),
        kind: z.enum(["resource", "capability"]),
        source_location: z.string(),
        input_contract: z.record(z.string(), z.unknown()).optional(),
        output_contract: z.record(z.string(), z.unknown()).optional(),
        side_effects: z.array(z.string()).optional(),
        dependencies: z.array(z.string()).optional(),
        purpose: z.string().optional(),
        version: z.string().optional(),
        domain: z.string(),
        resource_type: z.string(),
        data_classification: z.string(),
        source_system: z.string(),
        scope: z.string(),
      }),
      agentIdentity: AgentIdentityShape,
    },
    handler: async (args, client) => {
      const correlation_id = (args.correlation_id as string | undefined) ?? randomUUID();
      const gate = resolveCapabilityForTool(null);
      const identity = resolveAgentIdentity(args.agentIdentity as { id?: unknown; email?: unknown } | undefined);
      const response = await client.submitRegistrationCandidate({
        ...args,
        correlation_id,
        submitted_at: (args.submitted_at as string | undefined) ?? new Date().toISOString(),
        ownerIdentity: identity,
      });
      const body = response.body as Record<string, unknown>;
      return textResult({
        status: response.status,
        correlation_id,
        gate,
        // ingress_status is the authoritative, final result — the only
        // field a caller should branch on. registration_status is the
        // Registration Gate's pre-write decision (e.g. still says
        // APPROVED_FOR_REGISTRATION even when the Writer's own
        // content_hash/semantic_fingerprint check later collapsed this
        // into an existing row) — informational only, see
        // software/registry-database/README.md's "Registration Ingress
        // Contract — result semantics".
        ingress_status: body.ingress_status ?? null,
        reason_code: body.reason_code ?? null,
        duplicate_of: body.duplicate_of ?? null,
        registration_status: body.registration_status ?? null,
        resource_id: body.resource_id ?? null,
        capability_id: body.capability_id ?? null,
        decision_id: body.decision_id ?? null,
        evidence_id: body.evidence_id ?? null,
        raw: body,
      });
    },
  },
  {
    metadata: {
      name: "lookup_capability",
      title: "Lookup Registered Capability",
      description: "Look up one capability by capability_id in DNA OS's real software_registry Lookup API. Returns the real row, or a clean not-found result for an unknown capability_id — never fabricated.",
      read_write: "read",
      permission_scope: "registry-lookup",
      evidence_behavior: "returns the real registry row or null, no evidence trail generated by a lookup",
      dna_os_capability_id: null,
    },
    inputShape: { capability_id: z.string().min(1) },
    handler: async (args, client) => {
      const correlation_id = randomUUID();
      const gate = resolveCapabilityForTool(null);
      const response = await client.lookupCapability(String(args.capability_id));
      const found = response.status === 200;
      return textResult({
        status: response.status,
        correlation_id,
        gate,
        found,
        capability: found ? response.body : null,
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
];
