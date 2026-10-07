/**
 * หน้าที่: จำลองการทำงานของตัวจับคู่การชำระเงินโดยไม่เขียนอะไรเลย
 *
 * Owner, 2026-09-05: ต้องพิสูจน์สายการเงินจากข้อมูล production จริง แบบอ่านอย่างเดียว
 *
 * ด่านทุกข้อในไฟล์นี้ **คัดลอกมาจากนิยามจริง** ของ RPC ที่อ่านออกมาจาก
 * production เมื่อ 2026-09-05 (เก็บไว้ที่
 * control/system-catalog/data/live-contract/reconcile_receipt_payment.sql)
 * ไม่ได้เดาจากชื่อฟังก์ชัน
 *
 * Input: แถวที่อ่านมาแบบจำกัดคอลัมน์
 * Output: ผลว่า "ถ้ารันจริงจะเกิดอะไร" พร้อมเหตุผล
 * Dependency ที่อนุญาต: ไม่มี
 * สิ่งที่ห้ามแตะ:
 * - ห้ามเรียก RPC จริง ห้ามเขียนอะไรทั้งสิ้น
 * - ห้ามผ่อนด่านให้ต่างจากนิยามจริง
 */

export interface ReceiptRow {
  readonly id: string;
  readonly customer_company_id: string | null;
  readonly document_type: string | null;
  readonly status: string | null;
  readonly amount: number | string | null;
  readonly transaction_datetime: string | null;
  readonly matched_debt_event_id: string | null;
  readonly payment_verified: boolean | null;
  readonly line_event_id: string | null;
  readonly reference_number: string | null;
}

export interface DebtEventRow {
  readonly id: string;
  readonly customer_company_id: string;
  readonly event_type: string;
  readonly amount: number | string | null;
  readonly occurred_at: string;
}

export interface SnapshotRow {
  readonly customer_company_id: string;
  readonly total_outstanding: number | string | null;
}

export type ShadowOutcome =
  | "WOULD_SETTLE" | "ALREADY_RECONCILED" | "NOT_RECONCILABLE"
  | "SNAPSHOT_MISSING" | "GENESIS_MISSING";

export interface ShadowResult {
  readonly case_ref: string;
  readonly claim: "PRESENT";
  readonly evidence: "SLIP_OR_ADVICE" | "OTHER_DOCUMENT" | "NONE";
  readonly verified_amount: number | null;
  readonly candidate_company: string | null;
  readonly match_result: ShadowOutcome;
  readonly would_settle: boolean;
  readonly would_update_balance: boolean;
  readonly balance_before: number | null;
  readonly balance_after_estimate: number | null;
  readonly would_create_document: boolean;
  readonly would_reply: boolean;
  readonly failure_reason: string | null;
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** ชนิดเอกสารที่ RPC ยอมรับ — จากนิยามจริงบรรทัด "document_type not in (...)" */
const RECONCILABLE_TYPES = new Set(["transfer_slip", "payment_advice"]);

export function shadowEvaluate(
  receipt: ReceiptRow,
  snapshots: ReadonlyMap<string, SnapshotRow>,
  eventsByCompany: ReadonlyMap<string, readonly DebtEventRow[]>,
): ShadowResult {
  const ref = receipt.id.slice(0, 8);
  const amount = num(receipt.amount);
  const evidence: ShadowResult["evidence"] = RECONCILABLE_TYPES.has(receipt.document_type ?? "")
    ? "SLIP_OR_ADVICE" : receipt.document_type ? "OTHER_DOCUMENT" : "NONE";

  const base = {
    case_ref: ref, claim: "PRESENT" as const, evidence, verified_amount: amount,
    candidate_company: receipt.customer_company_id,
    would_create_document: false, would_reply: true,
  };

  // ด่านที่ 1 ของ RPC: เคยจับคู่แล้วหรือ status = confirmed -> คืน already_reconciled โดยไม่เขียน
  if (receipt.matched_debt_event_id !== null || receipt.status === "confirmed") {
    return { ...base, match_result: "ALREADY_RECONCILED", would_settle: false, would_update_balance: false,
      balance_before: null, balance_after_estimate: null,
      failure_reason: "จับคู่ไปแล้ว การเรียกซ้ำจะไม่เขียนอะไร (ด่านกันซ้ำในตัว RPC)" };
  }

  // ด่านที่ 2: ชนิดเอกสาร บริษัท และจำนวนเงิน
  const reasons: string[] = [];
  if (!RECONCILABLE_TYPES.has(receipt.document_type ?? "")) reasons.push(`ชนิดเอกสาร "${receipt.document_type ?? "(ว่าง)"}" ไม่อยู่ใน transfer_slip/payment_advice`);
  if (receipt.customer_company_id === null) reasons.push("ไม่มี customer_company_id");
  if (amount === null || amount <= 0) reasons.push("ไม่มีจำนวนเงินที่มากกว่าศูนย์");
  if (reasons.length > 0) {
    return { ...base, match_result: "NOT_RECONCILABLE", would_settle: false, would_update_balance: false,
      balance_before: null, balance_after_estimate: null, would_reply: true,
      failure_reason: `RPC จะโยน receipt_not_reconcilable — ${reasons.join(" · ")}` };
  }

  const company = receipt.customer_company_id!;
  const snap = snapshots.get(company);
  if (snap === undefined) {
    return { ...base, match_result: "SNAPSHOT_MISSING", would_settle: false, would_update_balance: false,
      balance_before: null, balance_after_estimate: null,
      failure_reason: "RPC จะโยน debt_snapshot_not_found — บริษัทนี้ไม่มีแถวยอดหนี้" };
  }

  // ด่านของตัวคำนวณยอดจริง: replayDebtEvents ต้องมี debt_started ไม่งั้นคำนวณไม่ได้
  const events = eventsByCompany.get(company) ?? [];
  if (!events.some((e) => e.event_type === "debt_started")) {
    return { ...base, match_result: "GENESIS_MISSING", would_settle: false, would_update_balance: false,
      balance_before: num(snap.total_outstanding), balance_after_estimate: null,
      failure_reason: "ไม่มีเหตุการณ์ debt_started — replayDebtEvents ปฏิเสธการคำนวณยอดใหม่" };
  }

  const before = num(snap.total_outstanding) ?? 0;
  // สูตรเดียวกับ RPC: เงินต้นคือส่วนที่ไม่เกินยอดค้าง ส่วนเกินเป็นดอกเบี้ย/ค่าปรับ
  const principal = Math.min(amount!, before);
  return {
    ...base, match_result: "WOULD_SETTLE", would_settle: true, would_update_balance: true,
    balance_before: before,
    balance_after_estimate: Math.max(before - principal, 0),
    would_create_document: false,
    failure_reason: null,
  };
}
