// Local E2E: Local AI intent bridge → /api/chat (dev server :3000 + prod Supabase reads)
// node local-runtime/qa-local-ai-chat.mjs  (login URL ต้อง regenerate ก่อนรัน)
import { chromium } from "playwright"
import { readFileSync } from "node:fs"

const BASE = "http://localhost:3000"
const loginUrl = readFileSync(new URL("./qa-login.url", import.meta.url), "utf8").trim()

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
const page = await ctx.newPage()

// 1) login ผ่าน magic-link confirm ของระบบเดิม (ชี้ไป localhost)
await page.goto(loginUrl, { waitUntil: "networkidle", timeout: 90000 })
await page.waitForTimeout(1500)
console.log("landed:", page.url())

const questions = [
  { id: "Q1-งานค้าง", message: "ตอนนี้มีงานอะไรค้างทำค้างอยู่ในระบบไหม ขอดูแบบสรุปได้เลย" },
  { id: "Q2-เอกสาร", message: "ขอดูใบเสนอราคาที่มีอยู่ในระบบหน่อย" },
  { id: "Q3-สรุปการเงิน", message: "ช่วยสรุปภาพรวมการเงินของบริษัทให้ฟังหน่อย รายรับรายจ่ายตอนนี้เป็นยังไง" },
  { id: "Q4-การเงิน(นอก regex)", message: "เดือนนี้รับเงินเข้าจ่ายเงินออกเท่าไหร่แล้ว ยอดรวมเป็นยังไง" },
  { id: "Q5-เอกสาร(นอก regex)", message: "ขอรายการไฟล์ใบส่งสินค้าในระบบหน่อย" },
  { id: "Q6-นอกอาณาจักร(ต้องไม่แปล)", message: "ช่วยสั่งโอนเงินให้ลูกหนี้ 5,000 บาทหน่อย" },
  // LOCAL AI BUSINESS COMMAND PATH (owner, 2026-10-17) — acceptance คำสั่ง
  { id: "Q7-ยอดหนี้บริษัท(acceptance)", message: "ขอดูยอดหนี้ของบริษัท ช.ทวัฒชัยการช่าง" },
]

for (const q of questions) {
  const res = await page.request.post(`${BASE}/api/chat`, {
    data: { message: q.message, sessionKey: "local-ai-qa" },
    headers: { "content-type": "application/json" },
    timeout: 180000,
  })
  const body = await res.json().catch(() => ({}))
  console.log(`\n=== ${q.id} (HTTP ${res.status()})`)
  console.log("  local_ai_command:", body.local_ai_command ?? "(none)")
  console.log("  ai_status:", body.ai_status ?? "(n/a)")
  if (body.layers) console.log("  layers:", JSON.stringify(body.layers).slice(0, 500))
  console.log("  result.type:", body.result?.type ?? "(none)")
  if (body.result?.type === "finance_summary") {
    console.log("  title:", body.result.title)
    console.log("  summary keys:", Object.keys(body.result.summary ?? {}).join(","))
  }
  if (body.result?.type === "table") {
    console.log("  title:", body.result.title)
    console.log("  columns:", (body.result.table?.columns ?? []).map((c) => c.label).join(" | "))
    console.log("  rows:", body.result.table?.rows?.length ?? 0)
    console.log("  rows_data:", JSON.stringify(body.result.table?.rows ?? []))
  }
  if (body.result?.type === "document") console.log("  doc title:", String(body.result.title).slice(0, 90))
  if (body.result?.type === "file") console.log("  file:", body.result.name)
  if (body.result?.type === "timeline") console.log("  timeline:", body.result.title, "items:", body.result.items?.length ?? 0)
  if (body.result?.type === "text") console.log("  text:", String(body.result.text ?? body.text ?? "").slice(0, 120))
}

await browser.close()
