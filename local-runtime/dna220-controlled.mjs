// DNA-000220 STEP3+4 — one controlled production task + workspace verification
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
const page = await (await browser.newContext()).newPage()
await page.goto(loginUrl, { waitUntil: "networkidle", timeout: 90000 })
await page.waitForTimeout(1000)

const sk = `dna220-${Date.now()}`
const t0 = Date.now()
const r = await page.request.post(`${BASE}/api/chat`, {
  data: { message: "ดึงเอกสารล่าสุดของบริษัท ช.ธวัชชัยการช่าง", sessionKey: sk },
  timeout: 300000,
})
const body = await r.json().catch(() => ({}))
const chatMs = Date.now() - t0
console.log("chat result type:", body.result?.type, "| chat latency:", chatMs + "ms")
console.log("result head:", JSON.stringify(body.result ?? {}).slice(0, 180))

// find the task for this run
await new Promise((res) => setTimeout(res, 6000))
const tasks = await rest("/rest/v1/ai_tasks?select=id,status,error,result,claimed_by,processed_at&order=created_at.desc&limit=3")
const t = (Array.isArray(tasks) ? tasks : []).find((x) => x.status === "done" && x.result) ?? (Array.isArray(tasks) ? tasks : [])[0]
console.log("task:", t?.id, "| status:", t?.status, "| claimed_by:", t?.claimed_by)
console.log("durationMs(worker):", t?.result?.durationMs, "| result type(cline):", t?.result?.result?.type ?? "text")
console.log("answer head:", String(t?.result?.answer ?? t?.error ?? "").slice(0, 140))
await browser.close()
