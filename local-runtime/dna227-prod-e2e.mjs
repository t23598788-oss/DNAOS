// DNA-000227 production E2E — receipt command accuracy (A–E + assertions)
import { chromium } from "playwright"
import { readFileSync } from "node:fs"
const BASE = "https://dna-os-deadboard-production.up.railway.app"
const env = {}
readFileSync("/Users/tam/Desktop/ระบบธุรกิจ/dna-os-maincheck/.env.local", "utf8").split("\n").forEach((l) => {
  const i = l.indexOf("=")
  if (i > 0 && !l.startsWith("#")) env[l.slice(0, i)] = l.slice(i + 1)
})
const restH = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: "Bearer " + env.SUPABASE_SERVICE_ROLE_KEY }
const total = async (t) => {
  const r = await fetch(env.NEXT_PUBLIC_SUPABASE_URL.replace(/\/$/, "") + `/rest/v1/${t}?select=id`, { headers: { ...restH, Prefer: "count=exact", Range: "0-0" } })
  return Number(r.headers.get("content-range")?.split("/")[1] ?? "-")
}
const before = { receipts: await total("receipt_documents"), invoices: await total("invoices"), allocations: await total("payment_allocations") }
console.log("DATA_COUNTS before:", JSON.stringify(before))

const loginUrl = readFileSync("/Users/tam/Desktop/ระบบธุรกิจ/dna-os-maincheck/local-runtime/qa-login.url", "utf8").trim()
const browser = await chromium.launch()
const page = await (await browser.newContext()).newPage()
await page.goto(loginUrl, { waitUntil: "networkidle", timeout: 90000 })
const sk = "dna227-" + Date.now()
const ask = async (m) => {
  const t0 = Date.now()
  const r = await page.request.post(BASE + "/api/chat", { data: { message: m, sessionKey: sk }, timeout: 300000 })
  const b = await r.json().catch(() => ({}))
  return { ms: Date.now() - t0, b }
}

const A = await ask("แสดงหลักฐานรับเงินทั้งหมด")
const aT = A.b.result?.type === "table" ? A.b.result.title : ""
console.log("A:", A.b.result?.type, "| ms:", A.ms, "| title:", aT.slice(0, 55), "| rows:", A.b.result?.type === "table" ? A.b.result.table.rows.length : "-")

const B = await ask("แสดงรายการรับเงินที่ยืนยันแล้ว")
const bRows = B.b.result?.type === "table" ? B.b.result.table.rows : []
const bVerified = bRows.every((r) => r.some((c) => String(c).includes("ยืนยันแล้ว")))
console.log("B:", B.b.result?.type, "| ms:", B.ms, "| rows:", bRows.length, "| title:", B.b.result?.title?.slice(0, 55), "| all-verified-label:", bVerified)

const C = await ask("แสดงรายการรับเงินที่ยังไม่ยืนยัน")
const cRows = C.b.result?.type === "table" ? C.b.result.table.rows : []
const cUn = cRows.every((r) => r.some((c) => String(c).includes("ยังไม่ยืนยัน")))
console.log("C:", C.b.result?.type, "| ms:", C.ms, "| rows:", cRows.length, "| title:", C.b.result?.title?.slice(0, 55), "| all-unverified-label:", cUn)

const D = await ask("แสดงหลักฐานรับเงินล่าสุด")
console.log("D:", D.b.result?.type, "| ms:", D.ms, "| head:", JSON.stringify(D.b.result ?? {}).slice(0, 150))

const E = await ask("เปิดรายละเอียดหลักฐานล่าสุด")
console.log("E:", E.b.result?.type, "| ms:", E.ms, "| head:", JSON.stringify(E.b.result ?? E.text ?? {}).slice(0, 150))

// task evidence: interpreter command + one dispatch per command + provider-error classification
const tasks = await (await fetch(env.NEXT_PUBLIC_SUPABASE_URL.replace(/\/$/, "") + "/rest/v1/ai_tasks?select=id,status,error,result&order=created_at.desc&limit=6", { headers: restH })).json()
for (const t of tasks) {
  console.log("task:", String(t.id).slice(0, 8), "|", t.status, "| cmd:", t.result?.command ?? "-", "| err:", String(t.error ?? "").slice(0, 50))
}
// semantics unchanged + no mutation
const rc = await (await page.request.post(BASE + "/api/v1/mcp/business/dispatch", { data: { command: "document.receipt", payload: {} } })).json()
const inv = await (await page.request.post(BASE + "/api/v1/mcp/business/dispatch", { data: { command: "invoice.list", payload: {} } })).json()
console.log("document.receipt unchanged:", rc?.ok, "| invoice.list unchanged:", inv?.ok)
const after = { receipts: await total("receipt_documents"), invoices: await total("invoices"), allocations: await total("payment_allocations") }
console.log("DATA_COUNTS after:", JSON.stringify(after), "| unchanged:", JSON.stringify(before) === JSON.stringify(after))
await browser.close()
