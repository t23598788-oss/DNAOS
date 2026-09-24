/**
 * POST /api/internal/connect/payment-confirm — Connect money bridge
 * (LINE financial-edge removal P4 · owner decision D2 = ก, 2026-09-24).
 *
 * เส้นเดียวที่ provider tier (Deno) ใช้ยืนยันรับเงิน — แทนการเรียก RPC
 * reconcile_receipt_payment ตรง ๆ ซึ่งเป็น payment authority เส้นที่ 2 ที่
 * reconciliation รอบนี้ปิด: คำขอมาที่นี่ → engines/canonical/
 * receipt-confirm-flow.ts (ชุดเดียวกับ manual confirm) → confirmPayment
 * (B-04 guards + atomic RPC) → receipt finalization 4 fields
 *
 *   External Provider → Connect normalization → POST .../payment-confirm
 *     → confirmReceiptPayment → confirmPayment → public.* (canonical)
 *
 * Auth: one secret per bridge — PAYMENT_CONFIRM_INTERNAL_SECRET ส่งเป็น header
 * (รูปแบบเดียวกับ LINE_COMMAND/CANONICAL_JOB/DOCUMENT_ARTIFACT/CONNECT
 * internal bridges ทั้งหมด — ชื่อ scope เป็นของ Connect ไม่ใช่ของ provider
 * เพราะ boundary นี้เป็น provider-neutral) · fail-closed ทุกกรณี:
 * ไม่มี secret = 503 · ไม่ตรง = 401 · flow ปฏิเสธ = ok:false (ไม่มี fallback
 * ไม่มีการเขียนเงินสำรอง) — และ release ต้องตั้งฝั่ง Next (ไฟล์นี้) PLUS
 * ฝั่ง Deno (supabase secrets: PAYMENT_CONFIRM_INTERNAL_SECRET +
 * DNA_OS_APP_URL) ให้ครบคู่ ไม่งั้น auto-confirm ค้าง Pending Review โดย design
 *
 * Body รับเฉพาะ 2 field ที่พิมพ์เองได้จริง: receipt_document_id + actor —
 * ไม่รับ row shape ไม่รับ amount/outstanding (ทุกอย่างอ่านจาก canonical
 * ข้างในโฟลว์ ผู้เรียกไม่มีทางใส่ตัวเลขเงินเอง)
 * Envelope { ok, error?, data? } รูปเดียวกับ /connect/event — Deno transports
 * ทั้งสองฝั่งจึงเป็น isomorphic กัน
 */
import { NextResponse } from "next/server";
import { confirmReceiptPayment } from "@/engines/canonical/receipt-confirm-flow";

interface PaymentConfirmRequest {
  receipt_document_id?: string;
  actor?: string;
}

export async function POST(req: Request) {
  const secret = process.env.PAYMENT_CONFIRM_INTERNAL_SECRET;
  if (!secret) {
    return NextResponse.json({ ok: false, error: "PAYMENT_CONFIRM_INTERNAL_SECRET not configured" }, { status: 503 });
  }
  if (req.headers.get("x-payment-confirm-internal-secret") !== secret) {
    return NextResponse.json({ ok: false, error: "ไม่ได้รับอนุญาต" }, { status: 401 });
  }

  let body: PaymentConfirmRequest;
  try {
    body = (await req.json()) as PaymentConfirmRequest;
  } catch {
    return NextResponse.json({ ok: false, error: "unparseable JSON body" }, { status: 400 });
  }

  const receiptDocumentId = typeof body.receipt_document_id === "string" ? body.receipt_document_id.trim() : "";
  const actor = typeof body.actor === "string" ? body.actor.trim() : "";
  if (!receiptDocumentId) {
    return NextResponse.json({ ok: false, error: "receipt_document_id is required" }, { status: 400 });
  }
  if (!actor) {
    return NextResponse.json({ ok: false, error: "actor is required" }, { status: 400 });
  }

  const outcome = await confirmReceiptPayment({ receipt_document_id: receiptDocumentId, actor });

  if (!outcome.ok) {
    // flow ปฏิเสธ (eligibility/snapshot/guards) — fail-closed ไม่มีการเขียนเงิน
    // 422 = canonical writer ปฏิเสธ (ผู้เรียกปล่อย slip ค้าง Pending Review ได้)
    return NextResponse.json({ ok: false, error: outcome.error ?? "RECEIPT_NOT_CONFIRMABLE" }, { status: 422 });
  }

  return NextResponse.json({
    ok: true,
    data: {
      already_reconciled: outcome.already_reconciled,
      new_outstanding: outcome.new_outstanding,
      debt_event_id: outcome.debt_event_id,
    },
  });
}
