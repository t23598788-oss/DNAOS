/**
 * BATCH 35 (owner 2026-10-08) — one-off, idempotent ledger correction for the
 * anchor double-count incident on receipt 0722ae13-2309-4e01-b640-6e8a6b9256d9.
 *
 * What happened: the pre-fix confirm_payment_allocation booked the anchor
 * receipt_received as Σ ALL anchor allocations (฿10,000 = 5,500 principal +
 * 4,500 penalty) while receipt-confirm-flow additionally appended
 * interest_penalty_received(4,500) → the ledger reduced by ฿14,500 for
 * ฿10,000 of money and the snapshot fell to −9,000 instead of −4,500.
 *
 * Correction model (append-only ledger — debt-write doctrine: "corrections are
 * new events"): a manual_adjustment of +4,500 restores the balance to the
 * money-received basis (equivalent to the anchor having booked principal
 * 5,500 as the legacy RPC did). Nothing is updated or deleted in place, and
 * refreshDebtSnapshotFromLedger recomputes the projection from the ledger.
 *
 * Idempotent: skips when a correction marker already exists.
 * The RPC itself is fixed separately by migration
 * 20261008000001_confirm_payment_anchor_principal_only.sql (applied to prod
 * in the same batch), so no future confirm double-counts.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const env: Record<string, string> = {};
for (const line of readFileSync(join(process.cwd(), ".env.local"), "utf8").split("\n")) {
  const i = line.indexOf("=");
  if (i > 0 && !line.startsWith("#")) env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
}
process.env.NEXT_PUBLIC_SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
process.env.SUPABASE_SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;

const KT = "8650e308-de18-4824-a449-82317b793893"; // บจก. เคที คอนสตรัคชั่น 1988 จำกัด
const RECEIPT = "0722ae13-2309-4e01-b640-6e8a6b9256d9";
const ANCHOR_EVENT = "591e2eae-3227-4775-9a94-04488be876d0";
const MARK = "BATCH35_ANCHOR_DOUBLE_COUNT_CORRECTION";
const CORRECTION = 4500; // double-counted penalty (10,000 booked instead of principal 5,500)
const ACTOR = "batch35:anchor-principal-fix";

async function main(): Promise<void> {
  const db = (await import("@/services/supabase/queries")).supabaseAdmin();
  const { appendDebtEvent, refreshDebtSnapshotFromLedger } = await import("@/engines/canonical/debt-write");

  const { data: snap0 } = await db
    .from("debt_snapshots").select("total_outstanding, collection_state")
    .eq("customer_company_id", KT).maybeSingle();
  console.log("BEFORE snapshot:", JSON.stringify(snap0));

  const { data: existing } = await db
    .from("debt_events").select("id, amount, note")
    .eq("customer_company_id", KT).eq("event_type", "manual_adjustment")
    .like("note", `%${MARK}%`);
  if ((existing ?? []).length > 0) {
    console.log("SKIP: correction already present:", JSON.stringify(existing));
  } else {
    await appendDebtEvent({
      customer_company_id: KT,
      event_type: "manual_adjustment",
      amount: CORRECTION,
      note: `${MARK}: anchor double-count correction — confirm_payment_allocation (pre-fix) booked receipt_received=${10000} for receipt ${RECEIPT} (Σ principal 5,500 + penalty 4,500) while the flow also appended interest_penalty_received 4,500 → ledger reduced 14,500 for 10,000 of money. +4,500 restores the money-received basis (anchor should have booked principal 5,500 per legacy contract). Fixed by migration 20261008000001_confirm_payment_anchor_principal_only.`,
      source: "manual_correction",
      actor: ACTOR,
      evidence: {
        incident: "BATCH35_ANCHOR_DOUBLE_COUNT",
        receipt_document_id: RECEIPT,
        anchor_event_id: ANCHOR_EVENT,
        recorded_anchor_amount: 10000,
        correct_anchor_amount: 5500,
        double_counted: CORRECTION,
        fix_migration: "20261008000001_confirm_payment_anchor_principal_only.sql",
      },
    });
    console.log("APPENDED manual_adjustment +", CORRECTION);
  }

  const proj = await refreshDebtSnapshotFromLedger(KT, ACTOR);
  console.log("REFRESHED projection:", JSON.stringify(proj));

  const { data: events } = await db
    .from("debt_events").select("id, event_type, amount, occurred_at, note")
    .eq("customer_company_id", KT).order("occurred_at", { ascending: true });
  console.log("LEDGER:", JSON.stringify(events, null, 1));

  const { data: snap1 } = await db
    .from("debt_snapshots").select("total_outstanding, collection_state, overdue_amount, days_overdue, updated_at")
    .eq("customer_company_id", KT).maybeSingle();
  console.log("AFTER snapshot:", JSON.stringify(snap1));

  const bal = Number(snap1?.total_outstanding);
  if (bal !== -4500) {
    console.error(`FAIL: expected total_outstanding = -4500, got ${bal}`);
    process.exit(1);
  }
  console.log("PASS: ledger balance = -4500 (money-received basis) · state =", snap1?.collection_state);
}

void main();
