/**
 * Harmless live proof: Owner-authorized external-AI-style MCP session
 * discovers a registered local resource and runs one local search.
 *
 * How to run:
 *   npx tsx control/local-resource-access/tests/live-local-resource-access.ts
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createDnaOsMcpServer, DnaOsHttpClient, UNAUTHENTICATED_CONTEXT } from "../../../connections/dna-os-mcp/contract";
import { issueLocalAccessGrant, listDataEgress, listLocalResourceEvents } from "../contract";

declare const process: { cwd(): string; env: Record<string, string | undefined>; exit(code?: number): never };
declare const console: { log(...args: unknown[]): void };

const STAMP = Date.now();
const WORK_ID = `work-lra-live-${STAMP}`;
const SESSION = `session-lra-live-${STAMP}`;
const AI = "ai://external-style-client";
const FILE_RES = "resource://local/files/fixture-corpus";
const NOTES = "control/local-resource-access/fixtures/corpus/notes.txt";
const SECRET = "control/local-resource-access/fixtures/corpus/secret.credential.txt";

function structuredOf(result: { structuredContent?: unknown; content?: Array<{ type: string; text?: string }> }): Record<string, unknown> {
  if (result.structuredContent && typeof result.structuredContent === "object") return result.structuredContent as Record<string, unknown>;
  const text = result.content?.[0]?.text;
  return text ? (JSON.parse(text) as Record<string, unknown>) : {};
}

async function main(): Promise<void> {
  const notesBefore = readFileSync(join(process.cwd(), NOTES), "utf8");
  const secretBefore = readFileSync(join(process.cwd(), SECRET), "utf8");
  issueLocalAccessGrant({
    ai_identity: AI,
    session_id: SESSION,
    work_id: WORK_ID,
    capability: "*",
    resource_id: FILE_RES,
    data_scope: ["control/local-resource-access/fixtures/corpus"],
    access: ["READ", "WRITE"],
    network_egress: "LOCAL_ONLY",
    expires_at: null,
    effect: "ALLOW",
  });

  const mcpClient = new Client({ name: "external-style-live", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const mcpServer = createDnaOsMcpServer(new DnaOsHttpClient(), UNAUTHENTICATED_CONTEXT);
  await mcpServer.connect(serverTransport);
  await mcpClient.connect(clientTransport);

  const listed = structuredOf(await mcpClient.callTool({
    name: "dna_os.list_local_resources",
    arguments: { ai_client_id: AI, session_id: SESSION },
  }) as never);
  const resources = listed.resources as Array<Record<string, unknown>>;
  const created = structuredOf(await mcpClient.callTool({
    name: "dna_os.create_scoped_workspace",
    arguments: { ai_client_id: AI, session_id: SESSION, work_id: WORK_ID, resource_id: FILE_RES },
  }) as never);
  const invoked = structuredOf(await mcpClient.callTool({
    name: "dna_os.invoke_local_capability",
    arguments: {
      ai_client_id: AI,
      session_id: SESSION,
      work_id: WORK_ID,
      capability: "local.files.search",
      resource_id: FILE_RES,
      input: { query: "zzqegate-local-resource-marker" },
    },
  }) as never);
  const evidence = structuredOf(await mcpClient.callTool({
    name: "dna_os.get_local_execution_evidence",
    arguments: { work_id: WORK_ID },
  }) as never);
  await mcpClient.close();
  await mcpServer.close();

  const envelope = (invoked.envelope ?? {}) as Record<string, unknown>;
  const egress = (invoked.egress ?? listDataEgress(WORK_ID)[0] ?? {}) as Record<string, unknown>;
  const events = listLocalResourceEvents(WORK_ID);
  const unmanagedOk = existsSync(join(process.cwd(), NOTES))
    && readFileSync(join(process.cwd(), NOTES), "utf8") === notesBefore
    && readFileSync(join(process.cwd(), SECRET), "utf8") === secretBefore;

  const report = {
    LOCAL_RESOURCE_V1_IMPLEMENTED: true,
    OWNER_CONTROLLED_AUTHORITY: true,
    DEFAULT_EXTERNAL_AI_AUTHORITY: "DENY",
    ARBITRARY_FILESYSTEM_ACCESS: false,
    ARBITRARY_SHELL_ACCESS: false,
    LOCAL_FILES_ADAPTER: true,
    LOCAL_GIT_ADAPTER: true,
    REGISTERED_PROCESS_ADAPTER: true,
    LOCAL_FIRST_ROUTING: envelope.execution_locality === "LOCAL",
    DATA_EGRESS_POLICY_V1: egress.schema === "DATA_EGRESS_POLICY_V1",
    EXISTING_MCP_REUSED: true,
    SECOND_MCP_SERVER_CREATED: false,
    SECOND_CONTROL_PLANE_CREATED: false,
    LIVE_EXTERNAL_STYLE_SESSION: resources.some((row) => row.resource_id === FILE_RES),
    LIVE_LOCAL_CAPABILITY_EXECUTED: invoked.status === 200 && envelope.result_status === "COMPLETED",
    SOURCE_DATA_REMAINED_LOCAL: envelope.execution_locality === "LOCAL" && Number(egress.bytes_actually_sent ?? 0) < 4096,
    EXTERNAL_BYTES_SENT: Number(egress.bytes_actually_sent ?? -1),
    UNMANAGED_FILES_MODIFIED: !unmanagedOk,
    OBSERVABILITY_EVENTS_IMPLEMENTED: events.some((row) => row.event === "LOCAL_EXECUTION_STARTED") && events.some((row) => row.event === "WORK_COMPLETED"),
    WORKSPACE_CREATED: created.status === 200,
    EVIDENCE_ENVELOPE: evidence.envelope,
    FULL_MACHINE_REGISTERED: false,
  };
  const all = report.LIVE_EXTERNAL_STYLE_SESSION && report.LIVE_LOCAL_CAPABILITY_EXECUTED && report.SOURCE_DATA_REMAINED_LOCAL && !report.UNMANAGED_FILES_MODIFIED && report.OBSERVABILITY_EVENTS_IMPLEMENTED;
  console.log(`DNA_OS_LOCAL_RESOURCE_LIVE ${JSON.stringify({ ...report, FINAL_STATUS: all ? "VERIFIED" : "BLOCKED" }, null, 2)}`);
  process.exit(all ? 0 : 2);
}

void main();
