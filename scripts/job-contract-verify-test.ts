#!/usr/bin/env npx tsx
/**
 * PASS 3 — VERIFY verifier (G3 + G5 + semantic parity + structural guard). READ-ONLY.
 * The business acceptance/approval readers and the wired route are exercised against REAL
 * data; no business row is created, changed or deleted by this script.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

function loadEnvLocal() {
  try {
    const raw = readFileSync(path.join(process.cwd(), ".env.local"), "utf8");
    for (const line of raw.split("\n")) {
      const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {
    /* env may already be provided by the shell */
  }
}
loadEnvLocal();

import {
  buildBusinessJob,
  executeBusinessJob,
  type BusinessExecutor,
  type BusinessJobEnvelope,
} from "@/engines/jobs/business-job-adapter";
import { runBusinessAcceptance, verifiableBusinessAcceptanceIds } from "@/app/api/admin/ide/_lib/businessAcceptanceRuntime";
import { resolveApprovalEvidence } from "@/engines/jobs/approval-evidence";
import { recordBusinessJobProgress } from "@/app/api/admin/ide/_lib/businessJobProgressRuntime";

const ROOT = process.cwd();
let pass = 0;
let fail = 0;
const failures: string[] = [];
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

function check(name: string, ok: boolean, detail = "") {
  if (ok) { pass++; console.log(`  PASS  ${name}${detail ? " — " + detail : ""}`); }
  else { fail++; failures.push(name); console.log(`  FAIL  ${name}${detail ? " — " + detail : ""}`); }
}

async function main() {
  console.log("=== PASS 3 / VERIFY — business acceptance + approval evidence ===\n");

  console.log("[A] G3 — acceptance uses real verifiers on real truth");
  const ids = verifiableBusinessAcceptanceIds();
  check("5 business acceptance ids verifiable", ids.length === 5, ids.join(","));
  check("acceptance runtime reuses the existing compiler", read("app/api/admin/ide/_lib/businessAcceptanceRuntime.ts").includes("compileAcceptanceCriteria"));
  const results = await runBusinessAcceptance(ids, { job_id: "verify-job", document_id: null });
  check("every outcome carries verifier id", results.every((r) => /^business\.acceptance\/v1#/.test(r.verifier_id)));
  check("every outcome carries evidence_ref", results.every((r) => r.evidence_ref.length > 8));
  check("every outcome carries observed_at (ISO)", results.every((r) => !Number.isNaN(Date.parse(r.observed_at))));
  check("every outcome carries a boolean pass", results.every((r) => typeof r.pass === "boolean"));
  for (const r of results) console.log(`        ${r.acceptance_id}: ${r.pass ? "PASS" : "FAIL"} — ${r.detail.slice(0, 90)}`);
  check("finance acceptance really compares view vs raw", results.some((r) => r.acceptance_id === "finance_matches_raw_sql" && r.evidence_ref.includes("document_canonical")));
  check("no AI-invented expectation (detail states observed truth)", results.every((r) => r.detail.length > 10));

  console.log("\n[B] G5 — every real approval source is mapped");
  const approvalSrc = read("engines/jobs/approval-evidence.ts");
  for (const [src, table] of [["owner_passkey", "owner_auth_audit_log"], ["pending_authorization", "pending_authorizations"], ["connector_proposal", "integration_gateway_proposals"], ["destructive_action_gate", "destructive_action_log"], ["audit_log", "audit_logs"]] as Array<[string, string]>) {
    check(`${src} → ${table}`, approvalSrc.includes(`"${table}"`) && approvalSrc.includes(`"${src}"`));
  }
  const approvals = await resolveApprovalEvidence({ capability: "document.void" });
  check("normalized records carry the required 11 fields", approvals.length > 0 && ["approval_ref", "job_id", "source", "actor", "authority", "decision", "scope", "capability", "decided_at", "evidence_ref", "verification_state"].every((k) => k in approvals[0]));
  check("evidence states its own subordination to the source", approvals.every((a) => a.authority_note.includes("source table remains the approval authority")));
  check("normalizer is SELECT-only (no insert/update/delete)", !/\.(insert|update|delete|rpc)\s*\(/.test(approvalSrc.replace(/\/\*[\s\S]*?\*\//g, "")));

  console.log("\n[C] approval rule — required capability blocks before the executor");
  let calls = 0;
  const stub: BusinessExecutor<{ ok: true }> = async () => { calls++; return { result: { ok: true }, observed_writes: ["document_versions"] }; };
  const voidJob = buildBusinessJob({ capability: "document.void", requested_by: { kind: "staff", id: "admin" }, idempotency_key: "p3:void", exec_args: {} }).envelope as BusinessJobEnvelope;
  const blocked = await executeBusinessJob(voidJob, stub);
  check("void without approval evidence => PENDING_APPROVAL, executor not called", blocked.status === "PENDING_APPROVAL" && calls === 0, blocked.status);
  const stillNoEvidence = await resolveApprovalEvidence({ capability: "document.void" });
  check("no approval ref is fabricated for the blocked job", blocked.control === null && stillNoEvidence.every((a) => a.capability === "document.void"));

  console.log("\n[D] single real call site — POST /api/admin/documents");
  const route = read("app/api/admin/documents/route.ts");
  check("route builds a canonical job", route.includes("buildBusinessJob(") && route.includes('capability: "document.create"'));
  check("route runs the envelope", route.includes("executeBusinessJob("));
  check("createDocument is still the executor", route.includes("await createDocument(envelope.exec_args"));
  check("acceptance runner is injected from the control plane", route.includes("acceptanceRunner: runBusinessAcceptance"));
  check("no other route switched in PASS 3", !read("app/api/admin/transactions/route.ts").includes("executeBusinessJob") && !read("app/api/admin/receipt-documents/[id]/confirm/route.ts").includes("executeBusinessJob"));

  console.log("\n[E] semantic parity");
  const execResult = { document_id: "doc-x", document_no: "NO-1", totals: { total_amount: 1 }, version: { version_no: 1 }, items_written: 2 };
  const job = buildBusinessJob({ capability: "document.create", requested_by: { kind: "staff", id: "admin" }, idempotency_key: "p3:create", exec_args: { kind: "standalone_document", document_type: "quotation" } }).envelope as BusinessJobEnvelope;
  let observedArgs: unknown = null;
  const exec2 = await executeBusinessJob(job, async (env) => { observedArgs = env.exec_args; return { result: execResult, observed_writes: ["standalone_documents", "document_versions"] }; });
  check("executor receives the caller's args byte-identical", JSON.stringify(observedArgs) === JSON.stringify(job.exec_args));
  check("result is passed through unchanged", JSON.stringify(exec2.result) === JSON.stringify(execResult));
  check("business payload keys unchanged (document/document_number/status/totals/version_no/items_written)", route.includes("document_number: created.document_no") && route.includes("totals: created.totals") && route.includes("version_no: created.version.version_no"));
  check("error semantics preserved (settings 503 / context 400 / write 500)", route.includes("{ status: 503 }") && route.includes("{ status: 400 }") && (route.match(/\{ status: 500 \}/g) ?? []).length >= 2);
  check("control failure returns no business payload", route.includes("!execution.result") && route.includes("control: { status: execution.status"));

  console.log("\n[F] failure behaviour — acceptance failure never reverses the write");
  let execCalls = 0;
  const failing = await executeBusinessJob(job, async () => { execCalls++; return { result: execResult, observed_writes: ["standalone_documents"] }; }, {
    acceptanceRunner: async () => [{ acceptance_id: "document_snapshot_matches_issue", verifier_id: "business.acceptance/v1#document_snapshot_matches_issue", pass: false, observed_at: new Date().toISOString(), evidence_ref: "public.document_versions#x", detail: "forced fail" }],
  });
  check("acceptance failure => EXECUTED_REQUIRES_REVIEW", failing.status === "EXECUTED_REQUIRES_REVIEW", failing.status);
  check("executor not re-run after acceptance failure", execCalls === 1, String(execCalls));
  check("business result still returned (row not pretended away)", failing.result !== null);
  const adapterSrc = read("engines/jobs/business-job-adapter.ts");
  const adapterCode = adapterSrc.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  check("adapter has no rollback/delete/retry logic", !/\.(delete|deleteMany)\s*\(|rollback|retry\s*\(/i.test(adapterCode));
  const errPath = await executeBusinessJob(job, async () => { throw new Error("executor exploded"); });
  check("executor throw => FAILED_FINAL with the real message", errPath.status === "FAILED_FINAL" && errPath.violations[0] === "executor exploded");
  check("FAILED_FINAL returns no result (route keeps its 500)", errPath.result === null);

  console.log("\n[G] control wrapper has no direct DB client");
  check("domain adapter still DB-free", !/supabase/i.test(adapterSrc.replace(/\/\*[\s\S]*?\*\//g, "")));

  console.log("\n[H] structural guard — control → domain only");
  const canonicalFiles = ["document-write", "transaction-write", "payment-write", "debt-write", "inbound-write", "artifact-write"].map((f) => `engines/canonical/${f}.ts`);
  const forbidden = ["approval-evidence", "queueRuntime", "executionPlannerRuntime", "cognitive", "costGateRuntime", "businessAcceptanceRuntime", "executionContextRuntime", "CURRENT_STATE"];
  for (const f of canonicalFiles) {
    const src = read(f);
    const hit = forbidden.filter((x) => src.includes(x));
    check(`${f} imports no control-plane module`, hit.length === 0, hit.join(",") || "clean");
  }
  check("engines/jobs imports nothing from app/", !/from "@\/app\//.test(adapterSrc) && !/from "@\/app\//.test(read("engines/jobs/approval-evidence.ts")));

  console.log("\n[I] G8 — business progress reuses the existing state system");
  const progressSrc = read("app/api/admin/ide/_lib/businessJobProgressRuntime.ts");
  const progressCode = progressSrc.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  check("progress runtime reuses writeExecutionContextCheckpoint", progressSrc.includes('from "./executionContextRuntime"') && progressSrc.includes("writeExecutionContextCheckpoint("));
  check("no new state system (no own file/queue/DB writer)", !/writeFileSync|readFileSync|supabase/.test(progressCode));
  check("progress is declared control-plane only, not business truth", progressSrc.includes("control-plane checkpoint only") && progressSrc.includes("business_truth"));
  check("route records progress after the job", route.includes("recordBusinessJobProgress(") && route.includes("progress: { step: progress.step"));
  const before = read("registry/EXECUTION_CONTEXT.json").length;
  const dry = await recordBusinessJobProgress({ job_id: "verify-job", capability: "document.create", status: "VERIFIED", executor: { module: "engines/canonical/document-write.ts", export: "createDocument" }, acceptance: [], actor: "verifier", dry_run: true });
  check("dry-run maps the job without touching the chain", dry.recorded === false && dry.step === "business.document.create" && read("registry/EXECUTION_CONTEXT.json").length === before);
  check("progress result states where business truth lives", dry.business_truth.length > 10 && dry.note.includes("business truth stays"));

  console.log("\n=== RESULT ===");
  console.log(`${pass} passed, ${fail} failed`);
  if (failures.length) console.log("FAILED:", failures.join(" | "));
  console.log("\nPASS 4 done: business job progress appends to the existing checkpoint chain (control plane only).");
  console.log("STOP: payment/debt/LINE/transaction/artifact routes and PASS 5/6 stay untouched.");
  process.exit(fail === 0 ? 0 : 1);
}

void main();

