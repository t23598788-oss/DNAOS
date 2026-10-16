/**
 * Local AI intent bridge (LOCAL AI RUNTIME mission, 2026-10-11).
 *
 * หน้าที่เดียว: แปลประโยคภาษาคน → Structured Command จากรายการคำสั่ง READ-ONLY
 * ที่ระบบมีอยู่แล้ว (registry/command-registry.json ผ่าน engines/validation/
 * dispatcher + finance_summary path ของ buildChatResult) — ทำโดย Local AI
 * (Ollama adapter ของ AI Gateway เดิม, capability = intent.classify,
 * model = adapter configuration ไม่ใช่ตัวระบุ capability)
 *
 * ห้าม/ไม่แตะ: business logic, DB, writer, engine ใด ๆ — คืน command object
 * เฉย ๆ ให้ caller ส่งเข้า path canonical เดิม (buildChatResult → dispatcher)
 * Fail-closed ทุกขั้น: gateway ไม่ configured / ไม่ตอบ JSON ที่ valid /
 * action นอก allow-list → null (ผู้เรียกใช้ path เดิมต่อ เหมือนไม่มี bridge)
 * Contract: ไม่มี "execute" — ทุก command คือ READ เท่านั้น (preview เสมอ)
 */
import { invokeAiGateway, type AiGatewayDependencies, type AiProvenance } from "@/services/ai/gateway";

export interface LocalAiCommand {
  action: string;
  payload: Record<string, unknown>;
}

/** READ-only allow-list — ทุกตัวมี handler canonical อยู่แล้ว ไม่มีคำสั่งเขียน */
export const LOCAL_AI_COMMAND_VOCABULARY: Record<string, string> = {
  "finance.summary": "สรุปการเงิน/รายรับรายจ่าย/หนี้ค้างรวม (ไม่ระบุคู่ค้าเจาะจง)",
  "debt.current": "ยอดหนี้/ยอดค้างชำระของบริษัท ลูกค้า หรือคู่ค้าที่ระบุชื่อเจาะจง — payload {company: ชื่อบริษัทตามที่ผู้ใช้พิมพ์}",
  "document.list": "ดู/เปิดเอกสาร — payload {type: invoice|receipt|quotation|purchase_order|delivery_order|payment_voucher|debt_notice}",
  "partner.timeline": "ประวัติ/ไทม์ไลน์ของคู่ค้า/ลูกค้าที่ระบุชื่อ — payload {name}",
  "job.active": "งานที่กำลังทำอยู่/งานค้างที่กำลังดำเนินการ",
  "job.list": "รายการงานทั้งหมด",
  "draft.list": "เอกสาร/งานที่รออยู่ในคิว",
  "debt.list": "หนี้ค้างทั้งหมด",
  "invoice.latest": "ใบแจ้งหนี้ล่าสุด",
};

const SYSTEM_PROMPT = `คุณเป็นตัวแปลคำสั่งภาษาไทยเป็น JSON command ของระบบ DNA OS (อ่านข้อมูลล้วน)
คุณไม่มีสิทธิ์ตัดสินใจ ไม่มีสิทธิ์แก้ข้อมูล ไม่มีสิทธิ์ execute อะไรทั้งสิ้น — แค่แปลภาษาเป็น command เท่านั้น
ตอบเป็น JSON เดียว ห้ามมีข้อความอื่น ห้ามมี markdown: {"action":"<ชื่อคำสั่ง>","payload":{...}}
ถ้าประโยคไม่ได้ขอข้อมูลจากรายการคำสั่ง ให้ตอบ: {"action":"none","payload":{}}
คำสั่งที่รองรับ (อ่านข้อมูลล้วน):
${Object.entries(LOCAL_AI_COMMAND_VOCABULARY)
  .map(([action, desc]) => `- ${action} → ${desc}`)
  .join("\n")}
ตัวอย่าง:
- "มีงานอะไรค้างอยู่บ้าง" → {"action":"job.active","payload":{}}
- "งานที่กำลังทำตอนนี้มีอะไร" → {"action":"job.active","payload":{}}
- "ดูรายการงานทั้งหมด" → {"action":"job.list","payload":{}}
- "ยอดหนี้ค้างทั้งหมดเท่าไหร่" → {"action":"debt.list","payload":{}}
- "ค้างชำระอยู่กี่ราย" → {"action":"debt.list","payload":{}}
- "ขอดูยอดหนี้ของบริษัท ช.ทวัฒชัยการช่าง" → {"action":"debt.current","payload":{"company":"ช.ทวัฒชัยการช่าง"}}
- "หนี้ของ บจก. เคที คอนสตรัคชั่นค้างเท่าไหร่" → {"action":"debt.current","payload":{"company":"บจก. เคที คอนสตรัคชั่น"}}
- "เปิดเอกสารใบส่งของให้หน่อย" → {"action":"document.list","payload":{"type":"delivery_order"}}
- "ขอดูใบแจ้งหนี้ล่าสุด" → {"action":"invoice.latest","payload":{}}
- "ไทม์ไลน์ของ บจก. เคที คอนสตรัคชั่น" → {"action":"partner.timeline","payload":{"name":"บจก. เคที คอนสตรัคชั่น"}}
- "ภาพรวมบัญชีของบริษัทเป็นยังไง" → {"action":"finance.summary","payload":{}}
- "คิวเอกสารที่รออยู่มีอะไร" → {"action":"draft.list","payload":{}}`;

const ACTIONS = new Set(Object.keys(LOCAL_AI_COMMAND_VOCABULARY));

function parseCommand(raw: string): LocalAiCommand | null {
  // model อาจห่อ ```json …``` แม้ system prompt ห้าม — ตัดให้เหลือ JSON ก้อนเดียว
  const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const { action, payload } = parsed as { action?: unknown; payload?: unknown };
  if (typeof action !== "string" || !ACTIONS.has(action)) return null; // "none" + อะไรก็ตามนอก allow-list = null
  const body = payload && typeof payload === "object" && !Array.isArray(payload) ? (payload as Record<string, unknown>) : {};
  return { action, payload: body };
}

/** หลักฐาน AI layer (LOCAL AI BUSINESS COMMAND PATH, 2026-10-17): status +
 * provenance จริงของ gateway invocation — ok = แปลได้, *_UNRESOLVED =
 * แปลไม่ออก (ตอบ none/JSON ผิด/action นอก allow-list), *_UNAVAILABLE =
 * gateway/provider ล้ม (ไม่ configured/HTTP error) — caller แสดง AI_UNRESOLVED
 * ตามเกณฑ์ acceptance และ fail-closed เหมือนเดิมทุกประการ */
export interface LocalAiBridgeOutcome {
  command: LocalAiCommand | null;
  status: "AI_OK" | "AI_UNRESOLVED" | "AI_UNAVAILABLE";
  error: string | null;
  provenance: AiProvenance | null;
}

export async function translateLocalAiCommand(
  message: string,
  ctx: { ownerId: string; sessionId: string },
  deps: AiGatewayDependencies = {},
): Promise<LocalAiBridgeOutcome> {
  const text = message.trim();
  if (!text) return { command: null, status: "AI_UNRESOLVED", error: "empty message", provenance: null };
  try {
    // TRANSPORT CORRELATION (RAILWAY↔MAC LOCAL AI, 2026-10-17): ให้ request id
    // ของรอบนี้ทั้งสายเดียวกัน — gateway ใช้ id นี้พอดี (provenance.requestId)
    // และ ollama adapter หยิบจาก context.transportRequestId ไปแปะใน body เพื่อ
    // จับคู่ log บนเครื่อง Mac ที่รัน Ollama จริง (ห้ามเกิน, ห้ามเชื่อมสอง id แยก)
    const transportRequestId = `olar-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const linkedDeps: AiGatewayDependencies = {
      ...deps,
      requestId: deps.requestId ?? (() => transportRequestId),
      context: {
        runtime: "next" as const,
        ...(deps.context ?? {}),
        transportRequestId,
      },
    };
    const result = await invokeAiGateway(
      {
        origin: "chat.local_ai_intent_bridge",
        ownerId: ctx.ownerId,
        sessionId: ctx.sessionId,
        capability: "intent.classify",
        effect: "classification",
        systemPrompt: SYSTEM_PROMPT,
        prompt: text.slice(0, 2000),
      },
      linkedDeps,
    );
    if (!result.ok || typeof result.output !== "string") {
      // provider ล้ม = AI_UNAVAILABLE; provider ตอบแต่แปลไม่ได้ = AI_UNRESOLVED
      const unavailable = typeof result.error === "string" && /NOT_CONFIGURED|HTTP_|REGISTRY|RESOLVER|CAPABILITY|EMPTY/.test(result.error);
      return {
        command: null,
        status: unavailable ? "AI_UNAVAILABLE" : "AI_UNRESOLVED",
        error: result.error ?? null,
        provenance: result.provenance ?? null,
      };
    }
    const command = parseCommand(result.output);
    return {
      command,
      status: command ? "AI_OK" : "AI_UNRESOLVED",
      error: command ? null : `unparseable: ${result.output.slice(0, 200)}`,
      provenance: result.provenance ?? null,
    };
  } catch (error) {
    return {
      command: null,
      status: "AI_UNAVAILABLE",
      error: error instanceof Error ? error.message : String(error),
      provenance: null,
    }; // fail-closed: gateway/AI ล้ม = ไม่มี command (caller ใช้ path เดิมต่อ)
  }
}
