import { chromium } from "playwright"
import { readFileSync } from "node:fs"
const BASE = process.argv[2]
const loginUrl = readFileSync(new URL("./qa-login.url", import.meta.url), "utf8").trim()
const browser = await chromium.launch()
const page = await (await browser.newContext()).newPage()
await page.goto(loginUrl, { waitUntil: "networkidle", timeout: 90000 })
await page.waitForTimeout(1000)
const sk = `prod-cline-${Date.now()}`
async function ask(m, t = 300000) {
  const r = await page.request.post(`${BASE}/api/chat`, { data: { message: m, sessionKey: sk }, timeout: t })
  return { status: r.status(), body: await r.json().catch(() => ({})) }
}
const a = await ask("เปิดข้อมูลบริษัท ช.ธวัชชัยการช่าง", 60000)
console.log("turnA:", a.body?.result?.type ?? a.body?.text?.slice(0, 40), "| pulse:", a.body?.pulse_node ?? "-")
const b = await ask("ดูเอกสารล่าสุดของบริษัทนี้")
const bs = JSON.stringify(b.body?.result ?? {})
console.log("turnB type:", b.body?.result?.type, "| real-doc-nums:", /(?:INV|REC|QT|BOQ|DO)-[A-Z0-9-]{4,}/.test(bs), "| text-head:", String(b.body?.text ?? "").slice(0, 90))
await browser.close()
process.exit(0)
