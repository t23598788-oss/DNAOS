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

export interface InboundSourceInput {
  channel: InboundChannel;
  /** media_path as stored today: a storage object name, `local_backfill:<path>` or `local_drive:<path>` */
  media_path: string;
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
  if (!input.media_path?.trim()) throw new Error("INBOUND_MEDIA_REQUIRED: ต้องมี media_path จริงของต้นฉบับ");

  const mediaVerified = Boolean(input.media_sha256 || input.media_size_bytes || input.media_mime_type);
  const row: Record<string, unknown> = {
    media_path: input.media_path,
    document_type: input.document_type,
    source_channel: input.channel,
    status: "ai_read",
    raw_ocr_text: input.raw_ocr_text ?? null,
    amount: input.amount ?? null,
    document_date: input.transaction_datetime ? String(input.transaction_datetime).slice(0, 10) : null,
    sender_name: input.sender_name ?? null,
    sender_bank: input.sender_bank ?? null,
    sender_account_number: input.sender_account_number ?? null,
    transaction_datetime: input.transaction_datetime ?? null,
    confidence: input.confidence ?? null,
    customer_company_id: input.customer_company_id ?? null,
    media_size_bytes: input.media_size_bytes ?? null,
    media_mime_type: input.media_mime_type ?? null,
    media_sha256: input.media_sha256 ?? null,
    media_captured_at: input.received_at ?? new Date().toISOString(),
    allocation_state: "unallocated",
  };
  if (input.provider_message_id) row.reference_number = input.provider_message_id;

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
