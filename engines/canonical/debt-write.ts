/**
 * Canonical debt write model (Phase D5).
 *
 * `debt_events` is the ledger and the ONLY source of truth for a company's debt.
 * `debt_snapshots` is a projection: it is always recomputed from the ledger
 * (never from invoices) and is upserted here, which also repairs the real case
 * "company has ledger rows but no snapshot row".
 *
 * Event vocabulary is the one already stored in the database:
 *   debt_started · receipt_received · interest_penalty_received · manual_adjustment ·
 *   manual_interest_adjustment · collection_paused · collection_resumed ·
 *   promise_to_pay · debt_closed
 * (corrections are new events — the ledger is append-only)
 */
import { supabaseAdmin } from "@/services/supabase/queries";
import { recordCanonicalAudit } from "@/engines/canonical/audit";

export const DEBT_EVENT_TYPES = [
  "debt_started",
  "receipt_received",
  "interest_penalty_received",
  "manual_adjustment",
  "manual_interest_adjustment",
  "collection_paused",
  "collection_resumed",
  "promise_to_pay",
  "debt_closed",
] as const;

export type DebtEventType = (typeof DEBT_EVENT_TYPES)[number];

/** Signed effect of each event on the outstanding balance (v1.1 reading of the real ledger). */
const LEDGER_EFFECT: Record<DebtEventType, 1 | -1 | 0> = {
  debt_started: 1,
  receipt_received: -1,
  interest_penalty_received: -1,
  manual_adjustment: 1,
  manual_interest_adjustment: 1,
  collection_paused: 0,
  collection_resumed: 0,
  promise_to_pay: 0,
  debt_closed: 0,
};

export interface AppendDebtEventInput {
  customer_company_id: string;
  event_type: DebtEventType;
  amount?: number | null;
  occurred_at?: string | null;
  note?: string | null;
  source: string;
  actor: string;
  evidence?: Record<string, unknown> | null;
  linked_invoice_id?: string | null;
  linked_document_id?: string | null;
}

export interface DebtSnapshotProjection {
  customer_company_id: string;
  total_outstanding: number;
  ledger_event_count: number;
  last_event_at: string | null;
  repaired: boolean;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export async function appendDebtEvent(input: AppendDebtEventInput) {
  const db = supabaseAdmin();
  if (!DEBT_EVENT_TYPES.includes(input.event_type)) {
    throw new Error(`DEBT_EVENT_TYPE_UNKNOWN: ${input.event_type}`);
  }
  if (LEDGER_EFFECT[input.event_type] !== 0 && (input.amount === null || input.amount === undefined)) {
    throw new Error(`DEBT_EVENT_AMOUNT_REQUIRED: ${input.event_type} ต้องมียอดเงิน`);
  }
  const { data, error } = await db
    .from("debt_events")
    .insert({
      customer_company_id: input.customer_company_id,
      event_type: input.event_type,
      amount: input.amount ?? null,
      occurred_at: input.occurred_at ?? new Date().toISOString().slice(0, 10),
      note: input.note ?? null,
      source: input.source,
      created_by: input.actor,
      linked_invoice_id: input.linked_invoice_id ?? null,
      linked_document_id: input.linked_document_id ?? null,
    })
    .select("*")
    .single();
  if (error) throw new Error(`บันทึก debt ledger ไม่สำเร็จ: ${error.message}`);

  await recordCanonicalAudit({
    action: "debt.event_created",
    entity_type: "debt_event",
    entity_id: String(data.id),
    actor: input.actor,
    company_id: input.customer_company_id,
    new_value: { event_type: input.event_type, amount: input.amount ?? null },
    evidence: input.evidence ?? null,
  });
  return data as Record<string, unknown>;
}

/**
 * Recompute the snapshot projection from the ledger only.
 * Never derives an outstanding balance from invoices (v1.1 invariant 4).
 */
export async function refreshDebtSnapshotFromLedger(customerCompanyId: string, actor: string): Promise<DebtSnapshotProjection> {
  const db = supabaseAdmin();
  const { data: events, error } = await db
    .from("debt_events")
    .select("event_type, amount, occurred_at")
    .eq("customer_company_id", customerCompanyId)
    .order("occurred_at", { ascending: true });
  if (error) throw new Error(`อ่าน debt ledger ไม่สำเร็จ: ${error.message}`);
  if (!events?.length) throw new Error("DEBT_LEDGER_EMPTY: ไม่มี ledger สำหรับบริษัทนี้ — ห้ามสร้างยอดจากที่อื่น");

  let outstanding = 0;
  let lastEventAt: string | null = null;
  let closedInLedger = false;
  for (const e of events as Record<string, unknown>[]) {
    const type = String(e.event_type) as DebtEventType;
    const effect = LEDGER_EFFECT[type] ?? 0;
    outstanding += effect * Number(e.amount ?? 0);
    if (type === "debt_closed") closedInLedger = true;
    const at = e.occurred_at ? String(e.occurred_at) : null;
    if (at && (!lastEventAt || at > lastEventAt)) lastEventAt = at;
  }
  outstanding = round2(outstanding);

  const { data: existing } = await db.from("debt_snapshots").select("id, collection_state").eq("customer_company_id", customerCompanyId).maybeSingle();
  const payload: Record<string, unknown> = {
    customer_company_id: customerCompanyId,
    total_outstanding: outstanding,
    updated_at: new Date().toISOString(),
  };
  if (closedInLedger || outstanding <= 0) {
    // ledger-derived close (a `debt_closed` event, or a balance paid down to zero).
    // Replaces the old clamp-at-zero: the number stays honest (a negative balance
    // means the customer over-paid) while the tracking state still stops.
    payload.collection_state = "CLOSED";
    payload.overdue_amount = 0;
    payload.days_overdue = 0;
  }
  if (!existing) {
    // a company with a ledger but no snapshot is a real state: create the projection now
    payload.collection_state = closedInLedger || outstanding <= 0 ? "CLOSED" : "CURRENT";
    payload.debt_type = "collection_reminder";
    payload.debt_start_at = lastEventAt ?? new Date().toISOString().slice(0, 10);
  }
  const { error: upErr } = existing
    ? await db.from("debt_snapshots").update(payload).eq("id", String(existing.id))
    : await db.from("debt_snapshots").insert(payload);
  if (upErr) throw new Error(`refresh debt projection ไม่สำเร็จ: ${upErr.message}`);

  return {
    customer_company_id: customerCompanyId,
    total_outstanding: outstanding,
    ledger_event_count: events.length,
    last_event_at: lastEventAt,
    repaired: !existing,
  };
}
