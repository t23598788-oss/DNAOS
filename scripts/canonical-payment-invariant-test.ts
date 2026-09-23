/**
 * Canonical payment invariant tests — B-04R (2026-09-23).
 *
 * Prereq for B-04C: payment-write.ts must enforce the owner's money policy BEFORE the
 * gateway is allowed to call it. These tests exercise the real exported guards
 * (no mocks, no DB writes — every helper below is pure), plus static checks that the
 * writer really uses them and that no new payment writer appeared anywhere.
 *
 * Owner policy locked in this file:
 *   · invoice overpayment is NOT allowed (never clamped, never turned into penalty/credit/another invoice)
 *   · Σ allocations of one receipt ≤ receipt.amount; moving money is not new money
 *   · receipt.company === invoice.company; VOID invoices are refused
 *   · one allocation row = exactly one target (DB CHECK) — no stale target ids after a move
 *
 * Coverage map (T = task item):
 *   T1 partial passes · T2 exact outstanding passes · T3 overpay fails · T4 company mismatch fails
 *   T5 VOID fails · T6 receipt total exceeded fails · T7 anchor→invoice clears debt_event_id
 *   T8 invoice→debt_event clears invoice_id · T9 invoice A→B leaves no stale id
 *   T10 reallocation does not increase the receipt total · T11 authority read from DB, never the caller
 *   T12 B-03 canonical read stays the source · T13 gateway untouched · T14 B-05 untouched
 *
 * DB-dependent behaviour (real inserts/updates, projection refresh) cannot run here:
 *   no local Postgres (docker is unavailable) and no service-role credential is available,
 *   so those are reported as NOT_EXECUTED instead of being claimed as passing.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  allocationTargetIds,
  assertInvoiceAllocationAllowed,
  assertReceiptAllocationTotal,
} from "../engines/canonical/payment-write";

const ROOT = join(__dirname, "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf-8");
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

const WRITER = "engines/canonical/payment-write.ts";

/** Runs fn and returns the thrown Error (or null when nothing was thrown). */
function thrownBy(fn: () => void): Error | null {
  try {
    fn();
    return null;
  } catch (e) {
    return e as Error;
  }
}

const COMPANY = "11111111-1111-1111-1111-111111111111";
const OTHER_COMPANY = "22222222-2222-2222-2222-222222222222";

function testInvoiceGuards() {
  // T1 · partial payment (40 of 100) is allowed
  assert.equal(
    thrownBy(() => assertInvoiceAllocationAllowed({ requestedAmount: 40, invoiceOutstanding: 100, invoiceStatus: "SENT", receiptCompanyId: COMPANY, invoiceCompanyId: COMPANY })),
    null,
    "T1 partial invoice payment must pass",
  );
  // T2 · exactly the outstanding amount is allowed
  assert.equal(
    thrownBy(() => assertInvoiceAllocationAllowed({ requestedAmount: 100, invoiceOutstanding: 100, invoiceStatus: "SENT", receiptCompanyId: COMPANY, invoiceCompanyId: COMPANY })),
    null,
    "T2 allocation equal to outstanding must pass",
  );
  // T3 · overpayment must fail closed (no clamp, no penalty)
  const over = thrownBy(() => assertInvoiceAllocationAllowed({ requestedAmount: 120, invoiceOutstanding: 100, invoiceStatus: "SENT", receiptCompanyId: COMPANY, invoiceCompanyId: COMPANY }));
  assert.ok(over && /PAYMENT_OVERPAYMENT_NOT_ALLOWED/.test(over.message), "T3 amount > outstanding must throw PAYMENT_OVERPAYMENT_NOT_ALLOWED");
  // T4 · company mismatch must fail closed
  const mismatch = thrownBy(() => assertInvoiceAllocationAllowed({ requestedAmount: 10, invoiceOutstanding: 100, invoiceStatus: "SENT", receiptCompanyId: COMPANY, invoiceCompanyId: OTHER_COMPANY }));
  assert.ok(mismatch && /PAYMENT_COMPANY_MISMATCH/.test(mismatch.message), "T4 receipt.company != invoice.company must throw PAYMENT_COMPANY_MISMATCH");
  // T5 · VOID invoice must fail closed
  const voided = thrownBy(() => assertInvoiceAllocationAllowed({ requestedAmount: 10, invoiceOutstanding: 100, invoiceStatus: "VOID", receiptCompanyId: COMPANY, invoiceCompanyId: COMPANY }));
  assert.ok(voided && /PAYMENT_INVOICE_VOID/.test(voided.message), "T5 VOID invoice must throw PAYMENT_INVOICE_VOID");
  // unknowns fail closed too — never assume 0 / same company
  assert.ok(thrownBy(() => assertInvoiceAllocationAllowed({ requestedAmount: 10, invoiceOutstanding: null, invoiceStatus: "SENT", receiptCompanyId: COMPANY, invoiceCompanyId: COMPANY })), "unreadable outstanding must throw (never assume 0)");
  assert.ok(thrownBy(() => assertInvoiceAllocationAllowed({ requestedAmount: 10, invoiceOutstanding: 100, invoiceStatus: "SENT", receiptCompanyId: null, invoiceCompanyId: COMPANY })), "missing receipt company must throw");
  assert.ok(thrownBy(() => assertInvoiceAllocationAllowed({ requestedAmount: 0, invoiceOutstanding: 100, invoiceStatus: "SENT", receiptCompanyId: COMPANY, invoiceCompanyId: COMPANY })), "zero/negative allocation must throw (I1)");
}

function testReceiptTotalGuard() {
  // T6 · Σ allocations must not exceed the receipt amount
  const exceeded = thrownBy(() => assertReceiptAllocationTotal({ receiptAmount: 100, alreadyAllocatedTotal: 70, requestedNetNew: 40 }));
  assert.ok(exceeded && /PAYMENT_RECEIPT_TOTAL_EXCEEDED/.test(exceeded.message), "T6 total > receipt.amount must throw PAYMENT_RECEIPT_TOTAL_EXCEEDED");
  assert.equal(thrownBy(() => assertReceiptAllocationTotal({ receiptAmount: 100, alreadyAllocatedTotal: 70, requestedNetNew: 30 })), null, "exact receipt total must pass");
  assert.ok(thrownBy(() => assertReceiptAllocationTotal({ receiptAmount: null, alreadyAllocatedTotal: 0, requestedNetNew: 10 })), "receipt without amount must throw PAYMENT_RECEIPT_AMOUNT_REQUIRED");
  // T10 · moving money is NOT new money
  assert.equal(thrownBy(() => assertReceiptAllocationTotal({ receiptAmount: 100, alreadyAllocatedTotal: 60, requestedNetNew: 40 })), null, "T10 reallocation of an existing 40 must still fit inside a 100 receipt");
  assert.ok(thrownBy(() => assertReceiptAllocationTotal({ receiptAmount: 100, alreadyAllocatedTotal: 100, requestedNetNew: 40 })), "T10 the same move WITHOUT subtracting the moving row must be rejected (no double counting)");
}

function testTargetIds() {
  // T7 · anchor → invoice must clear debt_event_id (this is the bug that hit the DB CHECK)
  //      the real case: the row currently points at an anchor debt_event, then moves to an invoice
  assert.deepEqual(
    allocationTargetIds({ kind: "invoice", id: "INV-1" }, "DE-ANCHOR"),
    { invoice_id: "INV-1", standalone_document_id: null, debt_event_id: null },
    "T7 moving an anchor allocation to an invoice must clear debt_event_id",
  );
  assert.deepEqual(allocationTargetIds({ kind: "invoice", id: "INV-1" }), { invoice_id: "INV-1", standalone_document_id: null, debt_event_id: null }, "T7 invoice target must clear debt_event_id");
  // T8 · invoice → anchor/debt_event must clear invoice_id
  assert.deepEqual(allocationTargetIds({ kind: "debt_event", id: "DE-1" }), { invoice_id: null, standalone_document_id: null, debt_event_id: "DE-1" }, "T8 debt_event target must clear invoice_id");
  // T9 · invoice A → invoice B carries only the new id (no stale id from A)
  const moved = allocationTargetIds({ kind: "invoice", id: "INV-B" });
  assert.equal(moved.invoice_id, "INV-B", "T9 destination invoice must be the new one");
  assert.equal(moved.debt_event_id, null, "T9 no stale debt_event_id after invoice→invoice");
  assert.equal(moved.standalone_document_id, null, "T9 no stale standalone_document_id after invoice→invoice");
  // standalone target clears both other ids
  assert.deepEqual(allocationTargetIds({ kind: "standalone_document", id: "SD-1" }), { invoice_id: null, standalone_document_id: "SD-1", debt_event_id: null }, "standalone target must clear the other two");
  // anchor without an anchor id fails closed
  assert.ok(thrownBy(() => allocationTargetIds({ kind: "anchor" })), "anchor target without a debt_event_anchor in the same call must throw");
}

function testWriterUsesTheGuards() {
  const code = stripComments(read(WRITER));

  // writer must actually call all three guards (a helper nobody calls enforces nothing)
  assert.ok(code.includes("assertReceiptAllocationTotal("), "confirmPayment/reallocate must call assertReceiptAllocationTotal");
  assert.ok(code.includes("assertInvoiceAllocationAllowed("), "invoice targets must be checked with assertInvoiceAllocationAllowed");
  assert.ok(code.includes("invoiceGuardFacts("), "guards must read canonical facts from the DB");

  // B-04R3 — the monetary commit moved into the atomic RPC; the writer keeps only the
  // pure guards + the RPC adapter, and carries NO direct monetary write.
  assert.ok(code.includes('rpc("confirm_payment_allocation"'), "confirmPayment must commit through the atomic RPC");
  assert.ok(code.includes('rpc("reallocate_payment_allocation"'), "reallocatePayment must commit through the atomic RPC");
  assert.equal(/from\("payment_allocations"\)[\s\S]{0,60}?\.(insert|update|upsert|delete)\(/.test(code), false,
    "the writer must not write payment_allocations directly");
  assert.equal(/from\("(invoices|receipt_documents|debt_events|debt_snapshots)"\)[\s\S]{0,80}?\.(insert|update|upsert|delete)\(/.test(code), false,
    "the writer must not write any other monetary row directly");
  // the projection/refresh logic lives in the RPC transaction now, not in TypeScript
  assert.equal(code.includes("refreshInvoiceProjection"), false, "invoice projection belongs to the RPC transaction");
  assert.equal(code.includes("refreshReceiptAllocationState"), false, "receipt allocation_state belongs to the RPC transaction");
  // fail-closed: no fallback branch may exist around the RPC call
  assert.equal(/if \(error\) \{[^}]*\}/.test(code), false, "an RPC error must throw, never fall through to a fallback write");
  assert.ok(code.includes("if (error) throw new Error(mapPaymentRpcError(error.message))"), "RPC errors must map to canonical errors and throw");

  // the pure guard helpers are still the fail-fast layer
  assert.ok(code.includes("assertInvoiceAllocationAllowed("), "invoice guards must stay");
  assert.ok(code.includes("assertReceiptAllocationTotal("), "receipt-total guards must stay");
  const targetUsages = code.split("allocationTargetIds(").length - 1;
  assert.ok(targetUsages >= 2, `allocationTargetIds must survive as the one-target helper (found ${targetUsages})`);
  assert.ok((code.match(/throw new Error\("PAYMENT_/g) ?? []).length >= 4, "the writer must fail closed with deterministic PAYMENT_* errors");

  // error-code parity: every code the writer can raise has a mapping entry
  for (const code2 of ["receipt_not_found", "receipt_not_eligible", "receipt_already_allocated", "receipt_total_exceeded",
                       "overpayment_not_allowed", "company_mismatch", "invoice_void", "invoice_not_found", "actor_required"]) {
    assert.ok(code.includes(`  ${code2}: `), `RPC error mapping missing for ${code2}`);
  }

  // no clamp / penalty / silent fix-up in the money path (owner policy: fail closed)
  for (const forbidden of ["Math.min(", "Math.max(0", "penaltyPortion", "creditBalance"]) {
    assert.equal(code.includes(forbidden), false, `no clamp/penalty fallback may exist in the writer (${forbidden})`);
  }

  // T11 · authority comes from the DB, never from the caller's numbers
  assert.ok(code.includes('.select("id, status, document_type, amount, customer_company_id, matched_debt_event_id, media_path")'), "receipt authority (amount + company) must be read from receipt_documents");
  assert.ok(code.includes("invoice_payment_summary"), "outstanding authority must be the canonical view");
  assert.ok(code.includes('.select("id, customer_company_id, invoice_status")'), "invoice company/status must be read from invoices");
  const input = read(WRITER).slice(read(WRITER).indexOf("export interface ConfirmPaymentInput"), read(WRITER).indexOf("export interface ConfirmPaymentResult"));
  for (const forbiddenField of ["paid", "outstanding", "company_id", "invoice_status"]) {
    assert.equal(input.includes(forbiddenField), false, `ConfirmPaymentInput must not accept ${forbiddenField} from the caller`);
  }

  // the returned contract keys must not change (B-04R3 keeps callers working)
  assert.ok(code.includes("receipt_allocation_state:") && code.includes("debt_snapshot:"), "the refreshed result contract must stay intact");
}

function testNoSecondAuthority() {
  // T13 · the gateway must not write money
  const gateway = stripComments(read("gateway/actions.ts"));
  assert.equal(gateway.includes("payment_allocations"), false, "gateway/actions.ts must not touch payment_allocations");
  // T14 · B-05 is untouched
  assert.ok(gateway.includes('.from("debt_trackings")'), "executeDebtCreate (B-05) must keep its own path");

  // T12 · B-03 read model stays the canonical read for the preview
  const preview = stripComments(read("gateway/actions.ts"));
  assert.ok(preview.includes('.from("invoice_payment_summary")'), "B-03 previewPayment must keep reading the canonical view");

  // STEP 11 · PAYMENT_WRITE_AUTHORITY_COUNT === 1
  const dirs = ["app", "core", "engines", "services", "gateway", "scripts"];
  const writers: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === ".next") continue;
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(rel);
      else if (/\.(ts|tsx)$/.test(entry.name)) {
        const src = stripComments(readFileSync(join(ROOT, rel), "utf-8"));
        let idx = src.indexOf('from("payment_allocations")');
        while (idx !== -1) {
          const tail = src.slice(idx, idx + 160);
          if (/\.(insert|upsert|update|delete)\(/.test(tail)) {
            writers.push(rel);
            break;
          }
          idx = src.indexOf('from("payment_allocations")', idx + 1);
        }
      }
    }
  };
  for (const d of dirs) walk(d);
  const uniqueWriters = [...new Set(writers)];
  assert.deepEqual(uniqueWriters, [], `no TypeScript file may write payment_allocations directly (the RPC owns the commit), got: ${uniqueWriters.join(", ")}`);
  return uniqueWriters;
}

function main() {
  testInvoiceGuards();
  testReceiptTotalGuard();
  testTargetIds();
  testWriterUsesTheGuards();
  const authorities = testNoSecondAuthority();

  console.log("canonical-payment-invariant:test PASS");
  console.log(
    `checks: T1-T5 invoice guards (partial/exact pass · overpay/company/VOID fail closed) · T6 receipt total · T7-T9 target ids (no stale id) · T10 no double count · T11 DB authority · T12 B-03 read intact · T13 gateway clean · T14 B-05 intact · direct_ts_writers=${authorities.length === 0 ? "0 (the RPC owns the commit)" : authorities.join(",")}`,
  );
  console.log(
    "NOT_EXECUTED (environment): DB-integration cases (real insert/update, projection refresh, anchor→invoice move against Postgres) need a local DB (docker unavailable) or a service-role credential — reported, not claimed.",
  );
}

main();

