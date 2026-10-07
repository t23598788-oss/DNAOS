/**
 * หน้าที่: ยอดเงินสดจริงจากธนาคาร และสรุปค่าใช้จ่าย แยกจากกันคนละชั้น
 *
 * Owner, 2026-09-05:
 * ข้อ 1 — ธนาคารคือความจริงของเงินสด ห้ามตั้ง MONEY_OUT = 0 เพราะ payable
 *        จับคู่ไม่ได้ ธุรกรรมที่จับคู่ไม่ได้ยังนับเป็นการเคลื่อนของเงินเสมอ
 * ข้อ 3 — payable เป็นเพียงชั้นความสัมพันธ์ ห้ามใช้เป็นประตูของเงินสดหรือค่าใช้จ่าย
 * ข้อ 5 — ห้ามซ่อนรายการเพราะเอกสารขาด
 * ข้อ 7 — ถ้ายอดคำนวณไม่ตรงกับยอดจริงของธนาคาร ให้รายงานส่วนต่าง ห้ามปรับให้ตรง
 *
 * หมวดค่าใช้จ่ายใช้กติกาเดิมจาก app/api/admin/finance-summary/route.ts:30
 * ซึ่งเจ้าของสั่งไว้เมื่อ 2026-07-31 ว่าให้แยกตามบิลจริง ไม่ใช่สร้างหมวดใหม่
 *
 * Dependency ที่อนุญาต: ./money-out.ts (ตัวแปลงวันที่และทิศทาง)
 * สิ่งที่ห้ามแตะ:
 * - ห้ามใช้สถานะ payable มากรองว่าจะนับเงินออกหรือไม่
 * - ห้ามปรับยอดคำนวณให้เท่ากับยอดธนาคาร
 */

import { parseBankMonth, type Row } from "./money-out";
import { parseBankDate } from "./payable-linkage";

const n = (v: unknown): number => { const x = Number(v ?? 0); return Number.isFinite(x) ? x : 0; };
const round2 = (x: number) => Math.round(x * 100) / 100;

// ─── §1 การเคลื่อนของเงินสด ─────────────────────────────────────────────────

export type CashDirection = "MONEY_IN" | "MONEY_OUT" | "BANK_FEE" | "INTERNAL_TRANSFER" | "UNKNOWN";

/** คำไทยจริงจาก production — ห้ามเดาเป็นคำอังกฤษ */
const IN_KINDS = new Set(["รับโอนเงิน", "ฝากเงินสด", "รับดอกเบี้ยเงินฝาก"]);
const OUT_KINDS = new Set(["ชำระเงิน", "โอนเงิน", "โอนเงิน/ชำระเงิน"]);
const FEE_KINDS = new Set(["ภาษีหัก ณ ที่จ่าย", "ค่าธรรมเนียม"]);

export interface CashMovement {
  readonly id: string;
  readonly date: string;
  readonly month: string;
  readonly direction: CashDirection;
  readonly amount: number;
  readonly balance_after: number | null;
  readonly kind: string;
}

export function toCashMovements(rows: readonly Row[]): readonly CashMovement[] {
  return rows.map((b) => {
    const kind = String(b.kind ?? "").trim();
    const direction: CashDirection =
      FEE_KINDS.has(kind) ? "BANK_FEE"
        : OUT_KINDS.has(kind) ? "MONEY_OUT"
          : IN_KINDS.has(kind) ? "MONEY_IN"
            : "UNKNOWN";
    const balance = b.balance_after === null || b.balance_after === undefined ? null : n(b.balance_after);
    return {
      id: String(b.id), date: parseBankDate(b.transaction_date), month: parseBankMonth(b.transaction_date),
      direction, amount: n(b.amount), balance_after: balance, kind,
    };
  });
}

export interface CashPosition {
  readonly opening_balance: number | null;
  readonly money_in: number;
  readonly money_out: number;
  readonly bank_fees: number;
  readonly internal_transfers: number;
  readonly closing_calculated: number | null;
  readonly closing_actual: number | null;
  readonly reconciliation_gap: number | null;
  readonly reconciles: boolean;
  readonly note: string;
}

/**
 * §7 ยอดเปิดหาได้จาก balance_after ของรายการแรกย้อนกลับด้วยยอดของรายการนั้นเอง
 * ต้องเรียงตามวันที่จริงก่อน ไม่ใช่ตามลำดับในไฟล์
 */
export function cashPosition(movements: readonly CashMovement[]): CashPosition {
  const dated = movements.filter((m) => m.date !== "").sort((a, b) => a.date.localeCompare(b.date));
  const sum = (d: CashDirection) => round2(dated.filter((m) => m.direction === d).reduce((a, m) => a + m.amount, 0));
  const moneyIn = sum("MONEY_IN");
  const moneyOut = sum("MONEY_OUT");
  const fees = sum("BANK_FEE");
  const transfers = sum("INTERNAL_TRANSFER");

  const first = dated.find((m) => m.balance_after !== null);
  const last = [...dated].reverse().find((m) => m.balance_after !== null);
  if (first === undefined || last === undefined) {
    return {
      opening_balance: null, money_in: moneyIn, money_out: moneyOut, bank_fees: fees,
      internal_transfers: transfers, closing_calculated: null, closing_actual: null,
      reconciliation_gap: null, reconciles: false,
      note: "statement ไม่มียอดคงเหลือให้เทียบ จึงยืนยันยอดปิดไม่ได้",
    };
  }

  // ยอดก่อนรายการแรก = ยอดหลังรายการแรก ลบผลของรายการนั้น
  const firstEffect = first.direction === "MONEY_IN" ? first.amount
    : first.direction === "MONEY_OUT" || first.direction === "BANK_FEE" ? -first.amount : 0;
  const opening = round2(first.balance_after! - firstEffect);
  const calculated = round2(opening + moneyIn - moneyOut - fees + transfers);
  const actual = last.balance_after!;
  const gap = round2(calculated - actual);

  return {
    opening_balance: opening, money_in: moneyIn, money_out: moneyOut, bank_fees: fees,
    internal_transfers: transfers, closing_calculated: calculated, closing_actual: actual,
    reconciliation_gap: gap, reconciles: Math.abs(gap) < 0.01,
    note: Math.abs(gap) < 0.01
      ? "ยอดคำนวณตรงกับยอดคงเหลือจริงของธนาคาร"
      : `ยอดคำนวณต่างจากยอดจริง ${gap} บาท — รายงานตามจริง ไม่ปรับให้ตรง`,
  };
}

// ─── §2 สรุปค่าใช้จ่าย แยกจากเงินสดโดยสิ้นเชิง ──────────────────────────────

export type ExpenseCategory =
  | "FUEL" | "MATERIAL" | "SERVICE" | "TRANSPORT" | "FEE" | "TAX" | "OTHER" | "UNKNOWN";

/**
 * แปลงหมวดเดิมของ finance-summary ให้เป็นรหัสที่ส่งต่อได้
 * กติกาการตัดสินคงเดิมทุกข้อ: ดูผู้ขายก่อน แล้วจึงดูชนิดเอกสาร
 */
export function categorizeExpense(documentType: unknown, vendorName: unknown): ExpenseCategory {
  const vendor = String(vendorName ?? "").toLowerCase();
  if (vendor.includes("supabase")) return "SERVICE";
  switch (String(documentType)) {
    case "fuel_bill": return "FUEL";
    case "partner_payable": return "MATERIAL";
    case "tax_invoice": return "TAX";
    case "invoice": return "OTHER";
    case "receipt": return "OTHER";
    case "subscription": return "SERVICE";
    default: return String(documentType) === "null" || documentType === null ? "UNKNOWN" : "OTHER";
  }
}

export interface ExpenseLine {
  readonly id: string;
  readonly month: string;
  readonly amount: number;
  readonly category: ExpenseCategory;
  readonly has_document: boolean;
  readonly has_tax_invoice: boolean;
  readonly has_bank_match: boolean;
}

export function toExpenseLines(
  expenses: readonly Row[],
  bankMatchedExpenseIds: ReadonlySet<string>,
): readonly ExpenseLine[] {
  return expenses.map((e) => ({
    id: String(e.id),
    month: String(e.expense_date ?? e.created_at ?? "").slice(0, 7),
    amount: n(e.amount),
    category: categorizeExpense(e.document_type, e.vendor_name),
    // §5 ไม่ซ่อนรายการที่เอกสารขาด แต่ต้องบอกได้ว่าขาด
    has_document: e.receipt_document_id !== null && e.receipt_document_id !== undefined,
    has_tax_invoice: typeof e.tax_invoice_no === "string" && e.tax_invoice_no !== "",
    has_bank_match: bankMatchedExpenseIds.has(String(e.id)),
  }));
}

// ─── §6 สรุปรายเดือนสำหรับเจ้าของ ───────────────────────────────────────────

export interface MonthlyOwnerSummary {
  readonly month: string;
  readonly opening_cash: number | null;
  readonly money_in: number;
  readonly money_out: number;
  readonly bank_fees: number;
  readonly closing_cash: number | null;
  readonly expense_total: number;
  readonly by_category: Readonly<Record<string, number>>;
  readonly matched_money_out: number;
  readonly unmatched_money_out: number;
  readonly documented_expense: number;
  readonly undocumented_expense: number;
  readonly payable_created: number;
  readonly payable_paid: number;
}

export function monthlyOwnerSummary(input: {
  readonly movements: readonly CashMovement[];
  readonly expenses: readonly ExpenseLine[];
  readonly payables: readonly Row[];
  readonly matchedMovementIds: ReadonlySet<string>;
}): readonly MonthlyOwnerSummary[] {
  const months = [...new Set([
    ...input.movements.map((m) => m.month),
    ...input.expenses.map((e) => e.month),
    ...input.payables.map((p) => String(p.created_at).slice(0, 7)),
  ])].filter((m) => m !== "").sort();

  return months.map((month) => {
    const mv = input.movements.filter((m) => m.month === month);
    const ex = input.expenses.filter((e) => e.month === month);
    const dated = [...mv].filter((m) => m.date !== "").sort((a, b) => a.date.localeCompare(b.date));
    const firstBal = dated.find((m) => m.balance_after !== null);
    const lastBal = [...dated].reverse().find((m) => m.balance_after !== null);
    const sum = (d: CashDirection) => round2(mv.filter((m) => m.direction === d).reduce((a, m) => a + m.amount, 0));
    const out = mv.filter((m) => m.direction === "MONEY_OUT");

    const byCat: Record<string, number> = {};
    for (const e of ex) byCat[e.category] = round2((byCat[e.category] ?? 0) + e.amount);

    const openingEffect = firstBal === undefined ? null
      : firstBal.balance_after! - (firstBal.direction === "MONEY_IN" ? firstBal.amount
        : firstBal.direction === "MONEY_OUT" || firstBal.direction === "BANK_FEE" ? -firstBal.amount : 0);

    return {
      month,
      opening_cash: openingEffect === null ? null : round2(openingEffect),
      money_in: sum("MONEY_IN"), money_out: sum("MONEY_OUT"), bank_fees: sum("BANK_FEE"),
      closing_cash: lastBal?.balance_after ?? null,
      expense_total: round2(ex.reduce((a, e) => a + e.amount, 0)),
      by_category: byCat,
      // §4 ทุกสถานะยังอยู่ใน money_out เสมอ ตัวเลขสองบรรทัดนี้เป็นการแยกให้ดู ไม่ใช่การกรอง
      matched_money_out: round2(out.filter((m) => input.matchedMovementIds.has(m.id)).reduce((a, m) => a + m.amount, 0)),
      unmatched_money_out: round2(out.filter((m) => !input.matchedMovementIds.has(m.id)).reduce((a, m) => a + m.amount, 0)),
      documented_expense: round2(ex.filter((e) => e.has_document).reduce((a, e) => a + e.amount, 0)),
      undocumented_expense: round2(ex.filter((e) => !e.has_document).reduce((a, e) => a + e.amount, 0)),
      payable_created: round2(input.payables.filter((p) => String(p.created_at).slice(0, 7) === month).reduce((a, p) => a + n(p.amount), 0)),
      payable_paid: round2(input.payables
        .filter((p) => ["paid_confirmed", "completed"].includes(String(p.status))
          && String(p.completed_at ?? p.created_at).slice(0, 7) === month)
        .reduce((a, p) => a + n(p.amount), 0)),
    };
  });
}
