// Owner-reported bug 2026-07-11: after sending a debt-reminder Flex card
// (app/api/admin/line-customers/[lineUserId]/send-debt/route.ts), a
// customer reply like "รับทราบครับ" fell all the way to the generic
// fallback "รับทราบครับ เดี๋ยวเช็คให้นะครับ" — nonsensical here, there's
// nothing to check, the customer just acknowledged the amount. This
// separates two real cases: a plain acknowledgment (ask for a payment
// date) vs. an actual answer to that question (record it, deterministically
// — never try to parse/validate the date text, "ห้ามเดา").

const ACK_PATTERN = /^(รับทราบ(ครับ|ค่ะ)?|โอเค(ครับ|ค่ะ)?|ok(ay)?|ครับ|ค่ะ|เข้าใจแล้ว(ครับ|ค่ะ)?|ได้(ครับ|ค่ะ)?|ขอบคุณ(ครับ|ค่ะ)?|thanks?|thank\s?you)[\s!.🙏👍]*$/i

function isAcknowledgment(text: string): boolean {
  return ACK_PATTERN.test(text.trim())
}

// State-Specific Guard Rail (owner, 2026-07-24): real incident — while an
// event sat "awaiting_payment_date", the customer sent confused/unrelated
// text ("งง", "ไลน์ อะไรงั้นนี้", "พี่ตามอยู่ นี่ ยากใจครับ") and the code
// below recorded it VERBATIM as the payment date, then closed the event as
// "confirmed" — a customer's confusion silently became a committed payment
// promise. A real date answer will contain either a digit (25/7, วันที่ 5)
// or a real day/relative-time word; anything with neither is ambiguous —
// don't guess, ask again instead of silently committing state.
const DATE_SIGNAL_PATTERN = /\d|จันทร์|อังคาร|พุธ|พฤหัส(บดี)?|ศุกร์|เสาร์|อาทิตย์|พรุ่งนี้|มะรืน(นี้)?|วันนี้|คืนนี้|เช้านี้|สัปดาห์(นี้|หน้า)|อาทิตย์หน้า|เดือนหน้า|สิ้นเดือน|ต้นเดือน|งวดหน้า/

function looksLikePaymentDateAnswer(text: string): boolean {
  return DATE_SIGNAL_PATTERN.test(text)
}

export async function tryFollowUpDebtAck(supabase: any, userId: string, text: string): Promise<string | null> {
  const { data: pending } = await supabase
    .from("business_events")
    .select("id, schedule_text")
    .eq("source_line_user_id", userId)
    .eq("event_type", "แจ้งชำระเงิน")
    .eq("status", "awaiting_payment_date")
    .is("schedule_text", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!pending) return null

  if (isAcknowledgment(text)) {
    return "ขอบคุณครับ 🙏 รบกวนแจ้งวันที่สะดวกชำระด้วยได้ไหมครับ"
  }

  if (!looksLikePaymentDateAnswer(text)) {
    // Ambiguous — no digit, no day/relative-time word. Don't touch the
    // event's state at all; ask again instead of guessing what this was.
    return "ขออภัยครับ รบกวนแจ้งวันที่สะดวกชำระเงินได้เลยครับ หรือพิมพ์ 'ติดต่อเจ้าหน้าที่' หากต้องการคุยกับคนจริงครับ"
  }

  // Not a plain ack, and contains a real date signal — treat the message
  // itself as the customer's answer, recorded verbatim (no date parsing),
  // trimmed only to drop incidental leading/trailing whitespace.
  await supabase
    .from("business_events")
    .update({ schedule_text: text.trim(), status: "confirmed", updated_at: new Date().toISOString() })
    .eq("id", pending.id)

  return `รับทราบครับ บันทึกไว้แล้วว่าจะชำระ "${text}" ขอบคุณครับ 🙏`
}
