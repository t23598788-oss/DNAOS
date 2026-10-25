import { chromium } from "playwright"
import { readFileSync } from "node:fs"
const BASE = "https://dna-os-deadboard-production.up.railway.app"
const loginUrl = readFileSync("/Users/tam/Desktop/ระบบธุรกิจ/dna-os-maincheck/local-runtime/qa-login.url", "utf8").trim()
const browser = await chromium.launch()
const page = await (await browser.newContext()).newPage()
await page.goto(loginUrl, { waitUntil: "networkidle", timeout: 90000 })

// G. document.preview via canonical dispatcher (VOID invoice — read only)
const pv = await page.request.post(BASE + "/api/v1/mcp/business/dispatch", { data: { command: "document.preview", payload: { document_id: "ffa43c85-584e-4806-9d81-22395fa13d18", document_kind: "invoice" } }, timeout: 60000 })
const pvd = await pv.json().catch(() => ({}))
console.log("PREVIEW mode:", pvd?.data?.mode, "| doc_no:", pvd?.data?.document_number, "| has_file:", Boolean(pvd?.data?.storage_path), "| has_summary_html:", Boolean(pvd?.data?.summary_html))

// H test: document.receipt live
const rc = await page.request.post(BASE + "/api/v1/mcp/business/dispatch", { data: { command: "document.receipt", payload: {} }, timeout: 60000 })
const rcd = await rc.json().catch(() => ({}))
const rcRows = rcd?.data && typeof rcd.data === "object" ? Object.values(rcd.data).find((v) => Array.isArray(v))?.length : "-"
console.log("document.receipt ok:", rcd?.ok, "| rows:", rcRows)

// I. five workspace commands
const sk = "fin-read-" + Date.now()
const CMDS = ["แสดงใบแจ้งหนี้ทั้งหมด", "เปิดใบแจ้งหนี้ล่าสุด", "แสดงเอกสารรับเงินทั้งหมด", "แสดงหลักฐานรับเงินล่าสุด", "แสดงรายการชำระเงินที่ยืนยันแล้ว"]
for (const m of CMDS) {
  const t0 = Date.now()
  const r = await page.request.post(BASE + "/api/chat", { data: { message: m, sessionKey: sk }, timeout: 300000 })
  const b = await r.json().catch(() => ({}))
  const rows = b.result?.type === "table" ? b.result.table.rows.length : "-"
  console.log("CMD:", m, "| type:", b.result?.type, "| rows:", rows, "| ms:", Date.now() - t0, "| head:", JSON.stringify(b.result ?? b.text ?? {}).slice(0, 110))
}
await browser.close()
