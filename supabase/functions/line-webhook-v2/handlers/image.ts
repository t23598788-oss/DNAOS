import type { HandlerContext, LineMessageEvent } from "../events/types.ts"
import { saveEvent } from "../events/store.ts"
import { fetchAndStoreLineMedia } from "../engines/media.ts"
import { classifyReceiptImage } from "../engines/ocr-classify.ts"

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
  let customerCompanyId: string | null = null
  if (classified?.document_type === "transfer_slip" && ctx.userId) {
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
  await ctx.supabase.from("receipt_documents").insert(insertRow)
}
