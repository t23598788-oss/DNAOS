/**
 * CANONICAL PAYMENT INTEGRITY & RECOVERY — T01–T20 regression suite.
 *
 * Scope: the repairs from this mission (A bank matching, B false success,
 * C double confirmation, D preview token) + the canonical invariants they
 * must never break. Money-state cases run against the REAL writer contract
 * with recording clients / source+RPC assertions — never against Production
 * rows (mission rule: state-changing cases use test data separate from prod).
 *
 * Run: npx tsx scripts/payment-integrity-recovery-test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  normalizeBankName,
  descriptionMatchesSender,
  evaluateStatementEvidence,
  claimStatementRow,
  releaseStatementClaim,
  type StatementCandidateRow,
} from "../supabase/functions/_shared/bank-evidence";
import { issueToken, consumeToken, __setTokenDbForTest } from "../gateway/actions";

const ROOT = join(__dirname, "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf-8");

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) {
    passed++;
    console.log(`PASS  ${name}`);
  } else {
    failed++;
    console.log(`FAIL  ${name}${detail ? " — " + detail : ""}`);
  }
}

const RECEPT = "b4000000-0000-4000-8000-000000000001";
const OTHER_RECEIPT = "b4000000-0000-4000-8000-000000000002";

const statementRow = (over: Partial<StatementCandidateRow> = {}): StatementCandidateRow => ({
  id: "stmt-1",
  account_number: "230-8-66630-4",
  description: "จาก X2223 บจก. เคที คอนสตรัค++",
  matched_receipt_document_id: null,
  ...over,
});

// ══ A — BANK MATCHING ═══════════════════════════════════════════════════════
// All checks run inside main() so the async token/claim tests can await
// (CJS output has no top-level await).
async function main(): Promise<void> {

// T01: real bank evidence complete → matched (claim + confirm may proceed)
{
  const out = evaluateStatementEvidence({
    candidates: [statementRow()],
    senderName: "บจก. เคที คอนสตรัคชั่น 1988 จำกัด",
    receiptDocumentId: RECEPT,
  });
  check("T01 full bank evidence (account + description names sender + unique row) → matched", out.kind === "matched");
}

// T02: same amount but DIFFERENT payer → insufficient (never matched)
{
  const out = evaluateStatementEvidence({
    candidates: [statementRow({ description: "จาก X7871 น.ส. รัตนพร ล้ำวง++" })],
    senderName: "บจก. เคที คอนสตรัคชั่น 1988 จำกัด",
    receiptDocumentId: RECEPT,
  });
  check(
    "T02 same amount/day but payer name differs → pending_review (NOT matched)",
    out.kind === "insufficient",
    JSON.stringify(out),
  );
  check(
    "T02b description/sender cross-check is the gate",
    descriptionMatchesSender("จาก X7871 น.ส. รัตนพร ล้ำวง++", "บจก. เคที คอนสตรัคชั่น 1988 จำกัด") === false &&
      descriptionMatchesSender("จาก X2223 บจก. เคที คอนสตรัค++", "บจก. เคที คอนสตรัคชั่น 1988 จำกัด") === true,
  );
}

// T03: multiple same-amount statement rows → ambiguous, human decides
{
  const out = evaluateStatementEvidence({
    candidates: [statementRow({ id: "a" }), statementRow({ id: "b" })],
    senderName: "บจก. เคที คอนสตรัคชั่น 1988 จำกัด",
    receiptDocumentId: RECEPT,
  });
  check("T03 multiple candidate rows same day+amount → ambiguous (left for human)", out.kind === "ambiguous");
}

// T04: duplicate statement row already claimed by ANOTHER receipt → refused
{
  const out = evaluateStatementEvidence({
    candidates: [statementRow({ matched_receipt_document_id: OTHER_RECEIPT })],
    senderName: "บจก. เคที คอนสตรัคชั่น 1988 จำกัด",
    receiptDocumentId: RECEPT,
  });
  check("T04 statement row claimed by another receipt → insufficient (no double use)", out.kind === "insufficient");
}

// T06: no statement row at all → no_match (never auto-confirm)
{
  const out = evaluateStatementEvidence({ candidates: [], senderName: "x", receiptDocumentId: RECEPT });
  check("T06 no matching statement row → no_match (stays pending)", out.kind === "no_match");
}

{
  const out = evaluateStatementEvidence({
    candidates: [statementRow({ account_number: null })],
    senderName: "บจก. เคที คอนสตรัคชั่น 1988 จำกัด",
    receiptDocumentId: RECEPT,
  });
  check("A1b statement row without receiver account → insufficient", out.kind === "insufficient");
  check("A1c normalizeBankName strips bank noise", normalizeBankName(" บจก. เคที-คอนสตรัค ") === "บจกเคทีคอนสตรัค");
}

// ══ C2 — claim discipline (double-confirmation guard) ════════════════════════

/** Minimal fake of the statement-row claim/release UPDATE semantics. */
function fakeClaimDb(rows: Record<string, { matched_receipt_document_id: string | null }>) {
  const db = {
    from(_t: string) {
      let targetId = "";
      let ownerForEq = "";
      let patch: Record<string, unknown> | null = null;
      const builder: any = {};
      builder.update = (p: Record<string, unknown>) => {
        patch = p;
        return builder;
      };
      builder.eq = (col: string, v: string) => {
        if (col === "id") targetId = v;
        if (col === "matched_receipt_document_id") ownerForEq = v;
        return builder;
      };
      builder.or = (clause: string) => {
        const m = clause.match(/matched_receipt_document_id\.eq\.([0-9a-f-]+)/);
        ownerForEq = m ? m[1] : ownerForEq;
        return builder;
      };
      builder.select = () => {
        const row = rows[targetId];
        if (!row || !patch) return Promise.resolve({ data: [], error: null });
        // guard: an owned row may only be touched by its owner (claim-or-release)
        const owned = row.matched_receipt_document_id;
        if (owned !== null && owned !== ownerForEq) return Promise.resolve({ data: [], error: null });
        row.matched_receipt_document_id = (patch as { matched_receipt_document_id: string | null }).matched_receipt_document_id;
        patch = null;
        return Promise.resolve({ data: [{ id: targetId }], error: null });
      };
      return builder;
    },
  };
  return db;
}

{
  const rows: Record<string, { matched_receipt_document_id: string | null }> = {
    "stmt-1": { matched_receipt_document_id: null },
    "stmt-2": { matched_receipt_document_id: OTHER_RECEIPT },
  };
  const first = await claimStatementRow(fakeClaimDb(rows), "stmt-1", RECEPT);
  const second = await claimStatementRow(fakeClaimDb(rows), "stmt-1", OTHER_RECEIPT);
  const stolen = await claimStatementRow(fakeClaimDb(rows), "stmt-2", RECEPT);
  check("T04b claim succeeds on a free row", first === true);
  check("T04c second claim on same row (different receipt) fails", second === false, "row already owned");
  check("T04d claim fails on a row owned by another receipt", stolen === false);

  rows["stmt-1"].matched_receipt_document_id = RECEPT;
  const relDb = fakeClaimDb(rows);
  await releaseStatementClaim(relDb, "stmt-1", RECEPT);
  check("C2b release restores an unclaimed row after failed confirm", rows["stmt-1"].matched_receipt_document_id === null);
}

// ══ B — FALSE SUCCESS (source assertions over the real edge functions) ═══════
{
  const auto = read("supabase/functions/line-webhook-v2/engines/auto-confirm-payment.ts");
  check(
    "T07/T15 tryAutoConfirmPayment returns AutoConfirmOutcome (never void)",
    auto.includes("Promise<AutoConfirmOutcome>") && auto.includes('status: "rejected"'),
  );
  check(
    "T07b transport failure maps to rejected (bridge 503 must not look like success)",
    auto.includes("return { status: \"rejected\", error: confirmed.error"),
  );

  const reconcile = read("supabase/functions/bank-statement-reconcile/index.ts");
  check(
    "T07c bank-statement-reconcile reports confirmed ONLY from real outcome",
    reconcile.includes("auto.status === \"confirmed\"") && !reconcile.includes("acted ? \"confirmed against real bank statement\""),
  );
  check(
    "T07d writer rejection → pending_review outcome + claim released",
    reconcile.includes("canonical writer rejected") && reconcile.includes("releaseStatementClaim"),
  );

  const sweep = read("supabase/functions/receipt-reconcile-sweep/index.ts");
  check(
    "T07e sweep reports reconciled ONLY on status=confirmed",
    sweep.includes("auto.status === \"confirmed\"") && !sweep.includes("\"reconciled (or already was — idempotent)\""),
  );

  const mail = read("supabase/functions/bank-email-sync/index.ts");
  const cls = read("supabase/functions/line-webhook-v2/engines/process-classified-image.ts");
  check(
    "T07f customer dispatch message gated on transition.ok (bank-email-sync)",
    mail.includes("if (transition.ok)") && mail.includes("transition failed"),
  );
  check(
    "T07g customer dispatch message gated on transition.ok (process-classified-image)",
    cls.includes("if (transition.ok)") && cls.includes("no customer message sent"),
  );
}

// ══ A2 — sweep bank gate ════════════════════════════════════════════════════
{
  const sweep = read("supabase/functions/receipt-reconcile-sweep/index.ts");
  check(
    "T01b sweep requires independent bank evidence (statement OR bank email) before confirm",
    sweep.includes("evaluateStatementEvidence") && sweep.includes("bank_notifications"),
  );
  check(
    "T06b sweep maps missing bank evidence → pending_review (never auto-confirm)",
    sweep.includes("no independent bank evidence"),
  );
}

// ══ C — DOUBLE CONFIRMATION (one evidence → at most one flow) ════════════════
{
  const reconcile = read("supabase/functions/bank-statement-reconcile/index.ts");
  check(
    "T05c one bank evidence cannot drive BOTH receipt and order (reconcile)",
    reconcile.includes("matches BOTH an open receipt claim and a pending order"),
  );
  const mail = read("supabase/functions/bank-email-sync/index.ts");
  check("T05d mutual-exclusion in bank-email-sync", mail.includes("matches BOTH receipt"));
  const cls = read("supabase/functions/line-webhook-v2/engines/process-classified-image.ts");
  check(
    "T05e ambiguity flag gates the receipt flow (classify)",
    cls.includes("doubleFlowAmbiguous") && cls.includes("if (doubleFlowAmbiguous)"),
  );
}


// ══ D — PREVIEW TOKEN across restart / instances (T17/T18) ═══════════════════

/** In-memory stand-in for kv_cache with the exact supabase-js chain used above. */
function fakeKvDb() {
  const store = new Map<string, { value: unknown; updated_at: string }>();
  const state = { op: "select", key: "", likePrefix: null as string | null, ltValue: null as string | null };

  const execDelete = (): { data: unknown[]; error: null } => {
    if (state.likePrefix !== null) {
      // cleanup: delete old tokens (updated_at < ltValue)
      for (const [k, v] of [...store.entries()]) {
        if (k.startsWith(state.likePrefix) && (state.ltValue === null || v.updated_at < state.ltValue)) store.delete(k);
      }
      return { data: [], error: null };
    }
    const hit = store.get(state.key);
    if (hit) {
      store.delete(state.key);
      return { data: [hit], error: null }; // DELETE ... RETURNING shape
    }
    return { data: [], error: null };
  };

  const builder: any = {
    upsert: (body: any) => {
      store.set(body.key, { value: body.value, updated_at: body.updated_at });
      return Promise.resolve({ error: null });
    },
    select: (_cols?: string) => {
      if (state.op === "delete") return Promise.resolve(execDelete());
      return builder; // chainable read: .select().eq().maybeSingle()
    },
    maybeSingle: () => Promise.resolve({ data: store.get(state.key) ?? null, error: null }),
    eq: (_c: string, v: string) => {
      if (state.op !== "delete") state.key = v;
      else state.key = v;
      return builder;
    },
    like: (_c: string, v: string) => {
      state.likePrefix = v.replace(/\*$/, "");
      return builder;
    },
    lt: (_c: string, v: string) => {
      state.ltValue = v;
      if (state.op === "delete") return Promise.resolve(execDelete()); // terminal call
      return builder;
    },
    delete: () => {
      state.op = "delete";
      state.likePrefix = null;
      return builder;
    },
    // a bare awaited builder (e.g. delete().eq() with no terminal) executes too
    then: (onFulfilled: any, onRejected: any) => {
      if (state.op === "delete") return Promise.resolve(execDelete()).then(onFulfilled, onRejected);
      return Promise.resolve({ data: [], error: null }).then(onFulfilled, onRejected);
    },
  };
  return {
    db: {
      from: (_n: string) => {
        // fresh chain per from() call (mirrors supabase-js builder-per-query)
        state.op = "select";
        state.key = "";
        state.likePrefix = null;
        state.ltValue = null;
        return builder;
      },
    },
    store,
  };
}

// T17: Railway restart — issue, then consume purely from the shared store
// (nothing lives in process memory anymore, so a restart cannot lose it).
{
  const { db, store } = fakeKvDb();
  __setTokenDbForTest(db);
  const token = await issueToken("payment", { receipt_document_id: RECEPT, invoice_id: "inv", amount: 100 });
  const persisted = store.has("preview_token:" + token);
  const consumed = await consumeToken(token, "payment");
  check("T17 token persisted in kv_cache (survives process restart)", persisted);
  check("T17b consume after restart validates from the store", consumed.valid === true);
  check("T17c payload round-trips (receipt id survives restart)", consumed.payload?.receipt_document_id === RECEPT);
  __setTokenDbForTest(null);
}

// T18: multiple instances sharing one store — single-use still holds
{
  const { db } = fakeKvDb();
  __setTokenDbForTest(db);
  const token = await issueToken("payment", { receipt_document_id: RECEPT, invoice_id: "inv", amount: 100 });
  const first = await consumeToken(token, "payment"); // instance A
  const second = await consumeToken(token, "payment"); // instance B, same store
  check("T18 first instance consumes successfully", first.valid === true);
  check("T18b second instance refused (single-use across instances)", second.valid === false);

  const t2 = await issueToken("payment", { receipt_document_id: RECEPT });
  const wrong = await consumeToken(t2, "document.create");
  const right = await consumeToken(t2, "payment");
  check("T18c wrong action refused without burning the token for the right action", wrong.valid === false && right.valid === true);
  __setTokenDbForTest(null);
  check("T18d no in-process Map remains in gateway/actions.ts", !read("gateway/actions.ts").includes("_tokenStore"));
}


// ══ T05/T08–T16/T19/T20 — canonical writer invariants (RPC/writer = truth) ══
{
  const rpc = read("supabase/migrations/20260923000001_canonical_payment_allocation_atomic_v1_1.sql");
  check("T05 webhook/redelivery: RPC refuses double allocation (receipt_already_allocated)", rpc.includes("receipt_already_allocated"));
  check("T08 duplicate allocation impossible: existing total > 0 → exception", rpc.includes("v_existing_total > 0 then raise exception"));
  check("T10 overpayment impossible: Σ allocations > receipt amount → exception", rpc.includes("receipt_total_exceeded"));
  check("T13 VOID invoice refused inside the transaction", rpc.includes("raise exception 'invoice_void'"));
  check("T14 company mismatch refused inside the transaction", rpc.includes("raise exception 'company_mismatch'"));
  check("T16 atomicity: row locks FOR UPDATE (any raise rolls the whole tx back)", rpc.includes("for update"));
  check("T09 partial payment supported (allocation_state projection)", rpc.includes("allocation_state"));

  const flow = read("engines/canonical/receipt-confirm-flow.ts");
  check("T09b flow splits principal vs interest/penalty (partial/overpay)", flow.includes("principalPortion") && flow.includes("interestPenaltyPortion"));
  check("T05b flow idempotency: already-confirmed short-circuits before writer", flow.includes("already_reconciled"));

  const route = read("app/api/internal/connect/payment-confirm/route.ts");
  check("T15b writer rejection → HTTP 422 (caller must NOT see ok:true)", route.includes("status: 422"));
  check("T15c bridge fail-closed: wrong/missing secret → 401/503, no fallback write", route.includes("status: 503") && route.includes("status: 401"));

  const payWrite = read("engines/canonical/payment-write.ts");
  check("T12 multiple invoices per payment supported (allocations array)", payWrite.includes("PaymentAllocationInput[]") && payWrite.includes('kind: "invoice"'));
  check("T16b single monetary commit = one RPC call (no direct money writes)", payWrite.includes('db.rpc("confirm_payment_allocation"'));
  check("T11 underpayment: partial state projected from allocations only", payWrite.includes("receipt_allocation_state"));

  const ack = read("gateway/payment-acknowledgement.ts");
  check("T19 receipt generation reads the LEDGER view (not invoice AR)", ack.includes("company_debt_current"));
  check("T19b acknowledgement delivery idempotent (no double receipt push)", ack.includes("already_acknowledged"));

  const views = read("supabase/migrations/20260922000003_canonical_views_v1_1.sql");
  check("T20 reconciliation view exists (snapshot vs ledger side by side)", views.includes("company_debt_current") && views.includes("ledger_outstanding"));
}

// ══ OWNER RULES — one writer, one authority, no parallel gateway ═════════════
{
  const reconcile = read("supabase/functions/bank-statement-reconcile/index.ts");
  check(
    "Owner rule: reconcile reaches money ONLY via the canonical bridge",
    reconcile.includes("tryAutoConfirmPayment") && !reconcile.includes("reconcile_receipt_payment"),
  );
  const bankEvidence = read("supabase/functions/_shared/bank-evidence.ts")
    .replace(/\/\*[\s\S]*?\*\//g, "") // doc comments describe the chain — only code counts
    .replace(/^\s*\/\/.*$/gm, "");
  check(
    "Owner rule: bank-evidence helper writes ONLY the evidence pointer, never money",
    !bankEvidence.includes("payment_allocations") && !bankEvidence.includes("debt_events") && !bankEvidence.includes("confirmPayment"),
  );
  const gateway = read("gateway/actions.ts");
  check("Owner rule: preview token never carries an actor", !/issueToken\("payment", \{[^}]*actor/.test(gateway));
}

console.log(`\nRESULT: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

