/**
 * DNA OS V4 — AI Bridge (OpenAI)
 *
 * ใช้ GPT แปลภาษาคน → JSON command
 * ไม่แตะ DB ไม่ execute ไม่ตัดสินใจ
 * mode: "preview" เสมอ
 */

import OpenAI from "openai";
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
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return { ok: false, raw: thai, error: "ไม่มี OPENAI_API_KEY" };
  }

  try {
    const client = new OpenAI({ apiKey });
    const response = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: thai },
      ],
      max_tokens: 200,
      temperature: 0,
    });

    const text = response.choices[0]?.message?.content?.trim() ?? "";

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return { ok: false, raw: thai, error: "AI ไม่ตอบเป็น JSON: " + text.substring(0, 100) };
    }

    const cmd: BridgeCommand = JSON.parse(jsonMatch[0]);

    // GUARD: บังคับ mode = preview เสมอ ไม่ว่า AI จะตอบอะไร
    cmd.mode = "preview";

    return { ok: true, raw: thai, command: cmd };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "OpenAI error";
    return { ok: false, raw: thai, error: msg };
  }
}
