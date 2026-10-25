// DNA-000226 production E2E — receipt evidence read path (read-only assertions)
import { chromium } from "playwright"
import { readFileSync } from "node:fs"
const BASE = "https://dna-os-deadboard-production.up.railway.app"
const env = {}
readFileSync("/Users/tam/Desktop/ระบบธุรกิจ/dna-os-maincheck/.env.local", "utf8").split("\n").forEach((l) => {
  const i = l.indexOf("=")
  if (i > 0 && !l.startsWith("#")) env[l.slice(0, i)] = l.slice(i + 1)
})
const restH = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: "Bearer " + env.SUPABASE_SERVICE_ROLE_KEY }
const count = async (t) => (await (await fetch(env.NEXT_PUBLIC_SUPABASE_URL.replace(/\/$/, "") + `/rest/v1/${t}?select=id&limit=1`, { headers: restH })).json()).length >= 0
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
const sk = "dna226-" + Date.now()
const ask = async (m) => {
  const t0 = Date.now()
  const r = await page.request.post(BASE + "/api/chat", { data: { message: m, sessionKey: sk }, timeout: 300000 })
  const b = await r.json().catch(() => ({}))
  return { ms: Date.now() - t0, b }
}
const A = await ask("แสดงเอกสารรับเงินทั้งหมด")
const aTitle = A.b.result?.type === "table" ? A.b.result.title : ""
const aRows = A.b.result?.type === "table" ? A.b.result.table.rows.length : "-"
console.log("A:", A.b.result?.type, "| ms:", A.ms, "| title:", aTitle.slice(0, 60), "| rows:", aRows)
console.log("A total=495 in title:", /495/.test(aTitle), "| no false-zero claim:", !/0 ฉบับ/.test(aTitle))

const B = await ask("แสดงหลักฐานรับเงินล่าสุด")
console.log("B:", B.b.result?.type, "| ms:", B.ms, "| head:", JSON.stringify(B.b.result ?? {}).slice(0, 160))

const C = await ask("แสดงรายการรับเงินที่ยืนยันแล้ว")
const cRows = C.b.result?.type === "table" ? C.b.result.table.rows.length : "-"
const cAllVerified = C.b.result?.type === "table" ? C.b.result.table.rows.every((r) => r.some((c) => String(c).includes("ยืนยันแล้ว"))) : null
console.log("C:", C.b.result?.type, "| ms:", C.ms, "| rows:", cRows, "| rows=3:", cRows === 3, "| all verified labels:", cAllVerified)

const D = await ask("เปิดรายละเอียดหลักฐานรับเงินหนึ่งรายการ")
console.log("D:", D.b.result?.type, "| ms:", D.ms, "| head:", JSON.stringify(D.b.result ?? {}).slice(0, 160))

// semantics + no-mutation checks
const rc = await (await page.request.post(BASE + "/api/v1/mcp/business/dispatch", { data: { command: "document.receipt", payload: {} } })).json()
const inv = await (await page.request.post(BASE + "/api/v1/mcp/business/dispatch", { data: { command: "invoice.list", payload: {} } })).json()
console.log("document.receipt unchanged:", rc?.ok, "| invoice.list unchanged:", inv?.ok)
const after = { receipts: await total("receipt_documents"), invoices: await total("invoices"), allocations: await total("payment_allocations") }
console.log("DATA_COUNTS after:", JSON.stringify(after), "| unchanged:", JSON.stringify(before) === JSON.stringify(after))
await browser.close()
