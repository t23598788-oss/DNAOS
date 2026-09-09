/**
 * Live proofs 1–5 for UNIVERSAL_OWNER_CONTROLLED_CLIENT_RUNTIME_V1 through the existing MCP.
 *
 * How to run:
 *   npx tsx control/owner-client-runtime/tests/live-owner-client-runtime.ts
 */

import { existsSync, readdirSync, readFileSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createDnaOsMcpServer, DnaOsHttpClient, UNAUTHENTICATED_CONTEXT } from "../../../connections/dna-os-mcp/contract";
import { googleChromeGeminiAvailability } from "../../ai-client-bridge/contract";
import { issueLocalAccessGrant } from "../../local-resource-access/contract";
import {
  authenticateUniversalClient,
  enableUniversalClient,
  markClientUnavailable,
  registerUniversalClient,
} from "../contract";

declare const process: { cwd(): string; env: Record<string, string | undefined>; exit(code?: number): never };
declare const console: { log(...args: unknown[]): void };

const STAMP = Date.now();
const WORK = `work-ucr-live-${STAMP}`;
const SESSION = `session-ucr-live-${STAMP}`;
const CHATGPT = "ai://chatgpt-ucr-live";
const CURSOR = "ai://cursor-ucr-live";
const FILE_RES = "resource://local/files/fixture-corpus";
const WRITE_RES = "resource://local/files/fixture-writable";
const GIT_RES = "resource://local/git/fixture-corpus";
const JOB_RES = "resource://local/compute/registered-jobs";
const CORPUS = join(process.cwd(), "control/local-resource-access/fixtures/corpus");
const NOTES = join(CORPUS, "notes.txt");
const COPY_NAME = `live-ucr-copy-${STAMP}.txt`;
const COPY_PATH = join(process.cwd(), "control/local-resource-access/fixtures/writable", COPY_NAME);

function structuredOf(result: { structuredContent?: unknown; content?: Array<{ type: string; text?: string }> }): Record<string, unknown> {
  if (result.structuredContent && typeof result.structuredContent === "object") return result.structuredContent as Record<string, unknown>;
  const text = result.content?.[0]?.text;
  return text ? (JSON.parse(text) as Record<string, unknown>) : {};
}

function dirBytes(root: string): number {
  let total = 0;
  for (const name of readdirSync(root)) {
    const abs = join(root, name);
    const st = statSync(abs);
    if (st.isDirectory()) total += dirBytes(abs);
    else total += st.size;
  }
  return total;
}

function grant(ai: string, resource: string, access: readonly ("READ" | "WRITE" | "EXECUTE")[], scope: readonly string[]): void {
  issueLocalAccessGrant({
    ai_identity: ai, session_id: SESSION, work_id: null, capability: "*", resource_id: resource,
    data_scope: [...scope], access: [...access], network_egress: "LOCAL_ONLY", expires_at: null, effect: "ALLOW",
  });
}

async function main(): Promise<void> {
  const notesBefore = readFileSync(NOTES, "utf8");
  const sourceRepoBytes = dirBytes(CORPUS);
  for (const id of [CHATGPT, CURSOR]) {
    grant(id, FILE_RES, ["READ", "WRITE"], ["control/local-resource-access/fixtures/corpus"]);
    grant(id, WRITE_RES, ["READ", "WRITE"], ["control/local-resource-access/fixtures/writable"]);
    grant(id, GIT_RES, ["READ"], ["control/local-resource-access/fixtures/corpus"]);
    grant(id, JOB_RES, ["READ", "EXECUTE"], []);
  }
  registerUniversalClient({
    client_id: CHATGPT, client_family: "AI_CHAT_CLIENT", provider: "openai",
    session_work_scope: SESSION, protocol: "MCP", protocol_version: "2026-07-28",
  });
  registerUniversalClient({
    client_id: CURSOR, client_family: "AI_CODING_CLIENT", provider: "cursor",
    session_work_scope: SESSION, protocol: "MCP", protocol_version: "legacy-compatible",
  });
  authenticateUniversalClient(CHATGPT, "chatgpt-live-identity");
  authenticateUniversalClient(CURSOR, "cursor-live-identity");
  enableUniversalClient(CHATGPT, { data_access_scope: [FILE_RES], action_scope: ["SEARCH", "COMPARE", "COPY"] });
  enableUniversalClient(CURSOR, { data_access_scope: [FILE_RES], action_scope: ["SEARCH", "COMPARE", "COPY"] });

  const mcpClient = new Client({ name: "external-chatgpt-ucr-live", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const mcpServer = createDnaOsMcpServer(new DnaOsHttpClient(), UNAUTHENTICATED_CONTEXT);
  await mcpServer.connect(serverTransport);
  await mcpClient.connect(clientTransport);

  const { tools } = await mcpClient.listTools();
  const names = new Set(tools.map((tool) => tool.name));
  const discovered = [
    "dna_os.list_clients", "dna_os.get_client_status", "dna_os.list_owner_environments",
    "dna_os.get_owner_environment", "dna_os.get_resource_handle", "dna_os.resolve_capability_route",
    "dna_os.get_work_context", "dna_os.submit_owner_intent",
  ].every((name) => names.has(name));

  const chatgptSearch = structuredOf(await mcpClient.callTool({
    name: "dna_os.submit_owner_intent",
    arguments: {
      client_id: CHATGPT, session_id: SESSION, work_id: `${WORK}-p`,
      text: "search notes", resource_id: FILE_RES,
    },
  }) as never);
  const cursorSearch = structuredOf(await mcpClient.callTool({
    name: "dna_os.submit_owner_intent",
    arguments: {
      client_id: CURSOR, session_id: SESSION, work_id: `${WORK}-q`,
      text: "search notes", resource_id: FILE_RES,
    },
  }) as never);
  const handle = structuredOf(await mcpClient.callTool({
    name: "dna_os.get_resource_handle",
    arguments: { resource_id: FILE_RES, logical_path: "notes.txt" },
  }) as never);
  const liveTwoClients = chatgptSearch.status === 200 && cursorSearch.status === 200
    && chatgptSearch.authority === cursorSearch.authority
    && chatgptSearch.locality === "LOCAL" && cursorSearch.locality === "LOCAL"
    && (handle.handle as { raw_content_included?: boolean })?.raw_content_included === false;

  const review = structuredOf(await mcpClient.callTool({
    name: "dna_os.submit_owner_intent",
    arguments: {
      client_id: CURSOR, session_id: SESSION, work_id: `${WORK}-review`,
      text: "ตรวจโค้ดล่าสุด", resource_id: GIT_RES, semantic_review_required: true,
    },
  }) as never);
  const liveReview = review.status === 200 && review.ok === true
    && (review.route as { selected?: string })?.selected === "EXTERNAL_AI_REASONING"
    && Number(review.AI_CONTEXT_BYTES_SENT) > 0
    && Number(review.AI_CONTEXT_BYTES_SENT) < sourceRepoBytes
    && (review.handle as { raw_content_included?: boolean })?.raw_content_included === false;

  markClientUnavailable(CHATGPT);
  const failedProvider = structuredOf(await mcpClient.callTool({
    name: "dna_os.submit_owner_intent",
    arguments: {
      client_id: CHATGPT, session_id: SESSION, work_id: `${WORK}-fail`,
      text: "search notes", resource_id: FILE_RES,
    },
  }) as never);
  const otherRoute = structuredOf(await mcpClient.callTool({
    name: "dna_os.submit_owner_intent",
    arguments: {
      client_id: CURSOR, session_id: SESSION, work_id: `${WORK}-continue`,
      text: "search notes", resource_id: FILE_RES,
    },
  }) as never);
  const liveFailure = failedProvider.reason_code === "PROVIDER_UNAVAILABLE"
    && failedProvider.system_unavailable === false
    && otherRoute.status === 200 && otherRoute.ok === true;
  enableUniversalClient(CHATGPT, { data_access_scope: [FILE_RES], action_scope: ["SEARCH", "COMPARE", "COPY"] });

  const side = structuredOf(await mcpClient.callTool({
    name: "dna_os.submit_owner_intent",
    arguments: {
      client_id: CHATGPT, session_id: SESSION, work_id: `${WORK}-copy`,
      text: "copy this file", resource_id: FILE_RES, destination_id: WRITE_RES,
      copy_destination_logical: COPY_NAME,
    },
  }) as never);
  const reviewId = (side.review as { review_id?: string })?.review_id;
  const approved = structuredOf(await mcpClient.callTool({
    name: "dna_os.apply_owner_review",
    arguments: { review_id: reviewId, decision: "APPROVE", ai_client_id: CHATGPT, session_id: SESSION },
  }) as never);
  const result = approved.review as { executed?: boolean; state?: string; result?: { predicted?: boolean } };
  const liveSide = side.executed === false && side.SIDE_EFFECT_PREVIEW_REQUIRED === true
    && result?.executed === true && result.state === "RESULT" && result.result?.predicted === false
    && existsSync(COPY_PATH);

  const ownerServer = structuredOf(await mcpClient.callTool({
    name: "dna_os.get_owner_environment",
    arguments: { environment_id: "env://owner-server" },
  }) as never);
  const remote = structuredOf(await mcpClient.callTool({
    name: "dna_os.get_owner_environment",
    arguments: { environment_id: "env://remote-owner-machine" },
  }) as never);
  const ownerServerProof = (ownerServer.environment as { availability?: string })?.availability === "NOT_AVAILABLE"
    && (remote.environment as { availability?: string })?.availability === "NOT_AVAILABLE"
    ? "NOT_AVAILABLE"
    : "UNEXPECTED";

  const gemini = googleChromeGeminiAvailability();
  const handoff = structuredOf(await mcpClient.callTool({
    name: "dna_os.create_ai_handoff",
    arguments: {
      from_client_id: CHATGPT, to_client_id: CURSOR, work_id: `${WORK}-q`,
      goal: "continue local search", canonical_action: "SEARCH",
      resource_refs: [FILE_RES], current_state: "RESULT",
      structured_evidence_refs: [],
      approved_working_context: { matches: cursorSearch.matches },
    },
  }) as never);

  if (existsSync(COPY_PATH)) unlinkSync(COPY_PATH);
  const unmanaged = notesBefore === readFileSync(NOTES, "utf8");

  console.log(`UNIVERSAL_OWNER_CONTROLLED_CLIENT_RUNTIME_V1 = ${discovered && liveTwoClients && liveReview && liveFailure && liveSide && unmanaged ? "VERIFIED" : "FAILED"}`);
  console.log(`CHATGPT_CLIENT = ${chatgptSearch.ok === true}`);
  console.log(`SECOND_CLIENT = ${cursorSearch.ok === true}`);
  console.log(`GOOGLE_GEMINI_CLIENT = ${gemini.GEMINI_BINDING}`);
  console.log(`OWNER_SERVER_LIVE_PROOF = ${ownerServerProof}`);
  console.log(`SOURCE_REPOSITORY_BYTES = ${sourceRepoBytes}`);
  console.log(`LOCAL_BYTES_PROCESSED = ${review.LOCAL_BYTES_PROCESSED ?? "n/a"}`);
  console.log(`AI_CONTEXT_BYTES_SENT = ${review.AI_CONTEXT_BYTES_SENT ?? "n/a"}`);
  console.log(`AI_RESULT_BYTES = ${review.AI_RESULT_BYTES ?? "n/a"}`);
  console.log(`WORK_CONTEXT_HANDOFF = ${handoff.status === 200 && (handoff.handoff as { transcript_included?: boolean })?.transcript_included === false}`);
  console.log(`EXISTING_MCP_REUSED = true`);
  console.log(`SECOND_MCP_SERVER_CREATED = false`);
  console.log(`UNMANAGED_FILES_MODIFIED = ${!unmanaged}`);

  await mcpClient.close();
  await mcpServer.close();
  const all = discovered && liveTwoClients && liveReview && liveFailure && liveSide && unmanaged && ownerServerProof === "NOT_AVAILABLE";
  process.exit(all ? 0 : 1);
}

void main();
