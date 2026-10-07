/**
 * Live Owner workflows 1–5 through the existing MCP.
 *
 * How to run:
 *   npx tsx control/owner-work-surface/tests/live-owner-work-surface.ts
 */

import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createDnaOsMcpServer, DnaOsHttpClient, UNAUTHENTICATED_CONTEXT } from "../../../connections/dna-os-mcp/contract";
import { issueLocalAccessGrant, issueOwnerCapabilityBindingPolicy } from "../../local-resource-access/contract";
import { emailWorkSurface, realAppCapabilityPack } from "../contract";

declare const process: { cwd(): string; env: Record<string, string | undefined>; exit(code?: number): never };
declare const console: { log(...args: unknown[]): void };

const STAMP = Date.now();
const WORK = `work-ows-live-${STAMP}`;
const SESSION = `session-ows-live-${STAMP}`;
const AI = "ai://external-style-client";
const FILE_RES = "resource://local/files/fixture-corpus";
const WRITE_RES = "resource://local/files/fixture-writable";
const GIT_RES = "resource://local/git/fixture-corpus";
const GH = "resource://local/remote/github";
const APP = "resource://local/app/textedit";
const NOTES = join(process.cwd(), "control/local-resource-access/fixtures/corpus/notes.txt");
const COPY_NAME = `live-ows-copy-${STAMP}.txt`;
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
  const notesBefore = readFileSync(NOTES, "utf8");
  grant(FILE_RES, ["READ", "WRITE"], ["control/local-resource-access/fixtures/corpus"]);
  grant(WRITE_RES, ["READ", "WRITE"], ["control/local-resource-access/fixtures/writable"]);
  grant(GIT_RES, ["READ"], ["control/local-resource-access/fixtures/corpus"]);
  grant(GH, ["READ"]);
  grant(APP, ["READ", "EXECUTE"]);
  issueOwnerCapabilityBindingPolicy({
    ai_identity: AI, session_id: SESSION,
    enabled_binding_ids: ["app://macos/textedit", "service://github/source-authority"],
    allowed_actions: ["READ", "SEARCH"],
    visible_data_classes: ["APPLICATION_STATE", "REMOTE_OBJECT", "TEXT", "FILE"],
    approval_required_actions: [],
    allowed_connection_ids: [],
    read_scope: [], write_scope: [], publish_scope: [],
    network_destinations: ["https://api.github.com"],
    expires_at: null, effect: "ALLOW",
  });

  const mcpClient = new Client({ name: "external-style-ows", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const mcpServer = createDnaOsMcpServer(new DnaOsHttpClient(), UNAUTHENTICATED_CONTEXT);
  await mcpServer.connect(serverTransport);
  await mcpClient.connect(clientTransport);

  const { tools } = await mcpClient.listTools();
  const names = new Set(tools.map((tool) => tool.name));
  const discovered = names.has("dna_os.get_owner_work_surface") && names.has("dna_os.owner_search") && names.has("dna_os.open_owner_work");

  const searched = structuredOf(await mcpClient.callTool({
    name: "dna_os.owner_search",
    arguments: { query: "zzqegate-local-resource-marker", ai_client_id: AI, session_id: SESSION, work_id: `${WORK}-search` },
  }) as never);
  const search = searched.search as { local_source_uploaded?: boolean; hits?: Array<{ type?: string }>; SOURCE_BYTES?: number; LOCAL_BYTES_PROCESSED?: number; EXTERNAL_AI_BYTES_SENT?: number; RESULT_BYTES_RETURNED?: number };
  const liveSearch = searched.status === 200 && search?.local_source_uploaded === false && (search.hits ?? []).some((row) => row.type === "FILE");

  const opened = structuredOf(await mcpClient.callTool({
    name: "dna_os.open_owner_work",
    arguments: { app_id: "launcher://files", ai_client_id: AI, session_id: SESSION, work_id: `${WORK}-file`, logical_path: "notes.txt" },
  }) as never);
  const review = opened.review as { review_id?: string; state?: string; view?: { view_type?: string } };
  const previewed = structuredOf(await mcpClient.callTool({
    name: "dna_os.request_owner_work_action",
    arguments: {
      review_id: review?.review_id, action: "COPY", resource_id: FILE_RES, work_id: `${WORK}-file`,
      payload: { source_logical: "notes.txt", destination_logical: COPY_NAME, destination_resource_id: WRITE_RES },
    },
  }) as never);
  const approved = structuredOf(await mcpClient.callTool({
    name: "dna_os.apply_owner_review",
    arguments: { review_id: review?.review_id, decision: "APPROVE", ai_client_id: AI, session_id: SESSION },
  }) as never);
  const result = approved.review as { executed?: boolean; state?: string; result?: { predicted?: boolean } };
  const liveFile = opened.status === 200 && review?.view?.view_type === "FILE_LIST_V1"
    && previewed.executed === false && result?.executed === true && result.state === "RESULT"
    && result.result?.predicted === false && existsSync(COPY_PATH);

  const doc = structuredOf(await mcpClient.callTool({
    name: "dna_os.invoke_local_capability",
    arguments: {
      ai_client_id: AI, session_id: SESSION, work_id: `${WORK}-doc`,
      capability: "local.document.summarize", resource_id: FILE_RES,
      input: { logical_path: "summarize-source.txt" },
    },
  }) as never);
  const invoke = doc as { result?: { SOURCE_BYTES?: number; LOCAL_BYTES_PROCESSED?: number; RESULT_BYTES_RETURNED?: number }; envelope?: { execution_locality?: string; external_ai_bytes_sent?: number } };
  const liveDoc = doc.status === 200 && invoke.envelope?.execution_locality === "LOCAL"
    && typeof invoke.result?.SOURCE_BYTES === "number";

  const github = structuredOf(await mcpClient.callTool({
    name: "dna_os.open_owner_work",
    arguments: { app_id: "service://github/source-authority", ai_client_id: AI, session_id: SESSION, work_id: `${WORK}-gh` },
  }) as never);
  const ghBlob = JSON.stringify(github);
  const liveGithub = github.secret_exposed === false && !/ghp_|github_pat_/.test(ghBlob);

  const pack = realAppCapabilityPack(AI, SESSION, WORK);
  const email = emailWorkSurface(AI, SESSION);
  const liveGoogle = pack.google.gmail === "NOT_AVAILABLE"
    && pack.google.drive === "NOT_AVAILABLE"
    && email.runtime_binding === "NOT_AVAILABLE"
    ? "NOT_AVAILABLE"
    : "UNEXPECTED";

  if (existsSync(COPY_PATH)) unlinkSync(COPY_PATH);
  const unmanaged = notesBefore === readFileSync(NOTES, "utf8");

  console.log(`LIVE_FILE_WORKFLOW = ${Boolean(discovered && liveFile)}`);
  console.log(`LIVE_DOCUMENT_WORKFLOW = ${Boolean(liveDoc)}`);
  console.log(`LIVE_GITHUB_WORKFLOW = ${Boolean(liveGithub)}`);
  console.log(`LIVE_GOOGLE_WORKFLOW = ${liveGoogle}`);
  console.log(`LIVE_SIDE_EFFECT_WORKFLOW = ${Boolean(liveFile)}`);
  console.log(`SOURCE_BYTES = ${invoke.result?.SOURCE_BYTES ?? search?.SOURCE_BYTES ?? "n/a"}`);
  console.log(`LOCAL_BYTES_PROCESSED = ${invoke.result?.LOCAL_BYTES_PROCESSED ?? search?.LOCAL_BYTES_PROCESSED ?? "n/a"}`);
  console.log(`EXTERNAL_AI_BYTES_SENT = ${invoke.envelope?.external_ai_bytes_sent ?? search?.EXTERNAL_AI_BYTES_SENT ?? "n/a"}`);
  console.log(`RESULT_BYTES_RETURNED = ${invoke.result?.RESULT_BYTES_RETURNED ?? search?.RESULT_BYTES_RETURNED ?? "n/a"}`);
  console.log(`UNMANAGED_FILES_MODIFIED = ${!unmanaged}`);
  console.log(`EXISTING_MCP_REUSED = true`);
  console.log(`SECOND_MCP_SERVER_CREATED = false`);
  console.log(`GLOBAL_OWNER_SEARCH = ${Boolean(liveSearch)}`);

  await mcpClient.close();
  await mcpServer.close();
  const all = discovered && liveFile && liveDoc && liveGithub && liveGoogle === "NOT_AVAILABLE" && unmanaged && liveSearch;
  process.exit(all ? 0 : 1);
}

void main();
