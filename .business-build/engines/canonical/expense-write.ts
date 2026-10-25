/**
 * Canonical expense/payable write model (D3 deferred work landed, owner 2026-09-24).
 *
 * ONE writer for the two money-OUT tables (`company_expenses`,
 * `partner_payable_requests`) — the LINE tier's five direct write sites now
 * reach them only through the Connect expense bridge
 * (app/api/internal/connect/expense → this file). Mirrors the inbound/payment
 * pattern: callers pass canonical COMMANDS with evidence fields, never a row
 * shape; allow-list lives here; every write lands an audit row.
 *
 * No approval is minted here (Rule 72 unchanged):
 *   · requestPartnerPayable always starts `pending` — the status is writer-owned,
 *     a caller can never pass a different one;
 *   · transitionPartnerPayable accepts only the closed status set observed in
 *     production (pending → owner_acknowledged → completed | paid_confirmed)
 *     with a row-filtered update: 0 rows updated = wrong starting state or a
 *     race → throws PAYABLE_TRANSITION_INVALID (fail-closed, never a blind write);
 *   · completed_at follows the existing policy: only real bank confirmation
 *     (bank_email_verified) completes it — the writer derives it, the caller
 *     cannot fake completion time.
 *
 * No money math: amounts are evidence values stored as-is (>0 validated),
 * never recomputed, never split (debt/payment math stays in payment-write).
 */
import { supabaseAdmin } from "@/services/supabase/queries";
import { recordCanonicalAudit } from "@/engines/canonical/audit";

const round2 = (n: number) => Math.round(n * 100) / 100;

/** ช่องทางต้นทางของแถวค่าใช้จ่าย — vocabulary ปิด (writer-owned) · admin_manual = หน้าจอ Admin */
const EXPENSE_SOURCES = new Set(["line_chat", "subscription_email_sync", "admin_manual"]);

function requireAmount(amount: number): number {
  const a = Number(amount);
  if (!Number.isFinite(a) || a <= 0) {
    throw new Error(`EXPENSE_AMOUNT_INVALID: ยอดต้องมากกว่าศูนย์ (ได้ ${amount})`);
  }
  return round2(a);
}

function requireActor(actor: string | undefined): string {
  const a = actor?.trim() ?? "";
  if (!a) throw new Error("AUDIT_ACTOR_REQUIRED: every canonical write must carry an actor");
  return a;
}

export interface RecordCompanyExpenseInput {
  /** evidence document kind — exactly what the source flow classified (no default) */
  document_type: string;
  amount: number;
  vendor_name?: string | null;
  /** YYYY-MM-DD as read from the evidence — null stays null, never invented */
  expense_date?: string | null;
  /** set only when the expense row is anchored to a real inbound receipt */
  receipt_document_id?: string | null;
  /** set only when the expense came from a subscription_services observation */
  subscription_service_id?: string | null;
  submitted_by_line_user_id?: string | null;
  submitted_by_name?: string | null;
  submitted_by_role?: string | null;
  /** channel provenance — writer-owned allow-list (DB default 'line_chat' เมื่อไม่ส่ง):
   * admin_manual = หน้าจอ Admin กรอกเอง · line_chat = ทีมส่งในแชต · subscription_email_sync = ระบบตรวจเมล */
  source?: string | null;
  /** evidence breakdown (มี column จริงตั้งแต่ 2026-07-31) — เก็บ as-is ไม่คำนวณเอง ไม่บวกเพิ่ม */
  amount_pre_vat?: number | null;
  vat_amount?: number | null;
  tax_invoice_no?: string | null;
  notes?: string | null;
  actor: string;
  provenance?: Record<string, unknown> | null;
}

export interface CompanyExpenseResult {
  expense_id: string;
}

export async function recordCompanyExpense(input: RecordCompanyExpenseInput): Promise<CompanyExpenseResult> {
  const actor = requireActor(input.actor);
  const amount = requireAmount(input.amount);
  const documentType = input.document_type?.trim();
  if (!documentType) throw new Error("EXPENSE_DOCUMENT_TYPE_REQUIRED: ต้องมีชนิดเอกสารค่าใช้จ่าย");
  const source = input.source?.trim() || null;
  if (source && !EXPENSE_SOURCES.has(source)) {
    throw new Error(`EXPENSE_SOURCE_INVALID: source ต้องเป็นหนึ่งใน ${[...EXPENSE_SOURCES].join("/")} (ได้ ${source})`);
  }

  const db = supabaseAdmin();
  const { data, error } = await db
    .from("company_expenses")
    .insert({
      document_type: documentType,
      amount,
      vendor_name: input.vendor_name ?? null,
      expense_date: input.expense_date ?? null,
      receipt_document_id: input.receipt_document_id ?? null,
      subscription_service_id: input.subscription_service_id ?? null,
      submitted_by_line_user_id: input.submitted_by_line_user_id ?? null,
      submitted_by_name: input.submitted_by_name ?? null,
      submitted_by_role: input.submitted_by_role ?? null,
      ...(source ? { source } : {}),
      amount_pre_vat: input.amount_pre_vat ?? null,
      vat_amount: input.vat_amount ?? null,
      tax_invoice_no: input.tax_invoice_no ?? null,
      notes: input.notes ?? null,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`บันทึกค่าใช้จ่ายไม่สำเร็จ: ${error?.message ?? "no row"}`);

  await recordCanonicalAudit({
    action: "expense.recorded",
    entity_type: "company_expense",
    entity_id: String(data.id),
    actor,
    new_value: { amount, document_type: documentType, expense_date: input.expense_date ?? null },
    evidence: {
      vendor_name: input.vendor_name ?? null,
      receipt_document_id: input.receipt_document_id ?? null,
      subscription_service_id: input.subscription_service_id ?? null,
      submitted_by_role: input.submitted_by_role ?? null,
      source: source ?? "line_chat",
      provenance: input.provenance ?? null,
    },
  });
  return { expense_id: String(data.id) };
}

// ── partner payable requests (owner's outgoing-bill workflow) ────────────────

export interface RequestPartnerPayableInput {
  partner_company_id?: string | null;
  /** evidence: ชื่อพาร์ตเนอร์ตามที่ระบบมี — ห้ามว่าง */
  partner_name: string;
  partner_line_user_id?: string | null;
  amount: number;
  description?: string | null;
  business_event_id?: string | null;
  actor: string;
  provenance?: Record<string, unknown> | null;
}

export interface PartnerPayableResult {
  payable_id: string;
}

export async function requestPartnerPayable(input: RequestPartnerPayableInput): Promise<PartnerPayableResult> {
  const actor = requireActor(input.actor);
  const amount = requireAmount(input.amount);
  const partnerName = input.partner_name?.trim();
  if (!partnerName) throw new Error("PAYABLE_PARTNER_REQUIRED: ต้องมีชื่อพาร์ตเนอร์");

  const db = supabaseAdmin();
  // status เป็นของ writer เสมอ — caller ไม่มีทางส่ง status อื่นเข้ามา (Rule 72)
  const { data, error } = await db
    .from("partner_payable_requests")
    .insert({
      partner_company_id: input.partner_company_id ?? null,
      partner_name: partnerName,
      partner_line_user_id: input.partner_line_user_id ?? null,
      amount,
      description: input.description ?? null,
      business_event_id: input.business_event_id ?? null,
      status: "pending",
      owner_notified_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`สร้างคำขอจ่ายเงินไม่สำเร็จ: ${error?.message ?? "no row"}`);

  await recordCanonicalAudit({
    action: "payable.requested",
    entity_type: "partner_payable_request",
    entity_id: String(data.id),
    actor,
    new_value: { amount, partner_name: partnerName, status: "pending" },
    evidence: {
      business_event_id: input.business_event_id ?? null,
      partner_company_id: input.partner_company_id ?? null,
      provenance: input.provenance ?? null,
    },
  });
  return { payable_id: String(data.id) };
}

export type PayableTransitionTarget = "owner_acknowledged" | "completed" | "paid_confirmed";

/** starting states each target may move FROM — production-observed, closed */
const PAYABLE_TRANSITION_FROM: Record<PayableTransitionTarget, string[]> = {
  owner_acknowledged: ["pending"],
  completed: ["pending", "owner_acknowledged"],
  paid_confirmed: ["pending", "owner_acknowledged"],
};

export interface TransitionPartnerPayableInput {
  payable_id: string;
  to: PayableTransitionTarget;
  /** เฉพาะ completed/paid_confirmed — แถว LINE message ที่ยืนยันการโอน */
  paid_line_event_id?: string | null;
  /** เฉพาะ completed/paid_confirmed — หลักฐานอีเมลธนาคารจริงเท่านั้น */
  bank_email_verified?: boolean;
  actor: string;
  provenance?: Record<string, unknown> | null;
}

export async function transitionPartnerPayable(input: TransitionPartnerPayableInput): Promise<PartnerPayableResult & { status: string }> {
  const actor = requireActor(input.actor);
  const to = input.to;
  if (!(to in PAYABLE_TRANSITION_FROM)) {
    throw new Error(`PAYABLE_TARGET_INVALID: อนุญาตเฉพาะ owner_acknowledged/completed/paid_confirmed (ได้ ${String(to)})`);
  }

  const nowIso = new Date().toISOString();
  let payload: Record<string, unknown>;
  if (to === "owner_acknowledged") {
    payload = { status: to, owner_acknowledged_at: nowIso };
  } else {
    const verified = Boolean(input.bank_email_verified);
    payload = {
      status: to,
      paid_line_event_id: input.paid_line_event_id ?? null,
      bank_email_verified: verified,
      // policy ของเดิม: เสร็จสมบูรณ์เฉพาะเมื่อ bank email ยืนยันจริง — writer derive เอง
      completed_at: verified ? nowIso : null,
    };
  }

  const db = supabaseAdmin();
  const { data, error } = await db
    .from("partner_payable_requests")
    .update(payload)
    .eq("id", input.payable_id)
    .in("status", PAYABLE_TRANSITION_FROM[to])
    .select("id, status");
  if (error) throw new Error(`อัปเดตคำขอจ่ายเงินไม่สำเร็จ: ${error.message}`);
  if (!data || data.length === 0) {
    // 0 rows = starting state ไม่ตรง (เพิ่งถูก transition ไปแล้ว / ไม่มีแถว) — fail-closed
    throw new Error("PAYABLE_TRANSITION_INVALID: สถานะปัจจุบันของรายการนี้ไม่รับการเปลี่ยนผ่านนี้");
  }

  await recordCanonicalAudit({
    action: "payable.transitioned",
    entity_type: "partner_payable_request",
    entity_id: input.payable_id,
    actor,
    new_value: { status: to },
    evidence: {
      bank_email_verified: to === "owner_acknowledged" ? null : Boolean(input.bank_email_verified),
      paid_line_event_id: input.paid_line_event_id ?? null,
      provenance: input.provenance ?? null,
    },
  });
  return { payable_id: input.payable_id, status: String((data as { status: string }[])[0].status) };
}

