/**
 * Deterministic A–N proofs for CANONICAL_VIEW_V1 / ACTION_PREVIEW_V1 / OWNER_REVIEW_SURFACE_V1.
 *
 * How to run:
 *   npx tsx control/canonical-view/tests/canonical-view.test.ts
 */

import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import {
  DOCUMENT_TEMPLATES,
  INVENTORY_TABLE_SCHEMA,
  REGISTERED_VIEW_TYPES,
  actionsAvailableForView,
  applyOwnerReviewDecision,
  attachActionPreview,
  createActionPreview,
  getDocumentTemplate,
  listActivityViewRows,
  listLauncherItems,
  loadInventoryFixtureRows,
  normalizeAiOutputToCanonicalView,
  openOwnerReviewView,
  renderActivityView,
  renderGenericTable,
  renderInventoryTable,
} from "../contract";
import { issueLocalAccessGrant } from "../../local-resource-access/contract";

declare const process: { cwd(): string; env: Record<string, string | undefined>; exitCode?: number };
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };

const STAMP = Date.now();
const DATA = join(process.cwd(), "control/canonical-view/data");
const LRA = join(process.cwd(), "control/local-resource-access/data");
process.env.CANONICAL_VIEW_REVIEWS_LOG = join(DATA, `cv-reviews-${STAMP}.jsonl`);
process.env.CANONICAL_VIEW_PREVIEWS_LOG = join(DATA, `cv-previews-${STAMP}.jsonl`);
process.env.LOCAL_RESOURCE_GRANTS_LOG = join(LRA, `cv-grants-${STAMP}.jsonl`);
process.env.LOCAL_RESOURCE_REGISTRY_LOG = join(LRA, `cv-resources-${STAMP}.jsonl`);
process.env.LOCAL_RESOURCE_EVENTS_LOG = join(LRA, `cv-events-${STAMP}.jsonl`);
process.env.LOCAL_RESOURCE_EGRESS_LOG = join(LRA, `cv-egress-${STAMP}.jsonl`);
process.env.LOCAL_RESOURCE_EVIDENCE_LOG = join(LRA, `cv-evidence-${STAMP}.jsonl`);
process.env.LOCAL_RESOURCE_WORKSPACES_LOG = join(LRA, `cv-workspaces-${STAMP}.jsonl`);
process.env.LOCAL_RESOURCE_TRANSFER_LOG = join(LRA, `cv-transfer-${STAMP}.jsonl`);
process.env.OWNER_MACHINE_POLICY_LOG = join(LRA, `cv-omp-${STAMP}.jsonl`);
process.env.OWNER_CAPABILITY_BINDING_LOG = join(LRA, `cv-ocb-${STAMP}.jsonl`);

const FILE_RES = "resource://local/files/fixture-corpus";
const WRITE_RES = "resource://local/files/fixture-writable";
const SESSION = `session-cv-${STAMP}`;
const AI = "ai://canonical-view-client";
const NOTES = join(process.cwd(), "control/local-resource-access/fixtures/corpus/notes.txt");
const WRITABLE = join(process.cwd(), "control/local-resource-access/fixtures/writable");
const COPY_NAME = `cv-copy-${STAMP}.txt`;
const DEL_NAME = `cv-del-${STAMP}.txt`;

let passed = 0;
let failed = 0;
function assert(condition: boolean, message: string): asserts condition {
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
    ai_identity: AI, session_id: SESSION, work_id: null, capability: "*", resource_id: FILE_RES,
    data_scope: ["control/local-resource-access/fixtures/corpus"], access: ["READ", "WRITE"],
    network_egress: "LOCAL_ONLY", expires_at: null, effect: "ALLOW",
  });
  issueLocalAccessGrant({
    ai_identity: AI, session_id: SESSION, work_id: null, capability: "*", resource_id: WRITE_RES,
    data_scope: ["control/local-resource-access/fixtures/writable"], access: ["READ", "WRITE"],
    network_egress: "LOCAL_ONLY", expires_at: null, effect: "ALLOW",
  });

  await check("A. AI cannot define arbitrary UI structure", () => {
    const rejected = normalizeAiOutputToCanonicalView({
      view_type: "GENERIC_TABLE_V1",
      html: "<div class='ai-layout'><script>alert(1)</script></div>",
      layout: { regions: ["invented"] },
    });
    assert(rejected.ok === false, "arbitrary UI must reject");
    assert(rejected.reason_code === "ARBITRARY_AI_PRESENTATION", rejected.reason_code);
  });

  await check("B. Invalid AI structured output is rejected", () => {
    const extra = normalizeAiOutputToCanonicalView({
      view_type: "GENERIC_TABLE_V1",
      data_schema: INVENTORY_TABLE_SCHEMA.schema_id,
      rows: [{ row_id: "x", sku: "Z", invented_column: true }],
    });
    assert(extra.ok === false, "undeclared fields must reject");
    const jsx = normalizeAiOutputToCanonicalView({ jsx: "<Table/>", presentation: "custom" });
    assert(jsx.ok === false, "jsx presentation must reject");
  });

  await check("C. Valid structured output renders canonical view", () => {
    const ok = normalizeAiOutputToCanonicalView({
      view_type: "GENERIC_TABLE_V1",
      data_schema: INVENTORY_TABLE_SCHEMA.schema_id,
      rows: loadInventoryFixtureRows(),
      source_resource_ids: ["fixture://inventory"],
    });
    assert(ok.ok, JSON.stringify(ok));
    if (!ok.ok) return;
    assert(ok.view.view_type === "GENERIC_TABLE_V1", ok.view.view_type);
    assert(ok.view.render_status === "RENDERABLE", ok.view.render_status);
    assert(ok.view.schema === "CANONICAL_VIEW_V1", ok.view.schema);
  });

  await check("D. Table column/order rules come from schema, not AI", () => {
    const rendered = renderInventoryTable({ sort_field: "sku", filter_field: "category", filter_contains: "hardware" });
    assert(!("ok" in rendered), JSON.stringify(rendered));
    if ("ok" in rendered) return;
    assert(rendered.source_schema === "REGISTERED", rendered.source_schema);
    const keys = rendered.columns.map((col) => col.key);
    assert(JSON.stringify(keys) === JSON.stringify(["row_id", "sku", "name", "category", "qty", "unit_price", "line_total"]), JSON.stringify(keys));
    assert(rendered.row_count === 2, String(rendered.row_count));
    assert(rendered.totals.qty === 6, String(rendered.totals.qty));
    const unknown = renderGenericTable(INVENTORY_TABLE_SCHEMA.schema_id, loadInventoryFixtureRows(), { sort_field: "ai_invented" });
    assert("ok" in unknown && unknown.ok === false, "invented sort field");
  });

  await check("E. Side-effecting action generates preview before execution", () => {
    const preview = createActionPreview({
      work_id: `work-e-${STAMP}`,
      action: "COPY",
      resource_id: FILE_RES,
      destination_resource_id: WRITE_RES,
      input: { source_logical: "notes.txt", destination_logical: COPY_NAME, destination_resource_id: WRITE_RES },
    });
    assert(preview.schema === "ACTION_PREVIEW_V1", preview.schema);
    assert(preview.execution_blocked === true, "must block until decision");
    assert(!existsSync(join(WRITABLE, COPY_NAME)), "preview must not copy");
  });

  await check("F. Preview identifies source/destination/resources", () => {
    const preview = createActionPreview({
      work_id: `work-f-${STAMP}`,
      action: "COPY",
      resource_id: FILE_RES,
      input: { source_logical: "notes.txt", destination_logical: COPY_NAME, destination_resource_id: WRITE_RES },
    });
    assert(String((preview.source as { resource_id: string }).resource_id) === FILE_RES, "source resource");
    assert(preview.destination !== null && String((preview.destination as { resource_id: string }).resource_id) === WRITE_RES, "dest resource");
    assert(preview.files_records_affected.includes("notes.txt"), "source file");
    assert(typeof preview.source_hash === "string" && preview.source_hash.length === 64, String(preview.source_hash));
    assert(typeof preview.bytes_transferred === "number" && preview.bytes_transferred > 0, String(preview.bytes_transferred));
  });

  await check("G. OWNER_APPROVAL_REQUIRED cannot EXECUTE from UI without approval", async () => {
    const opened = openOwnerReviewView({
      work_id: `work-g-${STAMP}`, ai_client_id: AI, session_id: SESSION,
      view_type: "FILE_LIST_V1", source_resource_ids: [WRITE_RES],
    });
    const previewed = attachActionPreview(opened.review_id, {
      work_id: `work-g-${STAMP}`, action: "DELETE", resource_id: WRITE_RES,
      input: { logical_path: DEL_NAME },
    });
    assert(!("ok" in previewed), JSON.stringify(previewed));
    if ("ok" in previewed) return;
    assert(previewed.preview?.owner_approval_requirement === "OWNER_APPROVAL_REQUIRED", "approval required");
    assert(!previewed.controls.includes("EXECUTE"), "EXECUTE hidden");
    const blocked = await applyOwnerReviewDecision({
      review_id: opened.review_id, decision: "EXECUTE", ai_client_id: AI, session_id: SESSION,
    });
    assert("ok" in blocked && blocked.ok === false, JSON.stringify(blocked));
    assert("ok" in blocked && blocked.reason_code === "OWNER_APPROVAL_REQUIRED", JSON.stringify(blocked));
  });

  await check("H. REJECT prevents execution", async () => {
    const opened = openOwnerReviewView({
      work_id: `work-h-${STAMP}`, ai_client_id: AI, session_id: SESSION,
      view_type: "FILE_LIST_V1", source_resource_ids: [WRITE_RES],
    });
    attachActionPreview(opened.review_id, {
      work_id: `work-h-${STAMP}`, action: "DELETE", resource_id: WRITE_RES,
      input: { logical_path: "notes.txt" },
    });
    const rejected = await applyOwnerReviewDecision({
      review_id: opened.review_id, decision: "REJECT", ai_client_id: AI, session_id: SESSION,
    });
    assert(!("ok" in rejected), JSON.stringify(rejected));
    if ("ok" in rejected) return;
    assert(rejected.executed === false, "must not execute");
    assert(rejected.state === "RESULT", rejected.state);
    assert(notesBefore === readFileSync(NOTES, "utf8"), "corpus unchanged");
  });

  await check("I. APPROVE routes through existing canonical action path", async () => {
    const opened = openOwnerReviewView({
      work_id: `work-i-${STAMP}`, ai_client_id: AI, session_id: SESSION,
      view_type: "FILE_LIST_V1", source_resource_ids: [FILE_RES, WRITE_RES],
    });
    attachActionPreview(opened.review_id, {
      work_id: `work-i-${STAMP}`, action: "COPY", resource_id: FILE_RES,
      input: { source_logical: "notes.txt", destination_logical: COPY_NAME, destination_resource_id: WRITE_RES },
    });
    const approved = await applyOwnerReviewDecision({
      review_id: opened.review_id, decision: "APPROVE", ai_client_id: AI, session_id: SESSION,
    });
    assert(!("ok" in approved), JSON.stringify(approved));
    if ("ok" in approved) return;
    assert(approved.executed === true, JSON.stringify(approved.result));
    assert(approved.execution_id !== null, "execution id");
    assert(String((approved.result as { adapter_capability?: string })?.adapter_capability) === "local.file.copy", "gateway capability");
    assert(existsSync(join(WRITABLE, COPY_NAME)), "copy must exist after approve");
  });

  await check("J. Result view reflects actual execution evidence", async () => {
    const rows = listActivityViewRows(`work-i-${STAMP}`);
    assert(rows.some((row) => row.result === "COMPLETED" || row.event === "WORK_COMPLETED" || row.event === "RESOURCE_COPIED"), JSON.stringify(rows.slice(-3)));
    const opened = openOwnerReviewView({
      work_id: `work-i-${STAMP}`, ai_client_id: AI, session_id: SESSION, view_type: "ACTIVITY_VIEW_V1",
    });
    const traced = await applyOwnerReviewDecision({
      review_id: opened.review_id, decision: "VIEW_EVIDENCE", ai_client_id: AI, session_id: SESSION,
    });
    assert(!("ok" in traced), JSON.stringify(traced));
    if ("ok" in traced) return;
    const evidence = traced.result as { evidence?: { executions?: unknown[] } };
    assert(Array.isArray(evidence.evidence?.executions), "evidence executions");
  });

  await check("K. UI launcher discovery grants no authority", () => {
    const items = listLauncherItems(AI, SESSION, `work-k-${STAMP}`);
    assert(items.length > 0, "launcher populated");
    assert(items.every((item) => item.grants_authority === false), "discovery is not authority");
    assert(items.some((item) => item.kind === "FILES"), "files");
    assert(items.some((item) => item.kind === "GITHUB" || item.label === "github"), "github listed");
    assert(items.some((item) => item.lifecycle === "UNAVAILABLE" || item.kind === "REMOTE_SERVICE"), "unavailable remotes");
  });

  await check("L. UI action availability matches actual capability binding", () => {
    const files = actionsAvailableForView("FILE_LIST_V1", { ai_client_id: AI, session_id: SESSION, work_id: `work-l-${STAMP}` });
    assert(files.includes("READ") && files.includes("COPY") && files.includes("MOVE") && files.includes("DELETE"), JSON.stringify(files));
    const email = actionsAvailableForView("EMAIL_VIEW_V1", { ai_client_id: AI, session_id: SESSION, work_id: `work-l-${STAMP}` });
    assert(!email.includes("SEND"), `email actions ${JSON.stringify(email)}`);
    const github = actionsAvailableForView("APP_RESOURCE_VIEW_V1", {
      ai_client_id: AI, session_id: SESSION, work_id: `work-l-${STAMP}`,
      source_resource_ids: ["service://github/source-authority"],
    });
    assert(github.includes("READ"), JSON.stringify(github));
    assert(!github.includes("COMMIT") && !github.includes("PUSH"), JSON.stringify(github));
  });

  await check("M. Evidence can trace displayed result to work/execution/resource", () => {
    const activity = renderActivityView(`work-i-${STAMP}`);
    assert(activity.view_type === "ACTIVITY_VIEW_V1", activity.view_type);
    assert(activity.source_resource_ids.includes("work:work-i-" + String(STAMP)) || activity.source_resource_ids[0]?.includes("work-i-"), JSON.stringify(activity.source_resource_ids));
  });

  await check("N. Registered templates, fallback view, and no legal claim", () => {
    assert(REGISTERED_VIEW_TYPES.includes("SAFE_GENERIC_VIEW"), "safe generic");
    const unknown = normalizeAiOutputToCanonicalView({ view_type: "AI_FANCY_DASHBOARD" });
    assert(unknown.ok && unknown.view.view_type === "SAFE_GENERIC_VIEW", JSON.stringify(unknown));
    const invoice = getDocumentTemplate("fixture.invoice.v1");
    assert(invoice !== null && invoice.legal_correctness_claimed === false, "no legal claim");
    assert(Object.values(DOCUMENT_TEMPLATES).every((row) => row.legal_correctness_claimed === false), "all fixtures unsigned");
    assert(notesBefore === readFileSync(NOTES, "utf8"), "unmanaged notes unchanged");
  });

  if (existsSync(join(WRITABLE, COPY_NAME))) unlinkSync(join(WRITABLE, COPY_NAME));

  console.log(`canonical-view proofs: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

void main();
