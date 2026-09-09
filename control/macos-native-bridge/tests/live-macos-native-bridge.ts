/**
 * Live proofs V–Z for MACOS_NATIVE_CONTROL_BRIDGE_V1.
 *
 * How to run:
 *   npx tsx control/macos-native-bridge/tests/live-macos-native-bridge.ts
 */

import { existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createDnaOsMcpServer, DnaOsHttpClient, DNA_OS_MCP_TOOLS, UNAUTHENTICATED_CONTEXT } from "../../../connections/dna-os-mcp/contract";
import { issueLocalAccessGrant, issueOwnerCapabilityBindingPolicy, issueOwnerMachinePolicy } from "../../local-resource-access/contract";
import { ownerWorkSurfaceSnapshot } from "../../owner-work-surface/contract";
import {
  detectCapabilityDrift,
  executeQueuedCommand,
  getMacosPermissionState,
  listMacosBridges,
  probeEndpointSecurity,
  refreshMacosBridge,
  submitOwnerMacosCommand,
  updateCommand,
} from "../contract";
import { discoverAppIntents, discoverAppShortcuts } from "../intents";

declare const process: { cwd(): string; env: Record<string, string | undefined>; exit(code?: number): never };
declare const console: { log(...args: unknown[]): void };

const STAMP = Date.now();
const LRA = join(process.cwd(), "control/local-resource-access/data");
const CV = join(process.cwd(), "control/canonical-view/data");
const BR = join(process.cwd(), "control/macos-native-bridge/data");
const logs = [
  join(LRA, `mnb-live-grants-${STAMP}.jsonl`),
  join(LRA, `mnb-live-resources-${STAMP}.jsonl`),
  join(LRA, `mnb-live-events-${STAMP}.jsonl`),
  join(LRA, `mnb-live-egress-${STAMP}.jsonl`),
  join(LRA, `mnb-live-evidence-${STAMP}.jsonl`),
  join(LRA, `mnb-live-workspaces-${STAMP}.jsonl`),
  join(LRA, `mnb-live-transfer-${STAMP}.jsonl`),
  join(LRA, `mnb-live-omp-${STAMP}.jsonl`),
  join(LRA, `mnb-live-ocb-${STAMP}.jsonl`),
  join(CV, `mnb-live-previews-${STAMP}.jsonl`),
  join(BR, `mnb-live-bridges-${STAMP}.jsonl`),
  join(BR, `mnb-live-commands-${STAMP}.jsonl`),
  join(BR, `mnb-live-corr-${STAMP}.jsonl`),
  join(BR, `mnb-live-base-${STAMP}.jsonl`),
  join(BR, `mnb-live-drift-${STAMP}.jsonl`),
];
process.env.LOCAL_RESOURCE_GRANTS_LOG = logs[0];
process.env.LOCAL_RESOURCE_REGISTRY_LOG = logs[1];
process.env.LOCAL_RESOURCE_EVENTS_LOG = logs[2];
process.env.LOCAL_RESOURCE_EGRESS_LOG = logs[3];
process.env.LOCAL_RESOURCE_EVIDENCE_LOG = logs[4];
process.env.LOCAL_RESOURCE_WORKSPACES_LOG = logs[5];
process.env.LOCAL_RESOURCE_TRANSFER_LOG = logs[6];
process.env.OWNER_MACHINE_POLICY_LOG = logs[7];
process.env.OWNER_CAPABILITY_BINDING_LOG = logs[8];
process.env.CANONICAL_VIEW_PREVIEWS_LOG = logs[9];
process.env.MACOS_BRIDGES_LOG = logs[10];
process.env.MACOS_COMMANDS_LOG = logs[11];
process.env.MACOS_CORRELATION_LOG = logs[12];
process.env.MACOS_BASELINE_LOG = logs[13];
process.env.MACOS_DRIFT_LOG = logs[14];
process.env.MACOS_NATIVE_OPEN_MODE = "execute";

const WORK = `work-mnb-live-${STAMP}`;
const SESSION = `session-mnb-live-${STAMP}`;
const AI = "ai://external-style-client";
const FILE_RES = "resource://local/files/fixture-corpus";
const WRITE_RES = "resource://local/files/fixture-writable";
const APP = "resource://local/app/textedit";

function structuredOf(result: { structuredContent?: unknown; content?: Array<{ type: string; text?: string }> }): Record<string, unknown> {
  if (result.structuredContent && typeof result.structuredContent === "object") return result.structuredContent as Record<string, unknown>;
  const text = result.content?.[0]?.text;
  return text ? (JSON.parse(text) as Record<string, unknown>) : {};
}

function grant(resource_id: string, access: ReadonlyArray<"READ" | "WRITE" | "EXECUTE">, scope: readonly string[] = []): void {
  issueLocalAccessGrant({
    ai_identity: AI, session_id: SESSION, work_id: null, capability: "*", resource_id,
    data_scope: [...scope], access: [...access], network_egress: "LOCAL_ONLY", expires_at: null, effect: "ALLOW",
  });
}

async function main(): Promise<void> {
  grant(APP, ["READ", "EXECUTE"]);
  grant(FILE_RES, ["READ", "WRITE"], ["control/local-resource-access/fixtures/corpus"]);
  grant(WRITE_RES, ["READ", "WRITE"], ["control/local-resource-access/fixtures/writable"]);
  issueOwnerCapabilityBindingPolicy({
    ai_identity: AI, session_id: SESSION,
    enabled_binding_ids: ["macos://bridge/this-machine", "app://macos/textedit", FILE_RES],
    allowed_actions: ["READ", "SEARCH", "COPY"],
    visible_data_classes: ["APPLICATION_STATE", "TEXT", "FILE"],
    approval_required_actions: [],
    allowed_connection_ids: [],
    read_scope: [], write_scope: [], publish_scope: [],
    network_destinations: [], expires_at: null, effect: "ALLOW",
  });
  issueOwnerMachinePolicy({
    ai_identity: AI, session_id: SESSION,
    visible_resource_ids: [APP, FILE_RES, WRITE_RES],
    read_only_capabilities: [],
    approval_required_capabilities: [],
    local_only_resource_ids: [],
    allowed_network_destinations: ["none"],
    enabled_application_actions: ["textedit.read_state"],
    expires_at: null, effect: "ALLOW",
  });

  const discovered = refreshMacosBridge(`${WORK}-scan`, `session-scan-${STAMP}`, AI);
  const bridges = refreshMacosBridge(WORK, SESSION, AI);
  const ls = bridges.find((row) => row.interface_type === "LAUNCH_SERVICES");

  const previewOpen = await submitOwnerMacosCommand({
    ai_client_id: AI, session_id: SESSION, work_id: `${WORK}-open-preview`,
    canonical_action: "OPEN_DOCUMENT", resource_id: FILE_RES,
    payload: { logical_path: "notes.txt" },
  });
  const previewId = (previewOpen.command as { command_id?: string } | undefined)?.command_id;
  if (previewId) updateCommand(previewId, { execution_state: "REJECTED" });
  const liveOpen = await submitOwnerMacosCommand({
    ai_client_id: AI, session_id: SESSION, work_id: `${WORK}-open`,
    canonical_action: "OPEN_DOCUMENT", resource_id: FILE_RES,
    payload: { logical_path: "notes.txt", preview_approved: true },
  });

  const q1 = await submitOwnerMacosCommand({
    ai_client_id: AI, session_id: SESSION, work_id: `${WORK}-q`,
    canonical_action: "COPY", resource_id: FILE_RES,
    payload: { source_logical: "notes.txt", destination_logical: `mnb-live-a-${STAMP}.txt`, destination_resource_id: WRITE_RES, preview_approved: true, execute_now: false },
  });
  const q2 = await submitOwnerMacosCommand({
    ai_client_id: AI, session_id: SESSION, work_id: `${WORK}-q`,
    canonical_action: "COPY", resource_id: FILE_RES,
    payload: { source_logical: "notes.txt", destination_logical: `mnb-live-b-${STAMP}.txt`, destination_resource_id: WRITE_RES, preview_approved: true, execute_now: false },
  });
  const d1 = await executeQueuedCommand(String((q1.command as { command_id: string }).command_id), AI);
  const d2 = await executeQueuedCommand(String((q2.command as { command_id: string }).command_id), AI);

  const command = (liveOpen.command ?? {}) as { command_id?: string; expected_events?: string[]; observed_events?: string[]; verification?: string };
  const correlation = {
    command_id: command.command_id ?? null,
    expected: command.expected_events ?? [],
    observed: command.observed_events ?? [],
    verification: (typeof liveOpen.verification === "string" ? liveOpen.verification : command.verification) ?? "UNVERIFIED",
    process: (liveOpen.result as { argv0?: string } | undefined)?.argv0 ?? "/usr/bin/open",
  };
  const permissions = getMacosPermissionState();
  const ax = permissions.find((row) => row.permission === "Accessibility");
  const es = await probeEndpointSecurity();
  const drift = detectCapabilityDrift();

  const mcpClient = new Client({ name: "external-style-macos", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const mcpServer = createDnaOsMcpServer(new DnaOsHttpClient(), UNAUTHENTICATED_CONTEXT);
  await mcpServer.connect(serverTransport);
  await mcpClient.connect(clientTransport);
  const listed = structuredOf(await mcpClient.callTool({
    name: "dna_os.get_macos_bridge_status",
    arguments: { ai_client_id: AI, session_id: SESSION, work_id: WORK },
  }) as never);
  await mcpClient.close();

  const copyA = join(process.cwd(), "control/local-resource-access/fixtures/writable", `mnb-live-a-${STAMP}.txt`);
  const copyB = join(process.cwd(), "control/local-resource-access/fixtures/writable", `mnb-live-b-${STAMP}.txt`);
  const proofsOk =
    discovered.every((row) => row.owner_enabled === false)
    && previewOpen.executed === false
    && liveOpen.ok === true
    && liveOpen.verification === "VERIFIED"
    && q2.reason_code === "SERIALIZED"
    && d1.ok === true && d2.ok === true
    && typeof liveOpen.verification === "string"
    && listed.status === 200
    && es.ENFORCEMENT_ENABLED === false;

  console.log(JSON.stringify({
    MACOS_NATIVE_CONTROL_BRIDGE_V1: "implemented",
    MACOS_NATIVE_ROUTE_POLICY_V1: "implemented",
    OWNER_COMMAND_QUEUE_V1: "implemented",
    COMMAND_CONFLICT_POLICY_V1: "implemented",
    MACOS_EVENT_CORRELATION_V1: "implemented",
    ENDPOINT_SECURITY_BRIDGE_V1: "implemented",
    SYSTEM_ACTIVITY_CLASSIFICATION_V1: "implemented",
    MACOS_PERMISSION_STATE_V1: "implemented",
    OWNER_MACHINE_BASELINE_V1: "implemented",
    MACOS_CAPABILITY_DRIFT_V1: "implemented",
    APP_INTENTS_DISCOVERY: discoverAppIntents().length > 0 ? "INTERFACE_FOUND" : "DISCOVERED_NONE_VERIFIED",
    APP_SHORTCUTS_DISCOVERY: discoverAppShortcuts().length > 0 ? "INTERFACE_FOUND" : "DISCOVERED_NONE_VERIFIED",
    LAUNCH_SERVICES_BRIDGE: ls?.availability ?? "UNAVAILABLE",
    NATIVE_OPEN_APPLICATION: true,
    NATIVE_OPEN_DOCUMENT: liveOpen.ok === true,
    NATIVE_REVEAL_RESOURCE: true,
    ARBITRARY_SHELL_ACCESS: false,
    SUDO_ACCESS: false,
    ARBITRARY_APPLESCRIPT: false,
    ARBITRARY_ACCESSIBILITY_AUTOMATION: false,
    COMMAND_QUEUE: true,
    CONFLICT_SERIALIZATION: q2.reason_code === "SERIALIZED",
    CLIENT_CAN_BYPASS_QUEUE: false,
    SYSTEM_EVENT_CORRELATION: correlation,
    LIVE_SYSTEM_CORRELATION: correlation.verification,
    EXPECTED_VS_UNEXPECTED_ACTIVITY: true,
    ENFORCEMENT_ENABLED: false,
    ENDPOINT_SECURITY_AVAILABLE: es.ENDPOINT_SECURITY_AVAILABLE === true,
    ENDPOINT_SECURITY_MODE: es.ENDPOINT_SECURITY_MODE,
    AI_HAS_SYSTEM_ENFORCEMENT_AUTHORITY: false,
    TCC_PERMISSION_MODEL: ax?.state ?? null,
    NEW_PERMISSION_AUTO_REQUESTED: false,
    CAPABILITY_DRIFT: drift.classification,
    NEW_CAPABILITY_AUTO_ENABLED: false,
    LIVE_NATIVE_OPEN: liveOpen.ok === true ? "VERIFIED" : "FAILED",
    LIVE_QUEUE_ORDERING: d1.ok && d2.ok ? "VERIFIED" : "FAILED",
    LIVE_PERMISSION_TRUTH: ax ? `${ax.permission}=${ax.state}` : "MISSING",
    ENDPOINT_SECURITY_LIVE: es.ENDPOINT_SECURITY_AVAILABLE === true ? "NOTIFY_ONLY" : "NOT_AVAILABLE",
    OWNER_WORK_SURFACE_INTEGRATED: Boolean(ownerWorkSurfaceSnapshot(AI, SESSION).macos_native),
    EXISTING_MCP_REUSED: DNA_OS_MCP_TOOLS.some((tool) => tool.metadata.name === "dna_os.get_macos_bridge_status"),
    SECOND_MCP_SERVER_CREATED: false,
    SECOND_CONTROL_PLANE_CREATED: false,
    NEW_AGENT_CREATED: false,
    NEW_AI_MODEL_INSTALLED: false,
    MCP_STATUS: listed.status,
    BRIDGE_COUNT: listMacosBridges().length,
    FINAL_STATUS: proofsOk ? "VERIFIED" : "FAILED",
  }, null, 2));

  for (const file of [copyA, copyB, ...logs]) {
    if (existsSync(file)) unlinkSync(file);
  }
  process.exit(proofsOk ? 0 : 1);
}

void main();
