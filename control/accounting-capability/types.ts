/**
 * หน้าที่: สัญญาสาธารณะของ ACCOUNTING_CAPABILITY — ขอบเดียวที่ระบบอื่นเห็น
 *
 * Owner, 2026-09-05 (TASK: CONSOLIDATE_ACCOUNTING_INTO_SINGLE_REGISTERED_CAPABILITY):
 * "ระบบภายนอกต้องไม่รู้ implementation ภายใน kernel และห้ามเชื่อมตรงเข้าตารางภายใน"
 *
 * กติกาของไฟล์นี้:
 * - ห้ามมีชื่อตาราง SQL ของ kernel ปรากฏในสัญญาสาธารณะ
 *   (journal_lines / chart_of_accounts / financial_events ฯลฯ อยู่หลังขอบทั้งหมด)
 * - ชื่อบัญชีที่ส่งออกเป็นความหมายทางธุรกิจ ไม่ใช่รหัสผังบัญชี
 *
 * Dependency ที่อนุญาต: ไม่มี (เป็นสัญญาล้วน)
 * สิ่งที่ห้ามแตะ:
 * - ห้ามเพิ่ม field ที่บังคับให้ผู้เรียกรู้โครงสร้างภายใน kernel
 */

// ─── ส่วนที่ทุก input ต้องมีเหมือนกัน ────────────────────────────────────────

/** แหล่งข้อมูลจริงที่ระบบเดิมเป็นเจ้าของ — capability ไม่เคยเป็นเจ้าของ */
export type SourceType =
  | "invoices" | "standalone_documents" | "company_expenses"
  | "partner_payable_requests" | "bank_statement_transactions"
  | "receipt_documents" | "debt_events" | "business_events";

export interface EvidencePointer {
  readonly source_type: SourceType;
  readonly source_id: string;
  /** ต้นฉบับที่เปิดได้จริง ถ้ามี — null คือมีแต่แถวในระบบเดิม */
  readonly original_pointer: string | null;
}

export interface AccountingInputBase {
  readonly source_type: SourceType;
  readonly source_id: string;
  readonly occurred_at: string;
  readonly company_id: string;
  readonly evidence: readonly EvidencePointer[];
  /** กันโพสต์ซ้ำ — ผู้เรียกเป็นคนกำหนดและต้องคงที่สำหรับเหตุการณ์เดียวกัน */
  readonly idempotency_key: string;
}

// ─── ยอดที่ชั้นคำนวณเอกสารยืนยันแล้ว (Phase 4) ──────────────────────────────

/**
 * kernel ไม่คำนวณ VAT เอง — รับค่าชุดนี้ที่ calculation core ยืนยันมาแล้วเท่านั้น
 * ทุกตัวเป็นบาท ปัดสองตำแหน่งแล้ว
 */
export interface DocumentAmounts {
  readonly subtotal: number;
  readonly discount: number;
  readonly tax_base: number;
  readonly vat_rate: number;
  readonly vat_amount: number;
  readonly total_amount: number;
  readonly withholding_rate: number;
  readonly withholding_amount: number;
}

// ─── INPUT CONTRACT ─────────────────────────────────────────────────────────

export interface BusinessEventInput extends AccountingInputBase {
  readonly kind: "BUSINESS_EVENT";
  readonly payload: { readonly observed_intent: string };
}

export interface SalesDocumentInput extends AccountingInputBase {
  readonly kind: "SALES_DOCUMENT";
  readonly payload: {
    readonly document_no: string;
    readonly is_tax_invoice: boolean;
    readonly amounts: DocumentAmounts;
  };
}

export interface PurchaseDocumentInput extends AccountingInputBase {
  readonly kind: "PURCHASE_DOCUMENT";
  readonly payload: {
    readonly document_no: string;
    readonly vendor_company_id: string;
    readonly amounts: DocumentAmounts;
  };
}

/** การชำระเงินหนึ่งครั้ง กระจายลงเอกสารได้หลายฉบับ */
export interface PaymentAllocationRequest {
  readonly side: "RECEIVABLE" | "PAYABLE";
  readonly document_source_type: SourceType;
  readonly document_source_id: string;
  readonly amount: number;
}

export interface PaymentInput extends AccountingInputBase {
  readonly kind: "PAYMENT";
  readonly payload: {
    readonly direction: "MONEY_IN" | "MONEY_OUT";
    readonly amount: number;
    readonly allocations: readonly PaymentAllocationRequest[];
  };
}

export interface BankTransactionInput extends AccountingInputBase {
  readonly kind: "BANK_TRANSACTION";
  readonly payload: {
    readonly direction: "MONEY_IN" | "MONEY_OUT";
    readonly amount: number;
    readonly allocations: readonly PaymentAllocationRequest[];
  };
}

export interface CreditNoteInput extends AccountingInputBase {
  readonly kind: "CREDIT_NOTE";
  readonly payload: {
    readonly credit_note_no: string;
    readonly against_source_type: SourceType;
    readonly against_source_id: string;
    readonly amounts: DocumentAmounts;
  };
}

export interface AdjustmentInput extends AccountingInputBase {
  readonly kind: "ADJUSTMENT";
  readonly payload: { readonly reason: string; readonly amount: number };
}

export type AccountingQueryName =
  | "AR_STATUS" | "AP_STATUS" | "OUTSTANDING" | "TRIAL_BALANCE"
  | "PNL" | "BALANCE_SHEET" | "VAT_RESULT" | "WHT_RESULT"
  | "TAX_PACKAGE" | "ACCOUNTING_EVIDENCE" | "JOURNAL_ENTRY";

export interface AccountingQueryInput {
  readonly kind: "ACCOUNTING_QUERY";
  readonly query: AccountingQueryName;
  readonly period_code?: string;
  readonly company_id?: string;
  readonly source_type?: SourceType;
  readonly source_id?: string;
}

export type AccountingInput =
  | BusinessEventInput | SalesDocumentInput | PurchaseDocumentInput
  | PaymentInput | BankTransactionInput | CreditNoteInput
  | AdjustmentInput | AccountingQueryInput;

// ─── OUTPUT CONTRACT ────────────────────────────────────────────────────────

export interface JournalLineOut {
  readonly account: string;
  readonly account_type: "ASSET" | "LIABILITY" | "EQUITY" | "REVENUE" | "EXPENSE";
  readonly debit: number;
  readonly credit: number;
}

export interface JournalEntryOut {
  readonly entry_id: string;
  readonly period_code: string;
  readonly memo: string;
  readonly lines: readonly JournalLineOut[];
  readonly balanced: boolean;
}

export interface PostingResultOut {
  readonly kind: "POSTING_RESULT";
  readonly posted: boolean;
  /** true = เคยโพสต์แล้ว คืนผลเดิม ไม่ได้โพสต์ซ้ำ */
  readonly idempotent_replay: boolean;
  readonly entry: JournalEntryOut;
  readonly evidence: readonly EvidencePointer[];
}

export interface BalanceLineOut {
  readonly source_type: SourceType | null;
  readonly source_id: string | null;
  readonly document_no: string | null;
  readonly amount: number;
}

export interface ArStatusOut { readonly kind: "AR_STATUS"; readonly lines: readonly BalanceLineOut[]; readonly total: number }
export interface ApStatusOut { readonly kind: "AP_STATUS"; readonly lines: readonly BalanceLineOut[]; readonly total: number }
export interface OutstandingOut { readonly kind: "OUTSTANDING"; readonly receivable: number; readonly payable: number }
export interface PaymentAllocationOut {
  readonly kind: "PAYMENT_ALLOCATION";
  readonly allocations: readonly (PaymentAllocationRequest & { readonly applied: boolean })[];
  readonly unallocated: number;
}
export interface VatResultOut {
  readonly kind: "VAT_RESULT"; readonly period_code: string;
  readonly output_vat: number; readonly input_vat: number; readonly net_vat: number;
}
export interface WhtResultOut {
  readonly kind: "WHT_RESULT"; readonly period_code: string;
  readonly receivable: number; readonly payable: number;
}
export interface TrialBalanceOut {
  readonly kind: "TRIAL_BALANCE";
  readonly rows: readonly { readonly account: string; readonly debit: number; readonly credit: number }[];
  readonly total_debit: number; readonly total_credit: number; readonly balanced: boolean;
}
export interface PnlOut {
  readonly kind: "PNL";
  readonly revenue: number; readonly expense: number; readonly profit: number;
}
export interface BalanceSheetOut {
  readonly kind: "BALANCE_SHEET";
  readonly assets: number; readonly liabilities: number; readonly equity: number; readonly balanced: boolean;
}
export interface TaxPackageOut {
  readonly kind: "TAX_PACKAGE"; readonly period_code: string;
  readonly output_vat: number; readonly input_vat: number; readonly net_vat: number;
  readonly built_from_ledger: true; readonly submitted: false;
}
export interface AccountingEvidenceOut {
  readonly kind: "ACCOUNTING_EVIDENCE";
  readonly entry_id: string;
  readonly traces_to: readonly EvidencePointer[];
}
export interface ErrorResultOut {
  readonly kind: "ERROR_RESULT";
  readonly reason_code: string;
  readonly reason: string;
}

export type AccountingOutput =
  | PostingResultOut | JournalEntryOut & { kind: "JOURNAL_ENTRY" }
  | ArStatusOut | ApStatusOut | PaymentAllocationOut | OutstandingOut
  | VatResultOut | WhtResultOut | TrialBalanceOut | PnlOut | BalanceSheetOut
  | TaxPackageOut | AccountingEvidenceOut | ErrorResultOut;
