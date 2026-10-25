// Deterministic Response Engine (owner mission 2026-10-10: "ข้อความทั่วไป:
// ใช้ Deterministic Response Engine ... AI ต้องเป็น Optional Capability ไม่ใช่
// เงื่อน_conditionบังคับของการตอบข้อความ").
//
// The general-message layer of handlers/text.ts: answers SYNCHRONOUSLY inside
// the webhook request, in Supabase's cloud, with ZERO AI dependency — no
// ai_tasks queue, no Mac/Ollama, no cloud LLM key (TEST G: AI unavailable ->
// the reply still works). Deliberately placed AFTER every existing business
// engine in text.ts: debt/order/purchase/payment/quote/follow-up questions are
// answered from real DB rows by those engines first — this file only catches
// what they could not (greetings, thanks, "what can you do", and an honest
// last-resort acknowledgement).
//
// Honesty rules carried over from the owner's own corrections:
//   - never fabricate a promise a human won't keep ("เดี๋ยวเช็คให้นะครับ" was
//     explicitly rejected, 2026-07-25) — the fallback states only what is TRUE
//     right now: the message row was saved.
//   - capability claims list ONLY engines that really exist in this handler
//     chain (each bullet maps to a real function in handlers/text.ts).
//   - the AI follow-up queue (ai_tasks) is untouched — it stays as OPTIONAL
//     enrichment after this reply, never a condition of getting one.

const GREETING_RE = /^(สวัสดี|ดีครับ|ดีค่ะ|หวัดดี|hello\b|hi\b|hey\b)/i
const THANKS_RE = /(ขอบคุณ|ขอบใจ|thank you|thanks)/i
const CAPABILITY_RE = /(ทำอะไรได้บ้าง|ทำได้บ้าง|คือใคร|เป็นใคร|ระบบอะไร|ใช้ยังไง|ใช้งานยังไง|บริการอะไร|เรื่องอะไรบ้าง|ช่วยอะไร|ช่วยได้ยังไง)/i

const GREETING_REPLY =
  "สวัสดีครับ! 🎉\n\nมีอะไรต้องการก็พิมพ์บอก หรือส่งรูปมาได้เลยครับ ระบบจะช่วยจัดการให้ทันที"

const THANKS_REPLY = "ยินดีครับครับ 🙏 หากมีอะไรเพิ่มเติมบอกได้เลยครับ"

const CAPABILITY_REPLY =
  "รับข้อความ รูปเอกสาร/ใบเสร็จ (ระบบอ่านให้) · เช็คยอดหนี้ · สถานะงาน · ประวัติการซื้อ · ข้อมูลบัญชีโอนเงิน · ใบเสนอราคา — พิมพ์ถามได้เลยครับ หรือส่งรูปมาให้ระบบอ่านได้ครับ"

// Last resort for anything unmatched: a truthful receipt acknowledgement
// (the inbound row really was saved by saveEvent before this engine runs)
// plus the real capability hint above — no fabricated follow-up promise.
function fallbackReply(text: string): string {
  const trimmed = text.trim()
  const head = trimmed.length > 0 && trimmed.length <= 120
    ? `รับข้อความ "${trimmed}" แล้วครับ ระบบบันทึกข้อความของคุณเรียบร้อย`
    : "รับข้อความแล้วครับ ระบบบันทึกข้อความของคุณเรียบร้อย"
  return `${head}\n\nหากเป็นเรื่องยอดหนี้ สถานะงาน หรือเอกสาร บอกเพิ่มได้เลยครับ หรือส่งรูปมาให้ระบบอ่านได้ครับ`
}

/**
 * General-message answer, always synchronous and deterministic.
 * Returns null only for empty input (nothing to answer).
 */
export function answerDeterministic(text: string): string | null {
  const t = text.trim()
  if (!t) return null
  if (GREETING_RE.test(t)) return GREETING_REPLY
  if (THANKS_RE.test(t)) return THANKS_REPLY
  if (CAPABILITY_RE.test(t)) return CAPABILITY_REPLY
  return fallbackReply(t)
}
