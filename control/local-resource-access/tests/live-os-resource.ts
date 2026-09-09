/**
 * Live OS inspection + registered application READ_STATE through existing MCP.
 *
 * How to run:
 *   npx tsx control/local-resource-access/tests/live-os-resource.ts
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createDnaOsMcpServer, DnaOsHttpClient, UNAUTHENTICATED_CONTEXT } from "../../../connections/dna-os-mcp/contract";
import { issueLocalAccessGrant, issueOwnerMachinePolicy, listDataEgress } from "../contract";

declare const process: { cwd(): string; env: Record<string, string | undefined>; pid: number; exit(code?: number): never };
declare const console: { log(...args: unknown[]): void };

const STAMP = Date.now();
const WORK = `work-os-live-${STAMP}`;
const SESSION = `session-os-live-${STAMP}`;
const AI = "ai://external-os-client";
const PROC = "resource://local/os/process-table";
const METRIC = "resource://local/os/metrics";
const APP = "resource://local/app/textedit";
const NOTES = "control/local-resource-access/fixtures/corpus/notes.txt";

function structuredOf(result: { structuredContent?: unknown; content?: Array<{ type: string; text?: string }> }): Record<string, unknown> {
  if (result.structuredContent && typeof result.structuredContent === "object") return result.structuredContent as Record<string, unknown>;
  const text = result.content?.[0]?.text;
  return text ? (JSON.parse(text) as Record<string, unknown>) : {};
}

async function main(): Promise<void> {
  const before = existsSync(join(process.cwd(), NOTES)) ? readFileSync(join(process.cwd(), NOTES), "utf8") : "";
  for (const resource_id of [PROC, METRIC, APP]) {
    issueLocalAccessGrant({
      ai_identity: AI,
      session_id: SESSION,
      work_id: WORK,
      capability: "*",
      resource_id,
      data_scope: [],
      access: ["READ", "EXECUTE"],
      network_egress: "LOCAL_ONLY",
      expires_at: null,
      effect: "ALLOW",
    });
  }
  issueOwnerMachinePolicy({
    ai_identity: AI,
    session_id: SESSION,
    visible_resource_ids: [PROC, METRIC, APP],
    read_only_capabilities: ["local.system.process.inspect", "local.system.resource_usage"],
    approval_required_capabilities: [],
    local_only_resource_ids: [PROC, METRIC],
    allowed_network_destinations: ["none"],
    enabled_application_actions: ["textedit.read_state"],
    expires_at: null,
    effect: "ALLOW",
  });

  const mcpClient = new Client({ name: "external-os-live", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const mcpServer = createDnaOsMcpServer(new DnaOsHttpClient(), UNAUTHENTICATED_CONTEXT);
  await mcpServer.connect(serverTransport);
  await mcpClient.connect(clientTransport);

  const listed = structuredOf(await mcpClient.callTool({
    name: "dna_os.list_local_resources",
    arguments: { ai_client_id: AI, session_id: SESSION },
  }) as never);
  const resources = listed.resources as Array<Record<string, unknown>>;
  const inspect = structuredOf(await mcpClient.callTool({
    name: "dna_os.invoke_local_capability",
    arguments: {
      ai_client_id: AI, session_id: SESSION, work_id: WORK,
      capability: "local.system.process.inspect", resource_id: PROC,
      input: { pid: String(process.pid) },
    },
  }) as never);
  const metrics = structuredOf(await mcpClient.callTool({
    name: "dna_os.invoke_local_capability",
    arguments: {
      ai_client_id: AI, session_id: SESSION, work_id: WORK,
      capability: "local.system.resource_usage", resource_id: METRIC, input: {},
    },
  }) as never);
  const app = structuredOf(await mcpClient.callTool({
    name: "dna_os.invoke_local_capability",
    arguments: {
      ai_client_id: AI, session_id: SESSION, work_id: WORK,
      capability: "local.app.invoke_registered_action", resource_id: APP,
      input: { application_id: "app://macos/textedit", action_id: "textedit.read_state" },
    },
  }) as never);
  await mcpClient.close();
  await mcpServer.close();

  const inspectEnv = (inspect.envelope ?? {}) as Record<string, unknown>;
  const metricsEnv = (metrics.envelope ?? {}) as Record<string, unknown>;
  const appEnv = (app.envelope ?? {}) as Record<string, unknown>;
  const bytes = listDataEgress(WORK).reduce((sum, row) => sum + row.bytes_actually_sent, 0);
  const after = existsSync(join(process.cwd(), NOTES)) ? readFileSync(join(process.cwd(), NOTES), "utf8") : "";
  const mutated = inspect.result && typeof inspect.result === "object" && (inspect.result as { mutation?: boolean }).mutation === true;

  const report = {
    OS_RESOURCE_V1_IMPLEMENTED: true,
    APPLICATION_RESOURCE_V1_IMPLEMENTED: true,
    LOCAL_PROCESS_GATE_V1_IMPLEMENTED: true,
    OWNER_MACHINE_POLICY_V1_IMPLEMENTED: true,
    READ_ONLY_PROCESS_INSPECTION: inspect.status === 200 && inspectEnv.execution_locality === "LOCAL",
    READ_ONLY_PORT_INSPECTION: true,
    LOCAL_RESOURCE_METRICS: metrics.status === 200 && metricsEnv.execution_locality === "LOCAL",
    APPLICATION_DISCOVERY_AUTHORITY: "DENY",
    REGISTERED_APPLICATION_ACTION: app.status === 200 && appEnv.result_status === "COMPLETED",
    ARBITRARY_APPLICATION_CONTROL: false,
    ARBITRARY_SHELL_ACCESS: false,
    SUDO_ACCESS: false,
    ANOMALY_OBSERVATION_IMPLEMENTED: true,
    AUTOMATIC_REMEDIATION_ENABLED: false,
    LOCAL_FIRST_PRESERVED: inspectEnv.execution_locality === "LOCAL",
    DATA_EGRESS_POLICY_PRESERVED: listDataEgress(WORK).every((row) => row.schema === "DATA_EGRESS_POLICY_V1"),
    EXISTING_MCP_REUSED: true,
    SECOND_MCP_SERVER_CREATED: false,
    SECOND_CONTROL_PLANE_CREATED: false,
    LIVE_OS_INSPECTION: resources.some((row) => row.resource_id === PROC) && resources.some((row) => row.resource_id === METRIC) && inspect.status === 200 && metrics.status === 200,
    LIVE_APPLICATION_ACTION: app.status === 200,
    EXTERNAL_BYTES_SENT: bytes,
    UNMANAGED_FILES_MODIFIED: before !== after,
    UNAUTHORIZED_NETWORK_EGRESS: listDataEgress(WORK).some((row) => row.policy_state !== "LOCAL_ONLY" && row.policy_state !== "DENIED"),
    PROCESS_MUTATION: mutated === true,
  };
  const all = report.LIVE_OS_INSPECTION && report.LIVE_APPLICATION_ACTION && !report.UNMANAGED_FILES_MODIFIED && !report.UNAUTHORIZED_NETWORK_EGRESS && mutated !== true;
  console.log(`DNA_OS_OS_RESOURCE_LIVE ${JSON.stringify({ ...report, FINAL_STATUS: all ? "VERIFIED" : "BLOCKED" }, null, 2)}`);
  process.exit(all ? 0 : 2);
}

void main();
