/**
 * หน้าที่: สร้างงบจากเอกสารต้นฉบับ ไม่ใช่จากยอดรวมของธนาคาร
 *
 * Owner, 2026-09-05:
 * ข้อ 1 — ห้ามเริ่มจาก bank_statement totals ต้องเริ่มจากเอกสารจริง
 * ข้อ 2 — ทุกยอดที่คำนวณได้ต้องย้อนกลับถึงเอกสารต้นทางได้
 * ข้อ 3 — หมวดหมู่ต้องมาจากหลักฐานในเอกสาร ห้ามใช้การเคลื่อนไหวของเงินมากำหนด
 * ข้อ 5 — งบบริษัทรอบนี้ใช้เฉพาะ COMPANY_CONFIRMED
 * ข้อ 6 — VAT ทุกบาทต้องมี document_id ห้ามคำนวณย้อนจากยอดเงิน
 * ข้อ 9 — ธนาคารเป็นชั้นการชำระเงินคนละชั้นกับเอกสาร จับคู่ไม่ได้ห้ามลบทั้งสองฝั่ง
 * ข้อ 12 — ห้ามคำนวณกำไรจนกว่า verifier จะผ่าน
 *
 * Dependency ที่อนุญาต: ./money-out.ts (ชนิด Row), ./payable-linkage.ts (ตัวอ่านวันที่ธนาคาร)
 * สิ่งที่ห้ามแตะ:
 * - ห้ามให้โมเดลภาษาตัดสินหมวดหมู่ ยอดเงิน หรือความเป็นเจ้าของเอกสาร
 * - ห้ามเติม VAT ที่เอกสารไม่ได้ระบุ
 * - ห้ามนับเอกสารที่ยกเลิกแล้วเป็นรายได้
 */

import type { Row } from "./money-out";
import { parseBankDate } from "./payable-linkage";

const n = (v: unknown): number => { const x = Number(v ?? 0); return Number.isFinite(x) ? x : 0; };
const round2 = (x: number) => Math.round(x * 100) / 100;
const monthOf = (v: unknown): string => String(v ?? "").slice(0, 7);

// ─── §3 ความหมายทางธุรกิจของเอกสาร ──────────────────────────────────────────

export type DocumentCategory =
  | "PURCHASE_MATERIAL" | "FUEL" | "TRANSPORT" | "LABOR" | "SERVICE"
  | "OTHER_EXPENSE" | "SALE" | "TAX_DOCUMENT" | "PAYMENT_EVIDENCE"
  | "NON_COMPANY" | "UNKNOWN";

export type Ownership = "COMPANY_CONFIRMED" | "PERSONAL" | "UNKNOWN_OWNER";

export type PaymentStatus = "PAID" | "UNPAID" | "VOID" | "UNKNOWN";

export interface LineItem {
  readonly document_id: string;
  readonly description: string;
  readonly quantity: number;
  readonly unit: string;
  readonly unit_price: number;
  readonly line_total: number;
}

export interface SourceDocument {
  readonly document_id: string;
  /** §2 ต้องชี้กลับไปยังต้นฉบับได้เสมอ ไม่มี pointer = UNTRACEABLE */
  readonly original_source_pointer: string | null;
  /**
   * แถวในสมุดไม่ใช่ต้นฉบับ ต้องแยกให้ชัดว่า pointer ที่ได้เป็นของจริงชนิดไหน
   * ORIGINAL_FILE  = ไฟล์ต้นฉบับที่ยังเปิดได้จริง
   * SYSTEM_OF_RECORD = เอกสารที่บริษัทออกเอง ตัวระบบคือต้นฉบับ ไม่มีกระดาษอื่น
   * NONE = ไม่มีต้นฉบับ ห้ามนับเป็นเอกสารที่มีหลักฐาน
   */
  readonly pointer_kind: "ORIGINAL_FILE" | "SYSTEM_OF_RECORD" | "NONE";
  readonly source_table: string;
  readonly document_type: string;
  readonly document_no: string | null;
  readonly company_id: string | null;
  readonly counterparty_id: string | null;
  readonly document_date: string;
  readonly month: string;
  readonly items: readonly LineItem[];
  readonly subtotal: number;
  readonly vat: number | null;
  readonly total: number;
  readonly currency: "THB";
  readonly category: DocumentCategory;
  readonly ownership: Ownership;
  readonly payment_status: PaymentStatus;
  /** เอกสารนี้มีสิทธิ์เข้างบรายได้/ค่าใช้จ่ายหรือไม่ พร้อมเหตุผลที่ตรวจย้อนได้ */
  readonly postable: boolean;
  readonly reason: string;
}

// ─── §1 อ่านเอกสารขายที่บริษัทออกเอง ────────────────────────────────────────

/** เอกสารของบริษัทที่ยังไม่ถือเป็นรายการทางบัญชี — เสนอราคาและใบส่งของ */
const NON_POSTING_SALE_TYPES = new Set(["quotation", "delivery_order"]);

function itemsFor(docId: string, items: readonly Row[], fk: string): readonly LineItem[] {
  return items
    .filter((it) => String(it[fk]) === docId)
    .map((it) => ({
      document_id: docId,
      description: String(it.description ?? ""),
      quantity: n(it.qty),
      unit: String(it.unit ?? ""),
      unit_price: n(it.unit_price),
      // standalone_document_items ไม่มีคอลัมน์ line_total จึงคูณจากจำนวน x ราคาต่อหน่วย
      line_total: it.line_total === undefined || it.line_total === null
        ? round2(n(it.qty) * n(it.unit_price))
        : n(it.line_total),
    }));
}

export function fromInvoices(invoices: readonly Row[], invoiceItems: readonly Row[]): readonly SourceDocument[] {
  return invoices.map((i) => {
    const id = String(i.id);
    const voided = String(i.invoice_status).toUpperCase() === "VOID";
    return {
      document_id: id,
      original_source_pointer: `db://public.invoices/${id}`,
      pointer_kind: "SYSTEM_OF_RECORD" as const,
      source_table: "invoices",
      document_type: "invoice",
      document_no: i.invoice_no === null || i.invoice_no === undefined ? null : String(i.invoice_no),
      company_id: null,
      counterparty_id: i.customer_company_id === null || i.customer_company_id === undefined ? null : String(i.customer_company_id),
      document_date: String(i.invoice_date ?? "").slice(0, 10),
      month: monthOf(i.invoice_date),
      items: itemsFor(id, invoiceItems, "invoice_id"),
      subtotal: n(i.subtotal), vat: n(i.vat_amount), total: n(i.total_amount),
      currency: "THB" as const,
      category: "SALE" as const,
      // ออกจากระบบเอกสารของบริษัทเอง จึงเป็นของบริษัทแน่นอน
      ownership: "COMPANY_CONFIRMED" as const,
      payment_status: voided ? "VOID" as const : n(i.paid_amount) >= n(i.total_amount) && n(i.total_amount) > 0 ? "PAID" as const : "UNPAID" as const,
      postable: !voided,
      reason: voided ? "ใบแจ้งหนี้ถูกยกเลิก จึงไม่นับเป็นรายได้" : "ใบแจ้งหนี้ที่ออกแล้วและยังมีผล",
    };
  });
}

export function fromStandaloneDocuments(docs: readonly Row[], items: readonly Row[]): readonly SourceDocument[] {
  return docs.map((d) => {
    const id = String(d.id);
    const type = String(d.document_type);
    const voided = String(d.status).toLowerCase() === "void";
    const nonPosting = NON_POSTING_SALE_TYPES.has(type);
    return {
      document_id: id,
      original_source_pointer: `db://public.standalone_documents/${id}`,
      pointer_kind: "SYSTEM_OF_RECORD" as const,
      source_table: "standalone_documents",
      document_type: type,
      document_no: d.document_no === null || d.document_no === undefined ? null : String(d.document_no),
      company_id: null,
      counterparty_id: d.customer_company_id === null || d.customer_company_id === undefined ? null : String(d.customer_company_id),
      document_date: String(d.document_date ?? "").slice(0, 10),
      month: monthOf(d.document_date),
      items: itemsFor(id, items, "document_id"),
      subtotal: n(d.subtotal), vat: n(d.vat_amount), total: n(d.total_amount),
      currency: "THB" as const,
      category: nonPosting ? "UNKNOWN" as const : "SALE" as const,
      ownership: "COMPANY_CONFIRMED" as const,
      payment_status: voided ? "VOID" as const : type === "receipt" ? "PAID" as const : "UNKNOWN" as const,
      postable: !voided && !nonPosting,
      reason: voided ? "เอกสารถูกยกเลิก"
        : nonPosting ? `${type} ยังไม่เป็นรายการทางบัญชี จึงไม่นับเป็นรายได้`
          : "เอกสารขายที่บริษัทออกเองและยังมีผล",
    };
  });
}

// ─── §1 ค่าใช้จ่ายที่บันทึกในสมุดบริษัท ─────────────────────────────────────

/**
 * หมวดมาจากชนิดเอกสารที่บันทึกไว้เท่านั้น
 * tax_invoice บอกว่าเป็นหลักฐานภาษี ไม่ได้บอกว่าซื้ออะไร จึงเป็น OTHER_EXPENSE
 * และห้ามเดาว่าเป็นวัสดุหรือค่าขนส่ง
 */
export function expenseCategoryOf(documentType: unknown): DocumentCategory {
  switch (String(documentType)) {
    case "fuel_bill": return "FUEL";
    case "subscription": return "SERVICE";
    case "partner_payable": return "PURCHASE_MATERIAL";
    case "tax_invoice": return "OTHER_EXPENSE";
    default: return "UNKNOWN";
  }
}

export function fromCompanyExpenses(
  expenses: readonly Row[],
  receiptMediaPath: ReadonlyMap<string, string>,
  storageObjectNames: ReadonlySet<string>,
): readonly SourceDocument[] {
  return expenses.map((e) => {
    const id = String(e.id);
    const receiptId = e.receipt_document_id === null || e.receipt_document_id === undefined ? null : String(e.receipt_document_id);
    const path = receiptId === null ? undefined : receiptMediaPath.get(receiptId);
    const media = path !== undefined && storageObjectNames.has(path) ? path : undefined;
    const amount = n(e.amount);
    const vat = e.vat_amount === null || e.vat_amount === undefined ? null : n(e.vat_amount);
    const pre = e.amount_pre_vat === null || e.amount_pre_vat === undefined ? null : n(e.amount_pre_vat);
    return {
      document_id: id,
      // §2 แถวในสมุดไม่ใช่ต้นฉบับ ต้นฉบับคือไฟล์เอกสารที่ผูกไว้และยังเปิดได้จริง
      original_source_pointer: media === undefined ? null : `storage://attachments/${media}`,
      pointer_kind: media === undefined ? "NONE" as const : "ORIGINAL_FILE" as const,
      source_table: "company_expenses",
      document_type: String(e.document_type ?? "unknown"),
      document_no: typeof e.tax_invoice_no === "string" && e.tax_invoice_no !== "" ? e.tax_invoice_no : null,
      company_id: null, counterparty_id: null,
      document_date: String(e.expense_date ?? e.created_at ?? "").slice(0, 10),
      month: monthOf(e.expense_date ?? e.created_at),
      items: [],
      subtotal: pre ?? amount, vat, total: amount,
      currency: "THB" as const,
      category: expenseCategoryOf(e.document_type),
      ownership: "COMPANY_CONFIRMED" as const,
      payment_status: "UNKNOWN" as const,
      postable: amount > 0,
      reason: amount > 0 ? "ค่าใช้จ่ายที่บันทึกในสมุดบริษัท" : "ยอดไม่มากกว่าศูนย์",
    };
  });
}

// ─── §1 เอกสารขาเข้าที่ยังไม่ถูกรับเข้าสมุด ─────────────────────────────────

const PAYMENT_EVIDENCE_TYPES = new Set(["transfer_slip", "payment_advice"]);
const NON_FINANCIAL_TYPES = new Set(["site_photo", "product_photo", "government_document", "other"]);

const INBOUND_CATEGORY: Readonly<Record<string, DocumentCategory>> = {
  fuel_bill: "FUEL",
  tax_invoice: "TAX_DOCUMENT",
  invoice: "UNKNOWN",
  receipt: "UNKNOWN",
};

/**
 * §5 รูปเอกสารที่ส่งเข้ามาทาง LINE ยังไม่รู้ว่าเป็นของบริษัทหรือของคู่ค้า
 * จะยกระดับเป็น COMPANY_CONFIRMED ได้ต่อเมื่อมีแถวในสมุดบริษัทอ้างถึงเท่านั้น
 */
export function fromReceiptDocuments(
  receipts: readonly Row[],
  claimedByExpense: ReadonlySet<string>,
  storageObjectNames: ReadonlySet<string>,
): readonly SourceDocument[] {
  return receipts.map((r) => {
    const id = String(r.id);
    const type = String(r.document_type ?? "unknown");
    const mediaPath = typeof r.media_path === "string" && r.media_path !== "" ? r.media_path : null;
    const claimed = claimedByExpense.has(id);
    const category: DocumentCategory =
      PAYMENT_EVIDENCE_TYPES.has(type) ? "PAYMENT_EVIDENCE"
        : NON_FINANCIAL_TYPES.has(type) ? "NON_COMPANY"
          : INBOUND_CATEGORY[type] ?? "UNKNOWN";
    return {
      document_id: id,
      // ต้นฉบับคือไฟล์ใน storage ถ้าไฟล์ไม่อยู่แล้ว pointer นั้นใช้ไม่ได้
      original_source_pointer: mediaPath !== null && storageObjectNames.has(mediaPath)
        ? `storage://attachments/${mediaPath}` : null,
      pointer_kind: mediaPath !== null && storageObjectNames.has(mediaPath)
        ? "ORIGINAL_FILE" as const : "NONE" as const,
      source_table: "receipt_documents",
      document_type: type,
      document_no: r.reference_number === null || r.reference_number === undefined ? null : String(r.reference_number),
      company_id: null,
      counterparty_id: r.customer_company_id === null || r.customer_company_id === undefined ? null : String(r.customer_company_id),
      document_date: String(r.transaction_datetime ?? r.created_at ?? "").slice(0, 10),
      month: monthOf(r.transaction_datetime ?? r.created_at),
      items: [],
      subtotal: n(r.amount), vat: null, total: n(r.amount),
      currency: "THB" as const,
      category,
      ownership: claimed ? "COMPANY_CONFIRMED" as const : "UNKNOWN_OWNER" as const,
      payment_status: r.payment_verified === true ? "PAID" as const : "UNKNOWN" as const,
      // ถูกอ้างโดยสมุดบริษัทแล้วจะถูกนับที่แถว company_expenses ไม่ใช่ที่นี่ กันนับซ้ำ
      postable: false,
      reason: claimed ? "ถูกอ้างโดยค่าใช้จ่ายในสมุดบริษัทแล้ว นับที่แถวนั้นเพื่อกันนับซ้ำ"
        : category === "PAYMENT_EVIDENCE" ? "หลักฐานการชำระเงิน เป็นคนละชั้นกับเอกสารซื้อขาย"
          : category === "NON_COMPANY" ? "ไม่ใช่เอกสารทางการเงิน"
            : "ยังไม่มีสมุดบริษัทเล่มใดรับเอกสารนี้เข้า จึงยังไม่รู้ว่าเป็นของใคร",
    };
  });
}

// ─── §7 §8 §10 ปิดงบรายเดือนจากเอกสาร ───────────────────────────────────────

const COST_CATEGORIES: readonly DocumentCategory[] = [
  "PURCHASE_MATERIAL", "FUEL", "TRANSPORT", "LABOR", "SERVICE", "OTHER_EXPENSE",
];

export interface MonthlyDocumentClose {
  readonly month: string;
  readonly sales_document_count: number;
  readonly purchase_document_count: number;
  readonly revenue: number;
  readonly material_cost: number;
  readonly fuel_cost: number;
  readonly transport_cost: number;
  readonly labor_cost: number;
  readonly service_expense: number;
  readonly other_expense: number;
  readonly vat_output: number;
  readonly vat_input: number;
  readonly vat_net: number;
  readonly documented_expense_total: number;
  readonly undocumented_expense_total: number;
  readonly document_ids: readonly string[];
}

/** งบบริษัทใช้เฉพาะเอกสารที่ยืนยันว่าเป็นของบริษัทและยังมีผล (§5) */
export function companyPostable(docs: readonly SourceDocument[]): readonly SourceDocument[] {
  return docs.filter((d) => d.ownership === "COMPANY_CONFIRMED" && d.postable);
}

export function closeDocumentMonths(docs: readonly SourceDocument[]): readonly MonthlyDocumentClose[] {
  const posted = companyPostable(docs);
  const months = [...new Set(posted.map((d) => d.month))].filter((m) => m !== "").sort();

  return months.map((month) => {
    const rows = posted.filter((d) => d.month === month);
    const sales = rows.filter((d) => d.category === "SALE");
    const costs = rows.filter((d) => COST_CATEGORIES.includes(d.category));
    const sumOf = (c: DocumentCategory) => round2(costs.filter((d) => d.category === c).reduce((a, d) => a + d.total, 0));
    // §6 VAT นับเฉพาะบรรทัดที่เอกสารระบุจำนวนไว้จริง null คือไม่ระบุ ไม่ใช่ศูนย์
    const vatOut = round2(sales.reduce((a, d) => a + (d.vat ?? 0), 0));
    const vatIn = round2(costs.reduce((a, d) => a + (d.vat ?? 0), 0));
    // §10 "มีเอกสาร" หมายถึงเปิดต้นฉบับได้จริง ไม่ใช่แค่มีเลขที่เอกสารพิมพ์ไว้
    const documented = round2(costs.filter((d) => d.pointer_kind === "ORIGINAL_FILE")
      .reduce((a, d) => a + d.total, 0));

    return {
      month,
      sales_document_count: sales.length,
      purchase_document_count: costs.length,
      revenue: round2(sales.reduce((a, d) => a + d.subtotal, 0)),
      material_cost: sumOf("PURCHASE_MATERIAL"), fuel_cost: sumOf("FUEL"),
      transport_cost: sumOf("TRANSPORT"), labor_cost: sumOf("LABOR"),
      service_expense: sumOf("SERVICE"), other_expense: sumOf("OTHER_EXPENSE"),
      vat_output: vatOut, vat_input: vatIn, vat_net: round2(vatOut - vatIn),
      documented_expense_total: documented,
      undocumented_expense_total: round2(costs.reduce((a, d) => a + d.total, 0) - documented),
      document_ids: rows.map((d) => d.document_id),
    };
  });
}

// ─── §9 ชั้นการชำระเงิน แยกจากเอกสารโดยสิ้นเชิง ─────────────────────────────

export type BankLinkState = "MATCHED" | "UNMATCHED" | "AMBIGUOUS";

export interface BankLink {
  readonly transaction_id: string;
  readonly state: BankLinkState;
  readonly document_id: string | null;
  readonly reason: string;
}

/**
 * จับคู่ได้เฉพาะหลักฐานที่ชี้ตัวได้แน่นอน คือคอลัมน์ matched_receipt_document_id
 * ที่ระบบเดิมเขียนไว้ หรือยอดตรงกันพอดีในวันเดียวกันและมีเอกสารเดียวเท่านั้น
 * §9 จับไม่ได้ไม่ลบทั้งเอกสารและไม่ลบการเคลื่อนไหวของเงิน
 */
export function linkBankToDocuments(
  bankRows: readonly Row[],
  docs: readonly SourceDocument[],
): readonly BankLink[] {
  const candidates = docs.filter((d) => d.postable && d.total > 0);
  return bankRows.map((b) => {
    const txId = String(b.id);
    const explicit = b.matched_receipt_document_id;
    if (explicit !== null && explicit !== undefined && String(explicit) !== "") {
      return { transaction_id: txId, state: "MATCHED" as const, document_id: String(explicit),
        reason: "ระบบเดิมบันทึกการจับคู่ไว้แล้วในคอลัมน์ matched_receipt_document_id" };
    }
    const amount = n(b.amount);
    const date = parseBankDate(b.transaction_date);
    const hits = candidates.filter((d) => Math.abs(d.total - amount) < 0.01 && d.document_date === date);
    if (hits.length === 1) {
      return { transaction_id: txId, state: "MATCHED" as const, document_id: hits[0]!.document_id,
        reason: "ยอดตรงพอดีและวันที่ตรงกัน มีเอกสารเดียวที่เข้าเกณฑ์" };
    }
    if (hits.length > 1) {
      return { transaction_id: txId, state: "AMBIGUOUS" as const, document_id: null,
        reason: `มีเอกสาร ${hits.length} ฉบับที่ยอดและวันตรงกัน จับคู่แน่นอนไม่ได้` };
    }
    return { transaction_id: txId, state: "UNMATCHED" as const, document_id: null,
      reason: "ไม่มีเอกสารที่ยอดและวันที่ตรงกัน — ยังเป็นการเคลื่อนไหวของเงินที่นับอยู่เสมอ" };
  });
}

// ─── §11 ตัวตรวจสายเอกสาร ───────────────────────────────────────────────────

export interface LineageCheck {
  readonly id: string;
  readonly count: number;
  readonly verdict: "PASS" | "FAIL";
  readonly detail: string;
  readonly offending_ids: readonly string[];
}

export interface LineageVerdict {
  readonly checks: readonly LineageCheck[];
  readonly result: "DOCUMENT_FINANCE_LINEAGE_VERIFIED" | "PARTIAL" | "BROKEN";
}

export function verifyLineage(
  docs: readonly SourceDocument[],
  months: readonly MonthlyDocumentClose[],
): LineageVerdict {
  const posted = companyPostable(docs);
  const checks: LineageCheck[] = [];
  const add = (id: string, bad: readonly SourceDocument[] | readonly string[], detail: string) => {
    const ids = (bad as readonly unknown[]).map((b) => typeof b === "string" ? b : (b as SourceDocument).document_id);
    checks.push({ id, count: ids.length, verdict: ids.length === 0 ? "PASS" : "FAIL", detail, offending_ids: ids.slice(0, 10) });
  };

  // ยอดรวมทุกเดือนต้องมีแถวรองรับ
  add("SUMMARY_WITHOUT_ROWS", months.filter((m) => m.document_ids.length === 0).map((m) => m.month),
    "เดือนที่มียอดสรุปแต่ไม่มีแถวเอกสารรองรับ");

  // §6 VAT ทุกบาทต้องมีเอกสาร
  // §6 VAT ต้องมีเอกสารที่เปิดได้จริง หรือเป็นเอกสารที่บริษัทออกเอง
  add("TAX_AMOUNT_WITHOUT_DOCUMENT", posted.filter((d) => (d.vat ?? 0) !== 0 && d.pointer_kind === "NONE"),
    "ยอด VAT ที่ไม่มีเอกสารต้นทาง");

  const costs = posted.filter((d) => COST_CATEGORIES.includes(d.category));
  add("EXPENSE_WITHOUT_SOURCE_POINTER", costs.filter((d) => d.pointer_kind === "NONE"),
    "ค่าใช้จ่ายที่ไม่มี pointer กลับไปยังต้นฉบับ");
  add("REVENUE_WITHOUT_SOURCE_POINTER", posted.filter((d) => d.category === "SALE" && d.pointer_kind === "NONE"),
    "รายได้ที่ไม่มี pointer กลับไปยังต้นฉบับ");

  // ยอดในเอกสารต้องประกอบกันเอง
  add("DOCUMENT_TOTAL_MISMATCH",
    posted.filter((d) => d.vat !== null && Math.abs(d.subtotal + d.vat - d.total) > 0.01),
    "เอกสารที่ยอดก่อนภาษี บวกภาษี ไม่เท่ากับยอดรวม");

  add("LINE_ITEMS_NOT_EQUAL_DOCUMENT_TOTAL",
    posted.filter((d) => d.items.length > 0
      && Math.abs(d.items.reduce((a, it) => a + it.line_total, 0) - d.subtotal) > 0.01),
    "เอกสารที่ผลรวมรายการย่อยไม่เท่ากับยอดก่อนภาษี");

  // §5 ห้ามปนบริษัทกับส่วนตัว
  add("COMPANY_PERSONAL_MIX", posted.filter((d) => d.ownership !== "COMPANY_CONFIRMED"),
    "เอกสารที่เข้างบบริษัททั้งที่ยังไม่ยืนยันความเป็นเจ้าของ");

  // §4 ต้นฉบับที่มีรายละเอียดต้องไม่เหลือแค่ยอดรวม — รายงานทุกฉบับที่ไม่มีรายการย่อย
  add("DOCUMENT_WITHOUT_LINE_ITEMS", posted.filter((d) => d.items.length === 0),
    "เอกสารที่เข้างบแต่ไม่มีรายการย่อย เหลือเพียงยอดรวม");

  // §8 ใบแจ้งหนี้กับใบเสร็จของการขายเดียวกันต้องไม่ถูกนับเป็นรายได้สองครั้ง
  const sales = posted.filter((d) => d.category === "SALE");
  const dup = sales.filter((a) => sales.some((b) =>
    b.document_id !== a.document_id && b.counterparty_id !== null
    && b.counterparty_id === a.counterparty_id && Math.abs(b.total - a.total) < 0.01));
  add("REVENUE_POSSIBLE_DOUBLE_COUNT", dup,
    "เอกสารขายที่คู่ค้าเดียวกันและยอดเท่ากันพอดี เสี่ยงถูกนับรายได้ซ้ำ");

  const fails = checks.filter((c) => c.verdict === "FAIL");
  const result: LineageVerdict["result"] =
    fails.length === 0 ? "DOCUMENT_FINANCE_LINEAGE_VERIFIED"
      : posted.length === 0 ? "BROKEN" : "PARTIAL";
  return { checks, result };
}
