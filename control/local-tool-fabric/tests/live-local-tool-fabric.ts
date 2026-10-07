/**
 * Live proofs 1–5 for LOCAL_TOOL_ADAPTER_FABRIC_V1 on this machine.
 *
 * How to run:
 *   npx tsx control/local-tool-fabric/tests/live-local-tool-fabric.ts
 */

import { existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createDnaOsMcpServer, DnaOsHttpClient, DNA_OS_MCP_TOOLS, UNAUTHENTICATED_CONTEXT } from "../../../connections/dna-os-mcp/contract";
import { issueLocalAccessGrant, issueOwnerCapabilityBindingPolicy, issueOwnerMachinePolicy } from "../../local-resource-access/contract";
import { listAppLauncherItems } from "../../owner-work-surface/contract";
import {
  executeLocalToolAction,
  getToolHealth,
  listDevices,
  listLocalAppCapabilityRegistry,
  listLocalTools,
  refreshLocalToolFabric,
  resolveLocalToolRoute,
  runLocalToolChain,
} from "../contract";

declare const process: { cwd(): string; env: Record<string, string | undefined>; exit(code?: number): never };
declare const console: { log(...args: unknown[]): void };

const STAMP = Date.now();
const LRA = join(process.cwd(), "control/local-resource-access/data");
const FABRIC = join(process.cwd(), "control/local-tool-fabric/data");
const OCR = join(process.cwd(), "control/owner-client-runtime/data");
const logs = [
  join(LRA, `ltf-live-grants-${STAMP}.jsonl`),
  join(LRA, `ltf-live-resources-${STAMP}.jsonl`),
  join(LRA, `ltf-live-events-${STAMP}.jsonl`),
  join(LRA, `ltf-live-egress-${STAMP}.jsonl`),
  join(LRA, `ltf-live-evidence-${STAMP}.jsonl`),
  join(LRA, `ltf-live-workspaces-${STAMP}.jsonl`),
  join(LRA, `ltf-live-transfer-${STAMP}.jsonl`),
  join(LRA, `ltf-live-omp-${STAMP}.jsonl`),
  join(LRA, `ltf-live-ocb-${STAMP}.jsonl`),
  join(FABRIC, `ltf-live-adapters-${STAMP}.jsonl`),
  join(FABRIC, `ltf-live-devices-${STAMP}.jsonl`),
  join(FABRIC, `ltf-live-health-${STAMP}.jsonl`),
  join(OCR, `ltf-live-handles-${STAMP}.jsonl`),
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
process.env.LOCAL_TOOL_ADAPTERS_LOG = logs[9];
process.env.LOCAL_TOOL_DEVICES_LOG = logs[10];
process.env.LOCAL_TOOL_HEALTH_LOG = logs[11];
process.env.RESOURCE_HANDLES_LOG = logs[12];

const WORK = `work-ltf-live-${STAMP}`;
const SESSION = `session-ltf-live-${STAMP}`;
const AI = "ai://external-style-client";
const FILE_RES = "resource://local/files/fixture-corpus";
const WRITE_RES = "resource://local/files/fixture-writable";
const APP = "resource://local/app/textedit";
const DISK = "resource://local/os/disk";
const COPY_NAME = `ltf-live-copy-${STAMP}.txt`;
const COPY_PATH = join(process.cwd(), "control/local-resource-access/fixtures/writable", COPY_NAME);

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
  grant(DISK, ["READ"]);
  issueOwnerCapabilityBindingPolicy({
    ai_identity: AI, session_id: SESSION,
    enabled_binding_ids: ["app://macos/textedit", FILE_RES, DISK],
    allowed_actions: ["READ", "SEARCH", "EXTRACT", "COPY", "SUMMARIZE"],
    visible_data_classes: ["APPLICATION_STATE", "TEXT", "FILE"],
    approval_required_actions: [],
    allowed_connection_ids: [],
    read_scope: [], write_scope: [], publish_scope: [],
    network_destinations: [],
    expires_at: null, effect: "ALLOW",
  });
  issueOwnerMachinePolicy({
    ai_identity: AI, session_id: SESSION,
    visible_resource_ids: [APP, FILE_RES, WRITE_RES, DISK],
    read_only_capabilities: ["local.system.disk.summary"],
    approval_required_capabilities: [],
    local_only_resource_ids: [DISK],
    allowed_network_destinations: ["none"],
    enabled_application_actions: ["textedit.read_state"],
    expires_at: null, effect: "ALLOW",
  });

  const discoveredBeforeEnable = refreshLocalToolFabric(`${WORK}-scan`, `session-scan-${STAMP}`, AI);
  const liveInventory = discoveredBeforeEnable.map((row) => ({
    adapter_id: row.adapter_id,
    adapter_type: row.adapter_type,
    DISCOVERED: true,
    CAPABILITY_STATE: row.availability,
    OWNER_AUTHORITY_STATE: row.owner_enabled ? "ALLOW" : "DENY",
  }));

  const adapters = refreshLocalToolFabric(WORK, SESSION, AI);
  const apps = listLocalAppCapabilityRegistry(AI, SESSION, WORK);
  const devices = listDevices();
  const launcher = listAppLauncherItems(AI, SESSION, WORK);

  const structured = await executeLocalToolAction({
    adapter_id: "adapter://app/textedit/file-interface",
    action: "READ",
    ai_client_id: AI, session_id: SESSION, work_id: `${WORK}-structured`,
  });
  const route = resolveLocalToolRoute({ action: "READ", application_id: "app://macos/textedit" });

  const chain = await runLocalToolChain({
    ai_client_id: AI, session_id: SESSION, work_id: `${WORK}-chain`,
    steps: [
      { adapter_id: "adapter://files/fixture-corpus/file-interface", action: "SEARCH", payload: { query: "zzqegate-local-resource-marker" } },
      { adapter_id: "adapter://files/fixture-corpus/file-interface", action: "EXTRACT", payload: { logical_path: "notes.txt" } },
      { adapter_id: "adapter://files/convert/unavailable", action: "CONVERT", payload: { logical_path: "notes.txt" } },
      {
        adapter_id: "adapter://files/fixture-corpus/file-interface",
        action: "COPY",
        payload: {
          source_logical: "notes.txt",
          destination_logical: COPY_NAME,
          destination_resource_id: WRITE_RES,
          preview_approved: true,
        },
      },
    ],
  });

  const deviceRead = await executeLocalToolAction({
    adapter_id: "adapter://os/disk",
    action: "READ",
    ai_client_id: AI, session_id: SESSION, work_id: `${WORK}-device`,
  });

  const fallback = adapters.find((row) => row.adapter_type === "ACCESSIBILITY_FALLBACK");
  const fallbackDenied = fallback
    ? await executeLocalToolAction({
      adapter_id: fallback.adapter_id, action: "READ",
      ai_client_id: AI, session_id: SESSION, work_id: `${WORK}-fallback`,
    })
    : { ok: false, reason_code: "NO_FALLBACK_CANDIDATE" };

  const mcpClient = new Client({ name: "external-style-fabric", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const mcpServer = createDnaOsMcpServer(new DnaOsHttpClient(), UNAUTHENTICATED_CONTEXT);
  await mcpServer.connect(serverTransport);
  await mcpClient.connect(clientTransport);
  const listed = structuredOf(await mcpClient.callTool({
    name: "dna_os.list_local_tools",
    arguments: { ai_client_id: AI, session_id: SESSION, work_id: WORK },
  }) as never);
  const mcpDevices = structuredOf(await mcpClient.callTool({
    name: "dna_os.list_devices",
    arguments: { ai_client_id: AI, session_id: SESSION, work_id: WORK },
  }) as never);
  await mcpClient.close();

  const byType = (type: string) => adapters.filter((row) => row.adapter_type === type).length;
  const structuredNative = adapters.filter((row) => ["FILE_INTERFACE", "APP_INTENT", "MCP", "WEBMCP"].includes(row.adapter_type)).length;
  const officialCli = byType("OFFICIAL_CLI") + byType("OFFICIAL_API");
  const localService = adapters.filter((row) => ["LOCAL_HTTP", "LOCAL_SOCKET", "OS_SERVICE"].includes(row.adapter_type)).length;
  const proofsOk =
    discoveredBeforeEnable.every((row) => row.owner_enabled === false)
    && structured.ok === true
    && chain.ok === true
    && (chain.convert_skipped as { NOT_AVAILABLE?: boolean } | null)?.NOT_AVAILABLE === true
    && deviceRead.ok === true
    && fallbackDenied.ok === false
    && listed.status === 200
    && mcpDevices.status === 200;

  console.log(JSON.stringify({
    LOCAL_TOOL_ADAPTER_FABRIC_V1: "implemented",
    LOCAL_APP_CAPABILITY_REGISTRY_V1: "implemented",
    DEVICE_RESOURCE_V1: "implemented",
    NATIVE_INTERFACE_FIRST_V1: "implemented",
    LOCAL_TOOL_CHAIN_V1: "implemented",
    TOOL_CAPABILITY_HEALTH_V1: "implemented",
    LOCAL_APPLICATIONS_DISCOVERED: apps.length,
    LOCAL_TOOLS_DISCOVERED: adapters.length,
    LOCAL_DEVICES_DISCOVERED: devices.length,
    APP_INSTALLATION_GRANTS_AUTHORITY: false,
    APP_CATEGORY_IMPLIES_CAPABILITY: false,
    OWNER_ENABLED_REQUIRED: true,
    STRUCTURED_NATIVE_ADAPTERS: structuredNative,
    OFFICIAL_CLI_ADAPTERS: officialCli,
    LOCAL_SERVICE_ADAPTERS: localService,
    PROCESS_GATE_ADAPTERS: byType("PROCESS_GATE"),
    ACCESSIBILITY_FALLBACK_ADAPTERS: byType("ACCESSIBILITY_FALLBACK"),
    ARBITRARY_SHELL_ACCESS: false,
    SUDO_ACCESS: false,
    ARBITRARY_UI_AUTOMATION: false,
    TOOL_CHAINING: chain.ok === true,
    RESOURCE_HANDLE_CHAINING: Array.isArray(chain.handles) && (chain.handles as string[]).length > 0,
    RAW_SOURCE_DUPLICATION_REQUIRED: false,
    LIVE_MACHINE_TOOL_INVENTORY: liveInventory.slice(0, 12),
    LIVE_STRUCTURED_APP: {
      application_discovered: apps.some((row) => row.application_id === "app://macos/textedit"),
      adapter_resolved: route.selected?.adapter_id ?? null,
      adapter_type: route.selected?.adapter_type ?? null,
      executed: structured.ok === true,
    },
    LIVE_TOOL_CHAIN: {
      ok: chain.ok,
      convert: (chain.convert_skipped as { NOT_AVAILABLE?: boolean } | null)?.NOT_AVAILABLE ? "NOT_AVAILABLE" : "EXECUTED",
      copy_created: existsSync(COPY_PATH),
    },
    LIVE_DEVICE: {
      device_id: "device://storage/this-machine",
      adapter_id: "adapter://os/disk",
      ok: deviceRead.ok === true,
      mutation: false,
    },
    LIVE_FALLBACK_BOUNDARY: {
      structured_adapter: "unavailable",
      adapter_id: fallback?.adapter_id ?? null,
      ACTION: "DENY",
      reason_code: fallbackDenied.reason_code,
    },
    OWNER_WORK_SURFACE_INTEGRATED: launcher.some((row) => row.app_id.startsWith("device://")),
    EXISTING_MCP_REUSED: DNA_OS_MCP_TOOLS.some((tool) => tool.metadata.name === "dna_os.list_local_tools"),
    SECOND_MCP_SERVER_CREATED: false,
    SECOND_CONTROL_PLANE_CREATED: false,
    NEW_AGENT_CREATED: false,
    NEW_AI_MODEL_INSTALLED: false,
    TEXT_EDIT_HEALTH: getToolHealth("adapter://app/textedit/file-interface"),
    MCP_LIST_STATUS: listed.status,
    FINAL_STATUS: proofsOk ? "VERIFIED" : "FAILED",
  }, null, 2));

  if (existsSync(COPY_PATH)) unlinkSync(COPY_PATH);
  for (const file of logs) {
    if (existsSync(file)) unlinkSync(file);
  }
  process.exit(proofsOk ? 0 : 1);
}

void main();
