// Payment Verification Engine — Waiting Bank Confirmation (owner, 2026-07-18)
//
// A customer typing "โอนแล้วครับ" with no slip photo previously produced no
// record at all — the claim just vanished into the generic fallback reply.
// Owner's design: "ลูกค้าบางคนแจ้งก่อน เงินจริงเข้าทีหลัง" — the claim itself
// is real evidence worth keeping, distinct from an actual slip (handled by
// engines/ocr-classify.ts + handlers/image.ts). This creates a
// receipt_documents row with NO amount/media (none exists yet) and status
// "waiting_bank_confirmation" — never auto-confirmed, always needs either a
// slip or a human to move it forward, per Rule 72/73/83.

const PAYMENT_CLAIM_PATTERN = /(โอน(เงิน)?(ให้)?แล้ว|โอนไปแล้ว|จ่าย(เงิน)?แล้ว|ชำระ(เงิน)?แล้ว)/

export function isPaymentClaim(text: string): boolean {
  return PAYMENT_CLAIM_PATTERN.test(text)
}

export async function tryRecordPaymentClaim(
  supabase: any,
  userId: string,
  text: string,
  lineEventId: string | null,
): Promise<string | null> {
  if (!isPaymentClaim(text)) return null
  if (!lineEventId) return null

  // Same direct-link-first company match every other consumer uses — no
  // company match, no way to attach this claim to a real debt, so it isn't
  // recorded (a claim we can't attribute to anyone isn't useful evidence).
  const { data: link } = await supabase
    .from("company_line_links").select("company_id").eq("line_user_id", userId).maybeSingle()
  const companyId = (link as any)?.company_id ?? null
  if (!companyId) return null

  await supabase.from("receipt_documents").insert({
    line_event_id: lineEventId,
    media_path: null,
    document_type: "transfer_slip",
    status: "waiting_bank_confirmation",
    customer_company_id: companyId,
    raw_ocr_text: text,
    verification_level: 1, // Payment Verification Priority (owner, 2026-07-18) — Level 1: LINE claim only
  })

  return "รับทราบครับ 🙏 ระบบกำลังรอตรวจสอบยอดเงินเข้า หากมีสลิปโอนเงินรบกวนส่งรูปมาด้วยได้เลยครับ จะได้ตรวจสอบและปิดยอดให้เร็วขึ้นครับ"
}
