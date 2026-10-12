// Local E2E — owner business routing fix: /api/chat company commands, zero AI
import { chromium } from "playwright"
import { readFileSync } from "node:fs"

const BASE = process.env.BASE_URL ?? "http://localhost:3000"
const loginUrl = readFileSync(new URL("./qa-login.url", import.meta.url), "utf8").trim()

const browser = await chromium.launch()
const ctx = await browser.newContext()
const page = await ctx.newPage()
await page.goto(loginUrl, { waitUntil: "networkidle", timeout: 90000 })
await page.waitForTimeout(1200)
console.log("landed:", page.url())

const qs = [
  "เปิดข้อมูลบริษัท ช.ธวัชชัยการช่าง",
  "ดูบริษัท ช.ธวัชชัยการช่าง",
  "แสดงข้อมูลบริษัท ช.ธวัชชัยการช่าง",
]
for (const message of qs) {
  const res = await page.request.post(`${BASE}/api/chat`, {
    data: { message, sessionKey: "owner-routing-e2e" },
    headers: { "content-type": "application/json" },
    timeout: 120000,
  })
  const body = await res.json().catch(() => ({}))
  const text = String(body.text ?? body.result?.text ?? "")
  const bad = /AI_GATEWAY|429|ไม่สำเร็จตอนนี้|Provider ยังไม่พร้อม/.test(text)
  console.log(`\n=== "${message}" (HTTP ${res.status()})`)
  console.log("  contains real company data:", text.includes("ธวัชชัย"))
  console.log("  AI error leaked:", bad)
  console.log("  text head:", text.slice(0, 180).replace(/\n/g, " | "))
}
await browser.close()
