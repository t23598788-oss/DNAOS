// Debug raw ollama classification with the REAL system prompt from localAiBridge
// node local-runtime/qa-raw-classify.mjs "คำถาม"
import { readFileSync } from "node:fs"

const src = readFileSync(new URL("../app/api/chat/_lib/localAiBridge.ts", import.meta.url), "utf8")
// ดึง SYSTEM_PROMPT จริง (template literal ระหว่าง const SYSTEM_PROMPT = ` ... `)
const m = src.match(/const SYSTEM_PROMPT = `([\s\S]*?)`;/)
if (!m) throw new Error("SYSTEM_PROMPT not found")
const system = m[1]
  .replace(/\$\{Object\.entries[\s\S]*?\.join\("\\n"\)\}/, Object.entries({
    "finance.summary": "สรุปการเงิน/รายรับรายจ่าย/หนี้ค้างรวม (ไม่ระบุคู่ค้าเจาะจง)",
    "document.list": "ดู/เปิดเอกสาร — payload {type: invoice|receipt|quotation|purchase_order|delivery_order|payment_voucher|debt_notice}",
    "partner.timeline": "ประวัติ/ไทม์ไลน์ของคู่ค้า/ลูกค้าที่ระบุชื่อ — payload {name}",
    "job.active": "งานที่กำลังทำอยู่/งานค้างที่กำลังดำเนินการ",
    "job.list": "รายการงานทั้งหมด",
    "draft.list": "เอกสาร/งานที่รออยู่ในคิว",
    "debt.list": "หนี้ค้างทั้งหมด",
    "invoice.latest": "ใบแจ้งหนี้ล่าสุด",
  }).map(([a, d]) => `- ${a} → ${d}`).join("\n"))

const question = process.argv[2] ?? "ตอนนี้มีงานอะไรค้างทำค้างอยู่ในระบบไหม ขอดูแบบสรุปได้เลย"
const res = await fetch("http://127.0.0.1:11434/api/generate", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ model: process.env.MODEL ?? "qwen3:8b", system, prompt: question, stream: false }),
})
const body = await res.json()
console.log("RAW RESPONSE:\n" + body.response)
