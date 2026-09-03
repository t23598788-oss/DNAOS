/**
 * หน้าที่: the one shape a normalized expense takes inside DNA OS.
 * Every field that the source email did not actually state is the literal
 * string "UNKNOWN" — never a guess, never a zero standing in for a missing
 * amount. `extraction_reasons` records why each UNKNOWN is UNKNOWN, so a
 * report row can always explain its own gaps.
 * Input: none (types only).
 * Output: NormalizedExpense, ExpenseExtraction.
 * Dependency ที่อนุญาต: none.
 * สิ่งที่ห้ามแตะ: ห้ามเปลี่ยน UNKNOWN ให้เป็น 0 หรือ null เพื่อให้ยอดรวม
 * ดูสวยขึ้น — ยอดที่อีเมลไม่ได้บอกคือยอดที่ระบบไม่รู้.
 */

export const UNKNOWN = "UNKNOWN" as const;
export type Unknown = typeof UNKNOWN;

export interface NormalizedExpense {
  /** Deterministic: derived from the Gmail message id, so re-ingesting the same email can never create a second row. */
  readonly expense_id: string;
  readonly source_message_id: string;
  readonly source_thread_id: string | Unknown;
  readonly source_sender: string;
  readonly source_subject: string;
  readonly source_query: string;
  readonly provider: string;
  readonly invoice_identity: string | Unknown;
  readonly billing_period: string | Unknown;
  readonly charged_at: string;
  readonly currency: string | Unknown;
  readonly amount: string | Unknown;
  readonly tax_amount: string | Unknown;
  readonly description: string | Unknown;
  readonly payment_state: string | Unknown;
  readonly extraction_reasons: readonly string[];
  readonly ingested_at: string;
}

export interface ExpenseExtraction {
  readonly ok: boolean;
  readonly expense: NormalizedExpense | null;
  /** Set only when ok=false — an email discovered but not turned into a row still has a stated reason, never a silent drop. */
  readonly skipped_reason: string | null;
}
