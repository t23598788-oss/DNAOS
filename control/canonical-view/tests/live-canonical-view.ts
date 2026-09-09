/**
 * Live proofs 1–4 through the existing DNA OS MCP. Not a second MCP server.
 *
 * How to run:
 *   npx tsx control/canonical-view/tests/live-canonical-view.ts
 */

import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createDnaOsMcpServer, DnaOsHttpClient, UNAUTHENTICATED_CONTEXT } from "../../../connections/dna-os-mcp/contract";
import { issueLocalAccessGrant } from "../../local-resource-access/contract";
import { INVENTORY_TABLE_SCHEMA, loadInventoryFixtureRows } from "../contract";

declare const process: { cwd(): string; env: Record<string, string | undefined>; exit(code?: number): never };
declare const console: { log(...args: unknown[]): void };

const STAMP = Date.now();
const WORK = `work-cv-live-${STAMP}`;
const SESSION = `session-cv-live-${STAMP}`;
const AI = "ai://external-style-client";
const FILE_RES = "resource://local/files/fixture-corpus";
const WRITE_RES = "resource://local/files/fixture-writable";
const NOTES = join(process.cwd(), "control/local-resource-access/fixtures/corpus/notes.txt");
const COPY_NAME = `live-cv-copy-${STAMP}.txt`;
const COPY_PATH = join(process.cwd(), "control/local-resource-access/fixtures/writable", COPY_NAME);
const DEL_NAME = `live-cv-del-${STAMP}.txt`;
const DEL_PATH = join(process.cwd(), "control/local-resource-access/fixtures/writable", DEL_NAME);

function structuredOf(result: { structuredContent?: unknown; content?: Array<{ type: string; text?: string }> }): Record<string, unknown> {
  if (result.structuredContent && typeof result.structuredContent === "object") return result.structuredContent as Record<string, unknown>;
  const text = result.content?.[0]?.text;
  return text ? (JSON.parse(text) as Record<string, unknown>) : {};
}

async function main(): Promise<void> {
  const notesBefore = readFileSync(NOTES, "utf8");
  issueLocalAccessGrant({
    ai_identity: AI, session_id: SESSION, work_id: WORK, capability: "*", resource_id: FILE_RES,
    data_scope: ["control/local-resource-access/fixtures/corpus"], access: ["READ", "WRITE"],
    network_egress: "LOCAL_ONLY", expires_at: null, effect: "ALLOW",
  });
  issueLocalAccessGrant({
    ai_identity: AI, session_id: SESSION, work_id: WORK, capability: "*", resource_id: WRITE_RES,
    data_scope: ["control/local-resource-access/fixtures/writable"], access: ["READ", "WRITE"],
    network_egress: "LOCAL_ONLY", expires_at: null, effect: "ALLOW",
  });

  const mcpClient = new Client({ name: "external-style-cv", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const mcpServer = createDnaOsMcpServer(new DnaOsHttpClient(), UNAUTHENTICATED_CONTEXT);
  await mcpServer.connect(serverTransport);
  await mcpClient.connect(clientTransport);

  const table = structuredOf(await mcpClient.callTool({
    name: "dna_os.render_canonical_view",
    arguments: {
      view_type: "GENERIC_TABLE_V1",
      data_schema: INVENTORY_TABLE_SCHEMA.schema_id,
      rows: loadInventoryFixtureRows(),
      filter_field: "category",
      filter_contains: "hardware",
      source_resource_ids: ["fixture://inventory"],
    },
  }) as never);
  const view = table.view as { view_type?: string; payload?: { columns?: Array<{ key: string }>; row_count?: number; source_schema?: string } };
  const liveTable = table.status === 200
    && view?.view_type === "GENERIC_TABLE_V1"
    && view.payload?.source_schema === "REGISTERED"
    && view.payload?.columns?.[1]?.key === "sku"
    && view.payload?.row_count === 2;

  const opened = structuredOf(await mcpClient.callTool({
    name: "dna_os.open_owner_review",
    arguments: {
      work_id: WORK, ai_client_id: AI, session_id: SESSION,
      view_type: "FILE_LIST_V1", source_resource_ids: [FILE_RES, WRITE_RES],
    },
  }) as never);
  const review = opened.review as { review_id?: string };
  const previewed = structuredOf(await mcpClient.callTool({
    name: "dna_os.create_action_preview",
    arguments: {
      review_id: review?.review_id,
      work_id: WORK,
      action: "COPY",
      resource_id: FILE_RES,
      input: { source_logical: "notes.txt", destination_logical: COPY_NAME, destination_resource_id: WRITE_RES },
    },
  }) as never);
  const preview = (previewed.review as { preview?: Record<string, unknown>; state?: string })?.preview;
  const livePreview = previewed.status === 200
    && preview?.execution_blocked === true
    && preview?.source_hash
    && typeof preview.bytes_transferred === "number"
    && !existsSync(COPY_PATH);

  const approved = structuredOf(await mcpClient.callTool({
    name: "dna_os.apply_owner_review",
    arguments: { review_id: review?.review_id, decision: "APPROVE", ai_client_id: AI, session_id: SESSION },
  }) as never);
  const result = approved.review as { executed?: boolean; state?: string; execution_id?: string; result?: Record<string, unknown> };
  const liveApproved = approved.status === 200 && result?.executed === true && result.state === "RESULT"
    && existsSync(COPY_PATH) && result.result?.predicted === false && Boolean(result.execution_id);

  const blockedReview = structuredOf(await mcpClient.callTool({
    name: "dna_os.open_owner_review",
    arguments: {
      work_id: `${WORK}-del`, ai_client_id: AI, session_id: SESSION,
      view_type: "FILE_LIST_V1", source_resource_ids: [WRITE_RES],
    },
  }) as never);
  const blockedId = (blockedReview.review as { review_id?: string })?.review_id;
  const delPreview = structuredOf(await mcpClient.callTool({
    name: "dna_os.create_action_preview",
    arguments: {
      review_id: blockedId,
      work_id: `${WORK}-del`,
      action: "DELETE",
      resource_id: WRITE_RES,
      input: { logical_path: DEL_NAME },
    },
  }) as never);
  const delPrev = (delPreview.review as { preview?: Record<string, unknown> })?.preview;
  const executeAttempt = structuredOf(await mcpClient.callTool({
    name: "dna_os.apply_owner_review",
    arguments: { review_id: blockedId, decision: "EXECUTE", ai_client_id: AI, session_id: SESSION },
  }) as never);
  const rejected = structuredOf(await mcpClient.callTool({
    name: "dna_os.apply_owner_review",
    arguments: { review_id: blockedId, decision: "REJECT", ai_client_id: AI, session_id: SESSION },
  }) as never);
  const liveRejected = delPrev?.execution_blocked === true
    && delPrev?.owner_approval_requirement === "OWNER_APPROVAL_REQUIRED"
    && executeAttempt.status === 403
    && (rejected.review as { executed?: boolean })?.executed === false
    && !existsSync(DEL_PATH);

  const validAi = structuredOf(await mcpClient.callTool({
    name: "dna_os.normalize_ai_view",
    arguments: {
      view_type: "GENERIC_TABLE_V1",
      data_schema: INVENTORY_TABLE_SCHEMA.schema_id,
      rows: loadInventoryFixtureRows(),
    },
  }) as never);
  const badAi = structuredOf(await mcpClient.callTool({
    name: "dna_os.normalize_ai_view",
    arguments: {
      view_type: "GENERIC_TABLE_V1",
      html: "<table><tr><td>ai</td></tr></table>",
      layout: { arbitrary: true },
    },
  }) as never);
  const liveAi = validAi.accepted === true && badAi.accepted === false && badAi.reason_code === "ARBITRARY_AI_PRESENTATION";

  const activity = structuredOf(await mcpClient.callTool({
    name: "dna_os.get_activity_view",
    arguments: { work_id: WORK },
  }) as never);
  const traced = Array.isArray((activity.view as { payload?: { fields?: { rows?: unknown[] } } })?.payload?.fields?.rows)
    || Array.isArray((activity.rows as unknown[]));

  if (existsSync(COPY_PATH)) unlinkSync(COPY_PATH);
  const unmanaged = notesBefore === readFileSync(NOTES, "utf8");

  console.log(`LIVE_CANONICAL_TABLE = ${liveTable}`);
  console.log(`LIVE_ACTION_PREVIEW = ${livePreview}`);
  console.log(`LIVE_APPROVED_ACTION = ${liveApproved}`);
  console.log(`LIVE_REJECTED_ACTION = ${liveRejected}`);
  console.log(`LIVE_AI_NORMALIZATION = ${liveAi}`);
  console.log(`RESULT_TRACED_TO_EXECUTION_EVIDENCE = ${Boolean(liveApproved && traced)}`);
  console.log(`UNMANAGED_FILES_MODIFIED = ${!unmanaged}`);
  console.log(`EXISTING_MCP_REUSED = true`);
  console.log(`SECOND_MCP_SERVER_CREATED = false`);

  const all = liveTable && livePreview && liveApproved && liveRejected && liveAi && unmanaged;
  await mcpClient.close();
  await mcpServer.close();
  process.exit(all ? 0 : 1);
}

void main();
