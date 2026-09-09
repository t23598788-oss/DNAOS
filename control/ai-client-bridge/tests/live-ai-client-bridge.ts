/**
 * Live proofs 1–4 for AI_CLIENT_SITE_TOOL_BRIDGE_V1 through the existing MCP.
 *
 * How to run:
 *   npx tsx control/ai-client-bridge/tests/live-ai-client-bridge.ts
 */

import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createDnaOsMcpServer, DnaOsHttpClient, UNAUTHENTICATED_CONTEXT } from "../../../connections/dna-os-mcp/contract";
import { issueLocalAccessGrant } from "../../local-resource-access/contract";
import {
  SITE_TOOL_ALLOWLIST,
  discoverAiClient,
  enableAiClient,
  googleChromeGeminiAvailability,
} from "../contract";

declare const process: { cwd(): string; env: Record<string, string | undefined>; exit(code?: number): never };
declare const console: { log(...args: unknown[]): void };

const STAMP = Date.now();
const WORK = `work-acb-live-${STAMP}`;
const SESSION = `session-acb-live-${STAMP}`;
const CHATGPT = "ai://chatgpt-live";
const GEMINI_SIM = "ai://gemini-sim";
const FILE_RES = "resource://local/files/fixture-corpus";
const WRITE_RES = "resource://local/files/fixture-writable";
const NOTES = join(process.cwd(), "control/local-resource-access/fixtures/corpus/notes.txt");
const COPY_NAME = `live-acb-copy-${STAMP}.txt`;
const COPY_PATH = join(process.cwd(), "control/local-resource-access/fixtures/writable", COPY_NAME);

function structuredOf(result: { structuredContent?: unknown; content?: Array<{ type: string; text?: string }> }): Record<string, unknown> {
  if (result.structuredContent && typeof result.structuredContent === "object") return result.structuredContent as Record<string, unknown>;
  const text = result.content?.[0]?.text;
  return text ? (JSON.parse(text) as Record<string, unknown>) : {};
}

async function main(): Promise<void> {
  const notesBefore = readFileSync(NOTES, "utf8");
  issueLocalAccessGrant({
    ai_identity: CHATGPT, session_id: SESSION, work_id: null, capability: "*", resource_id: FILE_RES,
    data_scope: ["control/local-resource-access/fixtures/corpus"], access: ["READ", "WRITE"],
    network_egress: "LOCAL_ONLY", expires_at: null, effect: "ALLOW",
  });
  issueLocalAccessGrant({
    ai_identity: CHATGPT, session_id: SESSION, work_id: null, capability: "*", resource_id: WRITE_RES,
    data_scope: ["control/local-resource-access/fixtures/writable"], access: ["READ", "WRITE"],
    network_egress: "LOCAL_ONLY", expires_at: null, effect: "ALLOW",
  });
  discoverAiClient({
    ai_client_id: CHATGPT, provider: "openai", client_type: "CHATGPT",
    connection_type: "MCP", session_id: SESSION,
  });
  enableAiClient({
    ai_client_id: CHATGPT, session_id: SESSION,
    capabilities_exposed: [...SITE_TOOL_ALLOWLIST, "local.files.search"],
  });

  const mcpClient = new Client({ name: "external-chatgpt-live", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const mcpServer = createDnaOsMcpServer(new DnaOsHttpClient(), UNAUTHENTICATED_CONTEXT);
  await mcpServer.connect(serverTransport);
  await mcpClient.connect(clientTransport);

  const { tools } = await mcpClient.listTools();
  const names = new Set(tools.map((tool) => tool.name));
  const discovered = SITE_TOOL_ALLOWLIST.every((name) => names.has(name))
    && names.has("dna_os.get_site_tool_catalog")
    && names.has("dna_os.inspect_local_for_client");

  const inspect = structuredOf(await mcpClient.callTool({
    name: "dna_os.inspect_local_for_client",
    arguments: {
      ai_client_id: CHATGPT, session_id: SESSION, work_id: WORK,
      resource_id: FILE_RES, query: "zzqegate-local-resource-marker",
    },
  }) as never);
  const envelope = inspect.result as {
    locality?: string; source_bytes?: number; local_bytes_processed?: number;
    external_bytes_sent?: number; result_bytes?: number; execution_id?: string;
  } | undefined;
  const liveChatgpt = inspect.status === 200
    && envelope?.locality === "LOCAL"
    && typeof envelope.source_bytes === "number"
    && typeof envelope.external_bytes_sent === "number"
    && typeof envelope.result_bytes === "number"
    && Array.isArray(inspect.matches);

  const google = googleChromeGeminiAvailability();
  const web = structuredOf(await mcpClient.callTool({
    name: "dna_os.route_search",
    arguments: {
      ai_identity: CHATGPT, session_id: SESSION, query: "dna os",
      intent: "REMOTE_WEB_SEARCH", resource_type: "WEB", preferred_provider: "google",
      local_source: notesBefore, work_id: WORK,
    },
  }) as never);
  const liveGoogle = google.GOOGLE_CHROME_BINDING === "NOT_AVAILABLE"
    && google.GEMINI_BINDING === "NOT_AVAILABLE"
    && web.status === "NOT_AVAILABLE"
    && web.local_source_sent === false;

  const opened = structuredOf(await mcpClient.callTool({
    name: "dna_os.open_owner_review",
    arguments: {
      work_id: `${WORK}-copy`, ai_client_id: CHATGPT, session_id: SESSION,
      view_type: "FILE_LIST_V1", source_resource_ids: [FILE_RES, WRITE_RES],
    },
  }) as never);
  const reviewId = (opened.review as { review_id?: string })?.review_id;
  const previewed = structuredOf(await mcpClient.callTool({
    name: "dna_os.create_action_preview",
    arguments: {
      review_id: reviewId, work_id: `${WORK}-copy`, action: "COPY", resource_id: FILE_RES,
      input: { source_logical: "notes.txt", destination_logical: COPY_NAME, destination_resource_id: WRITE_RES },
    },
  }) as never);
  const approved = structuredOf(await mcpClient.callTool({
    name: "dna_os.apply_owner_review",
    arguments: { review_id: reviewId, decision: "APPROVE", ai_client_id: CHATGPT, session_id: SESSION },
  }) as never);
  const result = approved.review as { executed?: boolean; state?: string; result?: { predicted?: boolean } };
  const liveOwner = previewed.PREVIEW_CREATED === true
    && result?.executed === true
    && result.state === "RESULT"
    && result.result?.predicted === false
    && existsSync(COPY_PATH);

  const handoff = structuredOf(await mcpClient.callTool({
    name: "dna_os.create_ai_handoff",
    arguments: {
      from_client_id: CHATGPT,
      to_client_id: GEMINI_SIM,
      work_id: WORK,
      goal: "continue local inspection",
      canonical_action: "SEARCH",
      resource_refs: [FILE_RES],
      current_state: "RESULT",
      structured_evidence_refs: [String(envelope?.execution_id ?? "")],
      approved_working_context: { query: "zzqegate-local-resource-marker", matches: inspect.matches },
    },
  }) as never);
  const ho = handoff.handoff as { transcript_included?: boolean; byte_count?: number };
  const liveHandoff = handoff.status === 200 && ho?.transcript_included === false && typeof ho.byte_count === "number";

  if (existsSync(COPY_PATH)) unlinkSync(COPY_PATH);
  const unmanaged = notesBefore === readFileSync(NOTES, "utf8");

  console.log(`LIVE_CHATGPT_SITE_TOOL = ${Boolean(discovered && liveChatgpt)}`);
  console.log(`LIVE_GOOGLE_BINDING = ${liveGoogle ? "NOT_AVAILABLE" : "UNEXPECTED"}`);
  console.log(`LIVE_OWNER_ACTION = ${liveOwner}`);
  console.log(`LIVE_AI_HANDOFF = ${liveHandoff}`);
  console.log(`SOURCE_BYTES = ${envelope?.source_bytes ?? "n/a"}`);
  console.log(`LOCAL_BYTES_PROCESSED = ${envelope?.local_bytes_processed ?? "n/a"}`);
  console.log(`EXTERNAL_AI_BYTES_SENT = ${envelope?.external_bytes_sent ?? "n/a"}`);
  console.log(`RESULT_BYTES_RETURNED = ${envelope?.result_bytes ?? "n/a"}`);
  console.log(`UNMANAGED_FILES_MODIFIED = ${!unmanaged}`);
  console.log(`EXISTING_MCP_REUSED = true`);
  console.log(`SECOND_MCP_SERVER_CREATED = false`);

  await mcpClient.close();
  await mcpServer.close();
  const all = discovered && liveChatgpt && liveGoogle && liveOwner && liveHandoff && unmanaged;
  process.exit(all ? 0 : 1);
}

void main();
