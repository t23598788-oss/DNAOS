import { chromium } from "playwright"
import { readFileSync } from "node:fs"
const BASE = "https://dna-os-deadboard-production.up.railway.app"
const loginUrl = readFileSync(new URL("./qa-login.url", import.meta.url), "utf8").trim()
const browser = await chromium.launch()
const page = await (await browser.newContext()).newPage()
await page.goto(loginUrl, { waitUntil: "networkidle", timeout: 90000 })
await page.waitForTimeout(800)
for (const [cmd, payload] of [["invoice.payments", {}], ["expense.list", {}], ["bank.statement", {}]]) {
  const r = await page.request.post(BASE + "/api/v1/mcp/business/dispatch", { data: { command: cmd, payload }, timeout: 60000 })
  const d = await r.json().catch(() => ({}))
  const rows = d.data && typeof d.data === "object" ? Object.values(d.data).find((v) => Array.isArray(v))?.length ?? 0 : 0
  console.log(cmd, "->", d.ok ? "LIVE_DATA rows:" + rows : "ERR " + String(d.violations?.[0] ?? d.error).slice(0, 60))
}
await browser.close()
