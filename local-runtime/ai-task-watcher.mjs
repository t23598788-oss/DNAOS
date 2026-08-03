// Local-AI pipeline (owner, 2026-07-25): "ย้ายทุกอย่างมาประมวลผลในเครื่อง
// Mac" — root cause found live: ANTHROPIC_API_KEY was never actually set on
// Supabase (`supabase secrets list` confirmed it), so every AI call in the
// LINE webhook has been silently failing since it was built. No cloud AI
// budget — this script does all the real thinking locally via Ollama
// (same models already proven in backfill-slips.mjs/watch-drive.mjs) and
// posts results to the ai-callback Edge Function, which does the actual
// business-logic writes and LINE push (kept in Deno, not duplicated here —
// see supabase/functions/ai-callback/index.ts and engines/process-
// classified-image.ts). Designed to run forever via a macOS LaunchAgent
// (com.dnaos.ai-task-watcher.plist), independent of any Claude/chat session.
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { readFile, writeFile } from "fs/promises";
import { join } from "path";
import { ensurePodRunning, stopPod } from "./runpod-controller.mjs";

const PROJECT_DIR = "/Users/tam/Desktop/DNA OS-โฟลเดอร์หลักต้นฉบับ /dna-os-deadboard";
const VISION_MODEL = "qwen2.5vl:7b";
const TEXT_MODEL = "thawatchai";

const env = Object.fromEntries(
  readFileSync(join(PROJECT_DIR, ".env.local"), "utf8")
    .split("\n").filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1)]; })
);
// Moved out of a hardcoded literal (2026-07-31) so this file could be
// committed to git safely — same value, now read from .env.local like
// every other secret this script needs.
const AI_CALLBACK_SECRET = env.AI_CALLBACK_SECRET;
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const CALLBACK_URL = `${env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/ai-callback`;

async function ollamaGenerate(model, systemPrompt, prompt, images) {
  const res = await fetch("http://localhost:11434/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      system: systemPrompt,
      prompt,
      images,
      stream: false,
      format: images ? "json" : undefined,
    }),
  });
  if (!res.ok) throw new Error(`ollama http ${res.status}`);
  const json = await res.json();
  return json.response;
}

async function postCallback(payload) {
  const res = await fetch(CALLBACK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-callback-secret": AI_CALLBACK_SECRET },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`ai-callback http ${res.status}: ${await res.text()}`);
}

// Mirrors supabase/functions/line-webhook-v2/engines/ocr-classify.ts's
// DOCUMENT_TYPES/DOCUMENT_TYPE_PROFILE/SYSTEM_PROMPT_BASE — kept in sync by
// hand since this runs in a different language/runtime.
const DOCUMENT_TYPES = [
  "receipt", "tax_invoice", "invoice", "fuel_bill", "toll_bill", "weight_slip",
  "delivery_order", "transfer_slip", "payment_advice", "bank_statement",
  "product_photo", "site_photo", "government_document", "other",
];

const ROLE_HINTS = {
  driver: "ผู้ส่งมีบทบาทเป็นคนขับรถ — มีโอกาสสูงที่จะเป็นใบเสร็จน้ำมัน (fuel_bill), ใบชั่ง (weight_slip), หรือค่าทางด่วน (toll_bill)",
  customer: "ผู้ส่งมีบทบาทเป็นลูกค้า — มีโอกาสสูงที่จะเป็นสลิปโอนเงิน (transfer_slip), Payment Advice (payment_advice), หรือหนังสือหัก ณ ที่จ่าย",
  supplier: "ผู้ส่งมีบทบาทเป็นซัพพลายเออร์ — มีโอกาสสูงที่จะเป็นใบกำกับภาษี (tax_invoice), ใบแจ้งหนี้ (invoice), หรือใบส่งของ (delivery_order)",
};

const OCR_SYSTEM_PROMPT = `คุณคือระบบอ่านและจำแนกเอกสาร (บิล/ใบเสร็จ/หลักฐานทางธุรกิจ) จากรูปภาพที่ส่งเข้ามาทาง LINE
อ่านรูปแล้วตอบเป็น JSON เท่านั้น ไม่มีข้อความอื่น รูปแบบ:
{
  "document_type": "หนึ่งใน ${DOCUMENT_TYPES.join("|")}",
  "vendor_name": "ชื่อบริษัท/ร้านค้าที่ออกเอกสาร ถ้าอ่านไม่ได้ให้เป็น null",
  "amount": ตัวเลขยอดเงินรวม ถ้าอ่านไม่ได้ให้เป็น null,
  "document_date": "YYYY-MM-DD ถ้าอ่านไม่ได้ให้เป็น null",
  "raw_ocr_text": "ข้อความทั้งหมดที่อ่านได้จากรูป",
  "description": "อธิบายสั้นๆ ว่ารูปนี้เป็นภาพอะไรจริงๆ (เฉพาะตอน document_type เป็น product_photo หรือ site_photo เช่น 'ภาพกองทรายหยาบ', 'ภาพหน้างานก่อสร้างมีรถแบคโฮ') ประเภทอื่นให้เป็น null เสมอ",
  "confidence": ตัวเลข 0-1,
  "sender_name": "ชื่อผู้โอน (เฉพาะ transfer_slip/payment_advice) ถ้าไม่ใช่ให้เป็น null",
  "sender_bank": "ชื่อธนาคารผู้โอน (เฉพาะ transfer_slip/payment_advice) ถ้าไม่ใช่ให้เป็น null",
  "reference_number": "เลขที่อ้างอิงรายการโอน (เฉพาะ transfer_slip/payment_advice) ถ้าไม่มีให้เป็น null",
  "transaction_datetime": "วันเวลาที่โอนจริง ISO 8601 (เฉพาะ transfer_slip/payment_advice) ถ้าไม่ใช่ให้เป็น null"
}
ถ้ารูปไม่ใช่เอกสาร/บิลเลย ให้ document_type เป็น "product_photo" หรือ "site_photo" ตามความเหมาะสม
ถ้า document_type เป็น "government_document" (บัตรประชาชน/ทะเบียนบ้าน/ใบขับขี่) ห้ามถอดเลขบัตร/ชื่อ-สกุล/วันเกิด/ที่อยู่ออกมาใน raw_ocr_text เด็ดขาด ให้เป็น null เสมอ ตอบแค่ document_type กับ confidence พอ ฟิลด์อื่น null หมด`;

async function classifyImage(task) {
  const { data, error } = await db.storage.from("attachments").download(task.media_path);
  if (error || !data) throw new Error(`ดาวน์โหลดรูปไม่ได้: ${error?.message ?? "no data"}`);
  const buf = Buffer.from(await data.arrayBuffer());
  const b64 = buf.toString("base64");

  let senderRole = null;
  if (task.line_user_id) {
    const { data: profile } = await db.from("line_profiles").select("role").eq("line_user_id", task.line_user_id).maybeSingle();
    senderRole = profile?.role ?? null;
  }
  const roleHint = senderRole && ROLE_HINTS[senderRole] ? `\n\nบริบทผู้ส่ง: ${ROLE_HINTS[senderRole]}` : "";

  const raw = await ollamaGenerate(VISION_MODEL, OCR_SYSTEM_PROMPT + roleHint, "จำแนกเอกสารในรูปนี้", [b64]);
  const match = raw.match(/\{[\s\S]*\}/);
  let classified = null;
  if (match) {
    try {
      const parsed = JSON.parse(match[0]);
      if (!DOCUMENT_TYPES.includes(parsed.document_type)) parsed.document_type = "other";
      // Hard code-level guard (real incident, 2026-07-26): the prompt above
      // explicitly forbids transcribing ID-card PII into raw_ocr_text, but
      // the local vision model (qwen2.5vl:7b) ignored that instruction on a
      // real customer's real ID card and transcribed the full ID number,
      // name, and date of birth anyway. A prompt instruction alone is not
      // enough — force it null in code, never trust the model to comply.
      if (parsed.document_type === "government_document") {
        parsed.raw_ocr_text = null;
        parsed.vendor_name = null;
        parsed.sender_name = null;
      }
      classified = parsed;
    } catch { /* leave classified null — honest failure, not fabricated */ }
  }

  await postCallback({ taskId: task.id, kind: "classify_image", classified });
}

// Mirrors thoughtful-fallback.ts + customer-memory.ts's prompts.
const REPLY_SYSTEM_PROMPT = `คุณคือแอดมิน DNA OS ตอบแชทลูกค้าทาง LINE ของธุรกิจที่ให้บริการหลายอย่าง (วัสดุก่อสร้าง หิน ทราย, ถ่ายเอกสารราชการ, และอื่นๆ ที่จะเพิ่มขึ้นเรื่อยๆ)

อ่านข้อความล่าสุด พร้อมบริบทการสนทนาก่อนหน้า และบันทึกลักษณะนิสัยลูกค้ารายนี้ (ถ้ามี) แล้วตอบอย่างเป็นธรรมชาติ สั้น กระชับ เหมือนแอดมินจริงคนหนึ่งที่จำลูกค้าคนนี้ได้และคิดก่อนตอบ ไม่ใช่ท่องประโยคสำเร็จรูป

ห้ามเด็ดขาด:
- ห้ามบอกราคา/จำนวน/ข้อมูลธุรกิจใดๆ ที่ไม่ได้อยู่ในบริบทที่ให้มา — ข้อยกเว้นเดียวคือ "วันที่/เวลาปัจจุบัน" ที่ให้มาจริงด้านล่าง (real system clock ไม่ใช่เดา) ตอบได้ตามนั้นเลยถ้าลูกค้าถาม แต่ห้ามใช้ไปคำนวณ/สัญญาวันที่ส่งของ/นัดหมายทางธุรกิจใดๆ ที่ไม่มีข้อมูลจริงรองรับ
- ห้ามสัญญาว่าจะ "ไปเช็คแล้วแจ้งกลับ"
- ห้ามยาวเกินไป ตอบสั้นแบบแชทจริง
- ห้ามตอบแบบ list/bullet/หัวข้อในวงเล็บ
- ห้ามถามคำถามซ้ำเดิมถ้าลูกค้าตอบไปแล้วในข้อความก่อนหน้า อ่านบทสนทนาทั้งหมดก่อนตอบทุกครั้ง
- **ห้ามเรียกชื่อลูกค้าด้วยชื่อใดๆ เด็ดขาด นอกจาก ชื่อนั้นปรากฏจริงในข้อความที่ลูกค้าคนนี้พิมพ์มาเองในบทสนทนานี้เท่านั้น** ถ้าไม่รู้ชื่อจริง ให้ไม่เรียกชื่อเลย ใช้ "ครับ" เฉยๆ พอ — ห้ามเดาชื่อ ห้ามหยิบชื่อจากที่อื่นมาใช้โดยเด็ดขาด (เคยเกิดบั๊กจริง 2026-07-25: ระบบเอาชื่อ "พี่ชิต" จากตัวอย่างโทนการพูดด้านล่างมาเรียกลูกค้าจริงผิดคน)

โทนที่ต้องการ (อธิบายเป็นหลักการ ไม่ใช่ประโยคให้ก๊อป): พูดแบบประโยคยาวต่อเนื่องเป็นธรรมชาติ ไม่ใช่หัวข้อสั้นๆ ตัดกัน มีความเป็นกันเอง ตรงประเด็น — ห้ามก๊อปคำ/ชื่อ/ประโยคจากคำอธิบายนี้ไปใช้ตรงๆ เด็ดขาด นี่คือคำอธิบายโทน ไม่ใช่ข้อความตัวอย่างให้ลอก

ตอบเป็นข้อความแชทธรรมดา ไม่มีคำนำ ไม่มี JSON`;

const MEMORY_SYSTEM_PROMPT = `คุณกำลังอัปเดตบันทึกพฤติกรรมของลูกค้ารายหนึ่ง (ไม่ใช่ข้อมูลธุรกิจ/ราคา/หนี้ — เฉพาะลักษณะการสื่อสารและความต้องการที่สังเกตได้)
กติกา: สั้น กระชับ bullet ไม่เกิน 5-6 ข้อ ห้ามบันทึกราคา/ยอดเงิน/ข้อมูลธุรกิจ ถ้ามีบันทึกเดิมให้ปรับปรุงต่อยอด ตอบเป็นข้อความบันทึกล้วนๆ ไม่มี JSON`;

// Mirrors supabase/functions/line-webhook-v2/engines/auto-build-event.ts's
// SYSTEM_PROMPT — structured extraction (real material/quantity/
// destination/schedule) takes priority over a generic chatty reply,
// because a generic reply asking "which material, how much?" when the
// customer already said so in plain language (owner-reported live bug,
// 2026-07-25) is worse than not answering at all.
const EXTRACT_SYSTEM_PROMPT = `คุณอ่าน "กลุ่มข้อความ LINE" จากลูกค้าคนเดียวกัน แล้วสรุปให้เป็นเหตุการณ์ธุรกิจ (Business Event) เดียว
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
}`;

async function tryExtractEvent(userId, currentEventId, currentText) {
  const { data: linkedRows } = await db
    .from("business_events").select("source_message_ids").eq("source_line_user_id", userId);
  const linkedIds = new Set((linkedRows ?? []).flatMap((r) => r.source_message_ids ?? []));

  const { data: allMessages } = await db
    .from("line_events").select("id, raw_text, raw_type, created_at")
    .eq("line_user_id", userId).order("created_at", { ascending: true });

  const unlinked = (allMessages ?? []).filter((m) => !linkedIds.has(m.id) && (m.raw_type === "text" || m.raw_type === "location"));
  if (unlinked.length === 0) return null;

  const transcript = unlinked.map((m) => `[${m.created_at}] ${m.raw_type === "text" ? m.raw_text : "(ส่งตำแหน่ง)"}`).join("\n");
  const raw = await ollamaGenerate(TEXT_MODEL, EXTRACT_SYSTEM_PROMPT, transcript);
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return null;

  let extracted;
  try {
    extracted = JSON.parse(match[0]);
  } catch {
    return null;
  }
  if (!extracted.event_type) return null;
  if (extracted.event_type === "อื่นๆ" && !extracted.material_text) return null;

  // Owner instruction (2026-07-25): "ลบคำว่าคิวออกให้หมด เปลี่ยนให้เป็นตัน
  // ให้หมด" — normalize the unit customers get shown to "ตัน" regardless of
  // what word they used ("คิว" is still recognized as input, per the
  // extraction prompt above, just never echoed back).
  if (extracted.quantity_unit) extracted.quantity_unit = "ตัน";

  return { extracted, sourceMessageIds: unlinked.map((m) => m.id) };
}

// Only used when the extracted event ISN'T a price request (buildEventFromExtraction
// returns null for those, since ai-callback runs the real deterministic
// quote engine for quotation_pending events and replies with an actual
// price — never a "เดี๋ยวจัดราคาให้" promise, which is exactly the fabricated-
// promise pattern the owner already rejected once today).
function confirmationText(extracted) {
  const parts = [extracted.material_text, extracted.quantity ? `${extracted.quantity} ${extracted.quantity_unit ?? ""}`.trim() : null].filter(Boolean);
  const what = parts.join(" ") || extracted.event_type;
  const dest = extracted.destination ? ` ส่ง${extracted.destination}` : "";
  const when = extracted.schedule_text ? ` ${extracted.schedule_text}` : "";
  return `รับทราบครับ ${what}${dest}${when}`;
}

// Deterministic gate (owner, 2026-07-25): "ต้องกรองให้แม่นก่อนถึง LLM...
// ช่วงเวลาทิ้งช่วง" — response timing is a real, measurable fact from real
// timestamps, computed here BEFORE the LLM ever sees this customer, never
// left for the model to guess/infer from reading a wall of text.
function computeRealSignals(events) {
  const timestamps = events.map((e) => new Date(e.created_at).getTime()).sort((a, b) => a - b);
  if (timestamps.length === 0) return { messageCount: 0, avgResponseGapMinutes: null, lastMessageAt: null };
  let totalGapMs = 0;
  for (let i = 1; i < timestamps.length; i++) totalGapMs += timestamps[i] - timestamps[i - 1];
  const avgResponseGapMinutes = timestamps.length > 1
    ? Math.round((totalGapMs / (timestamps.length - 1)) / 60000)
    : null;
  return {
    messageCount: timestamps.length,
    avgResponseGapMinutes,
    lastMessageAt: new Date(timestamps[timestamps.length - 1]).toISOString(),
  };
}

async function handleText(task) {
  // Structured extraction first (owner-reported live bug, 2026-07-25): a
  // customer who already stated material/quantity/destination/schedule in
  // plain language must not get a generic "which material, how much?"
  // reply — try to build a real business event (and, downstream in
  // ai-callback, a real price via the existing deterministic quote engine)
  // before falling back to plain conversation.
  const extraction = await tryExtractEvent(task.line_user_id, task.line_event_id, task.input_text);
  if (extraction) {
    const replyText = confirmationText(extraction.extracted);
    await postCallback({
      taskId: task.id, kind: "handle_text", replyText,
      extractedEvent: extraction.extracted,
      sourceMessageIds: extraction.sourceMessageIds,
    });
    return;
  }

  const { data: allEvents } = await db
    .from("line_events").select("raw_text, raw_type, created_at")
    .eq("line_user_id", task.line_user_id).order("created_at", { ascending: false }).limit(50);

  const signals = computeRealSignals(allEvents ?? []);
  const signalsBlock = signals.messageCount > 0
    ? `ข้อมูลจริงที่วัดได้ (ไม่ใช่การเดา): คุยกันมาแล้ว ${signals.messageCount} ครั้ง` +
      (signals.avgResponseGapMinutes !== null ? ` เว้นช่วงเฉลี่ย ${signals.avgResponseGapMinutes} นาที/ครั้ง` : "") + "\n\n"
    : "";

  const history = (allEvents ?? []).slice(0, 6).reverse()
    .filter((m) => m.raw_type === "text" || m.raw_type === "location")
    .map((m) => `- ${m.raw_text ?? "(ส่งตำแหน่ง)"}`).join("\n");

  const { data: memRow } = await db.from("line_customer_memory").select("notes").eq("line_user_id", task.line_user_id).maybeSingle();
  const memory = memRow?.notes || null;
  const memoryBlock = memory ? `บันทึกลักษณะลูกค้ารายนี้ (จากการคุยครั้งก่อนๆ):\n${memory}\n\n` : "";

  // Owner correction 2026-07-30: "ทำไมไม่พัฒนาสองอย่างไปพร้อมกัน" — the admin
  // secretary chat (cognitive/pipeline.ts) now gets the real date/time
  // injected so it can answer correctly instead of just refusing; this side
  // (customer-facing LINE replies via this same local model) gets the same
  // real fix, not just the blanket "never mention dates" prohibition above.
  const now = new Date();
  const dateTimeBlock = `วันที่/เวลาปัจจุบันจริง (พ.ศ.): ${now.toLocaleDateString("th-TH", { weekday: "long", year: "numeric", month: "long", day: "numeric" })} เวลา ${now.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" })} น.\n\n`;

  const userPrompt = history
    ? `${dateTimeBlock}${signalsBlock}${memoryBlock}บทสนทนาล่าสุด:\n${history}\n\nข้อความล่าสุดที่ต้องตอบ: "${task.input_text}"`
    : `${dateTimeBlock}${signalsBlock}${memoryBlock}ข้อความจากลูกค้า (ยังไม่เคยคุยกันมาก่อน): "${task.input_text}"`;

  const replyText = (await ollamaGenerate(TEXT_MODEL, REPLY_SYSTEM_PROMPT, userPrompt)).trim();

  const memPrompt = memory
    ? `บันทึกเดิม:\n${memory}\n\nบทสนทนาล่าสุด:\nลูกค้า: ${task.input_text}\nแอดมิน: ${replyText}\n\nอัปเดตบันทึกให้ครับ`
    : `บทสนทนาแรกกับลูกค้ารายนี้:\nลูกค้า: ${task.input_text}\nแอดมิน: ${replyText}\n\nสร้างบันทึกเริ่มต้นให้ครับ`;
  const updatedMemoryNotes = (await ollamaGenerate(TEXT_MODEL, MEMORY_SYSTEM_PROMPT, memPrompt)).trim();

  await postCallback({
    taskId: task.id, kind: "handle_text", replyText, updatedMemoryNotes,
    messageCount: signals.messageCount,
    avgResponseGapMinutes: signals.avgResponseGapMinutes,
    lastMessageAt: signals.lastMessageAt,
  });
}

// Owner instruction (2026-07-26): "ต้นทางต้องเข้าใจ...ไม่ไหวแน่นอนถ้าไม่มี
// วิธีแก้ตรงนี้" — real fallback for when deterministic substring matching
// (event-followup.ts) can't resolve a material name. Closed-set
// classification against the REAL material_types list, never open
// generation — the model can only pick a name that's actually in the list
// (verified below), so it can't invent a material that doesn't exist,
// however it phrases the choice.
const MATERIAL_MATCH_SYSTEM_PROMPT = `ลูกค้าพิมพ์ชื่อวัสดุมาแบบหนึ่ง แต่ระบบมีรายชื่อวัสดุจริงในฐานข้อมูลอีกแบบ (บางชื่อมีหลายคำเรียกในช่องเดียว เช่น "ทรายหยาบ หรือ ทรายถม")
งานของคุณ: หาว่าลูกค้าหมายถึงชื่อไหนในรายการ ตอบเป็น JSON เท่านั้น:
{"matched_name": "ชื่อในรายการที่ตรงที่สุด แบบคัดลอกมาเป๊ะๆ ห้ามแก้คำ" หรือ null ถ้าไม่มีชื่อไหนใกล้เคียงเลย}`;

async function resolveMaterialSemantic(task) {
  const { data: materialTypes } = await db.from("material_types").select("name");
  const names = (materialTypes ?? []).map((m) => m.name);
  const prompt = `รายชื่อวัสดุจริงในระบบ:\n${names.map((n) => `- ${n}`).join("\n")}\n\nลูกค้าพิมพ์ว่า: "${task.input_text}"`;

  const raw = await ollamaGenerate(TEXT_MODEL, MATERIAL_MATCH_SYSTEM_PROMPT, prompt);
  const match = raw.match(/\{[\s\S]*\}/);
  let resolvedMaterialName = null;
  if (match) {
    try {
      const parsed = JSON.parse(match[0]);
      // Hard guard: only trust it if the name is verbatim one of the real
      // options — never let a hallucinated/rephrased name through.
      if (parsed.matched_name && names.includes(parsed.matched_name)) {
        resolvedMaterialName = parsed.matched_name;
      }
    } catch { /* leave null — honest failure, not fabricated */ }
  }

  await postCallback({ taskId: task.id, kind: "resolve_material", resolvedMaterialName });
}

// Self-healing backfill (owner, 2026-07-31): "มันต้องรู้ตัวมันเองมึงก็เท
// ระบบกูไปแทน...ไม่ใช่อันนั้นคือระบบนึงอันนี้อีกระบบนึง" — a document can go
// unread for two real reasons: an ai_tasks row was created but failed
// (e.g. the ai-callback verify_jwt gap found live today), or no ai_tasks
// row was ever created at all (a code gap, like handlers/file.ts never
// enqueuing anything before today's fix). This runs automatically every
// poll cycle of THIS already-always-running watcher — not a separate
// script someone has to remember to invoke — and folds straight into the
// exact same pending-task loop below, so a rediscovered document is
// processed the same way as anything else.
//
// Idempotent by construction: cross-checks receipt_documents by
// line_event_id, because a document can be fully processed via the
// synchronous Claude path in handlers/image.ts / handlers/file.ts WITHOUT
// ever creating an ai_tasks row — treating "no ai_tasks row" alone as
// "never processed" would re-queue already-completed work.
async function backfillMissingDocuments() {
  const { data: events, error: eventsErr } = await db
    .from("line_events")
    .select("id, line_user_id, media_path")
    .in("raw_type", ["image", "file"])
    .not("media_path", "is", null);
  if (eventsErr || !events) return;

  const { data: tasks, error: tasksErr } = await db
    .from("ai_tasks").select("line_event_id, status").eq("kind", "classify_image");
  if (tasksErr || !tasks) return;
  const taskByEvent = new Map(tasks.map((t) => [t.line_event_id, t.status]));

  const candidateIds = events
    .filter((ev) => {
      const status = taskByEvent.get(ev.id);
      return status === undefined || status === "failed";
    })
    .map((ev) => ev.id);
  if (candidateIds.length === 0) return;

  const { data: receipts } = await db
    .from("receipt_documents").select("line_event_id").in("line_event_id", candidateIds);
  const alreadyHandled = new Set((receipts ?? []).map((r) => r.line_event_id));

  const trulyMissing = events.filter((ev) => {
    const status = taskByEvent.get(ev.id);
    const wasAttempted = status !== undefined && status !== "failed";
    return !wasAttempted && !alreadyHandled.has(ev.id);
  });
  if (trulyMissing.length === 0) return;

  console.log(`[ai-task-watcher] ${new Date().toISOString()} เจอเอกสารที่ยังไม่เคยถูกอ่าน ${trulyMissing.length} ใบ — เข้าคิวให้อัตโนมัติ`);

  const withExistingFailedTask = trulyMissing.filter((e) => taskByEvent.get(e.id) === "failed");
  const withNoTaskYet = trulyMissing.filter((e) => taskByEvent.get(e.id) === undefined);

  if (withExistingFailedTask.length) {
    await db.from("ai_tasks")
      .update({ status: "pending", error: null })
      .in("line_event_id", withExistingFailedTask.map((e) => e.id));
  }
  if (withNoTaskYet.length) {
    await db.from("ai_tasks").insert(
      withNoTaskYet.map((e) => ({
        kind: "classify_image",
        line_user_id: e.line_user_id,
        line_event_id: e.id,
        media_path: e.media_path,
        status: "pending",
      }))
    );
  }
}

// Smart Dynamic Trigger — plumbing half (runpod-controller.mjs), calling
// half (here) (owner, 2026-08-04: "สร้างเครื่องมือให้เปิดเครื่องเมื่อเรียก...
// อย่าเปิดเครื่องไว้ 24 ชั่วโมง"). This LaunchAgent runs main() once per
// 20s tick (launchd owns the interval, not a setInterval in-process), so
// "idle for N minutes" can't be tracked in memory — a small local
// timestamp file is the real state across separate process runs.
//
// Honest scope note: this only calls ensurePodRunning()/stopPod() — it
// does NOT yet route ollamaGenerate() calls to the remote pod (still
// hits http://localhost:11434 below). The pod itself has no Ollama
// installed yet either. Wiring those two together is the next real step;
// doing it now would silently point real customer document classification
// at a GPU box that can't answer.
const LAST_ACTIVE_PATH = join(PROJECT_DIR, "local-runtime", ".runpod-last-active");
const IDLE_STOP_MINUTES = 15;

async function touchLastActive() {
  await writeFile(LAST_ACTIVE_PATH, new Date().toISOString()).catch(() => {});
}

async function maybeStopIfIdle() {
  let lastActiveIso;
  try {
    lastActiveIso = (await readFile(LAST_ACTIVE_PATH, "utf8")).trim();
  } catch {
    return; // never recorded activity — pod was never started by this trigger, nothing to stop
  }
  const idleMinutes = (Date.now() - new Date(lastActiveIso).getTime()) / 60000;
  if (idleMinutes < IDLE_STOP_MINUTES) return;
  try {
    const result = await stopPod();
    if (result.action === "stopped") {
      console.log(`[ai-task-watcher] Pod ว่างเกิน ${IDLE_STOP_MINUTES} นาที — สั่งปิดแล้ว`);
    }
  } catch (e) {
    console.error(`[ai-task-watcher] stopPod ล้มเหลว: ${e.message}`);
  }
}

async function main() {
  await backfillMissingDocuments();

  const { data: tasks, error } = await db
    .from("ai_tasks").select("*").eq("status", "pending").order("created_at", { ascending: true });
  if (error) {
    console.error(`[ai-task-watcher] ${new Date().toISOString()} query error: ${error.message}`);
    return;
  }
  if (!tasks || tasks.length === 0) {
    await maybeStopIfIdle();
    return;
  }

  console.log(`[ai-task-watcher] ${new Date().toISOString()} พบงาน ${tasks.length} รายการ`);
  await touchLastActive();
  try {
    const ensured = await ensurePodRunning();
    if (!ensured.ok) console.error(`[ai-task-watcher] ensurePodRunning ล้มเหลว: ${JSON.stringify(ensured.errors)}`);
  } catch (e) {
    console.error(`[ai-task-watcher] ensurePodRunning error: ${e.message}`);
  }

  for (const task of tasks) {
    try {
      if (task.kind === "classify_image") await classifyImage(task);
      else if (task.kind === "handle_text") await handleText(task);
      else if (task.kind === "resolve_material") await resolveMaterialSemantic(task);
      console.log(`[ai-task-watcher]   ✓ ${task.kind} ${task.id}`);
    } catch (e) {
      console.error(`[ai-task-watcher]   ✗ ${task.kind} ${task.id}: ${e.message}`);
      await db.from("ai_tasks").update({ status: "failed", error: e.message }).eq("id", task.id);
    }
  }
}

main().catch((e) => console.error("[ai-task-watcher] FATAL:", e));
