// Owner correction (2026-07-25, three steps in one conversation):
// 1) "เดี๋ยวเช็คให้นะครับ...เอาออก" — a canned line promising to "go check"
//    that nobody ever followed up on, and wrong for cases like a photocopy
//    request.
// 2) tried silence instead — "ไม่ใช่เว้ย...เงียบแบบนี้ไม่ได้ ความรู้สึกมัน
//    เหมือนป่าช้า" — total silence feels dead.
// 3) tried a second static line — "ให้ระบบมันคิดมากๆ หน่อย...อย่าพึ่งปล่อย
//    ข้อความข้อความต่อข้อความออกไป" — even a warmer static reply is still
//    just firing text at text; he wants the system to actually read the
//    message and the real recent conversation, then respond like it
//    thought about it, not react on reflex.
//
// This only runs when every specific engine in handlers/text.ts (tool
// router, event auto-build, debt follow-up, payment claim, payment info
// request, supplier quote) found nothing to do — the true "genuinely
// doesn't know what structured thing to build" case. It must never
// fabricate business facts (prices, availability, dates) — those come from
// real DB-backed engines only, per the same rule this whole file's sibling
// engines already follow. This is conversational judgment only.
import { callClaudeText } from "./claude-client.ts"
import { getCustomerMemory, updateCustomerMemory } from "./customer-memory.ts"

const SYSTEM_PROMPT = `คุณคือแอดมิน DNA OS ตอบแชทลูกค้าทาง LINE ของธุรกิจที่ให้บริการหลายอย่าง (วัสดุก่อสร้าง หิน ทราย, ถ่ายเอกสารราชการ, และอื่นๆ ที่จะเพิ่มขึ้นเรื่อยๆ)

ข้อความนี้คือกรณีที่ระบบอัตโนมัติเฉพาะทางอื่นๆ (จับคู่ราคาวัสดุ, ติดตามหนี้, ยืนยันการชำระเงิน ฯลฯ) ตรวจสอบแล้วว่าไม่ใช่คำขอที่ตรงเงื่อนไขไหนเลย เป็นแชททั่วไป/ทักทาย/ถามไถ่/พูดคุยเฉยๆ หรือคำขอที่ระบบยังไม่มีเครื่องมือเฉพาะ

อ่านข้อความล่าสุด พร้อมบริบทการสนทนาก่อนหน้า และบันทึกลักษณะนิสัยลูกค้ารายนี้ (ถ้ามี) แล้วตอบอย่างเป็นธรรมชาติ สั้น กระชับ เหมือนแอดมินจริงคนหนึ่งที่จำลูกค้าคนนี้ได้และคิดก่อนตอบ ไม่ใช่ท่องประโยคสำเร็จรูป

ห้ามเด็ดขาด:
- ห้ามบอกราคา/จำนวน/ข้อมูลธุรกิจใดๆ ที่ไม่ได้อยู่ในบริบทที่ให้มา (ถ้าลูกค้าถามราคา ให้ชวนคุยรายละเอียดต่อ เช่นวัสดุอะไร ปริมาณเท่าไหร่ แทนที่จะเดาราคา) — ข้อยกเว้นเดียวคือ "วันที่/เวลาปัจจุบัน" ที่ให้มาจริงด้านล่าง (real system clock ไม่ใช่เดา) ตอบได้ตามนั้นเลยถ้าลูกค้าถาม แต่ห้ามใช้ไปคำนวณ/สัญญาวันที่ส่งของ/นัดหมายทางธุรกิจใดๆ ที่ไม่มีข้อมูลจริงรองรับ
- ห้ามสัญญาว่าจะ "ไปเช็คแล้วแจ้งกลับ" ถ้าไม่มีระบบจริงรองรับการติดตามนั้น
- ห้ามยาวเกินไป ตอบสั้นแบบแชทจริง ไม่ใช่ย่อหน้า
- ห้ามตอบแบบ list/bullet/หัวข้อในวงเล็บ แบบฟอร์มอัตโนมัติ — คุยแบบคนจริงคุยกัน
- ห้ามถามคำถามซ้ำเดิมถ้าลูกค้าตอบไปแล้วในข้อความก่อนหน้า อ่านบทสนทนาทั้งหมดก่อนตอบทุกครั้ง
- **ห้ามเรียกชื่อลูกค้าด้วยชื่อใดๆ เด็ดขาด นอกจากชื่อนั้นปรากฏจริงในข้อความที่ลูกค้าคนนี้พิมพ์มาเองในบทสนทนานี้เท่านั้น** ถ้าไม่รู้ชื่อจริง ให้ไม่เรียกชื่อเลย ใช้ "ครับ" เฉยๆ พอ ห้ามเดาชื่อ ห้ามหยิบชื่อจากตัวอย่างด้านล่างมาใช้โดยเด็ดขาด (เคยเกิดบั๊กจริง 2026-07-25: ระบบเอาชื่อ "พี่ชิต" จากตัวอย่างโทนด้านล่างมาเรียกลูกค้าจริงผิดคน)

โทนที่ต้องการ (owner, 2026-07-25 — อธิบายเป็นหลักการเท่านั้น ห้ามก๊อปคำ/ชื่อ/ประโยคตัวอย่างไปใช้ตรงๆ เด็ดขาด): พูดแบบประโยคยาวต่อเนื่องเป็นธรรมชาติ ไม่ใช่หัวข้อสั้นๆ ตัดกัน มีความเป็นกันเอง ตรงประเด็น — อ้างอิงจากการที่เจ้าของธุรกิจคุยกับลูกค้าจริงในแชท LINE ("[LINE]ฉลุย.txt")

ตอบเป็นข้อความแชทธรรมดา ไม่ใช่ JSON`

interface RecentMessage {
  raw_text: string | null
  raw_type: string
  created_at: string
}

export async function buildThoughtfulReply(
  supabase: any,
  userId: string,
  currentText: string,
): Promise<string | null> {
  const { data: recent } = await supabase
    .from("line_events")
    .select("raw_text, raw_type, created_at")
    .eq("line_user_id", userId)
    .order("created_at", { ascending: false })
    .limit(6)

  const history = ((recent ?? []) as RecentMessage[])
    .reverse()
    .filter((m) => m.raw_type === "text" || m.raw_type === "location")
    .map((m) => `- ${m.raw_text ?? "(ส่งตำแหน่ง)"}`)
    .join("\n")

  const memory = await getCustomerMemory(supabase, userId)
  const memoryBlock = memory ? `บันทึกลักษณะลูกค้ารายนี้ (จากการคุยครั้งก่อนๆ):\n${memory}\n\n` : ""

  // Real bug, owner-reported 2026-07-30 (admin secretary chat side): an LLM
  // has no real clock and will hallucinate a wrong date if asked, unless
  // told the real one. This side used to just prohibit ANY date mention as
  // its fix — safe, but it means a customer asking "วันนี้วันที่เท่าไหร่"
  // just gets deflected instead of a real correct answer. Owner correction
  // same day: "ทำไมไม่พัฒนาสองอย่างไปพร้อมกัน" — inject the real date/time
  // here too (same as cognitive/pipeline.ts's answerWithAi), so this side
  // can actually answer correctly instead of only refusing.
  const now = new Date()
  const dateTimeBlock = `วันที่/เวลาปัจจุบันจริง (พ.ศ.): ${now.toLocaleDateString("th-TH", { weekday: "long", year: "numeric", month: "long", day: "numeric" })} เวลา ${now.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" })} น.\n\n`

  const userPrompt = history
    ? `${dateTimeBlock}${memoryBlock}บทสนทนาล่าสุด:\n${history}\n\nข้อความล่าสุดที่ต้องตอบ: "${currentText}"`
    : `${dateTimeBlock}${memoryBlock}ข้อความจากลูกค้า (ยังไม่เคยคุยกันมาก่อน): "${currentText}"`

  const reply = await callClaudeText(SYSTEM_PROMPT, userPrompt, 200)
  const trimmed = reply?.trim() || null

  if (trimmed) {
    // Best-effort, never blocks the reply already computed above.
    await updateCustomerMemory(supabase, userId, { customerText: currentText, botReply: trimmed })
  }

  return trimmed
}
