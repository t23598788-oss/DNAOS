/**
 * หน้าที่: เชื่อมเงินออกจากธนาคารเข้ากับภาระผูกพันและเอกสาร โดยไม่เดา
 *
 * Owner, 2026-09-05:
 * ข้อ 1 — ธุรกรรมธนาคารคือ "ข้อเท็จจริงว่าเงินเคลื่อน" ห้ามสร้างค่าใช้จ่าย
 *        ภาระผูกพัน การตัดจ่าย หรือผลทางภาษี จากมันโดยลำพัง
 * ข้อ 6 — การจับคู่ต้องมีฐานที่กำหนดผลได้ ห้ามให้ AI เดาว่าเป็นค่าใช้จ่ายอะไร
 * ข้อ 10 — ถ้าช่วงเวลาไม่ทับกัน ให้รายงานเป็นช่องว่างของข้อมูล
 *        ห้ามสร้างความสัมพันธ์ข้ามเดือนเพื่อให้ตัวเลขดูครบ
 *
 * ข้อจำกัดที่พิสูจน์แล้วจากสคีมาจริง: bank_statement_transactions **ไม่มี**
 * คอลัมน์ระบุคู่ค้าเลย (มีแค่ description ที่เป็นข้อความอิสระ กับ channel)
 * ฐานการจับคู่ที่สัญญาเดิมรองรับจึงเหลือเพียงเอกสารอ้างอิงตรง ๆ กับยอด+ช่วงวัน
 *
 * Dependency ที่อนุญาต: ./money-out.ts
 * สิ่งที่ห้ามแตะ:
 * - ห้ามสร้าง payable จากธุรกรรมธนาคารอย่างเดียว
 * - ห้ามอ่าน description แล้วเดาว่าเป็นคู่ค้ารายไหน
 * - ห้ามให้ผลจับคู่ที่มีผู้สมัครหลายรายผ่านเป็น MATCHED
 */

import { parseBankMonth, type Row } from "./money-out";

const n = (v: unknown): number => { const x = Number(v ?? 0); return Number.isFinite(x) ? x : 0; };
const round2 = (x: number) => Math.round(x * 100) / 100;

/** §3 แปลงวันที่ของ statement ที่เก็บเป็นข้อความ ไม่ใช้การตัดสตริงแบบ ISO */
export function parseBankDate(raw: unknown): string {
  const s = String(raw ?? "").trim();
  const m = s.match(/^(\d{2})-(\d{2})-(\d{2}|\d{4})$/);
  if (m === null) return "";
  const [, dd, mm, yy] = m;
  const day = Number(dd); const mon = Number(mm);
  if (day < 1 || day > 31 || mon < 1 || mon > 12) return "";
  const year = yy.length === 2 ? `20${yy}` : yy;
  return `${year}-${mm}-${dd}`;
}

export type MatchBasis =
  | "EXACT_DOCUMENT_REF" | "AMOUNT_AND_DATE_WINDOW" | "NONE";

export type MatchResult =
  | "EXACT_MATCH" | "NO_OBLIGATION" | "AMBIGUOUS" | "INSUFFICIENT_EVIDENCE";

export interface ShadowMatch {
  readonly bank_transaction_id: string;
  readonly amount: number;
  readonly date: string;
  readonly month: string;
  readonly candidate_obligation: string | null;
  readonly candidate_document: string | null;
  readonly candidate_partner: string | null;
  readonly match_basis: MatchBasis;
  readonly result: MatchResult;
  readonly detail: string;
}

/** ช่วงวันที่ยอมให้ห่างกันได้ — แคบไว้ก่อน กว้างกว่านี้ต้องมีเหตุผลจากสัญญา */
const DATE_WINDOW_DAYS = 7;
/** ความคลาดเคลื่อนของยอด ใช้ค่าเดียวกับ matchOwnerSlipToPartnerPayable */
const AMOUNT_TOLERANCE = 5;

function daysApart(a: string, b: string): number | null {
  if (a === "" || b === "") return null;
  const ta = Date.parse(a); const tb = Date.parse(b);
  if (Number.isNaN(ta) || Number.isNaN(tb)) return null;
  return Math.abs(ta - tb) / 86_400_000;
}

/**
 * §5/§9 หาผู้สมัครของธุรกรรมเงินออกหนึ่งรายการ
 *
 * ลำดับฐานการจับคู่: เอกสารอ้างอิงตรงก่อนเสมอ แล้วจึงยอด+ช่วงวัน
 * ถ้าผู้สมัครมากกว่าหนึ่ง ตอบ AMBIGUOUS ไม่เลือกให้
 */
export function shadowMatchMoneyOut(
  bankRow: Row,
  payables: readonly Row[],
  expenses: readonly Row[],
): ShadowMatch {
  const id = String(bankRow.id);
  const amount = n(bankRow.amount);
  const date = parseBankDate(bankRow.transaction_date);
  const month = parseBankMonth(bankRow.transaction_date);
  const base = { bank_transaction_id: id, amount, date, month };

  // ฐานที่ 1 — เอกสารอ้างอิงตรง ๆ ที่ธนาคารผูกไว้แล้ว
  const docRef = bankRow.matched_receipt_document_id;
  if (docRef !== null && docRef !== undefined && String(docRef) !== "") {
    return {
      ...base, candidate_obligation: null, candidate_document: String(docRef),
      candidate_partner: null, match_basis: "EXACT_DOCUMENT_REF", result: "EXACT_MATCH",
      detail: "ธนาคารผูกกับเอกสารไว้แล้ว",
    };
  }

  if (date === "") {
    return {
      ...base, candidate_obligation: null, candidate_document: null, candidate_partner: null,
      match_basis: "NONE", result: "INSUFFICIENT_EVIDENCE", detail: "แปลงวันที่ของรายการไม่ได้",
    };
  }

  // ฐานที่ 2 — ยอดตรงในช่วงวันที่กำหนด
  // ผู้สมัครมาจากภาระผูกพันที่ยังรอจ่าย และจากค่าใช้จ่ายที่บันทึกไว้
  const payableHits = payables.filter((p) =>
    ["pending", "owner_acknowledged"].includes(String(p.status))
    && Math.abs(n(p.amount) - amount) <= AMOUNT_TOLERANCE
    && (daysApart(date, String(p.created_at).slice(0, 10)) ?? Infinity) <= DATE_WINDOW_DAYS);

  const expenseHits = expenses.filter((e) =>
    n(e.amount) > 0
    && Math.abs(n(e.amount) - amount) <= AMOUNT_TOLERANCE
    && (daysApart(date, String(e.expense_date ?? "").slice(0, 10)) ?? Infinity) <= DATE_WINDOW_DAYS);

  const total = payableHits.length + expenseHits.length;
  if (total === 0) {
    return {
      ...base, candidate_obligation: null, candidate_document: null, candidate_partner: null,
      match_basis: "NONE", result: "NO_OBLIGATION",
      detail: `ไม่พบภาระผูกพันหรือค่าใช้จ่ายที่ยอดต่างไม่เกิน ${AMOUNT_TOLERANCE} บาทภายใน ${DATE_WINDOW_DAYS} วัน`,
    };
  }
  if (total > 1) {
    return {
      ...base, candidate_obligation: null, candidate_document: null, candidate_partner: null,
      match_basis: "AMOUNT_AND_DATE_WINDOW", result: "AMBIGUOUS",
      detail: `มีผู้สมัคร ${total} ราย (payable ${payableHits.length} · expense ${expenseHits.length}) — ไม่เลือกให้`,
    };
  }

  const p = payableHits[0];
  const e = expenseHits[0];
  return {
    ...base,
    candidate_obligation: p !== undefined ? String(p.id) : null,
    candidate_document: e !== undefined ? String(e.receipt_document_id ?? "") || null : null,
    // ธุรกรรมธนาคารไม่มีคอลัมน์คู่ค้า จึงระบุจากฝั่งผู้สมัครเท่านั้น
    candidate_partner: p !== undefined && p.partner_company_id !== null ? String(p.partner_company_id) : null,
    match_basis: "AMOUNT_AND_DATE_WINDOW", result: "EXACT_MATCH",
    detail: p !== undefined ? "ตรงกับภาระผูกพันหนึ่งรายการ" : "ตรงกับค่าใช้จ่ายหนึ่งรายการ",
  };
}

// ─── §7 จำแนกค่าใช้จ่ายใหม่หลังมีความสัมพันธ์ ───────────────────────────────

export type LinkedExpenseClass =
  | "OBLIGATION_ONLY" | "PAYMENT_EVIDENCE_FOUND" | "MATCHED_TO_PAYABLE"
  | "SETTLED" | "DOCUMENT_ONLY" | "UNKNOWN" | "INVALID";

export interface LinkedExpense {
  readonly id: string;
  readonly classification: LinkedExpenseClass;
  readonly month: string;
  readonly amount: number;
  readonly reason: string;
}

export function classifyLinkedExpenses(
  expenses: readonly Row[],
  matches: readonly ShadowMatch[],
  receiptById: ReadonlyMap<string, Row>,
): readonly LinkedExpense[] {
  const matchedExpenseIds = new Set<string>();
  for (const m of matches) {
    if (m.result === "EXACT_MATCH" && m.candidate_obligation === null && m.candidate_document !== null) {
      matchedExpenseIds.add(m.candidate_document);
    }
  }
  // ผู้สมัครที่กำกวมต้องไม่ถูกนับว่าจับคู่ได้
  const ambiguousMonths = new Set(matches.filter((m) => m.result === "AMBIGUOUS").map((m) => m.month));

  return expenses.map((e) => {
    const id = String(e.id);
    const amount = n(e.amount);
    const month = String(e.expense_date ?? e.created_at ?? "").slice(0, 7);
    const base = { id, month, amount };
    const receiptId = e.receipt_document_id === null || e.receipt_document_id === undefined ? null : String(e.receipt_document_id);
    const receipt = receiptId === null ? undefined : receiptById.get(receiptId);

    if (amount <= 0) return { ...base, classification: "INVALID", reason: "ไม่มียอดที่มากกว่าศูนย์" };
    if (receipt !== undefined && receipt.payment_verified === true) {
      return { ...base, classification: "SETTLED", reason: "เอกสารต้นทางถูกยืนยันการชำระแล้ว" };
    }
    if (receiptId !== null && matchedExpenseIds.has(receiptId)) {
      return { ...base, classification: "PAYMENT_EVIDENCE_FOUND", reason: "มีธุรกรรมธนาคารที่จับคู่ได้แน่นอน" };
    }
    if (receipt !== undefined) {
      return { ...base, classification: "DOCUMENT_ONLY", reason: `มีเอกสาร ${receipt.document_type} แต่ยังไม่มีหลักฐานเงินออกที่จับคู่ได้` };
    }
    if (ambiguousMonths.has(month)) {
      return { ...base, classification: "UNKNOWN", reason: "เดือนนี้มีธุรกรรมที่จับคู่ได้หลายทาง ยังตัดสินไม่ได้" };
    }
    return { ...base, classification: "OBLIGATION_ONLY", reason: "บันทึกภาระค่าใช้จ่ายไว้ ยังไม่มีเอกสารและยังไม่มีหลักฐานเงินออก" };
  });
}

// ─── §10/§12 ช่องว่างของข้อมูลและมุมมองของเจ้าของ ───────────────────────────

export interface CoverageGap {
  readonly bank_months: readonly string[];
  readonly expense_months: readonly string[];
  readonly overlapping_months: readonly string[];
  readonly gap: boolean;
  readonly note: string;
}

export function coverageGap(bankMonths: readonly string[], expenseMonths: readonly string[]): CoverageGap {
  const b = [...new Set(bankMonths)].filter((x) => x !== "").sort();
  const e = [...new Set(expenseMonths)].filter((x) => x !== "").sort();
  const overlap = b.filter((m) => e.includes(m));
  return {
    bank_months: b, expense_months: e, overlapping_months: overlap,
    gap: overlap.length === 0,
    note: overlap.length === 0
      ? "ธุรกรรมธนาคารกับค่าใช้จ่ายไม่ได้อยู่ในช่วงเดือนเดียวกันเลย จับคู่กันไม่ได้ตามธรรมชาติของข้อมูล"
      : `ทับกัน ${overlap.length} เดือน: ${overlap.join(", ")}`,
  };
}

export interface OwnerMoneyOutView {
  readonly month: string;
  readonly bank_money_out: number;
  readonly payable_created: number;
  readonly payable_paid: number;
  readonly unmatched_money_out: number;
}

/** §12 ห้ามซ่อนเงินออกที่จับคู่ไม่ได้ ต้องแสดงเป็นบรรทัดของตัวเอง */
export function ownerMoneyOutView(
  matches: readonly ShadowMatch[],
  payables: readonly Row[],
): readonly OwnerMoneyOutView[] {
  const months = [...new Set([
    ...matches.map((m) => m.month),
    ...payables.map((p) => String(p.created_at).slice(0, 7)),
  ])].filter((m) => m !== "").sort();

  return months.map((month) => {
    const rows = matches.filter((m) => m.month === month);
    const unmatched = rows.filter((m) => m.result !== "EXACT_MATCH");
    return {
      month,
      bank_money_out: round2(rows.reduce((a, m) => a + m.amount, 0)),
      payable_created: round2(payables.filter((p) => String(p.created_at).slice(0, 7) === month).reduce((a, p) => a + n(p.amount), 0)),
      payable_paid: round2(payables
        .filter((p) => ["paid_confirmed", "completed"].includes(String(p.status))
          && String(p.completed_at ?? p.created_at).slice(0, 7) === month)
        .reduce((a, p) => a + n(p.amount), 0)),
      unmatched_money_out: round2(unmatched.reduce((a, m) => a + m.amount, 0)),
    };
  });
}
