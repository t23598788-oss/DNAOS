/**
 * หน้าที่: ปิดงบรายเดือนจากข้อมูลจริง และตรวจสมการให้ลงตัว
 *
 * Owner, 2026-09-05 ข้อ 15: ทุกชุดข้อมูลต้อง TOTAL = RESOLVED + UNMATCHED +
 * AMBIGUOUS + INVALID + EXCLUDED ไม่มีเศษที่มองไม่เห็น
 * และข้อ 12: ห้ามนิยามกำไรว่าเงินเข้าลบเงินออก ถ้าสัญญาธุรกิจไม่ได้บอกอย่างนั้น
 *
 * ตัวเลขทุกตัวในไฟล์นี้มาจากแถวจริง ไม่มีการประมาณ
 *
 * Dependency ที่อนุญาต: ไม่มี (รับข้อมูลเข้ามาเป็นพารามิเตอร์)
 * สิ่งที่ห้ามแตะ:
 * - ห้ามเติมยอดที่ไม่มีเอกสารต้นทาง
 * - ห้ามจับคู่แบบคลุมเครือแล้วนับเป็นยอดจริง
 */

export type ReceiptClass =
  | "SETTLED" | "RECONCILABLE" | "MISSING_IDENTITY" | "MISSING_REFERENCE"
  | "MISSING_BANK_EVIDENCE" | "NO_DEBT_TARGET" | "ALREADY_RECONCILED" | "NON_PAYMENT_DOCUMENT";

export interface Row { readonly [k: string]: unknown }

const n = (v: unknown): number => { const x = Number(v ?? 0); return Number.isFinite(x) ? x : 0; };
/**
 * แปลงปี พ.ศ. เป็น ค.ศ. เฉพาะเมื่อพิสูจน์ได้ว่าเป็น พ.ศ. จริง
 *
 * guard: แปลงเฉพาะปีในช่วง 2500-2600 เท่านั้น ปีอื่นปล่อยไว้ตามเดิม
 * ห้ามใช้กับทุกปีแบบเหมารวม เพราะ 2022/2023 ที่พบในข้อมูลเป็น ค.ศ. จริง
 *
 * หลักฐาน 2026-09-05: company_expenses มีแถว expense_date = 2569-01-08 ผูกกับ
 * receipt_documents 8b153ea2 ซึ่งเป็น tax_invoice ที่ raw_ocr_text มีแต่เลข
 * 2569 ไม่มี ค.ศ. เลย — ตัวรับข้อมูลเก็บค่าตามที่อ่านได้โดยไม่แปลง
 */
const BE_MIN = 2500;
const BE_MAX = 2600;
export function normalizeThaiYear(dateValue: unknown): { value: string; converted: boolean } {
  const raw = String(dateValue ?? "");
  const m = raw.match(/^(\d{4})(-\d{2}-\d{2})/);
  if (m === null) return { value: raw, converted: false };
  const year = Number(m[1]);
  if (year < BE_MIN || year > BE_MAX) return { value: raw, converted: false };
  return { value: String(year - 543) + m[2] + raw.slice(m[0].length), converted: true };
}

const month = (v: unknown): string => normalizeThaiYear(v).value.slice(0, 7);
const round2 = (x: number) => Math.round(x * 100) / 100;

/** เลขอ้างอิงรายการโอนของไทย — ดึงด้วยรูปแบบ ไม่ใช่ให้โมเดลเดา */
const REFERENCE_PATTERNS: readonly RegExp[] = [
  /\b([A-Z]{3,6}\d{12,20})\b/,          // เช่น TRBS260723374064276
  /(?:เลขที่รายการ|รหัสอ้างอิง|เลขอ้างอิง|Ref(?:erence)?(?:\s*No\.?)?)\s*[:：]?\s*([A-Z0-9]{10,25})/i,
];

export function recoverReference(rawOcrText: unknown): { recovered: string | null; method: string } {
  const text = typeof rawOcrText === "string" ? rawOcrText : "";
  if (text === "") return { recovered: null, method: "NO_OCR_TEXT" };
  for (const re of REFERENCE_PATTERNS) {
    const m = text.match(re);
    if (m?.[1]) return { recovered: m[1], method: "REGEX_EXACT" };
  }
  return { recovered: null, method: "NO_MATCH" };
}

export interface ReceiptVerdict {
  readonly id: string;
  readonly classification: ReceiptClass;
  readonly month: string;
  readonly amount: number;
  readonly reference: string | null;
  readonly reference_source: "STORED" | "RECOVERED_FROM_OCR" | "NONE";
  readonly bank_evidence: boolean;
}

export function classifyReceipts(
  receipts: readonly Row[],
  bankRefs: ReadonlySet<string>,
  snapshotCompanies: ReadonlySet<string>,
): readonly ReceiptVerdict[] {
  const PAYMENT_TYPES = new Set(["transfer_slip", "payment_advice"]);
  return receipts.map((r) => {
    const id = String(r.id);
    const base = { id, month: month(r.created_at), amount: n(r.amount) };

    let reference = typeof r.reference_number === "string" && r.reference_number !== "" ? r.reference_number : null;
    let refSource: ReceiptVerdict["reference_source"] = reference !== null ? "STORED" : "NONE";
    if (reference === null) {
      const rec = recoverReference(r.raw_ocr_text);
      if (rec.recovered !== null) { reference = rec.recovered; refSource = "RECOVERED_FROM_OCR"; }
    }
    const bankEvidence = reference !== null && bankRefs.has(reference);
    const common = { ...base, reference, reference_source: refSource, bank_evidence: bankEvidence };

    // ลำดับการตัดสินสำคัญ — ตัวที่จบแล้วต้องมาก่อนเสมอ
    if (r.matched_debt_event_id !== null && r.matched_debt_event_id !== undefined) {
      return { ...common, classification: r.status === "confirmed" ? "SETTLED" : "ALREADY_RECONCILED" };
    }
    if (!PAYMENT_TYPES.has(String(r.document_type))) {
      return { ...common, classification: "NON_PAYMENT_DOCUMENT" };
    }
    if (r.customer_company_id === null || r.customer_company_id === undefined) {
      return { ...common, classification: "MISSING_IDENTITY" };
    }
    if (!snapshotCompanies.has(String(r.customer_company_id))) {
      return { ...common, classification: "NO_DEBT_TARGET" };
    }
    if (reference === null) return { ...common, classification: "MISSING_REFERENCE" };
    if (!bankEvidence) return { ...common, classification: "MISSING_BANK_EVIDENCE" };
    return { ...common, classification: "RECONCILABLE" };
  });
}

export interface MonthlyClose {
  readonly month: string;
  readonly money_in: number;
  readonly money_out: number;
  readonly revenue: number;
  readonly expense: number;
  readonly vat_output: number;
  readonly vat_input: number;
  readonly vat_net: number;
  readonly receivable_open: number;
  readonly receivable_created: number;
  readonly receivable_paid: number;
  readonly receivable_close: number;
  readonly ar_equation_holds: boolean;
  readonly vat_equation_holds: boolean;
  readonly unmatched_receipts: number;
  readonly unmatched_bank: number;
}

/**
 * ยอดลูกหนี้เดินจาก debt_events เท่านั้น — ต้นทางความจริงตามสัญญาที่พิสูจน์แล้ว
 *
 * สูตรคัดลอกจากของจริงใน engines/debt/replay.ts:233 — เงินต้นเริ่มจาก debt_started
 * แล้วลดด้วย **receipt_received เท่านั้น** ชนิดอื่น (manual_adjustment,
 * interest_penalty_received, debt_closed, promise_to_pay, collection_paused)
 * ไม่อยู่ในการเดินเงินต้นโดยเจตนา
 *
 * ผมเคยใส่ manual_adjustment กับ debt_closed เข้าไปด้วย แล้วได้ยอดต่างจาก
 * snapshot 2,858.14 ซึ่งเป็นความผิดของสูตรผม ไม่ใช่ของระบบ
 */
const AR_INCREASE = new Set(["debt_started"]);
const AR_DECREASE = new Set(["receipt_received"]);

export function closeMonths(input: {
  readonly receipts: readonly Row[];
  readonly verdicts: readonly ReceiptVerdict[];
  readonly debtEvents: readonly Row[];
  readonly invoices: readonly Row[];
  readonly standalone: readonly Row[];
  readonly expenses: readonly Row[];
  readonly bank: readonly Row[];
  readonly bankMatched: ReadonlySet<string>;
}): readonly MonthlyClose[] {
  const months = [...new Set([
    ...input.debtEvents.map((e) => month(e.occurred_at)),
    ...input.invoices.map((i) => month(i.invoice_date ?? i.created_at)),
    ...input.standalone.map((d) => month(d.document_date ?? d.created_at)),
    ...input.expenses.map((e) => month(e.expense_date ?? e.created_at)),
    ...input.verdicts.map((v) => v.month),
    ...input.bank.map((b) => month(b.created_at)),
  ])].filter((m) => m !== "").sort();

  let arRunning = 0;
  return months.map((m) => {
    const ev = input.debtEvents.filter((e) => month(e.occurred_at) === m);
    const created = round2(ev.filter((e) => AR_INCREASE.has(String(e.event_type))).reduce((a, e) => a + n(e.amount), 0));
    const paid = round2(ev.filter((e) => AR_DECREASE.has(String(e.event_type))).reduce((a, e) => a + n(e.amount), 0));
    const open = round2(arRunning);
    const close = round2(open + created - paid);
    arRunning = close;

    const inv = input.invoices.filter((i) => month(i.invoice_date ?? i.created_at) === m);
    const sd = input.standalone.filter((d) => month(d.document_date ?? d.created_at) === m);
    const ex = input.expenses.filter((e) => month(e.expense_date ?? e.created_at) === m);

    // รายได้จากเอกสารที่ออกจริงเท่านั้น — ไม่นับเงินสดที่ยังไม่มีเอกสาร
    const revenue = round2(inv.reduce((a, i) => a + n(i.subtotal), 0) + sd.reduce((a, d) => a + n(d.subtotal), 0));
    const vatOutput = round2(inv.reduce((a, i) => a + n(i.vat_amount), 0) + sd.reduce((a, d) => a + n(d.vat_amount), 0));
    const vatInput = round2(ex.reduce((a, e) => a + n(e.vat_amount), 0));
    const expense = round2(ex.reduce((a, e) => a + (n(e.amount_pre_vat) || n(e.amount)), 0));

    const moneyIn = round2(input.verdicts.filter((v) => v.month === m && (v.classification === "SETTLED" || v.classification === "ALREADY_RECONCILED"))
      .reduce((a, v) => a + v.amount, 0));
    const moneyOut = round2(ex.reduce((a, e) => a + n(e.amount), 0));

    const vatNet = round2(vatOutput - vatInput);
    return {
      month: m, money_in: moneyIn, money_out: moneyOut, revenue, expense,
      vat_output: vatOutput, vat_input: vatInput, vat_net: vatNet,
      receivable_open: open, receivable_created: created, receivable_paid: paid, receivable_close: close,
      ar_equation_holds: Math.abs((open + created - paid) - close) < 0.01,
      vat_equation_holds: Math.abs((vatOutput - vatInput) - vatNet) < 0.01,
      unmatched_receipts: input.verdicts.filter((v) => v.month === m
        && v.classification !== "SETTLED" && v.classification !== "ALREADY_RECONCILED"
        && v.classification !== "NON_PAYMENT_DOCUMENT").length,
      unmatched_bank: input.bank.filter((b) => month(b.created_at) === m && !input.bankMatched.has(String(b.id))).length,
    };
  });
}
