/**
 * Event Builder — the message-centric → event-centric bridge.
 *
 * Takes a cluster of raw LINE messages from one contact and synthesizes them
 * into ONE structured business event, instead of every downstream module
 * (pricing/GPS/quotation/debt) re-parsing the same raw text independently.
 * Owner's explicit direction 2026-07-10 — see registry/TASK_QUEUE.json.
 *
 * Translation only: does not touch DB, does not decide, does not write.
 * Matches the bridge-openai.ts convention (services/ai/bridge-openai.ts).
 */

import OpenAI from "openai"

export interface RawMessage {
  id: string
  raw_text: string | null
  raw_type: string
  created_at: string
}

export interface ExtractedEvent {
  event_type: string | null
  material_text: string | null
  quantity: number | null
  quantity_unit: string | null
  destination: string | null
  schedule_text: string | null
  contact_name: string | null
  contact_phone: string | null
  status: string
  confidence: number
  context: Record<string, unknown>
}

const SYSTEM_PROMPT = `คุณอ่าน "กลุ่มข้อความ LINE" จากลูกค้าคนเดียวกัน แล้วสรุปให้เป็นเหตุการณ์ธุรกิจ (Business Event) เดียว
งานของคุณคือ "รวมข้อความหลายอันให้เป็นเรื่องเดียวกัน" ไม่ใช่ตอบคำถามหรือให้ราคา

ตอบเป็น JSON เท่านั้น ตาม schema นี้ (ใส่ null ถ้าไม่พบข้อมูลนั้นในข้อความ ห้ามเดา):
{
  "event_type": "ขอราคา | สั่งซื้อ | แจ้งชำระเงิน | ส่งพิกัด | ส่งรูป | ส่งเอกสาร | เปลี่ยนปลายทาง | ยกเลิกงาน | สอบถามทั่วไป | อื่นๆ",
  "material_text": "ชื่อวัสดุที่ลูกค้าพูดถึง เช่น ดินถม, ทรายหยาบ, หินคลุก",
  "quantity": ตัวเลขจำนวน หรือ null,
  "quantity_unit": "หน่วย เช่น คิว, ตัน หรือ null",
  "destination": "สถานที่ส่ง ถ้ามีพูดถึง",
  "schedule_text": "เวลา/วันที่ต้องการ ถ้ามีพูดถึง เช่น พรุ่งนี้เช้า",
  "contact_name": "ชื่อผู้ติดต่อ ถ้ามีพูดถึง",
  "contact_phone": "เบอร์โทร ถ้ามีพูดถึง",
  "status": "quotation_pending ถ้าลูกค้าขอราคา/ขอซื้อ, new ถ้ายังไม่ชัดเจน",
  "confidence": ตัวเลข 0-1 ความมั่นใจว่าข้อความกลุ่มนี้รวมกันเป็นเหตุการณ์เดียวจริง
}`

export async function buildEventFromMessages(messages: RawMessage[]): Promise<{ ok: true; event: ExtractedEvent } | { ok: false; error: string }> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) return { ok: false, error: "ไม่มี OPENAI_API_KEY" }

  const transcript = messages
    .map((m) => `[${m.created_at}] ${m.raw_type === "text" ? m.raw_text : `(${m.raw_type})`}`)
    .join("\n")

  try {
    const client = new OpenAI({ apiKey })
    const response = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: transcript },
      ],
      max_tokens: 500,
      temperature: 0,
    })

    const text = response.choices[0]?.message?.content?.trim() ?? ""
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return { ok: false, error: "AI ไม่ตอบเป็น JSON: " + text.slice(0, 200) }

    const parsed = JSON.parse(jsonMatch[0])
    const event: ExtractedEvent = {
      event_type: parsed.event_type ?? null,
      material_text: parsed.material_text ?? null,
      quantity: typeof parsed.quantity === "number" ? parsed.quantity : null,
      quantity_unit: parsed.quantity_unit ?? null,
      destination: parsed.destination ?? null,
      schedule_text: parsed.schedule_text ?? null,
      contact_name: parsed.contact_name ?? null,
      contact_phone: parsed.contact_phone ?? null,
      status: parsed.status ?? "new",
      confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0,
      context: { message_count: messages.length, source_message_ids: messages.map((m) => m.id) },
    }
    return { ok: true, event }
  } catch (e: unknown) {
    return { ok: false, error: e instanceof Error ? e.message : "OpenAI error" }
  }
}

export function generateEventCode(seq: number, at: Date = new Date()): string {
  const yy = String(at.getFullYear()).slice(-2)
  const mm = String(at.getMonth() + 1).padStart(2, "0")
  const dd = String(at.getDate()).padStart(2, "0")
  return `EV${yy}${mm}${dd}-${String(seq).padStart(4, "0")}`
}
