/**
 * Deterministic proofs A–N for UNIVERSAL_OWNER_CONTROLLED_CLIENT_RUNTIME_V1.
 *
 * How to run:
 *   npx tsx control/owner-client-runtime/tests/owner-client-runtime.test.ts
 */

import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { DNA_OS_MCP_TOOLS } from "../../../connections/dna-os-mcp/contract";
import { googleChromeGeminiAvailability } from "../../ai-client-bridge/contract";
import { applyOwnerReviewDecision } from "../../canonical-view/contract";
import { issueLocalAccessGrant, listLocalResourceEvents } from "../../local-resource-access/contract";
import {
  MCP_PROTOCOL_COMPAT,
  authenticateUniversalClient,
  createResourceHandle,
  decideOwnerComputeFirst,
  enableUniversalClient,
  evaluateUniversalClient,
  getOwnerEnvironment,
  handoffWorkContext,
  listOwnerEnvironments,
  listUniversalClients,
  markClientUnavailable,
  normalizeOwnerIntent,
  registerUniversalClient,
  submitOwnerIntent,
} from "../contract";

declare const process: { cwd(): string; env: Record<string, string | undefined>; exitCode?: number };
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };

const STAMP = Date.now();
const OCR = join(process.cwd(), "control/owner-client-runtime/data");
const LRA = join(process.cwd(), "control/local-resource-access/data");
const CV = join(process.cwd(), "control/canonical-view/data");
const ACB = join(process.cwd(), "control/ai-client-bridge/data");
const logs = {
  OWNER_CLIENTS_LOG: join(OCR, `ucr-clients-${STAMP}.jsonl`),
  RESOURCE_HANDLES_LOG: join(OCR, `ucr-handles-${STAMP}.jsonl`),
  WORK_CONTEXT_LOG: join(OCR, `ucr-work-${STAMP}.jsonl`),
  LOCAL_RESOURCE_GRANTS_LOG: join(LRA, `ucr-grants-${STAMP}.jsonl`),
  LOCAL_RESOURCE_REGISTRY_LOG: join(LRA, `ucr-resources-${STAMP}.jsonl`),
  LOCAL_RESOURCE_EVENTS_LOG: join(LRA, `ucr-events-${STAMP}.jsonl`),
  LOCAL_RESOURCE_EGRESS_LOG: join(LRA, `ucr-egress-${STAMP}.jsonl`),
  LOCAL_RESOURCE_EVIDENCE_LOG: join(LRA, `ucr-evidence-${STAMP}.jsonl`),
  LOCAL_RESOURCE_WORKSPACES_LOG: join(LRA, `ucr-workspaces-${STAMP}.jsonl`),
  LOCAL_RESOURCE_TRANSFER_LOG: join(LRA, `ucr-transfer-${STAMP}.jsonl`),
  CANONICAL_VIEW_REVIEWS_LOG: join(CV, `ucr-reviews-${STAMP}.jsonl`),
  CANONICAL_VIEW_PREVIEWS_LOG: join(CV, `ucr-previews-${STAMP}.jsonl`),
  AI_CLIENT_BINDINGS_LOG: join(ACB, `ucr-bind-${STAMP}.jsonl`),
  AI_HANDOFF_LOG: join(ACB, `ucr-handoff-${STAMP}.jsonl`),
};
for (const [key, value] of Object.entries(logs)) process.env[key] = value;

const FILE_RES = "resource://local/files/fixture-corpus";
const WRITE_RES = "resource://local/files/fixture-writable";
const GIT_RES = "resource://local/git/fixture-corpus";
const JOB_RES = "resource://local/compute/registered-jobs";
const SESSION = `session-ucr-${STAMP}`;
const CHATGPT = "ai://chatgpt-ucr";
const CURSOR = "ai://cursor-ucr";
const NOTES = join(process.cwd(), "control/local-resource-access/fixtures/corpus/notes.txt");
const COPY_NAME = `ucr-copy-${STAMP}.txt`;
const COPY_PATH = join(process.cwd(), "control/local-resource-access/fixtures/writable", COPY_NAME);

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

function grant(ai: string, resource: string, access: readonly ("READ" | "WRITE" | "EXECUTE")[], scope: readonly string[]): void {
  issueLocalAccessGrant({
    ai_identity: ai, session_id: SESSION, work_id: null, capability: "*", resource_id: resource,
    data_scope: [...scope], access: [...access], network_egress: "LOCAL_ONLY", expires_at: null, effect: "ALLOW",
  });
}

function enablePair(id: string, family: "AI_CHAT_CLIENT" | "AI_CODING_CLIENT", provider: string): void {
  registerUniversalClient({
    client_id: id, client_family: family, provider, session_work_scope: SESSION,
    protocol_version: "legacy-compatible",
    capabilities_declared: ["SEARCH", "COMPARE"],
  });
  authenticateUniversalClient(id, `${id}-identity`);
  enableUniversalClient(id, { data_access_scope: [FILE_RES], action_scope: ["SEARCH", "COMPARE", "COPY"] });
}

async function main(): Promise<void> {
  const notesBefore = readFileSync(NOTES, "utf8");
  grant(CHATGPT, FILE_RES, ["READ", "WRITE"], ["control/local-resource-access/fixtures/corpus"]);
  grant(CURSOR, FILE_RES, ["READ", "WRITE"], ["control/local-resource-access/fixtures/corpus"]);
  grant(CHATGPT, WRITE_RES, ["READ", "WRITE"], ["control/local-resource-access/fixtures/writable"]);
  grant(CURSOR, WRITE_RES, ["READ", "WRITE"], ["control/local-resource-access/fixtures/writable"]);
  grant(CHATGPT, GIT_RES, ["READ"], ["control/local-resource-access/fixtures/corpus"]);
  grant(CURSOR, GIT_RES, ["READ"], ["control/local-resource-access/fixtures/corpus"]);
  grant(CHATGPT, JOB_RES, ["READ", "EXECUTE"], []);
  grant(CURSOR, JOB_RES, ["READ", "EXECUTE"], []);

  await check("A. Authenticated client without Owner authority = DENY", async () => {
    registerUniversalClient({
      client_id: "ai://auth-only", client_family: "AI_CHAT_CLIENT", provider: "openai", session_work_scope: SESSION,
    });
    const authed = authenticateUniversalClient("ai://auth-only", "user-auth-only");
    assert(!("ok" in authed && authed.ok === false), "authenticate must succeed");
    assert("authenticated" in authed && authed.authenticated === true, "identity established");
    assert("owner_binding" in authed && authed.owner_binding === false, "no owner binding");
    const evald = evaluateUniversalClient("ai://auth-only");
    assert(evald.decision === "DENY", evald.reason_code);
    assert(evald.reason_code === "AUTHENTICATED_WITHOUT_OWNER_AUTHORITY", evald.reason_code);
    const invoked = await submitOwnerIntent({
      client_id: "ai://auth-only", session_id: SESSION, work_id: `work-a-${STAMP}`,
      text: "หาเอกสาร", resource_id: FILE_RES,
    });
    assert(invoked.ok === false, JSON.stringify(invoked));
  });

  await check("B. Provider identity never grants resource authority", async () => {
    enablePair(CHATGPT, "AI_CHAT_CLIENT", "openai");
    enablePair(CURSOR, "AI_CODING_CLIENT", "cursor");
    const gpt = listUniversalClients().find((row) => row.client_id === CHATGPT)!;
    const cur = listUniversalClients().find((row) => row.client_id === CURSOR)!;
    assert(gpt.provider === "openai" && cur.provider === "cursor", "providers differ");
    assert(gpt.grants_authority === false && cur.grants_authority === false, "provider is metadata");
    const unknownProvider = evaluateUniversalClient("ai://auth-only");
    assert(unknownProvider.decision === "DENY", "openai-authenticated without Owner still DENY");
  });

  await check("C. Owner resource remains usable when AI client is unavailable", async () => {
    markClientUnavailable(CHATGPT);
    const envs = listOwnerEnvironments();
    const local = envs.find((row) => row.environment_id === "env://local-machine");
    assert(local?.availability === "AVAILABLE", "local machine remains");
    assert(local?.ai_provider_infrastructure === false, "not provider infra");
    const blocked = await submitOwnerIntent({
      client_id: CHATGPT, session_id: SESSION, work_id: `work-c-block-${STAMP}`,
      text: "search notes", resource_id: FILE_RES,
    });
    assert(blocked.ok === false && blocked.reason_code === "PROVIDER_UNAVAILABLE", JSON.stringify(blocked));
    assert(blocked.system_unavailable === false, "not SYSTEM_UNAVAILABLE");
    const other = await submitOwnerIntent({
      client_id: CURSOR, session_id: SESSION, work_id: `work-c-ok-${STAMP}`,
      text: "search notes", resource_id: FILE_RES,
    });
    assert(other.ok === true, JSON.stringify(other));
    enableUniversalClient(CHATGPT, { data_access_scope: [FILE_RES], action_scope: ["SEARCH", "COMPARE", "COPY"] });
    const restored = listUniversalClients().find((row) => row.client_id === CHATGPT)!;
    assert(restored.availability === "AVAILABLE", "re-enable restores availability");
  });

  await check("D+E. Same canonical action from two client types, identical authority", async () => {
    const a = await submitOwnerIntent({
      client_id: CHATGPT, session_id: SESSION, work_id: `work-de-a-${STAMP}`,
      text: "หาเอกสารใบแจ้งหนี้เดือนนี้", resource_id: FILE_RES,
    });
    const b = await submitOwnerIntent({
      client_id: CURSOR, session_id: SESSION, work_id: `work-de-b-${STAMP}`,
      text: "หาเอกสารใบแจ้งหนี้เดือนนี้", resource_id: FILE_RES,
    });
    assert(a.ok === true && b.ok === true, JSON.stringify({ a, b }));
    assert(a.authority === b.authority, `${String(a.authority)} vs ${String(b.authority)}`);
    assert(a.locality === "LOCAL" && b.locality === "LOCAL", "local execution");
    const ia = a.intent as { canonical_action?: string; is_authority?: boolean; constraints?: Record<string, unknown> };
    assert(ia.canonical_action === "SEARCH" && ia.is_authority === false, JSON.stringify(ia));
    assert(ia.constraints?.date === "current_month", JSON.stringify(ia.constraints));
  });

  await check("F. RESOURCE_HANDLE references source without copying it", async () => {
    const handle = createResourceHandle({
      resource_id: FILE_RES, logical_path: "notes.txt", owner_authority: "ALLOW",
    });
    assert(handle.raw_content_included === false, "no raw copy");
    assert(handle.size === Buffer.byteLength(notesBefore), `size=${handle.size}`);
    assert(!JSON.stringify(handle).includes(notesBefore.slice(0, 40)), "contents not in handle");
  });

  await check("G. Local deterministic computation before external reasoning", async () => {
    const local = decideOwnerComputeFirst({
      capability: "local.files.search", resource_id: FILE_RES, bytes_proposed: 100,
      ai_identity: CHATGPT, session_id: SESSION,
    });
    assert(local.selected === "OWNER_LOCAL", local.selected);
    assert(local.external_reasoning_required === false, "skipped");
    const semantic = decideOwnerComputeFirst({
      capability: "local.git.diff", resource_id: GIT_RES, bytes_proposed: 100,
      semantic_review_required: true, ai_identity: CHATGPT, session_id: SESSION,
    });
    assert(semantic.external_reasoning_required === true, semantic.selected);
    assert(semantic.order[0] === "OWNER_POLICY", semantic.order.join(","));
  });

  await check("H. Exact external AI bytes are measured", async () => {
    const searched = await submitOwnerIntent({
      client_id: CURSOR, session_id: SESSION, work_id: `work-h-${STAMP}`,
      text: "search", resource_id: FILE_RES,
    });
    assert(typeof searched.EXTERNAL_AI_BYTES_SENT === "number", JSON.stringify(searched));
    assert(typeof searched.LOCAL_BYTES_PROCESSED === "number", "local bytes");
    assert(Number(searched.EXTERNAL_AI_BYTES_SENT) <= Number(searched.LOCAL_BYTES_PROCESSED), "minimized");
  });

  await check("I. Work transfers between clients without full transcript", async () => {
    const handed = handoffWorkContext({
      work_id: `work-h-${STAMP}`, from_client_id: CURSOR, to_client_id: CHATGPT,
    });
    assert(!("ok" in handed && handed.ok === false), JSON.stringify(handed));
    assert("transcript_included" in handed && handed.transcript_included === false, "no transcript");
  });

  await check("J. Side-effect action uses preview/Owner decision path", async () => {
    const previewed = await submitOwnerIntent({
      client_id: CHATGPT, session_id: SESSION, work_id: `work-j-${STAMP}`,
      text: "copy this file", resource_id: FILE_RES, destination_id: WRITE_RES,
      copy_destination_logical: COPY_NAME,
    });
    assert(previewed.ok === true && previewed.executed === false, JSON.stringify(previewed));
    assert(previewed.SIDE_EFFECT_PREVIEW_REQUIRED === true, "preview required");
    const review = previewed.review as { review_id?: string; preview?: { execution_blocked?: boolean }; owner_facing?: { what?: string } };
    assert(review.preview?.execution_blocked === true, "blocked until Owner");
    assert(typeof review.owner_facing?.what === "string", "owner facing");
    const approved = await applyOwnerReviewDecision({
      review_id: String(review.review_id), decision: "APPROVE", ai_client_id: CHATGPT, session_id: SESSION,
    });
    assert(!("ok" in approved && approved.ok === false), JSON.stringify(approved));
    assert("executed" in approved && approved.executed === true, "executed after Owner");
    assert(existsSync(COPY_PATH), "copy on disk");
    if (existsSync(COPY_PATH)) unlinkSync(COPY_PATH);
  });

  await check("K. One provider failure does not block another eligible route", async () => {
    markClientUnavailable(CHATGPT);
    const other = await submitOwnerIntent({
      client_id: CURSOR, session_id: SESSION, work_id: `work-k-${STAMP}`,
      text: "search", resource_id: FILE_RES,
    });
    assert(other.ok === true, JSON.stringify(other));
    enableUniversalClient(CHATGPT, { data_access_scope: [FILE_RES], action_scope: ["SEARCH", "COMPARE", "COPY"] });
  });

  await check("L. Protocol/client version differences do not alter Owner authority", async () => {
    const a = evaluateUniversalClient(CURSOR, "2025-03-26");
    const b = evaluateUniversalClient(CURSOR, "2026-07-28");
    assert(a.decision === b.decision && a.reason_code === b.reason_code, `${a.reason_code} vs ${b.reason_code}`);
    assert(a.protocol_version_affects_authority === false, "protocol is not authority");
    assert(MCP_PROTOCOL_COMPAT.target_spec === "2026-07-28", MCP_PROTOCOL_COMPAT.target_spec);
    assert(MCP_PROTOCOL_COMPAT.hidden_transport_session_for_authority === false, "stateless authority");
    const names = DNA_OS_MCP_TOOLS.map((tool) => tool.metadata.name);
    assert(names.includes("submit_command"), "backward compatible");
    assert(names.includes("dna_os.list_clients"), "discovery tools");
    assert(names[0] === "submit_command", "existing order preserved at head");
  });

  await check("M. No secrets enter client discovery/result/evidence", async () => {
    const blob = JSON.stringify({
      clients: listUniversalClients(),
      environments: listOwnerEnvironments(),
      owner_server: getOwnerEnvironment("env://owner-server"),
      gemini: googleChromeGeminiAvailability(),
    });
    assert(!/\/Users\//.test(blob), "no home paths");
    assert(!/ghp_|sk-|keychain:\/\//i.test(blob), "no secrets");
    const invoice = normalizeOwnerIntent({ client_id: CHATGPT, text: "ส่งไฟล์นี้ให้อีเมลบัญชี", resource_id: FILE_RES });
    assert(invoice.canonical_action === "SEND" && invoice.is_authority === false, JSON.stringify(invoice));
    const review = normalizeOwnerIntent({ client_id: CURSOR, text: "ตรวจโค้ดล่าสุด", resource_id: GIT_RES });
    assert(review.canonical_action === "COMPARE", JSON.stringify(review));
  });

  await check("N. Event stream records client/runtime facts", async () => {
    const events = listLocalResourceEvents();
    const types = new Set(events.map((row) => row.event));
    for (const required of [
      "CLIENT_AUTHENTICATED", "CLIENT_AUTHORIZATION_CHECKED", "RESOURCE_HANDLE_CREATED",
      "OWNER_COMPUTE_ROUTE_SELECTED", "EXTERNAL_REASONING_SKIPPED", "WORK_CONTEXT_CREATED",
      "WORK_CONTEXT_HANDOFF", "PROVIDER_UNAVAILABLE",
    ]) {
      assert(types.has(required as never), `missing ${required}`);
    }
    assert(getOwnerEnvironment("env://owner-server")?.availability === "NOT_AVAILABLE", "do not fake owner server");
    assert(getOwnerEnvironment("env://remote-owner-machine")?.availability === "NOT_AVAILABLE", "do not fake remote");
    assert(googleChromeGeminiAvailability().GEMINI_BINDING === "NOT_AVAILABLE", "do not fake Gemini");
  });

  assert(notesBefore === readFileSync(NOTES, "utf8"), "unmanaged source unchanged");
  for (const file of Object.values(logs)) {
    if (existsSync(file)) unlinkSync(file);
  }

  console.log(`NEW_DETERMINISTIC_PROOFS_PASSED = ${failed === 0}`);
  process.exitCode = failed === 0 ? 0 : 1;
}

void main();
