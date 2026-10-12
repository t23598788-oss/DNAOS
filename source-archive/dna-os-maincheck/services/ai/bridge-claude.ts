/**
 * DNA OS V4 — AI Bridge (คำสั่งภาษาไทย → JSON command)
 *
 * ใช้ AI แปลภาษาคน → JSON command
 * ไม่แตะ DB ไม่ execute ไม่ตัดสินใจ
 * mode: "preview" เสมอ
 *
 * CANONICAL PATH (unify mission 2026-10-12): เดิมไฟล์นี้เรียก Anthropic SDK
 * ตรง ๆ (new Anthropic + MODEL hardcoded + อ่าน ANTHROPIC_API_KEY เอง) = duplicate
 * AI execution path นอก services/ai/gateway.ts refactor ให้เข้า
 * invokeAiGateway ด้วย capability "intent.classify" (งานจริง = แปล classification)
 * — provider/model/credential เป็นของ resolver เท่านั้น คงไว้ซึ่ง:
 * contract เดิม (BridgeResult) · SYSTEM_PROMPT เดิม · guard mode="preview"
 *
 * Owner instruction (2026-07-25): "เขียน AI ที่กูเอามาผูกไว้ในระบบ (ChatGPT)
 * ออกไปจากระบบให้ถาวรเลย" — replaces services/ai/bridge-openai.ts
 * (OpenAI/gpt-4o-mini). Same contract/signature, same guard (mode forced to
 * "preview" regardless of what the model returns).
 */

import { invokeAiGateway } from "./gateway";
import type { BridgeCommand, BridgeResult } from "./bridge-local";

const SYSTEM_PROMPT = `คุณเป็นตัวแปลคำสั่งภาษาไทยเป็น JSON command ของระบบ DNA OS
คุณไม่มีสิทธิ์ตัดสินใจ ไม่มีสิทธิ์แก้ข้อมูล แค่แปลภาษาเท่านั้น

ตอบเป็น JSON เท่านั้น ห้ามมีข้อความอื่น format:
{"action":"xxx","mode":"preview","payload":{...}}

mode ต้องเป็น "preview" เสมอ ห้ามใส่ "execute"

คำสั่งที่รองรับ:
- debt.find → หาลูกหนี้ payload: {name:"ชื่อ"}
- debt.list → ดูหนี้ค้าง payload: {status:"OPEN"}
- partner.find → หาคู่ค้า/แหล่งวัสดุ/โรงงาน/โรงโม่/บ่อทราย payload: {name:"ชื่อหรือประเภท"}
- partner.list → ดูคู่ค้าทั้งหมด payload: {}
- pit.find → หาบ่อวัสดุ/โรงโม่หิน/โรงงานคอนกรีต/ท่าทราย payload: {name:"ชื่อหรือประเภท"}
- invoice.find → หาใบแจ้งหนี้ payload: {keyword:"เลขหรือชื่อ"}
- invoice.list → ดูใบแจ้งหนี้ payload: {}
- invoice.latest → ใบแจ้งหนี้ล่าสุด payload: {}
- pay.preview → จ่ายเงิน payload: {invoice_id:"xxx"}
- pay.list → ดูรายการจ่าย payload: {date:"2026-01-01"}
- doc.list → ดูเอกสาร payload: {type:"invoice"|"boq"|"purchase-order"|"delivery-order"|"receipt"}
- doc.get → ดูเอกสารเฉพาะ payload: {id:"xxx"}
- draft.list → ร่างรออนุมัติ payload: {}
- job.list → ดูงาน payload: {status:"IN_PROGRESS"}
- job.assign → สั่งงานคนขับ payload: {job_id:"xxx",driver:"ชื่อ"}
- job.track → ติดตามงาน payload: {job_id:"xxx"}
- material.list → ดูวัสดุ payload: {}
- quote.calc → คำนวณราคา payload: {quantity:100,material:"ดินถม"}

สำคัญ: ถ้าถามเรื่อง บ่อ/โรงโม่/โรงงาน/ท่าทราย/แหล่งวัสดุ/คอนกรีต ให้ใช้ pit.find หรือ partner.find
ถ้าถามแค่คำเดียวหรือสองคำที่เป็นชื่อสิ่งของ/สถานที่ ให้ใช้ partner.find เสมอ`;

export async function translateWithAI(thai: string): Promise<BridgeResult> {
  try {
    // Capability only — resolver เลือก adapter เอง (fail-closed ถ้าไม่มีตัวที่
    // configured) · ผลลัพธ์เป็นข้อความปกติ -parse JSON เหมือนเดิมทุกประการ
    const result = await invokeAiGateway(
      {
        origin: "services/ai/bridge-claude.translateWithAI",
        ownerId: "system",
        sessionId: "bridge-claude",
        capability: "intent.classify",
        effect: "classification",
        systemPrompt: SYSTEM_PROMPT,
        prompt: thai,
        maxTokens: 200,
      },
      { emitEvidence: async () => { /* bridge นี้ไม่มี caller จริง — ข้าม evidence write เพื่อไม่ให้ bridge พังเมื่อไม่มี Supabase context */ } },
    );

    if (!result.ok || !result.output) {
      return { ok: false, raw: thai, error: result.error ?? "AI แปลคำสั่งไม่สำเร็จ" };
    }
    const text = result.output;

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return { ok: false, raw: thai, error: "AI ไม่ตอบเป็น JSON: " + text.substring(0, 100) };
    }

    const cmd: BridgeCommand = JSON.parse(jsonMatch[0]);

    // GUARD: บังคับ mode = preview เสมอ ไม่ว่า AI จะตอบอะไร
    cmd.mode = "preview";

    return { ok: true, raw: thai, command: cmd };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "AI bridge error";
    return { ok: false, raw: thai, error: msg };
  }
}
