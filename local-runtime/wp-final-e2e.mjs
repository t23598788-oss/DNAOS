// Final E2E A–I on production /workspace (STEP 09) — เส้นทางเดียว /api/chat
// ทุกเคสเก็บ: INPUT · REQUEST_ID · CAPABILITY_ID · EXECUTION · RESPONSE · DISPLAY_EVIDENCE · FINAL_STATUS
// J (ตรวจ Request ID ย้อนกลับ) ทำแยกด้วยการ query audit_logs หลังรันครบ
import { chromium } from "playwright"
import { readFileSync, writeFileSync } from "node:fs"

const BASE = (process.env.E2E_BASE ?? "https://dna-os-deadboard-production.up.railway.app").replace(/\/+$/, "")
const loginUrl = readFileSync(new URL("./qa-login.url", import.meta.url), "utf8").trim()
const CASES = [
  { id: "A-สนทนาทั่วไป", msg: "สวัสดีครับ วันนี้มีอะไรให้ช่วยได้บ้าง" },
  { id: "B-ความรู้ทั่วไป", msg: "ปูนซีเมนต์กับปูนมอร์ตาร์ต่างกันอย่างไรครับ ตอบสั้น ๆ" },
  { id: "C-ข้อมูลธุรกิจ", msg: "ขอดูยอดหนี้ของบริษัท ช.ทวัฒชัยการช่าง" },
  { id: "D-ค้นหาCapability", msg: "ขอดูใบแจ้งหนี้ล่าสุดหน่อย" },
  { id: "E-Connect-อีเมล(BLOCKED)", msg: "ขออ่านอีเมลล่าสุดหน่อย" },
  { id: "F-PermissionDenied", msg: "ช่วยสั่งโอนเงินให้ลูกหนี้ 5,000 บาทหน่อย" },
  { id: "G-ตาราง(ยืนยันซ้ำ)", msg: "ดูรายการงานทั้งหมดหน่อย" },
  { id: "H-เอกสารพรีวิว", msg: "สร้างใบเสนอราคาให้ บจก. เคที คอนสตรัคชั่น ปูนซีเมนต์ 20 ถุง ราคาถุงละ 95 บาท พรีวิวให้ดูก่อน" },
  { id: "I-NOT_FOUND", msg: "ขอดูยอดหนี้ของบริษัท ช.ทวัฒชัยการช่าง เท่านี้" },
]

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } })
const page = await ctx.newPage()
await page.goto(loginUrl, { waitUntil: "networkidle", timeout: 90000 })
await page.waitForTimeout(2500)
await page.goto(`${BASE}/workspace`, { waitUntil: "domcontentloaded", timeout: 90000 })
await page.waitForSelector("#dna-frame", { timeout: 30000 })
await page.waitForTimeout(5000)
console.log("screen:", page.url())
const ta = page.locator("#dna-frame textarea")
const send = page.locator("#dna-frame .row .send")
const report = []

for (const c of CASES) {
  await ta.click()
  await ta.fill(c.msg)
  const [resp] = await Promise.all([
    page.waitForResponse((r) => r.url().includes("/api/chat") && r.request().method() === "POST", { timeout: 180000 }),
    send.click(),
  ])
  const data = await resp.json().catch(() => ({}))
  await page.waitForTimeout(3000)
  const screen = await page.locator("#dna-frame").innerText().catch(() => "")
  const rec = {
    input: c.msg,
    http: resp.status(),
    request_id: data.local_ai_request_id ?? null,
    ai_status: data.ai_status ?? null,
    command: data.local_ai_command ?? null,
    result_type: data.result?.type ?? null,
    text: typeof data.text === "string" ? data.text.slice(0, 200) : null,
    execution: data.layers?.dispatcher ?? data.layers?.tool ?? null,
    runtime: { ai: data.layers?.ai ?? null, database: data.layers?.database ?? null, result: data.layers?.result ?? null, workspace: data.layers?.workspace ?? null },
    display_evidence: screen.includes(c.msg.slice(0, 12)),
    screen_excerpt: screen.split("\n").filter(Boolean).slice(-4).join(" | ").slice(0, 500),
  }
  rec.final_status = rec.http === 200 && rec.display_evidence ? "DISPLAY_PASS" : "DISPLAY_FAIL"
  report.push({ case: c.id, ...rec })
  console.log(`\n=== ${c.id} | ${rec.final_status} | req=${rec.request_id} | ai=${rec.ai_status} | cmd=${rec.command} | result=${rec.result_type}`)
  console.log("EXE", JSON.stringify(rec.execution).slice(0, 300))
  console.log("SCREEN", rec.screen_excerpt.slice(0, 400))
  await page.screenshot({ path: `local-runtime/wpj-${c.id.slice(0, 3)}.png`, fullPage: false })
}

await browser.close()
writeFileSync("local-runtime/wpj-final-report.json", JSON.stringify(report, null, 1))
console.log("A–I DONE", report.length)
