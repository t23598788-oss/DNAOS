/**
 * B-04R3 — canonical payment RPC adapter tests (F1–F8).
 *
 * The adapter is the only place that turns a business request into one atomic RPC
 * call. These tests drive the REAL writer (confirmPayment / reallocatePayment) with a
 * recording client so that:
 *   · the RPC payload semantics are asserted exactly (no paid/outstanding/company/
 *     status, actor always the one passed in, anchor carried as an event type only),
 *   · any attempt to write a monetary row outside the RPC fails the test loudly
 *     (the recording client throws on insert/update/upsert/delete for every table),
 *   · every RPC failure propagates as a deterministic canonical PAYMENT_* error and
 *     never falls back to a direct write (F1/F2/D-state = fail closed).
 *
 * What this does NOT prove: the end-to-end HTTP hop through PostgREST. The canonical
 * writer talks to Supabase over HTTP (supabase-js) and this environment has a plain
 * local Postgres cluster but NO PostgREST/GoTrue, so TS→RPC→real-DB integration is
 * reported as BLOCKED_LOCAL_POSTGREST rather than faked.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  confirmPayment,
  reallocatePayment,
  mapPaymentRpcError,
  __setPaymentWriteClientForTest,
} from "../engines/canonical/payment-write";

const ROOT = join(__dirname, "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf-8");
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

const RECEIPT = "b4000000-0000-4000-8000-000000000001";
const INVOICE = "a4000000-0000-4000-8000-000000000001";
const COMPANY = "c4000000-0000-4000-8000-000000000001";

type RpcCall = { name: string; params: Record<string, unknown> };
type Mode = "ok" | "missing" | "denied" | "overpay" | "company" | "void";

/** A client that records RPC calls and THROWS on any table write (no direct path). */
function recordingClient(mode: Mode, calls: RpcCall[]) {
  const writeAttempts: string[] = [];
  const table = (name: string) => {
    const rows: Record<string, Record<string, unknown>> = {
      receipt_documents: { id: RECEIPT, status: "ai_read", document_type: "transfer_slip", amount: 50000, customer_company_id: COMPANY, matched_debt_event_id: null, media_path: "local:adapter.jpg" },
      payment_allocations: { id: "alloc-1", amount: 20000, allocation_kind: "principal", receipt_document_id: RECEIPT, invoice_id: null, debt_event_id: "de-1" },
      invoice_payment_summary: { invoice_id: INVOICE, outstanding: 100000, derived_status: "SENT" },
      invoices: { id: INVOICE, customer_company_id: COMPANY, invoice_status: mode === "void" ? "VOID" : "SENT" },
      debt_snapshots: { customer_company_id: COMPANY, total_outstanding: 50000 },
    };
    const builder: Record<string, unknown> = {};
    const chain = () => builder;
    builder.select = chain;
    builder.eq = chain;
    builder.in = chain;
    builder.order = chain;
    builder.limit = chain;
    builder.maybeSingle = async () => ({ data: rows[name] ?? null, error: null });
    builder.single = async () => ({ data: rows[name] ?? null, error: null });
    for (const op of ["insert", "update", "upsert", "delete"]) {
      builder[op] = () => {
        writeAttempts.push(`${name}.${op}`);
        throw new Error(`DIRECT_WRITE_ATTEMPTED: ${name}.${op} — the RPC owns the commit`);
      };
    }
    return builder;
  };
  const rpc = async (name: string, params: Record<string, unknown>) => {
    calls.push({ name, params });
    if (mode === "missing") return { data: null, error: { message: "Could not find the function public.confirm_payment_allocation(p_actor, p_allocations, p_debt_event_anchor, p_receipt_document_id) in the schema cache" } };
    if (mode === "denied") return { data: null, error: { message: "permission denied for function confirm_payment_allocation" } };
    if (mode === "overpay") return { data: null, error: { message: "overpayment_not_allowed:120000>100000" } };
    if (mode === "company") return { data: null, error: { message: "company_mismatch" } };
    if (mode === "void") return { data: null, error: { message: "invoice_void" } };
    if (name === "reallocate_payment_allocation") {
      return { data: { allocation_id: params.p_allocation_id, amount: params.p_amount, target_kind: params.p_target_kind, target_id: params.p_target_id, receipt_allocation_state: "partial", receipt_allocated_total: 20000, invoices: [{ invoice_id: INVOICE, paid_amount: 20000, invoice_status: "PARTIALLY_PAID" }] }, error: null };
    }
    return {
      data: {
        receipt_document_id: RECEIPT,
        allocations_written: 1,
        allocation_ids: ["alloc-new-1"],
        debt_event_id: "de-1",
        receipt_allocation_state: "allocated",
        invoices: [{ invoice_id: INVOICE, paid_amount: 50000, invoice_status: "PARTIALLY_PAID" }],
      },
      error: null,
    };
  };
  return { client: { from: table, rpc }, writeAttempts };
}

const confirmInput = {
  receipt_document_id: RECEIPT,
  allocations: [{ target: { kind: "invoice" as const, id: INVOICE }, allocation_kind: "principal" as const, amount: 50000, note: "adapter" }],
  actor: "server:admin@dna-os.local",
};


async function testConfirmPath() {
  // F1 — RPC missing ⇒ fail closed, no direct write
  {
    const calls: RpcCall[] = [];
    const rec = recordingClient("missing", calls);
    __setPaymentWriteClientForTest(rec.client as never);
    await assert.rejects(() => confirmPayment(confirmInput), /PAYMENT_RPC_FAILED/, "F1 missing RPC must fail closed");
    assert.equal(rec.writeAttempts.length, 0, "F1 must not fall back to a direct write");
    assert.equal(calls.length, 1, "F1 must attempt the RPC exactly once");
  }
  // F2 — permission denied ⇒ fail closed
  {
    const calls: RpcCall[] = [];
    const rec = recordingClient("denied", calls);
    __setPaymentWriteClientForTest(rec.client as never);
    await assert.rejects(() => confirmPayment(confirmInput), /PAYMENT_RPC_FAILED: permission denied/, "F2 denied RPC must fail closed");
    assert.equal(rec.writeAttempts.length, 0, "F2 must not fall back to a direct write");
  }
  // F3 — invariant errors map to canonical PAYMENT_* errors
  for (const [mode, pattern] of [["overpay", /PAYMENT_OVERPAYMENT_NOT_ALLOWED/], ["company", /PAYMENT_COMPANY_MISMATCH/], ["void", /PAYMENT_INVOICE_VOID/]] as const) {
    const calls: RpcCall[] = [];
    const rec = recordingClient(mode, calls);
    __setPaymentWriteClientForTest(rec.client as never);
    await assert.rejects(() => confirmPayment(confirmInput), pattern, `F3 ${mode} must map to its canonical error`);
  }
  // F4 + F6 + F7 — success: contract preserved, no second write, payload carries no client authority
  {
    const calls: RpcCall[] = [];
    const rec = recordingClient("ok", calls);
    __setPaymentWriteClientForTest(rec.client as never);
    const out = await confirmPayment(confirmInput);
    assert.deepEqual(Object.keys(out).sort(), ["allocation_ids", "allocations_written", "debt_event_id", "receipt_document_id", "refreshed"], "F7 confirm contract keys must not change");
    assert.equal(out.allocations_written, 1, "F4 allocations_written must come from the RPC");
    assert.deepEqual(out.allocation_ids, ["alloc-new-1"], "F4 allocation ids must come from the RPC");
    assert.equal(out.refreshed.receipt_allocation_state, "allocated", "F4 receipt state must come from the RPC");
    assert.equal(rec.writeAttempts.length, 0, "F4 no monetary write may happen after the RPC");
    assert.equal(calls.length, 1, "F4 exactly one RPC call");
    const params = calls[0].params;
    assert.deepEqual(Object.keys(params).sort(), ["p_actor", "p_allocations", "p_debt_event_anchor", "p_receipt_document_id"], "F6 RPC payload must only carry the documented keys");
    for (const forbidden of ["outstanding", "paid_amount", "company_id", "invoice_status", "paid"]) {
      assert.equal(JSON.stringify(params).includes(`"${forbidden}"`), false, `F6 the RPC payload must not carry ${forbidden}`);
    }
    assert.equal(params.p_actor, confirmInput.actor, "F5 the actor must be exactly the server-supplied one");
    const allocs = params.p_allocations as Record<string, unknown>[];
    assert.equal(allocs[0].target_kind, "invoice", "F6 the allocation target kind must be forwarded");
    assert.equal(allocs[0].amount, 50000, "F6 the amount comes from the caller's allocation, never recomputed here");
  }
  // F5 — empty actor is refused before the RPC
  {
    const calls: RpcCall[] = [];
    const rec = recordingClient("ok", calls);
    __setPaymentWriteClientForTest(rec.client as never);
    await assert.rejects(() => confirmPayment({ ...confirmInput, actor: "  " }), /AUDIT_ACTOR_REQUIRED/, "F5 an empty actor must be refused");
    assert.equal(calls.length, 0, "F5 no RPC call without an actor");
  }
}

async function testReallocatePath() {
  // F8 — reallocation contract preserved + anchor target refused client-side
  const calls: RpcCall[] = [];
  const rec = recordingClient("ok", calls);
  __setPaymentWriteClientForTest(rec.client as never);
  const out = await reallocatePayment({ allocation_id: "alloc-1", new_target: { kind: "invoice", id: INVOICE }, actor: "server:admin", reason: "adapter test" });
  assert.deepEqual(Object.keys(out).sort(), ["allocation_id", "amount", "debt_event_id", "invoice_id", "standalone_document_id"], "F8 reallocate contract keys must not change");
  assert.equal(out.invoice_id, INVOICE, "F8 the destination invoice must be reflected");
  assert.equal(out.debt_event_id, null, "F8 the stale debt_event_id must be cleared");
  assert.equal(rec.writeAttempts.length, 0, "F8 no monetary write may happen after the RPC");
  assert.equal(calls[0].name, "reallocate_payment_allocation", "F8 must call the reallocation RPC");
  assert.deepEqual(Object.keys(calls[0].params).sort(), ["p_actor", "p_allocation_id", "p_amount", "p_reason", "p_target_id", "p_target_kind"], "F8 RPC payload keys must be exact");
  await assert.rejects(() => reallocatePayment({ allocation_id: "a", new_target: { kind: "anchor" }, actor: "s", reason: "r" }), /PAYMENT_TARGET_ANCHOR_NOT_ALLOWED/, "F8 anchor target must be refused");
  await assert.rejects(() => reallocatePayment({ allocation_id: "a", new_target: { kind: "invoice", id: INVOICE }, actor: "s", reason: "  " }), /REALLOCATION_REASON_REQUIRED/, "F8 a reason is required");
}

function testErrorMapping() {
  // deterministic mapping, and anything unknown fails closed
  assert.ok(mapPaymentRpcError("overpayment_not_allowed:120>100").startsWith("PAYMENT_OVERPAYMENT_NOT_ALLOWED"));
  assert.ok(mapPaymentRpcError("P0001: receipt_total_exceeded:60000>50000").startsWith("PAYMENT_RECEIPT_TOTAL_EXCEEDED"));
  assert.ok(mapPaymentRpcError("company_mismatch").startsWith("PAYMENT_COMPANY_MISMATCH"));
  assert.ok(mapPaymentRpcError("receipt_already_allocated").startsWith("PAYMENT_ALREADY_ALLOCATED"));
  assert.ok(mapPaymentRpcError("permission denied for function").startsWith("PAYMENT_RPC_FAILED"));
  assert.ok(mapPaymentRpcError("").startsWith("PAYMENT_RPC_FAILED"));
}


function testAuthorityBoundaries() {
  const gateway = stripComments(read("gateway/actions.ts"));
  // B-04C: the gateway may READ payment_allocations (idempotency check) but must never write it
  assert.equal(/from\("payment_allocations"\)[\s\S]{0,60}?\.(insert|update|upsert|delete)\(/.test(gateway), false,
    "the gateway must not write payment_allocations");
  assert.equal(/rpc\("(confirm_payment_allocation|reallocate_payment_allocation)"/.test(gateway), false,
    "the gateway must not call the payment RPCs directly (the canonical writer owns that call)");
  assert.ok(gateway.includes('.from("debt_trackings")'), "B-05 executeDebtCreate must stay untouched (it is a separate round)");

  const auth = read("core/auth/session.ts");
  assert.ok(auth.includes("getAuthedUser"), "identity must keep coming from the single session reader");
  const confirmRoute = read("app/api/admin/receipt-documents/[id]/confirm/route.ts");
  assert.ok(confirmRoute.includes("actor: auth.email"), "the actor must stay server-derived (auth.email)");

  // the payment writer holds the business authority; the migration holds the commit
  const writer = stripComments(read("engines/canonical/payment-write.ts"));
  assert.ok(/rpc\("confirm_payment_allocation"/.test(writer) && /rpc\("reallocate_payment_allocation"/.test(writer), "both RPCs must be called from the canonical writer");
  const migrations = readdirSync(join(ROOT, "supabase/migrations")).filter((f) => f.endsWith(".sql"));
  // one line of authority: the original migration + superseding CREATE OR REPLACE
  // fixes (batch 35 principal-only anchor) — the LATEST definition is what runs
  const impls = migrations.filter((f) => read(`supabase/migrations/${f}`).includes("function public.confirm_payment_allocation")).sort();
  assert.ok(impls.length >= 1, "the DB commit implementation must live in a migration");
  for (const f of impls) {
    const sql = stripComments(read(`supabase/migrations/${f}`));
    assert.ok(sql.includes("security definer") && sql.includes("set search_path = public"),
      `every definition of the commit implementation must keep the security model: ${f}`);
  }
  const latestSql = stripComments(read(`supabase/migrations/${impls[impls.length - 1]}`));
  assert.ok(/a->>'allocation_kind' = 'principal'/.test(latestSql),
    "the active definition must book the anchor event from principal allocations only (batch 35)");
  return { impls: impls.map((f) => `supabase/migrations/${f}`) };
}

async function main() {
  testErrorMapping();
  await testConfirmPath();
  await testReallocatePath();
  const bounds = testAuthorityBoundaries();
  __setPaymentWriteClientForTest(null);

  console.log("payment-rpc-adapter:test PASS");
  console.log(
    `checks: F1 RPC missing → fail closed (no direct write) · F2 denied → fail closed · F3 invariant codes mapped · ` +
      `F4 success → no second write · F5 actor server-supplied only · F6 no outstanding/company/status in payload · ` +
      `F7 confirm contract unchanged · F8 reallocate contract unchanged · authority=engines/canonical/payment-write.ts (count=1) · ` +
      `db_commit_implementation=${bounds.impls.join(",")} (count=${bounds.impls.length})`,
  );
  console.log(
    "NOT_EXECUTED: TS→PostgREST→Postgres end-to-end (this environment has a plain local Postgres cluster but no PostgREST/GoTrue) — " +
      "reported as BLOCKED_LOCAL_POSTGREST; the SQL-level proof stays B-04R2 (DIRECT_RPC_TEST)",
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

