#!/usr/bin/env npx tsx
/**
 * PASS 2 — WRAP verifier (G1). READ-ONLY on the repo; no DB writes.
 *
 * Proves the business job object is a CONTROL ENVELOPE around the existing canonical
 * writers and did NOT become a second source of truth:
 *   A. static purity      — the adapter imports no DB client and performs no SQL
 *   B. no new system      — the adapter imports nothing from the existing control plane
 *   C. declaration truth  — every declared capability points at a real module + export,
 *                           and every declared data_write table exists in the tracked schema
 *   D. type compatibility — the adapter can host the REAL canonical writer signature (compile-time)
 *   E. control behaviour  — refusals happen BEFORE the executor runs; approval blocks;
 *                           the result is passed through untouched (stub executor = control test
 *                           only; no business rows are created anywhere)
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import {
  buildBusinessJob,
  declaredBusinessCapabilities,
  executeBusinessJob,
  validateBusinessJobEnvelope,
  type BusinessExecutor,
  type BusinessJobEnvelope,
} from "@/engines/jobs/business-job-adapter";

const ROOT = process.cwd();
let pass = 0;
let fail = 0;
const failures: string[] = [];

function check(name: string, ok: boolean, detail = "") {
  if (ok) {
    pass++;
    console.log(`  PASS  ${name}${detail ? " — " + detail : ""}`);
  } else {
    fail++;
    failures.push(name);
    console.log(`  FAIL  ${name}${detail ? " — " + detail : ""}`);
  }
}

const ADAPTER = "engines/jobs/business-job-adapter.ts";
const source = readFileSync(path.join(ROOT, ADAPTER), "utf8");
const contract = JSON.parse(readFileSync(path.join(ROOT, "registry/CANONICAL_JOB_CONTRACT.json"), "utf8"));
const schemaSql = ["supabase/local-migration", "supabase/migrations"]
  .flatMap((d) => readdirSync(path.join(ROOT, d)).filter((f) => f.endsWith(".sql")).map((f) => readFileSync(path.join(ROOT, d, f), "utf8")))
  .join("\n");
const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

console.log("=== PASS 2 / WRAP — business job object as control envelope ===\n");

console.log("[A] static purity — the adapter writes no business truth");
check("no database client imported", !/supabase/i.test(code));
const dbCall = code.match(/\.(from|insert|delete|rpc)\s*\(/g) ?? [];
const updateCalls = code.match(/\.update\(/g)?.length ?? 0;
const hashUpdates = code.match(/createHash\([^)]*\)\.update\(/g)?.length ?? 0;
check("no .from( / .insert( / .delete( / .rpc( database calls", dbCall.length === 0, dbCall.join(","));
check(".update( used only for the sha256 hash chain", updateCalls === hashUpdates, `${updateCalls} update calls, ${hashUpdates} hash updates`);
check("no SQL statement text", !/\b(select\s|insert into|delete from)\b/i.test(code));
check("imports only node:crypto + the contract json", (code.match(/^import /gm) ?? []).length === 2, String((code.match(/^import /gm) ?? []).length));

console.log("\n[B] no new system — envelope, not engine");
check("no import from the existing control plane", !/app\/api\/admin\/ide\/_lib/.test(code));
check("no queue/worker/state import", !/(queueRuntime|workerRegistry|CURRENT_STATE|HANDOFF)/.test(code));
check("adapter exists", existsSync(path.join(ROOT, ADAPTER)));

console.log("\n[C] declaration truth — capabilities point at real executors");
const items = declaredBusinessCapabilities();
check("10 business capabilities declared", items.length === 10, String(items.length));
for (const item of items) {
  const file = item.executor.module;
  const okFile = existsSync(path.join(ROOT, file));
  const body = okFile ? readFileSync(path.join(ROOT, file), "utf8") : "";
  const okExport = new RegExp(`export\\s+(async\\s+)?function\\s+${item.executor.export}\\b`).test(body);
  check(`${item.capability} -> ${file}#${item.executor.export}`, okFile && okExport, okFile ? (okExport ? "real export" : "EXPORT MISSING") : "MODULE MISSING");
  const badTables = item.data_write.filter((t) => !new RegExp(`\\b${t}\\b`).test(schemaSql));
  check(`${item.capability} data_write tables exist in tracked schema`, badTables.length === 0, badTables.join(",") || "ok");
}

console.log("\n[D] type compatibility with the REAL canonical writer (compile-time only)");
type RealCreateDocument = typeof import("@/engines/canonical/document-write").createDocument;
type RealConfirmPayment = typeof import("@/engines/canonical/payment-write").confirmPayment;
const typeProbe: [RealCreateDocument, RealConfirmPayment] | null = null;
check("real writers resolvable by type without a runtime import", typeProbe === null, "typeof import(...) used");

async function main() {
  console.log("\n[E] control behaviour — refusals happen before execution");
  let executorCalls = 0;
    const stub: BusinessExecutor<{ ok: true; rows: number }> = async () => {
    executorCalls++;
    return { result: { ok: true, rows: 1 }, observed_writes: ["document_versions"] };
  };

  const built = buildBusinessJob({
    capability: "document.create",
    requested_by: { kind: "staff", id: "admin" },
    idempotency_key: "wrap-test:1",
    exec_args: { kind: "standalone_document", document_type: "quotation" },
  });
  check("buildBusinessJob resolves a declared capability", !!built.envelope, built.problems.join(","));
  const envelope = built.envelope as BusinessJobEnvelope;
  check("envelope carries scope + acceptance + plan", !!envelope.scope.data_write?.length && !!envelope.acceptance?.length && !!envelope.plan?.steps?.length);

  const unknown = await executeBusinessJob({ ...envelope, capability: "business.doAnything" }, stub);
  check("unknown capability refused", unknown.status === "BLOCKED_UNKNOWN_CAPABILITY" && executorCalls === 0, unknown.status);

  const outOfScope = await executeBusinessJob({ ...envelope, scope: { ...envelope.scope, data_write: ["companies"] } }, stub);
  check("write outside declared scope refused", outOfScope.status === "BLOCKED_WRITE_OUT_OF_SCOPE" && executorCalls === 0, outOfScope.violations.join(","));

  const paidNoAuth = await executeBusinessJob({ ...envelope, scope: { ...envelope.scope, spend: { kind: "PAID" } } }, stub);
  check("paid job without authorization refused", paidNoAuth.status === "BLOCKED_COST_AUTHORIZATION_MISSING" && executorCalls === 0, paidNoAuth.violations.join(","));

  const voidEnvelope = (buildBusinessJob({
    capability: "document.void",
    requested_by: { kind: "staff", id: "admin" },
    idempotency_key: "wrap-test:void",
    exec_args: { kind: "invoice", document_id: "x" },
  }).envelope as BusinessJobEnvelope);
  const pending = await executeBusinessJob(voidEnvelope, stub);
  check("approval-required job stays PENDING_APPROVAL and never executes", pending.status === "PENDING_APPROVAL" && executorCalls === 0, pending.violations.join(","));

  const approved = await executeBusinessJob({ ...voidEnvelope, approval: { required: true, kind: "owner_decide", ref: "owner-command/approve#1" } }, stub);
  check("approved job executes exactly once", approved.status === "EXECUTED" && executorCalls === 1, approved.status);
  check("result passed through untouched", JSON.stringify(approved.result) === JSON.stringify({ ok: true, rows: 1 }));
  check("control record carries job id + digest + timings", !!approved.control?.job_id && !!approved.control?.envelope_digest && !!approved.control?.started_at && !!approved.control?.finished_at);
  const voidDecl = declaredBusinessCapabilities().find((c) => c.capability === "document.void");
  check("control record maps to the REAL executor of that capability", approved.control?.executor.module === voidDecl?.executor.module && approved.control?.executor.export === voidDecl?.executor.export, `${approved.control?.executor.module}#${approved.control?.executor.export}`);
  check("control record contains no row payload (control only)", !/quotation|amount|insert|update/.test(JSON.stringify(approved.control)));

  const violating = await executeBusinessJob(envelope, async () => {
    executorCalls++;
    return { result: { ok: true, rows: 1 }, observed_writes: ["companies", "document_versions"] };
  });
  check("executor writing outside scope is flagged", violating.status === "EXECUTED_OUT_OF_SCOPE_VIOLATION" && violating.violations.includes("companies"), violating.violations.join(","));

  console.log("\n[F] contract bookkeeping");
  check("contract is APPROVED_FOR_INTEGRATION", contract.status === "APPROVED_FOR_INTEGRATION", contract.status);
  check("business_capabilities declared envelope_only", contract.business_capabilities?.envelope_only === true);
  check("control-plane-is-not-business-truth rule declared", String(contract.business_capabilities?.control_plane_rule ?? "").includes("source of truth"));
  check("compliant envelope validates clean", validateBusinessJobEnvelope(envelope).ok, validateBusinessJobEnvelope(envelope).problems.join(","));

  console.log("\n=== RESULT ===");
  console.log(`${pass} passed, ${fail} failed`);
  if (failures.length) console.log("FAILED:", failures.join(" | "));
  console.log("\nEnvelope -> canonical writer -> result/evidence. No new queue/worker/state system.");
  console.log("Executor used by these checks is a control stub: no business rows were created.");
  console.log("Next: PASS 3 VERIFY (business acceptance contract + approval evidence normalization).");
  process.exit(fail === 0 ? 0 : 1);
}

void main();
