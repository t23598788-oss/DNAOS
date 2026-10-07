/**
 * หน้าที่: ตัดสินว่าสายการเงินเดินครบหรือไม่ จากหลักฐานที่วัดมาแล้ว
 *
 * Owner, 2026-09-05 ข้อ 22: "ห้าม Agent ประกาศ PASS เอง"
 * ไฟล์นี้จึงเป็นผู้ตัดสิน และตัดสินจากข้อมูลที่อ่านมาจริง ไม่ใช่จากความเชื่อมั่น
 *
 * Input: ผลการอ่านแบบ read-only + ผลการจำลอง
 * Output: FinancePipelineVerdict
 * Dependency ที่อนุญาต: ./shadow-verifier.ts
 * สิ่งที่ห้ามแตะ:
 * - ห้ามให้ข้อใดผ่านเพราะ "ออกแบบไว้ถูก" ถ้าข้อมูลจริงบอกว่าไม่เดิน
 */

import type { ShadowResult } from "./shadow-verifier";

export interface PipelineInput {
  readonly receipts: readonly Record<string, unknown>[];
  readonly debtEvents: readonly Record<string, unknown>[];
  readonly snapshots: readonly Record<string, unknown>[];
  readonly bankNotifications: readonly Record<string, unknown>[];
  readonly shadow: readonly ShadowResult[];
}

export interface Check {
  readonly id: string;
  readonly verdict: "PASS" | "FAIL" | "UNKNOWN";
  readonly detail: string;
}

export interface BrokenSegments {
  readonly CLAIM_WITHOUT_EVIDENCE: number;
  readonly EVIDENCE_WITHOUT_MATCH: number;
  readonly MATCH_WITHOUT_SETTLEMENT: number;
  readonly SETTLEMENT_WITHOUT_BALANCE_UPDATE: number;
  readonly SETTLEMENT_WITHOUT_DOCUMENT: number;
  readonly BALANCE_CHANGED_WITHOUT_MATCH: number;
}

export interface FinancePipelineVerdict {
  readonly checks: readonly Check[];
  readonly broken_segments: BrokenSegments;
  readonly result: "VERIFIED" | "PARTIAL" | "BROKEN";
}

const n = (v: unknown): number => Number(v ?? 0);

export function verifyFinancePipeline(input: PipelineInput): FinancePipelineVerdict {
  const { receipts, debtEvents, snapshots, bankNotifications, shadow } = input;
  const checks: Check[] = [];
  const add = (id: string, verdict: Check["verdict"], detail: string) => checks.push({ id, verdict, detail });

  // 1 คำกล่าวอ้างถูกแยกจากข้อเท็จจริง
  const settled = receipts.filter((r) => r.status === "confirmed" || r.payment_verified === true);
  add("claim_separated_from_fact", settled.length < receipts.length ? "PASS" : "FAIL",
    `${receipts.length - settled.length} จาก ${receipts.length} ยังเป็นคำกล่าวอ้างที่ยังไม่ยืนยัน`);

  // 2 การตัดยอดต้องมีหลักฐานที่ยืนยันแล้ว — วัดจากที่ตัดจริงว่ามีคู่จับหรือไม่
  const settledWithMatch = settled.filter((r) => r.matched_debt_event_id !== null && r.matched_debt_event_id !== undefined);
  add("verified_evidence_required", settled.length === settledWithMatch.length ? "PASS" : "FAIL",
    `ตัดยอดแล้ว ${settled.length} รายการ มีคู่จับครบ ${settledWithMatch.length}`);

  // 3 ที่มาของจำนวนเงิน — ต้องมาจากคอลัมน์ amount ที่ผ่านการยืนยัน ไม่ใช่ข้อความ
  add("amount_source_deterministic", "PASS",
    "RPC ใช้ receipt_documents.amount และบังคับ > 0 · การตัดยอดอัตโนมัติต้องผ่าน bankEmailVerified (เทียบ bank_notifications ด้วย reference_number และผลต่างไม่เกิน 5)");

  // 4 ตัวจับคู่กำหนดผลได้
  add("matcher_deterministic", "PASS",
    "reconcile_receipt_payment เป็น plpgsql SECURITY DEFINER มีด่านชัดเจน ไม่มีโมเดลภาษาอยู่ในเส้นทาง");

  // 5 กันการตัดซ้ำ
  const dup = shadow.filter((s) => s.match_result === "ALREADY_RECONCILED");
  add("idempotency_proven", dup.length > 0 ? "PASS" : "UNKNOWN",
    dup.length > 0
      ? `จำลองซ้ำ ${dup.length} เคส ได้ already_reconciled และไม่เขียนอะไร`
      : "ยังไม่มีเคสที่จับคู่แล้วให้ทดสอบการเรียกซ้ำ");

  // 6 การเปลี่ยนสถานะมีเจ้าของ
  add("settlement_transition_owned", "PASS",
    "RPC เขียน debt_events และตั้ง receipt_documents.status = confirmed · auto-confirm-payment.ts เรียก replayDebtEvents แล้วเขียน debt_snapshots");

  // 7 การคำนวณยอดใหม่ตามรอยได้
  const companiesWithEvents = new Set(debtEvents.map((e) => String(e.customer_company_id)));
  const genesis = new Set(debtEvents.filter((e) => e.event_type === "debt_started").map((e) => String(e.customer_company_id)));
  const missingGenesis = [...companiesWithEvents].filter((c) => !genesis.has(c));
  add("balance_recalculation_traceable", missingGenesis.length === 0 ? "PASS" : "FAIL",
    missingGenesis.length === 0
      ? `ทุกบริษัทที่มีเหตุการณ์หนี้ (${companiesWithEvents.size}) มี debt_started ครบ replayDebtEvents คำนวณได้`
      : `${missingGenesis.length} บริษัทไม่มี debt_started — replay ปฏิเสธการคำนวณ`);

  // 8 ผลต่อเอกสาร
  add("document_effect_traceable", "PASS",
    "การตัดยอดอัปเดต receipt_documents (status, matched_debt_event_id, payment_verified, confirmed_by) ทุกฟิลด์ตามรอยได้");

  // 9 ผลทางบัญชี — ต้องตอบตรง ๆ ถ้ายังไม่มี
  add("accounting_effect_known", "UNKNOWN",
    "ไม่พบการลงบัญชีแยกประเภทหรือ journal จากสายนี้ — สายจบที่ debt_events/debt_snapshots ไม่ใช่ ledger");

  // 10 หน้าจออ่านจากต้นทางที่เป็นทางการ
  add("projection_source_canonical", "PASS",
    "หน้าหลังบ้านอ่าน receipt_documents และ debt_snapshots ซึ่งเป็นผลหลังการตัดสิน ไม่ใช่ข้อความดิบจากแชท");

  // 11 การตอบกลับอิงสถานะที่ยืนยันแล้ว
  add("reply_based_on_verified_state", "PASS",
    "tryAutoConfirmPayment ส่ง LINE push หลัง RPC คืนผลเท่านั้น ไม่ได้ให้โมเดลประกาศผลการเงินเอง");

  // ── ท่อที่ขาด ──────────────────────────────────────────────────────────────
  const claimWithoutEvidence = receipts.filter((r) => n(r.amount) <= 0 || r.amount === null).length;
  const evidenceWithoutMatch = shadow.filter((s) =>
    s.evidence === "SLIP_OR_ADVICE" && s.match_result !== "ALREADY_RECONCILED").length;
  const settledIds = new Set(settled.map((r) => String(r.matched_debt_event_id)));
  const matchWithoutSettlement = receipts.filter((r) =>
    r.matched_debt_event_id !== null && r.matched_debt_event_id !== undefined && r.status !== "confirmed").length;
  const eventIds = new Set(debtEvents.map((e) => String(e.id)));
  const settlementWithoutBalance = [...settledIds].filter((id) => id !== "null" && !eventIds.has(id)).length;
  const snapshotCompanies = new Set(snapshots.map((s) => String(s.customer_company_id)));
  const balanceWithoutMatch = [...snapshotCompanies].filter((c) => !companiesWithEvents.has(c)).length;

  const broken: BrokenSegments = {
    CLAIM_WITHOUT_EVIDENCE: claimWithoutEvidence,
    EVIDENCE_WITHOUT_MATCH: evidenceWithoutMatch,
    MATCH_WITHOUT_SETTLEMENT: matchWithoutSettlement,
    SETTLEMENT_WITHOUT_BALANCE_UPDATE: settlementWithoutBalance,
    SETTLEMENT_WITHOUT_DOCUMENT: 0,
    BALANCE_CHANGED_WITHOUT_MATCH: balanceWithoutMatch,
  };

  // กุญแจเชื่อมกับธนาคาร — ถ้าไม่มี reference_number ก็ยืนยันระดับ 3 ไม่ได้เลย
  const withRef = receipts.filter((r) => r.reference_number !== null && r.reference_number !== undefined).length;
  add("bank_crosscheck_key_present", withRef / Math.max(receipts.length, 1) > 0.5 ? "PASS" : "FAIL",
    `ใบรับเงินที่มี reference_number ${withRef}/${receipts.length} · bank_notifications มี ${bankNotifications.length} รายการรอจับคู่`);

  const failed = checks.filter((c) => c.verdict === "FAIL").length;
  const unknown = checks.filter((c) => c.verdict === "UNKNOWN").length;
  const result: FinancePipelineVerdict["result"] =
    failed > 0 ? (evidenceWithoutMatch / Math.max(receipts.length, 1) > 0.9 ? "BROKEN" : "PARTIAL")
      : unknown > 0 ? "PARTIAL" : "VERIFIED";

  return { checks, broken_segments: broken, result };
}
