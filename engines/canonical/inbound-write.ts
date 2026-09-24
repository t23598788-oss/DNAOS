/**
 * Canonical inbound source write model (Phase D6).
 *
 * Every inbound channel (LINE / upload / email / bank) normalises into the two real
 * owners: `receipt_documents` (the inbound record: media + extraction + payment
 * evidence) and `business_events` (business meaning extracted from it).
 *
 * Provenance is recorded truthfully:
 *   channel · media_path · size/mime/hash **only when provable** · OCR text ·
 *   confidence · company/transaction linkage **only when evidenced**
 * No evidence ⇒ NULL / UNLINKED. Nothing is guessed.
 */
import { supabaseAdmin } from "@/services/supabase/queries";
import { recordCanonicalAudit } from "@/engines/canonical/audit";

export type InboundChannel = "line" | "upload" | "email" | "bank" | "drive";

/** สถานะ receipt ที่ closed vocabulary นี้อนุญาต (ไม่ใช่ string อิสระ):
 * claim ข้อความ = waiting_bank_confirmation (Rule 115 Level 1) ·
 * ทุกอย่างอื่น = ai_read (รอ review) — P4b 2026-09-24 */
export type InboundReceiptStatus = "ai_read" | "waiting_bank_confirmation";

export interface InboundSourceInput {
  channel: InboundChannel;
  /**
   * media_path as stored today: a storage object name, `local_backfill:<path>`
   * or `local_drive:<path>` — ว่างได้เฉพาะเมื่อ raw_ocr_text เป็นหลักฐานแทน
   * (LINE payment claim ไม่มีรูป · P4b 2026-09-24) · ต้องมีอย่างใดอย่างหนึ่ง
   */
  media_path: string | null;
  document_type: string;
  received_at?: string | null;
  /** provable media facts only — omit when the bytes were not hashed/sized */
  media_size_bytes?: number | null;
  media_mime_type?: string | null;
  media_sha256?: string | null;
  /** extraction side */
  raw_ocr_text?: string | null;
  amount?: number | null;
  sender_name?: string | null;
  sender_bank?: string | null;
  sender_account_number?: string | null;
  transaction_datetime?: string | null;
  confidence?: number | null;
  /** linkage only when evidenced */
  customer_company_id?: string | null;
  linked_invoice_id?: string | null;
  linked_document_id?: string | null;
  provider_message_id?: string | null;
  /** เลข reference บนสลิปจริง (bank reference) — ต่างจาก provider_message_id
   * ซึ่งเป็น id ข้อความ provider · fraud gate สลิปซ้ำอ่านคอลัมน์นี้ */
  reference_number?: string | null;
  /** วันที่บนเอกสารจริง (YYYY-MM-DD) — ชนะการ slice จาก transaction_datetime */
  document_date?: string | null;
  /** แถว LINE message ต้นทาง — ความเชื่อมโยงของ provider อยู่ฝั่ง provider */
  line_event_id?: string | null;
  vendor_name?: string | null;
  description?: string | null;
  /** Rule 115 evidence level (1..4) — caller คำนวณจากหลักฐานจริงเท่านั้น ห้ามเดา */
  verification_level?: number | null;
  /** คำเตือนการอ่าน/ตรวจจริงจาก caller (OCR/fraud gates) — เก็บ as-is ไม่เติมเอง */
  error_th?: string | null;
  /** closed vocabulary: claim = waiting_bank_confirmation · ที่เหลือ = ai_read */
  status?: InboundReceiptStatus;
  actor: string;
  provenance?: Record<string, unknown> | null;
}

export interface InboundSourceResult {
  receipt_document_id: string;
  status: string;
  unlinked: boolean;
  media_verified: boolean;
}

export async function recordInboundSource(input: InboundSourceInput): Promise<InboundSourceResult> {
  const db = supabaseAdmin();
  const hasMedia = Boolean(input.media_path?.trim());
  if (!hasMedia && !input.raw_ocr_text?.trim()) {
    throw new Error("INBOUND_EVIDENCE_REQUIRED: ต้องมี media_path หรือ raw_ocr_text ของต้นฉบับอย่างใดอย่างหนึ่ง");
  }
  if (input.status && !["ai_read", "waiting_bank_confirmation"].includes(input.status)) {
    throw new Error(`INBOUND_STATUS_INVALID: status ต้องเป็น ai_read หรือ waiting_bank_confirmation (ได้ ${input.status})`);
  }
  if (
    input.verification_level !== null &&
    input.verification_level !== undefined &&
    (!Number.isInteger(input.verification_level) || input.verification_level < 1 || input.verification_level > 4)
  ) {
    throw new Error(`INBOUND_VERIFICATION_LEVEL_INVALID: ต้องเป็นระดับ Rule 115 ตัวเลข 1-4 (ได้ ${input.verification_level})`);
  }

  const mediaVerified = Boolean(input.media_sha256 || input.media_size_bytes || input.media_mime_type);
  const row: Record<string, unknown> = {
    media_path: input.media_path ?? null,
    document_type: input.document_type,
    source_channel: input.channel,
    status: input.status ?? "ai_read",
    raw_ocr_text: input.raw_ocr_text ?? null,
    amount: input.amount ?? null,
    document_date: input.document_date
      ?? (input.transaction_datetime ? String(input.transaction_datetime).slice(0, 10) : null),
    sender_name: input.sender_name ?? null,
    sender_bank: input.sender_bank ?? null,
    sender_account_number: input.sender_account_number ?? null,
    transaction_datetime: input.transaction_datetime ?? null,
    confidence: input.confidence ?? null,
    customer_company_id: input.customer_company_id ?? null,
    line_event_id: input.line_event_id ?? null,
    vendor_name: input.vendor_name ?? null,
    description: input.description ?? null,
    verification_level: input.verification_level ?? null,
    error_th: input.error_th ?? null,
    media_size_bytes: input.media_size_bytes ?? null,
    media_mime_type: input.media_mime_type ?? null,
    media_sha256: input.media_sha256 ?? null,
    // media ไม่มีจริง (claim) = ไม่มีวันเวลา capture — ห้ามเติมเวลาแทนรูป
    media_captured_at: hasMedia ? (input.received_at ?? new Date().toISOString()) : null,
    allocation_state: "unallocated",
  };
  if (input.reference_number) row.reference_number = input.reference_number;
  else if (input.provider_message_id) row.reference_number = input.provider_message_id;

  const { data, error } = await db.from("receipt_documents").insert(row).select("id, status").single();
  if (error) throw new Error(`บันทึกต้นฉบับขาเข้าไม่สำเร็จ: ${error.message}`);

  await recordCanonicalAudit({
    action: "document.created",
    entity_type: "receipt_document",
    entity_id: String(data.id),
    actor: input.actor,
    company_id: input.customer_company_id ?? null,
    new_value: { channel: input.channel, document_type: input.document_type, media_path: input.media_path, media_verified: mediaVerified },
    evidence: { provenance: input.provenance ?? null, confidence: input.confidence ?? null, unlinked: !input.customer_company_id },
  });

  return {
    receipt_document_id: String(data.id),
    status: String(data.status),
    unlinked: !input.customer_company_id,
    media_verified: mediaVerified,
  };
}

/** Link an inbound record to a document — only with real evidence (writes the SOURCE edge). */
export async function linkInboundSource(input: {
  receipt_document_id: string;
  document_kind: "invoice" | "standalone_document";
  document_id: string;
  actor: string;
  evidence_ref?: string | null;
}) {
  const db = supabaseAdmin();
  const { error } = await db.from("inbound_source_links").insert({
    relation_type: "SOURCE",
    receipt_document_id: input.receipt_document_id,
    invoice_id: input.document_kind === "invoice" ? input.document_id : null,
    standalone_document_id: input.document_kind === "standalone_document" ? input.document_id : null,
    evidence_ref: input.evidence_ref ?? null,
    created_by: input.actor,
  });
  if (error) throw new Error(`ผูกต้นฉบับกับเอกสารไม่สำเร็จ: ${error.message}`);
  await recordCanonicalAudit({
    action: "document.updated",
    entity_type: "receipt_document",
    entity_id: input.receipt_document_id,
    actor: input.actor,
    field: "inbound_source_link",
    new_value: { document_kind: input.document_kind, document_id: input.document_id },
    evidence: { evidence_ref: input.evidence_ref ?? null },
  });
}
