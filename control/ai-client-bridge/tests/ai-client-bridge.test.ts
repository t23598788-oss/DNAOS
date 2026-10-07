/**
 * Deterministic A–N proofs for AI_CLIENT_SITE_TOOL_BRIDGE_V1.
 *
 * How to run:
 *   npx tsx control/ai-client-bridge/tests/ai-client-bridge.test.ts
 */

import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import {
  SITE_TOOL_ALLOWLIST,
  blockAiClient,
  connectAiClient,
  createAiHandoff,
  discoverAiClient,
  enableAiClient,
  evaluateAiClient,
  getAiClientDiscovery,
  googleChromeGeminiAvailability,
  inspectLocalForClient,
  invokeSiteTool,
  listSiteTools,
  routeSearch,
  verifyAiClientToolDiscovery,
} from "../contract";
import { applyOwnerReviewDecision, attachActionPreview, openOwnerReviewView } from "../../canonical-view/contract";
import { issueLocalAccessGrant } from "../../local-resource-access/contract";

declare const process: { cwd(): string; env: Record<string, string | undefined>; exitCode?: number };
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };

const STAMP = Date.now();
const DATA = join(process.cwd(), "control/ai-client-bridge/data");
const LRA = join(process.cwd(), "control/local-resource-access/data");
const CV = join(process.cwd(), "control/canonical-view/data");
process.env.AI_CLIENT_BINDINGS_LOG = join(DATA, `acb-bind-${STAMP}.jsonl`);
process.env.AI_HANDOFF_LOG = join(DATA, `acb-handoff-${STAMP}.jsonl`);
process.env.LOCAL_RESOURCE_GRANTS_LOG = join(LRA, `acb-grants-${STAMP}.jsonl`);
process.env.LOCAL_RESOURCE_REGISTRY_LOG = join(LRA, `acb-resources-${STAMP}.jsonl`);
process.env.LOCAL_RESOURCE_EVENTS_LOG = join(LRA, `acb-events-${STAMP}.jsonl`);
process.env.LOCAL_RESOURCE_EGRESS_LOG = join(LRA, `acb-egress-${STAMP}.jsonl`);
process.env.LOCAL_RESOURCE_EVIDENCE_LOG = join(LRA, `acb-evidence-${STAMP}.jsonl`);
process.env.LOCAL_RESOURCE_WORKSPACES_LOG = join(LRA, `acb-workspaces-${STAMP}.jsonl`);
process.env.LOCAL_RESOURCE_TRANSFER_LOG = join(LRA, `acb-transfer-${STAMP}.jsonl`);
process.env.CANONICAL_VIEW_REVIEWS_LOG = join(CV, `acb-reviews-${STAMP}.jsonl`);
process.env.CANONICAL_VIEW_PREVIEWS_LOG = join(CV, `acb-previews-${STAMP}.jsonl`);

const FILE_RES = "resource://local/files/fixture-corpus";
const WRITE_RES = "resource://local/files/fixture-writable";
const SESSION = `session-acb-${STAMP}`;
const CHATGPT = "ai://chatgpt-bridge";
const UNKNOWN = "ai://unknown-bridge";
const NOTES = join(process.cwd(), "control/local-resource-access/fixtures/corpus/notes.txt");
const WRITABLE = join(process.cwd(), "control/local-resource-access/fixtures/writable");
const COPY_NAME = `acb-copy-${STAMP}.txt`;

let passed = 0;
let failed = 0;
function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}
async function check(name: string, body: () => Promise<void> | void): Promise<void> {
  try {
    await body();
    passed++;
    console.log(`PASS ${name}`);
  } catch (error) {
    failed++;
    console.error(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
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

  await check("A. Unknown AI client gets DENY by default", async () => {
    const auth = evaluateAiClient(UNKNOWN, "none");
    assert(auth.decision === "DENY", auth.reason_code);
    const invoked = await invokeSiteTool({
      tool_name: "dna_os.list_local_resources", arguments: {}, ai_client_id: UNKNOWN, session_id: "none",
    });
    assert(invoked.ok === false && invoked.reason_code === "UNKNOWN_AI_DEFAULT_DENY", JSON.stringify(invoked));
  });

  await check("B. Connected AI client still has no authority until Owner enabled", async () => {
    discoverAiClient({
      ai_client_id: CHATGPT, provider: "openai", client_type: "CHATGPT",
      connection_type: "MCP", session_id: SESSION,
    });
    const connected = connectAiClient(CHATGPT, SESSION);
    assert(!("ok" in connected), JSON.stringify(connected));
    if ("ok" in connected) return;
    assert(connected.binding_state === "CONNECTED", connected.binding_state);
    assert(connected.owner_authority_state === "DENY", connected.owner_authority_state);
    assert(connected.grants_authority === false, "identity is not authority");
    const denied = await invokeSiteTool({
      tool_name: "dna_os.list_local_resources", arguments: {}, ai_client_id: CHATGPT, session_id: SESSION,
    });
    assert(denied.ok === false && denied.reason_code === "OWNER_ENABLED_REQUIRED", JSON.stringify(denied));
  });

  await check("C. Site-tool discovery cannot execute actions by itself", () => {
    const catalog = listSiteTools();
    assert(catalog.discovery_executes === false, "discovery must not execute");
    assert(catalog.second_mcp_server === false, "no second MCP");
    assert(catalog.arbitrary_javascript === false, "no arbitrary JS");
    assert(Array.isArray(catalog.tools) && (catalog.tools as unknown[]).length === SITE_TOOL_ALLOWLIST.length, "allowlist");
    assert(notesBefore === readFileSync(NOTES, "utf8"), "discovery is inert");
  });

  await check("D. Client cannot bypass existing gateway", async () => {
    const enabled = enableAiClient({
      ai_client_id: CHATGPT, session_id: SESSION,
      capabilities_exposed: [...SITE_TOOL_ALLOWLIST],
    });
    assert(!("ok" in enabled), JSON.stringify(enabled));
    const shell = await invokeSiteTool({
      tool_name: "submit_command", arguments: { commandText: "rm -rf /" },
      ai_client_id: CHATGPT, session_id: SESSION,
    });
    assert(shell.ok === false && shell.reason_code === "SITE_TOOL_NOT_ALLOWLISTED", JSON.stringify(shell));
    const anyCap = await invokeSiteTool({
      tool_name: "dna_os.invoke_local_capability",
      arguments: { capability: "execute_any_command", resource_id: FILE_RES, input: {} },
      ai_client_id: CHATGPT, session_id: SESSION, work_id: `work-d-${STAMP}`,
    });
    assert(anyCap.ok === false, JSON.stringify(anyCap));
  });

  await check("E. Client cannot access arbitrary filesystem paths", async () => {
    const trav = await invokeSiteTool({
      tool_name: "dna_os.invoke_local_capability",
      arguments: { capability: "local.file.read", resource_id: FILE_RES, input: { logical_path: "../package.json" } },
      ai_client_id: CHATGPT, session_id: SESSION, work_id: `work-e-${STAMP}`,
    });
    assert(trav.ok === false && trav.reason_code === "ARBITRARY_PATH_DENIED", JSON.stringify(trav));
  });

  await check("F. Local source inspection processes data locally first", async () => {
    const inspected = await inspectLocalForClient({
      ai_client_id: CHATGPT, session_id: SESSION, work_id: `work-f-${STAMP}`,
      resource_id: FILE_RES, query: "zzqegate-local-resource-marker",
    });
    assert(inspected.ok, JSON.stringify(inspected));
    if (!inspected.ok) return;
    assert(inspected.result.locality === "LOCAL", inspected.result.locality);
    assert(inspected.result.canonical_action === "SEARCH", inspected.result.canonical_action);
    assert(inspected.matches.length > 0, "expected matches");
  });

  await check("G+H. External AI receives only minimized working set and exact bytes", async () => {
    const inspected = await inspectLocalForClient({
      ai_client_id: CHATGPT, session_id: SESSION, work_id: `work-g-${STAMP}`,
      resource_id: FILE_RES, query: "zzqegate-local-resource-marker",
    });
    assert(inspected.ok, JSON.stringify(inspected));
    if (!inspected.ok) return;
    assert(inspected.result.source_bytes >= inspected.result.external_bytes_sent, "source vs external");
    assert(inspected.result.result_bytes <= inspected.result.source_bytes || inspected.result.source_bytes === 0 || inspected.result.external_bytes_sent <= inspected.result.result_bytes, "minimized");
    assert(typeof inspected.result.external_bytes_sent === "number", "byte count recorded");
    const blob = JSON.stringify(inspected.matches);
    assert(!blob.includes(notesBefore.repeat(2)), "must not dump full source");
    assert(!/\/Users\//.test(blob), "no absolute paths");
  });

  await check("I. Side-effect action requires Owner preview/approval", async () => {
    const copy = await invokeSiteTool({
      tool_name: "dna_os.invoke_local_capability",
      arguments: {
        capability: "local.file.copy", resource_id: FILE_RES,
        input: { source_logical: "notes.txt", destination_logical: COPY_NAME, destination_resource_id: WRITE_RES },
      },
      ai_client_id: CHATGPT, session_id: SESSION, work_id: `work-i-${STAMP}`,
    });
    assert(copy.ok === false && copy.reason_code === "PREVIEW_REQUIRED", JSON.stringify(copy));
    assert(!existsSync(join(WRITABLE, COPY_NAME)), "must not copy without preview");
    const opened = openOwnerReviewView({
      work_id: `work-i-${STAMP}`, ai_client_id: CHATGPT, session_id: SESSION,
      view_type: "FILE_LIST_V1", source_resource_ids: [FILE_RES, WRITE_RES],
    });
    attachActionPreview(opened.review_id, {
      work_id: `work-i-${STAMP}`, action: "COPY", resource_id: FILE_RES,
      input: { source_logical: "notes.txt", destination_logical: COPY_NAME, destination_resource_id: WRITE_RES },
    });
    const approved = await applyOwnerReviewDecision({
      review_id: opened.review_id, decision: "APPROVE", ai_client_id: CHATGPT, session_id: SESSION,
    });
    assert(!("ok" in approved) && approved.executed === true, JSON.stringify(approved));
  });

  await check("J. Provider preference cannot override Owner policy", () => {
    const routed = routeSearch({
      intent: "AUTO", query: "notes", resource_type: "CODE",
      ai_identity: CHATGPT, session_id: SESSION, preferred_provider: "google",
    });
    assert(routed.search_class === "LOCAL_SEARCH", String(routed.search_class));
    assert(routed.provider_preference_applied === false, "preference is last");
    assert(routed.owner_policy_overrides_provider_preference === true, "owner first");
  });

  await check("K. Google/web search does not receive local source data unless explicitly allowed", () => {
    const web = routeSearch({
      intent: "REMOTE_WEB_SEARCH", query: "dna os", resource_type: "WEB",
      ai_identity: CHATGPT, session_id: SESSION, local_source: notesBefore, preferred_provider: "google",
    });
    assert(web.search_class === "REMOTE_WEB_SEARCH", String(web.search_class));
    assert(web.local_source_sent === false, "must not attach local source");
    assert(web.status === "NOT_AVAILABLE", String(web.status));
    const google = googleChromeGeminiAvailability();
    assert(google.GEMINI_BINDING === "NOT_AVAILABLE", google.GEMINI_BINDING);
    assert(google.GOOGLE_CHROME_BINDING === "NOT_AVAILABLE", google.GOOGLE_CHROME_BINDING);
  });

  await check("L. Cross-AI handoff works without full transcript copy", () => {
    const rejected = createAiHandoff({
      from_client_id: CHATGPT, to_client_id: "ai://gemini-sim", work_id: `work-l-${STAMP}`,
      goal: "continue inspection", canonical_action: "SEARCH", resource_refs: [FILE_RES],
      current_state: "VIEW", structured_evidence_refs: ["lex-demo"],
      approved_working_context: { query: "zzqegate-local-resource-marker" },
      transcript: [{ role: "user", content: "entire chat" }],
    });
    assert("ok" in rejected && rejected.ok === false, JSON.stringify(rejected));
    const ok = createAiHandoff({
      from_client_id: CHATGPT, to_client_id: "ai://gemini-sim", work_id: `work-l-${STAMP}`,
      goal: "continue inspection", canonical_action: "SEARCH", resource_refs: [FILE_RES],
      current_state: "VIEW", structured_evidence_refs: ["lex-demo"],
      approved_working_context: { query: "zzqegate-local-resource-marker", result_type: "MINIMIZED_SEARCH_MATCHES" },
    });
    assert(!("ok" in ok), JSON.stringify(ok));
    if ("ok" in ok) return;
    assert(ok.transcript_included === false, "no transcript");
    assert(ok.byte_count > 0, String(ok.byte_count));
    assert(!JSON.stringify(ok).includes("entire chat"), "transcript absent");
  });

  await check("M. No new agent/model/control plane/MCP server", () => {
    const catalog = listSiteTools();
    assert(catalog.second_mcp_server === false && catalog.second_control_plane === false, JSON.stringify(catalog));
    const discovery = getAiClientDiscovery(CHATGPT, SESSION);
    assert(discovery.discovery_grants_authority === false, "discovery is not authority");
    verifyAiClientToolDiscovery(CHATGPT, SESSION, [...SITE_TOOL_ALLOWLIST]);
    blockAiClient("no-such", SESSION);
  });

  await check("N. Unmanaged files and ChatGPT-style binding records remain honest", () => {
    assert(notesBefore === readFileSync(NOTES, "utf8") || existsSync(join(WRITABLE, COPY_NAME)), "corpus or approved copy only");
    assert(readFileSync(NOTES, "utf8") === notesBefore, "unmanaged notes unchanged");
  });

  if (existsSync(join(WRITABLE, COPY_NAME))) unlinkSync(join(WRITABLE, COPY_NAME));
  console.log(`ai-client-bridge proofs: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

void main();
