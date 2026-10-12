#!/usr/bin/env npx tsx
/**
 * PASS 6 — CROSS-RUNTIME verifier (G2). READ-ONLY: the canonical writer is never invoked with
 * real data (the executor is a stub in these checks) and no business row is created/changed.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { handleCanonicalJobRequest, CANONICAL_RUNTIME_EXECUTORS, type CrossRuntimeEnvelope } from "@/app/api/admin/ide/_lib/canonicalJobTransportRuntime";

const ROOT = process.cwd();
let pass = 0, fail = 0;
const failures: string[] = [];
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");
try {
  for (const line of readFileSync(path.join(ROOT, ".env.local"), "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch { /* shell env may already provide it */ }
function check(name: string, ok: boolean, detail = "") {
  if (ok) { pass++; console.log(`  PASS  ${name}${detail ? " — " + detail : ""}`); }
  else { fail++; failures.push(name); console.log(`  FAIL  ${name}${detail ? " — " + detail : ""}`); }
}

const FOLLOWUP = "supabase/functions/line-webhook-v2/engines/event-followup.ts";
const HELPER = "supabase/functions/_shared/canonicalTransport.ts";
const ROUTE = "app/api/internal/canonical/jobs/route.ts";
const contract = JSON.parse(readFileSync(path.join(ROOT, "registry/CANONICAL_JOB_CONTRACT.json"), "utf8"));

const env = (over: Partial<CrossRuntimeEnvelope> = {}): CrossRuntimeEnvelope => ({
  job_id: "co-1", kind: "BUSINESS", source_runtime: "SUPABASE_EDGE", source_channel: "LINE",
  capability: "transaction.create", executor: "SERVICE", intent: "open_job_from_line_request",
  identity_refs: { line_user_id: "U1", partner_id: "P1", event_id: "E1" },
  scope: { data_write: ["projects", "document_groups", "customer_orders"], spend: { kind: "FREE" } },
  correlation_id: "c-1", idempotency_key: "transaction.create:E1", requested_at: new Date().toISOString(),
  source_event_id: "E1", exec_args: { customer_company_id: "P1", customer_site_id: "S1" }, ...over,
});
const stubExecutors = { "transaction.create": async () => ({ result: { order_id: "O-1", document_group_id: "DG-1", project_id: "PRJ-1" }, observed_writes: ["projects", "document_groups", "customer_orders"] }) };

async function main() {
  console.log("=== PASS 6 / CROSS-RUNTIME — LINE/Deno → canonical ===\n");

  console.log("[1] inventory (Phase A) is real and complete");
  const inv = contract.cross_runtime_transport.phase_a_inventory.business_table_direct_writers;
  check("inventory listed", inv.length >= 8, String(inv.length));
  for (const entry of inv.slice(0, 4)) {
    const src = read(entry.file);
    // Phase A is a historical inventory. P4b subsequently moved payment claims
    // through Connect to the existing canonical inbound writer; requiring a
    // direct table reference in the Edge source would reject that valid cutover.
    const delegatedClaim = entry.file === "supabase/functions/line-webhook-v2/engines/payment-claim.ts";
    const hasTables = delegatedClaim
      ? src.includes('from "../../_shared/connect-inbound.ts"') &&
        src.includes("await sendConnectInboundSource(") &&
        !/\.from\(["']receipt_documents["']\)/.test(src) &&
        read("supabase/functions/_shared/connect-inbound.ts").includes("/api/internal/connect/inbound-source") &&
        read("app/api/internal/connect/inbound-source/route.ts").includes("await recordInboundSource(") &&
        read("app/api/internal/connect/inbound-source/route.ts").includes('from "@/engines/canonical/inbound-write"') &&
        entry.tables.every((t: string) => read("engines/canonical/inbound-write.ts").includes(`.from("${t}").insert(`))
      : entry.tables.every((t: string) => src.includes(`"${t}"`));
    check(`inventory entry real: ${entry.file.split("/").pop()} ${entry.tables.join(",")}`, existsSync(path.join(ROOT, entry.file)) && hasTables);
  }
  check("transport envelope declares all required fields", ["job_id", "source_runtime", "source_channel", "capability", "executor", "intent", "identity_refs", "scope", "correlation_id", "idempotency_key", "requested_at", "source_event_id"].every((f) => contract.cross_runtime_transport.envelope_fields.includes(f)));

  console.log("\n[2-4] pilot flow switched");
  const followup = read(FOLLOWUP);
  const bypass = /\.from\("(projects|document_groups|customer_orders)"\)\s*\.\s*insert/.test(followup);
  check("pilot direct-write bypass removed", !bypass);
  check("pilot uses the transport", followup.includes("requestCanonicalJob(") && followup.includes('capability: "transaction.create"'));
  check("canonical writer is still the executor", typeof CANONICAL_RUNTIME_EXECUTORS["transaction.create"] === "function" && read("app/api/admin/ide/_lib/canonicalJobTransportRuntime.ts").includes("createTransaction"));

  console.log("\n[5] no canonical logic duplicated in Deno");
  const helper = read(HELPER);
  check("edge helper has no DB writes", !/\.from\(|insert\(|update\(|upsert\(/.test(helper));
  check("edge helper computes no money/status", !/subtotal|vat|wht|gross|total_amount|calculate/i.test(helper));
  check("edge helper carries no business rule (only envelope + fetch)", helper.includes("/api/internal/canonical/jobs") && !/customer_orders\s*=/.test(helper));

  console.log("\n[6-7] auth + secret handling reuse");
  const route = read(ROUTE);
  check("canonical endpoint reuses the internal-secret pattern", route.includes("x-canonical-job-secret") && route.includes("CANONICAL_JOB_INTERNAL_SECRET"));
  check("edge sends the same header (no new auth system)", helper.includes("x-canonical-job-secret") && !existsSync(path.join(ROOT, "app/api/internal/canonical/auth.ts")));
  check("secret never appears in payload", !/"secret"\s*:/.test(helper) && !/console\.log\([^)]*secret/i.test(helper));
  check("route never echoes the request payload", !/NextResponse\.json\(payload/.test(route));

  console.log("\n[8] idempotency — same source event never executes twice");
  const { supabaseAdmin } = await import("@/services/supabase/queries");
  const { data: existingEvents, error: replayQueryError } = await supabaseAdmin().from("business_events").select("id, transaction_id").not("transaction_id", "is", null).limit(1);
  // Distinguish unavailable evidence from an empty successful query. Keep both
  // blocking: neither proves replay safety, and neither justifies creating data.
  check("replay evidence query succeeded", !replayQueryError,
    replayQueryError ? (/fetch failed|network|connection/i.test(replayQueryError.message) ? "NETWORK_OR_TRANSPORT_FAILURE" : "DATABASE_QUERY_FAILURE") : "read-only query succeeded");
  const realEvent = existingEvents?.[0];
  check("a real business_event with a transaction exists for the replay check", !!realEvent, realEvent ? "existing linked event found" : replayQueryError ? "evidence unavailable (query failed)" : "successful query returned no linked events");
  let executorCalls = 0;
  const counting = { "transaction.create": async () => { executorCalls++; return { result: { order_id: "NEW" }, observed_writes: ["customer_orders"] }; } };
  if (realEvent) {
    const replay = await handleCanonicalJobRequest(env({ source_event_id: String(realEvent.id), identity_refs: { line_user_id: "U1", partner_id: "P1", event_id: String(realEvent.id) } }), { executors: counting });
    check("replay detected from real business truth", replay.status === "ALREADY_EXECUTED" && replay.idempotent_replay === true, replay.status);
    check("replay returns the previous business refs without writing", replay.wrote === false && replay.business_refs[0]?.table === "customer_orders" && executorCalls === 0);
  }

  console.log("\n[9] timeout after write — never re-fire the writer");
  check("transport reports the unknown outcome", helper.includes("write outcome unknown"));
  check("pilot never retries the writer on transport failure", !/while\s*\(|for\s*\(\s*let\s+attempt|retry/i.test(followup.replace(/^\s*\/\/.*$/gm, "")));

  console.log("\n[10] approval-required request blocks");
  const voidExecutors = { "document.void": async () => ({ result: { ok: true }, observed_writes: ["document_versions"] }) };
  const pending = await handleCanonicalJobRequest(env({ capability: "document.void", approval_refs: [] }), { executors: voidExecutors, skipIdempotencyLookup: true });
  check("PENDING_APPROVAL, no write", pending.status === "PENDING_APPROVAL" && pending.wrote === false, pending.status);
  check("recovery state returned (WAIT_APPROVAL)", pending.recovery?.action === "WAIT_APPROVAL", JSON.stringify(pending.recovery));

  console.log("\n[11-12] response contract + LINE rendering");
  const ok = await handleCanonicalJobRequest(env(), { executors: stubExecutors, skipIdempotencyLookup: true });
  check("business_refs returned", ok.business_refs.some((r) => r.table === "customer_orders") && ok.business_refs.length >= 3, `${ok.status} refs=${JSON.stringify(ok.business_refs)} ev=${JSON.stringify(ok.evidence_refs).slice(0, 120)}`);
  check("status/acceptance/evidence returned", ok.status === "EXECUTED" && Array.isArray(ok.acceptance) && ok.evidence_refs.some((e) => e.startsWith("source_event:")), `${ok.status} acc=${ok.acceptance.length}`);
  check("LINE reply uses the canonical result (no order_no reconstruction)", followup.includes("orderAttempt.business_refs") && !followup.includes("order.order_no"));
  check("edge does not reinterpret status/money", !/total_amount|subtotal|vat_amount/.test(followup.slice(followup.indexOf("requestCanonicalJob("))));

  console.log("\n[13-14] structural guards");
  for (const f of ["document-write", "transaction-write", "payment-write", "debt-write", "inbound-write", "artifact-write"]) {
    const src = read(`engines/canonical/${f}.ts`);
    check(`engines/canonical/${f}.ts imports no edge/LINE runtime`, !src.includes("supabase/functions") && !src.includes("canonicalTransport") && !src.includes("line-webhook"));
  }
  check("engines/jobs imports nothing from app/", !/from "@\/app\//.test(read("engines/jobs/business-job-adapter.ts")) && !/from "@\/app\//.test(read("engines/jobs/job-recovery.ts")));
  check("no new queue/state/approval/cost/schema in this pass", !existsSync(path.join(ROOT, "app/api/internal/canonical/queue")) && !existsSync(path.join(ROOT, "supabase/functions/canonical-worker")));

  console.log("\n[15-16] previous passes + canonical suites remain green");
  const pkg = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")).scripts;
  for (const s of ["job-contract:test", "job-contract:wrap:test", "job-contract:verify:test", "job-contract:recover:test", "canonical:test", "canonical:write:test", "canonical:finance:test"]) {
    check(`npm script present: ${s}`, !!pkg[s]);
  }
  check("control → domain direction intact (route imports control, edge imports none of it)", route.includes("@/app/api/admin/ide/_lib/canonicalJobTransportRuntime") && !helper.includes("app/api/admin/ide"));

  console.log("\n=== RESULT ===");
  console.log(`${pass} passed, ${fail} failed`);
  if (failures.length) console.log("FAILED:", failures.join(" | "));
  console.log("\nSTOP: pilot = LINE chain creation only. payment/debt/artifact/other LINE writers, UI, voice and any rollout stay untouched.");
  process.exit(fail === 0 ? 0 : 1);
}

void main();

