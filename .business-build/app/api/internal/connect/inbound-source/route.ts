/**
 * POST /api/internal/connect/inbound-source — Connect inbound-evidence bridge
 * (LINE financial-edge removal P4b · owner approval 2026-09-24).
 *
 * ประตูเดียวที่ provider tier สร้าง receipt_documents (payment claim ·
 * OCR slip) — แทนการ insert business table ตรง ๆ จาก Deno: คำขอมานี้ →
 * engines/canonical/inbound-write.ts#recordInboundSource (canonical writer +
 * audit + evidence rules เดียวกับ admin upload/email/bank channels)
 *
 *   External Provider → Connect normalization → POST .../inbound-source
 *     → recordInboundSource → public.receipt_documents (+ canonical audit)
 *
 * ไม่ใช่เส้นยืนยันเงิน: แถวที่เกิดจาก bridge คือสถานะ Pending (ai_read หรือ
 * waiting_bank_confirmation เท่านั้น — closed vocabulary) · Rule 72 ยังอยู่
 * ครบ: การยืนยันยอดเงินเป็นคนละเส้น (payment-confirm / manual route)
 *
 * Auth: one secret per bridge — INBOUND_SOURCE_INTERNAL_SECRET + header
 * x-inbound-source-internal-secret (รูปแบบเดียวกับ connect/payment-confirm/
 * LINE_COMMAND/CANONICAL_JOB internal bridges ทั้งหมด) · fail-closed: ไม่มี
 * secret = 503 · ไม่ตรง = 401 · writer ปฏิเสธ = ok:false (ไม่มี fallback
 * ไม่มีการ insert ตรง) · release ต้องตั้งคู่ two-sided (Next + Supabase
 * secrets คู่กับ DNA_OS_APP_URL) — ไม่งั้น claim/OCR แถวใหม่เกิดไม่ได้
 * โดย design และ caller จัดการ fail ของตัวเอง
 *
 * Body: field ที่ระบุเองทีละตัว (ไม่มี object spread เข้า writer — เงื่อนไข
 * เดียวกับ admin route) · actor บังคับ · channel ต้องอยู่ใน canonical list
 * Envelope { ok, error?, data? } รูปเดียวกับ connect/event + payment-confirm
 */
import { NextResponse } from "next/server";
import {
  recordInboundSource,
  type InboundChannel,
  type InboundReceiptStatus,
} from "@/engines/canonical/inbound-write";

const ALLOWED_CHANNELS: InboundChannel[] = ["line", "upload", "email", "bank", "drive"];
const ALLOWED_STATUSES: InboundReceiptStatus[] = ["ai_read", "waiting_bank_confirmation"];

const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
const numOrNull = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

interface InboundSourceRequest {
  channel?: string;
  document_type?: string;
  media_path?: string | null;
  raw_ocr_text?: string | null;
  line_event_id?: string | null;
  customer_company_id?: string | null;
  amount?: number | null;
  sender_name?: string | null;
  sender_bank?: string | null;
  reference_number?: string | null;
  transaction_datetime?: string | null;
  document_date?: string | null;
  vendor_name?: string | null;
  description?: string | null;
  confidence?: number | null;
  verification_level?: number | null;
  error_th?: string | null;
  status?: string;
  provenance?: Record<string, unknown> | null;
  actor?: string;
}

export async function POST(req: Request) {
  const secret = process.env.INBOUND_SOURCE_INTERNAL_SECRET;
  if (!secret) {
    return NextResponse.json({ ok: false, error: "INBOUND_SOURCE_INTERNAL_SECRET not configured" }, { status: 503 });
  }
  if (req.headers.get("x-inbound-source-internal-secret") !== secret) {
    return NextResponse.json({ ok: false, error: "ไม่ได้รับอนุญาต" }, { status: 401 });
  }

  let body: InboundSourceRequest;
  try {
    body = (await req.json()) as InboundSourceRequest;
  } catch {
    return NextResponse.json({ ok: false, error: "unparseable JSON body" }, { status: 400 });
  }

  const channel = str(body.channel) as InboundChannel | null;
  if (!channel || !ALLOWED_CHANNELS.includes(channel)) {
    return NextResponse.json({ ok: false, error: `channel ต้องเป็นหนึ่งใน ${ALLOWED_CHANNELS.join(", ")}` }, { status: 400 });
  }
  const documentType = str(body.document_type);
  if (!documentType) {
    return NextResponse.json({ ok: false, error: "document_type is required" }, { status: 400 });
  }
  const actor = str(body.actor);
  if (!actor) {
    return NextResponse.json({ ok: false, error: "actor is required" }, { status: 400 });
  }
  const status = str(body.status) as InboundReceiptStatus | null;
  if (status && !ALLOWED_STATUSES.includes(status)) {
    return NextResponse.json({ ok: false, error: `status ต้องเป็นหนึ่งใน ${ALLOWED_STATUSES.join(", ")}` }, { status: 400 });
  }

  try {
    const created = await recordInboundSource({
      channel,
      media_path: str(body.media_path) ?? (typeof body.media_path === "string" ? body.media_path : null),
      document_type: documentType,
      raw_ocr_text: str(body.raw_ocr_text) ?? null,
      line_event_id: str(body.line_event_id) ?? null,
      customer_company_id: str(body.customer_company_id) ?? null,
      amount: numOrNull(body.amount),
      sender_name: str(body.sender_name) ?? null,
      sender_bank: str(body.sender_bank) ?? null,
      reference_number: str(body.reference_number) ?? null,
      transaction_datetime: str(body.transaction_datetime) ?? null,
      document_date: str(body.document_date) ?? null,
      vendor_name: str(body.vendor_name) ?? null,
      description: str(body.description) ?? null,
      confidence: numOrNull(body.confidence),
      verification_level: numOrNull(body.verification_level),
      error_th: str(body.error_th) ?? null,
      status: status ?? undefined,
      actor,
      provenance: body.provenance ?? null,
    });
    return NextResponse.json({ ok: true, data: created });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "บันทึกต้นฉบับขาเข้าไม่สำเร็จ";
    // canonical writer ปฏิเสธ (evidence/status/level rules) — fail-closed 422
    return NextResponse.json({ ok: false, error: message }, { status: 422 });
  }
}
