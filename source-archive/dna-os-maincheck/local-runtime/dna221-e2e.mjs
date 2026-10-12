// DNA-000221 STEP5 — structured results E2E (two commands + screenshot + latency)
import { chromium } from "playwright"
import { readFileSync } from "node:fs"
const BASE = "https://dna-os-deadboard-production.up.railway.app"
const env = {}
readFileSync("/Users/tam/Desktop/ระบบธุรกิจ/dna-os-maincheck/.env.local", "utf8").split("\n").forEach((l) => {
  const i = l.indexOf("=")
  if (i > 0 && !l.startsWith("#")) env[l.slice(0, i)] = l.slice(i + 1)
})
const rest = (path) => fetch(env.NEXT_PUBLIC_SUPABASE_URL.replace(/\/$/, "") + path, {
  headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: "Bearer " + env.SUPABASE_SERVICE_ROLE_KEY },
}).then((r) => r.json())

const loginUrl = readFileSync(new URL("./qa-login.url", import.meta.url), "utf8").trim()
const browser = await chromium.launch()
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
await page.goto(loginUrl, { waitUntil: "networkidle", timeout: 90000 })
await page.waitForTimeout(1000)
await page.goto(`${BASE}/workspace`, { waitUntil: "networkidle", timeout: 60000 })
await page.waitForTimeout(1200)

const sk = `dna221-${Date.now()}`
const ask = async (message) => {
  const t0 = Date.now()
  const r = await page.request.post(`${BASE}/api/chat`, { data: { message, sessionKey: sk }, timeout: 300000 })
  const body = await r.json().catch(() => ({}))
  return { ms: Date.now() - t0, body }
}

console.log("== CMD1: ดึงเอกสารล่าสุดของบริษัท ช.ธวัชชัยการช่าง ==")
const t1 = await ask("ดึงเอกสารล่าสุดของบริษัท ช.ธวัชชัยการช่าง")
console.log("type:", t1.body.result?.type, "| latency:", t1.ms + "ms")
console.log("result:", JSON.stringify(t1.body.result ?? {}).slice(0, 320))

// render in real UI for screenshot
const ta = page.locator('#dna-frame textarea, textarea[placeholder*="พิมพ์คำสั่ง"]').first()
await ta.fill("ดึงเอกสารล่าสุดของบริษัท ช.ธวัชชัยการช่าง")
await ta.press("Enter")
await page.waitForTimeout(95000)
await page.screenshot({ path: "local-runtime/qa-owner-cline-prod/dna221-table.png", fullPage: false })
const bodyText = await page.textContent("body").catch(() => "")
console.log("UI shows table fields:", /เลขที่เอกสาร/.test(bodyText ?? ""), "| company:", /ช\.ธวัชชัย/.test(bodyText ?? ""))

console.log("== CMD2: แสดงเอกสารต้นฉบับของบริษัทนี้ ==")
const t2 = await ask("แสดงเอกสารต้นฉบับของบริษัทนี้")
console.log("type:", t2.body.result?.type, "| latency:", t2.ms + "ms")
console.log("result:", JSON.stringify(t2.body.result ?? {}).slice(0, 320))

const tasks = await rest("/rest/v1/ai_tasks?select=id,status,result,error&order=created_at.desc&limit=2")
for (const t of tasks) {
  console.log("task:", t.id, "|", t.status, "| workerMs:", t.result?.durationMs, "| clineResult:", t.result?.result?.type ?? "text", "| err:", String(t.error ?? "").slice(0, 40))
}
await browser.close()
