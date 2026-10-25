// DNA-000224 E2E: 4 commands — expect cline INSUFFICIENT_CREDITS failover → bridge(anthropic) → structured
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
const loginUrl = readFileSync("/Users/tam/Desktop/ระบบธุรกิจ/dna-os-maincheck/local-runtime/qa-login.url", "utf8").trim()
const browser = await chromium.launch()
const page = await (await browser.newContext()).newPage()
await page.goto(loginUrl, { waitUntil: "networkidle", timeout: 90000 })
const sk = "dna224-" + Date.now()
const CMDS = [
  "แสดงเอกสารของบริษัท The One",
  "ค้นหาบริษัท วันสแตมป์คอนกรีต",
  "แสดงรายการเดินบัญชีธนาคาร",
  "แสดงยอดหนี้ค้างชำระทั้งหมด",
]
for (const m of CMDS) {
  const t0 = Date.now()
  const r = await page.request.post(BASE + "/api/chat", { data: { message: m, sessionKey: sk }, timeout: 300000 })
  const b = await r.json().catch(() => ({}))
  console.log("CMD:", m)
  console.log("  type:", b.result?.type, "| latency:", Date.now() - t0 + "ms | pulse:", b.pulse_node ?? "-")
  console.log("  head:", JSON.stringify(b.result ?? b.text ?? {}).slice(0, 180))
}
const tasks = await rest("/rest/v1/ai_tasks?select=id,status,error,result&order=created_at.desc&limit=5")
for (const t of tasks) {
  console.log("task:", t.id.slice(0, 8), "|", t.status, "| err:", String(t.error ?? "").slice(0, 60), "| ai_tokens:", t.result?.ai_tokens ?? "-")
}
await browser.close()
