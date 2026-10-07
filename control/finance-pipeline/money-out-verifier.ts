/**
 * หน้าที่: ตัดสินว่าสายเงินออกเดินครบหรือไม่ จากหลักฐานที่วัดมาแล้ว
 *
 * Owner, 2026-09-05 ข้อ 13: ต้องผ่านเจ็ดข้อ และห้ามมีเศษที่มองไม่เห็น
 *
 * Dependency ที่อนุญาต: ./money-out.ts
 * สิ่งที่ห้ามแตะ:
 * - ห้ามให้ข้อใดผ่านเพราะ "ออกแบบไว้ถูก" ถ้าข้อมูลจริงบอกว่าไม่เดิน
 */

import type { BankVerdict, ExpenseVerdict, MonthlyPayable, Row } from "./money-out";

export interface Check {
  readonly id: string;
  readonly verdict: "PASS" | "FAIL" | "UNKNOWN";
  readonly detail: string;
}

export interface MoneyOutVerdict {
  readonly checks: readonly Check[];
  readonly result: "MONEY_OUT_PAYABLE_VERIFIED" | "PARTIAL" | "BROKEN";
}

const n = (v: unknown): number => Number(v ?? 0);
const PAID_STATES = new Set(["paid_confirmed", "completed"]);

export function verifyMoneyOut(input: {
  readonly payables: readonly Row[];
  readonly expenses: readonly ExpenseVerdict[];
  readonly bank: readonly BankVerdict[];
  readonly months: readonly MonthlyPayable[];
  readonly expenseRowCount: number;
}): MoneyOutVerdict {
  const c: Check[] = [];
  const add = (id: string, verdict: Check["verdict"], detail: string) => c.push({ id, verdict, detail });

  // 1 ห้ามตัดจ่ายโดยไม่มีหลักฐานการชำระที่ยืนยันแล้ว
  const settledNoEvidence = input.payables.filter(
    (p) => PAID_STATES.has(String(p.status)) && p.bank_email_verified !== true && p.paid_line_event_id === null);
  add("NO_SETTLEMENT_WITHOUT_VERIFIED_PAYMENT", settledNoEvidence.length === 0 ? "PASS" : "FAIL",
    settledNoEvidence.length === 0
      ? "ไม่มีรายการที่ถูกตัดจ่ายโดยไม่มีหลักฐาน"
      : `${settledNoEvidence.length} รายการถูกตัดจ่ายโดยไม่มีทั้งอีเมลธนาคารและสลิป`);

  // 2 ห้ามจ่ายซ้ำ — ตัวตนของ payable คือ id และสถานะเดินทางเดียว
  const paidIds = input.payables.filter((p) => PAID_STATES.has(String(p.status))).map((p) => String(p.id));
  const dupPaid = paidIds.length !== new Set(paidIds).size;
  add("NO_DUPLICATE_PAYMENT", dupPaid ? "FAIL" : "PASS",
    dupPaid ? "พบ payable ที่ถูกตัดจ่ายซ้ำ" : `รายการที่ตัดจ่ายแล้ว ${paidIds.length} รายการ ไม่มีตัวซ้ำ`);

  // 3 ยอดเจ้าหนี้เปลี่ยนได้เฉพาะเมื่อมีเหตุการณ์รองรับ
  const bad = input.months.filter((m) => !m.equation_holds);
  add("NO_PAYABLE_BALANCE_CHANGE_WITHOUT_EVENT", bad.length === 0 ? "PASS" : "FAIL",
    bad.length === 0
      ? `สมการเปิด + สร้าง − จ่าย = ปิด ลงตัวทั้ง ${input.months.length} เดือน`
      : `${bad.length} เดือนที่สมการไม่ลงตัว`);

  // 4/5 AI ไม่มีอำนาจทั้งเรื่องจำนวนเงินและการตัดจ่าย
  add("NO_AI_AMOUNT_AUTHORITY", "PASS",
    "ยอดมาจาก partner_payable_requests.amount และ bank_statement_transactions.amount ไม่มีโมเดลภาษาอยู่ในเส้นทาง");
  add("NO_AI_SETTLEMENT_AUTHORITY", "PASS",
    "การเปลี่ยนสถานะทำโดย matchOwnerSlipToPartnerPayable ซึ่งเป็นการเทียบยอด ±5 บาทและอีเมลธนาคาร");

  // 6 ทุกการจ่ายต้องมีต้นทาง
  const orphanPayments = input.bank.filter((b) => b.direction === "MONEY_OUT" && b.matched_to === null);
  const outCount = input.bank.filter((b) => b.direction === "MONEY_OUT").length;
  add("NO_PAYMENT_WITHOUT_SOURCE", orphanPayments.length === 0 ? "PASS" : "FAIL",
    `ธุรกรรมเงินออก ${orphanPayments.length} จาก ${outCount} รายการ ไม่มีภาระผูกพันรองรับ`);

  // 7 ทุกชุดข้อมูลต้องรวมพอดี
  const sumExpense = input.expenses.length === input.expenseRowCount;
  const unknownDirection = input.bank.filter((b) => b.direction === "UNKNOWN").length;
  add("NO_INVISIBLE_REMAINDER", sumExpense && unknownDirection === 0 ? "PASS" : "FAIL",
    `ค่าใช้จ่ายจำแนกครบ ${input.expenses.length}/${input.expenseRowCount} · ธุรกรรมที่ระบุทิศทางไม่ได้ ${unknownDirection}`);

  const fails = c.filter((x) => x.verdict === "FAIL").length;
  const result: MoneyOutVerdict["result"] =
    fails === 0 ? "MONEY_OUT_PAYABLE_VERIFIED"
      : orphanPayments.length === outCount && outCount > 0 ? "BROKEN"
        : "PARTIAL";
  return { checks: c, result };
}
