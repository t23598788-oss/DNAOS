// Per-customer behavioral memory — see migration 20260725000005_line_
// customer_memory.sql for the "why". This is the read/update pair:
// getCustomerMemory() feeds existing notes into a reply prompt as context;
// updateCustomerMemory() distills the latest exchange into the notes,
// same "compress, don't accumulate transcripts" shape as this AI's own
// memory files. Runs best-effort — a failure here must never block a
// reply from going out.
import { callClaudeText } from "./claude-client.ts"

const UPDATE_SYSTEM_PROMPT = `คุณกำลังอัปเดตบันทึกพฤติกรรมของลูกค้ารายหนึ่ง (ไม่ใช่ข้อมูลธุรกิจ/ราคา/หนี้ — เฉพาะลักษณะการสื่อสารและความต้องการที่สังเกตได้)

กติกา:
- สั้น กระชับ เป็น bullet ไม่เกิน 5-6 ข้อ
- เก็บเฉพาะสิ่งที่จะช่วยให้ตอบแชทครั้งต่อไปได้ดีขึ้น เช่น ชอบพูดสั้นๆ/ชอบรายละเอียด, มักถามเรื่องอะไรซ้ำๆ, ช่วงเวลาที่มักทัก, โทนที่เหมาะ (เป็นกันเอง/ทางการ)
- ห้ามบันทึกราคา ยอดเงิน หรือข้อมูลธุรกิจใดๆ — ข้อมูลเหล่านั้นอยู่ในฐานข้อมูลจริงอยู่แล้ว ที่นี่เก็บแค่ "ลักษณะนิสัยการคุย"
- ถ้าบันทึกเดิมมีอยู่แล้ว ให้ปรับปรุง/รวมของใหม่เข้าไป ไม่ใช่ทิ้งของเก่าทั้งหมด เว้นแต่ขัดแย้งกัน
- ตอบเป็นข้อความบันทึกล้วนๆ ไม่มีคำนำ ไม่มี JSON`

export async function getCustomerMemory(supabase: any, userId: string): Promise<string | null> {
  if (!userId) return null
  const { data } = await supabase
    .from("line_customer_memory").select("notes").eq("line_user_id", userId).maybeSingle()
  return data?.notes || null
}

export async function updateCustomerMemory(
  supabase: any,
  userId: string,
  exchange: { customerText: string; botReply: string },
): Promise<void> {
  if (!userId) return
  try {
    const existing = await getCustomerMemory(supabase, userId)
    const prompt = existing
      ? `บันทึกเดิม:\n${existing}\n\nบทสนทนาล่าสุด:\nลูกค้า: ${exchange.customerText}\nแอดมิน: ${exchange.botReply}\n\nอัปเดตบันทึกให้ครับ`
      : `บทสนทนาแรกกับลูกค้ารายนี้:\nลูกค้า: ${exchange.customerText}\nแอดมิน: ${exchange.botReply}\n\nสร้างบันทึกเริ่มต้นให้ครับ`

    // A7 — capability, not provider: drafting durable customer memory notes.
    const updated = await callClaudeText(UPDATE_SYSTEM_PROMPT, prompt, 300, "memory.draft")
    if (!updated?.trim()) return

    await supabase.from("line_customer_memory").upsert({
      line_user_id: userId,
      notes: updated.trim(),
      updated_at: new Date().toISOString(),
    })
  } catch (err) {
    console.error("[customer-memory] update failed (non-fatal):", err)
  }
}
