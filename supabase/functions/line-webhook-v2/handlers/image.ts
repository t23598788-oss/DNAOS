import type { HandlerContext, LineMessageEvent } from "../events/types.ts"
import { saveEvent } from "../events/store.ts"
import { fetchAndStoreLineMedia } from "../engines/media.ts"
import { classifyReceiptImage } from "../engines/ocr-classify.ts"
import { tryAutoConfirmPayment } from "../engines/auto-confirm-payment.ts"

export async function handleImage(ctx: HandlerContext): Promise<void> {
  const msgEvent = ctx.event as LineMessageEvent
  const messageId = (msgEvent.message as any).id ?? ""

  const saved = await saveEvent(ctx.supabase, {
    event:   ctx.event,
    userId:  ctx.userId,
    groupId: ctx.groupId,
    rawType: "image",
    rawText: messageId,
    status:  "new",
  })

  // Human Reality Timeline (owner, 2026-07-16/17): "รูปภาพ → เห็นรูปเดิม" —
  // fetch and store the real original image so it can actually be shown
  // later, not just a "(ส่งรูปภาพ)" placeholder. Runs after saveEvent so a
  // slow/failed LINE Content API call never blocks recording that the
  // message happened at all.
  if (!saved || saved.duplicate || !messageId) return

  const mediaPath = await fetchAndStoreLineMedia(ctx.supabase, messageId, "image/jpeg")
  if (!mediaPath) return
  await ctx.supabase.from("line_events").update({ media_path: mediaPath }).eq("id", saved.id)

  // Auto document classification (owner, 2026-07-17): "AI อ่านข้อมูล OCR →
  // จำแนกเอกสาร → สร้าง Document Card อัตโนมัติ ไม่ต้องให้ผู้ใช้สร้างเอง". AI
  // reads and classifies here, downstream of and never replacing the
  // original image already saved above.
  const { data: signed } = await ctx.supabase.storage.from("attachments").createSignedUrl(mediaPath, 60 * 10)
  if (!signed?.signedUrl) return

  // LINE Profile — Business Evidence context (owner, 2026-07-18): "AI ไม่ต้อง
  // เดาสุ่ม แต่ใช้บริบทของผู้ส่งมาช่วยจำแนก" — pass the sender's known role
  // (if any) into the classifier so it biases toward realistic document
  // types (driver -> fuel/toll/weight; customer -> payment evidence;
  // supplier -> tax invoice/DO) instead of guessing blind. Null role (no
  // line_profiles row yet) falls back to the unbiased prompt — never assumed.
  let senderRole: string | null = null
  if (ctx.userId) {
    const { data: profile } = await ctx.supabase
      .from("line_profiles").select("role").eq("line_user_id", ctx.userId).maybeSingle()
    senderRole = (profile as any)?.role ?? null
  }

  const classified = await classifyReceiptImage(signed.signedUrl, senderRole)

  // Payment Verification Engine — Phase 1 (owner, 2026-07-18): a slip alone
  // is Pending Review, never auto-Verified (no second evidence source exists
  // yet — see the migration's own header comment). Matching the company here
  // so a reviewer doesn't have to do it manually; same direct-link-first
  // lookup every other consumer uses (company_line_links, not a guess).
  //
  // Real incident found 2026-07-24 (บจก. เคที คอนสตรัคชั่น, ฿5,000 slip stuck
  // unmatched): this only checked "transfer_slip", but ocr-classify.ts's own
  // DOCUMENT_TYPE_PROFILE treats "payment_advice" as an equally real
  // incoming-payment type (same business_category/workflow) — a slip the
  // model classified as payment_advice instead of transfer_slip silently
  // skipped company-matching entirely, then downstream (receipt-documents
  // list + confirm routes, same narrow check) it never even appeared in the
  // Payment Verification Queue for a human to catch.
  let customerCompanyId: string | null = null
  if ((classified?.document_type === "transfer_slip" || classified?.document_type === "payment_advice") && ctx.userId) {
    const { data: link } = await ctx.supabase
      .from("company_line_links").select("company_id").eq("line_user_id", ctx.userId).maybeSingle()
    customerCompanyId = (link as any)?.company_id ?? null
  }

  const insertRow = classified
    ? {
        line_event_id: saved.id,
        media_path: mediaPath,
        document_type: classified.document_type,
        vendor_name: classified.vendor_name,
        amount: classified.amount,
        document_date: classified.document_date,
        raw_ocr_text: classified.raw_ocr_text,
        confidence: classified.confidence,
        status: "ai_read",
        sender_name: classified.sender_name,
        sender_bank: classified.sender_bank,
        reference_number: classified.reference_number,
        transaction_datetime: classified.transaction_datetime,
        customer_company_id: customerCompanyId,
        verification_level: 2, // Payment Verification Priority (owner, 2026-07-18) — Level 2: OCR-read slip
      }
    : {
        line_event_id: saved.id,
        media_path: mediaPath,
        document_type: "other",
        status: "ai_read",
        error_th: "AI จำแนกเอกสารไม่สำเร็จ — รูปต้นฉบับยังดูได้ปกติ",
        verification_level: 2, // a real photo exists, even though classification failed
      }
  const { data: insertedDoc } = await ctx.supabase
    .from("receipt_documents").insert(insertRow).select("id").single()

  // Autonomous Payment Confirmation (owner, 2026-07-24) — explicit owner
  // decision to remove the human-click step when the OCR evidence is
  // already complete (amount + sender_name + transaction_datetime + a real
  // matched company). Anything less complete stays Pending Review exactly
  // as before — this is a narrowing of when auto-confirm applies, not a
  // general bypass of Rule 72/115.
  const isPaymentDoc = classified?.document_type === "transfer_slip" || classified?.document_type === "payment_advice"
  const hasCompleteEvidence = Boolean(
    classified?.amount && classified?.sender_name && classified?.transaction_datetime && customerCompanyId,
  )
  if (isPaymentDoc && hasCompleteEvidence && insertedDoc && ctx.userId) {
    const { data: company } = await ctx.supabase
      .from("companies").select("name").eq("id", customerCompanyId).maybeSingle()
    await tryAutoConfirmPayment(ctx.supabase, {
      receiptDocumentId: insertedDoc.id,
      customerCompanyId: customerCompanyId!,
      companyName: company?.name ?? "-",
      amount: Number(classified!.amount),
      occurredAt: (classified!.transaction_datetime ?? classified!.document_date ?? new Date().toISOString()).slice(0, 10),
      referenceNumber: classified!.reference_number ?? null,
      lineUserId: ctx.userId,
    })
  }
}
