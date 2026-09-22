/**
 * Debt Tracking Calculator — ลูกหนี้แยก (debt_trackings)
 *
 * ดอกเบี้ยคงที่ 25%/ปี แบบไม่ทบต้น (simple interest)
 * ต่างจาก calcCompoundInterest (invoice_debts) ซึ่งเป็นดอกเบี้ยทบต้น
 * ทุกค่าคำนวณจาก record จริงใน debt_trackings ห้าม hardcode ตัวเลขธุรกิจอื่น
 *
 * @deprecated LEGACY (Phase E5.5, 2026-09-22) — NOT a financial production path.
 * Phase E5 moved finance-summary, partner credit, line-customers, relationships and
 * the partner summaries off this module: they now read the canonical ledger
 * projection (`company_debt_current`) so one company shows ONE debt number.
 * What remains here is the debt-tracking tracker itself (its own UI + API) and the
 * document drafts it feeds — never a source of money for finance/credit again.
 */

import { supabaseAdmin } from "@/services/supabase/queries";
import { calcDebtTrackingSummary as calcSharedDebtTrackingSummary, deriveFreezeWindows as deriveSharedFreezeWindows } from "./tracking-calculator";
import type { DebtTrackingInput, DebtTrackingSummary } from "./tracking-calculator";

export {
  DEBT_TRACKING_INTEREST_RATE,
  DEBT_TRACKING_PENALTY_PER_DAY,
  DEBT_TRACKING_GRACE_DAYS,
} from "./tracking-calculator";

export { deriveSharedFreezeWindows as deriveFreezeWindows };
export type { DebtEventRow, FreezeWindow, DebtTrackingInput, DebtTrackingSummary } from "./tracking-calculator";

export function calcDebtTrackingSummary(input: DebtTrackingInput): DebtTrackingSummary {
  return calcSharedDebtTrackingSummary(input);
}

// Manual corrections (owner) — admin-triggered via debt-trackings/[id]/events
// "adjust_fee"/"adjust_interest", a signed delta amount + a required reason
// stored on debt_events.note. Sums real rows, never guesses a value.
export function sumManualAdjustments(events: import("./tracking-calculator").DebtEventRow[]): number {
  return events
    .filter((e) => e.event_type === "manual_adjustment")
    .reduce((sum, e) => sum + Number(e.amount ?? 0), 0);
}

export function sumManualInterestAdjustments(events: import("./tracking-calculator").DebtEventRow[]): number {
  return events
    .filter((e) => e.event_type === "manual_interest_adjustment")
    .reduce((sum, e) => sum + Number(e.amount ?? 0), 0);
}

// Collection state machine — same event types deriveFreezeWindows already
// reads (collection_paused/collection_resumed), plus debt_closed. Processed
// in chronological order so the LATEST real event wins, not just the most
// recently inserted row.
export function deriveCollectionStatus(events: import("./tracking-calculator").DebtEventRow[]): "active" | "paused" | "closed" {
  const sorted = [...events].sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
  let status: "active" | "paused" | "closed" = "active";
  for (const event of sorted) {
    if (event.event_type === "collection_paused") status = "paused";
    else if (event.event_type === "collection_resumed") status = "active";
    else if (event.event_type === "debt_closed") status = "closed";
  }
  return status;
}

// Single Source of Truth for "how much does this partner owe right now"
// (owner, 2026-07-17, PRIORITY task). Root cause this fixes: every consumer
// of debt (Chat header, Relationship page, credit score, LINE reminder cron)
// was reading `debt_snapshots.total_outstanding` directly — a raw number set
// ONCE at debt-tracking creation time (services/supabase/queries.ts's
// createDebtTracking sets total_outstanding = principal_amount and never
// updates it again) and never recomputed with interest/penalty. Meanwhile
// calcDebtTrackingSummary (above, this same file) already IS the correct,
// real formula — but only `/admin/debt-tracking`'s own API route and
// engines/documents/debt-notice-draft.ts ever called it. This function is
// the one place every consumer should call instead of reading the raw
// column directly.
//
// Honest, sourced limitations (not fabricated fixes):
// - `fee_rate` has no column in debt_snapshots at all (confirmed by reading
//   the live table schema directly) — services/supabase/queries.ts's own
//   getDebtTrackings() already hardcodes fee_rate: 0 for the same reason.
//   feeAmount is therefore always 0 today; not a bug introduced here.
// - `vat` is NOT computed — no existing debt engine in this codebase (this
//   file, engines/debt/engine.ts, or debt-notice-draft.ts) applies VAT to
//   interest/penalty, and Thai tax practice generally does not VAT default
//   interest. Returned as null (an explicit "not applicable/not known"),
//   never a guessed number — per the Constitution's ban on hardcoding
//   unsourced business figures.
export interface CurrentDebt {
  principal: number;
  interest: number;
  penalty: number;
  collection_fee: number;
  vat: number | null;
  total_due: number;
  overdue_days: number;
  calculated_at: string;
  // Debt Tracking Model — Phase B (owner, 2026-07-18). Null for rows not yet
  // migrated (shouldn't happen after the backfill in
  // 20260718000002_debt_tracking_model.sql, but read defensively since this
  // is a live financial value, not something to assume).
  debt_type: string | null;
  vat_status: string | null;
  document_type: string | null;
}

// debt_type -> the ONLY document module allowed to issue a document for
// this debt (owner, 2026-07-18) — a fixed business-rule lookup, not a UI
// choice. Mirrors the check constraint on debt_snapshots.document_type;
// kept in code (not DB) because it's a structural constant, not per-row
// data — same distinction this codebase already draws for e.g. INTEREST_RATE
// above (a business constant) vs. principalAmount (a per-row DB value).
export const DEBT_TYPE_DOCUMENT_TYPE: Record<string, "invoice" | "collection_reminder_notice" | "unsupported"> = {
  trade_receivable: "invoice",
  collection_reminder: "collection_reminder_notice",
  loan: "unsupported",
  damages: "unsupported",
};

export async function getCurrentDebt(partnerId: string): Promise<CurrentDebt | null> {
  // Infrastructure fix (owner, 2026-07-17): was using supabase() — the
  // shared anon-key client (services/supabase/queries.ts), a bare singleton
  // with no session/JWT ever attached. RLS on debt_snapshots silently
  // filters anon-role reads to zero rows (confirmed empirically: anon key
  // → [], service-role key → real row, same query, same partner). This
  // function runs only in trusted server contexts (API routes behind
  // requireAuth(), the cognitive/AI dispatcher, LINE webhook handlers) —
  // never client-side — so supabaseAdmin() is the correct, already-
  // established client for this codebase's convention (every admin route
  // already uses `supabaseAdmin as supabase` for exactly this reason).
  const { data: row, error } = await supabaseAdmin()
    .from("debt_snapshots")
    .select("total_outstanding, debt_start_at, created_at, freeze_from, freeze_until, debt_type, vat_status, document_type")
    .eq("customer_company_id", partnerId)
    .maybeSingle();
  if (error || !row || !row.total_outstanding) return null;

  // Phase B (owner, 2026-07-18) — event history takes priority over the
  // freeze_from/freeze_until fallback whenever it has data. One extra query,
  // acceptable here (this function already does its own DB query per call,
  // unlike the list-view routes which pass freeze fields in directly to
  // avoid N+1).
  const { data: events } = await supabaseAdmin()
    .from("debt_events")
    .select("event_type, occurred_at")
    .eq("customer_company_id", partnerId)
    .in("event_type", ["collection_paused", "collection_resumed"]);
  const freezeWindows = deriveSharedFreezeWindows(events ?? []);

  const summary = calcDebtTrackingSummary({
    principalAmount: Number(row.total_outstanding),
    feeRate: 0, // see comment above — no fee_rate column exists yet
    interestStartAt: row.debt_start_at ?? row.created_at,
    freezeFrom: (row as { freeze_from?: string | null }).freeze_from ?? null,
    freezeUntil: (row as { freeze_until?: string | null }).freeze_until ?? null,
    freezeWindows,
  });

  return {
    principal: summary.principalAmount,
    interest: summary.interestAmount,
    penalty: summary.penaltyAmount,
    collection_fee: summary.feeAmount,
    vat: null,
    total_due: summary.totalAmount,
    overdue_days: summary.daysOverdue,
    calculated_at: new Date().toISOString(),
    debt_type: (row as { debt_type?: string | null }).debt_type ?? null,
    vat_status: (row as { vat_status?: string | null }).vat_status ?? null,
    document_type: (row as { document_type?: string | null }).document_type ?? null,
  };
}
