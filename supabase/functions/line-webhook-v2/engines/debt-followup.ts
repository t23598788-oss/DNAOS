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

  // Not a plain ack while we're waiting on this — treat the message itself
  // as the customer's answer, recorded verbatim (no date parsing/guessing).
  await supabase
    .from("business_events")
    .update({ schedule_text: text, status: "confirmed", updated_at: new Date().toISOString() })
    .eq("id", pending.id)

  return `รับทราบครับ บันทึกไว้แล้วว่าจะชำระ "${text}" ขอบคุณครับ 🙏`
}
