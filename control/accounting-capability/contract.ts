/**
 * หน้าที่: ขอบสาธารณะของ control/accounting-capability/ — ไฟล์เดียวที่ capability
 * อื่นมีสิทธิ์ import
 *
 * Owner, 2026-09-05: ระบบอื่นต้องไม่รู้ว่าเบื้องหลังคือ kernel ตัวไหน ตารางชื่ออะไร
 * จึงไม่ re-export ./kernel-gateway.ts ออกไปเด็ดขาด
 *
 * Input: re-export เท่านั้น
 * Output: executeAccounting, calculateDocument, และชนิดที่ผู้เรียกต้องใช้
 * สิ่งที่ห้ามแตะ: ห้าม re-export kernel-gateway — เป็น implementation ภายใน
 */

export { executeAccounting, buildWriteIntent, ACCOUNTING_CAPABILITY_ID } from "./capability";
export type { CapabilityCaller, ExecuteOptions } from "./capability";
export { calculateDocument, amountsAreConsistent } from "./calculation";
export type { CalculationRequest, CalculationOutcome } from "./calculation";
export type {
  AccountingInput, AccountingOutput, AccountingQueryInput, AccountingQueryName,
  AdjustmentInput, BankTransactionInput, BusinessEventInput, CreditNoteInput,
  DocumentAmounts, EvidencePointer, PaymentAllocationRequest, PaymentInput,
  PurchaseDocumentInput, SalesDocumentInput, SourceType,
  ArStatusOut, ApStatusOut, BalanceSheetOut, ErrorResultOut, JournalEntryOut,
  OutstandingOut, PnlOut, PostingResultOut, TaxPackageOut, TrialBalanceOut,
  VatResultOut, WhtResultOut, AccountingEvidenceOut,
} from "./types";
