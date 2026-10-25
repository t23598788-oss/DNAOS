// Production /workspace browser E2E — กรณี A–E + display ตรวจทุกกรณี (F)
// เส้นทางเดียวกันทุกกรณี: textarea → POST /api/chat → cognitive pipeline → AI Gateway
// ห้ามนับ PASS จาก HTTP 200 เดียว — จับ ai layer (status/request id/provider/capability)
// result type, และข้อความจริงที่ปรากฏบนหน้าจอเดียวกัน + screenshot ต่อกรณี
import { chromium } from "playwright"
import { readFileSync } from "node:fs"

const BASE = (process.env.E2E_BASE ?? "https://dna-os-deadboard-production.up.railway.app").replace(/\/+$/, "")
const loginUrl = readFileSync(new URL("./qa-login.url", import.meta.url), "utf8").trim()
const CASES = [
  { id: "A-สนทนาทั่วไป", msg: "สวัสดีครับ วันนี้มีอะไรให้ช่วยได้บ้าง" },
  { id: "B-ความรู้ทั่วไป", msg: "ปูนซีเมนต์กับปูนมอร์ตาร์ต่างกันอย่างไรครับ ตอบสั้น ๆ" },
  { id: "C-ข้อมูลธุรกิจ", msg: "ขอดูยอดหนี้ของบริษัท ช.ทวัฒชัยการช่าง" },
  { id: "D-registry-invoice", msg: "ขอดูใบแจ้งหนี้ล่าสุดหน่อย" },
  { id: "E-สั่งสร้างเอกสาร(พรีวิว-ไม่ยืนยัน)", msg: "สร้างใบเสนอราคาให้ บจก. เคที คอนสตรัคชั่น ปูนซีเมนต์ 20 ถุง ราคาถุงละ 95 บาท พรีวิวให้ดูก่อน" },
]

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } })
const page = await ctx.newPage()
page.on("console", (m) => { if (/error/i.test(m.type())) console.log("CONSOLE-ERR>", m.text().slice(0, 160)) })

await page.goto(loginUrl, { waitUntil: "networkidle", timeout: 90000 })
await page.waitForTimeout(2500)
console.log("landed:", page.url())
await page.goto(`${BASE}/workspace`, { waitUntil: "domcontentloaded", timeout: 90000 })
await page.waitForSelector("#dna-frame", { timeout: 30000 })
await page.waitForTimeout(5000)
console.log("screen:", page.url())
const ta = page.locator("#dna-frame textarea")
const send = page.locator("#dna-frame .row .send")

for (const c of CASES) {
  await ta.click()
  await ta.fill(c.msg)
  const [resp] = await Promise.all([
    page.waitForResponse((r) => r.url().includes("/api/chat") && r.request().method() === "POST", { timeout: 180000 }),
    send.click(),
  ])
  const data = await resp.json().catch(() => ({}))
  await page.waitForTimeout(3000)
  const screen = [await page.locator("#dna-frame").innerText().catch(() => "")]
  console.log(`\n=== ${c.id}`)
  console.log("HTTP", resp.status())
  console.log("EXCHANGE", JSON.stringify({
    ai_status: data.ai_status ?? null,
    request_id: data.local_ai_request_id ?? null,
    command: data.local_ai_command ?? null,
    result_type: data.result?.type ?? null,
    text: typeof data.text === "string" ? data.text.slice(0, 220) : null,
    layers_ai: data.layers?.ai ?? null,
    layers_tool: data.layers?.tool ?? null,
    layers_dispatcher: data.layers?.dispatcher ?? null,
    layers_database: data.layers?.database ?? null,
    layers_result: data.layers?.result ?? null,
    layers_workspace: data.layers?.workspace ?? null,
    confirm_token: data.confirm_token ? "present" : null,
  }))
  console.log("DISPLAY", JSON.stringify(screen.map((s) => s.replace(/\s+/g, " ").trim()).filter(Boolean)).slice(0, 2200))
  await page.screenshot({ path: `local-runtime/wp-case-${c.id.slice(0, 6)}.png`, fullPage: false })
}

await browser.close()
console.log("CASES DONE")
