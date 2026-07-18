/**
 * Debt Tracking Calculator — ลูกหนี้แยก (debt_trackings)
 *
 * ดอกเบี้ยคงที่ 25%/ปี แบบไม่ทบต้น (simple interest)
 * ต่างจาก calcCompoundInterest (invoice_debts) ซึ่งเป็นดอกเบี้ยทบต้น
 * ทุกค่าคำนวณจาก record จริงใน debt_trackings ห้าม hardcode ตัวเลขธุรกิจอื่น
 */

import { round } from "@/core/shared/types";
import { calcDaysOverdue } from "./interest";
import { supabaseAdmin } from "@/services/supabase/queries";

export const DEBT_TRACKING_INTEREST_RATE = 0.25;

// ค่าปรับ/ค่าติดตามทวงถาม — เริ่มนับวันละ 100 บาท หลังวันผิดนัดชำระ
export const DEBT_TRACKING_PENALTY_PER_DAY = 100;

// วันผ่อนผันก่อนถือเป็นผิดนัดชำระ นับจากวันเริ่มคิดดอกเบี้ย (interestStartAt + 30 วัน = วันผิดนัดชำระ)
export const DEBT_TRACKING_GRACE_DAYS = 30;

export interface FreezeWindow {
  from: string;
  until: string | null;
}

export interface DebtTrackingInput {
  principalAmount: number;
  feeRate: number;
  interestStartAt: string;
  asOfDate?: string;
  // Debt Collection Freeze Window — urgent minimal fix (owner, 2026-07-18).
  // Fallback path only, used when no debt_events history exists for this
  // customer yet — see freezeWindows below for the Phase B event-derived
  // path, which takes priority whenever it has data.
  freezeFrom?: string | null;
  freezeUntil?: string | null;
  // Phase B (owner, 2026-07-18) — freeze windows DERIVED from debt_events'
  // collection_paused/collection_resumed pairs (see deriveFreezeWindows
  // below), supports multiple freeze periods over a debt's lifetime (e.g. a
  // second late payment after collection already resumed once). When this
  // is non-empty it takes priority over freezeFrom/freezeUntil above.
  freezeWindows?: FreezeWindow[];
}

// Days of [rangeStart, rangeEnd] that overlap the freeze window — the
// amount to SUBTRACT from a day-count that would otherwise run through the
// freeze period uninterrupted. Real, calculated overlap, not a guess: a
// freeze that starts after rangeEnd or ends before rangeStart contributes 0.
function frozenOverlapDays(rangeStart: Date, rangeEnd: Date, freezeFrom?: Date | null, freezeUntil?: Date | null): number {
  if (!freezeFrom) return 0;
  const freezeEnd = freezeUntil ?? rangeEnd;
  const overlapStart = freezeFrom > rangeStart ? freezeFrom : rangeStart;
  const overlapEnd = freezeEnd < rangeEnd ? freezeEnd : rangeEnd;
  const days = Math.floor((overlapEnd.getTime() - overlapStart.getTime()) / 86_400_000);
  return Math.max(0, days);
}

// Sum of frozenOverlapDays across every window — windows don't overlap each
// other by construction (a new collection_paused event only makes sense
// after the previous one resumed), so a plain sum is correct, not an
// approximation.
function totalFrozenDays(rangeStart: Date, rangeEnd: Date, windows: FreezeWindow[]): number {
  return windows.reduce(
    (sum, w) => sum + frozenOverlapDays(rangeStart, rangeEnd, new Date(w.from), w.until ? new Date(w.until) : null),
    0,
  );
}

export interface DebtEventRow {
  event_type: string;
  occurred_at: string;
}

// Derives freeze windows from a chronological event history — pairs each
// collection_paused with the next collection_resumed after it (or leaves it
// open-ended if none exists yet, matching the same "open-ended freeze"
// semantics as the freezeUntil-null fallback). Real derivation from events,
// not a manually-maintained field.
export function deriveFreezeWindows(events: DebtEventRow[]): FreezeWindow[] {
  const sorted = [...events].sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
  const windows: FreezeWindow[] = [];
  let openFrom: string | null = null;
  for (const e of sorted) {
    if (e.event_type === "collection_paused" && !openFrom) {
      openFrom = e.occurred_at;
    } else if (e.event_type === "collection_resumed" && openFrom) {
      windows.push({ from: openFrom, until: e.occurred_at });
      openFrom = null;
    }
  }
  if (openFrom) windows.push({ from: openFrom, until: null });
  return windows;
}

export interface DebtTrackingSummary {
  principalAmount: number;
  feeRate: number;
  feeAmount: number;
  daysElapsed: number;
  interestRate: number;
  interestAmount: number;
  defaultDate: string;
  daysOverdue: number;
  penaltyAmount: number;
  totalAmount: number;
}

export function calcDebtTrackingSummary(input: DebtTrackingInput): DebtTrackingSummary {
  const start = new Date(input.interestStartAt);
  const asOf = input.asOfDate ? new Date(input.asOfDate) : new Date();

  // Phase B event-derived windows take priority; fall back to the single
  // freezeFrom/freezeUntil field only when no event history exists yet.
  const windows: FreezeWindow[] = input.freezeWindows?.length
    ? input.freezeWindows
    : input.freezeFrom
      ? [{ from: input.freezeFrom, until: input.freezeUntil ?? null }]
      : [];

  const daysElapsedRaw = calcDaysOverdue(start, asOf);
  const daysElapsed = Math.max(0, daysElapsedRaw - totalFrozenDays(start, asOf, windows));

  const feeAmount = round(input.principalAmount * (input.feeRate / 100));
  const base = input.principalAmount + feeAmount;
  const interestAmount = round((base * DEBT_TRACKING_INTEREST_RATE * daysElapsed) / 365);

  const defaultDateObj = new Date(start);
  defaultDateObj.setDate(defaultDateObj.getDate() + DEBT_TRACKING_GRACE_DAYS);
  const daysOverdueRaw = calcDaysOverdue(defaultDateObj, asOf);
  const daysOverdue = Math.max(0, daysOverdueRaw - totalFrozenDays(defaultDateObj, asOf, windows));
  const penaltyAmount = round(daysOverdue * DEBT_TRACKING_PENALTY_PER_DAY);

  const totalAmount = round(base + interestAmount + penaltyAmount);

  return {
    principalAmount: input.principalAmount,
    feeRate: input.feeRate,
    feeAmount,
    daysElapsed,
    interestRate: DEBT_TRACKING_INTEREST_RATE,
    interestAmount,
    defaultDate: defaultDateObj.toISOString().split("T")[0],
    daysOverdue,
    penaltyAmount,
    totalAmount,
  };
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
  const freezeWindows = deriveFreezeWindows(events ?? []);

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
