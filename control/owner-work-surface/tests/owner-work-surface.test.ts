/**
 * Deterministic proofs for OWNER_WORK_SURFACE_V1 / REAL_APP_CAPABILITY_PACK_V1.
 *
 * How to run:
 *   npx tsx control/owner-work-surface/tests/owner-work-surface.test.ts
 */

import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { DNA_OS_MCP_TOOLS } from "../../../connections/dna-os-mcp/contract";
import { applyOwnerReviewDecision, normalizeAiOutputToCanonicalView } from "../../canonical-view/contract";
import {
  issueLocalAccessGrant,
  issueOwnerCapabilityBindingPolicy,
  listDataEgress,
} from "../../local-resource-access/contract";
import {
  emailWorkSurface,
  listAppLauncherItems,
  openOwnerWorkItem,
  ownerSearch,
  ownerWorkSurfaceSnapshot,
  realAppCapabilityPack,
  requestOwnerWorkAction,
} from "../contract";

declare const process: { cwd(): string; env: Record<string, string | undefined>; exitCode?: number };
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };

const STAMP = Date.now();
const LRA = join(process.cwd(), "control/local-resource-access/data");
const CV = join(process.cwd(), "control/canonical-view/data");
const OCR = join(process.cwd(), "control/owner-client-runtime/data");
const logs: Record<string, string> = {
  LOCAL_RESOURCE_GRANTS_LOG: join(LRA, `ows-grants-${STAMP}.jsonl`),
  LOCAL_RESOURCE_REGISTRY_LOG: join(LRA, `ows-resources-${STAMP}.jsonl`),
  LOCAL_RESOURCE_EVENTS_LOG: join(LRA, `ows-events-${STAMP}.jsonl`),
  LOCAL_RESOURCE_EGRESS_LOG: join(LRA, `ows-egress-${STAMP}.jsonl`),
  LOCAL_RESOURCE_EVIDENCE_LOG: join(LRA, `ows-evidence-${STAMP}.jsonl`),
  LOCAL_RESOURCE_WORKSPACES_LOG: join(LRA, `ows-workspaces-${STAMP}.jsonl`),
  LOCAL_RESOURCE_TRANSFER_LOG: join(LRA, `ows-transfer-${STAMP}.jsonl`),
  OWNER_MACHINE_POLICY_LOG: join(LRA, `ows-omp-${STAMP}.jsonl`),
  OWNER_CAPABILITY_BINDING_LOG: join(LRA, `ows-ocb-${STAMP}.jsonl`),
  CANONICAL_VIEW_REVIEWS_LOG: join(CV, `ows-reviews-${STAMP}.jsonl`),
  CANONICAL_VIEW_PREVIEWS_LOG: join(CV, `ows-previews-${STAMP}.jsonl`),
  OWNER_CLIENTS_LOG: join(OCR, `ows-clients-${STAMP}.jsonl`),
  RESOURCE_HANDLES_LOG: join(OCR, `ows-handles-${STAMP}.jsonl`),
  WORK_CONTEXT_LOG: join(OCR, `ows-work-${STAMP}.jsonl`),
  LOCAL_TOOL_ADAPTERS_LOG: join(process.cwd(), "control/local-tool-fabric/data", `ows-adapters-${STAMP}.jsonl`),
  LOCAL_TOOL_DEVICES_LOG: join(process.cwd(), "control/local-tool-fabric/data", `ows-devices-${STAMP}.jsonl`),
  LOCAL_TOOL_HEALTH_LOG: join(process.cwd(), "control/local-tool-fabric/data", `ows-health-${STAMP}.jsonl`),
  MACOS_BRIDGES_LOG: join(process.cwd(), "control/macos-native-bridge/data", `ows-bridges-${STAMP}.jsonl`),
  MACOS_COMMANDS_LOG: join(process.cwd(), "control/macos-native-bridge/data", `ows-commands-${STAMP}.jsonl`),
  MACOS_CORRELATION_LOG: join(process.cwd(), "control/macos-native-bridge/data", `ows-corr-${STAMP}.jsonl`),
  MACOS_BASELINE_LOG: join(process.cwd(), "control/macos-native-bridge/data", `ows-base-${STAMP}.jsonl`),
  MACOS_DRIFT_LOG: join(process.cwd(), "control/macos-native-bridge/data", `ows-drift-${STAMP}.jsonl`),
  WORK_PIPELINE_LOG: join(process.cwd(), "control/work-production-pipeline/data", `ows-pipe-${STAMP}.jsonl`),
  WORK_PIPELINE_NOTIFY_LOG: join(process.cwd(), "control/work-production-pipeline/data", `ows-pnotify-${STAMP}.jsonl`),
  WORK_PIPELINE_VERIFY_LOG: join(process.cwd(), "control/work-production-pipeline/data", `ows-pver-${STAMP}.jsonl`),
  WORK_PIPELINE_DEPLOY_LOG: join(process.cwd(), "control/work-production-pipeline/data", `ows-pdep-${STAMP}.jsonl`),
  WORK_PIPELINE_CAPS_LOG: join(process.cwd(), "control/work-production-pipeline/data", `ows-pcaps-${STAMP}.jsonl`),
};
for (const [key, value] of Object.entries(logs)) process.env[key] = value;

const FILE_RES = "resource://local/files/fixture-corpus";
const WRITE_RES = "resource://local/files/fixture-writable";
const GIT_RES = "resource://local/git/fixture-corpus";
const GH = "resource://local/remote/github";
const APP = "resource://local/app/textedit";
const SESSION = `session-ows-${STAMP}`;
const AI = "ai://owner-work-surface";
const NOTES = join(process.cwd(), "control/local-resource-access/fixtures/corpus/notes.txt");
const COPY_NAME = `ows-copy-${STAMP}.txt`;
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

function grant(resource: string, access: readonly ("READ" | "WRITE" | "EXECUTE")[], scope: readonly string[]): void {
  issueLocalAccessGrant({
    ai_identity: AI, session_id: SESSION, work_id: null, capability: "*", resource_id: resource,
    data_scope: [...scope], access: [...access], network_egress: "LOCAL_ONLY", expires_at: null, effect: "ALLOW",
  });
}

async function main(): Promise<void> {
  const notesBefore = readFileSync(NOTES, "utf8");
  grant(FILE_RES, ["READ", "WRITE"], ["control/local-resource-access/fixtures/corpus"]);
  grant(WRITE_RES, ["READ", "WRITE"], ["control/local-resource-access/fixtures/writable"]);
  grant(GIT_RES, ["READ"], ["control/local-resource-access/fixtures/corpus"]);
  grant(GH, ["READ"], []);
  grant(APP, ["READ", "EXECUTE"], []);
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

  await check("A. Work surface snapshot is canonical, not chat-primary", () => {
    const snap = ownerWorkSurfaceSnapshot(AI, SESSION);
    assert(snap.schema === "OWNER_WORK_SURFACE_V1", String(snap.schema));
    assert(snap.chat_is_primary === false, "chat must not be primary");
    assert(snap.grants_authority === false, "discovery is not authority");
    assert(snap.ai_arbitrary_layout_authority === false, "AI layout");
    assert(snap.ai_provider_grants_authority === false, "provider");
    assert(snap.unused_services_secondary === true, "unused secondary");
  });

  await check("B. Launcher covers categories and icons grant no authority", () => {
    const items = listAppLauncherItems(AI, SESSION, `work-b-${STAMP}`);
    const cats = new Set(items.map((row) => row.category));
    for (const required of ["FILES", "FOLDERS", "DOCUMENTS", "PDF", "GIT", "LOCAL_APPS", "ACTIVITY"]) {
      assert(cats.has(required as never), `missing ${required}`);
    }
    assert(items.every((row) => row.grants_authority === false), "icons are not capabilities");
    assert(items.some((row) => row.secondary_catalog === true), "unused services secondary");
    assert(items.some((row) => row.category === "EMAIL" && row.availability === "UNAVAILABLE"), "gmail unavailable");
  });

  await check("C. Owner search is local-first and does not upload corpora", async () => {
    const search = await ownerSearch({
      query: "zzqegate-local-resource-marker", ai_client_id: AI, session_id: SESSION, work_id: `work-c-${STAMP}`,
    });
    assert(search.local_search_first === true && search.local_source_uploaded === false, JSON.stringify(search));
    assert(search.hits.some((row) => row.type === "FILE" && row.authority_state === "ALLOW"), JSON.stringify(search.hits.slice(0, 3)));
    assert(search.hits.some((row) => row.type === "EMAIL" && row.authority_state === "DENY"), "email contract");
    assert(typeof search.EXTERNAL_AI_BYTES_SENT === "number", "bytes");
    assert(!JSON.stringify(search).includes("ghp_"), "no token");
  });

  await check("D. File open uses registered canonical view", async () => {
    const opened = await openOwnerWorkItem({
      app_id: "launcher://files", ai_client_id: AI, session_id: SESSION, work_id: `work-d-${STAMP}`, logical_path: "notes.txt",
    });
    assert(opened.ok === true && opened.APP_ICON_GRANTS_AUTHORITY === false, JSON.stringify(opened));
    const review = opened.review as { view?: { view_type?: string }; state?: string };
    assert(review.view?.view_type === "FILE_LIST_V1", JSON.stringify(review.view));
    assert(review.state === "VIEW", String(review.state));
  });

  await check("E. COPY requires preview then Owner APPROVE through gateway", async () => {
    const opened = await openOwnerWorkItem({
      app_id: "launcher://files", ai_client_id: AI, session_id: SESSION, work_id: `work-e-${STAMP}`,
    });
    const review = opened.review as { review_id?: string };
    const previewed = await requestOwnerWorkAction({
      review_id: String(review.review_id), action: "COPY", resource_id: FILE_RES, work_id: `work-e-${STAMP}`,
      payload: { source_logical: "notes.txt", destination_logical: COPY_NAME, destination_resource_id: WRITE_RES },
    });
    assert(previewed.executed === false && previewed.SIDE_EFFECT_PREVIEW_REQUIRED === true, JSON.stringify(previewed));
    const surface = previewed.review as { preview?: { execution_blocked?: boolean; source_hash?: string }; owner_facing?: { network?: string } };
    assert(surface.preview?.execution_blocked === true, "blocked");
    assert(typeof surface.preview?.source_hash === "string", "hash");
    assert(typeof surface.owner_facing?.network === "string", "network in preview language");
    const approved = await applyOwnerReviewDecision({
      review_id: String(review.review_id), decision: "APPROVE", ai_client_id: AI, session_id: SESSION,
    });
    assert(!("ok" in approved && approved.ok === false), JSON.stringify(approved));
    assert("executed" in approved && approved.executed === true, "executed");
    assert(existsSync(COPY_PATH), "copy exists");
  });

  await check("F. REJECT / EDIT_REQUEST do not execute", async () => {
    const opened = await openOwnerWorkItem({
      app_id: "launcher://files", ai_client_id: AI, session_id: SESSION, work_id: `work-f-${STAMP}`,
    });
    const review = opened.review as { review_id?: string };
    await requestOwnerWorkAction({
      review_id: String(review.review_id), action: "COPY", resource_id: FILE_RES, work_id: `work-f-${STAMP}`,
      payload: { source_logical: "notes.txt", destination_logical: `no-${STAMP}.txt`, destination_resource_id: WRITE_RES },
    });
    const rejected = await applyOwnerReviewDecision({
      review_id: String(review.review_id), decision: "REJECT", ai_client_id: AI, session_id: SESSION,
    });
    assert(!("ok" in rejected && rejected.ok === false), JSON.stringify(rejected));
    assert("executed" in rejected && rejected.executed === false, "reject blocks");
  });

  await check("G. Document/PDF extract and summarize stay local-first", async () => {
    const { invokeLocalCapability } = await import("../../local-resource-access/contract");
    const extracted = await invokeLocalCapability({
      ai_client_id: AI, session_id: SESSION, work_id: `work-g-${STAMP}`,
      capability: "local.document.extract_text", resource_id: FILE_RES, input: { logical_path: "sample.pdf" },
    });
    const summarized = await invokeLocalCapability({
      ai_client_id: AI, session_id: SESSION, work_id: `work-g-${STAMP}`,
      capability: "local.document.summarize", resource_id: FILE_RES, input: { logical_path: "summarize-source.txt" },
    });
    assert(extracted.ok && summarized.ok, JSON.stringify({ extracted, summarized }));
    assert(extracted.envelope.execution_locality === "LOCAL", "extract local");
    assert(typeof summarized.result.SOURCE_BYTES === "number", "source bytes");
    assert(Number(summarized.result.RESULT_BYTES_RETURNED) <= Number(summarized.result.LOCAL_BYTES_PROCESSED), "minimized");
  });

  await check("H. Email/Google stay NOT_AVAILABLE and grant no authority", () => {
    const email = emailWorkSurface(AI, SESSION);
    const pack = realAppCapabilityPack(AI, SESSION, `work-h-${STAMP}`);
    assert(email.runtime_binding === "NOT_AVAILABLE", email.runtime_binding);
    assert(email.available_actions.length === 0, JSON.stringify(email.available_actions));
    assert(pack.google.gmail === "NOT_AVAILABLE", JSON.stringify(pack.google));
    assert(pack.google.account_session_grants_authority === false, "google session is not authority");
  });

  await check("I. GitHub identity read does not expose secrets", async () => {
    const opened = await openOwnerWorkItem({
      app_id: "service://github/source-authority", ai_client_id: AI, session_id: SESSION, work_id: `work-i-${STAMP}`,
    });
    const blob = JSON.stringify(opened);
    assert(!/ghp_|github_pat_|Bearer\s+\S/.test(blob), blob.slice(0, 400));
    assert(opened.secret_exposed === false, "secret_exposed");
  });

  await check("J. Database write is not enabled; schema is contract-only", async () => {
    const opened = await openOwnerWorkItem({
      app_id: "service://database/schema-read", ai_client_id: AI, session_id: SESSION, work_id: `work-j-${STAMP}`,
    });
    assert(opened.write_enabled === false, JSON.stringify(opened));
    assert(opened.runtime_binding === "NOT_AVAILABLE", String(opened.runtime_binding));
    const pack = realAppCapabilityPack(AI, SESSION, `work-j-${STAMP}`);
    assert(pack.database.write_enabled === false, JSON.stringify(pack.database));
  });

  await check("K. TextEdit UI cannot show WRITE", () => {
    const pack = realAppCapabilityPack(AI, SESSION, `work-k-${STAMP}`);
    const textedit = pack.local_applications.find((row) => String(row.application_id).includes("textedit"));
    assert(textedit !== undefined, "textedit listed");
    const caps = textedit!.capabilities as { everyday_actions?: string[]; allowed_actions?: string[] } | null;
    assert(caps?.everyday_actions?.includes("READ") === true, JSON.stringify(caps));
    assert(!caps?.everyday_actions?.includes("WRITE"), JSON.stringify(caps));
    assert(!JSON.stringify(caps?.allowed_actions).includes("write"), JSON.stringify(caps?.allowed_actions));
  });

  await check("L. AI cannot decide layout, buttons, or evidence", () => {
    const rejected = normalizeAiOutputToCanonicalView({ view_type: "FILE_LIST_V1", html: "<div/>", layout: { columns: 3 } });
    assert(rejected.ok === false, JSON.stringify(rejected));
    const fallback = normalizeAiOutputToCanonicalView({ view_type: "AI_DASHBOARD" });
    assert(fallback.ok && fallback.view.view_type === "SAFE_GENERIC_VIEW", JSON.stringify(fallback));
  });

  await check("M. Existing MCP reused; no second server/control plane in tool table", () => {
    const names = DNA_OS_MCP_TOOLS.map((tool) => tool.metadata.name);
    assert(names.includes("dna_os.get_owner_work_surface"), "work surface tool");
    assert(names.includes("dna_os.get_owner_response"), "owner response projection tool");
    assert(names.includes("dna_os.owner_search"), "search tool");
    assert(names.includes("submit_command"), "existing tools remain");
    assert(!names.includes("get_secret"), "no secret tool");
  });

  await check("N. Unmanaged files unchanged; no credential leak in snapshot", () => {
    const snap = JSON.stringify(ownerWorkSurfaceSnapshot(AI, SESSION));
    assert(!/ghp_|sk-|keychain:\/\//i.test(snap), "no secrets in snapshot");
    assert(notesBefore === readFileSync(NOTES, "utf8"), "notes unmanaged");
    const egress = listDataEgress(`work-c-${STAMP}`);
    assert(egress.every((row) => row.schema === "DATA_EGRESS_POLICY_V1"), "existing egress schema");
  });

  if (existsSync(COPY_PATH)) unlinkSync(COPY_PATH);
  for (const file of Object.values(logs)) {
    if (existsSync(file)) unlinkSync(file);
  }
  console.log(`NEW_DETERMINISTIC_PROOFS_PASSED = ${failed === 0}`);
  process.exitCode = failed === 0 ? 0 : 1;
}

void main();
