/**
 * Harmless live proofs through the existing DNA OS MCP for everyday data actions.
 *
 * How to run:
 *   npx tsx control/local-resource-access/tests/live-everyday-actions.ts
 */

import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createDnaOsMcpServer, DnaOsHttpClient, UNAUTHENTICATED_CONTEXT } from "../../../connections/dna-os-mcp/contract";
import { issueLocalAccessGrant, listDataEgress, listLocalResourceEvents } from "../contract";

declare const process: { cwd(): string; env: Record<string, string | undefined>; exit(code?: number): never };
declare const console: { log(...args: unknown[]): void };

const STAMP = Date.now();
const WORK_ID = `work-eda-live-${STAMP}`;
const SESSION = `session-eda-live-${STAMP}`;
const AI = "ai://external-style-client";
const FILE_RES = "resource://local/files/fixture-corpus";
const WRITE_RES = "resource://local/files/fixture-writable";
const APP = "resource://local/app/textedit";
const NOTES = join(process.cwd(), "control/local-resource-access/fixtures/corpus/notes.txt");
const SECRET = join(process.cwd(), "control/local-resource-access/fixtures/corpus/secret.credential.txt");
const COPY_NAME = `live-copy-${STAMP}.txt`;
const COPY_PATH = join(process.cwd(), "control/local-resource-access/fixtures/writable", COPY_NAME);

function structuredOf(result: { structuredContent?: unknown; content?: Array<{ type: string; text?: string }> }): Record<string, unknown> {
  if (result.structuredContent && typeof result.structuredContent === "object") return result.structuredContent as Record<string, unknown>;
  const text = result.content?.[0]?.text;
  return text ? (JSON.parse(text) as Record<string, unknown>) : {};
}

async function main(): Promise<void> {
  const notesBefore = readFileSync(NOTES, "utf8");
  const secretBefore = readFileSync(SECRET, "utf8");
  for (const resource_id of [FILE_RES, WRITE_RES, APP]) {
    issueLocalAccessGrant({
      ai_identity: AI,
      session_id: SESSION,
      work_id: WORK_ID,
      capability: "*",
      resource_id,
      data_scope: resource_id === WRITE_RES
        ? ["control/local-resource-access/fixtures/writable"]
        : resource_id === FILE_RES
          ? ["control/local-resource-access/fixtures/corpus"]
          : [],
      access: resource_id === APP ? ["READ", "EXECUTE"] : ["READ", "WRITE"],
      network_egress: "LOCAL_ONLY",
      expires_at: null,
      effect: "ALLOW",
    });
  }

  const mcpClient = new Client({ name: "external-style-eda", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const mcpServer = createDnaOsMcpServer(new DnaOsHttpClient(), UNAUTHENTICATED_CONTEXT);
  await mcpServer.connect(serverTransport);
  await mcpClient.connect(clientTransport);

  const search = structuredOf(await mcpClient.callTool({
    name: "dna_os.invoke_local_capability",
    arguments: {
      ai_client_id: AI, session_id: SESSION, work_id: WORK_ID,
      capability: "local.folder.search", resource_id: FILE_RES,
      input: { query: "zzqegate-local-resource-marker" },
    },
  }) as never);
  const read = structuredOf(await mcpClient.callTool({
    name: "dna_os.invoke_local_capability",
    arguments: {
      ai_client_id: AI, session_id: SESSION, work_id: WORK_ID,
      capability: "local.file.read", resource_id: FILE_RES,
      input: { logical_path: "notes.txt" },
    },
  }) as never);
  const copy = structuredOf(await mcpClient.callTool({
    name: "dna_os.invoke_local_capability",
    arguments: {
      ai_client_id: AI, session_id: SESSION, work_id: WORK_ID,
      capability: "local.file.copy", resource_id: FILE_RES,
      input: { source_logical: "notes.txt", destination_logical: COPY_NAME, destination_resource_id: WRITE_RES },
    },
  }) as never);
  const summarize = structuredOf(await mcpClient.callTool({
    name: "dna_os.invoke_local_capability",
    arguments: {
      ai_client_id: AI, session_id: SESSION, work_id: WORK_ID,
      capability: "local.document.summarize", resource_id: FILE_RES,
      input: { logical_path: "summarize-source.txt" },
    },
  }) as never);
  const app = structuredOf(await mcpClient.callTool({
    name: "dna_os.invoke_local_capability",
    arguments: {
      ai_client_id: AI, session_id: SESSION, work_id: WORK_ID,
      capability: "local.app.invoke_registered_action", resource_id: APP,
      input: { application_id: "app://macos/textedit", everyday_action: "READ" },
    },
  }) as never);
  await mcpClient.close();
  await mcpServer.close();

  const searchOk = Boolean((search.result as { matches?: unknown[] })?.matches?.length);
  const readOk = String((read.result as { text?: string })?.text ?? "").includes("zzqegate-local-resource-marker");
  const transfer = (copy.result as { transfer?: { verified?: boolean; source_hash?: string; destination_hash?: string } })?.transfer;
  const copyOk = copy.ok === true && transfer?.verified === true && transfer.source_hash === transfer.destination_hash && existsSync(COPY_PATH);
  const sum = summarize.result as { SOURCE_BYTES?: number; LOCAL_BYTES_PROCESSED?: number; RESULT_BYTES_RETURNED?: number };
  const sourceBytes = Number(sum.SOURCE_BYTES ?? 0);
  const localBytes = Number(sum.LOCAL_BYTES_PROCESSED ?? 0);
  const envelope = summarize.envelope as { external_ai_bytes_sent?: number } | undefined;
  const summarizeEgress = listDataEgress(WORK_ID).at(-1);
  const externalBytes = Number(envelope?.external_ai_bytes_sent ?? summarizeEgress?.bytes_actually_sent ?? 0);
  const resultBytes = Number(sum.RESULT_BYTES_RETURNED ?? 0);
  const appOk = app.ok === true && (app.result as { action_type?: string }).action_type === "READ_STATE";
  const unmanaged = readFileSync(NOTES, "utf8") === notesBefore && readFileSync(SECRET, "utf8") === secretBefore;
  const events = listLocalResourceEvents(WORK_ID);
  const liveOk = searchOk && readOk && copyOk && sourceBytes > 50_000 && externalBytes < sourceBytes && appOk && unmanaged;

  if (existsSync(COPY_PATH)) unlinkSync(COPY_PATH);

  console.log(`LIVE_PROOF_1_SEARCH_READ = ${searchOk && readOk}`);
  console.log(`LIVE_PROOF_2_COPY = ${copyOk}`);
  console.log(`LIVE_PROOF_3_SUMMARIZE = ${sourceBytes > 50_000 && externalBytes < sourceBytes}`);
  console.log(`LIVE_PROOF_4_APPLICATION = ${appOk}`);
  console.log(`SOURCE_BYTES = ${sourceBytes}`);
  console.log(`LOCAL_BYTES_PROCESSED = ${localBytes}`);
  console.log(`EXTERNAL_BYTES_SENT = ${externalBytes}`);
  console.log(`RESULT_BYTES_RETURNED = ${resultBytes}`);
  console.log(`UNMANAGED_FILES_MODIFIED = ${unmanaged ? false : true}`);
  console.log(`EVENTS = ${events.map((row) => row.event).join(",")}`);
  console.log(`FINAL_LIVE = ${liveOk ? "VERIFIED" : "FAILED"}`);
  process.exit(liveOk ? 0 : 1);
}

void main();
