// Real evidence 2026-07-10: a live customer (ช.ธวัชชัยการช่าง) sent 5 real
// messages asking for a price ("ทรายถม" → "ขอราคาต่อคิว" → "คำนวณราคาทรายถม
// ให้หน่อย" → "สั่งวัสดุต้องสั่งยังไง") and got zero real response, because
// Event Builder only ran when an admin manually clicked a button in the
// dashboard. This makes it automatic — the moment a message arrives that
// isn't answering an open question and isn't a debt inquiry, try to build a
// real event from it right here, live, no admin needed.
//
// Duplicated (not imported) from engines/events/event-builder.ts and
// engines/jobs/auto-create.ts on purpose — Deno vs Next.js/Node runtimes.

import { tryCompleteAwaitingEvent } from "./event-followup.ts"

interface RawMessage {
  id: string
  raw_text: string | null
  raw_type: string
  created_at: string
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

async function extractEvent(messages: RawMessage[]) {
  const apiKey = Deno.env.get("OPENAI_API_KEY")
  if (!apiKey) return null

  const transcript = messages
    .map((m) => `[${m.created_at}] ${m.raw_type === "text" ? m.raw_text : `(${m.raw_type})`}`)
    .join("\n")

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: transcript },
      ],
      max_tokens: 500,
      temperature: 0,
    }),
  })
  if (!res.ok) {
    console.error("[auto-build-event] OpenAI failed:", res.status, await res.text())
    return null
  }
  const json = await res.json()
  const text = json.choices?.[0]?.message?.content?.trim() ?? ""
  const match = text.match(/\{[\s\S]*\}/)
  if (!match) return null
  try {
    return JSON.parse(match[0])
  } catch {
    return null
  }
}

// Returns the reply text to send back, or null if nothing was built (e.g.
// no unlinked messages, or the cluster wasn't a real business event).
export async function tryAutoBuildEvent(supabase: any, userId: string): Promise<string | null> {
  const { data: linkedRows } = await supabase
    .from("business_events").select("source_message_ids").eq("source_line_user_id", userId)
  const linkedIds = new Set((linkedRows ?? []).flatMap((r: any) => r.source_message_ids ?? []))

  const { data: allMessages } = await supabase
    .from("line_events").select("id, raw_text, raw_type, created_at")
    .eq("line_user_id", userId).order("created_at", { ascending: true })

  // A location share alone (no accompanying text) must still be able to
  // trigger building/completing an event — real gap diagnosed 2026-07-10:
  // filtering to text-only meant a GPS pin sitting alone never got picked up.
  const unlinked = (allMessages ?? []).filter((m: any) => !linkedIds.has(m.id) && (m.raw_type === "text" || m.raw_type === "location"))
  if (unlinked.length === 0) return null

  const extracted = await extractEvent(unlinked)
  if (!extracted || !extracted.event_type) return null

  // Not a real business request (greeting, small talk) — don't manufacture
  // an event out of nothing.
  if (extracted.event_type === "อื่นๆ" && !extracted.material_text) return null

  const { data: link } = await supabase
    .from("company_line_links").select("company_id").eq("line_user_id", userId).maybeSingle()
  const partnerId = link?.company_id ?? null

  const { count } = await supabase
    .from("business_events").select("id", { count: "exact", head: true })
    .gte("created_at", new Date().toISOString().slice(0, 10))
  const yy = new Date().getFullYear().toString().slice(-2)
  const mm = String(new Date().getMonth() + 1).padStart(2, "0")
  const dd = String(new Date().getDate()).padStart(2, "0")
  const eventCode = `EV${yy}${mm}${dd}-${String((count ?? 0) + 1).padStart(4, "0")}`

  const title = [extracted.material_text, extracted.quantity ? `${extracted.quantity} ${extracted.quantity_unit ?? ""}`.trim() : null]
    .filter(Boolean).join(" ") || extracted.event_type || "เหตุการณ์จาก LINE"

  const { error: insertError } = await supabase.from("business_events").insert({
    event_code: eventCode,
    event_type: extracted.event_type,
    event_date: new Date().toISOString().slice(0, 10),
    title,
    source_line_user_id: userId,
    source_message_ids: unlinked.map((m: any) => m.id),
    partner_id: partnerId,
    material_text: extracted.material_text,
    quantity: extracted.quantity,
    quantity_unit: extracted.quantity_unit,
    destination: extracted.destination,
    schedule_text: extracted.schedule_text,
    contact_name: extracted.contact_name,
    contact_phone: extracted.contact_phone,
    status: extracted.status ?? "new",
    confidence: extracted.confidence ?? 0,
    updated_at: new Date().toISOString(),
  })
  if (insertError) {
    console.error("[auto-build-event] insert failed:", insertError.message)
    return null
  }

  if (extracted.status !== "quotation_pending") return null

  // Mark it awaiting_info so tryCompleteAwaitingEvent (which looks up by
  // that status) can find this freshly-built event — an empty reply text
  // means "just check what's already here," reusing one completeness-check
  // code path instead of writing a third copy of the same logic.
  await supabase.from("business_events").update({ status: "awaiting_info" }).eq("event_code", eventCode)
  return await tryCompleteAwaitingEvent(supabase, userId, "")
}
