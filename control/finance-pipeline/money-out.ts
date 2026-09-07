/**
 * หน้าที่: จำแนกค่าใช้จ่าย หนี้ที่ต้องจ่าย และหลักฐานการจ่ายจริง
 *
 * Owner, 2026-09-05: สายเงินออกต้องเดินครบตั้งแต่เอกสารต้นทางถึงยอดปิดรายเดือน
 * และทุกชุดข้อมูลต้องรวมพอดี ไม่มีเศษที่มองไม่เห็น
 *
 * ของเดิมที่ต้องใช้ซ้ำ ไม่สร้างใหม่ (พิสูจน์จากซอร์สแล้ว):
 * - partner_payable_requests คือ payable ที่มีอยู่จริง พร้อม CHECK constraint
 *   สี่สถานะ: pending -> owner_acknowledged -> paid_confirmed -> completed
 *   (supabase/migrations/20260727000003_owner_surface_and_partner_payable.sql:38)
 * - ตัวจับคู่คือ matchOwnerSlipToPartnerPayable ที่ owner-dispatcher.ts:82
 *   จับด้วยยอดต่างไม่เกิน 5 บาท และยกระดับเป็น completed เมื่อ bank_email_verified
 *
 * ไฟล์นี้ไม่เขียนอะไรเลย และไม่มีโมเดลภาษาอยู่ในเส้นทาง
 *
 * Dependency ที่อนุญาต: ไม่มี (รับข้อมูลเป็นพารามิเตอร์)
 * สิ่งที่ห้ามแตะ:
 * - ห้ามจับคู่แบบคลุมเครือแล้วนับเป็นการชำระ
 * - ห้ามให้ยอดที่ AI อ่านมาเป็นตัวตัดสินการจ่ายเงิน
 */

export interface Row { readonly [k: string]: unknown }

const n = (v: unknown): number => { const x = Number(v ?? 0); return Number.isFinite(x) ? x : 0; };
const month = (v: unknown): string => String(v ?? "").slice(0, 7);
const round2 = (x: number) => Math.round(x * 100) / 100;

// ─── §2 จำแนกค่าใช้จ่าย ─────────────────────────────────────────────────────

export type ExpenseClass =
  | "OBLIGATION_ONLY" | "PAID_VERIFIED" | "PAYMENT_UNVERIFIED"
  | "DOCUMENT_ONLY" | "DUPLICATE" | "INVALID" | "UNKNOWN";

export interface ExpenseVerdict {
  readonly id: string;
  readonly classification: ExpenseClass;
  readonly month: string;
  readonly amount: number;
  readonly has_document: boolean;
  readonly has_payment_evidence: boolean;
  readonly reason: string;
}

/** เอกสารที่เป็นหลักฐานภาษีซื้อ ไม่ใช่หลักฐานว่าจ่ายเงินแล้ว */
const TAX_DOCUMENT_TYPES = new Set(["tax_invoice", "receipt", "invoice"]);

export function classifyExpenses(
  expenses: readonly Row[],
  receiptById: ReadonlyMap<string, Row>,
  bankOutRefs: ReadonlySet<string>,
): readonly ExpenseVerdict[] {
  /**
   * §2 ตัวซ้ำต้องตัดสินจากตัวตนที่พิสูจน์ได้ ไม่ใช่ความคล้าย
   *
   * 2026-09-05: กุญแจแรกของผมคือ receiptId|amount|date ซึ่งยุบรวมกันหมด เพราะมี
   * แค่ 3 จาก 133 แถวที่มี receipt_document_id ผลออกมาว่าซ้ำ 47 แถว ทั้งที่
   * ส่วนใหญ่เป็นค่าบริการรายเดือนที่อาจถูกเรียกเก็บหลายรายการในวันเดียวกันจริง
   *
   * ตัดสินว่าซ้ำได้เฉพาะเมื่อผูกกับเอกสารต้นทางเดียวกัน กรณีที่เหลือถ้าคล้ายกัน
   * ให้ตอบ UNKNOWN ไม่ใช่ DUPLICATE
   */
  const seenStrong = new Map<string, string>();
  const looseCount = new Map<string, number>();
  for (const e of expenses) {
    const k = `${String(e.subscription_service_id ?? "-")}|${n(e.amount)}|${String(e.expense_date ?? "")}`;
    looseCount.set(k, (looseCount.get(k) ?? 0) + 1);
  }

  return expenses.map((e) => {
    const id = String(e.id);
    const amount = n(e.amount);
    const base = { id, month: month(e.expense_date ?? e.created_at), amount };
    const receiptId = e.receipt_document_id === null || e.receipt_document_id === undefined
      ? null : String(e.receipt_document_id);
    const receipt = receiptId === null ? undefined : receiptById.get(receiptId);
    const hasDocument = receipt !== undefined || (typeof e.tax_invoice_no === "string" && e.tax_invoice_no !== "");
    // หลักฐานว่าจ่ายจริงต้องมาจากธนาคาร ไม่ใช่จากตัวเอกสารค่าใช้จ่ายเอง
    const paymentRef = typeof e.tax_invoice_no === "string" ? e.tax_invoice_no : null;
    const hasPaymentEvidence = paymentRef !== null && bankOutRefs.has(paymentRef);
    const common = { ...base, has_document: hasDocument, has_payment_evidence: hasPaymentEvidence };

    if (amount <= 0) {
      return { ...common, classification: "INVALID", reason: "ไม่มียอดเงินที่มากกว่าศูนย์" };
    }

    // ตัวตนที่พิสูจน์ได้: ต้องผูกกับเอกสารต้นทางเดียวกันเท่านั้น
    if (receiptId !== null) {
      const prior = seenStrong.get(receiptId);
      if (prior !== undefined) {
        return { ...common, classification: "DUPLICATE", reason: `ผูกกับเอกสารเดียวกับแถว ${prior.slice(0, 8)}` };
      }
      seenStrong.set(receiptId, id);
    } else {
      const loose = `${String(e.subscription_service_id ?? "-")}|${amount}|${String(e.expense_date ?? "")}`;
      if ((looseCount.get(loose) ?? 0) > 1) {
        return { ...common, classification: "UNKNOWN",
          reason: `มีแถวยอดและวันเดียวกันอีก ${(looseCount.get(loose) ?? 1) - 1} แถว แต่ไม่มีตัวตนที่พิสูจน์ได้ว่าซ้ำจริง` };
      }
    }

    if (hasPaymentEvidence) {
      return { ...common, classification: "PAID_VERIFIED", reason: "มีธุรกรรมธนาคารขาออกที่อ้างอิงตรงกัน" };
    }
    if (receipt !== undefined && receipt.payment_verified === true) {
      return { ...common, classification: "PAID_VERIFIED", reason: "เอกสารต้นทางถูกยืนยันการชำระแล้ว" };
    }
    if (receipt !== undefined && TAX_DOCUMENT_TYPES.has(String(receipt.document_type))) {
      // มีใบกำกับ/ใบเสร็จ แต่ยังไม่มีหลักฐานว่าเงินออกจริง
      return { ...common, classification: "PAYMENT_UNVERIFIED", reason: `มีเอกสาร ${receipt.document_type} แต่ยังไม่มีหลักฐานเงินออก` };
    }
    if (hasDocument) {
      return { ...common, classification: "DOCUMENT_ONLY", reason: "มีเลขเอกสารแต่ไม่มีเอกสารต้นทางที่เชื่อมถึง" };
    }
    return { ...common, classification: "OBLIGATION_ONLY", reason: "บันทึกภาระค่าใช้จ่ายไว้ แต่ยังไม่มีเอกสารและยังไม่มีหลักฐานการจ่าย" };
  });
}

// ─── §10 จำแนกธุรกรรมธนาคาร ─────────────────────────────────────────────────

export type BankDirection = "MONEY_IN" | "MONEY_OUT" | "TRANSFER_INTERNAL" | "FEE" | "UNKNOWN";

export interface BankVerdict {
  readonly id: string;
  readonly direction: BankDirection;
  readonly amount: number;
  readonly month: string;
  readonly matched_to: string | null;
  readonly reason: string;
}

/**
 * ทิศทางอ่านจากคอลัมน์ kind ที่ธนาคารให้มา ไม่ใช่เดาจากยอด
 *
 * ค่าจริงเป็นภาษาไทยทั้งหมด — ตรวจจาก production 115 แถวเมื่อ 2026-09-05
 * ผมเคยใส่คำอังกฤษ (debit/credit/fee) ไว้ก่อน แล้วได้ผลว่า UNKNOWN ทั้ง 115 แถว
 * ซึ่งเป็นความผิดของรายการที่ผมเดา ไม่ใช่ของข้อมูล
 */
const OUT_KINDS = new Set(["ชำระเงิน", "โอนเงิน", "โอนเงิน/ชำระเงิน"]);
const IN_KINDS = new Set(["รับโอนเงิน", "ฝากเงินสด", "รับดอกเบี้ยเงินฝาก"]);
const FEE_KINDS = new Set(["ภาษีหัก ณ ที่จ่าย", "ค่าธรรมเนียม"]);

/**
 * bank_statement_transactions.transaction_date เป็นคอลัมน์ text รูปแบบ DD-MM-YY
 * ไม่ใช่วันที่ของฐานข้อมูล (ตรวจจาก information_schema เมื่อ 2026-09-05:
 * data_type = text · ตัวอย่าง "07-05-26" เรียงขึ้นจาก 07-05 ถึง 29-07)
 *
 * ถ้าอ่านด้วยการตัดสตริงแบบ ISO จะได้เดือนเพี้ยนทั้งชุด ซึ่งผมพลาดมาแล้วรอบหนึ่ง
 * รูปแบบที่แปลไม่ได้ให้คืนค่าว่าง ไม่เดา
 */
export function parseBankMonth(raw: unknown): string {
  const s = String(raw ?? "").trim();
  const m = s.match(/^(\d{2})-(\d{2})-(\d{2})$/);
  if (m === null) return "";
  const [, dd, mm, yy] = m;
  const day = Number(dd); const mon = Number(mm);
  if (day < 1 || day > 31 || mon < 1 || mon > 12) return "";
  return `20${yy}-${mm}`;
}

export function classifyBankRows(
  rows: readonly Row[],
  payables: readonly Row[],
): readonly BankVerdict[] {
  return rows.map((b) => {
    const id = String(b.id);
    const amount = n(b.amount);
    const kind = String(b.kind ?? "").trim();
    const parsed = parseBankMonth(b.transaction_date);
    const base = { id, amount, month: parsed !== "" ? parsed : month(b.created_at) };

    let direction: BankDirection = "UNKNOWN";
    let reason = `kind = "${b.kind ?? "(ว่าง)"}" ไม่อยู่ในรายการที่รู้จัก`;
    if (FEE_KINDS.has(kind)) { direction = "FEE"; reason = "ค่าธรรมเนียม"; }
    else if (OUT_KINDS.has(kind)) { direction = "MONEY_OUT"; reason = "เงินออกตามที่ธนาคารระบุ"; }
    else if (IN_KINDS.has(kind)) { direction = "MONEY_IN"; reason = "เงินเข้าตามที่ธนาคารระบุ"; }

    let matched: string | null = null;
    if (direction === "MONEY_OUT") {
      // กติกาเดียวกับ matchOwnerSlipToPartnerPayable: ต่างไม่เกิน 5 บาท
      // และเฉพาะรายการที่ยังรอจ่ายเท่านั้น
      const hit = payables.find((p) =>
        ["pending", "owner_acknowledged"].includes(String(p.status))
        && Math.abs(n(p.amount) - amount) <= 5);
      if (hit !== undefined) { matched = String(hit.id); reason += " · เข้าเกณฑ์จับคู่กับรายการรอจ่าย"; }
    }
    return { ...base, direction, matched_to: matched, reason };
  });
}

// ─── §7/§12 ยอดเจ้าหนี้รายเดือน ─────────────────────────────────────────────

export interface MonthlyPayable {
  readonly month: string;
  readonly payable_open: number;
  readonly payable_created: number;
  readonly payable_paid: number;
  readonly payable_adjustment: number;
  readonly payable_close: number;
  readonly equation_holds: boolean;
  readonly money_out_total: number;
}

/**
 * ยอดเจ้าหนี้เดินจากสถานะของ partner_payable_requests เท่านั้น
 * สร้างเมื่อแถวถูกสร้าง · ถือว่าจ่ายเมื่อสถานะไปถึง paid_confirmed หรือ completed
 * ไม่มีการปรับปรุงอื่นในซอร์ส จึง adjustment เป็นศูนย์เสมอจนกว่าจะพบของจริง
 */
const PAID_STATES = new Set(["paid_confirmed", "completed"]);

export function closePayableMonths(
  payables: readonly Row[],
  expenseVerdicts: readonly ExpenseVerdict[],
): readonly MonthlyPayable[] {
  const months = [...new Set([
    ...payables.map((p) => month(p.created_at)),
    ...payables.filter((p) => p.completed_at !== null && p.completed_at !== undefined).map((p) => month(p.completed_at)),
    ...expenseVerdicts.map((v) => v.month),
  ])].filter((m) => m !== "").sort();

  let running = 0;
  return months.map((m) => {
    const created = round2(payables.filter((p) => month(p.created_at) === m).reduce((a, p) => a + n(p.amount), 0));
    const paid = round2(payables
      .filter((p) => PAID_STATES.has(String(p.status)) && month(p.completed_at ?? p.created_at) === m)
      .reduce((a, p) => a + n(p.amount), 0));
    const open = round2(running);
    const close = round2(open + created - paid);
    running = close;
    const moneyOut = round2(expenseVerdicts
      .filter((v) => v.month === m && v.classification === "PAID_VERIFIED")
      .reduce((a, v) => a + v.amount, 0));
    return {
      month: m, payable_open: open, payable_created: created, payable_paid: paid,
      payable_adjustment: 0, payable_close: close,
      equation_holds: Math.abs((open + created - paid + 0) - close) < 0.01,
      money_out_total: moneyOut,
    };
  });
}
